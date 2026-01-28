import { useState, useEffect, useRef, useCallback } from 'react'
import axios from 'axios'
import { useDevices } from '../contexts/DeviceContext'

const TAP_INTERFACE = 'enxc84d44231cc2'
const TRAFFIC_INTERFACE_PREFIX = 'enx00e'
const BOARD1_PORT8_MAC = 'E6:F4:41:C9:57:08'  // TAS 설정된 포트
const BOARD2_PORT8_MAC = 'FA:AE:C9:26:A4:08'  // TAS 없는 포트
const TX_SOURCE_MAC = '00:e0:4c:68:13:36'
const TRAFFIC_API = 'http://localhost:3001'

const colors = {
  text: '#1e293b',
  textMuted: '#64748b',
  textLight: '#94a3b8',
  bg: '#f8fafc',
  bgAlt: '#f1f5f9',
  border: '#e2e8f0',
  accent: '#475569',
  success: '#059669',
  warning: '#d97706',
  error: '#dc2626',
}

const tcColors = {
  0: '#94a3b8', 1: '#f97316', 2: '#eab308', 3: '#22c55e',
  4: '#06b6d4', 5: '#3b82f6', 6: '#8b5cf6', 7: '#ec4899',
}

const tcNames = ['BE(BG)', 'BE', 'EE', 'CA', 'Video', 'Voice', 'IC', 'NC']

function TASDashboard() {
  const { devices } = useDevices()

  const [tasData, setTasData] = useState({})
  const [loading, setLoading] = useState(false)
  const [autoSetupStatus, setAutoSetupStatus] = useState(null)
  const [autoSetupMessage, setAutoSetupMessage] = useState('')

  const [trafficInterface, setTrafficInterface] = useState(null)
  const [trafficRunning, setTrafficRunning] = useState(false)
  const [selectedTCs, setSelectedTCs] = useState([0, 1, 2, 3, 4, 5, 6, 7])
  const [vlanId, setVlanId] = useState(100)
  const [packetsPerSecond, setPacketsPerSecond] = useState(100)
  const [duration, setDuration] = useState(7)

  const [capturing, setCapturing] = useState(false)
  const [tapConnected, setTapConnected] = useState(false)
  const [capturedPackets, setCapturedPackets] = useState([])
  const wsRef = useRef(null)
  const startTimeRef = useRef(null)

  const board1 = devices.find(d => d.name?.includes('#1') || d.device?.includes('ACM0'))
  const board2 = devices.find(d => d.name?.includes('#2') || d.device?.includes('ACM1'))
  const TAS_PORT = 8
  const tasBoard = board1 || board2  // Board 1 우선 (Port 9 UP인 보드)

  const getBasePath = (port) => `/ietf-interfaces:interfaces/interface[name='${port}']/ieee802-dot1q-bridge:bridge-port/ieee802-dot1q-sched-bridge:gate-parameter-table`

  // Fetch TAS status
  const fetchTASStatus = async () => {
    if (!tasBoard) return
    setLoading(true)
    try {
      const basePath = getBasePath(TAS_PORT)
      const res = await axios.post('/api/fetch', {
        paths: [basePath],
        transport: tasBoard.transport || 'serial',
        device: tasBoard.device,
        host: tasBoard.host,
        port: tasBoard.port || 5683
      }, { timeout: 15000 })

      const yaml = res.data?.result || ''
      const status = { gateEnabled: false, adminGateStates: 255, cycleTimeNs: 0, adminControlList: [], online: true }

      status.gateEnabled = /gate-enabled:\s*true/.test(yaml)

      const gsMatch = yaml.match(/admin-gate-states:\s*(\d+)/)
      if (gsMatch) status.adminGateStates = parseInt(gsMatch[1])

      const cycleMatch = yaml.match(/admin-cycle-time:[\s\S]*?numerator:\s*(\d+)/)
      if (cycleMatch) status.cycleTimeNs = parseInt(cycleMatch[1])

      const adminListMatch = yaml.match(/admin-control-list:[\s\S]*?gate-control-entry:([\s\S]*?)(?=oper-|$)/)
      if (adminListMatch) {
        const listContent = adminListMatch[1]
        const entries = []
        const entryMatches = listContent.matchAll(/gate-states-value:\s*(\d+)[\s\S]*?time-interval-value:\s*(\d+)/g)
        for (const m of entryMatches) {
          entries.push({ gateStates: parseInt(m[1]), timeInterval: parseInt(m[2]) })
        }
        status.adminControlList = entries
      }

      setTasData(status)
    } catch {
      setTasData({ online: false, error: 'Connection failed' })
    }
    setLoading(false)
  }

  // Auto Setup TAS
  const autoSetupTAS = async () => {
    if (!tasBoard) return
    setAutoSetupStatus('running')
    setAutoSetupMessage('Configuring TAS...')
    try {
      const basePath = getBasePath(TAS_PORT)
      // TC0 항상 열림, TC1~7 순서대로 100ms씩
      const gclEntries = []
      for (let i = 1; i <= 7; i++) {
        gclEntries.push({
          index: i - 1,
          'operation-name': 'ieee802-dot1q-sched:set-gate-states',
          'time-interval-value': 100000000,  // 100ms
          'gate-states-value': (1 << i) | 1  // TC0 + TCi
        })
      }
      const patches = [
        { path: `${basePath}/gate-enabled`, value: true },
        { path: `${basePath}/admin-gate-states`, value: 255 },
        { path: `${basePath}/admin-control-list/gate-control-entry`, value: gclEntries },
        { path: `${basePath}/admin-cycle-time/numerator`, value: 700000000 },  // 700ms cycle
        { path: `${basePath}/admin-cycle-time/denominator`, value: 1 },
      ]
      await axios.post('/api/patch', { patches, transport: tasBoard.transport, device: tasBoard.device, host: tasBoard.host }, { timeout: 30000 })
      await axios.post('/api/patch', { patches: [{ path: `${basePath}/config-change`, value: true }], transport: tasBoard.transport, device: tasBoard.device, host: tasBoard.host }, { timeout: 10000 })
      setAutoSetupStatus('success')
      setAutoSetupMessage('TAS configured!')
      setTimeout(() => { fetchTASStatus(); setAutoSetupStatus(null) }, 1500)
    } catch (err) {
      setAutoSetupStatus('error')
      setAutoSetupMessage(`Failed: ${err.message}`)
    }
  }

  const resetTAS = async () => {
    if (!tasBoard) return
    setAutoSetupStatus('running')
    try {
      await axios.post('/api/patch', {
        patches: [{ path: `${getBasePath(TAS_PORT)}/gate-enabled`, value: false }],
        transport: tasBoard.transport, device: tasBoard.device, host: tasBoard.host
      }, { timeout: 15000 })
      setAutoSetupStatus('success')
      setAutoSetupMessage('TAS disabled')
      setTimeout(() => { fetchTASStatus(); setAutoSetupStatus(null) }, 1500)
    } catch (err) {
      setAutoSetupStatus('error')
      setAutoSetupMessage(`Failed: ${err.message}`)
    }
  }

  // Auto-fetch TAS status when board is available
  useEffect(() => {
    if (!tasBoard) return
    const loadStatus = async () => {
      setLoading(true)
      try {
        const basePath = getBasePath(TAS_PORT)
        const res = await axios.post('/api/fetch', {
          paths: [basePath],
          transport: tasBoard.transport || 'serial',
          device: tasBoard.device,
          host: tasBoard.host,
          port: tasBoard.port || 5683
        }, { timeout: 15000 })

        const yaml = res.data?.result || ''
        const status = { gateEnabled: false, adminGateStates: 255, cycleTimeNs: 0, adminControlList: [], online: true }

        // Parse gate-enabled
        status.gateEnabled = /gate-enabled:\s*true/.test(yaml)

        // Parse admin-gate-states
        const gsMatch = yaml.match(/admin-gate-states:\s*(\d+)/)
        if (gsMatch) status.adminGateStates = parseInt(gsMatch[1])

        // Parse admin-cycle-time numerator
        const cycleMatch = yaml.match(/admin-cycle-time:[\s\S]*?numerator:\s*(\d+)/)
        if (cycleMatch) status.cycleTimeNs = parseInt(cycleMatch[1])

        // Parse admin-control-list entries
        const adminListMatch = yaml.match(/admin-control-list:[\s\S]*?gate-control-entry:([\s\S]*?)(?=oper-|$)/)
        if (adminListMatch) {
          const listContent = adminListMatch[1]
          const entries = []
          const entryMatches = listContent.matchAll(/gate-states-value:\s*(\d+)[\s\S]*?time-interval-value:\s*(\d+)/g)
          for (const m of entryMatches) {
            entries.push({ gateStates: parseInt(m[1]), timeInterval: parseInt(m[2]) })
          }
          status.adminControlList = entries
        }

        setTasData(status)
      } catch {
        setTasData({ online: false, error: 'Connection failed' })
      }
      setLoading(false)
    }
    loadStatus()
  }, [tasBoard])

  // Fetch interfaces
  useEffect(() => {
    axios.get(`${TRAFFIC_API}/api/traffic/interfaces`).then(res => {
      const iface = res.data.find(i => i.name.startsWith(TRAFFIC_INTERFACE_PREFIX))
      if (iface) setTrafficInterface(iface.name)
    }).catch(() => {})
  }, [])

  // WebSocket for capture
  useEffect(() => {
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/capture`
    const connect = () => {
      const ws = new WebSocket(wsUrl)
      ws.onopen = () => setTapConnected(true)
      ws.onclose = () => { setTapConnected(false); setTimeout(connect, 3000) }
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'packet') handlePacket(msg.data)
          else if (msg.type === 'stopped') setCapturing(false)
        } catch {}
      }
      wsRef.current = ws
    }
    connect()
    return () => wsRef.current?.close()
  }, [])

  const handlePacket = useCallback((packet) => {
    if (packet.protocol === 'PTP') return
    if (packet.length < 56 || packet.length > 200) return

    const pcp = packet.vlan?.pcp ?? 0
    const hasVlan = !!packet.vlan
    const vid = packet.vlan?.vid || 0
    const srcMac = (packet.srcMac || packet.source || '').toLowerCase().replace(/[:-]/g, '')
    const isTx = packet.interface?.startsWith(TRAFFIC_INTERFACE_PREFIX)
    const isRx = packet.interface === TAP_INTERFACE

    // RX: only count VLAN packets (temporarily disabled strict filtering for debug)
    if (isRx && !hasVlan) return

    if (isTx || isRx) {
      setCapturedPackets(prev => [...prev, {
        time: Date.now(),
        pcp,
        length: packet.length,
        vid,
        hasVlan,
        src: packet.srcMac || packet.source,
        dst: packet.dstMac || packet.destination,
        direction: isTx ? 'TX' : 'RX'
      }].slice(-1000))
    }
  }, [vlanId])

  const startTest = async () => {
    if (!trafficInterface || selectedTCs.length === 0) return
    setCapturedPackets([])
    startTimeRef.current = Date.now()

    try {
      await axios.post('/api/capture/start', {
        interfaces: [trafficInterface, TAP_INTERFACE],
        captureMode: 'all'
      })
      setCapturing(true)
    } catch {}

    setTrafficRunning(true)
    try {
      await axios.post(`${TRAFFIC_API}/api/traffic/start`, {
        interface: trafficInterface,
        dstMac: BOARD2_PORT8_MAC,  // Board 2로 전송 (Board 1 Port 8 egress에서 TAS 적용)
        vlanId,
        tcList: selectedTCs,
        packetSize: 100,
        packetsPerSecond,
        duration
      })
    } catch {
      setTrafficRunning(false)
    }

    setTimeout(stopTest, (duration + 2) * 1000)
  }

  const stopTest = async () => {
    setTrafficRunning(false)
    try { await axios.post(`${TRAFFIC_API}/api/traffic/stop`, { interface: trafficInterface }) } catch {}
    try { await axios.post('/api/capture/stop', {}); setCapturing(false) } catch {}
  }

  const toggleTC = (tc) => setSelectedTCs(prev => prev.includes(tc) ? prev.filter(t => t !== tc) : [...prev, tc].sort())

  // Stats
  const txPackets = capturedPackets.filter(p => p.direction === 'TX')
  const rxPackets = capturedPackets.filter(p => p.direction === 'RX')
  const txByTc = {}
  const rxByTc = {}
  txPackets.forEach(p => { if (p.hasVlan) txByTc[p.pcp] = (txByTc[p.pcp] || 0) + 1 })
  rxPackets.forEach(p => { if (p.hasVlan) rxByTc[p.pcp] = (rxByTc[p.pcp] || 0) + 1 })

  const cellStyle = { padding: '6px 10px', borderBottom: `1px solid ${colors.border}`, fontSize: '0.75rem' }
  const headerStyle = { ...cellStyle, fontWeight: '600', background: colors.bgAlt }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">TAS Dashboard</h1>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {autoSetupStatus && (
            <span style={{ fontSize: '0.7rem', padding: '4px 8px', borderRadius: '4px', background: autoSetupStatus === 'success' ? '#dcfce7' : autoSetupStatus === 'error' ? '#fef2f2' : colors.bgAlt }}>
              {autoSetupMessage}
            </span>
          )}
          <button className="btn btn-secondary" onClick={fetchTASStatus} disabled={loading}>{loading ? '...' : 'Refresh'}</button>
          <button className="btn btn-primary" onClick={autoSetupTAS} disabled={!tasBoard}>Auto Setup</button>
          <button className="btn btn-secondary" onClick={resetTAS} disabled={!tasBoard}>Reset</button>
        </div>
      </div>

      {/* TAS Config Table + Test Controls */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
        {/* TAS Configuration - 8x8 Matrix */}
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">TAS Configuration</h2>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ fontSize: '0.65rem', padding: '2px 6px', background: colors.bgAlt, borderRadius: '4px', color: colors.text, fontWeight: '600' }}>
                {tasBoard?.name || '-'} ({tasBoard?.device || '-'}) Port {TAS_PORT}
              </span>
              <span style={{ fontSize: '0.65rem', color: tasData.gateEnabled ? colors.success : colors.textLight, fontWeight: '600' }}>
                {tasData.gateEnabled ? '● ON' : '○ OFF'}
              </span>
            </div>
          </div>

          {/* Gate Control Matrix */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.7rem', fontFamily: 'monospace' }}>
              <thead>
                <tr>
                  <th style={{ ...headerStyle, width: '50px', textAlign: 'center' }}>Slot</th>
                  {[0,1,2,3,4,5,6,7].map(tc => (
                    <th key={tc} style={{ ...headerStyle, width: '40px', textAlign: 'center', background: tcColors[tc], color: '#fff' }}>
                      TC{tc}
                    </th>
                  ))}
                  <th style={{ ...headerStyle, textAlign: 'center' }}>Time</th>
                </tr>
              </thead>
              <tbody>
                {tasData.adminControlList?.length > 0 ? (
                  tasData.adminControlList.map((entry, idx) => (
                    <tr key={idx}>
                      <td style={{ ...cellStyle, textAlign: 'center', fontWeight: '600' }}>#{idx}</td>
                      {[0,1,2,3,4,5,6,7].map(tc => {
                        const isOpen = (entry.gateStates >> tc) & 1
                        return (
                          <td key={tc} style={{ ...cellStyle, textAlign: 'center', background: isOpen ? '#dcfce7' : '#fef2f2' }}>
                            {isOpen ? '●' : '○'}
                          </td>
                        )
                      })}
                      <td style={{ ...cellStyle, textAlign: 'center', color: colors.textMuted }}>
                        {entry.timeInterval >= 1000000
                          ? `${(entry.timeInterval / 1000000).toFixed(0)}ms`
                          : `${(entry.timeInterval / 1000).toFixed(0)}μs`}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td style={{ ...cellStyle, textAlign: 'center' }}>-</td>
                    {[0,1,2,3,4,5,6,7].map(tc => (
                      <td key={tc} style={{ ...cellStyle, textAlign: 'center', background: '#dcfce7' }}>●</td>
                    ))}
                    <td style={{ ...cellStyle, textAlign: 'center', color: colors.textMuted }}>All Open</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Cycle Info */}
          <div style={{ display: 'flex', gap: '16px', marginTop: '8px', fontSize: '0.7rem', color: colors.textMuted }}>
            <span>Cycle: {tasData.cycleTimeNs
              ? (tasData.cycleTimeNs >= 1000000
                  ? `${(tasData.cycleTimeNs / 1000000).toFixed(0)}ms`
                  : `${(tasData.cycleTimeNs / 1000).toFixed(0)}μs`)
              : '-'}</span>
            <span>Entries: {tasData.adminControlList?.length || 0}</span>
            <span>TC0: Always Open</span>
          </div>
        </div>

        {/* Test Controls */}
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Traffic Test</h2>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', fontSize: '0.7rem' }}>
            <div style={{ flex: 1, padding: '6px', background: trafficInterface ? '#ecfdf5' : '#fef2f2', borderRadius: '4px' }}>
              TX: {trafficInterface || 'N/A'}
            </div>
            <div style={{ flex: 1, padding: '6px', background: tapConnected ? '#ecfdf5' : '#fef2f2', borderRadius: '4px' }}>
              RX: {TAP_INTERFACE}
            </div>
          </div>

          <div style={{ marginBottom: '10px' }}>
            <div style={{ fontSize: '0.65rem', color: colors.textMuted, marginBottom: '4px' }}>Traffic Classes:</div>
            <div style={{ display: 'flex', gap: '4px' }}>
              {[0,1,2,3,4,5,6,7].map(tc => (
                <button key={tc} onClick={() => !trafficRunning && toggleTC(tc)} disabled={trafficRunning}
                  style={{ padding: '4px 8px', borderRadius: '4px', border: 'none', background: selectedTCs.includes(tc) ? tcColors[tc] : colors.bgAlt, color: selectedTCs.includes(tc) ? '#fff' : colors.textMuted, fontSize: '0.7rem', fontWeight: '600', cursor: trafficRunning ? 'not-allowed' : 'pointer' }}>
                  TC{tc}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '10px', fontSize: '0.7rem' }}>
            <div>
              <div style={{ color: colors.textMuted, marginBottom: '2px' }}>VLAN</div>
              <input type="number" value={vlanId} onChange={e => setVlanId(parseInt(e.target.value) || 0)} disabled={trafficRunning} style={{ width: '100%', padding: '4px', borderRadius: '4px', border: `1px solid ${colors.border}` }} />
            </div>
            <div>
              <div style={{ color: colors.textMuted, marginBottom: '2px' }}>PPS</div>
              <input type="number" value={packetsPerSecond} onChange={e => setPacketsPerSecond(parseInt(e.target.value) || 1)} disabled={trafficRunning} style={{ width: '100%', padding: '4px', borderRadius: '4px', border: `1px solid ${colors.border}` }} />
            </div>
            <div>
              <div style={{ color: colors.textMuted, marginBottom: '2px' }}>Duration</div>
              <input type="number" value={duration} onChange={e => setDuration(parseInt(e.target.value) || 10)} disabled={trafficRunning} style={{ width: '100%', padding: '4px', borderRadius: '4px', border: `1px solid ${colors.border}` }} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            {!trafficRunning ? (
              <button className="btn btn-primary" onClick={startTest} disabled={!trafficInterface || !tapConnected} style={{ flex: 1 }}>Start Test</button>
            ) : (
              <button className="btn" onClick={stopTest} style={{ flex: 1, background: '#fef2f2', color: colors.error }}>Stop</button>
            )}
            <button className="btn btn-secondary" onClick={() => setCapturedPackets([])}>Clear</button>
          </div>

          {/* Stats - Per TC */}
          <div style={{ marginTop: '10px' }}>
            <div style={{ fontSize: '0.65rem', color: colors.textMuted, marginBottom: '4px' }}>TX / RX per TC:</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '4px', fontSize: '0.65rem' }}>
              {[0,1,2,3,4,5,6,7].map(tc => {
                const tx = txByTc[tc] || 0
                const rx = rxByTc[tc] || 0
                const pass = tx > 0 ? ((rx / tx) * 100).toFixed(0) : '-'
                return (
                  <div key={tc} style={{ padding: '4px', background: colors.bgAlt, borderRadius: '4px', textAlign: 'center', borderTop: `3px solid ${tcColors[tc]}` }}>
                    <div style={{ fontWeight: '700', color: tcColors[tc] }}>TC{tc}</div>
                    <div style={{ color: '#3b82f6' }}>{tx}</div>
                    <div style={{ color: '#22c55e' }}>{rx}</div>
                    <div style={{ color: tx > 0 && rx === 0 ? colors.error : (pass === '100' ? colors.success : colors.warning), fontWeight: '600' }}>
                      {tx > 0 ? `${pass}%` : '-'}
                    </div>
                  </div>
                )
              })}
            </div>
            <div style={{ display: 'flex', gap: '16px', marginTop: '6px', fontSize: '0.65rem', color: colors.textMuted }}>
              <span>Total TX: <b style={{ color: '#3b82f6' }}>{txPackets.length}</b></span>
              <span>Total RX: <b style={{ color: '#22c55e' }}>{rxPackets.length}</b></span>
              <span>Pass: <b style={{ color: txPackets.length > 0 ? (rxPackets.length / txPackets.length > 0.9 ? colors.success : colors.warning) : colors.textMuted }}>
                {txPackets.length > 0 ? `${((rxPackets.length / txPackets.length) * 100).toFixed(0)}%` : '-'}
              </b></span>
            </div>
          </div>
        </div>
      </div>

      {/* Packet Timeline */}
      {capturedPackets.length > 0 && (
        <div className="card" style={{ marginBottom: '16px' }}>
          <div className="card-header">
            <h2 className="card-title">Packet Timeline</h2>
            <span style={{ fontSize: '0.7rem', color: colors.textMuted }}>TX: {txPackets.length} | RX: {rxPackets.length}</span>
          </div>

          {/* Timeline Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            {/* TX Timeline */}
            <div>
              <div style={{ fontSize: '0.65rem', color: colors.textMuted, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ background: '#3b82f6', color: '#fff', padding: '1px 6px', borderRadius: '3px', fontWeight: '600' }}>TX</span>
                송신
              </div>
              <div style={{ background: colors.bgAlt, borderRadius: '4px', padding: '8px' }}>
                <div style={{ display: 'flex' }}>
                  <div style={{ width: '30px' }}>
                    {[7,6,5,4,3,2,1,0].map(tc => (
                      <div key={tc} style={{ height: '14px', fontSize: '0.5rem', color: tcColors[tc], fontWeight: '600', textAlign: 'right', paddingRight: '4px' }}>TC{tc}</div>
                    ))}
                  </div>
                  <div style={{ flex: 1, position: 'relative', height: '112px', background: '#fff', border: `1px solid ${colors.border}`, borderRadius: '4px', overflow: 'hidden' }}>
                    {(() => {
                      const pkts = txPackets.filter(p => p.hasVlan).slice(-400)
                      if (pkts.length === 0) return <div style={{ padding: '20px', textAlign: 'center', color: colors.textLight, fontSize: '0.7rem' }}>No TX</div>
                      const minT = pkts[0]?.time || 0
                      const maxT = pkts[pkts.length - 1]?.time || 1
                      const range = Math.max(maxT - minT, 1)
                      return pkts.map((p, i) => (
                        <div key={i} style={{ position: 'absolute', left: `${((p.time - minT) / range) * 100}%`, top: `${(7 - p.pcp) * 14}px`, width: '2px', height: '12px', background: tcColors[p.pcp], opacity: 0.8 }} />
                      ))
                    })()}
                  </div>
                </div>
                {/* Time axis */}
                {txPackets.length > 0 && (() => {
                  const pkts = txPackets.filter(p => p.hasVlan)
                  if (pkts.length === 0) return null
                  const dur = ((pkts[pkts.length - 1]?.time || 0) - (pkts[0]?.time || 0)) / 1000
                  return (
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginLeft: '30px', marginTop: '4px', fontSize: '0.55rem', color: colors.textMuted }}>
                      <span>0s</span><span>{(dur/2).toFixed(1)}s</span><span>{dur.toFixed(1)}s</span>
                    </div>
                  )
                })()}
              </div>
            </div>

            {/* RX Timeline */}
            <div>
              <div style={{ fontSize: '0.65rem', color: colors.textMuted, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ background: '#22c55e', color: '#fff', padding: '1px 6px', borderRadius: '3px', fontWeight: '600' }}>RX</span>
                수신
              </div>
              <div style={{ background: colors.bgAlt, borderRadius: '4px', padding: '8px' }}>
                <div style={{ display: 'flex' }}>
                  <div style={{ width: '30px' }}>
                    {[7,6,5,4,3,2,1,0].map(tc => (
                      <div key={tc} style={{ height: '14px', fontSize: '0.5rem', color: tcColors[tc], fontWeight: '600', textAlign: 'right', paddingRight: '4px' }}>TC{tc}</div>
                    ))}
                  </div>
                  <div style={{ flex: 1, position: 'relative', height: '112px', background: '#fff', border: `1px solid ${colors.border}`, borderRadius: '4px', overflow: 'hidden' }}>
                    {(() => {
                      const pkts = rxPackets.filter(p => p.hasVlan).slice(-400)
                      if (pkts.length === 0) return <div style={{ padding: '20px', textAlign: 'center', color: colors.textLight, fontSize: '0.7rem' }}>No RX</div>
                      const minT = pkts[0]?.time || 0
                      const maxT = pkts[pkts.length - 1]?.time || 1
                      const range = Math.max(maxT - minT, 1)
                      return pkts.map((p, i) => (
                        <div key={i} style={{ position: 'absolute', left: `${((p.time - minT) / range) * 100}%`, top: `${(7 - p.pcp) * 14}px`, width: '2px', height: '12px', background: tcColors[p.pcp], opacity: 0.8 }} />
                      ))
                    })()}
                  </div>
                </div>
                {/* Time axis */}
                {rxPackets.length > 0 && (() => {
                  const pkts = rxPackets.filter(p => p.hasVlan)
                  if (pkts.length === 0) return null
                  const dur = ((pkts[pkts.length - 1]?.time || 0) - (pkts[0]?.time || 0)) / 1000
                  return (
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginLeft: '30px', marginTop: '4px', fontSize: '0.55rem', color: colors.textMuted }}>
                      <span>0s</span><span>{(dur/2).toFixed(1)}s</span><span>{dur.toFixed(1)}s</span>
                    </div>
                  )
                })()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Packet Capture Log - TX/RX Split */}
      {capturedPackets.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Packet Capture</h2>
            <span style={{ fontSize: '0.7rem', color: colors.textMuted }}>{capturedPackets.length} packets</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            {/* TX Packets */}
            <div>
              <div style={{ fontSize: '0.65rem', color: colors.textMuted, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ background: '#3b82f6', color: '#fff', padding: '1px 6px', borderRadius: '3px', fontWeight: '600' }}>TX</span>
                송신 ({txPackets.length})
              </div>
              <div style={{ maxHeight: '300px', overflowY: 'auto', background: colors.bgAlt, borderRadius: '4px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.65rem', fontFamily: 'monospace' }}>
                  <thead>
                    <tr style={{ background: '#dbeafe', position: 'sticky', top: 0 }}>
                      <th style={{ ...cellStyle, width: '60px' }}>Time</th>
                      <th style={{ ...cellStyle, width: '40px' }}>TC</th>
                      <th style={{ ...cellStyle, width: '40px' }}>Len</th>
                    </tr>
                  </thead>
                  <tbody>
                    {txPackets.slice(-30).reverse().map((pkt, idx) => {
                      const time = startTimeRef.current ? ((pkt.time - startTimeRef.current) / 1000).toFixed(3) : '0.000'
                      return (
                        <tr key={idx} style={{ background: '#eff6ff' }}>
                          <td style={cellStyle}>{time}s</td>
                          <td style={cellStyle}>
                            <span style={{ padding: '1px 4px', borderRadius: '3px', background: tcColors[pkt.pcp], color: '#fff', fontWeight: '600', fontSize: '0.6rem' }}>
                              {pkt.pcp}
                            </span>
                          </td>
                          <td style={cellStyle}>{pkt.length}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* RX Packets */}
            <div>
              <div style={{ fontSize: '0.65rem', color: colors.textMuted, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ background: '#22c55e', color: '#fff', padding: '1px 6px', borderRadius: '3px', fontWeight: '600' }}>RX</span>
                수신 ({rxPackets.length})
              </div>
              <div style={{ maxHeight: '300px', overflowY: 'auto', background: colors.bgAlt, borderRadius: '4px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.65rem', fontFamily: 'monospace' }}>
                  <thead>
                    <tr style={{ background: '#dcfce7', position: 'sticky', top: 0 }}>
                      <th style={{ ...cellStyle, width: '60px' }}>Time</th>
                      <th style={{ ...cellStyle, width: '40px' }}>TC</th>
                      <th style={{ ...cellStyle, width: '40px' }}>Len</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rxPackets.slice(-30).reverse().map((pkt, idx) => {
                      const time = startTimeRef.current ? ((pkt.time - startTimeRef.current) / 1000).toFixed(3) : '0.000'
                      return (
                        <tr key={idx} style={{ background: '#f0fdf4' }}>
                          <td style={cellStyle}>{time}s</td>
                          <td style={cellStyle}>
                            <span style={{ padding: '1px 4px', borderRadius: '3px', background: tcColors[pkt.pcp], color: '#fff', fontWeight: '600', fontSize: '0.6rem' }}>
                              {pkt.pcp}
                            </span>
                          </td>
                          <td style={cellStyle}>{pkt.length}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default TASDashboard
