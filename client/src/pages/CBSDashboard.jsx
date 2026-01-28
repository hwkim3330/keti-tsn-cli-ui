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
}

// Blue/Gray 톤다운 색상 (TC0-7)
const tcColors = [
  '#94a3b8', '#64748b', '#475569', '#334155',
  '#1e3a5f', '#1e40af', '#3730a3', '#4c1d95'
]

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
  const wsRef = useRef(null)

  const board1 = devices.find(d => d.name?.includes('#1') || d.device?.includes('ACM0'))
  const board2 = devices.find(d => d.name?.includes('#2') || d.device?.includes('ACM1'))
  const CBS_PORT = 8
  const cbsBoard = board1 || board2

  const getQosPath = (port) => `/ietf-interfaces:interfaces/interface[name='${port}']/mchp-velocitysp-port:eth-qos/config`

  // CBS 상태 가져오기
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

      // Update local state with board values
      const newSlope = { ...idleSlope }
      shapers.forEach(s => { if (s.idleSlope > 0) newSlope[s.tc] = s.idleSlope })
      setIdleSlope(newSlope)
      setCbsData({ online: true, shapers })
    } catch {
      setCbsData({ online: false })
    }
    setLoading(false)
  }

  // CBS 적용
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

  useEffect(() => {
    setTrafficInterface(TRAFFIC_INTERFACE)
  }, [])

  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/capture`)
      ws.onopen = () => setTapConnected(true)
      ws.onclose = () => { setTapConnected(false); setTimeout(connect, 3000) }
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.type === 'c-capture-stats') setCaptureStats(msg.data)
          else if (msg.type === 'c-capture-stopped' && msg.stats?.analysis) {
            setCaptureStats(prev => ({ ...prev, final: true, analysis: msg.stats.analysis }))
          }
        } catch {}
      }
      wsRef.current = ws
    }
    connect()
    return () => wsRef.current?.close()
  }, [])

  const startTest = async () => {
    if (!trafficInterface || selectedTCs.length === 0) return
    setCaptureStats(null)
    try {
      await axios.post('/api/capture/start-c', { interface: TAP_INTERFACE, duration: duration + 1, vlanId })
      await new Promise(r => setTimeout(r, 300))
      setTrafficRunning(true)
      await axios.post(`${TRAFFIC_API}/api/traffic/start-precision`, {
        interface: trafficInterface, dstMac: BOARD2_PORT8_MAC, vlanId, tcList: selectedTCs, packetsPerSecond, duration
      })
      setTimeout(stopTest, (duration + 2) * 1000)
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

      // Credit calculation
      const sendSlope = slope - LINK_SPEED  // negative
      const txTime = PACKET_SIZE / (LINK_SPEED * 1000)  // seconds per packet
      const creditPerPkt = sendSlope * 1000 * txTime  // bits consumed (negative)
      const interPktTime = ppsPerTc > 0 ? 1 / ppsPerTc : 0
      const creditRecovery = slope * 1000 * interPktTime  // bits recovered
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

  // Styles
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
                    <td style={{ padding: '8px', textAlign: 'center' }}>
                      <span style={{ padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: '500', background: est.isLimited ? '#fef3c7' : '#dcfce7', color: est.isLimited ? colors.warning : colors.success }}>
                        {est.isLimited ? 'LIMITED' : 'UNLIMITED'}
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
            <button className="btn btn-secondary" onClick={() => setCaptureStats(null)}>Clear</button>
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

          {/* Estimation Summary */}
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
            <span style={{ fontWeight: '600' }}>Packet Monitor & Credit Estimation</span>
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

            {/* Credit Detail */}
            {captureStats.final && (
              <div style={{ marginTop: '16px' }}>
                <div style={{ fontSize: '0.75rem', color: colors.textMuted, marginBottom: '8px', fontWeight: '600' }}>Credit Analysis</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px' }}>
                  {selectedTCs.filter(tc => estimates[tc].isLimited).map(tc => {
                    const est = estimates[tc]
                    const stats = captureStats.tc?.[tc] || captureStats.analysis?.[tc]
                    const actualKbps = stats?.kbps || 0
                    const ratio = est.trafficKbps > 0 ? Math.round(actualKbps / est.trafficKbps * 100) : 100

                    return (
                      <div key={tc} style={{ padding: '10px', background: colors.bgAlt, borderRadius: '4px', fontSize: '0.75rem', fontFamily: 'monospace' }}>
                        <div style={{ color: tcColors[tc], fontWeight: '700', marginBottom: '6px' }}>TC{tc}</div>
                        <div>Credit/Pkt: <span style={{ color: colors.error }}>{est.creditPerPkt}</span> bits</div>
                        <div>Recovery: <span style={{ color: colors.success }}>+{est.creditRecovery}</span> bits</div>
                        <div>Net: <span style={{ color: est.netCredit < 0 ? colors.error : colors.success }}>{est.netCredit > 0 ? '+' : ''}{est.netCredit}</span> bits/pkt</div>
                        <div style={{ marginTop: '4px', paddingTop: '4px', borderTop: `1px solid ${colors.border}` }}>
                          Result: {ratio}% ({actualKbps ? `${formatBw(actualKbps)}bps` : '-'})
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default CBSDashboard
