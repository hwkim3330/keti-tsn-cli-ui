import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import axios from 'axios'
import { useDevices } from '../contexts/DeviceContext'

const TAP_INTERFACE = 'enxc84d44231cc2'
const TRAFFIC_INTERFACE_PREFIX = 'enx00e'
const BOARD2_PORT8_MAC = 'FA:AE:C9:26:A4:08'
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

function CBSDashboard() {
  const { devices } = useDevices()

  const [cbsData, setCbsData] = useState({})
  const [loading, setLoading] = useState(false)
  const [autoSetupStatus, setAutoSetupStatus] = useState(null)
  const [autoSetupMessage, setAutoSetupMessage] = useState('')

  const [trafficInterface, setTrafficInterface] = useState(null)
  const [trafficRunning, setTrafficRunning] = useState(false)
  const [selectedTCs, setSelectedTCs] = useState([0, 1, 2, 3, 4, 5, 6, 7])
  const [vlanId, setVlanId] = useState(100)
  const [packetsPerSecond, setPacketsPerSecond] = useState(1000)
  const [duration, setDuration] = useState(3)

  const [capturing, setCapturing] = useState(false)
  const [tapConnected, setTapConnected] = useState(false)
  const [capturedPackets, setCapturedPackets] = useState([])
  const wsRef = useRef(null)
  const startTimeRef = useRef(null)

  const board1 = devices.find(d => d.name?.includes('#1') || d.device?.includes('ACM0'))
  const board2 = devices.find(d => d.name?.includes('#2') || d.device?.includes('ACM1'))
  const CBS_PORT = 8
  const cbsBoard = board1 || board2  // Board 1 우선 (Port 9 UP인 보드)

  const getQosPath = (port) => `/ietf-interfaces:interfaces/interface[name='${port}']/mchp-velocitysp-port:eth-qos/config`

  // Fetch CBS status
  const fetchCBSStatus = async () => {
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
        const lines = res.data.result.split('\n')
        let current = null
        for (const line of lines) {
          if (line.includes('traffic-class:')) {
            if (current) shapers.push(current)
            current = { tc: parseInt(line.split(':')[1].trim()), idleSlope: 0 }
          } else if (line.includes('idle-slope:') && current) {
            current.idleSlope = parseInt(line.split(':')[1].trim())
          }
        }
        if (current) shapers.push(current)
      }
      setCbsData({ online: true, shapers, raw: res.data?.result })
    } catch {
      setCbsData({ online: false, shapers: [], error: 'Connection failed' })
    }
    setLoading(false)
  }

  // Auto Setup CBS - Configure idle-slope for each TC
  const autoSetupCBS = async () => {
    if (!cbsBoard) return
    setAutoSetupStatus('running')
    setAutoSetupMessage('Configuring CBS...')
    try {
      const patches = []
      // Configure CBS for TC2 and TC3 (common for AVB)
      const cbsConfigs = [
        { tc: 2, idleSlope: 50000 },  // 50 Mbps
        { tc: 3, idleSlope: 50000 },  // 50 Mbps
      ]

      for (const cfg of cbsConfigs) {
        patches.push({
          path: `${getQosPath(CBS_PORT)}/traffic-class-shapers`,
          value: {
            'traffic-class': cfg.tc,
            'credit-based': { 'idle-slope': cfg.idleSlope }
          }
        })
      }

      await axios.post('/api/patch', {
        patches,
        transport: cbsBoard.transport,
        device: cbsBoard.device,
        host: cbsBoard.host
      }, { timeout: 30000 })

      setAutoSetupStatus('success')
      setAutoSetupMessage('CBS configured!')
      setTimeout(() => { fetchCBSStatus(); setAutoSetupStatus(null) }, 1500)
    } catch (err) {
      setAutoSetupStatus('error')
      setAutoSetupMessage(`Failed: ${err.message}`)
    }
  }

  const resetCBS = async () => {
    if (!cbsBoard) return
    setAutoSetupStatus('running')
    try {
      // Reset by setting idle-slope to 0
      const patches = []
      for (let tc = 0; tc < 8; tc++) {
        patches.push({
          path: `${getQosPath(CBS_PORT)}/traffic-class-shapers`,
          value: {
            'traffic-class': tc,
            'credit-based': { 'idle-slope': 0 }
          }
        })
      }
      await axios.post('/api/patch', {
        patches,
        transport: cbsBoard.transport,
        device: cbsBoard.device,
        host: cbsBoard.host
      }, { timeout: 30000 })
      setAutoSetupStatus('success')
      setAutoSetupMessage('CBS reset')
      setTimeout(() => { fetchCBSStatus(); setAutoSetupStatus(null) }, 1500)
    } catch (err) {
      setAutoSetupStatus('error')
      setAutoSetupMessage(`Failed: ${err.message}`)
    }
  }

  // Auto-fetch CBS status when board is available
  useEffect(() => {
    if (cbsBoard) fetchCBSStatus()
  }, [cbsBoard])

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
    if (packet.length < 56 || packet.length > 1600) return

    const pcp = packet.vlan?.pcp ?? 0
    const hasVlan = !!packet.vlan
    const vid = packet.vlan?.vid || 0
    const srcMac = (packet.srcMac || packet.source || '').toLowerCase().replace(/[:-]/g, '')
    const isTx = packet.interface?.startsWith(TRAFFIC_INTERFACE_PREFIX)
    const isRx = packet.interface === TAP_INTERFACE

    // RX: only count packets from our TX source MAC with our VLAN ID
    if (isRx) {
      if (vid !== vlanId) return
      if (srcMac !== TX_SOURCE_MAC.replace(/[:-]/g, '')) return
    }

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
        dstMac: BOARD2_PORT8_MAC,
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

  // Build TC bandwidth matrix from cbsData
  const shaperByTc = {}
  cbsData.shapers?.forEach(s => { shaperByTc[s.tc] = s.idleSlope })

  // CBS Credit Analysis - estimate credit state from packet timing
  const cbsAnalysis = useMemo(() => {
    if (rxPackets.length < 10) return null

    const LINK_SPEED_KBPS = 1000000  // 1 Gbps
    const PACKET_SIZE_BITS = 60 * 8  // 60 bytes * 8 bits

    const tcStats = {}
    for (let tc = 0; tc < 8; tc++) {
      const tcPackets = rxPackets.filter(p => p.hasVlan && p.pcp === tc).sort((a, b) => a.time - b.time)
      if (tcPackets.length < 2) continue

      const idleSlope = shaperByTc[tc] || 0
      const sendSlope = idleSlope > 0 ? (idleSlope - LINK_SPEED_KBPS) : 0

      // Calculate inter-arrival times and throughput
      const intervals = []
      for (let i = 1; i < tcPackets.length; i++) {
        intervals.push(tcPackets[i].time - tcPackets[i-1].time)
      }

      const totalTime = (tcPackets[tcPackets.length-1].time - tcPackets[0].time) / 1000  // seconds
      const totalBits = tcPackets.length * PACKET_SIZE_BITS
      const actualThroughput = totalTime > 0 ? (totalBits / totalTime / 1000) : 0  // kbps

      // Simulate credit changes
      const creditHistory = []
      let credit = 0
      let lastTime = tcPackets[0]?.time || 0

      tcPackets.forEach((p, i) => {
        const dt = (p.time - lastTime) / 1000  // seconds
        if (idleSlope > 0 && dt > 0) {
          // Credit increases during idle time
          credit += idleSlope * dt
          credit = Math.min(credit, idleSlope * 0.01)  // hi-credit limit
        }
        // Credit decreases when sending
        if (sendSlope < 0) {
          const sendTime = PACKET_SIZE_BITS / LINK_SPEED_KBPS  // seconds
          credit += sendSlope * sendTime
          credit = Math.max(credit, sendSlope * 0.01)  // lo-credit limit
        }
        creditHistory.push({ time: p.time, credit })
        lastTime = p.time
      })

      tcStats[tc] = {
        count: tcPackets.length,
        avgInterval: intervals.length > 0 ? intervals.reduce((a,b) => a+b, 0) / intervals.length : 0,
        throughput: actualThroughput,
        idleSlope,
        utilization: idleSlope > 0 ? (actualThroughput / idleSlope * 100) : 0,
        creditHistory
      }
    }

    return tcStats
  }, [rxPackets, shaperByTc])

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">CBS Dashboard</h1>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {autoSetupStatus && (
            <span style={{ fontSize: '0.7rem', padding: '4px 8px', borderRadius: '4px', background: autoSetupStatus === 'success' ? '#dcfce7' : autoSetupStatus === 'error' ? '#fef2f2' : colors.bgAlt }}>
              {autoSetupMessage}
            </span>
          )}
          <button className="btn btn-secondary" onClick={fetchCBSStatus} disabled={loading}>{loading ? '...' : 'Refresh'}</button>
          <button className="btn btn-primary" onClick={autoSetupCBS} disabled={!cbsBoard}>Auto Setup</button>
          <button className="btn btn-secondary" onClick={resetCBS} disabled={!cbsBoard}>Reset</button>
        </div>
      </div>

      {/* CBS Config + Test Controls */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
        {/* CBS Configuration - 8 TC Matrix */}
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">CBS Configuration</h2>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ fontSize: '0.65rem', padding: '2px 6px', background: colors.bgAlt, borderRadius: '4px', color: colors.text, fontWeight: '600' }}>
                {cbsBoard?.name || '-'} ({cbsBoard?.device || '-'}) Port {CBS_PORT}
              </span>
              <span style={{ fontSize: '0.65rem', color: cbsData.shapers?.length > 0 ? colors.success : colors.textLight, fontWeight: '600' }}>
                {cbsData.shapers?.length > 0 ? `● ${cbsData.shapers.length} TC` : '○ OFF'}
              </span>
            </div>
          </div>

          {/* Credit-Based Shaper Matrix */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.7rem', fontFamily: 'monospace' }}>
              <thead>
                <tr>
                  {[0,1,2,3,4,5,6,7].map(tc => (
                    <th key={tc} style={{ ...headerStyle, width: '12.5%', textAlign: 'center', background: tcColors[tc], color: '#fff' }}>
                      TC{tc}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {[0,1,2,3,4,5,6,7].map(tc => {
                    const slope = shaperByTc[tc]
                    const hasSlope = slope && slope > 0
                    return (
                      <td key={tc} style={{ ...cellStyle, textAlign: 'center', background: hasSlope ? '#dcfce7' : '#fef2f2' }}>
                        {hasSlope ? `${(slope / 1000).toFixed(0)}M` : '-'}
                      </td>
                    )
                  })}
                </tr>
                <tr>
                  {[0,1,2,3,4,5,6,7].map(tc => {
                    const slope = shaperByTc[tc]
                    const hasSlope = slope && slope > 0
                    return (
                      <td key={tc} style={{ ...cellStyle, textAlign: 'center', fontSize: '0.6rem', color: colors.textMuted }}>
                        {hasSlope ? `${slope} kbps` : '-'}
                      </td>
                    )
                  })}
                </tr>
              </tbody>
            </table>
          </div>

          {/* Total Bandwidth */}
          <div style={{ display: 'flex', gap: '16px', marginTop: '8px', fontSize: '0.7rem', color: colors.textMuted }}>
            <span>Total: {cbsData.shapers?.reduce((s, x) => s + (x.idleSlope || 0), 0) / 1000 || 0} Mbps</span>
            <span>Shapers: {cbsData.shapers?.length || 0}</span>
          </div>

          {/* Shaper Details */}
          {cbsData.shapers?.length > 0 && (
            <div style={{ marginTop: '8px', padding: '8px', background: colors.bgAlt, borderRadius: '4px', fontSize: '0.7rem' }}>
              <div style={{ fontWeight: '600', marginBottom: '4px' }}>Active Shapers:</div>
              {cbsData.shapers.map((s, idx) => (
                <div key={idx} style={{ display: 'flex', gap: '8px', padding: '2px 0' }}>
                  <span style={{ padding: '1px 6px', borderRadius: '3px', background: tcColors[s.tc], color: '#fff', fontWeight: '600' }}>TC{s.tc}</span>
                  <span>Idle Slope: {s.idleSlope} kbps</span>
                  <span style={{ color: colors.textMuted }}>({(s.idleSlope / 1000).toFixed(1)} Mbps)</span>
                </div>
              ))}
            </div>
          )}
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

      {/* CBS Credit Analysis */}
      {cbsAnalysis && Object.keys(cbsAnalysis).length > 0 && (
        <div className="card" style={{ marginBottom: '16px' }}>
          <div className="card-header">
            <h2 className="card-title">CBS Analysis (Estimated)</h2>
            <span style={{ fontSize: '0.65rem', color: colors.textMuted }}>
              Credit-Based Shaper 분석 | {rxPackets.length} RX packets
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            {/* Throughput Analysis */}
            <div>
              <div style={{ fontSize: '0.65rem', color: colors.textMuted, marginBottom: '4px' }}>
                TC별 Throughput (설정 vs 실측)
              </div>
              <div style={{ background: colors.bgAlt, borderRadius: '4px', padding: '8px' }}>
                {[0,1,2,3,4,5,6,7].map(tc => {
                  const stats = cbsAnalysis[tc]
                  if (!stats) return null
                  const idleSlope = shaperByTc[tc] || 0
                  const barWidth = idleSlope > 0 ? Math.min(100, stats.utilization) : (stats.throughput > 0 ? 100 : 0)

                  return (
                    <div key={tc} style={{ marginBottom: '6px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                        <span style={{ padding: '1px 4px', borderRadius: '3px', background: tcColors[tc], color: '#fff', fontWeight: '600', fontSize: '0.55rem', minWidth: '28px', textAlign: 'center' }}>
                          TC{tc}
                        </span>
                        <span style={{ fontSize: '0.55rem', color: colors.textMuted }}>
                          {idleSlope > 0 ? `${(idleSlope/1000).toFixed(0)}M 설정` : 'CBS 없음'}
                        </span>
                        <span style={{ fontSize: '0.55rem', fontWeight: '600' }}>
                          → {(stats.throughput/1000).toFixed(1)} Mbps
                        </span>
                        {idleSlope > 0 && (
                          <span style={{ fontSize: '0.55rem', color: stats.utilization > 100 ? colors.error : colors.success }}>
                            ({stats.utilization.toFixed(0)}%)
                          </span>
                        )}
                      </div>
                      <div style={{ height: '4px', background: '#e2e8f0', borderRadius: '2px', overflow: 'hidden' }}>
                        <div style={{
                          width: `${barWidth}%`,
                          height: '100%',
                          background: idleSlope > 0
                            ? (stats.utilization > 100 ? colors.error : colors.success)
                            : tcColors[tc],
                          transition: 'width 0.3s'
                        }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Credit Simulation */}
            <div>
              <div style={{ fontSize: '0.65rem', color: colors.textMuted, marginBottom: '4px' }}>
                Credit 상태 (시뮬레이션)
              </div>
              <div style={{ background: colors.bgAlt, borderRadius: '4px', padding: '8px' }}>
                {[0,1,2,3,4,5,6,7].map(tc => {
                  const stats = cbsAnalysis[tc]
                  if (!stats || !shaperByTc[tc]) return null

                  const history = stats.creditHistory || []
                  const lastCredit = history[history.length - 1]?.credit || 0
                  const maxCredit = shaperByTc[tc] * 0.01
                  const minCredit = (shaperByTc[tc] - 1000000) * 0.01
                  const creditRange = maxCredit - minCredit
                  const creditPercent = creditRange > 0 ? ((lastCredit - minCredit) / creditRange * 100) : 50

                  return (
                    <div key={tc} style={{ marginBottom: '6px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                        <span style={{ padding: '1px 4px', borderRadius: '3px', background: tcColors[tc], color: '#fff', fontWeight: '600', fontSize: '0.55rem', minWidth: '28px', textAlign: 'center' }}>
                          TC{tc}
                        </span>
                        <span style={{ fontSize: '0.55rem', color: colors.textMuted }}>
                          Credit:
                        </span>
                        <span style={{ fontSize: '0.55rem', fontWeight: '600', color: lastCredit >= 0 ? colors.success : colors.error }}>
                          {lastCredit >= 0 ? '+' : ''}{lastCredit.toFixed(2)}
                        </span>
                        <span style={{ fontSize: '0.5rem', color: colors.textMuted }}>
                          ({stats.count} pkts, {stats.avgInterval.toFixed(1)}ms avg)
                        </span>
                      </div>
                      <div style={{ height: '8px', background: '#fef2f2', borderRadius: '4px', overflow: 'hidden', position: 'relative' }}>
                        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: '1px', background: '#666' }} />
                        <div style={{
                          position: 'absolute',
                          left: lastCredit >= 0 ? '50%' : `${creditPercent}%`,
                          width: lastCredit >= 0 ? `${Math.min(50, creditPercent - 50)}%` : `${50 - creditPercent}%`,
                          height: '100%',
                          background: lastCredit >= 0 ? colors.success : colors.error,
                          transition: 'all 0.3s'
                        }} />
                      </div>
                    </div>
                  )
                })}
                {Object.keys(cbsAnalysis).filter(tc => shaperByTc[tc]).length === 0 && (
                  <div style={{ fontSize: '0.6rem', color: colors.textMuted, textAlign: 'center', padding: '10px' }}>
                    CBS가 설정된 TC가 없습니다. Auto Setup으로 설정하세요.
                  </div>
                )}
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

export default CBSDashboard
