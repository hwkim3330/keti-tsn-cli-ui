import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import { useDevices } from '../contexts/DeviceContext'

function TASDashboard() {
  const { devices, selectedDevice, selectDevice } = useDevices()

  // TAS data per port per device
  const [tasData, setTasData] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Auto refresh
  const [autoRefresh, setAutoRefresh] = useState(false)
  const intervalRef = useRef(null)
  const fetchingRef = useRef(false)

  // Ports to monitor
  const allPorts = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

  // Traffic Class colors (same as CBS for consistency)
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

  const getBasePath = (port) => `/ietf-interfaces:interfaces/interface[name='${port}']/ieee802-dot1q-bridge:bridge-port/ieee802-dot1q-sched-bridge:gate-parameter-table`

  // Parse TAS status from YAML
  const parseStatus = (yamlStr) => {
    if (!yamlStr) return null
    const status = {
      gateEnabled: false,
      adminGateStates: 255,
      operGateStates: 255,
      cycleTimeNs: 0,
      cycleTimeExtNs: 0,
      configPending: false,
      adminControlList: [],
      operControlList: []
    }

    try {
      status.gateEnabled = yamlStr.includes('gate-enabled: true')

      const adminGatesMatch = yamlStr.match(/admin-gate-states:\s*(\d+)/)
      if (adminGatesMatch) status.adminGateStates = parseInt(adminGatesMatch[1])

      const operGatesMatch = yamlStr.match(/oper-gate-states:\s*(\d+)/)
      if (operGatesMatch) status.operGateStates = parseInt(operGatesMatch[1])

      // Cycle time numerator
      const cycleMatch = yamlStr.match(/admin-cycle-time:[\s\S]*?numerator:\s*(\d+)/)
      if (cycleMatch) status.cycleTimeNs = parseInt(cycleMatch[1])

      // Cycle time extension
      const extMatch = yamlStr.match(/admin-cycle-time-extension:\s*(\d+)/)
      if (extMatch) status.cycleTimeExtNs = parseInt(extMatch[1])

      status.configPending = yamlStr.includes('config-pending: true')

      // Parse admin control list
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

      // Parse oper control list similarly
      const operSection = yamlStr.match(/oper-control-list:[\s\S]*?(?=oper-cycle-time:|$)/)?.[0]
      if (operSection) {
        const entries = operSection.match(/gate-states-value:\s*(\d+)[\s\S]*?time-interval-value:\s*(\d+)/g)
        if (entries) {
          status.operControlList = entries.map(e => {
            const gs = e.match(/gate-states-value:\s*(\d+)/)?.[1]
            const ti = e.match(/time-interval-value:\s*(\d+)/)?.[1]
            return { gateStates: parseInt(gs) || 0, timeInterval: parseInt(ti) || 0 }
          })
        }
      }

      return status
    } catch {
      return status
    }
  }

  // Fetch TAS data for a single port
  const fetchPortTAS = async (device, portNum) => {
    try {
      const res = await axios.post('/api/fetch', {
        paths: [getBasePath(portNum)],
        transport: device.transport,
        device: device.device,
        host: device.host,
        port: device.port || 5683
      }, { timeout: 8000 })

      const parsed = parseStatus(res.data.result)
      return { ...parsed, online: true, raw: res.data.result }
    } catch (err) {
      return { online: false, error: err.message }
    }
  }

  // Fetch all ports for all devices
  const fetchAllTAS = async (silent = false) => {
    if (fetchingRef.current) return
    fetchingRef.current = true
    if (!silent) setLoading(true)

    try {
      for (const device of devices) {
        for (const portNum of allPorts) {
          const portData = await fetchPortTAS(device, portNum)

          setTasData(prev => ({
            ...prev,
            [device.id]: {
              ...prev[device.id],
              online: portData.online || prev[device.id]?.online,
              ports: {
                ...prev[device.id]?.ports,
                [portNum]: portData
              }
            }
          }))

          await new Promise(r => setTimeout(r, 80))
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
      fetchAllTAS(false)
    }
  }, [devices])

  // Auto refresh
  useEffect(() => {
    if (autoRefresh && devices.length > 0) {
      intervalRef.current = setInterval(() => fetchAllTAS(true), 10000)
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [autoRefresh, devices])

  // Cleanup
  useEffect(() => {
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [])

  // Calculate device statistics
  const getDeviceStats = (deviceId) => {
    const deviceData = tasData[deviceId]
    if (!deviceData?.ports) return { enabledPorts: 0, totalGCLEntries: 0, avgCycleTimeUs: 0 }

    let enabledPorts = 0
    let totalGCLEntries = 0
    let totalCycleTime = 0
    let cycleCount = 0

    for (const portNum of allPorts) {
      const port = deviceData.ports[portNum]
      if (port?.gateEnabled) {
        enabledPorts++
        totalGCLEntries += port.adminControlList?.length || 0
        if (port.cycleTimeNs > 0) {
          totalCycleTime += port.cycleTimeNs
          cycleCount++
        }
      }
    }

    return {
      enabledPorts,
      totalGCLEntries,
      avgCycleTimeUs: cycleCount > 0 ? (totalCycleTime / cycleCount / 1000).toFixed(0) : 0
    }
  }

  // Convert gate states integer to array of open TCs
  const getOpenTCs = (gateStates) => {
    const open = []
    for (let i = 0; i < 8; i++) {
      if (gateStates & (1 << i)) open.push(i)
    }
    return open
  }

  // Render GCL timeline visualization
  const renderGCLTimeline = (controlList, cycleTimeNs) => {
    if (!controlList || controlList.length === 0) return null

    const totalTime = controlList.reduce((sum, e) => sum + e.timeInterval, 0)
    if (totalTime === 0) return null

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {/* Timeline for each TC */}
        {[7, 6, 5, 4, 3, 2, 1, 0].map(tc => {
          let position = 0
          return (
            <div key={tc} style={{ display: 'flex', alignItems: 'center', height: '16px' }}>
              <div style={{ width: '24px', fontSize: '0.65rem', color: '#64748b', textAlign: 'right', paddingRight: '4px' }}>
                T{tc}
              </div>
              <div style={{ flex: 1, display: 'flex', background: '#f1f5f9', borderRadius: '2px', overflow: 'hidden' }}>
                {controlList.map((entry, idx) => {
                  const width = (entry.timeInterval / totalTime) * 100
                  const isOpen = entry.gateStates & (1 << tc)
                  const segment = (
                    <div
                      key={idx}
                      style={{
                        width: `${width}%`,
                        height: '100%',
                        background: isOpen ? tcColors[tc] : 'transparent',
                        borderRight: idx < controlList.length - 1 ? '1px solid rgba(0,0,0,0.1)' : 'none'
                      }}
                      title={`${isOpen ? 'Open' : 'Closed'}: ${(entry.timeInterval / 1000).toFixed(0)}us`}
                    />
                  )
                  position += entry.timeInterval
                  return segment
                })}
              </div>
            </div>
          )
        })}
        {/* Time markers */}
        <div style={{ display: 'flex', marginLeft: '28px', marginTop: '4px' }}>
          <div style={{ fontSize: '0.6rem', color: '#94a3b8' }}>0</div>
          <div style={{ flex: 1, textAlign: 'center', fontSize: '0.6rem', color: '#94a3b8' }}>
            {(totalTime / 1000).toFixed(0)} us
          </div>
          <div style={{ fontSize: '0.6rem', color: '#94a3b8' }}>
            {cycleTimeNs > 0 ? `(cycle: ${(cycleTimeNs / 1000).toFixed(0)} us)` : ''}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">TAS Dashboard</h1>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            Auto (10s)
          </label>
          <button className="btn btn-secondary" onClick={() => fetchAllTAS(false)} disabled={loading}>
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
              const deviceData = tasData[device.id]
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
                      background: !deviceData?.online ? '#fef2f2' : stats.enabledPorts > 0 ? '#ecfdf5' : '#f8fafc',
                      color: !deviceData?.online ? '#b91c1c' : stats.enabledPorts > 0 ? '#059669' : '#64748b'
                    }}>
                      {!deviceData?.online ? 'OFFLINE' : stats.enabledPorts > 0 ? `${stats.enabledPorts} PORTS` : 'NO TAS'}
                    </div>
                  </div>

                  {/* Stats */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                    <div style={{ textAlign: 'center', padding: '12px', background: '#f8fafc', borderRadius: '8px' }}>
                      <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#1e293b' }}>{stats.enabledPorts}</div>
                      <div style={{ fontSize: '0.7rem', color: '#64748b' }}>TAS Enabled</div>
                    </div>
                    <div style={{ textAlign: 'center', padding: '12px', background: '#f8fafc', borderRadius: '8px' }}>
                      <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#1e293b' }}>{stats.totalGCLEntries}</div>
                      <div style={{ fontSize: '0.7rem', color: '#64748b' }}>GCL Entries</div>
                    </div>
                    <div style={{ textAlign: 'center', padding: '12px', background: '#f8fafc', borderRadius: '8px' }}>
                      <div style={{ fontSize: '1.2rem', fontWeight: '700', color: '#1e293b' }}>
                        {stats.avgCycleTimeUs > 0 ? stats.avgCycleTimeUs : '-'}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: '#64748b' }}>Avg Cycle (us)</div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Port Grid for Selected Device */}
          {selectedDevice && (
            <div className="card">
              <div className="card-header">
                <h2 className="card-title">Port TAS Status - {selectedDevice.name}</h2>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                {allPorts.map(portNum => {
                  const portData = tasData[selectedDevice.id]?.ports?.[portNum]
                  const hasTAS = portData?.gateEnabled
                  const gcl = portData?.adminControlList || []

                  return (
                    <div
                      key={portNum}
                      style={{
                        padding: '16px',
                        background: hasTAS ? '#f0fdf4' : '#f8fafc',
                        border: hasTAS ? '1px solid #bbf7d0' : '1px solid #e2e8f0',
                        borderRadius: '10px'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                        <div style={{ fontWeight: '700', fontSize: '0.9rem' }}>Port {portNum}</div>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          {portData?.configPending && (
                            <span style={{ fontSize: '0.65rem', padding: '2px 6px', background: '#fef3c7', color: '#92400e', borderRadius: '4px' }}>
                              Pending
                            </span>
                          )}
                          <span style={{
                            fontSize: '0.7rem',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            background: hasTAS ? '#dcfce7' : '#f1f5f9',
                            color: hasTAS ? '#15803d' : '#64748b',
                            fontWeight: '600'
                          }}>
                            {hasTAS ? 'ON' : 'OFF'}
                          </span>
                        </div>
                      </div>

                      {hasTAS ? (
                        <>
                          {/* Info row */}
                          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', fontSize: '0.75rem' }}>
                            <span style={{ padding: '2px 6px', background: '#e0f2fe', borderRadius: '4px', color: '#0369a1' }}>
                              {(portData.cycleTimeNs / 1000).toFixed(0)} us
                            </span>
                            <span style={{ padding: '2px 6px', background: '#f1f5f9', borderRadius: '4px', color: '#64748b' }}>
                              {gcl.length} entries
                            </span>
                          </div>

                          {/* GCL Timeline */}
                          {renderGCLTimeline(gcl, portData.cycleTimeNs)}
                        </>
                      ) : (
                        <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: '0.8rem', padding: '20px 0' }}>
                          TAS Disabled
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Detailed GCL View for Selected Device */}
          {selectedDevice && (
            <div className="card" style={{ marginTop: '16px' }}>
              <div className="card-header">
                <h2 className="card-title">Gate Control List Details</h2>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                      <th style={{ padding: '10px', textAlign: 'left' }}>Port</th>
                      <th style={{ padding: '10px', textAlign: 'center' }}>Status</th>
                      <th style={{ padding: '10px', textAlign: 'center' }}>Cycle</th>
                      <th style={{ padding: '10px', textAlign: 'left' }}>GCL (Gate States : Time)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allPorts.map(portNum => {
                      const portData = tasData[selectedDevice.id]?.ports?.[portNum]
                      const hasTAS = portData?.gateEnabled
                      const gcl = portData?.adminControlList || []

                      return (
                        <tr key={portNum} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '8px 10px', fontWeight: '600' }}>Port {portNum}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                            <span style={{
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontSize: '0.7rem',
                              fontWeight: '600',
                              background: hasTAS ? '#dcfce7' : '#f1f5f9',
                              color: hasTAS ? '#15803d' : '#94a3b8'
                            }}>
                              {hasTAS ? 'ENABLED' : 'DISABLED'}
                            </span>
                          </td>
                          <td style={{ padding: '8px 10px', textAlign: 'center', fontFamily: 'monospace' }}>
                            {hasTAS && portData.cycleTimeNs > 0 ? `${(portData.cycleTimeNs / 1000).toFixed(0)} us` : '-'}
                          </td>
                          <td style={{ padding: '8px 10px' }}>
                            {gcl.length > 0 ? (
                              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                {gcl.map((entry, idx) => {
                                  const openTCs = getOpenTCs(entry.gateStates)
                                  return (
                                    <span
                                      key={idx}
                                      style={{
                                        padding: '3px 6px',
                                        background: '#f8fafc',
                                        borderRadius: '4px',
                                        fontSize: '0.7rem',
                                        fontFamily: 'monospace',
                                        border: '1px solid #e2e8f0'
                                      }}
                                      title={`Open: TC ${openTCs.join(',')}`}
                                    >
                                      <span style={{ color: '#64748b' }}>{entry.gateStates}</span>
                                      <span style={{ color: '#94a3b8' }}>:</span>
                                      <span style={{ color: '#3b82f6' }}>{(entry.timeInterval / 1000).toFixed(0)}</span>
                                    </span>
                                  )
                                })}
                              </div>
                            ) : (
                              <span style={{ color: '#cbd5e1' }}>-</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
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

            <div style={{ marginTop: '16px', padding: '12px', background: '#f8fafc', borderRadius: '6px', fontSize: '0.8rem' }}>
              <div style={{ fontWeight: '600', marginBottom: '8px' }}>Gate State Value Reference</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', fontSize: '0.75rem' }}>
                <div><code>255</code> = All Open (0xFF)</div>
                <div><code>1</code> = TC0 only</div>
                <div><code>128</code> = TC7 only</div>
                <div><code>0</code> = All Closed</div>
              </div>
            </div>
          </div>

          {/* Device Comparison */}
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
                          const portData = tasData[device.id]?.ports?.[portNum]
                          const hasTAS = portData?.gateEnabled
                          const gcl = portData?.adminControlList || []

                          return (
                            <td key={device.id} style={{ padding: '8px 10px', textAlign: 'center' }}>
                              {hasTAS ? (
                                <div>
                                  <span style={{
                                    padding: '2px 6px',
                                    background: '#dcfce7',
                                    color: '#15803d',
                                    borderRadius: '4px',
                                    fontSize: '0.65rem',
                                    fontWeight: '600'
                                  }}>
                                    {(portData.cycleTimeNs / 1000).toFixed(0)}us / {gcl.length}
                                  </span>
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

export default TASDashboard
