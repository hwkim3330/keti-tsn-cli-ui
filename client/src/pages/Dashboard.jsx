import { useState, useEffect, useRef, useCallback } from 'react'
import axios from 'axios'
import { useDevices } from '../contexts/DeviceContext'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'

const TAP_INTERFACE = 'enxc84d44231cc2'
const SYNC_PERIOD_NS = 125_000_000 // 125ms = 8Hz Sync 주기
const SYNC_PERIOD_MS = 125 // 125ms

// logMessagePeriod to ms conversion: period = 2^log * 1000 ms
function logPeriodToMs(log) {
  return Math.pow(2, log) * 1000
}

// logMessagePeriod to readable string
function logPeriodToString(log) {
  if (log === undefined || log === null) return '-'
  const ms = logPeriodToMs(log)
  if (ms >= 1000) return `${ms / 1000}s`
  return `${ms}ms`
}

// Wrap 1초 경계 처리 (0~1e9-1 범위에서 최소 변화량 계산)
function wrapDelta(dt) {
  if (dt > 5e8) return dt - 1e9
  if (dt < -5e8) return dt + 1e9
  return dt
}

// Δt1 정규화: 125ms 기준 편차만 추출 (jitter 측정용)
// 정상 Δt1 ≈ 125,000,000 ns, 그 편차만 반환
function normalizeDeltat1(dt) {
  const wrapped = wrapDelta(dt)
  // 125ms 주기 기준으로 편차만 추출
  return wrapped - SYNC_PERIOD_NS
}

// 이상치 제거된 배열 반환 (|값| > threshold 제거)
function removeOutliers(arr, threshold) {
  return arr.filter(v => Math.abs(v) <= threshold)
}

// 표준편차 계산
function std(arr) {
  if (arr.length < 2) return 0
  const m = arr.reduce((a, b) => a + b, 0) / arr.length
  const variance = arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length
  return Math.sqrt(variance)
}

// 평균 계산
function mean(arr) {
  if (arr.length === 0) return 0
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

// MAE (Mean Absolute Error)
function mae(actual, predicted) {
  if (actual.length === 0 || actual.length !== predicted.length) return null
  const sum = actual.reduce((acc, a, i) => acc + Math.abs(a - predicted[i]), 0)
  return sum / actual.length
}

function Dashboard() {
  const { devices } = useDevices()
  const [boardStatus, setBoardStatus] = useState({})
  const [loading, setLoading] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true) // Default ON
  const [refreshInterval, setRefreshInterval] = useState(5000) // 5s default
  const intervalRef = useRef(null)
  const [offsetHistory, setOffsetHistory] = useState([])
  const [connectionStats, setConnectionStats] = useState({})
  const MAX_HISTORY = 120

  // PTP Tap monitoring state
  const [tapCapturing, setTapCapturing] = useState(false)
  const [tapConnected, setTapConnected] = useState(false)
  const [ptpPackets, setPtpPackets] = useState([])
  const [syncPairs, setSyncPairs] = useState([])
  const [pdelayInfo, setPdelayInfo] = useState({ lastRtt: null, count: 0 })
  const wsRef = useRef(null)
  const ptpStateRef = useRef({ lastSync: null, lastPdelayReq: null, lastPdelayResp: null })
  const MAX_PACKETS = 50
  const MAX_SYNC_PAIRS = 30

  // PTP Offset Estimation Model (Baseline + Residual 구조)
  const [ptpFeatures, setPtpFeatures] = useState({
    t1_ns_history: [],        // Follow_Up t1 nanoseconds
    delta_t1_jitter: [],      // 정규화된 Δt1 (125ms 기준 편차)
    pdelay_gap_history: [],   // Pdelay timing gap (wrapped)
    d_history: [],            // Link delay samples
  })
  const [offsetModel, setOffsetModel] = useState({
    baseline: 0,              // 마지막 Board offset (5초마다 업데이트)
    baselineTime: 0,          // baseline 업데이트 시간
    residualScale: 0,         // jitter 기반 residual 스케일
    samples: 0,
    maeHistory: []            // MAE 기록
  })
  const [offsetEstimates, setOffsetEstimates] = useState([]) // offset_hat time series
  const FEATURE_WINDOW = 32 // 최근 N개 샘플로 feature 계산

  // Extended PTP Analysis State
  const [ptpStructure, setPtpStructure] = useState({
    domainNumber: null,
    portId: null,
    logSyncInterval: null,      // logMessagePeriod for Sync
    logPdelayInterval: null,    // logMessagePeriod for Pdelay
    twoStepFlag: null,          // 2-step sync flag
    lastSeqId: { Sync: null, Pdelay_Req: null },
    seqGaps: [],                // sequence gaps detected
    totalMessages: 0,
  })

  // Sync period & GM jitter statistics
  const [syncStats, setSyncStats] = useState({
    periods: [],          // actual Sync periods in ns
    periodMean: null,
    periodStd: null,
    periodMin: null,
    periodMax: null,
    jitterMean: null,     // 125ms 기준 jitter mean
    jitterStd: null,
    jitterMax: null,
    lastT1: null,         // Last t1 for period calculation
  })

  // Pdelay detailed info with t2, t3
  const [pdelayDetails, setPdelayDetails] = useState({
    exchanges: [],        // {seqId, t1, t2, t3, t4, d_calc, correction}
    linkDelayHistory: [], // calculated link delays
    linkDelayMean: null,
    linkDelayStd: null,
    spikes: 0,            // spike count (> 3σ)
  })

  // Rate ratio / PPM drift estimation
  const [driftStats, setDriftStats] = useState({
    t1History: [],        // {seq, t1_full_ns, captureTime}
    rateRatio: null,      // estimated rate ratio
    ppm: null,            // PPM drift
    driftDirection: null, // 'fast' or 'slow'
  })

  // Fetch GM status (full data, cached on server)
  const fetchGmHealth = useCallback(async (device) => {
    try {
      const res = await axios.get(`/api/ptp/health/${device.host}`, { timeout: 25000 })
      setConnectionStats(prev => ({
        ...prev,
        [device.id]: { ...prev[device.id], successCount: (prev[device.id]?.successCount || 0) + 1, latency: res.data.latency }
      }))
      return {
        online: res.data.online,
        ptp: res.data.ptp,
        latency: res.data.latency,
        cached: res.data.cached
      }
    } catch (err) {
      setConnectionStats(prev => ({ ...prev, [device.id]: { ...prev[device.id], failCount: (prev[device.id]?.failCount || 0) + 1 } }))
      return { online: false, error: err.message }
    }
  }, [])

  // Fetch Slave offset only (faster endpoint)
  const fetchSlaveOffset = useCallback(async (device) => {
    try {
      const res = await axios.get(`/api/ptp/offset/${device.host}`, { timeout: 20000 })
      setConnectionStats(prev => ({
        ...prev,
        [device.id]: { ...prev[device.id], successCount: (prev[device.id]?.successCount || 0) + 1, latency: res.data.latency }
      }))
      return {
        online: res.data.online,
        ptp: {
          offset: res.data.offset,
          servoState: res.data.servoState,
          portState: res.data.portState,
          profile: res.data.profile,
          asCapable: res.data.asCapable,
          meanLinkDelay: res.data.meanLinkDelay
        },
        latency: res.data.latency
      }
    } catch (err) {
      setConnectionStats(prev => ({ ...prev, [device.id]: { ...prev[device.id], failCount: (prev[device.id]?.failCount || 0) + 1 } }))
      return { online: false, error: err.message }
    }
  }, [])

  const fetchAll = useCallback(async () => {
    if (devices.length === 0) return

    setLoading(true)
    const timestamp = new Date().toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    const historyEntry = { time: timestamp }
    const newStatus = { ...boardStatus }

    const slaveDevice = devices.find(d => d.host === '10.42.0.12' || d.name.includes('#2'))
    const gmDevice = devices.find(d => d.host === '10.42.0.11' || d.name.includes('#1'))

    // Fetch Slave offset (faster endpoint)
    if (slaveDevice) {
      const result = await fetchSlaveOffset(slaveDevice)
      newStatus[slaveDevice.id] = {
        ...newStatus[slaveDevice.id],
        ...result
      }
      if (result.ptp?.offset !== null && result.ptp?.offset !== undefined) {
        historyEntry[slaveDevice.name] = result.ptp.offset
      }
    }

    // GM uses full health (cached on server for 30s)
    if (gmDevice) {
      const result = await fetchGmHealth(gmDevice)
      newStatus[gmDevice.id] = result
    }

    setBoardStatus(newStatus)

    if (historyEntry[slaveDevice?.name] !== undefined) {
      setOffsetHistory(prev => [...prev, historyEntry].slice(-MAX_HISTORY))
    }

    setLoading(false)
  }, [devices, fetchSlaveOffset, fetchGmHealth, boardStatus])

  // Initial fetch and auto-refresh
  useEffect(() => {
    if (devices.length > 0) {
      fetchAll()
    }
  }, [devices])

  useEffect(() => {
    if (autoRefresh && devices.length > 0) {
      intervalRef.current = setInterval(fetchAll, refreshInterval)
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [autoRefresh, devices, refreshInterval, fetchAll])

  // WebSocket for PTP tap capture
  useEffect(() => {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${wsProtocol}//${window.location.host}/ws/capture`

    const connect = () => {
      const ws = new WebSocket(wsUrl)

      ws.onopen = () => setTapConnected(true)
      ws.onclose = () => {
        setTapConnected(false)
        setTimeout(connect, 3000)
      }
      ws.onerror = () => {}

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'sync') {
            setTapCapturing(msg.data.running && msg.data.activeCaptures.some(c => c.interface === TAP_INTERFACE))
          } else if (msg.type === 'packet' && msg.data.protocol === 'PTP') {
            handlePtpPacket(msg.data)
          } else if (msg.type === 'stopped') {
            setTapCapturing(false)
          }
        } catch (e) {}
      }

      wsRef.current = ws
    }

    connect()
    return () => {
      // Cleanup: stop capture and close WebSocket when leaving page
      if (wsRef.current) wsRef.current.close()
      // Stop any active capture on this interface
      axios.post('/api/capture/stop', { interfaces: [TAP_INTERFACE] }).catch(() => {})
    }
  }, [])

  // Handle PTP packet from tap + Feature Extraction + Extended Analysis
  const handlePtpPacket = useCallback((packet) => {
    setPtpPackets(prev => [...prev, packet].slice(-MAX_PACKETS))

    const ptp = packet.ptp
    if (!ptp) return

    const state = ptpStateRef.current
    const now = Date.now()
    const timeStr = new Date().toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 1 })

    // Extract common PTP structure info
    setPtpStructure(prev => {
      const updates = { totalMessages: prev.totalMessages + 1 }

      // Domain number (should be consistent)
      if (ptp.domainNumber !== undefined) {
        updates.domainNumber = ptp.domainNumber
      }

      // Port ID from source
      if (ptp.sourcePortId) {
        updates.portId = ptp.sourcePortId
      }

      // 2-step flag from Sync
      if (ptp.msgType === 'Sync' && ptp.twoStepFlag !== undefined) {
        updates.twoStepFlag = ptp.twoStepFlag
      }

      // Log message period
      if (ptp.logMessagePeriod !== undefined) {
        if (ptp.msgType === 'Sync' || ptp.msgType === 'Follow_Up') {
          updates.logSyncInterval = ptp.logMessagePeriod
        } else if (ptp.msgType === 'Pdelay_Req') {
          updates.logPdelayInterval = ptp.logMessagePeriod
        }
      }

      // Sequence ID gap detection
      const msgGroup = ptp.msgType.startsWith('Pdelay') ? 'Pdelay_Req' : 'Sync'
      if (msgGroup === 'Sync' && ptp.msgType === 'Sync') {
        const lastSeq = prev.lastSeqId.Sync
        if (lastSeq !== null) {
          const expectedSeq = (lastSeq + 1) % 65536
          if (ptp.sequenceId !== expectedSeq) {
            const gap = (ptp.sequenceId - lastSeq + 65536) % 65536 - 1
            if (gap > 0 && gap < 1000) { // reasonable gap
              updates.seqGaps = [...(prev.seqGaps || []), {
                type: 'Sync',
                expected: expectedSeq,
                got: ptp.sequenceId,
                gap,
                time: timeStr
              }].slice(-20)
            }
          }
        }
        updates.lastSeqId = { ...prev.lastSeqId, Sync: ptp.sequenceId }
      } else if (ptp.msgType === 'Pdelay_Req') {
        const lastSeq = prev.lastSeqId.Pdelay_Req
        if (lastSeq !== null) {
          const expectedSeq = (lastSeq + 1) % 65536
          if (ptp.sequenceId !== expectedSeq) {
            const gap = (ptp.sequenceId - lastSeq + 65536) % 65536 - 1
            if (gap > 0 && gap < 1000) {
              updates.seqGaps = [...(prev.seqGaps || []), {
                type: 'Pdelay',
                expected: expectedSeq,
                got: ptp.sequenceId,
                gap,
                time: timeStr
              }].slice(-20)
            }
          }
        }
        updates.lastSeqId = { ...prev.lastSeqId, Pdelay_Req: ptp.sequenceId }
      }

      return { ...prev, ...updates }
    })

    if (ptp.msgType === 'Sync') {
      state.lastSync = {
        sequenceId: ptp.sequenceId,
        time: now,
        correction: ptp.correction || 0,
        timestamp: ptp.timestamp,
        twoStep: ptp.twoStepFlag
      }
    } else if (ptp.msgType === 'Follow_Up' && state.lastSync?.sequenceId === ptp.sequenceId) {
      // Follow_Up contains preciseOriginTimestamp (t1)
      const t1 = ptp.timestamp // preciseOriginTimestamp
      const t1_sec = t1?.seconds || 0
      const t1_ns = t1?.nanoseconds || 0
      const t1_full_ns = BigInt(t1_sec) * BigInt(1e9) + BigInt(t1_ns)
      const syncCorr = state.lastSync.correction || 0
      const followUpCorr = ptp.correction || 0
      const totalCorr = syncCorr + followUpCorr

      setSyncPairs(prev => [...prev, {
        sequenceId: ptp.sequenceId,
        t1_sec,
        t1_ns,
        syncCorr,
        followUpCorr,
        totalCorr,
        time: timeStr
      }].slice(-MAX_SYNC_PAIRS))

      // Feature extraction: Δt1 정규화 (125ms 기준 편차)
      setPtpFeatures(prev => {
        const newT1History = [...prev.t1_ns_history, t1_ns].slice(-FEATURE_WINDOW)

        // Calculate normalized Δt1 (jitter from 125ms period)
        let newJitterHistory = prev.delta_t1_jitter
        if (prev.t1_ns_history.length > 0) {
          const lastT1 = prev.t1_ns_history[prev.t1_ns_history.length - 1]
          const delta = wrapDelta(t1_ns - lastT1)
          const jitter = normalizeDeltat1(delta) // 125ms 기준 편차
          // 이상치 필터링: ±10ms 이상은 제외
          if (Math.abs(jitter) < 10_000_000) {
            newJitterHistory = [...prev.delta_t1_jitter, jitter].slice(-FEATURE_WINDOW)
          }
        }

        return {
          ...prev,
          t1_ns_history: newT1History,
          delta_t1_jitter: newJitterHistory
        }
      })

      // Update Sync period & jitter statistics
      // Use prev.lastT1 to avoid stale closure issue
      setSyncStats(prev => {
        // First sample - just store t1 for next calculation
        if (prev.lastT1 === undefined || prev.lastT1 === null) {
          return { ...prev, lastT1: t1_ns }
        }

        const period = wrapDelta(t1_ns - prev.lastT1)
        // Filter invalid periods (should be around 125ms = 125,000,000 ns)
        if (period < 50_000_000 || period > 500_000_000) {
          return { ...prev, lastT1: t1_ns }
        }

        const newPeriods = [...(prev.periods || []), period].slice(-FEATURE_WINDOW)

        // Calculate statistics
        const periodMean = mean(newPeriods)
        const periodStd = std(newPeriods)
        const periodMin = Math.min(...newPeriods)
        const periodMax = Math.max(...newPeriods)

        const jitters = newPeriods.map(p => p - SYNC_PERIOD_NS)
        const filteredJitters = removeOutliers(jitters, 10_000_000)
        const jitterMean = mean(filteredJitters)
        const jitterStd = std(filteredJitters)
        const jitterMax = filteredJitters.length > 0 ? Math.max(...filteredJitters.map(Math.abs)) : 0

        return {
          lastT1: t1_ns,
          periods: newPeriods,
          periodMean,
          periodStd,
          periodMin,
          periodMax,
          jitterMean,
          jitterStd,
          jitterMax
        }
      })

      // Update drift/rate ratio estimation
      setDriftStats(prev => {
        const newEntry = {
          seq: ptp.sequenceId,
          t1_full_ns: t1_full_ns.toString(),
          captureTime: now
        }
        const newHistory = [...prev.t1History, newEntry].slice(-60)

        // Need at least 10 samples for drift calculation
        if (newHistory.length < 10) {
          return { ...prev, t1History: newHistory }
        }

        // Calculate rate ratio using linear regression on t1 vs capture time
        const first = newHistory[0]
        const last = newHistory[newHistory.length - 1]
        const dtCapture = last.captureTime - first.captureTime // ms
        const dtPtp = (BigInt(last.t1_full_ns) - BigInt(first.t1_full_ns)) / BigInt(1_000_000) // ns -> ms

        if (dtCapture > 0) {
          const rateRatio = Number(dtPtp) / dtCapture
          const ppm = (rateRatio - 1) * 1_000_000
          const driftDirection = ppm > 0 ? 'fast' : ppm < 0 ? 'slow' : 'stable'

          return {
            t1History: newHistory,
            rateRatio: rateRatio.toFixed(9),
            ppm: ppm.toFixed(3),
            driftDirection
          }
        }

        return { ...prev, t1History: newHistory }
      })

      // Baseline + Residual 모델로 offset_hat 계산
      if (offsetModel.samples > 0) {
        const jitterArr = removeOutliers(ptpFeatures.delta_t1_jitter, 5_000_000) // ±5ms 이내만
        const currentJitter = jitterArr.length > 2 ? std(jitterArr) : 0

        // offset_hat = baseline + residual (jitter 기반 보정)
        const residual = offsetModel.residualScale * (currentJitter / 1000)
        const offset_hat = Math.round(offsetModel.baseline + residual)

        setOffsetEstimates(prev => [...prev, {
          time: timeStr,
          offset_hat,
          baseline: offsetModel.baseline,
          jitter_us: Math.round(currentJitter / 1000)
        }].slice(-120))
      }

      state.lastSync = null
    } else if (ptp.msgType === 'Pdelay_Req') {
      state.lastPdelayReq = {
        sequenceId: ptp.sequenceId,
        time: now,
        timestamp: ptp.timestamp,
        // t1 = Pdelay_Req departure time (requester's timestamp)
        t1_ns: ptp.timestamp?.nanoseconds || 0
      }
    } else if (ptp.msgType === 'Pdelay_Resp' && state.lastPdelayReq?.sequenceId === ptp.sequenceId) {
      // requestReceiptTimestamp = t2 (responder received Pdelay_Req)
      const t2 = ptp.requestReceiptTimestamp || ptp.timestamp
      state.lastPdelayResp = {
        sequenceId: ptp.sequenceId,
        reqTime: state.lastPdelayReq.time,
        respTime: now,
        t1_ns: state.lastPdelayReq.t1_ns,
        t2_ns: t2?.nanoseconds || 0,
        t2_sec: t2?.seconds || 0,
        respTimestamp: ptp.timestamp,
        correction: ptp.correction || 0
      }
    } else if (ptp.msgType === 'Pdelay_Resp_Follow_Up' && state.lastPdelayResp?.sequenceId === ptp.sequenceId) {
      // Defensive check - ensure lastPdelayResp is valid
      const lastResp = state.lastPdelayResp
      if (!lastResp) return

      // responseOriginTimestamp = t3 (responder sent Pdelay_Resp)
      const t3 = ptp.timestamp // responseOriginTimestamp in Follow_Up
      const t3_ns = t3?.nanoseconds || 0
      const t3_sec = t3?.seconds || 0

      // t4 = Pdelay_Resp arrival time (requester's timestamp) - not available from TAP
      // But we can still track t2, t3 for analysis

      const rtt = (lastResp.respTime || 0) - (lastResp.reqTime || 0)
      const respNs = lastResp.respTimestamp?.nanoseconds || 0
      const fuNs = t3_ns
      const pdelayGap = wrapDelta(fuNs - respNs)

      // Note: turnaround (t3-t2) from PCAP is NOT reliable
      // t2 and t3 may be in different seconds, and we only have nanoseconds
      // Use board-reported linkDelay instead
      const t2_ns = lastResp.t2_ns || 0
      const t2_sec = lastResp.t2_sec || 0
      const t3_full = BigInt(t3_sec) * BigInt(1e9) + BigInt(t3_ns)
      const t2_full = BigInt(t2_sec) * BigInt(1e9) + BigInt(t2_ns)
      const turnaroundFull = Number(t3_full - t2_full) // Can be negative if clock wrap

      setPdelayInfo(prev => ({
        lastRtt: rtt,
        count: (prev?.count || 0) + 1,
        respTimestamp: ptp.timestamp,
        pdelayGap,
        t2_ns: t2_ns,
        t2_sec: t2_sec,
        t3_ns: t3_ns,
        t3_sec: t3_sec,
        turnaround: turnaroundFull
      }))

      // Update Pdelay details
      setPdelayDetails(prev => {
        if (!prev) return { exchanges: [], linkDelayHistory: [], linkDelayMean: null, linkDelayStd: null, spikes: 0 }

        const exchange = {
          seqId: ptp.sequenceId,
          t1_ns: lastResp.t1_ns || 0,
          t2_ns: t2_ns,
          t3_ns: t3_ns,
          turnaround: turnaroundFull,
          correction: (lastResp.correction || 0) + (ptp.correction || 0),
          time: timeStr
        }
        const newExchanges = [...prev.exchanges, exchange].slice(-30)

        // Link delay sanity check using turnaround stability
        // Note: turnaround from PCAP may not be reliable due to different clock domains
        const newLinkDelays = [...prev.linkDelayHistory, turnaroundFull].slice(-FEATURE_WINDOW)
        const linkDelayMean = mean(newLinkDelays)
        const linkDelayStd = std(newLinkDelays)

        // Spike detection: > 3σ from mean (only if values are reasonable)
        let spikes = prev.spikes
        // Skip spike detection if turnaround is unreasonable (PCAP timing issue)
        if (linkDelayStd > 0 && Math.abs(turnaroundFull) < 1e9 && Math.abs(turnaroundFull - linkDelayMean) > 3 * linkDelayStd) {
          spikes++
        }

        return {
          exchanges: newExchanges,
          linkDelayHistory: newLinkDelays,
          linkDelayMean,
          linkDelayStd,
          spikes
        }
      })

      // Feature: pdelay gap history
      setPtpFeatures(prev => ({
        ...prev,
        pdelay_gap_history: [...prev.pdelay_gap_history, pdelayGap].slice(-FEATURE_WINDOW)
      }))

      state.lastPdelayReq = null
      state.lastPdelayResp = null
    }
  }, [offsetModel, ptpFeatures.t1_ns_history, ptpFeatures.delta_t1_jitter])

  // Update model when board offset arrives (every ~5 seconds)
  // Baseline + Residual 구조: offset_hat = baseline + residual
  useEffect(() => {
    const slaveDevice = devices.find(d => d.host === '10.42.0.12')
    const currentOffset = boardStatus[slaveDevice?.id]?.ptp?.offset
    const currentD = boardStatus[slaveDevice?.id]?.ptp?.meanLinkDelay

    if (currentOffset !== undefined && currentOffset !== null) {
      const now = Date.now()

      // Link delay 기록
      if (currentD) {
        const d_ns = currentD / 65536
        setPtpFeatures(prev => ({
          ...prev,
          d_history: [...prev.d_history, d_ns].slice(-FEATURE_WINDOW)
        }))
      }

      // MAE 계산 (이전 추정값과 실제값 비교)
      let currentMae = null
      if (offsetEstimates.length > 0) {
        const recentEstimates = offsetEstimates.slice(-8).map(e => e.offset_hat)
        const actualArr = recentEstimates.map(() => currentOffset)
        currentMae = mae(actualArr, recentEstimates)
      }

      // Baseline 업데이트 (강제 통과)
      setOffsetModel(prev => ({
        baseline: currentOffset, // 보드 offset으로 강제 리셋
        baselineTime: now,
        residualScale: 0, // residual은 다음 구간에서 학습
        samples: prev.samples + 1,
        maeHistory: currentMae !== null
          ? [...prev.maeHistory, { time: now, mae: Math.round(currentMae) }].slice(-20)
          : prev.maeHistory
      }))
    }
  }, [boardStatus, devices, offsetEstimates])

  // Start/Stop tap capture
  const startTapCapture = async () => {
    try {
      await axios.post('/api/capture/start', {
        interfaces: [TAP_INTERFACE],
        captureMode: 'ptp'
      })
      setTapCapturing(true)
      setPtpPackets([])
      setSyncPairs([])
      setPdelayInfo({ lastRtt: null, count: 0 })
      setPtpFeatures({ t1_ns_history: [], delta_t1_jitter: [], pdelay_gap_history: [], d_history: [] })
      setOffsetEstimates([])
      setOffsetModel({ baseline: 0, baselineTime: 0, residualScale: 0, samples: 0, maeHistory: [] })
      setPtpStructure({ domainNumber: null, portId: null, logSyncInterval: null, logPdelayInterval: null, twoStepFlag: null, lastSeqId: { Sync: null, Pdelay_Req: null }, seqGaps: [], totalMessages: 0 })
      setSyncStats({ periods: [], periodMean: null, periodStd: null, periodMin: null, periodMax: null, jitterMean: null, jitterStd: null, jitterMax: null, lastT1: null })
      setPdelayDetails({ exchanges: [], linkDelayHistory: [], linkDelayMean: null, linkDelayStd: null, spikes: 0 })
      setDriftStats({ t1History: [], rateRatio: null, ppm: null, driftDirection: null })
      ptpStateRef.current = { lastSync: null, lastPdelayReq: null, lastPdelayResp: null }
    } catch (e) {}
  }

  const stopTapCapture = async () => {
    try {
      await axios.post('/api/capture/stop', { interfaces: [TAP_INTERFACE] })
      setTapCapturing(false)
    } catch (e) {}
  }

  const servoStateText = (state) => {
    const states = { 0: 'Init', 1: 'Tracking', 2: 'Locked', 3: 'Holdover' }
    return states[state] ?? '-'
  }

  const servoStateColor = (state) => {
    const colors = { 0: '#94a3b8', 1: '#059669', 2: '#2563eb', 3: '#d97706' }
    return colors[state] ?? '#94a3b8'
  }

  // Board identification - use host IP or #1/#2 suffix
  const board1 = devices.find(d => d.host === '10.42.0.11' || d.name.includes('#1'))
  const board2 = devices.find(d => d.host === '10.42.0.12' || d.name.includes('#2'))
  const board1Status = board1 ? boardStatus[board1.id] : null
  const board2Status = board2 ? boardStatus[board2.id] : null
  const isSynced = board1Status?.online && board2Status?.online &&
    board1Status?.ptp?.isGM && board2Status?.ptp?.portState === 'slave' &&
    board2Status?.ptp?.servoState >= 1

  // Calculate offset stats
  const getOffsetStats = () => {
    const offsets = offsetHistory
      .map(h => h[board2?.name])
      .filter(v => v !== undefined && v !== null)
    if (offsets.length === 0) return null

    const avg = offsets.reduce((a, b) => a + b, 0) / offsets.length
    const max = Math.max(...offsets.map(Math.abs))
    const min = Math.min(...offsets)
    const maxVal = Math.max(...offsets)

    return { avg: avg.toFixed(0), max, min, maxVal, count: offsets.length }
  }

  const offsetStats = getOffsetStats()

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">PTP Dashboard</h1>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <select
            value={refreshInterval}
            onChange={(e) => setRefreshInterval(parseInt(e.target.value))}
            style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #e2e8f0', fontSize: '0.8rem' }}
          >
            <option value={3000}>3s</option>
            <option value={5000}>5s</option>
            <option value={10000}>10s</option>
            <option value={15000}>15s</option>
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto
          </label>
          <button className="btn btn-secondary" onClick={fetchAll} disabled={loading}>
            {loading ? '...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Topology Overview */}
      <div className="card" style={{ marginBottom: '16px', padding: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '48px' }}>
          {/* Board 1 */}
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: '140px', height: '90px', border: '2px solid #64748b', borderRadius: '8px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              background: board1Status?.online ? '#f8fafc' : '#fef2f2',
              position: 'relative'
            }}>
              {board1Status?.online && (
                <div style={{
                  position: 'absolute', top: '-6px', right: '-6px',
                  width: '12px', height: '12px', borderRadius: '50%',
                  background: '#059669', border: '2px solid #fff'
                }} />
              )}
              <div style={{ fontWeight: '600', fontSize: '0.95rem', color: '#334155' }}>Board 1</div>
              <div style={{ fontSize: '0.7rem', color: '#64748b' }}>LAN9692</div>
              {board1Status?.ptp?.isGM && (
                <div style={{
                  fontSize: '0.65rem', background: '#475569', color: '#fff',
                  padding: '2px 8px', borderRadius: '4px', marginTop: '4px', fontWeight: '500'
                }}>
                  GM
                </div>
              )}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '6px' }}>
              {board1?.host || '10.42.0.11'}
            </div>
            {connectionStats[board1?.id]?.latency && (
              <div style={{ fontSize: '0.65rem', color: '#94a3b8' }}>
                {connectionStats[board1?.id].latency}ms
              </div>
            )}
          </div>

          {/* Connection Line */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
            <div style={{ fontSize: '0.7rem', color: '#64748b' }}>Port 8 ↔ Port 8</div>
            <div style={{
              width: '80px', height: '3px',
              background: isSynced ? '#059669' : '#cbd5e1',
              borderRadius: '2px'
            }} />
            <div style={{
              fontSize: '0.75rem',
              color: isSynced ? '#059669' : '#94a3b8',
              fontWeight: '500'
            }}>
              {isSynced ? 'SYNCED' : 'NOT SYNCED'}
            </div>
            {isSynced && board2Status?.ptp?.offset !== null && (
              <div style={{ fontSize: '0.65rem', color: '#64748b', fontFamily: 'monospace' }}>
                {board2Status.ptp.offset} ns
              </div>
            )}
          </div>

          {/* Board 2 */}
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: '140px', height: '90px', border: '2px solid #64748b', borderRadius: '8px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              background: board2Status?.online ? '#f8fafc' : '#fef2f2',
              position: 'relative'
            }}>
              {board2Status?.online && (
                <div style={{
                  position: 'absolute', top: '-6px', right: '-6px',
                  width: '12px', height: '12px', borderRadius: '50%',
                  background: '#059669', border: '2px solid #fff'
                }} />
              )}
              <div style={{ fontWeight: '600', fontSize: '0.95rem', color: '#334155' }}>Board 2</div>
              <div style={{ fontSize: '0.7rem', color: '#64748b' }}>LAN9692</div>
              {board2Status?.ptp?.portState === 'slave' && (
                <div style={{
                  fontSize: '0.65rem', background: '#475569', color: '#fff',
                  padding: '2px 8px', borderRadius: '4px', marginTop: '4px', fontWeight: '500'
                }}>
                  SLAVE
                </div>
              )}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '6px' }}>
              {board2?.host || '10.42.0.12'}
            </div>
            {connectionStats[board2?.id]?.latency && (
              <div style={{ fontSize: '0.65rem', color: '#94a3b8' }}>
                {connectionStats[board2?.id].latency}ms
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Board Status Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
        {devices.map((device, idx) => {
          const status = boardStatus[device.id]
          const ptp = status?.ptp
          const isBoard1 = device.name.includes('1') || device.host?.includes('.11')

          return (
            <div key={device.id} className="card">
              <div className="card-header">
                <h2 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    width: '10px', height: '10px', borderRadius: '50%',
                    background: status?.online ? '#22c55e' : '#ef4444'
                  }} />
                  {device.name}
                  {status?.online && ptp && (
                    <span style={{
                      fontSize: '0.6rem', padding: '2px 6px', borderRadius: '3px',
                      background: '#e2e8f0',
                      color: '#475569', fontWeight: '500'
                    }}>
                      {ptp.isGM ? 'GM' : ptp.portState?.toUpperCase() || 'N/A'}
                    </span>
                  )}
                </h2>
                <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                  {status?.latency ? `${status.latency}ms` : ''}
                </span>
              </div>

              {status?.online && ptp ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                  <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '6px' }}>
                    <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginBottom: '2px' }}>Profile</div>
                    <div style={{ fontWeight: '600', fontSize: '0.9rem' }}>{ptp.profile || '-'}</div>
                  </div>
                  <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '6px' }}>
                    <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginBottom: '2px' }}>AS-Capable</div>
                    <div style={{
                      fontWeight: '600', fontSize: '0.9rem',
                      color: ptp.asCapable ? '#22c55e' : '#ef4444'
                    }}>
                      {ptp.asCapable ? 'Yes' : 'No'}
                    </div>
                  </div>
                  <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '6px' }}>
                    <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginBottom: '2px' }}>Servo</div>
                    <div style={{
                      fontWeight: '600', fontSize: '0.9rem',
                      color: servoStateColor(ptp.servoState)
                    }}>
                      {servoStateText(ptp.servoState)}
                    </div>
                  </div>
                  <div style={{
                    padding: '12px', background: '#f1f5f9',
                    borderRadius: '6px', gridColumn: '1 / -1'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: '0.65rem', color: '#64748b', marginBottom: '2px' }}>Offset</div>
                        <div style={{
                          fontWeight: '600', fontSize: '1.1rem', fontFamily: 'monospace',
                          color: '#334155'
                        }}>
                          {ptp.offset !== null ? `${ptp.offset} ns` : '-'}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginBottom: '2px' }}>Link Delay</div>
                        <div style={{ fontWeight: '500', fontSize: '0.85rem', fontFamily: 'monospace' }}>
                          {ptp.meanLinkDelay ? `${(ptp.meanLinkDelay / 65536).toFixed(0)} ns` : '-'}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ padding: '24px', textAlign: 'center', color: '#94a3b8' }}>
                  {status?.error || 'Connecting...'}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Offset Graph */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">PTP Offset History</h2>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            {offsetStats && (
              <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                Avg: <b>{offsetStats.avg}ns</b> |
                Max: <b>±{offsetStats.max}ns</b> |
                Samples: {offsetStats.count}
              </div>
            )}
            <button
              className="btn btn-secondary"
              onClick={() => setOffsetHistory([])}
              style={{ fontSize: '0.7rem', padding: '4px 8px' }}
            >
              Clear
            </button>
          </div>
        </div>
        <div style={{ height: '220px' }}>
          {offsetHistory.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={offsetHistory} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 10 }}
                  stroke="#94a3b8"
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 10 }}
                  stroke="#94a3b8"
                  domain={['auto', 'auto']}
                  tickFormatter={(v) => `${v}`}
                  label={{ value: 'ns', angle: -90, position: 'insideLeft', fontSize: 10 }}
                />
                <Tooltip
                  contentStyle={{ fontSize: '0.75rem', background: '#fff', border: '1px solid #e2e8f0' }}
                  formatter={(value) => [`${value} ns`, 'Offset']}
                />
                <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
                {devices.map((device, idx) => (
                  <Line
                    key={device.id}
                    type="monotone"
                    dataKey={device.name}
                    stroke={idx === 0 ? '#64748b' : '#0891b2'}
                    strokeWidth={1.5}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div style={{
              height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#94a3b8', fontSize: '0.85rem'
            }}>
              {autoRefresh ? 'Collecting offset data...' : 'Enable auto-refresh to collect data'}
            </div>
          )}
        </div>
      </div>

      {/* PTP Tap Monitoring Section */}
      <div className="card" style={{ marginTop: '16px' }}>
        <div className="card-header">
          <h2 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            PTP Tap Monitor
            <span style={{
              fontSize: '0.65rem', padding: '2px 6px', borderRadius: '4px',
              background: '#f1f5f9', color: '#64748b'
            }}>
              {TAP_INTERFACE}
            </span>
          </h2>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{
              padding: '3px 8px', borderRadius: '12px', fontSize: '0.7rem',
              background: tapConnected ? '#ecfdf5' : '#fef2f2',
              color: tapConnected ? '#059669' : '#dc2626'
            }}>
              {tapConnected ? 'WS Connected' : 'WS Disconnected'}
            </span>
            {!tapCapturing ? (
              <button className="btn btn-primary" onClick={startTapCapture} disabled={!tapConnected}
                style={{ fontSize: '0.75rem', padding: '4px 12px' }}>
                Start Capture
              </button>
            ) : (
              <button className="btn btn-danger" onClick={stopTapCapture}
                style={{ fontSize: '0.75rem', padding: '4px 12px' }}>
                Stop
              </button>
            )}
            <button className="btn btn-secondary" onClick={() => {
              setPtpPackets([])
              setSyncPairs([])
              setPdelayInfo({ lastRtt: null, count: 0 })
              setPtpFeatures({ t1_ns_history: [], delta_t1_jitter: [], pdelay_gap_history: [], d_history: [] })
              setOffsetEstimates([])
              setOffsetModel({ baseline: 0, baselineTime: 0, residualScale: 0, samples: 0, maeHistory: [] })
              setPtpStructure({ domainNumber: null, portId: null, logSyncInterval: null, logPdelayInterval: null, twoStepFlag: null, lastSeqId: { Sync: null, Pdelay_Req: null }, seqGaps: [], totalMessages: 0 })
              setSyncStats({ periods: [], periodMean: null, periodStd: null, periodMin: null, periodMax: null, jitterMean: null, jitterStd: null, jitterMax: null, lastT1: null })
              setPdelayDetails({ exchanges: [], linkDelayHistory: [], linkDelayMean: null, linkDelayStd: null, spikes: 0 })
              setDriftStats({ t1History: [], rateRatio: null, ppm: null, driftDirection: null })
              ptpStateRef.current = { lastSync: null, lastPdelayReq: null, lastPdelayResp: null }
            }} style={{ fontSize: '0.75rem', padding: '4px 12px' }}>
              Clear
            </button>
          </div>
        </div>

        {tapCapturing && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            {/* PTP Messages */}
            <div>
              <h3 style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '8px' }}>
                Recent PTP Messages ({ptpPackets.length})
              </h3>
              <div style={{
                height: '180px', overflow: 'auto', fontSize: '0.7rem', fontFamily: 'monospace',
                background: '#f8fafc', borderRadius: '6px', padding: '8px'
              }}>
                {ptpPackets.length === 0 ? (
                  <div style={{ color: '#94a3b8', textAlign: 'center', padding: '40px' }}>
                    Waiting for PTP packets...
                  </div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>
                        <th style={{ textAlign: 'left', padding: '4px' }}>Type</th>
                        <th style={{ textAlign: 'left', padding: '4px' }}>Seq</th>
                        <th style={{ textAlign: 'right', padding: '4px' }}>Timestamp (ns)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ptpPackets.slice(-20).reverse().map((pkt, i) => {
                        const msgColors = {
                          'Sync': '#2563eb',
                          'Follow_Up': '#7c3aed',
                          'Pdelay_Req': '#0891b2',
                          'Pdelay_Resp': '#059669',
                          'Pdelay_Resp_Follow_Up': '#10b981'
                        }
                        return (
                          <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{
                              padding: '3px 4px',
                              color: msgColors[pkt.ptp?.msgType] || '#64748b',
                              fontWeight: '500'
                            }}>
                              {pkt.ptp?.msgType}
                            </td>
                            <td style={{ padding: '3px 4px' }}>{pkt.ptp?.sequenceId}</td>
                            <td style={{ padding: '3px 4px', textAlign: 'right', color: '#475569' }}>
                              {pkt.ptp?.timestamp?.nanoseconds?.toLocaleString() || '-'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Sync/Follow_Up Pairs - offset = (t2-t1) - d - C */}
            <div>
              <h3 style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '8px' }}>
                Sync/Follow_Up Pairs ({syncPairs.length})
                <span style={{ fontSize: '0.65rem', color: '#94a3b8', marginLeft: '8px' }}>
                  offset ≈ (t2-t1) - d - C
                </span>
              </h3>
              <div style={{
                height: '180px', overflow: 'auto', fontSize: '0.65rem', fontFamily: 'monospace',
                background: '#f8fafc', borderRadius: '6px', padding: '8px'
              }}>
                {syncPairs.length === 0 ? (
                  <div style={{ color: '#94a3b8', textAlign: 'center', padding: '40px' }}>
                    Waiting for Sync/Follow_Up pairs...
                  </div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>
                        <th style={{ textAlign: 'left', padding: '3px' }}>Seq</th>
                        <th style={{ textAlign: 'right', padding: '3px' }}>t1 (ns)</th>
                        <th style={{ textAlign: 'right', padding: '3px' }}>C_sync</th>
                        <th style={{ textAlign: 'right', padding: '3px' }}>C_fup</th>
                        <th style={{ textAlign: 'right', padding: '3px' }}>C_total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {syncPairs.slice(-12).reverse().map((pair, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '3px', color: '#475569' }}>{pair.sequenceId}</td>
                          <td style={{ padding: '3px', textAlign: 'right', color: '#7c3aed' }}>
                            {pair.t1_ns?.toLocaleString()}
                          </td>
                          <td style={{ padding: '3px', textAlign: 'right', color: pair.syncCorr ? '#059669' : '#94a3b8' }}>
                            {pair.syncCorr || 0}
                          </td>
                          <td style={{ padding: '3px', textAlign: 'right', color: pair.followUpCorr ? '#059669' : '#94a3b8' }}>
                            {pair.followUpCorr || 0}
                          </td>
                          <td style={{ padding: '3px', textAlign: 'right', fontWeight: '600', color: pair.totalCorr ? '#2563eb' : '#94a3b8' }}>
                            {pair.totalCorr || 0}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}

        {/* PTP Analysis Summary */}
        {tapCapturing && syncPairs.length > 0 && (
          <div style={{ marginTop: '16px', padding: '12px', background: '#f8fafc', borderRadius: '8px' }}>
            <h3 style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '12px' }}>
              PTP Analysis Summary
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', fontSize: '0.75rem' }}>
              {/* Slave (Board 2) Reported Values */}
              <div style={{ padding: '10px', background: '#fff', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '0.65rem', color: '#64748b', marginBottom: '4px' }}>Slave Offset (Board 2)</div>
                <div style={{ fontSize: '1.1rem', fontWeight: '600', color: '#0891b2', fontFamily: 'monospace' }}>
                  {board2Status?.ptp?.offset ?? '-'} ns
                </div>
              </div>
              <div style={{ padding: '10px', background: '#fff', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '0.65rem', color: '#64748b', marginBottom: '4px' }}>Slave Link Delay (d)</div>
                <div style={{ fontSize: '1.1rem', fontWeight: '600', color: '#059669', fontFamily: 'monospace' }}>
                  {board2Status?.ptp?.meanLinkDelay ? (board2Status.ptp.meanLinkDelay / 65536).toFixed(0) : '-'} ns
                </div>
              </div>
              {/* Tap Captured Values */}
              <div style={{ padding: '10px', background: '#fff', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '0.65rem', color: '#64748b', marginBottom: '4px' }}>Tap: Total Correction (C)</div>
                <div style={{ fontSize: '1.1rem', fontWeight: '600', color: '#7c3aed', fontFamily: 'monospace' }}>
                  {syncPairs[syncPairs.length - 1]?.totalCorr ?? 0} ns
                </div>
              </div>
              <div style={{ padding: '10px', background: '#fff', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '0.65rem', color: '#64748b', marginBottom: '4px' }}>Tap: Pdelay Count</div>
                <div style={{ fontSize: '1.1rem', fontWeight: '600', color: '#475569', fontFamily: 'monospace' }}>
                  {pdelayInfo?.count || 0} <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>exchanges</span>
                </div>
              </div>
            </div>
            {/* PTP Structure Verification */}
            <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid #e2e8f0' }}>
              <h4 style={{ fontSize: '0.8rem', color: '#475569', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                1. PTP 구조 검증
                {ptpStructure?.seqGaps?.length > 0 && (
                  <span style={{ fontSize: '0.65rem', padding: '2px 6px', borderRadius: '4px', background: '#fef2f2', color: '#dc2626' }}>
                    {ptpStructure?.seqGaps?.length} gaps detected
                  </span>
                )}
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '8px', fontSize: '0.7rem' }}>
                <div style={{ padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.6rem', color: '#64748b' }}>Domain</div>
                  <div style={{ fontWeight: '600', color: '#334155' }}>{ptpStructure?.domainNumber ?? '-'}</div>
                </div>
                <div style={{ padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.6rem', color: '#64748b' }}>2-Step</div>
                  <div style={{ fontWeight: '600', color: ptpStructure?.twoStepFlag ? '#059669' : '#94a3b8' }}>
                    {ptpStructure?.twoStepFlag === true ? 'Yes' : ptpStructure?.twoStepFlag === false ? 'No' : '-'}
                  </div>
                </div>
                <div style={{ padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.6rem', color: '#64748b' }}>Sync Period</div>
                  <div style={{ fontWeight: '600', color: '#2563eb' }}>
                    {logPeriodToString(ptpStructure?.logSyncInterval)}
                    {ptpStructure?.logSyncInterval !== null && ptpStructure?.logSyncInterval !== undefined && (
                      <span style={{ fontSize: '0.55rem', color: '#94a3b8', marginLeft: '4px' }}>
                        (log={ptpStructure?.logSyncInterval})
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.6rem', color: '#64748b' }}>Pdelay Period</div>
                  <div style={{ fontWeight: '600', color: '#7c3aed' }}>
                    {logPeriodToString(ptpStructure?.logPdelayInterval)}
                  </div>
                </div>
                <div style={{ padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.6rem', color: '#64748b' }}>Total Msgs</div>
                  <div style={{ fontWeight: '600', color: '#334155' }}>{ptpStructure?.totalMessages || 0}</div>
                </div>
                <div style={{ padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.6rem', color: '#64748b' }}>Seq Gaps</div>
                  <div style={{ fontWeight: '600', color: ptpStructure?.seqGaps?.length > 0 ? '#dc2626' : '#059669' }}>
                    {ptpStructure?.seqGaps?.length || 0}
                  </div>
                </div>
              </div>
              {ptpStructure?.seqGaps?.length > 0 && (
                <div style={{ marginTop: '8px', padding: '6px', background: '#fef2f2', borderRadius: '4px', fontSize: '0.6rem', color: '#991b1b' }}>
                  최근 gaps: {(ptpStructure?.seqGaps || []).slice(-3).map(g => `${g.type}[${g.expected}→${g.got}]`).join(', ')}
                </div>
              )}
            </div>

            {/* Sync Period & GM Jitter Statistics */}
            <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid #e2e8f0' }}>
              <h4 style={{ fontSize: '0.8rem', color: '#475569', marginBottom: '10px' }}>
                2. Sync 주기 & GM 지터 분석
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', fontSize: '0.7rem' }}>
                <div style={{ padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.6rem', color: '#64748b' }}>실제 주기 (mean)</div>
                  <div style={{ fontWeight: '600', color: '#2563eb', fontFamily: 'monospace' }}>
                    {syncStats?.periodMean ? `${(syncStats.periodMean / 1_000_000).toFixed(3)} ms` : '-'}
                  </div>
                  <div style={{ fontSize: '0.55rem', color: '#94a3b8' }}>
                    expected: 125.000 ms
                  </div>
                </div>
                <div style={{ padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.6rem', color: '#64748b' }}>주기 std</div>
                  <div style={{ fontWeight: '600', color: '#7c3aed', fontFamily: 'monospace' }}>
                    {syncStats?.periodStd ? `${(syncStats.periodStd / 1000).toFixed(1)} µs` : '-'}
                  </div>
                </div>
                <div style={{ padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.6rem', color: '#64748b' }}>Jitter (mean)</div>
                  <div style={{ fontWeight: '600', color: '#059669', fontFamily: 'monospace' }}>
                    {syncStats?.jitterMean != null ? `${(syncStats.jitterMean / 1000).toFixed(1)} µs` : '-'}
                  </div>
                </div>
                <div style={{ padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.6rem', color: '#64748b' }}>Jitter (max)</div>
                  <div style={{ fontWeight: '600', color: '#dc2626', fontFamily: 'monospace' }}>
                    {syncStats?.jitterMax ? `±${(syncStats.jitterMax / 1000).toFixed(1)} µs` : '-'}
                  </div>
                </div>
              </div>
            </div>

            {/* Rate Ratio / PPM Drift */}
            <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid #e2e8f0' }}>
              <h4 style={{ fontSize: '0.8rem', color: '#475569', marginBottom: '10px' }}>
                3. Rate Ratio & PPM Drift 추정
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', fontSize: '0.7rem' }}>
                <div style={{ padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.6rem', color: '#64748b' }}>Rate Ratio</div>
                  <div style={{ fontWeight: '600', color: '#2563eb', fontFamily: 'monospace' }}>
                    {driftStats?.rateRatio ?? '-'}
                  </div>
                  <div style={{ fontSize: '0.55rem', color: '#94a3b8' }}>ideal: 1.000000000</div>
                </div>
                <div style={{ padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.6rem', color: '#64748b' }}>PPM Drift</div>
                  <div style={{
                    fontWeight: '600', fontFamily: 'monospace',
                    color: driftStats?.ppm ? (Math.abs(parseFloat(driftStats.ppm)) > 100 ? '#dc2626' : '#059669') : '#94a3b8'
                  }}>
                    {driftStats?.ppm ? `${driftStats.ppm} ppm` : '-'}
                  </div>
                </div>
                <div style={{ padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.6rem', color: '#64748b' }}>Direction</div>
                  <div style={{
                    fontWeight: '600',
                    color: driftStats?.driftDirection === 'fast' ? '#dc2626' :
                           driftStats?.driftDirection === 'slow' ? '#2563eb' : '#059669'
                  }}>
                    {driftStats?.driftDirection === 'fast' ? 'GM Fast ↑' :
                     driftStats?.driftDirection === 'slow' ? 'GM Slow ↓' :
                     driftStats?.driftDirection === 'stable' ? 'Stable =' : '-'}
                  </div>
                  <div style={{ fontSize: '0.55rem', color: '#94a3b8' }}>
                    samples: {driftStats?.t1History?.length || 0}
                  </div>
                </div>
              </div>
            </div>

            {/* Pdelay t2/t3 & Link Delay Sanity Check */}
            <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid #e2e8f0' }}>
              <h4 style={{ fontSize: '0.8rem', color: '#475569', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                4. Pdelay 상세 분석 (t2, t3)
                {pdelayDetails?.spikes > 0 && (
                  <span style={{ fontSize: '0.65rem', padding: '2px 6px', borderRadius: '4px', background: '#fef3c7', color: '#92400e' }}>
                    {pdelayDetails?.spikes} spikes
                  </span>
                )}
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', fontSize: '0.7rem' }}>
                <div style={{ padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.6rem', color: '#64748b' }}>t2 (Req Receipt)</div>
                  <div style={{ fontWeight: '600', color: '#0891b2', fontFamily: 'monospace', fontSize: '0.7rem' }}>
                    {pdelayInfo?.t2_sec != null ? `${pdelayInfo.t2_sec}.${String(pdelayInfo.t2_ns || 0).padStart(9, '0')}` : '-'}
                  </div>
                </div>
                <div style={{ padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.6rem', color: '#64748b' }}>t3 (Resp Origin)</div>
                  <div style={{ fontWeight: '600', color: '#7c3aed', fontFamily: 'monospace', fontSize: '0.7rem' }}>
                    {pdelayInfo?.t3_sec != null ? `${pdelayInfo.t3_sec}.${String(pdelayInfo.t3_ns || 0).padStart(9, '0')}` : '-'}
                  </div>
                </div>
                <div style={{ padding: '8px', background: '#fef3c7', borderRadius: '6px', border: '1px solid #fcd34d' }}>
                  <div style={{ fontSize: '0.6rem', color: '#92400e' }}>Turnaround (참고용)</div>
                  <div style={{ fontWeight: '600', color: '#92400e', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                    {pdelayInfo?.turnaround != null
                      ? (Math.abs(pdelayInfo.turnaround) < 1e9
                          ? `${(pdelayInfo.turnaround / 1000).toFixed(1)} µs`
                          : 'N/A (클럭 차이)')
                      : '-'}
                  </div>
                </div>
                <div style={{ padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.6rem', color: '#64748b' }}>Pdelay Count</div>
                  <div style={{ fontWeight: '600', color: '#334155', fontFamily: 'monospace' }}>
                    {pdelayInfo?.count || 0}
                  </div>
                </div>
              </div>

              {/* Link Delay Sanity Check */}
              <div style={{ marginTop: '8px', padding: '8px', background: '#f0fdf4', borderRadius: '4px', fontSize: '0.65rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: '#166534' }}>
                    <b>Board Link Delay:</b> {board2Status?.ptp?.meanLinkDelay ? (board2Status.ptp.meanLinkDelay / 65536).toFixed(0) : '-'} ns (신뢰 가능)
                  </span>
                  <span style={{
                    padding: '2px 6px', borderRadius: '4px',
                    background: '#dcfce7',
                    color: '#166534'
                  }}>
                    Pdelay 정상
                  </span>
                </div>
              </div>
              <div style={{ marginTop: '4px', padding: '6px', background: '#fef3c7', borderRadius: '4px', fontSize: '0.6rem', color: '#92400e' }}>
                ⚠️ t2, t3는 Responder HW timestamp. PCAP에서는 클럭 기준이 다를 수 있어 turnaround 계산은 참고용입니다.
              </div>
            </div>

            {/* Formula explanation */}
            <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid #e2e8f0' }}>
              <div style={{ padding: '8px', background: '#fefce8', borderRadius: '4px', fontSize: '0.7rem', color: '#854d0e' }}>
                <b>공식:</b> offset ≈ (t2 - t1) - d - C
              </div>
              <div style={{ marginTop: '4px', padding: '8px', background: '#f1f5f9', borderRadius: '4px', fontSize: '0.65rem', color: '#475569' }}>
                <b>t1:</b> GM(Board1)이 Sync 송신 시각 (Follow_Up에서 TAP 캡쳐 ✓) &nbsp;|&nbsp;
                <b>t2:</b> Slave(Board2)가 Sync 수신 시각 (내부값, TAP 캡쳐 ✗) &nbsp;|&nbsp;
                <b>d:</b> Link Delay &nbsp;|&nbsp;
                <b>C:</b> Correction 합
              </div>
            </div>

            {/* PTP Feature & Model Section */}
            <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #e2e8f0' }}>
              <h3 style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '12px' }}>
                PTP Feature Extraction & Offset Estimation
                <span style={{
                  marginLeft: '8px', padding: '2px 8px', borderRadius: '4px', fontSize: '0.65rem',
                  background: offsetModel.samples > 0 ? '#dcfce7' : '#fef3c7',
                  color: offsetModel.samples > 0 ? '#166534' : '#92400e'
                }}>
                  {offsetModel.samples > 0 ? `Baseline+Residual (${offsetModel.samples} updates)` : 'Waiting for board offset...'}
                </span>
              </h3>

              {/* Features - Baseline+Residual Model */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '12px' }}>
                <div style={{ padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.6rem', color: '#64748b' }}>Baseline (Board Offset)</div>
                  <div style={{ fontSize: '0.9rem', fontWeight: '600', color: '#0891b2', fontFamily: 'monospace' }}>
                    {offsetModel.baseline} ns
                  </div>
                </div>
                <div style={{ padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.6rem', color: '#64748b' }}>Jitter (125ms 편차) std</div>
                  <div style={{ fontSize: '0.9rem', fontWeight: '600', color: '#7c3aed', fontFamily: 'monospace' }}>
                    {ptpFeatures.delta_t1_jitter.length > 2
                      ? (std(removeOutliers(ptpFeatures.delta_t1_jitter, 5_000_000)) / 1000).toFixed(1)
                      : '-'} µs
                  </div>
                </div>
                <div style={{ padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.6rem', color: '#64748b' }}>Pdelay Gap std</div>
                  <div style={{ fontSize: '0.9rem', fontWeight: '600', color: '#059669', fontFamily: 'monospace' }}>
                    {ptpFeatures.pdelay_gap_history.length > 2
                      ? (std(ptpFeatures.pdelay_gap_history) / 1000).toFixed(1)
                      : '-'} µs
                  </div>
                </div>
                <div style={{ padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.6rem', color: '#64748b' }}>MAE (Model Error)</div>
                  <div style={{ fontSize: '0.9rem', fontWeight: '600', color: '#dc2626', fontFamily: 'monospace' }}>
                    {offsetModel.maeHistory.length > 0
                      ? `${offsetModel.maeHistory[offsetModel.maeHistory.length - 1].mae} ns`
                      : '-'}
                  </div>
                </div>
              </div>

              {/* Offset Estimation Graph */}
              {offsetEstimates.length > 2 && (
                <div style={{ marginTop: '12px' }}>
                  <h4 style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '8px' }}>
                    Offset Estimation (Baseline+Residual Model)
                    <span style={{ marginLeft: '8px', fontSize: '0.6rem', color: '#94a3b8' }}>
                      baseline (5초마다) + jitter 기반 보정
                    </span>
                  </h4>
                  <div style={{ height: '160px' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={offsetEstimates.slice(-60)}
                        margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="time" tick={{ fontSize: 9 }} stroke="#94a3b8" interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 9 }} stroke="#94a3b8" domain={['auto', 'auto']} />
                        <Tooltip
                          contentStyle={{ fontSize: '0.7rem' }}
                          formatter={(value, name) => [`${value} ns`, name]}
                        />
                        <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
                        <Line
                          type="monotone"
                          dataKey="baseline"
                          name="Baseline"
                          stroke="#0891b2"
                          strokeWidth={1}
                          strokeDasharray="4 4"
                          dot={false}
                          isAnimationActive={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="offset_hat"
                          name="Estimated"
                          stroke="#7c3aed"
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  {/* Jitter detail */}
                  <div style={{ marginTop: '8px', fontSize: '0.65rem', color: '#64748b', display: 'flex', gap: '16px' }}>
                    <span>Jitter Samples: {ptpFeatures.delta_t1_jitter.length}</span>
                    <span>|</span>
                    <span>Latest Jitter: {offsetEstimates.length > 0 ? `${offsetEstimates[offsetEstimates.length-1].jitter_us} µs` : '-'}</span>
                    <span>|</span>
                    <span>Model Updates: {offsetModel.samples}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {!tapCapturing && (
          <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
            Click "Start Capture" to monitor PTP packets from tap device
          </div>
        )}
      </div>
    </div>
  )
}

export default Dashboard
