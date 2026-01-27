import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import { useDevices } from '../contexts/DeviceContext'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'

function Dashboard() {
  const { devices } = useDevices()
  const [deviceStatuses, setDeviceStatuses] = useState({})
  const [loading, setLoading] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const intervalRef = useRef(null)

  // PTP config
  const [ptpPort, setPtpPort] = useState(8)
  const [configuringPtp, setConfiguringPtp] = useState(false)

  // Offset history for graph
  const [offsetHistory, setOffsetHistory] = useState([])
  const MAX_HISTORY = 60

  // Fetch status for a single device
  const fetchDeviceStatus = async (device) => {
    try {
      const ptpRes = await axios.post('/api/fetch', {
        paths: ['/ieee1588-ptp:ptp/instances/instance[instance-index=\'0\']'],
        transport: device.transport,
        device: device.device,
        host: device.host,
        port: device.port || 5683
      }, { timeout: 8000 })

      const ptpStatus = parsePtpStatus(ptpRes.data.result)

      return {
        online: true,
        ptpStatus,
        raw: ptpRes.data.result,
        lastCheck: Date.now()
      }
    } catch (err) {
      return {
        online: false,
        error: err.message,
        lastCheck: Date.now()
      }
    }
  }

  // Parse PTP status from YAML
  const parsePtpStatus = (result) => {
    if (!result || result.includes('instance: null')) return null
    const status = {
      clockIdentity: null,
      grandmasterIdentity: null,
      isGrandmaster: false,
      servoOffset: null,
      servoState: null,
      portState: null,
      asCapable: null,
      meanLinkDelay: null,
      profile: null
    }
    const lines = result.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('clock-identity:')) {
        status.clockIdentity = trimmed.split(':').slice(1).join(':').trim()
      } else if (trimmed.startsWith('grandmaster-identity:')) {
        status.grandmasterIdentity = trimmed.split(':').slice(1).join(':').trim()
      } else if (trimmed.startsWith('port-state:')) {
        status.portState = trimmed.split(':')[1]?.trim()
      } else if (trimmed.startsWith('as-capable:')) {
        status.asCapable = trimmed.includes('true')
      } else if (trimmed.startsWith('mean-link-delay:')) {
        const val = trimmed.split(':')[1]?.trim().replace(/'/g, '')
        status.meanLinkDelay = parseInt(val) || 0
      } else if (trimmed.startsWith('profile:')) {
        status.profile = trimmed.split(':')[1]?.trim()
      }
    }
    // Servo info
    const servoMatch = result.match(/servo:[\s\S]*?offset:\s*'?(-?\d+)'?[\s\S]*?state:\s*(\d+)/)
    if (servoMatch) {
      status.servoOffset = parseInt(servoMatch[1])
      status.servoState = parseInt(servoMatch[2])
    }
    if (status.clockIdentity && status.grandmasterIdentity) {
      status.isGrandmaster = status.clockIdentity === status.grandmasterIdentity
    }
    return status
  }

  // Fetch all devices
  const fetchAll = async () => {
    setLoading(true)
    const newStatuses = {}
    const timestamp = new Date().toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    const historyEntry = { time: timestamp }

    for (const device of devices) {
      const status = await fetchDeviceStatus(device)
      newStatuses[device.id] = status

      // Add offset to history
      if (status.ptpStatus && status.ptpStatus.servoOffset !== null && status.ptpStatus.servoOffset !== undefined) {
        historyEntry[device.name] = status.ptpStatus.servoOffset
      }
      await new Promise(r => setTimeout(r, 200))
    }

    setDeviceStatuses(newStatuses)

    // Update offset history
    if (Object.keys(historyEntry).length > 1) {
      setOffsetHistory(prev => {
        const updated = [...prev, historyEntry]
        return updated.slice(-MAX_HISTORY)
      })
    }

    setLoading(false)
  }

  // Initial fetch
  useEffect(() => {
    if (devices.length > 0) fetchAll()
  }, [devices])

  // Auto refresh
  useEffect(() => {
    if (autoRefresh && devices.length > 0) {
      intervalRef.current = setInterval(fetchAll, 2000)
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [autoRefresh, devices])

  // Configure PTP properly based on documentation
  const configurePtp = async (gmDeviceId) => {
    setConfiguringPtp(true)

    for (const device of devices) {
      const isGm = device.id === gmDeviceId
      try {
        // Based on VelocityDRIVE documentation
        const patches = [
          {
            path: '/ieee1588-ptp:ptp/instances/instance',
            value: {
              'instance-index': 0,
              'default-ds': {
                'external-port-config-enable': true
              },
              'mchp-velocitysp-ptp:automotive': {
                profile: isGm ? 'gm' : 'bridge'
              },
              'mchp-velocitysp-ptp:servos': {
                servo: [{
                  'servo-index': 0,
                  'servo-type': 'pi',
                  'ltc-index': 0
                }]
              },
              ports: {
                port: [{
                  'port-index': ptpPort,
                  'external-port-config-port-ds': {
                    'desired-state': isGm ? 'master' : 'slave'
                  }
                }]
              }
            }
          },
          {
            path: '/ieee1588-ptp:ptp/mchp-velocitysp-ptp:ltcs/ltc',
            value: {
              'ltc-index': 0,
              'ptp-pins': {
                'ptp-pin': [{
                  index: 4,
                  function: '1pps-out'
                }]
              }
            }
          }
        ]

        await axios.post('/api/patch', {
          patches,
          transport: device.transport,
          device: device.device,
          host: device.host,
          port: device.port || 5683
        }, { timeout: 10000 })

      } catch (err) {
        console.error(`PTP config error for ${device.name}:`, err)
      }
      await new Promise(r => setTimeout(r, 500))
    }

    setConfiguringPtp(false)
    setOffsetHistory([]) // Clear history after reconfig
    setTimeout(fetchAll, 1500)
  }

  const servoStateText = (state) => {
    const states = { 0: 'Init', 1: 'Tracking', 2: 'Locked', 3: 'Holdover' }
    return states[state] || '-'
  }

  const servoStateColor = (state) => {
    if (state === 1 || state === 2) return '#059669'
    if (state === 3) return '#d97706'
    return '#64748b'
  }

  const portStateColor = (state) => {
    if (state === 'master') return '#7c3aed'
    if (state === 'slave') return '#0891b2'
    if (state === 'passive') return '#d97706'
    return '#94a3b8'
  }

  // Check sync status
  const gmDevice = devices.find(d => deviceStatuses[d.id]?.ptpStatus?.isGrandmaster)
  const slaveDevice = devices.find(d => {
    const status = deviceStatuses[d.id]?.ptpStatus
    return status && !status.isGrandmaster && status.servoState >= 1
  })
  const isSynced = gmDevice && slaveDevice

  // Colors for chart
  const chartColors = ['#6366f1', '#f59e0b']

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Port:</span>
          <select
            className="form-select"
            value={ptpPort}
            onChange={(e) => setPtpPort(parseInt(e.target.value))}
            style={{ width: '60px', padding: '4px 6px', fontSize: '0.8rem' }}
          >
            {[1,2,3,4,5,6,7,8,9,10,11,12].map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            Auto
          </label>
          <button className="btn btn-secondary" onClick={fetchAll} disabled={loading}>
            {loading ? '...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Device Cards */}
      {devices.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
          No devices configured. Go to Settings.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: devices.length === 1 ? '1fr' : '1fr auto 1fr', gap: '12px', marginBottom: '16px', alignItems: 'stretch' }}>
          {devices.map((device, idx) => {
            const status = deviceStatuses[device.id]
            const ptp = status?.ptpStatus

            return (
              <div key={device.id} className="card" style={{
                padding: '16px',
                background: ptp?.isGrandmaster ? '#fafaf9' : '#fff',
                border: status?.online ? (ptp?.isGrandmaster ? '2px solid #57534e' : '1px solid #e2e8f0') : '1px solid #fca5a5'
              }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <div>
                    <div style={{ fontWeight: '600', fontSize: '1rem' }}>{device.name}</div>
                    <div style={{ fontSize: '0.7rem', color: '#64748b', fontFamily: 'monospace' }}>
                      {device.host}
                    </div>
                  </div>
                  {status?.online ? (
                    <span style={{
                      padding: '3px 10px',
                      borderRadius: '6px',
                      fontSize: '0.7rem',
                      fontWeight: '600',
                      background: ptp?.isGrandmaster ? '#292524' : ptp ? '#e0f2fe' : '#f1f5f9',
                      color: ptp?.isGrandmaster ? '#fff' : ptp ? '#0369a1' : '#64748b'
                    }}>
                      {ptp?.isGrandmaster ? 'GM' : ptp ? 'SLAVE' : 'NO PTP'}
                    </span>
                  ) : (
                    <span style={{ padding: '3px 10px', borderRadius: '6px', fontSize: '0.7rem', fontWeight: '600', background: '#fef2f2', color: '#b91c1c' }}>
                      OFFLINE
                    </span>
                  )}
                </div>

                {/* PTP Details */}
                {status?.online && ptp && (
                  <div style={{ fontSize: '0.8rem', marginBottom: '12px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '8px' }}>
                      <div style={{ padding: '8px', background: '#f8fafc', borderRadius: '6px' }}>
                        <div style={{ fontSize: '0.6rem', color: '#94a3b8' }}>Port State</div>
                        <div style={{ fontWeight: '600', color: portStateColor(ptp.portState) }}>
                          {ptp.portState || '-'}
                        </div>
                      </div>
                      <div style={{ padding: '8px', background: '#f8fafc', borderRadius: '6px' }}>
                        <div style={{ fontSize: '0.6rem', color: '#94a3b8' }}>Servo</div>
                        <div style={{ fontWeight: '600', color: servoStateColor(ptp.servoState) }}>
                          {servoStateText(ptp.servoState)}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                      <div style={{ padding: '8px', background: '#f8fafc', borderRadius: '6px' }}>
                        <div style={{ fontSize: '0.6rem', color: '#94a3b8' }}>Offset</div>
                        <div style={{ fontWeight: '600', fontFamily: 'monospace', color: chartColors[idx] }}>
                          {ptp.servoOffset !== null ? `${ptp.servoOffset} ns` : '-'}
                        </div>
                      </div>
                      <div style={{ padding: '8px', background: '#f8fafc', borderRadius: '6px' }}>
                        <div style={{ fontSize: '0.6rem', color: '#94a3b8' }}>Link Delay</div>
                        <div style={{ fontWeight: '500', fontFamily: 'monospace' }}>
                          {ptp.meanLinkDelay ? `${(ptp.meanLinkDelay / 65536).toFixed(0)} ns` : '-'}
                        </div>
                      </div>
                    </div>
                    {ptp.profile && ptp.profile !== 'none' && (
                      <div style={{ marginTop: '6px', fontSize: '0.65rem', color: '#64748b' }}>
                        Profile: <b>{ptp.profile}</b>
                      </div>
                    )}
                  </div>
                )}

                {status?.online === false && (
                  <div style={{ padding: '10px', background: '#fef2f2', borderRadius: '6px', marginBottom: '12px', fontSize: '0.75rem', color: '#b91c1c' }}>
                    {status.error || 'Connection failed'}
                  </div>
                )}

                {/* Set GM Button */}
                <button
                  className="btn btn-primary"
                  onClick={() => configurePtp(device.id)}
                  disabled={configuringPtp || !status?.online}
                  style={{ width: '100%', fontSize: '0.75rem', padding: '8px' }}
                >
                  {configuringPtp ? 'Configuring...' : 'Set as GM'}
                </button>
              </div>
            )
          })}

          {/* Sync Arrow */}
          {devices.length === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
              {isSynced ? (
                <>
                  <svg width="32" height="20" viewBox="0 0 32 20" fill="none">
                    <path d="M0 10H24M24 10L18 4M24 10L18 16" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span style={{ fontSize: '0.65rem', color: '#059669', fontWeight: '600' }}>SYNC</span>
                </>
              ) : (
                <>
                  <svg width="32" height="20" viewBox="0 0 32 20" fill="none">
                    <path d="M0 10H24M24 10L18 4M24 10L18 16" stroke="#d1d5db" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span style={{ fontSize: '0.65rem', color: '#94a3b8' }}>-</span>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Offset Graph */}
      {offsetHistory.length > 1 && (
        <div className="card" style={{ marginBottom: '16px' }}>
          <div className="card-header">
            <h2 className="card-title">PTP Offset History</h2>
            <button
              className="btn btn-secondary"
              onClick={() => setOffsetHistory([])}
              style={{ fontSize: '0.7rem', padding: '4px 8px' }}
            >
              Clear
            </button>
          </div>
          <div style={{ height: '200px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={offsetHistory} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="#94a3b8" />
                <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" unit=" ns" />
                <Tooltip
                  contentStyle={{ fontSize: '0.75rem', background: '#fff', border: '1px solid #e2e8f0' }}
                  formatter={(value) => [`${value} ns`, '']}
                />
                <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
                {devices.map((device, idx) => (
                  <Line
                    key={device.id}
                    type="monotone"
                    dataKey={device.name}
                    stroke={chartColors[idx]}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: 'flex', gap: '16px', marginTop: '8px', justifyContent: 'center' }}>
            {devices.map((device, idx) => (
              <div key={device.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem' }}>
                <div style={{ width: '12px', height: '3px', background: chartColors[idx], borderRadius: '2px' }}></div>
                <span>{device.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick Links */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Quick Links</h2>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <a href="/ptp" className="btn btn-secondary" style={{ fontSize: '0.8rem' }}>PTP Config</a>
          <a href="/tas" className="btn btn-secondary" style={{ fontSize: '0.8rem' }}>TAS</a>
          <a href="/cbs" className="btn btn-secondary" style={{ fontSize: '0.8rem' }}>CBS</a>
          <a href="/ports" className="btn btn-secondary" style={{ fontSize: '0.8rem' }}>Ports</a>
          <a href="/capture" className="btn btn-secondary" style={{ fontSize: '0.8rem' }}>Capture</a>
          <a href="/settings" className="btn btn-secondary" style={{ fontSize: '0.8rem' }}>Settings</a>
        </div>
      </div>
    </div>
  )
}

export default Dashboard
