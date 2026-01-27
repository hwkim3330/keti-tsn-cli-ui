import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import { useDevices } from '../contexts/DeviceContext'

function CBSDashboard() {
  const { devices, selectedDevice, selectDevice } = useDevices()

  // CBS status per port per device: { deviceId: { port1: {...}, port2: {...} } }
  const [cbsData, setCbsData] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Auto refresh
  const [autoRefresh, setAutoRefresh] = useState(false)
  const intervalRef = useRef(null)
  const fetchingRef = useRef(false)

  // Ports to monitor (1-12)
  const allPorts = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

  // Traffic Class colors
  const tcColors = {
    0: '#94a3b8', // slate
    1: '#f97316', // orange
    2: '#eab308', // yellow
    3: '#22c55e', // green
    4: '#06b6d4', // cyan
    5: '#3b82f6', // blue
    6: '#8b5cf6', // purple
    7: '#ec4899', // pink
  }

  const getQosPath = (port) => `/ietf-interfaces:interfaces/interface[name='${port}']/mchp-velocitysp-port:eth-qos/config`

  // Parse CBS shapers from YAML response
  const parseShapers = (yamlStr) => {
    if (!yamlStr) return []
    const shapers = []
    try {
      const lines = yamlStr.split('\n')
      let current = null
      for (const line of lines) {
        if (line.includes('traffic-class:')) {
          if (current) shapers.push(current)
          current = { tc: parseInt(line.split(':')[1].trim()) }
        } else if (line.includes('idle-slope:') && current) {
          current.idleSlope = parseInt(line.split(':')[1].trim())
        }
      }
      if (current) shapers.push(current)
    } catch {}
    return shapers
  }

  // Fetch CBS data for a single port on a device
  const fetchPortCBS = async (device, portNum) => {
    try {
      const res = await axios.post('/api/fetch', {
        paths: [`${getQosPath(portNum)}/traffic-class-shapers`],
        transport: device.transport,
        device: device.device,
        host: device.host,
        port: device.port || 5683
      }, { timeout: 8000 })

      return {
        online: true,
        shapers: parseShapers(res.data.result),
        raw: res.data.result
      }
    } catch (err) {
      return { online: false, shapers: [], error: err.message }
    }
  }

  // Fetch all ports for all devices
  const fetchAllCBS = async (silent = false) => {
    if (fetchingRef.current) return
    fetchingRef.current = true
    if (!silent) setLoading(true)

    try {
      const newData = {}

      for (const device of devices) {
        newData[device.id] = { online: false, ports: {} }

        // Fetch each port
        for (const portNum of allPorts) {
          const portData = await fetchPortCBS(device, portNum)
          newData[device.id].ports[portNum] = portData
          if (portData.online) newData[device.id].online = true

          // Update state progressively for better UX
          setCbsData(prev => ({
            ...prev,
            [device.id]: {
              ...prev[device.id],
              online: newData[device.id].online,
              ports: {
                ...prev[device.id]?.ports,
                [portNum]: portData
              }
            }
          }))

          // Small delay between requests
          await new Promise(r => setTimeout(r, 100))
        }
      }

      if (!silent) setError(null)
    } catch (err) {
      if (!silent) setError(err.message)
    } finally {
      fetchingRef.current = false
      if (!silent) setLoading(false)
    }
  }

  // Initial fetch
  useEffect(() => {
    if (devices.length > 0) {
      fetchAllCBS(false)
    }
  }, [devices])

  // Auto refresh
  useEffect(() => {
    if (autoRefresh && devices.length > 0) {
      intervalRef.current = setInterval(() => fetchAllCBS(true), 10000)
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [autoRefresh, devices])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  // Calculate statistics
  const getDeviceStats = (deviceId) => {
    const deviceData = cbsData[deviceId]
    if (!deviceData?.ports) return { totalShapers: 0, portsWithCBS: 0, totalBandwidth: 0, tcUsage: {} }

    let totalShapers = 0
    let portsWithCBS = 0
    let totalBandwidth = 0
    const tcUsage = {}

    for (const portNum of allPorts) {
      const portData = deviceData.ports[portNum]
      if (portData?.shapers?.length > 0) {
        portsWithCBS++
        totalShapers += portData.shapers.length
        for (const shaper of portData.shapers) {
          totalBandwidth += shaper.idleSlope || 0
          tcUsage[shaper.tc] = (tcUsage[shaper.tc] || 0) + (shaper.idleSlope || 0)
        }
      }
    }

    return { totalShapers, portsWithCBS, totalBandwidth, tcUsage }
  }

  // Get maximum bandwidth for scaling bars (link speed in kbps)
  const maxBandwidth = 1000000 // 1 Gbps in kbps

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">CBS Dashboard</h1>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            Auto (10s)
          </label>
          <button className="btn btn-secondary" onClick={() => fetchAllCBS(false)} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh All'}
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: '16px' }}>{error}</div>}

      {devices.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
          No devices configured. Go to Settings to add devices.
        </div>
      ) : (
        <>
          {/* Device Summary Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(devices.length, 2)}, 1fr)`, gap: '16px', marginBottom: '20px' }}>
            {devices.map(device => {
              const deviceData = cbsData[device.id]
              const stats = getDeviceStats(device.id)
              const isSelected = selectedDevice?.id === device.id

              return (
                <div
                  key={device.id}
                  onClick={() => selectDevice(device)}
                  style={{
                    padding: '20px',
                    background: isSelected ? '#f8fafc' : '#fff',
                    border: isSelected ? '2px solid #3b82f6' : '1px solid #e2e8f0',
                    borderRadius: '12px',
                    cursor: 'pointer',
                    transition: 'all 0.15s'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                    <div>
                      <div style={{ fontWeight: '600', fontSize: '1.1rem' }}>{device.name}</div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b', fontFamily: 'monospace' }}>
                        {device.transport === 'serial' ? device.device : device.host}
                      </div>
                    </div>
                    <div style={{
                      padding: '4px 12px',
                      borderRadius: '6px',
                      fontSize: '0.75rem',
                      fontWeight: '600',
                      background: !deviceData?.online ? '#fef2f2' : stats.portsWithCBS > 0 ? '#ecfdf5' : '#f8fafc',
                      color: !deviceData?.online ? '#b91c1c' : stats.portsWithCBS > 0 ? '#059669' : '#64748b'
                    }}>
                      {!deviceData?.online ? 'OFFLINE' : stats.portsWithCBS > 0 ? `${stats.portsWithCBS} PORTS` : 'NO CBS'}
                    </div>
                  </div>

                  {/* Stats */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '16px' }}>
                    <div style={{ textAlign: 'center', padding: '12px', background: '#f8fafc', borderRadius: '8px' }}>
                      <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#1e293b' }}>{stats.portsWithCBS}</div>
                      <div style={{ fontSize: '0.7rem', color: '#64748b' }}>Ports with CBS</div>
                    </div>
                    <div style={{ textAlign: 'center', padding: '12px', background: '#f8fafc', borderRadius: '8px' }}>
                      <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#1e293b' }}>{stats.totalShapers}</div>
                      <div style={{ fontSize: '0.7rem', color: '#64748b' }}>Total Shapers</div>
                    </div>
                    <div style={{ textAlign: 'center', padding: '12px', background: '#f8fafc', borderRadius: '8px' }}>
                      <div style={{ fontSize: '1.2rem', fontWeight: '700', color: '#1e293b' }}>
                        {stats.totalBandwidth > 0 ? `${(stats.totalBandwidth / 1000).toFixed(0)}` : '-'}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: '#64748b' }}>Total Mbps</div>
                    </div>
                  </div>

                  {/* TC Usage Bar */}
                  {Object.keys(stats.tcUsage).length > 0 && (
                    <div>
                      <div style={{ fontSize: '0.75rem', fontWeight: '600', marginBottom: '8px', color: '#475569' }}>
                        Traffic Class Distribution
                      </div>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        {Object.entries(stats.tcUsage).sort((a, b) => a[0] - b[0]).map(([tc, bw]) => (
                          <div
                            key={tc}
                            style={{
                              padding: '6px 12px',
                              background: tcColors[tc] || '#94a3b8',
                              color: '#fff',
                              borderRadius: '6px',
                              fontSize: '0.75rem',
                              fontWeight: '600'
                            }}
                          >
                            TC{tc}: {(bw / 1000).toFixed(0)} Mbps
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Port Details for Selected Device */}
          {selectedDevice && (
            <div className="card">
              <div className="card-header">
                <h2 className="card-title">Port CBS Configuration - {selectedDevice.name}</h2>
              </div>

              {/* Port Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
                {allPorts.map(portNum => {
                  const portData = cbsData[selectedDevice.id]?.ports?.[portNum]
                  const hasCBS = portData?.shapers?.length > 0
                  const totalBw = portData?.shapers?.reduce((sum, s) => sum + (s.idleSlope || 0), 0) || 0

                  return (
                    <div
                      key={portNum}
                      style={{
                        padding: '16px',
                        background: hasCBS ? '#f0fdf4' : '#f8fafc',
                        border: hasCBS ? '1px solid #bbf7d0' : '1px solid #e2e8f0',
                        borderRadius: '10px'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                        <div style={{ fontWeight: '700', fontSize: '0.9rem' }}>Port {portNum}</div>
                        {portData?.online === false ? (
                          <span style={{ fontSize: '0.7rem', color: '#b91c1c' }}>ERR</span>
                        ) : hasCBS ? (
                          <span style={{ fontSize: '0.7rem', color: '#059669', fontWeight: '600' }}>
                            {(totalBw / 1000).toFixed(0)} Mbps
                          </span>
                        ) : (
                          <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>-</span>
                        )}
                      </div>

                      {/* Bandwidth Bar */}
                      <div style={{ height: '8px', background: '#e2e8f0', borderRadius: '4px', marginBottom: '8px', overflow: 'hidden' }}>
                        {hasCBS && (
                          <div style={{ display: 'flex', height: '100%' }}>
                            {portData.shapers.map((shaper, i) => {
                              const width = ((shaper.idleSlope || 0) / maxBandwidth) * 100
                              return (
                                <div
                                  key={i}
                                  style={{
                                    width: `${Math.max(width, 1)}%`,
                                    background: tcColors[shaper.tc] || '#94a3b8',
                                    height: '100%'
                                  }}
                                  title={`TC${shaper.tc}: ${(shaper.idleSlope / 1000).toFixed(1)} Mbps`}
                                />
                              )
                            })}
                          </div>
                        )}
                      </div>

                      {/* Shaper List */}
                      {hasCBS ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {portData.shapers.map((shaper, i) => (
                            <span
                              key={i}
                              style={{
                                padding: '3px 8px',
                                background: tcColors[shaper.tc] || '#94a3b8',
                                color: '#fff',
                                borderRadius: '4px',
                                fontSize: '0.65rem',
                                fontWeight: '600'
                              }}
                            >
                              TC{shaper.tc}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div style={{ fontSize: '0.75rem', color: '#94a3b8', textAlign: 'center' }}>
                          No CBS
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* TC Legend */}
          <div className="card" style={{ marginTop: '16px' }}>
            <div className="card-header">
              <h2 className="card-title">Traffic Class Reference</h2>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
              {[0, 1, 2, 3, 4, 5, 6, 7].map(tc => (
                <div
                  key={tc}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px',
                    background: '#f8fafc',
                    borderRadius: '6px'
                  }}
                >
                  <div
                    style={{
                      width: '24px',
                      height: '24px',
                      borderRadius: '6px',
                      background: tcColors[tc],
                      flexShrink: 0
                    }}
                  />
                  <div>
                    <div style={{ fontWeight: '600', fontSize: '0.85rem' }}>TC {tc}</div>
                    <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                      {['Best Effort (BG)', 'Best Effort', 'Excellent Effort', 'Critical Apps',
                        'Video <100ms', 'Voice <10ms', 'Internetwork Ctrl', 'Network Ctrl'][tc]}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Comparison Table */}
          {devices.length > 1 && (
            <div className="card" style={{ marginTop: '16px' }}>
              <div className="card-header">
                <h2 className="card-title">Device Comparison</h2>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                      <th style={{ padding: '10px', textAlign: 'left' }}>Port</th>
                      {devices.map(device => (
                        <th key={device.id} style={{ padding: '10px', textAlign: 'center' }}>{device.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {allPorts.map(portNum => (
                      <tr key={portNum} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px 10px', fontWeight: '600' }}>Port {portNum}</td>
                        {devices.map(device => {
                          const portData = cbsData[device.id]?.ports?.[portNum]
                          const shapers = portData?.shapers || []

                          return (
                            <td key={device.id} style={{ padding: '8px 10px', textAlign: 'center' }}>
                              {shapers.length > 0 ? (
                                <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                                  {shapers.map((s, i) => (
                                    <span
                                      key={i}
                                      style={{
                                        padding: '2px 6px',
                                        background: tcColors[s.tc] || '#94a3b8',
                                        color: '#fff',
                                        borderRadius: '4px',
                                        fontSize: '0.65rem'
                                      }}
                                    >
                                      TC{s.tc}: {(s.idleSlope / 1000).toFixed(0)}M
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <span style={{ color: '#cbd5e1' }}>-</span>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default CBSDashboard
