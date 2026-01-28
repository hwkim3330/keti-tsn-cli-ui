import { useState, useEffect, useRef, useCallback } from 'react'
import axios from 'axios'
import { useDevices } from '../contexts/DeviceContext'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'

const TAP_INTERFACE = 'enxc84d44231cc2'
const SYNC_PERIOD_NS = 125_000_000

function logPeriodToMs(log) {
  return Math.pow(2, log) * 1000
}

function logPeriodToString(log) {
  if (log === undefined || log === null) return '-'
  const ms = logPeriodToMs(log)
  if (ms >= 1000) return `${ms / 1000}s`
  return `${ms}ms`
}

function wrapDelta(dt) {
  if (dt > 5e8) return dt - 1e9
  if (dt < -5e8) return dt + 1e9
  return dt
}

function normalizeDeltat1(dt) {
  const wrapped = wrapDelta(dt)
  return wrapped - SYNC_PERIOD_NS
}

function removeOutliers(arr, threshold) {
  return arr.filter(v => Math.abs(v) <= threshold)
}

function std(arr) {
  if (arr.length < 2) return 0
  const m = arr.reduce((a, b) => a + b, 0) / arr.length
  const variance = arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length
  return Math.sqrt(variance)
}

function mean(arr) {
  if (arr.length === 0) return 0
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

function mae(actual, predicted) {
  if (actual.length === 0 || actual.length !== predicted.length) return null
  const sum = actual.reduce((acc, a, i) => acc + Math.abs(a - predicted[i]), 0)
  return sum / actual.length
}

// Professional muted color palette
const colors = {
  text: '#1e293b',
  textMuted: '#64748b',
  textLight: '#94a3b8',
  bg: '#f8fafc',
  bgAlt: '#f1f5f9',
  bgWarm: '#fffbeb',
  border: '#e2e8f0',
  borderLight: '#f1f5f9',
  accent: '#475569',
  success: '#059669',
  warning: '#d97706',
  error: '#dc2626',
  info: '#0284c7',
}

// Section component with description
function Section({ title, description, note, noteType = 'info', badge, children }) {
  const noteColors = {
    info: { bg: colors.bgAlt, border: colors.border, text: colors.textMuted },
    warning: { bg: colors.bgWarm, border: '#fde68a', text: '#92400e' },
  }
  const noteStyle = noteColors[noteType] || noteColors.info

  return (
    <div style={{ marginBottom: '20px' }}>
      <div style={{ marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <h3 style={{ fontSize: '0.85rem', fontWeight: '600', color: colors.text, margin: 0 }}>{title}</h3>
          {badge && <span style={{ fontSize: '0.6rem', padding: '2px 6px', borderRadius: '3px', background: colors.bgAlt, color: colors.textMuted }}>{badge}</span>}
        </div>
        {description && <p style={{ fontSize: '0.7rem', color: colors.textMuted, margin: 0, lineHeight: 1.4 }}>{description}</p>}
      </div>
      {children}
      {note && (
        <div style={{ marginTop: '8px', padding: '8px 10px', background: noteStyle.bg, border: `1px solid ${noteStyle.border}`, borderRadius: '4px', fontSize: '0.65rem', color: noteStyle.text, lineHeight: 1.4 }}>
          {note}
        </div>
      )}
    </div>
  )
}

function Dashboard() {
  const { devices } = useDevices()
  const [boardStatus, setBoardStatus] = useState({})
  const [loading, setLoading] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [refreshInterval, setRefreshInterval] = useState(5000)
  const [autoSetupStatus, setAutoSetupStatus] = useState(null) // null, 'running', 'success', 'error'
  const [autoSetupMessage, setAutoSetupMessage] = useState('')
  const intervalRef = useRef(null)
  const [offsetHistory, setOffsetHistory] = useState([])
  const [connectionStats, setConnectionStats] = useState({})
  const MAX_HISTORY = 120

  const [tapCapturing, setTapCapturing] = useState(false)
  const [tapConnected, setTapConnected] = useState(false)
  const [ptpPackets, setPtpPackets] = useState([])
  const [syncPairs, setSyncPairs] = useState([])
  const [pdelayInfo, setPdelayInfo] = useState({ lastRtt: null, count: 0 })
  const wsRef = useRef(null)
  const ptpStateRef = useRef({ lastSync: null, lastPdelayReq: null, lastPdelayResp: null })
  const MAX_PACKETS = 50
  const MAX_SYNC_PAIRS = 30

  const [ptpFeatures, setPtpFeatures] = useState({
    t1_ns_history: [],
    delta_t1_jitter: [],
    pdelay_gap_history: [],
    d_history: [],
  })
  const [offsetModel, setOffsetModel] = useState({
    baseline: 0,
    baselineTime: 0,
    residualScale: 0,
    samples: 0,
    maeHistory: []
  })
  const [offsetEstimates, setOffsetEstimates] = useState([])
  const FEATURE_WINDOW = 32

  const [ptpStructure, setPtpStructure] = useState({
    domainNumber: null,
    portId: null,
    logSyncInterval: null,
    logPdelayInterval: null,
    twoStepFlag: null,
    lastSeqId: { Sync: null, Pdelay_Req: null },
    seqGaps: [],
    totalMessages: 0,
  })

  const [syncStats, setSyncStats] = useState({
    periods: [],
    periodMean: null,
    periodStd: null,
    periodMin: null,
    periodMax: null,
    jitterMean: null,
    jitterStd: null,
    jitterMax: null,
    lastT1: null,
  })

  const [pdelayDetails, setPdelayDetails] = useState({
    exchanges: [],
    linkDelayHistory: [],
    linkDelayMean: null,
    linkDelayStd: null,
    spikes: 0,
  })

  const [driftStats, setDriftStats] = useState({
    t1History: [],
    rateRatio: null,
    ppm: null,
    driftDirection: null,
  })

  const fetchGmHealth = useCallback(async (device) => {
    try {
      const res = await axios.get(`/api/ptp/health/${device.host}`, { timeout: 25000 })
      setConnectionStats(prev => ({
        ...prev,
        [device.id]: { ...prev[device.id], successCount: (prev[device.id]?.successCount || 0) + 1, latency: res.data.latency }
      }))
      return { online: res.data.online, ptp: res.data.ptp, latency: res.data.latency, cached: res.data.cached }
    } catch (err) {
      setConnectionStats(prev => ({ ...prev, [device.id]: { ...prev[device.id], failCount: (prev[device.id]?.failCount || 0) + 1 } }))
      return { online: false, error: err.message }
    }
  }, [])

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

    if (slaveDevice) {
      const result = await fetchSlaveOffset(slaveDevice)
      newStatus[slaveDevice.id] = { ...newStatus[slaveDevice.id], ...result }
      if (result.ptp?.offset !== null && result.ptp?.offset !== undefined) {
        historyEntry[slaveDevice.name] = result.ptp.offset
      }
    }

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

  useEffect(() => {
    if (devices.length > 0) fetchAll()
  }, [devices])

  useEffect(() => {
    if (autoRefresh && devices.length > 0) {
      intervalRef.current = setInterval(fetchAll, refreshInterval)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [autoRefresh, devices, refreshInterval, fetchAll])

  useEffect(() => {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${wsProtocol}//${window.location.host}/ws/capture`

    const connect = () => {
      const ws = new WebSocket(wsUrl)
      ws.onopen = () => setTapConnected(true)
      ws.onclose = () => { setTapConnected(false); setTimeout(connect, 3000) }
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
      if (wsRef.current) wsRef.current.close()
      axios.post('/api/capture/stop', { interfaces: [TAP_INTERFACE] }).catch(() => {})
    }
  }, [])

  const handlePtpPacket = useCallback((packet) => {
    setPtpPackets(prev => [...prev, packet].slice(-MAX_PACKETS))
    const ptp = packet.ptp
    if (!ptp) return

    const state = ptpStateRef.current
    const now = Date.now()
    const timeStr = new Date().toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 1 })

    setPtpStructure(prev => {
      const updates = { totalMessages: prev.totalMessages + 1 }
      if (ptp.domainNumber !== undefined) updates.domainNumber = ptp.domainNumber
      if (ptp.sourcePortId) updates.portId = ptp.sourcePortId
      if (ptp.msgType === 'Sync' && ptp.twoStepFlag !== undefined) updates.twoStepFlag = ptp.twoStepFlag
      if (ptp.logMessagePeriod !== undefined) {
        if (ptp.msgType === 'Sync' || ptp.msgType === 'Follow_Up') updates.logSyncInterval = ptp.logMessagePeriod
        else if (ptp.msgType === 'Pdelay_Req') updates.logPdelayInterval = ptp.logMessagePeriod
      }

      const msgGroup = ptp.msgType.startsWith('Pdelay') ? 'Pdelay_Req' : 'Sync'
      if (msgGroup === 'Sync' && ptp.msgType === 'Sync') {
        const lastSeq = prev.lastSeqId.Sync
        if (lastSeq !== null) {
          const expectedSeq = (lastSeq + 1) % 65536
          if (ptp.sequenceId !== expectedSeq) {
            const gap = (ptp.sequenceId - lastSeq + 65536) % 65536 - 1
            if (gap > 0 && gap < 1000) {
              updates.seqGaps = [...(prev.seqGaps || []), { type: 'Sync', expected: expectedSeq, got: ptp.sequenceId, gap, time: timeStr }].slice(-20)
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
              updates.seqGaps = [...(prev.seqGaps || []), { type: 'Pdelay', expected: expectedSeq, got: ptp.sequenceId, gap, time: timeStr }].slice(-20)
            }
          }
        }
        updates.lastSeqId = { ...prev.lastSeqId, Pdelay_Req: ptp.sequenceId }
      }
      return { ...prev, ...updates }
    })

    if (ptp.msgType === 'Sync') {
      state.lastSync = { sequenceId: ptp.sequenceId, time: now, correction: ptp.correction || 0, timestamp: ptp.timestamp, twoStep: ptp.twoStepFlag }
    } else if (ptp.msgType === 'Follow_Up' && state.lastSync?.sequenceId === ptp.sequenceId) {
      const t1 = ptp.timestamp
      const t1_sec = t1?.seconds || 0
      const t1_ns = t1?.nanoseconds || 0
      const t1_full_ns = BigInt(t1_sec) * BigInt(1e9) + BigInt(t1_ns)
      const syncCorr = state.lastSync.correction || 0
      const followUpCorr = ptp.correction || 0
      const totalCorr = syncCorr + followUpCorr

      setSyncPairs(prev => [...prev, { sequenceId: ptp.sequenceId, t1_sec, t1_ns, syncCorr, followUpCorr, totalCorr, time: timeStr }].slice(-MAX_SYNC_PAIRS))

      setPtpFeatures(prev => {
        const newT1History = [...prev.t1_ns_history, t1_ns].slice(-FEATURE_WINDOW)
        let newJitterHistory = prev.delta_t1_jitter
        if (prev.t1_ns_history.length > 0) {
          const lastT1 = prev.t1_ns_history[prev.t1_ns_history.length - 1]
          const delta = wrapDelta(t1_ns - lastT1)
          const jitter = normalizeDeltat1(delta)
          if (Math.abs(jitter) < 10_000_000) {
            newJitterHistory = [...prev.delta_t1_jitter, jitter].slice(-FEATURE_WINDOW)
          }
        }
        return { ...prev, t1_ns_history: newT1History, delta_t1_jitter: newJitterHistory }
      })

      setSyncStats(prev => {
        if (prev.lastT1 === undefined || prev.lastT1 === null) return { ...prev, lastT1: t1_ns }
        const period = wrapDelta(t1_ns - prev.lastT1)
        if (period < 50_000_000 || period > 500_000_000) return { ...prev, lastT1: t1_ns }
        const newPeriods = [...(prev.periods || []), period].slice(-FEATURE_WINDOW)
        const periodMean = mean(newPeriods)
        const periodStd = std(newPeriods)
        const periodMin = Math.min(...newPeriods)
        const periodMax = Math.max(...newPeriods)
        const jitters = newPeriods.map(p => p - SYNC_PERIOD_NS)
        const filteredJitters = removeOutliers(jitters, 10_000_000)
        const jitterMean = mean(filteredJitters)
        const jitterStd = std(filteredJitters)
        const jitterMax = filteredJitters.length > 0 ? Math.max(...filteredJitters.map(Math.abs)) : 0
        return { lastT1: t1_ns, periods: newPeriods, periodMean, periodStd, periodMin, periodMax, jitterMean, jitterStd, jitterMax }
      })

      setDriftStats(prev => {
        const newEntry = { seq: ptp.sequenceId, t1_full_ns: t1_full_ns.toString(), captureTime: now }
        const newHistory = [...prev.t1History, newEntry].slice(-60)
        if (newHistory.length < 10) return { ...prev, t1History: newHistory }
        const first = newHistory[0]
        const last = newHistory[newHistory.length - 1]
        const dtCapture = last.captureTime - first.captureTime
        const dtPtp = (BigInt(last.t1_full_ns) - BigInt(first.t1_full_ns)) / BigInt(1_000_000)
        if (dtCapture > 0) {
          const rateRatio = Number(dtPtp) / dtCapture
          const ppm = (rateRatio - 1) * 1_000_000
          const driftDirection = ppm > 0.01 ? 'fast' : ppm < -0.01 ? 'slow' : 'stable'
          return { t1History: newHistory, rateRatio: rateRatio.toFixed(9), ppm: ppm.toFixed(3), driftDirection }
        }
        return { ...prev, t1History: newHistory }
      })

      if (offsetModel.samples > 0) {
        const jitterArr = removeOutliers(ptpFeatures.delta_t1_jitter, 5_000_000)
        const currentJitter = jitterArr.length > 2 ? std(jitterArr) : 0
        const residual = offsetModel.residualScale * (currentJitter / 1000)
        const offset_hat = Math.round(offsetModel.baseline + residual)
        setOffsetEstimates(prev => [...prev, { time: timeStr, offset_hat, baseline: offsetModel.baseline, jitter_us: Math.round(currentJitter / 1000) }].slice(-120))
      }
      state.lastSync = null
    } else if (ptp.msgType === 'Pdelay_Req') {
      state.lastPdelayReq = { sequenceId: ptp.sequenceId, time: now, timestamp: ptp.timestamp, t1_ns: ptp.timestamp?.nanoseconds || 0 }
    } else if (ptp.msgType === 'Pdelay_Resp' && state.lastPdelayReq?.sequenceId === ptp.sequenceId) {
      const t2 = ptp.requestReceiptTimestamp || ptp.timestamp
      state.lastPdelayResp = {
        sequenceId: ptp.sequenceId, reqTime: state.lastPdelayReq.time, respTime: now, t1_ns: state.lastPdelayReq.t1_ns,
        t2_ns: t2?.nanoseconds || 0, t2_sec: t2?.seconds || 0, respTimestamp: ptp.timestamp, correction: ptp.correction || 0
      }
    } else if (ptp.msgType === 'Pdelay_Resp_Follow_Up' && state.lastPdelayResp?.sequenceId === ptp.sequenceId) {
      const lastResp = state.lastPdelayResp
      if (!lastResp) return
      const t3 = ptp.timestamp
      const t3_ns = t3?.nanoseconds || 0
      const t3_sec = t3?.seconds || 0
      const rtt = (lastResp.respTime || 0) - (lastResp.reqTime || 0)
      const respNs = lastResp.respTimestamp?.nanoseconds || 0
      const fuNs = t3_ns
      const pdelayGap = wrapDelta(fuNs - respNs)
      const t2_ns = lastResp.t2_ns || 0
      const t2_sec = lastResp.t2_sec || 0
      const t3_full = BigInt(t3_sec) * BigInt(1e9) + BigInt(t3_ns)
      const t2_full = BigInt(t2_sec) * BigInt(1e9) + BigInt(t2_ns)
      const turnaroundFull = Number(t3_full - t2_full)

      setPdelayInfo(prev => ({
        lastRtt: rtt, count: (prev?.count || 0) + 1, respTimestamp: ptp.timestamp, pdelayGap,
        t2_ns, t2_sec, t3_ns, t3_sec, turnaround: turnaroundFull
      }))

      setPdelayDetails(prev => {
        if (!prev) return { exchanges: [], linkDelayHistory: [], linkDelayMean: null, linkDelayStd: null, spikes: 0 }
        const exchange = { seqId: ptp.sequenceId, t1_ns: lastResp.t1_ns || 0, t2_ns, t3_ns, turnaround: turnaroundFull, correction: (lastResp.correction || 0) + (ptp.correction || 0), time: timeStr }
        const newExchanges = [...prev.exchanges, exchange].slice(-30)
        const newLinkDelays = [...prev.linkDelayHistory, turnaroundFull].slice(-FEATURE_WINDOW)
        const linkDelayMean = mean(newLinkDelays)
        const linkDelayStd = std(newLinkDelays)
        let spikes = prev.spikes
        if (linkDelayStd > 0 && Math.abs(turnaroundFull) < 1e9 && Math.abs(turnaroundFull - linkDelayMean) > 3 * linkDelayStd) spikes++
        return { exchanges: newExchanges, linkDelayHistory: newLinkDelays, linkDelayMean, linkDelayStd, spikes }
      })

      setPtpFeatures(prev => ({ ...prev, pdelay_gap_history: [...prev.pdelay_gap_history, pdelayGap].slice(-FEATURE_WINDOW) }))
      state.lastPdelayReq = null
      state.lastPdelayResp = null
    }
  }, [offsetModel, ptpFeatures.t1_ns_history, ptpFeatures.delta_t1_jitter])

  useEffect(() => {
    const slaveDevice = devices.find(d => d.host === '10.42.0.12')
    const currentOffset = boardStatus[slaveDevice?.id]?.ptp?.offset
    const currentD = boardStatus[slaveDevice?.id]?.ptp?.meanLinkDelay
    if (currentOffset !== undefined && currentOffset !== null) {
      const now = Date.now()
      if (currentD) {
        const d_ns = currentD / 65536
        setPtpFeatures(prev => ({ ...prev, d_history: [...prev.d_history, d_ns].slice(-FEATURE_WINDOW) }))
      }
      let currentMae = null
      if (offsetEstimates.length > 0) {
        const recentEstimates = offsetEstimates.slice(-8).map(e => e.offset_hat)
        const actualArr = recentEstimates.map(() => currentOffset)
        currentMae = mae(actualArr, recentEstimates)
      }
      setOffsetModel(prev => ({
        baseline: currentOffset, baselineTime: now, residualScale: 0, samples: prev.samples + 1,
        maeHistory: currentMae !== null ? [...prev.maeHistory, { time: now, mae: Math.round(currentMae) }].slice(-20) : prev.maeHistory
      }))
    }
  }, [boardStatus, devices, offsetEstimates])

  const startTapCapture = async () => {
    try {
      await axios.post('/api/capture/start', { interfaces: [TAP_INTERFACE], captureMode: 'ptp' })
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

  const clearAll = () => {
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
  }

  const autoSetup = async () => {
    const gmDevice = devices.find(d => d.host === '10.42.0.11' || d.name.includes('#1'))
    const slaveDevice = devices.find(d => d.host === '10.42.0.12' || d.name.includes('#2'))

    if (!gmDevice || !slaveDevice) {
      setAutoSetupStatus('error')
      setAutoSetupMessage('Both Board 1 (GM) and Board 2 (Slave) must be configured')
      return
    }

    setAutoSetupStatus('running')
    setAutoSetupMessage('Applying GM profile to Board 1...')

    try {
      // Step 1: Apply GM profile to Board 1
      await axios.post(`/api/ptp/apply/${gmDevice.host}`, { profile: 'gm', portIndex: 8 }, { timeout: 30000 })
      setAutoSetupMessage('Saving Board 1 config...')

      // Step 2: Save Board 1 config
      await axios.post(`/api/ptp/save/${gmDevice.host}`, {}, { timeout: 30000 })
      setAutoSetupMessage('Applying Bridge profile to Board 2...')

      // Step 3: Apply Bridge/Slave profile to Board 2
      await axios.post(`/api/ptp/apply/${slaveDevice.host}`, { profile: 'bridge', portIndex: 8 }, { timeout: 30000 })
      setAutoSetupMessage('Saving Board 2 config...')

      // Step 4: Save Board 2 config
      await axios.post(`/api/ptp/save/${slaveDevice.host}`, {}, { timeout: 30000 })

      setAutoSetupStatus('success')
      setAutoSetupMessage('PTP setup completed. Both boards configured and saved.')

      // Refresh status after setup
      setTimeout(() => {
        fetchAll()
        setTimeout(() => {
          setAutoSetupStatus(null)
          setAutoSetupMessage('')
        }, 3000)
      }, 1000)
    } catch (err) {
      setAutoSetupStatus('error')
      setAutoSetupMessage(`Setup failed: ${err.response?.data?.error || err.message}`)
    }
  }

  const servoStateText = (state) => ({ 0: 'Init', 1: 'Tracking', 2: 'Locked', 3: 'Holdover' }[state] ?? '-')

  const board1 = devices.find(d => d.host === '10.42.0.11' || d.name.includes('#1'))
  const board2 = devices.find(d => d.host === '10.42.0.12' || d.name.includes('#2'))
  const board1Status = board1 ? boardStatus[board1.id] : null
  const board2Status = board2 ? boardStatus[board2.id] : null
  const isSynced = board1Status?.online && board2Status?.online && board1Status?.ptp?.isGM && board2Status?.ptp?.portState === 'slave' && board2Status?.ptp?.servoState >= 1

  const getOffsetStats = () => {
    const offsets = offsetHistory.map(h => h[board2?.name]).filter(v => v !== undefined && v !== null)
    if (offsets.length === 0) return null
    const avg = offsets.reduce((a, b) => a + b, 0) / offsets.length
    const max = Math.max(...offsets.map(Math.abs))
    return { avg: avg.toFixed(0), max, count: offsets.length }
  }

  const offsetStats = getOffsetStats()

  // Styles
  const statBox = { padding: '10px 12px', background: colors.bg, borderRadius: '4px', border: `1px solid ${colors.border}` }
  const statLabel = { fontSize: '0.6rem', color: colors.textMuted, marginBottom: '2px', textTransform: 'uppercase', letterSpacing: '0.02em' }
  const statValue = { fontWeight: '600', fontSize: '0.85rem', fontFamily: 'ui-monospace, monospace', color: colors.text }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">PTP Dashboard</h1>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          {autoSetupStatus && (
            <div style={{
              padding: '4px 10px',
              borderRadius: '4px',
              fontSize: '0.75rem',
              background: autoSetupStatus === 'running' ? colors.bgAlt : autoSetupStatus === 'success' ? '#dcfce7' : '#fef2f2',
              color: autoSetupStatus === 'running' ? colors.textMuted : autoSetupStatus === 'success' ? '#166534' : colors.error,
              border: `1px solid ${autoSetupStatus === 'running' ? colors.border : autoSetupStatus === 'success' ? '#bbf7d0' : '#fecaca'}`,
              maxWidth: '300px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}>
              {autoSetupStatus === 'running' && <span style={{ marginRight: '6px' }}>⏳</span>}
              {autoSetupStatus === 'success' && <span style={{ marginRight: '6px' }}>✓</span>}
              {autoSetupStatus === 'error' && <span style={{ marginRight: '6px' }}>✕</span>}
              {autoSetupMessage}
            </div>
          )}
          <select value={refreshInterval} onChange={(e) => setRefreshInterval(parseInt(e.target.value))}
            style={{ padding: '6px 10px', borderRadius: '4px', border: `1px solid ${colors.border}`, fontSize: '0.8rem', background: '#fff' }}>
            <option value={3000}>3s</option>
            <option value={5000}>5s</option>
            <option value={10000}>10s</option>
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', cursor: 'pointer', color: colors.textMuted }}>
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            Auto
          </label>
          <button className="btn btn-secondary" onClick={fetchAll} disabled={loading}>{loading ? '...' : 'Refresh'}</button>
          <button
            className="btn btn-primary"
            onClick={autoSetup}
            disabled={autoSetupStatus === 'running' || devices.length < 2}
            title="Apply GM to Board 1, Slave to Board 2, and save to startup-config"
            style={{ fontSize: '0.8rem' }}
          >
            {autoSetupStatus === 'running' ? 'Setting...' : 'Auto Setup'}
          </button>
        </div>
      </div>

      {/* Topology */}
      <div className="card" style={{ marginBottom: '16px', padding: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '48px' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: '140px', height: '80px', border: `2px solid ${board1Status?.online ? colors.accent : colors.border}`,
              borderRadius: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              background: '#fff'
            }}>
              <div style={{ fontWeight: '600', fontSize: '0.9rem', color: colors.text }}>Board 1</div>
              <div style={{ fontSize: '0.7rem', color: colors.textMuted }}>LAN9692</div>
              {board1Status?.ptp?.isGM && (
                <div style={{ fontSize: '0.65rem', background: colors.accent, color: '#fff', padding: '2px 8px', borderRadius: '4px', marginTop: '4px' }}>GM</div>
              )}
            </div>
            <div style={{ fontSize: '0.7rem', color: colors.textMuted, marginTop: '6px' }}>{board1?.host || '10.42.0.11'}</div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
            <div style={{ fontSize: '0.7rem', color: colors.textMuted }}>Port 8 - Port 8</div>
            <div style={{ width: '80px', height: '2px', background: isSynced ? colors.success : colors.border, borderRadius: '1px' }} />
            <div style={{ fontSize: '0.75rem', color: isSynced ? colors.success : colors.textLight, fontWeight: '500' }}>
              {isSynced ? 'SYNCED' : 'NOT SYNCED'}
            </div>
            {isSynced && board2Status?.ptp?.offset !== null && (
              <div style={{ fontSize: '0.7rem', color: colors.text, fontFamily: 'monospace' }}>{board2Status.ptp.offset} ns</div>
            )}
          </div>

          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: '140px', height: '80px', border: `2px solid ${board2Status?.online ? colors.accent : colors.border}`,
              borderRadius: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              background: '#fff'
            }}>
              <div style={{ fontWeight: '600', fontSize: '0.9rem', color: colors.text }}>Board 2</div>
              <div style={{ fontSize: '0.7rem', color: colors.textMuted }}>LAN9692</div>
              {board2Status?.ptp?.portState === 'slave' && (
                <div style={{ fontSize: '0.65rem', background: colors.accent, color: '#fff', padding: '2px 8px', borderRadius: '4px', marginTop: '4px' }}>SLAVE</div>
              )}
            </div>
            <div style={{ fontSize: '0.7rem', color: colors.textMuted, marginTop: '6px' }}>{board2?.host || '10.42.0.12'}</div>
          </div>
        </div>
      </div>

      {/* Board Status Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
        {devices.map((device) => {
          const status = boardStatus[device.id]
          const ptp = status?.ptp
          return (
            <div key={device.id} className="card">
              <div className="card-header">
                <h2 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: status?.online ? colors.success : colors.error }} />
                  {device.name}
                  {status?.online && ptp && (
                    <span style={{ fontSize: '0.65rem', padding: '2px 6px', borderRadius: '3px', background: colors.bgAlt, color: colors.textMuted }}>
                      {ptp.isGM ? 'GM' : ptp.portState?.toUpperCase() || '-'}
                    </span>
                  )}
                </h2>
              </div>
              {status?.online && ptp ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                  <div style={statBox}><div style={statLabel}>Profile</div><div style={statValue}>{ptp.profile || '-'}</div></div>
                  <div style={statBox}><div style={statLabel}>AS-Capable</div><div style={{ ...statValue, color: ptp.asCapable ? colors.success : colors.textLight }}>{ptp.asCapable ? 'Yes' : 'No'}</div></div>
                  <div style={statBox}><div style={statLabel}>Servo</div><div style={statValue}>{servoStateText(ptp.servoState)}</div></div>
                  <div style={{ ...statBox, gridColumn: '1 / -1', background: colors.bgAlt }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div><div style={statLabel}>Offset</div><div style={{ fontWeight: '600', fontSize: '1.1rem', fontFamily: 'monospace', color: colors.text }}>{ptp.offset !== null ? `${ptp.offset} ns` : '-'}</div></div>
                      <div style={{ textAlign: 'right' }}><div style={statLabel}>Link Delay</div><div style={{ fontWeight: '500', fontSize: '0.85rem', fontFamily: 'monospace', color: colors.textMuted }}>{ptp.meanLinkDelay ? `${(ptp.meanLinkDelay / 65536).toFixed(0)} ns` : '-'}</div></div>
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ padding: '24px', textAlign: 'center', color: colors.textLight }}>{status?.error || 'Connecting...'}</div>
              )}
            </div>
          )
        })}
      </div>

      {/* Offset Graph */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Offset History</h2>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            {offsetStats && <div style={{ fontSize: '0.7rem', color: colors.textMuted }}>Avg: <b>{offsetStats.avg}ns</b> | Max: <b>±{offsetStats.max}ns</b></div>}
            <button className="btn btn-secondary" onClick={() => setOffsetHistory([])} style={{ fontSize: '0.7rem', padding: '4px 8px' }}>Clear</button>
          </div>
        </div>
        <div style={{ height: '200px' }}>
          {offsetHistory.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={offsetHistory} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={colors.border} />
                <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke={colors.textLight} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} stroke={colors.textLight} domain={['auto', 'auto']} label={{ value: 'ns', angle: -90, position: 'insideLeft', fontSize: 10 }} />
                <Tooltip contentStyle={{ fontSize: '0.75rem', background: '#fff', border: `1px solid ${colors.border}` }} formatter={(value) => [`${value} ns`, 'Offset']} />
                <ReferenceLine y={0} stroke={colors.textLight} strokeDasharray="3 3" />
                {devices.map((device) => (
                  <Line key={device.id} type="monotone" dataKey={device.name} stroke={colors.accent} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: colors.textLight, fontSize: '0.85rem' }}>
              {autoRefresh ? 'Collecting data...' : 'Enable auto-refresh'}
            </div>
          )}
        </div>
      </div>

      {/* PTP Tap Monitor */}
      <div className="card" style={{ marginTop: '16px' }}>
        <div className="card-header">
          <h2 className="card-title">PTP Tap Monitor</h2>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ fontSize: '0.7rem', color: colors.textMuted, fontFamily: 'monospace' }}>{TAP_INTERFACE}</span>
            <span style={{ padding: '3px 8px', borderRadius: '4px', fontSize: '0.7rem', background: tapConnected ? colors.bgAlt : '#fef2f2', color: tapConnected ? colors.textMuted : colors.error }}>
              {tapConnected ? 'Connected' : 'Disconnected'}
            </span>
            {!tapCapturing ? (
              <button className="btn btn-primary" onClick={startTapCapture} disabled={!tapConnected} style={{ fontSize: '0.75rem', padding: '4px 12px' }}>Start</button>
            ) : (
              <button className="btn btn-secondary" onClick={stopTapCapture} style={{ fontSize: '0.75rem', padding: '4px 12px' }}>Stop</button>
            )}
            <button className="btn btn-secondary" onClick={clearAll} style={{ fontSize: '0.75rem', padding: '4px 12px' }}>Clear</button>
          </div>
        </div>

        {tapCapturing ? (
          <div>
            {/* Board Reference Values */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '20px', padding: '12px', background: colors.bgAlt, borderRadius: '6px' }}>
              <div><div style={statLabel}>Board Offset</div><div style={{ ...statValue, fontSize: '1rem' }}>{board2Status?.ptp?.offset ?? '-'} ns</div></div>
              <div><div style={statLabel}>Link Delay (Board)</div><div style={statValue}>{board2Status?.ptp?.meanLinkDelay ? (board2Status.ptp.meanLinkDelay / 65536).toFixed(0) : '-'} ns</div></div>
              <div><div style={statLabel}>Correction (C)</div><div style={statValue}>{syncPairs[syncPairs.length - 1]?.totalCorr ?? 0} ns</div></div>
              <div><div style={statLabel}>Servo State</div><div style={statValue}>{servoStateText(board2Status?.ptp?.servoState)}</div></div>
            </div>

            {/* Section 1: PTP Structure */}
            <Section
              title="PTP Structure"
              description="gPTP(IEEE 802.1AS) 프로토콜이 형식적으로 정상 동작하는지 검증"
              badge={ptpStructure?.seqGaps?.length > 0 ? `${ptpStructure.seqGaps.length} gaps` : null}
              note="Sequence Gap은 네트워크 오류가 아닌 PCAP 캡처 손실(USB NIC, OS 스케줄링)일 가능성이 높음"
            >
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '8px' }}>
                <div style={statBox}><div style={statLabel}>Domain</div><div style={statValue}>{ptpStructure?.domainNumber ?? '-'}</div></div>
                <div style={statBox}><div style={statLabel}>2-Step</div><div style={statValue}>{ptpStructure?.twoStepFlag === true ? 'Yes' : ptpStructure?.twoStepFlag === false ? 'No' : '-'}</div></div>
                <div style={statBox}><div style={statLabel}>Sync Period</div><div style={statValue}>{logPeriodToString(ptpStructure?.logSyncInterval)}</div></div>
                <div style={statBox}><div style={statLabel}>Pdelay Period</div><div style={statValue}>{logPeriodToString(ptpStructure?.logPdelayInterval)}</div></div>
                <div style={statBox}><div style={statLabel}>Messages</div><div style={statValue}>{ptpStructure?.totalMessages || 0}</div></div>
                <div style={statBox}><div style={statLabel}>Seq Gaps</div><div style={{ ...statValue, color: ptpStructure?.seqGaps?.length > 0 ? colors.warning : colors.text }}>{ptpStructure?.seqGaps?.length || 0}</div></div>
              </div>
            </Section>

            {/* Section 2: Sync Period & Jitter */}
            <Section
              title="Sync Period & Jitter"
              description="Grandmaster(GM)가 Sync를 얼마나 정확하고 안정적으로 송신하는지 측정"
              note="μs 단위 지터는 하드웨어 GM + 캡처 환경에서 정상 범위. GM 타이밍 생성 안정성을 나타냄"
            >
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                <div style={statBox}><div style={statLabel}>Period (mean)</div><div style={statValue}>{syncStats?.periodMean ? `${(syncStats.periodMean / 1_000_000).toFixed(3)} ms` : '-'}</div></div>
                <div style={statBox}><div style={statLabel}>Period (std)</div><div style={statValue}>{syncStats?.periodStd ? `${(syncStats.periodStd / 1000).toFixed(1)} μs` : '-'}</div></div>
                <div style={statBox}><div style={statLabel}>Jitter (mean)</div><div style={statValue}>{syncStats?.jitterMean != null ? `${(syncStats.jitterMean / 1000).toFixed(1)} μs` : '-'}</div></div>
                <div style={statBox}><div style={statLabel}>Jitter (max)</div><div style={statValue}>{syncStats?.jitterMax ? `±${(syncStats.jitterMax / 1000).toFixed(1)} μs` : '-'}</div></div>
              </div>
            </Section>

            {/* Section 3: Rate Ratio & Drift */}
            <Section
              title="Rate Ratio & Drift"
              description="GM과 Slave 클럭의 속도(주파수) 차이 분석"
              note={driftStats?.driftDirection === 'stable' ? 'Stable: 주파수 차이가 사실상 없음. 서보가 완전히 수렴된 상태' : driftStats?.driftDirection === 'fast' ? 'Fast: GM 클럭이 더 빠름' : driftStats?.driftDirection === 'slow' ? 'Slow: Slave 클럭이 더 빠름' : '클럭 간 주파수 비율을 측정 중...'}
            >
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                <div style={statBox}><div style={statLabel}>Rate Ratio</div><div style={statValue}>{driftStats?.rateRatio ?? '-'}</div></div>
                <div style={statBox}><div style={statLabel}>PPM Drift</div><div style={statValue}>{driftStats?.ppm ? `${driftStats.ppm} ppm` : '-'}</div></div>
                <div style={statBox}><div style={statLabel}>Direction</div><div style={{ ...statValue, color: driftStats?.driftDirection === 'stable' ? colors.success : colors.text }}>{driftStats?.driftDirection === 'fast' ? 'Fast' : driftStats?.driftDirection === 'slow' ? 'Slow' : driftStats?.driftDirection === 'stable' ? 'Stable' : '-'}</div></div>
              </div>
            </Section>

            {/* Section 4: Pdelay Analysis */}
            <Section
              title="Pdelay Analysis"
              description="Peer Delay 메시지가 정상적으로 교환되고 있는지 확인"
              badge={pdelayDetails?.spikes > 0 ? `${pdelayDetails.spikes} spikes` : null}
              note="Turnaround(t3-t2)은 PCAP에서 참고용으로만 표시됨. 클럭 기준이 달라 물리적 의미 없음. 정확한 Link Delay는 Board 값 사용"
              noteType="warning"
            >
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                <div style={statBox}><div style={statLabel}>t2 (Req Receipt)</div><div style={{ ...statValue, fontSize: '0.75rem' }}>{pdelayInfo?.t2_sec != null ? `${pdelayInfo.t2_sec}.${String(pdelayInfo.t2_ns || 0).padStart(9, '0').slice(0, 6)}` : '-'}</div></div>
                <div style={statBox}><div style={statLabel}>t3 (Resp Origin)</div><div style={{ ...statValue, fontSize: '0.75rem' }}>{pdelayInfo?.t3_sec != null ? `${pdelayInfo.t3_sec}.${String(pdelayInfo.t3_ns || 0).padStart(9, '0').slice(0, 6)}` : '-'}</div></div>
                <div style={{ ...statBox, background: colors.bgWarm, borderColor: '#fde68a' }}><div style={statLabel}>Turnaround (ref only)</div><div style={{ ...statValue, fontSize: '0.8rem', color: '#92400e' }}>{pdelayInfo?.turnaround != null ? (Math.abs(pdelayInfo.turnaround) < 1e9 ? `${(pdelayInfo.turnaround / 1000).toFixed(1)} μs` : 'N/A') : '-'}</div></div>
                <div style={statBox}><div style={statLabel}>Exchanges</div><div style={statValue}>{pdelayInfo?.count || 0}</div></div>
              </div>
            </Section>

            {/* Section 5: Feature Extraction */}
            <Section
              title="Feature Extraction"
              description="PCAP으로부터 추출한 분석용 Feature. Offset 추정 보조용"
              badge={`${offsetModel.samples} samples`}
              note="이 영역은 Offset 복원 계산이 아닌 설명/보조 분석용. 안정 상태에서는 Baseline만으로 충분"
            >
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                <div style={statBox}><div style={statLabel}>Baseline (Board)</div><div style={statValue}>{offsetModel.baseline} ns</div></div>
                <div style={statBox}><div style={statLabel}>Jitter (std)</div><div style={statValue}>{ptpFeatures.delta_t1_jitter.length > 2 ? (std(removeOutliers(ptpFeatures.delta_t1_jitter, 5_000_000)) / 1000).toFixed(1) : '-'} μs</div></div>
                <div style={statBox}><div style={statLabel}>Pdelay Gap (std)</div><div style={statValue}>{ptpFeatures.pdelay_gap_history.length > 2 ? (std(ptpFeatures.pdelay_gap_history) / 1000).toFixed(1) : '-'} μs</div></div>
                <div style={statBox}><div style={statLabel}>MAE</div><div style={statValue}>{offsetModel.maeHistory.length > 0 ? `${offsetModel.maeHistory[offsetModel.maeHistory.length - 1].mae} ns` : '-'}</div></div>
              </div>
            </Section>

            {/* Offset Estimation Graph */}
            {offsetEstimates.length > 2 && (
              <Section
                title="Offset Estimation"
                description="Board에서 보고된 Baseline을 기준으로 한 Offset 추이"
              >
                <div style={{ height: '150px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={offsetEstimates.slice(-60)} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={colors.border} />
                      <XAxis dataKey="time" tick={{ fontSize: 9 }} stroke={colors.textLight} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 9 }} stroke={colors.textLight} domain={['auto', 'auto']} />
                      <Tooltip contentStyle={{ fontSize: '0.7rem' }} formatter={(value, name) => [`${value} ns`, name]} />
                      <ReferenceLine y={0} stroke={colors.textLight} strokeDasharray="3 3" />
                      <Line type="monotone" dataKey="baseline" name="Baseline" stroke={colors.textLight} strokeWidth={1} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
                      <Line type="monotone" dataKey="offset_hat" name="Estimated" stroke={colors.accent} strokeWidth={2} dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Section>
            )}

            {/* Raw Evidence Tables */}
            <Section
              title="Raw Evidence"
              description="실제 캡처된 메시지를 그대로 보여주는 증거. t1(GM 송신 시각)은 패킷에서 확보 가능하나, t2(Slave 수신)는 내부 값으로 PCAP에서 확인 불가"
            >
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <div style={{ fontSize: '0.7rem', fontWeight: '600', color: colors.textMuted, marginBottom: '6px' }}>Recent Messages ({ptpPackets.length})</div>
                  <div style={{ height: '140px', overflow: 'auto', fontSize: '0.65rem', fontFamily: 'ui-monospace, monospace', background: colors.bg, borderRadius: '4px', padding: '8px', border: `1px solid ${colors.border}` }}>
                    {ptpPackets.length === 0 ? (
                      <div style={{ color: colors.textLight, textAlign: 'center', padding: '40px' }}>Waiting...</div>
                    ) : (
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead><tr style={{ borderBottom: `1px solid ${colors.border}`, color: colors.textMuted }}><th style={{ textAlign: 'left', padding: '3px' }}>Type</th><th style={{ textAlign: 'left', padding: '3px' }}>Seq</th><th style={{ textAlign: 'right', padding: '3px' }}>Timestamp</th></tr></thead>
                        <tbody>
                          {ptpPackets.slice(-12).reverse().map((pkt, i) => (
                            <tr key={i} style={{ borderBottom: `1px solid ${colors.borderLight}` }}>
                              <td style={{ padding: '2px 3px', color: colors.text }}>{pkt.ptp?.msgType}</td>
                              <td style={{ padding: '2px 3px', color: colors.textMuted }}>{pkt.ptp?.sequenceId}</td>
                              <td style={{ padding: '2px 3px', textAlign: 'right', color: colors.textMuted }}>{pkt.ptp?.timestamp?.nanoseconds?.toLocaleString() || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '0.7rem', fontWeight: '600', color: colors.textMuted, marginBottom: '6px' }}>Sync Pairs ({syncPairs.length})</div>
                  <div style={{ height: '140px', overflow: 'auto', fontSize: '0.6rem', fontFamily: 'ui-monospace, monospace', background: colors.bg, borderRadius: '4px', padding: '8px', border: `1px solid ${colors.border}` }}>
                    {syncPairs.length === 0 ? (
                      <div style={{ color: colors.textLight, textAlign: 'center', padding: '40px' }}>Waiting...</div>
                    ) : (
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead><tr style={{ borderBottom: `1px solid ${colors.border}`, color: colors.textMuted }}><th style={{ textAlign: 'left', padding: '2px' }}>Seq</th><th style={{ textAlign: 'right', padding: '2px' }}>t1 (ns)</th><th style={{ textAlign: 'right', padding: '2px' }}>C_total</th></tr></thead>
                        <tbody>
                          {syncPairs.slice(-10).reverse().map((pair, i) => (
                            <tr key={i} style={{ borderBottom: `1px solid ${colors.borderLight}` }}>
                              <td style={{ padding: '2px', color: colors.text }}>{pair.sequenceId}</td>
                              <td style={{ padding: '2px', textAlign: 'right', color: colors.textMuted }}>{pair.t1_ns?.toLocaleString()}</td>
                              <td style={{ padding: '2px', textAlign: 'right', color: colors.text }}>{pair.totalCorr || 0}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </div>
            </Section>

            {/* Formula Reference */}
            <div style={{ padding: '12px 14px', background: colors.bgAlt, borderRadius: '6px', fontSize: '0.7rem', color: colors.textMuted, lineHeight: 1.6, border: `1px solid ${colors.border}` }}>
              <div style={{ marginBottom: '6px' }}><b>PTP Offset Formula:</b> offset = (t2 - t1) - d - C</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', fontSize: '0.65rem' }}>
                <div><b>t1:</b> GM Sync TX (Follow_Up)</div>
                <div><b>t2:</b> Slave Sync RX (internal)</div>
                <div><b>d:</b> Link Delay (Pdelay)</div>
                <div><b>C:</b> Correction Field</div>
              </div>
              <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: `1px solid ${colors.border}`, fontSize: '0.6rem', color: colors.textLight }}>
                PCAP에서는 t1, C만 확인 가능. t2는 Slave 내부 HW 타임스탬프로 PCAP에서 관측 불가하므로 절대 Offset 계산에 PCAP을 사용할 수 없음
              </div>
            </div>
          </div>
        ) : (
          <div style={{ padding: '40px', textAlign: 'center', color: colors.textLight }}>Click "Start" to begin PTP monitoring</div>
        )}
      </div>
    </div>
  )
}

export default Dashboard
