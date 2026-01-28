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
  const height = 300
  const padding = { top: 30, right: 120, bottom: 45, left: 80 }
  const chartW = width - padding.left - padding.right
  const chartH = height - padding.top - padding.bottom

  // 현재 시간 (데이터 기반)
  const currentTime = creditHistory.length > 0 ? creditHistory[creditHistory.length - 1].time : 0

  // X축 동적 범위 계산
  const { xMin, xMax } = useMemo(() => {
    if (!creditHistory.length) return { xMin: 0, xMax: maxTime }
    const lastTime = creditHistory[creditHistory.length - 1].time
    // 데이터가 있으면 현재 시간 기준으로 동적 범위
    if (lastTime > 0) {
      return { xMin: 0, xMax: Math.max(lastTime * 1.1, 1000) }
    }
    return { xMin: 0, xMax: maxTime }
  }, [creditHistory, maxTime])

  // Y축 범위 계산 (credit 값) - 동적
  const { minCredit, maxCredit } = useMemo(() => {
    if (!creditHistory.length || creditHistory.length < 2) return { minCredit: -1000, maxCredit: 1000 }
    let min = 0, max = 0
    creditHistory.forEach(entry => {
      selectedTCs.forEach(tc => {
        const val = entry.credit?.[tc] ?? 0
        if (val < min) min = val
        if (val > max) max = val
      })
    })
    // 실제 데이터 범위에 맞춰 동적 조정
    const absMax = Math.max(Math.abs(min), Math.abs(max), 200)
    return { minCredit: -absMax * 1.3, maxCredit: absMax * 1.3 }
  }, [creditHistory, selectedTCs])

  const xScale = (time) => padding.left + ((time - xMin) / (xMax - xMin)) * chartW
  const yScale = (val) => {
    const range = maxCredit - minCredit
    if (range === 0) return padding.top + chartH / 2
    return padding.top + chartH - ((val - minCredit) / range) * chartH
  }

  // X축 틱 (동적 간격)
  const xTicks = useMemo(() => {
    const range = xMax - xMin
    let step = 1000
    if (range > 10000) step = 2000
    if (range > 20000) step = 5000
    if (range < 2000) step = 500
    const ticks = []
    for (let i = 0; i <= xMax; i += step) ticks.push(i)
    return ticks
  }, [xMin, xMax])

  // Y축 틱 (동적 간격)
  const yTicks = useMemo(() => {
    const range = maxCredit - minCredit
    if (range === 0) return [0]
    let step = 200
    if (range > 2000) step = 500
    if (range > 5000) step = 1000
    if (range < 500) step = 100
    const ticks = []
    for (let v = Math.floor(minCredit / step) * step; v <= maxCredit; v += step) {
      ticks.push(v)
    }
    return ticks
  }, [minCredit, maxCredit])

  // 0 라인 위치
  const zeroY = yScale(0)
  const zeroInRange = zeroY >= padding.top && zeroY <= padding.top + chartH

  // TC별 라인 스타일 (구분 명확화)
  const tcLineStyles = [
    { dash: '', width: 2.5 },
    { dash: '', width: 2.5 },
    { dash: '8,4', width: 2.5 },
    { dash: '8,4', width: 2.5 },
    { dash: '4,4', width: 2.5 },
    { dash: '4,4', width: 2.5 },
    { dash: '12,4,4,4', width: 2.5 },
    { dash: '12,4,4,4', width: 2.5 },
  ]

  return (
    <div style={{ background: '#fff', border: `1px solid ${colors.border}`, borderRadius: '6px', padding: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontWeight: '600', fontSize: '0.9rem' }}>Credit Evolution</span>
          {creditHistory.length > 1 && (
            <span style={{ fontSize: '0.75rem', color: colors.success, fontWeight: '500' }}>
              {(currentTime / 1000).toFixed(1)}s
            </span>
          )}
        </div>
        <div style={{ fontSize: '0.7rem', color: colors.textMuted }}>
          <span style={{ color: colors.error }}>■</span> Shaping Zone (credit {'<'} 0)
        </div>
      </div>

      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
        <defs>
          {selectedTCs.map(tc => (
            <linearGradient key={tc} id={`gradient-tc${tc}`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={tcColors[tc]} stopOpacity="0.3" />
              <stop offset="100%" stopColor={tcColors[tc]} stopOpacity="0.05" />
            </linearGradient>
          ))}
        </defs>

        {/* Shaping Zone (credit < 0) */}
        {zeroInRange && (
          <rect x={padding.left} y={zeroY} width={chartW} height={Math.min(padding.top + chartH - zeroY, chartH)}
            fill={colors.error} opacity="0.1" />
        )}

        {/* Y축 그리드 */}
        {yTicks.map((tick, i) => (
          <g key={`y-${tick}-${i}`}>
            <line x1={padding.left} y1={yScale(tick)} x2={padding.left + chartW} y2={yScale(tick)}
              stroke={tick === 0 ? colors.text : colors.border} strokeWidth={tick === 0 ? 1.5 : 0.5}
              strokeDasharray={tick === 0 ? '' : '3,3'} />
            <text x={padding.left - 10} y={yScale(tick)} textAnchor="end" alignmentBaseline="middle"
              fontSize="10" fill={colors.textMuted} fontFamily="monospace">
              {tick >= 0 ? `+${tick}` : tick}
            </text>
          </g>
        ))}

        {/* X축 그리드 */}
        {xTicks.map((tick, i) => (
          <g key={`x-${tick}-${i}`}>
            <line x1={xScale(tick)} y1={padding.top} x2={xScale(tick)} y2={padding.top + chartH}
              stroke={colors.border} strokeWidth="0.5" strokeDasharray="3,3" />
            <text x={xScale(tick)} y={padding.top + chartH + 16} textAnchor="middle"
              fontSize="10" fill={colors.textMuted}>{(tick / 1000).toFixed(1)}s</text>
          </g>
        ))}

        {/* 현재 시간 마커 */}
        {creditHistory.length > 1 && (
          <line x1={xScale(currentTime)} y1={padding.top} x2={xScale(currentTime)} y2={padding.top + chartH}
            stroke={colors.success} strokeWidth="2" strokeDasharray="6,3" opacity="0.7" />
        )}

        {/* Credit 라인 (TC별) */}
        {selectedTCs.map((tc, tcIdx) => {
          if (creditHistory.length < 2) return null
          const style = tcLineStyles[tc] || tcLineStyles[0]

          const points = creditHistory
            .filter(entry => entry.credit && entry.credit[tc] !== undefined)
            .map(entry => ({
              x: xScale(entry.time),
              y: yScale(entry.credit[tc])
            }))

          if (points.length < 2) return null
          const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')

          return (
            <g key={tc}>
              {/* 라인 */}
              <path d={pathD} fill="none" stroke={tcColors[tc]} strokeWidth={style.width}
                strokeLinecap="round" strokeLinejoin="round" strokeDasharray={style.dash} />
              {/* 현재 포인트 (크게) */}
              {points.length > 0 && (
                <>
                  <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y}
                    r="6" fill={tcColors[tc]} stroke="#fff" strokeWidth="2" />
                  <text x={points[points.length - 1].x + 10} y={points[points.length - 1].y + 4}
                    fontSize="10" fill={tcColors[tc]} fontWeight="600" fontFamily="monospace">
                    TC{tc}
                  </text>
                </>
              )}
            </g>
          )
        })}

        {/* Shaping 이벤트 마커 */}
        {shapingEvents.map((event, i) => (
          <g key={`event-${i}`}>
            <line x1={xScale(event.time)} y1={padding.top} x2={xScale(event.time)} y2={padding.top + chartH}
              stroke={event.type === 'enter' ? colors.error : colors.success} strokeWidth="1.5" strokeDasharray="4,2" />
            <circle cx={xScale(event.time)} cy={zeroInRange ? zeroY : padding.top + chartH / 2} r="5"
              fill={event.type === 'enter' ? colors.error : colors.success} stroke="#fff" strokeWidth="1.5" />
            <text x={xScale(event.time)} y={padding.top - 6} textAnchor="middle" fontSize="9"
              fill={event.type === 'enter' ? colors.error : colors.success} fontWeight="600">
              TC{event.tc} {event.type === 'enter' ? 'SHAPE' : 'EXIT'}
            </text>
          </g>
        ))}

        {/* 축 테두리 */}
        <rect x={padding.left} y={padding.top} width={chartW} height={chartH}
          fill="none" stroke={colors.border} strokeWidth="1" />

        {/* 라벨 */}
        <text x={20} y={height / 2} textAnchor="middle" fontSize="11" fill={colors.textMuted} fontWeight="500"
          transform={`rotate(-90, 20, ${height / 2})`}>Credit (bits)</text>
        <text x={padding.left + chartW / 2} y={height - 8} textAnchor="middle" fontSize="11" fill={colors.textMuted} fontWeight="500">Time</text>

        {/* 범례 - 0 라인 */}
        {zeroInRange && (
          <text x={padding.left + 5} y={zeroY - 6} fontSize="9" fill={colors.text} fontWeight="600">0</text>
        )}

        {/* 범례 (오른쪽) */}
        <g transform={`translate(${width - padding.right + 15}, ${padding.top + 10})`}>
          {selectedTCs.map((tc, i) => {
            const style = tcLineStyles[tc] || tcLineStyles[0]
            return (
              <g key={tc} transform={`translate(0, ${i * 24})`}>
                <line x1="0" y1="8" x2="25" y2="8" stroke={tcColors[tc]} strokeWidth={style.width} strokeDasharray={style.dash} />
                <circle cx="25" cy="8" r="4" fill={tcColors[tc]} />
                <text x="32" y="11" fontSize="10" fill={tcColors[tc]} fontWeight="600">TC{tc}</text>
              </g>
            )
          })}
        </g>
      </svg>

      {/* 현재 Credit 값 */}
      {creditHistory.length > 0 && (
        <div style={{ display: 'flex', gap: '10px', marginTop: '12px', flexWrap: 'wrap' }}>
          {selectedTCs.map(tc => {
            const latest = creditHistory[creditHistory.length - 1]?.credit?.[tc] ?? 0
            const isShaping = latest < 0
            return (
              <div key={tc} style={{
                padding: '10px 14px', borderRadius: '6px', fontFamily: 'monospace', fontSize: '0.8rem',
                background: isShaping ? '#fef2f2' : `${tcColors[tc]}10`,
                border: `2px solid ${isShaping ? colors.error : tcColors[tc]}`,
                minWidth: '120px'
              }}>
                <div style={{ color: tcColors[tc], fontWeight: '700', marginBottom: '4px' }}>TC{tc}</div>
                <div style={{ color: isShaping ? colors.error : colors.text, fontWeight: '600', fontSize: '1rem' }}>
                  {latest >= 0 ? '+' : ''}{Math.round(latest)}
                </div>
                {isShaping && <div style={{ color: colors.error, fontSize: '0.7rem', marginTop: '4px', fontWeight: '600' }}>SHAPING</div>}
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
        {selectedTCs.map(tc => {
          const s = stats[tc] || {}
          const est = estimates[tc] || {}
          const cbsOk = s.enterCount > 0  // CBS가 동작하고 있음
          const isLimited = est.isLimited

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
                  background: !isLimited ? colors.textMuted : cbsOk ? colors.error : colors.success,
                  color: '#fff'
                }}>
                  {!isLimited ? 'UNLIMITED' : cbsOk ? 'CBS ACTIVE' : 'NO SHAPING'}
                </span>
              </div>

              <div style={{ fontFamily: 'monospace', lineHeight: '1.6' }}>
                <div>Idle Slope: <span style={{ fontWeight: '600' }}>{((est.slope || LINK_SPEED) / 1000).toFixed(0)}M</span>bps</div>
                <div>Traffic: <span style={{ fontWeight: '600' }}>{((est.trafficKbps || 0) / 1000).toFixed(1)}M</span>bps</div>
                <div style={{ marginTop: '4px', paddingTop: '4px', borderTop: `1px solid ${colors.border}` }}>
                  Shaping Events: <span style={{ fontWeight: '600', color: s.enterCount > 0 ? colors.error : colors.success }}>{s.enterCount || 0}</span>
                </div>
                {s.firstShaping !== null && (
                  <div>First Shaping: <span style={{ fontWeight: '600' }}>{(s.firstShaping / 1000).toFixed(2)}s</span></div>
                )}
                <div>Shaping Ratio: <span style={{ fontWeight: '600', color: s.shapingRatio > 50 ? colors.error : s.shapingRatio > 0 ? colors.warning : colors.success }}>{(s.shapingRatio || 0).toFixed(1)}%</span></div>
              </div>

              <div style={{ marginTop: '8px', padding: '6px', background: 'rgba(0,0,0,0.03)', borderRadius: '4px', fontSize: '0.7rem' }}>
                {!isLimited ? (
                  <span style={{ color: colors.textMuted }}>
                    Idle slope = link speed (no shaping)
                  </span>
                ) : cbsOk ? (
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
  const [monitorTCs, setMonitorTCs] = useState([1, 2])  // Credit 모니터링할 TC
  const [vlanId, setVlanId] = useState(100)
  const [packetsPerSecond, setPacketsPerSecond] = useState(2000)
  const [duration, setDuration] = useState(5)
  const [cbsPort, setCbsPort] = useState(8)  // CBS 설정할 포트

  const [tapConnected, setTapConnected] = useState(false)
  const [captureStats, setCaptureStats] = useState(null)
  const [creditHistory, setCreditHistory] = useState([])
  const [shapingEvents, setShapingEvents] = useState([])
  const [startTime, setStartTime] = useState(null)
  const wsRef = useRef(null)
  const creditRef = useRef({})  // 현재 credit 값 추적
  const simulationRef = useRef(null)  // 시뮬레이션 타이머

  const board1 = devices.find(d => d.name?.includes('#1') || d.device?.includes('ACM0'))
  const board2 = devices.find(d => d.name?.includes('#2') || d.device?.includes('ACM1'))
  const cbsBoard = board1 || board2

  const getQosPath = (port) => `/ietf-interfaces:interfaces/interface[name='${port}']/mchp-velocitysp-port:eth-qos/config`

  const fetchCBS = async () => {
    if (!cbsBoard) return
    setLoading(true)
    try {
      const res = await axios.post('/api/fetch', {
        paths: [`${getQosPath(cbsPort)}/traffic-class-shapers`],
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
    setStatus({ type: 'info', msg: `Applying to Port ${cbsPort}...` })
    try {
      const patches = []
      for (let tc = 0; tc < 8; tc++) {
        patches.push({
          path: `${getQosPath(cbsPort)}/traffic-class-shapers`,
          value: { 'traffic-class': tc, 'credit-based': { 'idle-slope': idleSlope[tc] || LINK_SPEED } }
        })
      }
      await axios.post('/api/patch', { patches, transport: cbsBoard.transport, device: cbsBoard.device, host: cbsBoard.host }, { timeout: 30000 })
      setStatus({ type: 'success', msg: `CBS Applied (Port ${cbsPort})` })
      setTimeout(() => { fetchCBS(); setStatus(null) }, 1500)
    } catch (err) {
      setStatus({ type: 'error', msg: err.message })
    }
  }

  const resetCBS = async () => {
    if (!cbsBoard) return
    setStatus({ type: 'info', msg: `Resetting Port ${cbsPort}...` })
    try {
      const patches = []
      for (let tc = 0; tc < 8; tc++) {
        patches.push({
          path: `${getQosPath(cbsPort)}/traffic-class-shapers`,
          value: { 'traffic-class': tc, 'credit-based': { 'idle-slope': LINK_SPEED } }
        })
      }
      await axios.post('/api/patch', { patches, transport: cbsBoard.transport, device: cbsBoard.device, host: cbsBoard.host }, { timeout: 30000 })
      const resetSlope = {}
      for (let tc = 0; tc < 8; tc++) resetSlope[tc] = LINK_SPEED
      setIdleSlope(resetSlope)
      setStatus({ type: 'success', msg: `CBS Reset (Port ${cbsPort})` })
      setTimeout(() => { fetchCBS(); setStatus(null) }, 1500)
    } catch (err) {
      setStatus({ type: 'error', msg: err.message })
    }
  }

  useEffect(() => { if (cbsBoard) fetchCBS() }, [cbsBoard, cbsPort])
  useEffect(() => { setTrafficInterface(TRAFFIC_INTERFACE) }, [])

  // 시뮬레이션 정리
  useEffect(() => {
    return () => {
      if (simulationRef.current) clearInterval(simulationRef.current)
    }
  }, [])

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

    monitorTCs.forEach(tc => {
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
      monitorTCs.forEach(tc => {
        entry.packets[tc] = stats.tc?.[tc]?.count || 0
      })
      return [...prev.slice(-100), entry]
    })

    // Shaping 이벤트 추가
    if (newEvents.length > 0) {
      setShapingEvents(prev => [...prev, ...newEvents])
    }
  }

  // Credit 시뮬레이션 (실제 트래픽 없이 예상 크레딧 변화 시뮬레이션)
  const simulateCredit = () => {
    if (simulationRef.current) clearInterval(simulationRef.current)

    setCreditHistory([])
    setShapingEvents([])
    creditRef.current = {}
    monitorTCs.forEach(tc => { creditRef.current[tc] = 0 })

    // 선택된 트래픽 TC 기준으로 PPS 계산
    const tcCount = selectedTCs.length || 1
    const ppsPerTc = packetsPerSecond / tcCount
    const intervalMs = 30  // 30ms 간격으로 시뮬레이션 (더 부드럽게)

    // 초기 credit entry
    const initCredit = {}
    monitorTCs.forEach(tc => { initCredit[tc] = 0 })
    setCreditHistory([{ time: 0, credit: initCredit, packets: {} }])

    let simTime = 0
    let allEvents = []

    simulationRef.current = setInterval(() => {
      simTime += intervalMs
      if (simTime > duration * 1000) {
        clearInterval(simulationRef.current)
        simulationRef.current = null
        return
      }

      const newCredit = {}
      const newEvents = []

      monitorTCs.forEach(tc => {
        const slope = idleSlope[tc] || LINK_SPEED
        const prevCredit = creditRef.current[tc] ?? 0

        // 이 TC가 트래픽 대상인지 확인
        const isTrafficTC = selectedTCs.includes(tc)

        // 패킷 전송 시뮬레이션 (트래픽 TC만 패킷 전송)
        const packetsInInterval = isTrafficTC ? (ppsPerTc * intervalMs) / 1000 : 0

        // IEEE 802.1Qav Credit 계산
        // idleSlope: 대기 시간 동안 credit 회복 속도 (bits/s)
        // sendSlope: 전송 시 credit 소비 속도 = idleSlope - portTransmitRate
        const sendSlope = slope - LINK_SPEED  // 음수값 (kbps)

        // 시간당 credit 변화
        // - 전송 중: credit += sendSlope * txTime
        // - 대기 중: credit += idleSlope * idleTime
        // 단순화: intervalMs 동안 패킷 전송과 대기가 혼합됨

        // 패킷 전송 시간 (ms)
        const txTimePerPkt = (PACKET_SIZE / 1000) / LINK_SPEED  // ms per packet
        const totalTxTime = packetsInInterval * txTimePerPkt  // ms
        const idleTime = intervalMs - totalTxTime  // ms

        // Credit 변화 계산
        const idleRecovery = (slope / 1000) * Math.max(idleTime, 0)  // bits (idle 동안 회복)
        const txCost = packetsInInterval * PACKET_SIZE * Math.abs(1 - slope / LINK_SPEED)  // bits (전송 동안 소비)

        let credit = prevCredit + idleRecovery - txCost

        // Credit bounds
        const hiCredit = PACKET_SIZE * 2  // 최대 2 패킷 크기
        const loCredit = -PACKET_SIZE * 8  // 최소 -8 패킷 크기

        // Shaping 이벤트 감지
        const wasShaping = prevCredit < 0
        const isShaping = credit < 0

        if (!wasShaping && isShaping) {
          newEvents.push({ type: 'enter', tc, time: simTime, credit })
        } else if (wasShaping && !isShaping) {
          newEvents.push({ type: 'exit', tc, time: simTime, credit })
        }

        credit = Math.max(loCredit, Math.min(hiCredit, credit))
        newCredit[tc] = credit
        creditRef.current[tc] = credit
      })

      setCreditHistory(prev => {
        const entry = { time: simTime, credit: { ...newCredit }, packets: {} }
        // 최대 300개 포인트 유지
        const newHistory = [...prev, entry]
        return newHistory.length > 300 ? newHistory.slice(-300) : newHistory
      })

      if (newEvents.length > 0) {
        setShapingEvents(prev => [...prev, ...newEvents])
      }
    }, intervalMs)
  }

  const stopSimulation = () => {
    if (simulationRef.current) {
      clearInterval(simulationRef.current)
      simulationRef.current = null
    }
  }

  const startTest = async () => {
    if (!trafficInterface || selectedTCs.length === 0) return
    stopSimulation()
    setCaptureStats(null)
    setCreditHistory([])
    setShapingEvents([])
    creditRef.current = {}
    monitorTCs.forEach(tc => { creditRef.current[tc] = 0 })

    const now = Date.now()
    setStartTime(now)

    // 초기 credit entry
    const initCredit = {}
    monitorTCs.forEach(tc => { initCredit[tc] = 0 })
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
    stopSimulation()
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '16px' }}>
        <div style={{ ...card, marginBottom: 0 }}>
          <div style={cardBody}>
            <div style={{ fontSize: '0.75rem', color: colors.textMuted, fontWeight: '500', marginBottom: '4px' }}>Board</div>
            <div style={{ fontSize: '0.875rem', fontFamily: 'monospace' }}>{cbsBoard?.name || 'Not Connected'}</div>
            <div style={{ fontSize: '0.75rem', color: colors.textMuted, marginTop: '4px' }}>{cbsBoard?.device || '-'}</div>
          </div>
        </div>
        <div style={{ ...card, marginBottom: 0 }}>
          <div style={cardBody}>
            <div style={{ fontSize: '0.75rem', color: colors.textMuted, fontWeight: '500', marginBottom: '4px' }}>CBS Port</div>
            <select value={cbsPort} onChange={e => setCbsPort(parseInt(e.target.value))}
              style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: `1px solid ${colors.border}`, fontFamily: 'monospace', fontSize: '0.875rem' }}>
              {[1,2,3,4,5,6,7,8,9,10,11,12].map(p => (
                <option key={p} value={p}>Port {p}</option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ ...card, marginBottom: 0 }}>
          <div style={cardBody}>
            <div style={{ fontSize: '0.75rem', color: colors.textMuted, fontWeight: '500', marginBottom: '4px' }}>TX Interface</div>
            <div style={{ fontSize: '0.875rem', fontFamily: 'monospace', color: trafficInterface ? colors.text : colors.error }}>{trafficInterface || 'Not Found'}</div>
          </div>
        </div>
        <div style={{ ...card, marginBottom: 0 }}>
          <div style={cardBody}>
            <div style={{ fontSize: '0.75rem', color: colors.textMuted, fontWeight: '500', marginBottom: '4px' }}>RX Interface</div>
            <div style={{ fontSize: '0.875rem', fontFamily: 'monospace' }}>{TAP_INTERFACE}</div>
            <div style={{ fontSize: '0.75rem', color: tapConnected ? colors.success : colors.error, marginTop: '4px' }}>{tapConnected ? 'Ready' : 'Disconnected'}</div>
          </div>
        </div>
      </div>

      {/* Credit Monitor - TC 선택 및 시뮬레이션 */}
      <div style={{ ...card, marginBottom: '16px' }}>
        <div style={cardHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontWeight: '600' }}>Credit Monitor</span>
            <span style={{ fontSize: '0.75rem', color: colors.textMuted }}>Select TCs to monitor</span>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-secondary" onClick={simulateCredit} disabled={monitorTCs.length === 0 || trafficRunning}
              style={{ padding: '6px 12px', fontSize: '0.8rem' }}>
              Simulate
            </button>
            <button className="btn btn-secondary" onClick={() => { stopSimulation(); setCreditHistory([]); setShapingEvents([]) }}
              style={{ padding: '6px 12px', fontSize: '0.8rem' }}>
              Clear
            </button>
          </div>
        </div>
        <div style={cardBody}>
          {/* TC 선택 */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
            {[0,1,2,3,4,5,6,7].map(tc => {
              const isSelected = monitorTCs.includes(tc)
              const slope = idleSlope[tc] || LINK_SPEED
              const isLimited = slope < LINK_SPEED
              return (
                <button key={tc} onClick={() => setMonitorTCs(prev => prev.includes(tc) ? prev.filter(t => t !== tc) : [...prev, tc].sort())}
                  style={{
                    padding: '8px 14px', borderRadius: '4px', cursor: 'pointer',
                    border: `2px solid ${isSelected ? tcColors[tc] : colors.border}`,
                    background: isSelected ? `${tcColors[tc]}15` : '#fff',
                    color: isSelected ? tcColors[tc] : colors.textMuted,
                    fontWeight: '600', fontSize: '0.8rem',
                    opacity: isLimited ? 1 : 0.5
                  }}>
                  TC{tc}
                  <span style={{ marginLeft: '6px', fontSize: '0.7rem', fontWeight: '400' }}>
                    {formatBw(slope)}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Credit Graph */}
          {monitorTCs.length > 0 ? (
            <CreditGraph
              creditHistory={creditHistory}
              selectedTCs={monitorTCs}
              maxTime={maxGraphTime}
              shapingEvents={shapingEvents}
            />
          ) : (
            <div style={{ padding: '40px', textAlign: 'center', color: colors.textMuted, background: colors.bgAlt, borderRadius: '6px' }}>
              Select TC(s) to monitor credit changes
            </div>
          )}
        </div>
      </div>

      {/* Shaping Analysis */}
      {creditHistory.length > 1 && monitorTCs.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <ShapingAnalysis
            shapingEvents={shapingEvents}
            selectedTCs={monitorTCs}
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
