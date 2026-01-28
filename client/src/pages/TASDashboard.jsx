import { useState, useEffect, useRef, useCallback } from 'react'
import axios from 'axios'
import { useDevices } from '../contexts/DeviceContext'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell, Legend, AreaChart, Area, ComposedChart } from 'recharts'

const TAP_INTERFACE = 'enxc84d44231cc2'
const TRAFFIC_INTERFACE_PREFIX = 'enx00e'
const BOARD2_PORT8_MAC = 'FA:AE:C9:26:A4:08'
const TRAFFIC_API = 'http://localhost:3001'  // Separate traffic server

// Professional color palette
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

// Traffic Class colors
const tcColors = {
  0: '#94a3b8',
  1: '#f97316',
  2: '#eab308',
  3: '#22c55e',
  4: '#06b6d4',
  5: '#3b82f6',
  6: '#8b5cf6',
  7: '#ec4899',
}

const tcNames = ['BE(BG)', 'BE', 'EE', 'CA', 'Video', 'Voice', 'IC', 'NC']

function TASDashboard() {
  const { devices } = useDevices()

  // TAS data (with localStorage cache)
  const [tasData, setTasData] = useState(() => {
    try {
      const cached = localStorage.getItem('tasData')
      return cached ? JSON.parse(cached) : {}
    } catch { return {} }
  })
  const [loading, setLoading] = useState(false)

  // Save to localStorage when tasData changes
  useEffect(() => {
    if (Object.keys(tasData).length > 0) {
      localStorage.setItem('tasData', JSON.stringify(tasData))
    }
  }, [tasData])

  // Auto setup
  const [autoSetupStatus, setAutoSetupStatus] = useState(null)
  const [autoSetupMessage, setAutoSetupMessage] = useState('')

  // Traffic generator - multiple TCs
  const [trafficInterface, setTrafficInterface] = useState(null)
  const [trafficRunning, setTrafficRunning] = useState(false)
  const [selectedTCs, setSelectedTCs] = useState([1, 2, 3, 4, 5, 6, 7]) // TC 1-7 all
  const [vlanId, setVlanId] = useState(100)
  const [packetsPerSecond, setPacketsPerSecond] = useState(50) // per TC
  const [duration, setDuration] = useState(30)
  const [trafficStats, setTrafficStats] = useState({})
  const trafficIntervalsRef = useRef({})

  // Packet capture
  const [capturing, setCapturing] = useState(false)
  const [tapConnected, setTapConnected] = useState(false)
  const [capturedPackets, setCapturedPackets] = useState([])
  const wsRef = useRef(null)

  // Time series data for visualization
  const [timeSeriesData, setTimeSeriesData] = useState([])
  const [sentCounts, setSentCounts] = useState({}) // TC -> count
  const [capturedCounts, setCapturedCounts] = useState({}) // TC -> count
  const startTimeRef = useRef(null)

  const board1 = devices.find(d => d.host === '10.42.0.11' || d.name.includes('#1'))

  const getBasePath = (port) => `/ietf-interfaces:interfaces/interface[name='${port}']/ieee802-dot1q-bridge:bridge-port/ieee802-dot1q-sched-bridge:gate-parameter-table`

  // Parse TAS status
  const parseStatus = (yamlStr) => {
    if (!yamlStr) return null
    const status = { gateEnabled: false, adminGateStates: 255, cycleTimeNs: 0, adminControlList: [] }
    try {
      status.gateEnabled = yamlStr.includes('gate-enabled: true')
      const adminGatesMatch = yamlStr.match(/admin-gate-states:\s*(\d+)/)
      if (adminGatesMatch) status.adminGateStates = parseInt(adminGatesMatch[1])
      const cycleMatch = yamlStr.match(/admin-cycle-time:[\s\S]*?numerator:\s*(\d+)/)
      if (cycleMatch) status.cycleTimeNs = parseInt(cycleMatch[1])
      const adminSection = yamlStr.match(/admin-control-list:[\s\S]*?(?=oper-control-list:|admin-cycle-time:|$)/)?.[0]
      if (adminSection) {
        const entries = adminSection.match(/gate-states-value:\s*(\d+)[\s\S]*?time-interval-value:\s*(\d+)/g)
        if (entries) {
          status.adminControlList = entries.map(e => {
            const gs = e.match(/gate-states-value:\s*(\d+)/)?.[1]
            const ti = e.match(/time-interval-value:\s*(\d+)/)?.[1]
            return { gateStates: parseInt(gs) || 0, timeInterval: parseInt(ti) || 0 }
          })
        }
      }
      return status
    } catch { return status }
  }

  // Fetch TAS status (fetch individual fields to avoid CBOR size issues)
  const fetchTASStatus = async () => {
    if (!board1) {
      setTasData(prev => ({ ...prev, port8: { online: false, error: 'Board 1 not found' } }))
      return
    }
    setLoading(true)
    try {
      const basePath = getBasePath(8)
      const fields = ['gate-enabled', 'admin-gate-states', 'admin-cycle-time', 'admin-control-list']
      const results = await Promise.all(fields.map(field =>
        axios.post('/api/fetch', {
          paths: [`${basePath}/${field}`],
          transport: board1.transport || 'wifi',
          host: board1.host,
          port: board1.port || 5683
        }, { timeout: 10000 }).catch(() => null)
      ))

      const status = { gateEnabled: false, adminGateStates: 255, cycleTimeNs: 0, adminControlList: [], online: true }
      results.forEach((res, i) => {
        if (!res?.data?.result) return
        const yaml = res.data.result
        if (fields[i] === 'gate-enabled') status.gateEnabled = yaml.includes('true')
        if (fields[i] === 'admin-gate-states') {
          const m = yaml.match(/admin-gate-states:\s*(\d+)/)
          if (m) status.adminGateStates = parseInt(m[1])
        }
        if (fields[i] === 'admin-cycle-time') {
          const m = yaml.match(/numerator:\s*(\d+)/)
          if (m) status.cycleTimeNs = parseInt(m[1])
        }
        if (fields[i] === 'admin-control-list') {
          const entries = yaml.match(/gate-states-value:\s*(\d+)[\s\S]*?time-interval-value:\s*(\d+)/g)
          if (entries) {
            status.adminControlList = entries.map(e => {
              const gs = e.match(/gate-states-value:\s*(\d+)/)?.[1]
              const ti = e.match(/time-interval-value:\s*(\d+)/)?.[1]
              return { gateStates: parseInt(gs) || 0, timeInterval: parseInt(ti) || 0 }
            })
          }
        }
      })
      setTasData(prev => ({ ...prev, port8: status }))
    } catch (err) {
      setTasData(prev => ({ ...prev, port8: { online: false, error: 'Connection failed' } }))
    }
    setLoading(false)
  }

  // Auto Setup TAS
  const autoSetupTAS = async () => {
    if (!board1) {
      setAutoSetupStatus('error')
      setAutoSetupMessage('Board 1 not configured')
      return
    }

    setAutoSetupStatus('running')
    setAutoSetupMessage('Configuring TAS...')

    try {
      const basePath = getBasePath(8)
      // TC1-7 only (TC0 always open - Best Effort background)
      const gclEntries = []
      for (let i = 1; i <= 7; i++) {
        gclEntries.push({
          index: i - 1,
          'operation-name': 'ieee802-dot1q-sched:set-gate-states',
          'time-interval-value': 125000,
          'gate-states-value': (1 << i) | 1  // TC[i] + TC0 always open
        })
      }

      const patches = [
        { path: `${basePath}/gate-enabled`, value: true },
        { path: `${basePath}/admin-gate-states`, value: 255 },
        { path: `${basePath}/admin-control-list/gate-control-entry`, value: gclEntries },
        { path: `${basePath}/admin-cycle-time/numerator`, value: 875000 },  // 7 slots × 125μs
        { path: `${basePath}/admin-cycle-time/denominator`, value: 1 },
        { path: `${basePath}/admin-cycle-time-extension`, value: 0 },
        { path: `${basePath}/admin-base-time/seconds`, value: '0' },
        { path: `${basePath}/admin-base-time/nanoseconds`, value: 0 },
      ]

      await axios.post('/api/patch', { patches, transport: board1.transport, host: board1.host, port: board1.port || 5683 }, { timeout: 30000 })
      await axios.post('/api/patch', {
        patches: [{ path: `${basePath}/config-change`, value: true }],
        transport: board1.transport, host: board1.host, port: board1.port || 5683
      }, { timeout: 10000 })

      setAutoSetupStatus('success')
      setAutoSetupMessage('TAS: 7 slots × 125μs (TC1-7, TC0 always open)')
      setTimeout(() => { fetchTASStatus(); setTimeout(() => { setAutoSetupStatus(null) }, 2000) }, 1000)
    } catch (err) {
      setAutoSetupStatus('error')
      setAutoSetupMessage(`Failed: ${err.message}`)
    }
  }

  // Reset TAS (disable)
  const resetTAS = async () => {
    if (!board1) return

    setAutoSetupStatus('running')
    setAutoSetupMessage('Disabling TAS...')

    try {
      const basePath = getBasePath(8)
      await axios.post('/api/patch', {
        patches: [{ path: `${basePath}/gate-enabled`, value: false }],
        transport: board1.transport, host: board1.host, port: board1.port || 5683
      }, { timeout: 15000 })

      setAutoSetupStatus('success')
      setAutoSetupMessage('TAS disabled')
      setTimeout(() => { fetchTASStatus(); setTimeout(() => { setAutoSetupStatus(null) }, 2000) }, 1000)
    } catch (err) {
      setAutoSetupStatus('error')
      setAutoSetupMessage(`Failed: ${err.message}`)
    }
  }

  // Fetch interfaces
  useEffect(() => {
    const fetchInterfaces = async () => {
      try {
        const res = await axios.get(`${TRAFFIC_API}/api/traffic/interfaces`)
        const trafficIf = res.data.find(i => i.name.startsWith(TRAFFIC_INTERFACE_PREFIX))
        if (trafficIf) setTrafficInterface(trafficIf.name)
      } catch {}
    }
    fetchInterfaces()
    // Don't auto-fetch TAS status - use Refresh button instead
  }, [devices])

  // WebSocket for capture
  useEffect(() => {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${wsProtocol}//${window.location.host}/ws/capture`

    const connect = () => {
      const ws = new WebSocket(wsUrl)
      ws.onopen = () => setTapConnected(true)
      ws.onclose = () => { setTapConnected(false); setTimeout(connect, 3000) }
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'sync') {
            setCapturing(msg.data.running && msg.data.activeCaptures.some(c => c.interface === TAP_INTERFACE))
          } else if (msg.type === 'packet' && msg.data.interface === TAP_INTERFACE) {
            handleCapturedPacket(msg.data)
          } else if (msg.type === 'stopped') {
            setCapturing(false)
          }
        } catch {}
      }
      wsRef.current = ws
    }
    connect()
    return () => { if (wsRef.current) wsRef.current.close() }
  }, [])

  // Handle captured packet - distinguish TX vs RX
  const handleCapturedPacket = useCallback((packet) => {
    // Skip PTP packets
    if (packet.protocol === 'PTP') return
    // Skip non-test traffic (only count packets with our test characteristics)
    if (packet.length < 60 || packet.length > 200) return

    const pcp = packet.vlan?.pcp ?? 0
    const vid = packet.vlan?.vid ?? 0
    const isTx = packet.interface?.startsWith(TRAFFIC_INTERFACE_PREFIX)
    const isRx = packet.interface === TAP_INTERFACE

    // Add to packet log
    setCapturedPackets(prev => [...prev, {
      time: Date.now(),
      pcp,
      length: packet.length,
      vid,
      src: packet.source,
      dst: packet.destination,
      iface: packet.interface,
      direction: isTx ? 'TX' : (isRx ? 'RX' : '?')
    }].slice(-1000))

    // Count by direction
    if (isTx) {
      // TX packet - count as sent (has VLAN tag with PCP)
      setSentCounts(prev => ({ ...prev, [pcp]: (prev[pcp] || 0) + 1 }))
    } else if (isRx) {
      // RX packet - count as captured
      setCapturedCounts(prev => ({ ...prev, [pcp]: (prev[pcp] || 0) + 1 }))
    }
  }, [])

  // Poll traffic status (only for checking if still running)
  const pollTrafficStatus = useCallback(async () => {
    try {
      const res = await axios.get(`${TRAFFIC_API}/api/traffic/status`)
      // Only update running status - counts come from TX capture
      if (!res.data.running) {
        setTrafficRunning(false)
      }
    } catch {}
  }, [])

  // Start test (traffic + capture on both TX and RX)
  const startTest = async () => {
    if (!trafficInterface || selectedTCs.length === 0) return

    // Clear previous data
    setCapturedPackets([])
    setSentCounts({})
    setCapturedCounts({})
    setTimeSeriesData([])
    setTrafficStats({})
    startTimeRef.current = Date.now()

    // Start capture on BOTH TX and RX interfaces
    try {
      await axios.post('/api/capture/start', {
        interfaces: [trafficInterface, TAP_INTERFACE],
        captureMode: 'all'
      })
      setCapturing(true)
    } catch (err) {
      console.error('Capture failed:', err)
    }

    // Start traffic generator (all TCs in round-robin)
    setTrafficRunning(true)

    try {
      await axios.post(`${TRAFFIC_API}/api/traffic/start`, {
        interface: trafficInterface,
        dstMac: BOARD2_PORT8_MAC,
        vlanId: vlanId,
        tcList: selectedTCs,
        packetSize: 100,
        packetsPerSecond: packetsPerSecond,
        duration: duration
      })
    } catch (err) {
      console.error('Failed to start traffic:', err)
      setTrafficRunning(false)
    }

    // Auto stop after duration + 2s buffer
    setTimeout(() => {
      stopTest()
    }, (duration + 2) * 1000)
  }

  // Stop test
  const stopTest = async () => {
    setTrafficRunning(false)

    // Stop all traffic generators on the interface
    try {
      await axios.post(`${TRAFFIC_API}/api/traffic/stop`, { interface: trafficInterface })
    } catch {}

    // Stop capture on both interfaces
    try {
      await axios.post('/api/capture/stop', { interfaces: [trafficInterface, TAP_INTERFACE] })
      setCapturing(false)
    } catch {}
  }

  // Update time series data and poll traffic status periodically
  useEffect(() => {
    if (!trafficRunning && !capturing) return

    const interval = setInterval(() => {
      const now = Date.now()
      const elapsed = startTimeRef.current ? Math.floor((now - startTimeRef.current) / 1000) : 0

      // Poll traffic server for real-time sent counts
      if (trafficRunning) {
        pollTrafficStatus()
      }

      setTimeSeriesData(prev => {
        const newEntry = { time: elapsed, second: `${elapsed}s` }
        for (let tc = 0; tc < 8; tc++) {
          newEntry[`sent${tc}`] = sentCounts[tc] || 0
          newEntry[`cap${tc}`] = capturedCounts[tc] || 0
        }
        return [...prev, newEntry].slice(-60)
      })
    }, 500) // Poll every 500ms for smoother updates

    return () => clearInterval(interval)
  }, [trafficRunning, capturing, sentCounts, capturedCounts, pollTrafficStatus])

  // Clear all
  const clearAll = () => {
    setCapturedPackets([])
    setSentCounts({})
    setCapturedCounts({})
    setTimeSeriesData([])
    setTrafficStats({})
  }

  // Toggle TC selection
  const toggleTC = (tc) => {
    setSelectedTCs(prev => prev.includes(tc) ? prev.filter(t => t !== tc) : [...prev, tc].sort())
  }

  // Render GCL timeline
  const renderGCLTimeline = (controlList, cycleTimeNs) => {
    if (!controlList || controlList.length === 0) return null
    const totalTime = controlList.reduce((sum, e) => sum + e.timeInterval, 0)
    if (totalTime === 0) return null

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
        {[7, 6, 5, 4, 3, 2, 1, 0].map(tc => (
          <div key={tc} style={{ display: 'flex', alignItems: 'center', height: '18px' }}>
            <div style={{ width: '32px', fontSize: '0.65rem', color: colors.textMuted, textAlign: 'right', paddingRight: '6px' }}>
              TC{tc}
            </div>
            <div style={{ flex: 1, display: 'flex', background: colors.bgAlt, borderRadius: '2px', overflow: 'hidden', height: '14px' }}>
              {controlList.map((entry, idx) => {
                const width = (entry.timeInterval / totalTime) * 100
                const isOpen = entry.gateStates & (1 << tc)
                return (
                  <div key={idx} style={{ width: `${width}%`, height: '100%', background: isOpen ? tcColors[tc] : 'transparent', borderRight: idx < controlList.length - 1 ? '1px solid rgba(255,255,255,0.3)' : 'none' }} />
                )
              })}
            </div>
          </div>
        ))}
        <div style={{ marginLeft: '38px', marginTop: '4px', fontSize: '0.6rem', color: colors.textLight }}>
          Cycle: {(cycleTimeNs / 1000).toFixed(0)} μs | {controlList.length} slots
        </div>
      </div>
    )
  }

  // Comparison chart data
  const comparisonData = [0, 1, 2, 3, 4, 5, 6, 7].map(tc => ({
    tc: `TC${tc}`,
    name: tcNames[tc],
    sent: sentCounts[tc] || 0,
    captured: capturedCounts[tc] || 0,
    color: tcColors[tc]
  })).filter(d => d.sent > 0 || d.captured > 0)

  const totalSent = Object.values(sentCounts).reduce((a, b) => a + b, 0)
  const totalCaptured = Object.values(capturedCounts).reduce((a, b) => a + b, 0)

  const statBox = { padding: '8px 10px', background: colors.bg, borderRadius: '4px', border: `1px solid ${colors.border}` }
  const statLabel = { fontSize: '0.55rem', color: colors.textMuted, marginBottom: '2px', textTransform: 'uppercase' }
  const statValue = { fontWeight: '600', fontSize: '0.8rem', fontFamily: 'monospace', color: colors.text }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">TAS Dashboard</h1>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {autoSetupStatus && (
            <div style={{
              padding: '4px 10px', borderRadius: '4px', fontSize: '0.7rem',
              background: autoSetupStatus === 'running' ? colors.bgAlt : autoSetupStatus === 'success' ? '#dcfce7' : '#fef2f2',
              color: autoSetupStatus === 'running' ? colors.textMuted : autoSetupStatus === 'success' ? '#166534' : colors.error,
            }}>
              {autoSetupStatus === 'running' ? '⏳' : autoSetupStatus === 'success' ? '✓' : '✕'} {autoSetupMessage}
            </div>
          )}
          <button className="btn btn-secondary" onClick={fetchTASStatus} disabled={loading} style={{ fontSize: '0.75rem', padding: '6px 12px' }}>
            {loading ? '...' : 'Refresh'}
          </button>
          <button className="btn btn-primary" onClick={autoSetupTAS} disabled={autoSetupStatus === 'running' || !board1} style={{ fontSize: '0.75rem', padding: '6px 12px' }}>
            Auto Setup
          </button>
          <button className="btn btn-secondary" onClick={resetTAS} disabled={autoSetupStatus === 'running' || !board1} style={{ fontSize: '0.75rem', padding: '6px 12px' }}>
            Reset
          </button>
        </div>
      </div>

      {/* TAS Config + Test Controls */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
        {/* TAS Configuration */}
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">TAS Configuration</h2>
            <span style={{ fontSize: '0.65rem', color: tasData.port8?.gateEnabled ? colors.success : colors.textLight, fontWeight: '600' }}>
              {tasData.port8?.gateEnabled ? 'ENABLED' : 'DISABLED'}
            </span>
          </div>

          {tasData.port8?.online ? (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '12px' }}>
                <div style={statBox}><div style={statLabel}>Cycle</div><div style={statValue}>{tasData.port8.cycleTimeNs ? `${(tasData.port8.cycleTimeNs / 1000).toFixed(0)} μs` : '-'}</div></div>
                <div style={statBox}><div style={statLabel}>Slots</div><div style={statValue}>{tasData.port8.adminControlList?.length || 0}</div></div>
                <div style={statBox}><div style={statLabel}>Gate States</div><div style={statValue}>{tasData.port8.adminGateStates ?? '-'}</div></div>
              </div>
              {tasData.port8.gateEnabled && tasData.port8.adminControlList?.length > 0 && renderGCLTimeline(tasData.port8.adminControlList, tasData.port8.cycleTimeNs)}
            </div>
          ) : (
            <div style={{ padding: '20px', textAlign: 'center', color: colors.textLight, fontSize: '0.8rem' }}>
              {tasData.port8?.error || 'Loading...'}
            </div>
          )}
        </div>

        {/* Test Controls */}
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Traffic Test</h2>
          </div>

          {/* Interface Info */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', fontSize: '0.7rem' }}>
            <div style={{ flex: 1, padding: '6px 10px', background: trafficInterface ? '#ecfdf5' : '#fef2f2', borderRadius: '4px', border: `1px solid ${trafficInterface ? '#86efac' : '#fecaca'}` }}>
              <span style={{ color: colors.textMuted }}>TX: </span>
              <span style={{ fontFamily: 'monospace', fontWeight: '600', color: trafficInterface ? colors.success : colors.error }}>
                {trafficInterface || 'Not found'}
              </span>
            </div>
            <div style={{ flex: 1, padding: '6px 10px', background: tapConnected ? '#ecfdf5' : '#fef2f2', borderRadius: '4px', border: `1px solid ${tapConnected ? '#86efac' : '#fecaca'}` }}>
              <span style={{ color: colors.textMuted }}>RX: </span>
              <span style={{ fontFamily: 'monospace', fontWeight: '600', color: tapConnected ? colors.success : colors.error }}>
                {TAP_INTERFACE}
              </span>
            </div>
          </div>

          {/* TC Selection */}
          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontSize: '0.65rem', color: colors.textMuted, marginBottom: '6px' }}>Select Traffic Classes to Send:</div>
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              {[0, 1, 2, 3, 4, 5, 6, 7].map(tc => (
                <button
                  key={tc}
                  onClick={() => !trafficRunning && toggleTC(tc)}
                  disabled={trafficRunning}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '4px',
                    border: selectedTCs.includes(tc) ? 'none' : `1px solid ${colors.border}`,
                    background: selectedTCs.includes(tc) ? tcColors[tc] : colors.bg,
                    color: selectedTCs.includes(tc) ? '#fff' : colors.textMuted,
                    fontSize: '0.7rem',
                    fontWeight: '600',
                    cursor: trafficRunning ? 'not-allowed' : 'pointer',
                    opacity: trafficRunning ? 0.6 : 1
                  }}
                >
                  TC{tc}
                </button>
              ))}
            </div>
          </div>

          {/* Settings */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '12px' }}>
            <div>
              <label style={{ fontSize: '0.6rem', color: colors.textMuted }}>VLAN ID</label>
              <input type="number" value={vlanId} onChange={(e) => setVlanId(parseInt(e.target.value) || 0)} disabled={trafficRunning}
                style={{ width: '100%', padding: '4px 6px', borderRadius: '4px', border: `1px solid ${colors.border}`, fontSize: '0.75rem' }} />
            </div>
            <div>
              <label style={{ fontSize: '0.6rem', color: colors.textMuted }}>Pkts/sec/TC</label>
              <input type="number" value={packetsPerSecond} onChange={(e) => setPacketsPerSecond(parseInt(e.target.value) || 1)} disabled={trafficRunning}
                style={{ width: '100%', padding: '4px 6px', borderRadius: '4px', border: `1px solid ${colors.border}`, fontSize: '0.75rem' }} />
            </div>
            <div>
              <label style={{ fontSize: '0.6rem', color: colors.textMuted }}>Duration (s)</label>
              <input type="number" value={duration} onChange={(e) => setDuration(parseInt(e.target.value) || 10)} disabled={trafficRunning}
                style={{ width: '100%', padding: '4px 6px', borderRadius: '4px', border: `1px solid ${colors.border}`, fontSize: '0.75rem' }} />
            </div>
          </div>

          {/* Start/Stop */}
          <div style={{ display: 'flex', gap: '8px' }}>
            {!trafficRunning ? (
              <button className="btn btn-primary" onClick={startTest} disabled={!trafficInterface || !tapConnected || selectedTCs.length === 0} style={{ flex: 1 }}>
                Start Test
              </button>
            ) : (
              <button className="btn" onClick={stopTest} style={{ flex: 1, background: '#fef2f2', color: colors.error, border: `1px solid #fecaca` }}>
                Stop
              </button>
            )}
            <button className="btn btn-secondary" onClick={clearAll} disabled={trafficRunning}>Clear</button>
          </div>

          {/* Progress Bar */}
          {(trafficRunning || capturing) && (
            <div style={{ marginTop: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: colors.textMuted, marginBottom: '4px' }}>
                <span>{trafficRunning ? 'Sending...' : 'Capturing...'}</span>
                <span>{startTimeRef.current ? `${Math.floor((Date.now() - startTimeRef.current) / 1000)}s / ${duration}s` : ''}</span>
              </div>
              <div style={{ height: '4px', background: colors.bgAlt, borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{
                  width: `${startTimeRef.current ? Math.min(100, ((Date.now() - startTimeRef.current) / (duration * 1000)) * 100) : 0}%`,
                  height: '100%',
                  background: trafficRunning ? colors.success : colors.accent,
                  transition: 'width 0.5s'
                }} />
              </div>
            </div>
          )}

          {/* Status */}
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <div style={{ ...statBox, flex: 1, background: trafficRunning ? '#ecfdf5' : colors.bg }}>
              <div style={statLabel}>Sent</div>
              <div style={statValue}>{totalSent.toLocaleString()}</div>
            </div>
            <div style={{ ...statBox, flex: 1, background: capturing ? '#eff6ff' : colors.bg }}>
              <div style={statLabel}>Captured</div>
              <div style={statValue}>{totalCaptured.toLocaleString()}</div>
            </div>
            <div style={{ ...statBox, flex: 1 }}>
              <div style={statLabel}>Ratio</div>
              <div style={{ ...statValue, color: totalSent > 0 ? (totalCaptured / totalSent > 0.9 ? colors.success : colors.warning) : colors.textLight }}>
                {totalSent > 0 ? `${((totalCaptured / totalSent) * 100).toFixed(1)}%` : '-'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Comparison Charts */}
      {comparisonData.length > 0 && (
        <div className="card" style={{ marginBottom: '16px' }}>
          <div className="card-header">
            <h2 className="card-title">Traffic Comparison: Sent vs Captured</h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            {/* Bar Chart - Sent vs Captured by TC */}
            <div>
              <div style={{ fontSize: '0.7rem', color: colors.textMuted, marginBottom: '8px', fontWeight: '600' }}>Packets by Traffic Class</div>
              <div style={{ height: '200px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={comparisonData} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={colors.border} />
                    <XAxis dataKey="tc" tick={{ fontSize: 10 }} stroke={colors.textLight} />
                    <YAxis tick={{ fontSize: 10 }} stroke={colors.textLight} />
                    <Tooltip contentStyle={{ fontSize: '0.7rem' }} />
                    <Legend wrapperStyle={{ fontSize: '0.65rem' }} />
                    <Bar dataKey="sent" name="Sent" fill={colors.accent} />
                    <Bar dataKey="captured" name="Captured" fill={colors.success} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Pie-like visualization - TC distribution */}
            <div>
              <div style={{ fontSize: '0.7rem', color: colors.textMuted, marginBottom: '8px', fontWeight: '600' }}>Captured TC Distribution</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {comparisonData.filter(d => d.captured > 0).map(d => {
                  const pct = totalCaptured > 0 ? (d.captured / totalCaptured * 100) : 0
                  return (
                    <div key={d.tc} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ width: '40px', fontSize: '0.7rem', fontWeight: '600', color: d.color }}>{d.tc}</div>
                      <div style={{ flex: 1, height: '20px', background: colors.bgAlt, borderRadius: '4px', overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: d.color, transition: 'width 0.3s' }} />
                      </div>
                      <div style={{ width: '60px', fontSize: '0.7rem', color: colors.textMuted, textAlign: 'right' }}>
                        {d.captured} ({pct.toFixed(1)}%)
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Time Series Chart */}
      {timeSeriesData.length > 1 && (
        <div className="card" style={{ marginBottom: '16px' }}>
          <div className="card-header">
            <h2 className="card-title">Captured Packets Over Time</h2>
          </div>

          <div style={{ height: '250px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timeSeriesData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={colors.border} />
                <XAxis dataKey="second" tick={{ fontSize: 10 }} stroke={colors.textLight} />
                <YAxis tick={{ fontSize: 10 }} stroke={colors.textLight} />
                <Tooltip contentStyle={{ fontSize: '0.7rem' }} />
                <Legend wrapperStyle={{ fontSize: '0.65rem' }} />
                {selectedTCs.map(tc => (
                  <Area key={tc} type="monotone" dataKey={`cap${tc}`} name={`TC${tc}`} stroke={tcColors[tc]} fill={tcColors[tc]} fillOpacity={0.6} stackId="1" />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div style={{ marginTop: '10px', padding: '10px', background: colors.bgAlt, borderRadius: '6px', fontSize: '0.7rem', color: colors.textMuted }}>
            <b>TAS 동작 원리:</b> 각 TC 패킷은 GCL에 정의된 시간 슬롯에서만 전송됨.
            TC{selectedTCs.join(', TC')}가 선택되었으며, TAS가 활성화되면 각 TC는 할당된 125μs 슬롯에서만 통과.
          </div>
        </div>
      )}

      {/* Recent Captured Packets - Simple View */}
      {capturedPackets.length > 0 && (
        <div className="card" style={{ marginBottom: '16px' }}>
          <div className="card-header">
            <h2 className="card-title">Packet Log</h2>
            <span style={{ fontSize: '0.7rem', color: colors.textMuted, fontFamily: 'monospace' }}>
              TX: {capturedPackets.filter(p => p.direction === 'TX').length} | RX: {capturedPackets.filter(p => p.direction === 'RX').length}
            </span>
          </div>
          <div style={{ maxHeight: '150px', overflow: 'auto', padding: '8px', background: colors.bgAlt, borderRadius: '4px', fontSize: '0.7rem', fontFamily: 'monospace' }}>
            {capturedPackets.slice(-30).reverse().map((pkt, idx) => (
              <div key={idx} style={{ display: 'flex', gap: '8px', padding: '2px 0', borderBottom: `1px solid ${colors.border}` }}>
                <span style={{
                  padding: '0 4px',
                  borderRadius: '3px',
                  background: pkt.direction === 'TX' ? '#3b82f6' : '#22c55e',
                  color: '#fff',
                  fontWeight: '600',
                  fontSize: '0.6rem'
                }}>{pkt.direction}</span>
                <span style={{ color: colors.textLight, width: '65px' }}>{new Date(pkt.time).toLocaleTimeString()}</span>
                <span style={{
                  padding: '0 6px',
                  borderRadius: '3px',
                  background: tcColors[pkt.pcp],
                  color: '#fff',
                  fontWeight: '600',
                  minWidth: '35px',
                  textAlign: 'center'
                }}>TC{pkt.pcp}</span>
                <span style={{ color: colors.textMuted }}>{pkt.length}B</span>
                <span style={{ color: colors.textLight }}>{pkt.vid ? `VID:${pkt.vid}` : 'no-tag'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Detailed Stats Table */}
      {comparisonData.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Detailed Statistics</h2>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${colors.border}` }}>
                <th style={{ padding: '8px', textAlign: 'left' }}>Traffic Class</th>
                <th style={{ padding: '8px', textAlign: 'right' }}>Sent</th>
                <th style={{ padding: '8px', textAlign: 'right' }}>Captured</th>
                <th style={{ padding: '8px', textAlign: 'right' }}>Loss</th>
                <th style={{ padding: '8px', textAlign: 'right' }}>Ratio</th>
              </tr>
            </thead>
            <tbody>
              {comparisonData.map(d => {
                const loss = d.sent - d.captured
                const ratio = d.sent > 0 ? (d.captured / d.sent * 100) : 0
                return (
                  <tr key={d.tc} style={{ borderBottom: `1px solid ${colors.border}` }}>
                    <td style={{ padding: '8px' }}>
                      <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '3px', background: d.color, marginRight: '8px', verticalAlign: 'middle' }} />
                      <span style={{ fontWeight: '600' }}>{d.tc}</span>
                      <span style={{ color: colors.textMuted, marginLeft: '6px' }}>{d.name}</span>
                    </td>
                    <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace' }}>{d.sent.toLocaleString()}</td>
                    <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace' }}>{d.captured.toLocaleString()}</td>
                    <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace', color: loss > 0 ? colors.warning : colors.success }}>
                      {loss > 0 ? `-${loss}` : '0'}
                    </td>
                    <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace', fontWeight: '600', color: ratio >= 90 ? colors.success : ratio >= 50 ? colors.warning : colors.error }}>
                      {ratio.toFixed(1)}%
                    </td>
                  </tr>
                )
              })}
              <tr style={{ background: colors.bgAlt, fontWeight: '600' }}>
                <td style={{ padding: '8px' }}>Total</td>
                <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace' }}>{totalSent.toLocaleString()}</td>
                <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace' }}>{totalCaptured.toLocaleString()}</td>
                <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace', color: (totalSent - totalCaptured) > 0 ? colors.warning : colors.success }}>
                  {totalSent - totalCaptured > 0 ? `-${totalSent - totalCaptured}` : '0'}
                </td>
                <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace' }}>
                  {totalSent > 0 ? `${(totalCaptured / totalSent * 100).toFixed(1)}%` : '-'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default TASDashboard
