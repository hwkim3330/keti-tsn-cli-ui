import { useState, useEffect, useRef, useMemo } from 'react'
import axios from 'axios'
import { useDevices } from '../contexts/DeviceContext'

const TAP_INTERFACE = 'enxc84d44231cc2'
const TRAFFIC_INTERFACE = 'enx00e04c681336'
const BOARD2_PORT8_MAC = 'FA:AE:C9:26:A4:08'
const TRAFFIC_API = 'http://localhost:3001'
const PACKET_SIZE = 64 * 8  // bits
const LINK_SPEED = 1000000  // kbps (1Gbps)

const colors = {
  text: '#1f2937',
  textMuted: '#6b7280',
  textLight: '#9ca3af',
  bg: '#f9fafb',
  bgAlt: '#f3f4f6',
  border: '#e5e7eb',
  success: '#059669',
  warning: '#d97706',
  error: '#dc2626',
  tx: '#3b82f6',
  rx: '#10b981',
  shaping: '#ef4444',
  credit: '#8b5cf6',
}

const tcColors = [
  '#94a3b8', '#64748b', '#475569', '#334155',
  '#1e3a5f', '#1e40af', '#3730a3', '#4c1d95'
]

// Credit 시계열 그래프 컴포넌트
const CreditGraph = ({ creditHistory, selectedTCs, maxTime, shapingEvents }) => {
  const width = 800
  const height = 280
  const padding = { top: 30, right: 20, bottom: 40, left: 70 }
  const chartW = width - padding.left - padding.right
  const chartH = height - padding.top - padding.bottom

  // Y축 범위 계산 (credit 값)
  const { minCredit, maxCredit } = useMemo(() => {
    if (!creditHistory.length) return { minCredit: -1000, maxCredit: 1000 }
    let min = 0, max = 0
    creditHistory.forEach(entry => {
      selectedTCs.forEach(tc => {
        const val = entry.credit[tc] || 0
        if (val < min) min = val
        if (val > max) max = val
      })
    })
    // 여유 마진 추가
    const range = Math.max(Math.abs(min), Math.abs(max), 500)
    return { minCredit: -range * 1.2, maxCredit: range * 1.2 }
  }, [creditHistory, selectedTCs])

  const xScale = (time) => padding.left + (time / maxTime) * chartW
  const yScale = (val) => {
    const range = maxCredit - minCredit
    return padding.top + chartH - ((val - minCredit) / range) * chartH
  }

  // X축 틱 (1초 단위)
  const xTicks = useMemo(() => {
    const ticks = []
    for (let i = 0; i <= maxTime; i += 1000) ticks.push(i)
    return ticks
  }, [maxTime])

  // Y축 틱
  const yTicks = useMemo(() => {
    const range = maxCredit - minCredit
    const step = Math.ceil(range / 6 / 100) * 100
    const ticks = []
    for (let v = Math.floor(minCredit / step) * step; v <= maxCredit; v += step) {
      ticks.push(v)
    }
    return ticks
  }, [minCredit, maxCredit])

  // 0 라인 위치
  const zeroY = yScale(0)

  return (
    <div style={{ background: '#fff', border: `1px solid ${colors.border}`, borderRadius: '6px', padding: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontWeight: '600', fontSize: '0.9rem' }}>Credit Evolution (Real-time)</span>
          <div style={{ display: 'flex', gap: '8px' }}>
            {selectedTCs.map(tc => (
              <span key={tc} style={{ fontSize: '0.65rem', padding: '2px 6px', borderRadius: '3px', background: `${tcColors[tc]}20`, color: tcColors[tc], fontWeight: '600' }}>
                TC{tc}
              </span>
            ))}
          </div>
        </div>
        <div style={{ fontSize: '0.7rem', color: colors.textMuted }}>
          <span style={{ color: colors.error }}>■</span> Shaping Zone (credit {'<'} 0)
        </div>
      </div>

      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
        {/* Shaping Zone (credit < 0) */}
        <rect x={padding.left} y={zeroY} width={chartW} height={padding.top + chartH - zeroY}
          fill={colors.error} opacity="0.08" />

        {/* Y축 그리드 */}
        {yTicks.map(tick => (
          <g key={tick}>
            <line x1={padding.left} y1={yScale(tick)} x2={width - padding.right} y2={yScale(tick)}
              stroke={tick === 0 ? colors.text : colors.border} strokeWidth={tick === 0 ? 1.5 : 0.5}
              strokeDasharray={tick === 0 ? '' : '3,3'} />
            <text x={padding.left - 8} y={yScale(tick)} textAnchor="end" alignmentBaseline="middle"
              fontSize="9" fill={colors.textMuted} fontFamily="monospace">
              {tick >= 0 ? `+${tick}` : tick}
            </text>
          </g>
        ))}

        {/* X축 그리드 */}
        {xTicks.map(tick => (
          <g key={tick}>
            <line x1={xScale(tick)} y1={padding.top} x2={xScale(tick)} y2={height - padding.bottom}
              stroke={colors.border} strokeWidth="0.5" strokeDasharray="3,3" />
            <text x={xScale(tick)} y={height - padding.bottom + 14} textAnchor="middle"
              fontSize="9" fill={colors.textMuted}>{tick / 1000}s</text>
          </g>
        ))}

        {/* Shaping 이벤트 마커 */}
        {shapingEvents.map((event, i) => (
          <g key={i}>
            <line x1={xScale(event.time)} y1={padding.top} x2={xScale(event.time)} y2={height - padding.bottom}
              stroke={event.type === 'enter' ? colors.error : colors.success} strokeWidth="1.5" strokeDasharray="4,2" />
            <circle cx={xScale(event.time)} cy={yScale(0)} r="4"
              fill={event.type === 'enter' ? colors.error : colors.success} />
            <text x={xScale(event.time)} y={padding.top - 8} textAnchor="middle" fontSize="8"
              fill={event.type === 'enter' ? colors.error : colors.success} fontWeight="600">
              {event.type === 'enter' ? 'SHAPE' : 'EXIT'}
            </text>
          </g>
        ))}

        {/* Credit 라인 (TC별) */}
        {selectedTCs.map(tc => {
          if (creditHistory.length < 2) return null
          const points = creditHistory.map(entry => ({
            x: xScale(entry.time),
            y: yScale(entry.credit[tc] || 0)
          }))
          const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')

          return (
            <g key={tc}>
              {/* 라인 */}
              <path d={pathD} fill="none" stroke={tcColors[tc]} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              {/* 현재 포인트 */}
              {points.length > 0 && (
                <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y}
                  r="4" fill={tcColors[tc]} stroke="#fff" strokeWidth="1.5" />
              )}
            </g>
          )
        })}

        {/* 축 테두리 */}
        <rect x={padding.left} y={padding.top} width={chartW} height={chartH}
          fill="none" stroke={colors.border} strokeWidth="1" />

        {/* 라벨 */}
        <text x={12} y={height / 2} textAnchor="middle" fontSize="10" fill={colors.textMuted}
          transform={`rotate(-90, 12, ${height / 2})`}>Credit (bits)</text>
        <text x={width / 2} y={height - 5} textAnchor="middle" fontSize="10" fill={colors.textMuted}>Time (seconds)</text>

        {/* 범례 - 0 라인 */}
        <text x={padding.left + 5} y={zeroY - 5} fontSize="9" fill={colors.text} fontWeight="600">Credit = 0</text>
      </svg>

      {/* 현재 Credit 값 */}
      {creditHistory.length > 0 && (
        <div style={{ display: 'flex', gap: '12px', marginTop: '12px', flexWrap: 'wrap' }}>
          {selectedTCs.map(tc => {
            const latest = creditHistory[creditHistory.length - 1]?.credit[tc] || 0
            const isShaping = latest < 0
            return (
              <div key={tc} style={{
                padding: '8px 12px', borderRadius: '4px', fontFamily: 'monospace', fontSize: '0.75rem',
                background: isShaping ? '#fef2f2' : colors.bgAlt,
                border: `1px solid ${isShaping ? colors.error : colors.border}`
              }}>
                <span style={{ color: tcColors[tc], fontWeight: '600' }}>TC{tc}</span>
                <span style={{ marginLeft: '8px', color: isShaping ? colors.error : colors.text, fontWeight: '600' }}>
                  {latest >= 0 ? '+' : ''}{Math.round(latest)} bits
                </span>
                {isShaping && <span style={{ marginLeft: '6px', color: colors.error, fontSize: '0.65rem' }}>SHAPING</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Shaping 분석 컴포넌트
const ShapingAnalysis = ({ shapingEvents, selectedTCs, estimates, duration }) => {
  // TC별 shaping 통계 계산
  const stats = useMemo(() => {
    const result = {}
    selectedTCs.forEach(tc => {
      const tcEvents = shapingEvents.filter(e => e.tc === tc)
      const enterEvents = tcEvents.filter(e => e.type === 'enter')
      const exitEvents = tcEvents.filter(e => e.type === 'exit')

      let totalShapingTime = 0
      enterEvents.forEach((enter, i) => {
        const exit = exitEvents[i]
        if (exit) {
          totalShapingTime += exit.time - enter.time
        } else {
          totalShapingTime += (duration * 1000) - enter.time
        }
      })

      result[tc] = {
        enterCount: enterEvents.length,
        totalShapingTime,
        shapingRatio: duration > 0 ? (totalShapingTime / (duration * 1000)) * 100 : 0,
        firstShaping: enterEvents[0]?.time || null
      }
    })
    return result
  }, [shapingEvents, selectedTCs, duration])

  return (
    <div style={{ background: '#fff', border: `1px solid ${colors.border}`, borderRadius: '6px', padding: '16px' }}>
      <div style={{ fontWeight: '600', fontSize: '0.9rem', marginBottom: '12px' }}>Shaping Analysis</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
        {selectedTCs.filter(tc => estimates[tc]?.isLimited).map(tc => {
          const s = stats[tc] || {}
          const est = estimates[tc]
          const cbsOk = s.enterCount > 0  // CBS가 동작하고 있음

          return (
            <div key={tc} style={{
              padding: '12px', borderRadius: '6px', fontSize: '0.75rem',
              background: cbsOk ? '#fef2f2' : colors.bgAlt,
              border: `2px solid ${tcColors[tc]}`
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ color: tcColors[tc], fontWeight: '700', fontSize: '0.85rem' }}>TC{tc}</span>
                <span style={{
                  padding: '2px 6px', borderRadius: '3px', fontSize: '0.65rem', fontWeight: '600',
                  background: cbsOk ? colors.error : colors.success,
                  color: '#fff'
                }}>
                  {cbsOk ? 'CBS ACTIVE' : 'NO SHAPING'}
                </span>
              </div>

              <div style={{ fontFamily: 'monospace', lineHeight: '1.6' }}>
                <div>Idle Slope: <span style={{ fontWeight: '600' }}>{(est.slope / 1000).toFixed(0)}M</span>bps</div>
                <div>Traffic: <span style={{ fontWeight: '600' }}>{(est.trafficKbps / 1000).toFixed(1)}M</span>bps</div>
                <div style={{ marginTop: '4px', paddingTop: '4px', borderTop: `1px solid ${colors.border}` }}>
                  Shaping Events: <span style={{ fontWeight: '600', color: s.enterCount > 0 ? colors.error : colors.success }}>{s.enterCount}</span>
                </div>
                {s.firstShaping !== null && (
                  <div>First Shaping: <span style={{ fontWeight: '600' }}>{(s.firstShaping / 1000).toFixed(2)}s</span></div>
                )}
                <div>Shaping Ratio: <span style={{ fontWeight: '600', color: s.shapingRatio > 50 ? colors.error : colors.warning }}>{s.shapingRatio.toFixed(1)}%</span></div>
              </div>

              <div style={{ marginTop: '8px', padding: '6px', background: 'rgba(0,0,0,0.03)', borderRadius: '4px', fontSize: '0.7rem' }}>
                {cbsOk ? (
                  <span style={{ color: colors.error }}>
                    Traffic exceeds idle slope → CBS is shaping
                  </span>
                ) : (
                  <span style={{ color: colors.success }}>
                    {est.willShape ? 'CBS should shape but no events detected' : 'Traffic within limit'}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CBSDashboard() {
  const { devices } = useDevices()
  const [cbsData, setCbsData] = useState({})
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState(null)
  const [idleSlope, setIdleSlope] = useState({
    0: LINK_SPEED, 1: 10000, 2: 20000, 3: 30000,
    4: 40000, 5: 50000, 6: 60000, 7: 100000
  })

  const [trafficInterface, setTrafficInterface] = useState(null)
  const [trafficRunning, setTrafficRunning] = useState(false)
  const [selectedTCs, setSelectedTCs] = useState([1, 2, 3, 4, 5, 6, 7])
  const [vlanId, setVlanId] = useState(100)
  const [packetsPerSecond, setPacketsPerSecond] = useState(2000)
  const [duration, setDuration] = useState(5)

  const [tapConnected, setTapConnected] = useState(false)
  const [captureStats, setCaptureStats] = useState(null)
  const [creditHistory, setCreditHistory] = useState([])
  const [shapingEvents, setShapingEvents] = useState([])
  const [startTime, setStartTime] = useState(null)
  const wsRef = useRef(null)
  const creditRef = useRef({})  // 현재 credit 값 추적

  const board1 = devices.find(d => d.name?.includes('#1') || d.device?.includes('ACM0'))
  const board2 = devices.find(d => d.name?.includes('#2') || d.device?.includes('ACM1'))
  const CBS_PORT = 8
  const cbsBoard = board1 || board2

  const getQosPath = (port) => `/ietf-interfaces:interfaces/interface[name='${port}']/mchp-velocitysp-port:eth-qos/config`

  const fetchCBS = async () => {
    if (!cbsBoard) return
    setLoading(true)
    try {
      const res = await axios.post('/api/fetch', {
        paths: [`${getQosPath(CBS_PORT)}/traffic-class-shapers`],
        transport: cbsBoard.transport || 'serial',
        device: cbsBoard.device,
        host: cbsBoard.host,
        port: cbsBoard.port || 5683
      }, { timeout: 10000 })

      const shapers = []
      if (res.data?.result) {
        let current = null
        for (const line of res.data.result.split('\n')) {
          if (line.includes('traffic-class:')) {
            if (current) shapers.push(current)
            current = { tc: parseInt(line.split(':')[1]), idleSlope: 0 }
          } else if (line.includes('idle-slope:') && current) {
            current.idleSlope = parseInt(line.split(':')[1])
          }
        }
        if (current) shapers.push(current)
      }

      const newSlope = { ...idleSlope }
      shapers.forEach(s => { if (s.idleSlope > 0) newSlope[s.tc] = s.idleSlope })
      setIdleSlope(newSlope)
      setCbsData({ online: true, shapers })
    } catch {
      setCbsData({ online: false })
    }
    setLoading(false)
  }

  const applyCBS = async () => {
    if (!cbsBoard) return
    setStatus({ type: 'info', msg: 'Applying...' })
    try {
      const patches = []
      for (let tc = 0; tc < 8; tc++) {
        patches.push({
          path: `${getQosPath(CBS_PORT)}/traffic-class-shapers`,
          value: { 'traffic-class': tc, 'credit-based': { 'idle-slope': idleSlope[tc] || LINK_SPEED } }
        })
      }
      await axios.post('/api/patch', { patches, transport: cbsBoard.transport, device: cbsBoard.device, host: cbsBoard.host }, { timeout: 30000 })
      setStatus({ type: 'success', msg: 'CBS Applied' })
      setTimeout(() => { fetchCBS(); setStatus(null) }, 1500)
    } catch (err) {
      setStatus({ type: 'error', msg: err.message })
    }
  }

  const resetCBS = async () => {
    if (!cbsBoard) return
    setStatus({ type: 'info', msg: 'Resetting...' })
    try {
      const patches = []
      for (let tc = 0; tc < 8; tc++) {
        patches.push({
          path: `${getQosPath(CBS_PORT)}/traffic-class-shapers`,
          value: { 'traffic-class': tc, 'credit-based': { 'idle-slope': LINK_SPEED } }
        })
      }
      await axios.post('/api/patch', { patches, transport: cbsBoard.transport, device: cbsBoard.device, host: cbsBoard.host }, { timeout: 30000 })
      const resetSlope = {}
      for (let tc = 0; tc < 8; tc++) resetSlope[tc] = LINK_SPEED
      setIdleSlope(resetSlope)
      setStatus({ type: 'success', msg: 'CBS Reset' })
      setTimeout(() => { fetchCBS(); setStatus(null) }, 1500)
    } catch (err) {
      setStatus({ type: 'error', msg: err.message })
    }
  }

  useEffect(() => { if (cbsBoard) fetchCBS() }, [cbsBoard])
  useEffect(() => { setTrafficInterface(TRAFFIC_INTERFACE) }, [])

  // WebSocket for capture data
  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/capture`)
      ws.onopen = () => setTapConnected(true)
      ws.onclose = () => { setTapConnected(false); setTimeout(connect, 3000) }
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.type === 'c-capture-stats') {
            setCaptureStats(msg.data)

            // Credit 계산 및 업데이트
            if (startTime) {
              const elapsed = Date.now() - startTime
              updateCredit(msg.data, elapsed)
            }
          } else if (msg.type === 'c-capture-stopped' && msg.stats?.analysis) {
            setCaptureStats(prev => ({ ...prev, final: true, analysis: msg.stats.analysis }))
          }
        } catch {}
      }
      wsRef.current = ws
    }
    connect()
    return () => wsRef.current?.close()
  }, [startTime])

  // Credit 계산 함수
  const updateCredit = (stats, elapsed) => {
    const newCredit = { ...creditRef.current }
    const newEvents = []

    selectedTCs.forEach(tc => {
      const slope = idleSlope[tc] || LINK_SPEED
      const sendSlope = slope - LINK_SPEED  // negative (bits/ms)

      // 현재 TC의 패킷 수
      const currentCount = stats.tc?.[tc]?.count || 0
      const prevEntry = creditHistory[creditHistory.length - 1]
      const prevCount = prevEntry?.packets?.[tc] || 0
      const newPackets = currentCount - prevCount

      // 이전 credit 값
      const prevCredit = creditRef.current[tc] ?? 0

      // 시간 간격 (ms)
      const dt = prevEntry ? elapsed - prevEntry.time : 100

      // Credit 계산
      // 1. Idle time에 credit 회복 (idleSlope rate)
      // 2. 패킷 전송 시 credit 감소 (sendSlope * txTime)
      const idleRecovery = (slope / 1000) * dt  // bits recovered during idle
      const txCost = newPackets * PACKET_SIZE * (1 - slope / LINK_SPEED)  // bits consumed

      let credit = prevCredit + idleRecovery - txCost

      // Credit bounds (hiCredit = max packet size, loCredit = -(max frame size * sendSlope / portRate))
      const hiCredit = PACKET_SIZE
      const loCredit = -PACKET_SIZE * 2

      // Shaping 이벤트 감지
      const wasShaping = prevCredit < 0
      const isShaping = credit < 0

      if (!wasShaping && isShaping) {
        newEvents.push({ type: 'enter', tc, time: elapsed, credit })
      } else if (wasShaping && !isShaping) {
        newEvents.push({ type: 'exit', tc, time: elapsed, credit })
      }

      // Credit bounds 적용
      credit = Math.max(loCredit, Math.min(hiCredit, credit))
      newCredit[tc] = credit
    })

    creditRef.current = newCredit

    // History 업데이트
    setCreditHistory(prev => {
      const entry = {
        time: elapsed,
        credit: { ...newCredit },
        packets: {}
      }
      selectedTCs.forEach(tc => {
        entry.packets[tc] = stats.tc?.[tc]?.count || 0
      })
      return [...prev.slice(-100), entry]
    })

    // Shaping 이벤트 추가
    if (newEvents.length > 0) {
      setShapingEvents(prev => [...prev, ...newEvents])
    }
  }

  const startTest = async () => {
    if (!trafficInterface || selectedTCs.length === 0) return
    setCaptureStats(null)
    setCreditHistory([])
    setShapingEvents([])
    creditRef.current = {}
    selectedTCs.forEach(tc => { creditRef.current[tc] = 0 })

    const now = Date.now()
    setStartTime(now)

    // 초기 credit entry
    const initCredit = {}
    selectedTCs.forEach(tc => { initCredit[tc] = 0 })
    setCreditHistory([{ time: 0, credit: initCredit, packets: {} }])

    try {
      await axios.post('/api/capture/start-c', { interface: TAP_INTERFACE, duration: duration + 2, vlanId })
      await new Promise(r => setTimeout(r, 300))
      setTrafficRunning(true)
      await axios.post(`${TRAFFIC_API}/api/traffic/start-precision`, {
        interface: trafficInterface, dstMac: BOARD2_PORT8_MAC, vlanId, tcList: selectedTCs, packetsPerSecond, duration
      })
      setTimeout(stopTest, (duration + 3) * 1000)
    } catch (err) {
      console.error(err)
      setTrafficRunning(false)
    }
  }

  const stopTest = async () => {
    setTrafficRunning(false)
    try { await axios.post(`${TRAFFIC_API}/api/traffic/stop-precision`, {}) } catch {}
    try { await axios.post('/api/capture/stop-c', {}) } catch {}
  }

  // 크레딧 기반 예상값 계산
  const estimates = useMemo(() => {
    const tcCount = selectedTCs.length || 1
    const ppsPerTc = packetsPerSecond / tcCount
    const trafficKbps = (ppsPerTc * PACKET_SIZE) / 1000

    const result = {}
    for (let tc = 0; tc < 8; tc++) {
      const slope = idleSlope[tc] || LINK_SPEED
      const isLimited = slope < LINK_SPEED
      const willShape = isLimited && trafficKbps > slope

      const sendSlope = slope - LINK_SPEED
      const txTime = PACKET_SIZE / (LINK_SPEED * 1000)
      const creditPerPkt = sendSlope * 1000 * txTime
      const interPktTime = ppsPerTc > 0 ? 1 / ppsPerTc : 0
      const creditRecovery = slope * 1000 * interPktTime
      const netCredit = creditRecovery + creditPerPkt

      result[tc] = {
        slope,
        isLimited,
        trafficKbps,
        willShape,
        expectedKbps: willShape ? slope : trafficKbps,
        creditPerPkt: Math.round(creditPerPkt),
        creditRecovery: Math.round(creditRecovery),
        netCredit: Math.round(netCredit)
      }
    }
    return result
  }, [idleSlope, packetsPerSecond, selectedTCs])

  const formatBw = (kbps) => {
    if (kbps >= 1000000) return `${(kbps / 1000000).toFixed(0)}G`
    if (kbps >= 1000) return `${(kbps / 1000).toFixed(0)}M`
    return `${Math.round(kbps)}k`
  }

  const maxGraphTime = (duration + 2) * 1000
  const card = { background: '#fff', border: `1px solid ${colors.border}`, borderRadius: '6px', marginBottom: '16px' }
  const cardHeader = { padding: '12px 16px', borderBottom: `1px solid ${colors.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }
  const cardBody = { padding: '16px' }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">CBS Dashboard</h1>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {status && <span style={{ fontSize: '0.8rem', padding: '6px 12px', borderRadius: '4px', background: status.type === 'success' ? '#dcfce7' : status.type === 'error' ? '#fef2f2' : colors.bgAlt, color: status.type === 'success' ? colors.success : status.type === 'error' ? colors.error : colors.textMuted }}>{status.msg}</span>}
          <button className="btn btn-secondary" onClick={fetchCBS} disabled={loading}>{loading ? '...' : 'Refresh'}</button>
          <button className="btn btn-primary" onClick={applyCBS} disabled={!cbsBoard}>Apply</button>
          <button className="btn btn-secondary" onClick={resetCBS} disabled={!cbsBoard}>Reset</button>
        </div>
      </div>

      {/* Connection Info */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '16px' }}>
        {[
          { label: 'Board', value: cbsBoard?.name || 'Not Connected', sub: `${cbsBoard?.device || '-'} / Port ${CBS_PORT}` },
          { label: 'TX Interface', value: trafficInterface || 'Not Found', ok: !!trafficInterface },
          { label: 'RX Interface', value: TAP_INTERFACE, ok: tapConnected, sub: tapConnected ? 'Ready' : 'Disconnected' }
        ].map((item, i) => (
          <div key={i} style={{ ...card, marginBottom: 0 }}>
            <div style={cardBody}>
              <div style={{ fontSize: '0.75rem', color: colors.textMuted, fontWeight: '500', marginBottom: '4px' }}>{item.label}</div>
              <div style={{ fontSize: '0.875rem', fontFamily: 'monospace', color: item.ok === false ? colors.error : colors.text }}>{item.value}</div>
              {item.sub && <div style={{ fontSize: '0.75rem', color: item.ok === false ? colors.error : item.ok ? colors.success : colors.textMuted, marginTop: '4px' }}>{item.sub}</div>}
            </div>
          </div>
        ))}
      </div>

      {/* Credit Graph - 실시간 모니터링 */}
      <div style={{ marginBottom: '16px' }}>
        <CreditGraph
          creditHistory={creditHistory}
          selectedTCs={selectedTCs.filter(tc => estimates[tc]?.isLimited)}
          maxTime={maxGraphTime}
          shapingEvents={shapingEvents}
        />
      </div>

      {/* Shaping Analysis */}
      {creditHistory.length > 1 && (
        <div style={{ marginBottom: '16px' }}>
          <ShapingAnalysis
            shapingEvents={shapingEvents}
            selectedTCs={selectedTCs}
            estimates={estimates}
            duration={duration}
          />
        </div>
      )}

      {/* Idle Slope Configuration */}
      <div style={card}>
        <div style={cardHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontWeight: '600' }}>Idle Slope Configuration</span>
            <span style={{ fontSize: '0.75rem', padding: '4px 10px', borderRadius: '4px', background: cbsData.online ? '#dcfce7' : colors.bgAlt, color: cbsData.online ? colors.success : colors.textMuted }}>
              {cbsData.online ? 'CONNECTED' : 'DISCONNECTED'}
            </span>
          </div>
        </div>
        <div style={cardBody}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ background: colors.bgAlt }}>
                <th style={{ padding: '8px', textAlign: 'left' }}>TC</th>
                <th style={{ padding: '8px', width: '140px' }}>Idle Slope (kbps)</th>
                <th style={{ padding: '8px', textAlign: 'center' }}>Bandwidth</th>
                <th style={{ padding: '8px', textAlign: 'center' }}>Net Credit/pkt</th>
                <th style={{ padding: '8px', textAlign: 'center' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {[0,1,2,3,4,5,6,7].map(tc => {
                const est = estimates[tc]
                return (
                  <tr key={tc} style={{ borderBottom: `1px solid ${colors.border}` }}>
                    <td style={{ padding: '8px', color: tcColors[tc], fontWeight: '600' }}>TC{tc}</td>
                    <td style={{ padding: '8px' }}>
                      <input type="number" value={idleSlope[tc] || ''} onChange={e => setIdleSlope(prev => ({ ...prev, [tc]: parseInt(e.target.value) || 0 }))}
                        style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: `1px solid ${colors.border}`, fontFamily: 'monospace', textAlign: 'right' }} />
                    </td>
                    <td style={{ padding: '8px', textAlign: 'center', fontFamily: 'monospace' }}>{formatBw(est.slope)}bps</td>
                    <td style={{ padding: '8px', textAlign: 'center', fontFamily: 'monospace', color: est.netCredit < 0 ? colors.error : colors.success }}>
                      {est.isLimited ? `${est.netCredit > 0 ? '+' : ''}${est.netCredit}` : '-'}
                    </td>
                    <td style={{ padding: '8px', textAlign: 'center' }}>
                      <span style={{ padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: '500', background: est.willShape ? '#fef2f2' : est.isLimited ? '#fef3c7' : '#dcfce7', color: est.willShape ? colors.error : est.isLimited ? colors.warning : colors.success }}>
                        {est.willShape ? 'WILL SHAPE' : est.isLimited ? 'LIMITED' : 'UNLIMITED'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Traffic Test */}
      <div style={card}>
        <div style={cardHeader}>
          <span style={{ fontWeight: '600' }}>Traffic Test</span>
          <div style={{ display: 'flex', gap: '8px' }}>
            {!trafficRunning ? (
              <button className="btn btn-primary" onClick={startTest} disabled={!trafficInterface || !tapConnected || selectedTCs.length === 0}>Start</button>
            ) : (
              <button className="btn" onClick={stopTest} style={{ background: '#fef2f2', color: colors.error, border: '1px solid #fecaca' }}>Stop</button>
            )}
            <button className="btn btn-secondary" onClick={() => { setCaptureStats(null); setCreditHistory([]); setShapingEvents([]) }}>Clear</button>
          </div>
        </div>
        <div style={cardBody}>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
            {[0,1,2,3,4,5,6,7].map(tc => (
              <button key={tc} onClick={() => !trafficRunning && setSelectedTCs(prev => prev.includes(tc) ? prev.filter(t => t !== tc) : [...prev, tc].sort())} disabled={trafficRunning}
                style={{ padding: '8px 16px', borderRadius: '4px', border: `2px solid ${selectedTCs.includes(tc) ? tcColors[tc] : colors.border}`, background: selectedTCs.includes(tc) ? `${tcColors[tc]}15` : '#fff', color: selectedTCs.includes(tc) ? tcColors[tc] : colors.textMuted, fontWeight: '600', cursor: trafficRunning ? 'not-allowed' : 'pointer', opacity: trafficRunning ? 0.6 : 1 }}>
                TC{tc}
              </button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
            {[['VLAN', vlanId, setVlanId], ['PPS', packetsPerSecond, setPacketsPerSecond], ['Duration', duration, setDuration]].map(([label, val, setter]) => (
              <div key={label}>
                <div style={{ fontSize: '0.75rem', color: colors.textMuted, marginBottom: '4px' }}>{label}</div>
                <input type="number" value={val} onChange={e => setter(parseInt(e.target.value) || 0)} disabled={trafficRunning}
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: `1px solid ${colors.border}`, fontFamily: 'monospace' }} />
              </div>
            ))}
          </div>

          {selectedTCs.length > 0 && (
            <div style={{ marginTop: '16px', padding: '12px', background: colors.bgAlt, borderRadius: '4px' }}>
              <div style={{ fontSize: '0.8rem', color: colors.textMuted, fontFamily: 'monospace', marginBottom: '8px' }}>
                {packetsPerSecond} pps ÷ {selectedTCs.length} TC = {Math.round(packetsPerSecond / selectedTCs.length)} pps/TC = {formatBw(estimates[selectedTCs[0]]?.trafficKbps || 0)}bps/TC
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {selectedTCs.map(tc => {
                  const est = estimates[tc]
                  return (
                    <span key={tc} style={{ padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: '600', background: est.willShape ? '#fef2f2' : '#dcfce7', color: est.willShape ? colors.error : colors.success }}>
                      TC{tc}: {est.willShape ? `→${formatBw(est.slope)}` : 'OK'}
                    </span>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Results */}
      {captureStats && (
        <div style={card}>
          <div style={cardHeader}>
            <span style={{ fontWeight: '600' }}>Packet Monitor</span>
            <span style={{ fontSize: '0.8rem', padding: '4px 12px', borderRadius: '4px', background: captureStats.final ? '#dcfce7' : '#fef3c7', color: captureStats.final ? colors.success : colors.warning }}>
              {captureStats.final ? 'Complete' : `${(captureStats.elapsed_ms / 1000).toFixed(1)}s`}
            </span>
          </div>
          <div style={cardBody}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ background: colors.bgAlt }}>
                  <th style={{ padding: '10px', textAlign: 'left' }}>TC</th>
                  <th style={{ padding: '10px', textAlign: 'right' }}>Packets</th>
                  <th style={{ padding: '10px', textAlign: 'right' }}>Throughput</th>
                  <th style={{ padding: '10px', textAlign: 'right' }}>Idle Slope</th>
                  <th style={{ padding: '10px', textAlign: 'right' }}>Expected</th>
                  <th style={{ padding: '10px', textAlign: 'center' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {selectedTCs.map(tc => {
                  const stats = captureStats.tc?.[tc] || captureStats.analysis?.[tc]
                  const est = estimates[tc]
                  const actualKbps = stats?.kbps || 0
                  const wasShaped = actualKbps > 0 && actualKbps < est.trafficKbps * 0.7

                  return (
                    <tr key={tc} style={{ borderBottom: `1px solid ${colors.border}` }}>
                      <td style={{ padding: '10px', color: tcColors[tc], fontWeight: '600' }}>TC{tc}</td>
                      <td style={{ padding: '10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: stats?.count ? '600' : '400' }}>{stats?.count || '-'}</td>
                      <td style={{ padding: '10px', textAlign: 'right', fontFamily: 'monospace' }}>{actualKbps ? `${formatBw(actualKbps)}bps` : '-'}</td>
                      <td style={{ padding: '10px', textAlign: 'right', fontFamily: 'monospace', color: colors.textMuted }}>{formatBw(est.slope)}bps</td>
                      <td style={{ padding: '10px', textAlign: 'right', fontFamily: 'monospace', color: colors.textMuted }}>
                        {est.willShape ? `≤${formatBw(est.slope)}` : `${formatBw(est.trafficKbps)}`}
                      </td>
                      <td style={{ padding: '10px', textAlign: 'center' }}>
                        {stats?.count ? (
                          <span style={{ padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: '600', background: wasShaped ? '#fef2f2' : '#dcfce7', color: wasShaped ? colors.error : colors.success }}>
                            {wasShaped ? 'SHAPED' : 'OK'}
                          </span>
                        ) : '-'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

export default CBSDashboard
