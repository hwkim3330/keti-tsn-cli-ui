import { useState, useEffect } from 'react'
import axios from 'axios'

function Ports({ config }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [ports, setPorts] = useState([])
  const [selectedPort, setSelectedPort] = useState(null)
  const [portStats, setPortStats] = useState(null)
  const [statsLoading, setStatsLoading] = useState(false)

  const portCount = 8 // LAN9662 has 8 ports

  // Fetch all ports status
  const fetchAllPorts = async () => {
    setLoading(true)
    setError(null)
    try {
      const portData = []

      for (let i = 1; i <= portCount; i++) {
        const basePath = `/ietf-interfaces:interfaces/interface[name='${i}']`

        const response = await axios.post('/api/fetch', {
          paths: [
            `${basePath}/enabled`,
            `${basePath}/oper-status`,
            `${basePath}/phys-address`,
            `${basePath}/mchp-velocitysp-port:eth-port/config`,
            `${basePath}/ieee802-ethernet-interface:ethernet/speed`,
            `${basePath}/ieee802-ethernet-interface:ethernet/duplex`
          ],
          transport: config.transport,
          device: config.device,
          host: config.host,
          port: config.port
        })

        const parsed = parsePortResponse(response.data.result, i)
        portData.push(parsed)
      }

      setPorts(portData)
    } catch (err) {
      setError(err.response?.data?.error || err.message)
    } finally {
      setLoading(false)
    }
  }

  // Parse YAML response for a port
  const parsePortResponse = (result, portNum) => {
    const data = {
      number: portNum,
      enabled: true,
      operStatus: 'unknown',
      macAddress: '',
      speed: '',
      duplex: '',
      maxFrameLength: 0
    }

    if (!result) return data

    const lines = result.split('\n')
    for (const line of lines) {
      if (line.includes('enabled:')) {
        data.enabled = line.includes('true')
      } else if (line.includes('oper-status:')) {
        data.operStatus = line.split(':')[1]?.trim() || 'unknown'
      } else if (line.includes('phys-address:')) {
        data.macAddress = line.split(':').slice(1).join(':').trim()
      } else if (line.includes('speed:')) {
        const speedVal = line.split(':')[1]?.trim().replace(/'/g, '')
        data.speed = speedVal || ''
      } else if (line.includes('duplex:')) {
        data.duplex = line.split(':')[1]?.trim() || ''
      } else if (line.includes('max-frame-length:')) {
        data.maxFrameLength = parseInt(line.split(':')[1]?.trim()) || 0
      }
    }

    return data
  }

  // Fetch port statistics
  const fetchPortStats = async (portNum) => {
    setStatsLoading(true)
    try {
      const basePath = `/ietf-interfaces:interfaces/interface[name='${portNum}']`

      const response = await axios.post('/api/fetch', {
        paths: [
          `${basePath}/statistics`,
          `${basePath}/mchp-velocitysp-port:eth-port/statistics`
        ],
        transport: config.transport,
        device: config.device,
        host: config.host,
        port: config.port
      })

      setPortStats(parseStatsResponse(response.data.result))
    } catch (err) {
      setError(err.response?.data?.error || err.message)
    } finally {
      setStatsLoading(false)
    }
  }

  // Parse statistics response
  const parseStatsResponse = (result) => {
    const stats = {
      inOctets: 0,
      outOctets: 0,
      inUnicast: 0,
      outUnicast: 0,
      inBroadcast: 0,
      outBroadcast: 0,
      inMulticast: 0,
      outMulticast: 0,
      inDiscards: 0,
      outDiscards: 0,
      inErrors: 0,
      outErrors: 0,
      trafficClass: []
    }

    if (!result) return stats

    const lines = result.split('\n')
    let inTrafficClass = false
    let currentTC = null

    for (const line of lines) {
      const trimmed = line.trim()

      if (trimmed.startsWith('in-octets:')) stats.inOctets = parseInt(trimmed.split(':')[1]?.replace(/'/g, '').trim()) || 0
      else if (trimmed.startsWith('out-octets:')) stats.outOctets = parseInt(trimmed.split(':')[1]?.replace(/'/g, '').trim()) || 0
      else if (trimmed.startsWith('in-unicast-pkts:')) stats.inUnicast = parseInt(trimmed.split(':')[1]?.replace(/'/g, '').trim()) || 0
      else if (trimmed.startsWith('out-unicast-pkts:')) stats.outUnicast = parseInt(trimmed.split(':')[1]?.replace(/'/g, '').trim()) || 0
      else if (trimmed.startsWith('in-broadcast-pkts:')) stats.inBroadcast = parseInt(trimmed.split(':')[1]?.replace(/'/g, '').trim()) || 0
      else if (trimmed.startsWith('out-broadcast-pkts:')) stats.outBroadcast = parseInt(trimmed.split(':')[1]?.replace(/'/g, '').trim()) || 0
      else if (trimmed.startsWith('in-multicast-pkts:')) stats.inMulticast = parseInt(trimmed.split(':')[1]?.replace(/'/g, '').trim()) || 0
      else if (trimmed.startsWith('out-multicast-pkts:')) stats.outMulticast = parseInt(trimmed.split(':')[1]?.replace(/'/g, '').trim()) || 0
      else if (trimmed.startsWith('in-discards:')) stats.inDiscards = parseInt(trimmed.split(':')[1]?.trim()) || 0
      else if (trimmed.startsWith('out-discards:')) stats.outDiscards = parseInt(trimmed.split(':')[1]?.trim()) || 0
      else if (trimmed.startsWith('in-errors:')) stats.inErrors = parseInt(trimmed.split(':')[1]?.trim()) || 0
      else if (trimmed.startsWith('out-errors:')) stats.outErrors = parseInt(trimmed.split(':')[1]?.trim()) || 0
      else if (trimmed === 'traffic-class:') {
        inTrafficClass = true
      } else if (inTrafficClass && trimmed.startsWith('- traffic-class:')) {
        if (currentTC) stats.trafficClass.push(currentTC)
        currentTC = { tc: parseInt(trimmed.split(':')[1]?.trim()) || 0, rxPackets: 0, txPackets: 0 }
      } else if (currentTC && trimmed.startsWith('rx-packets:')) {
        currentTC.rxPackets = parseInt(trimmed.split(':')[1]?.replace(/'/g, '').trim()) || 0
      } else if (currentTC && trimmed.startsWith('tx-packets:')) {
        currentTC.txPackets = parseInt(trimmed.split(':')[1]?.replace(/'/g, '').trim()) || 0
      }
    }
    if (currentTC) stats.trafficClass.push(currentTC)

    return stats
  }

  // Toggle port enabled state
  const togglePort = async (portNum, currentEnabled) => {
    setLoading(true)
    try {
      await axios.post('/api/patch', {
        patches: [{
          path: `/ietf-interfaces:interfaces/interface[name='${portNum}']/enabled`,
          value: !currentEnabled
        }],
        transport: config.transport,
        device: config.device,
        host: config.host,
        port: config.port
      })
      await fetchAllPorts()
    } catch (err) {
      setError(err.response?.data?.error || err.message)
    } finally {
      setLoading(false)
    }
  }

  // Clear port counters
  const clearCounters = async (portNum) => {
    setStatsLoading(true)
    try {
      await axios.post('/api/patch', {
        patches: [{
          path: `/ietf-interfaces:interfaces/interface[name='${portNum}']/mchp-velocitysp-port:eth-port/statistics/clear-statistics`,
          value: null
        }],
        transport: config.transport,
        device: config.device,
        host: config.host,
        port: config.port
      })
      await fetchPortStats(portNum)
    } catch (err) {
      setError(err.response?.data?.error || err.message)
    } finally {
      setStatsLoading(false)
    }
  }

  useEffect(() => {
    fetchAllPorts()
  }, [config.host])

  useEffect(() => {
    if (selectedPort) {
      fetchPortStats(selectedPort)
    }
  }, [selectedPort])

  const formatSpeed = (speed) => {
    if (!speed) return '-'
    const num = parseFloat(speed)
    if (num >= 1) return `${num} Gbps`
    return `${num * 1000} Mbps`
  }

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Port Status</h1>
        <p className="page-description">Switch port configuration and statistics</p>
      </div>

      {/* Connection Info */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Connection</h2>
          <button className="btn btn-secondary" onClick={fetchAllPorts} disabled={loading} style={{ fontSize: '0.8rem', padding: '6px 12px' }}>
            {loading ? 'Loading...' : 'Refresh All'}
          </button>
        </div>
        <div style={{ padding: '10px', background: '#f8fafc', borderRadius: '6px', fontFamily: 'monospace', fontSize: '0.85rem' }}>
          {config.transport === 'wifi' ? `WiFi: ${config.host}:${config.port}` : `Serial: ${config.device}`}
        </div>
      </div>

      {/* Port Overview Grid */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Port Overview</h2>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' }}>
          {ports.map((port) => (
            <div
              key={port.number}
              onClick={() => setSelectedPort(port.number)}
              style={{
                padding: '16px',
                borderRadius: '8px',
                border: selectedPort === port.number ? '2px solid #3b82f6' : '1px solid #e2e8f0',
                background: selectedPort === port.number ? '#eff6ff' : '#fff',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '1.1rem', fontWeight: '600' }}>Port {port.number}</span>
                <span
                  style={{
                    width: '12px',
                    height: '12px',
                    borderRadius: '50%',
                    background: port.operStatus === 'up' ? '#22c55e' : port.enabled ? '#eab308' : '#ef4444'
                  }}
                  title={port.operStatus === 'up' ? 'Link Up' : port.enabled ? 'No Link' : 'Disabled'}
                />
              </div>

              <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span>Status:</span>
                  <span style={{
                    color: port.operStatus === 'up' ? '#22c55e' : '#64748b',
                    fontWeight: '500'
                  }}>
                    {port.operStatus === 'up' ? 'Up' : port.enabled ? 'Down' : 'Disabled'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span>Speed:</span>
                  <span>{formatSpeed(port.speed)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Duplex:</span>
                  <span style={{ textTransform: 'capitalize' }}>{port.duplex || '-'}</span>
                </div>
              </div>
            </div>
          ))}

          {ports.length === 0 && !loading && (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '40px', color: '#64748b' }}>
              Click "Refresh All" to load port status
            </div>
          )}

          {loading && ports.length === 0 && (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '40px', color: '#64748b' }}>
              Loading port status...
            </div>
          )}
        </div>
      </div>

      {/* Selected Port Details */}
      {selectedPort && (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Port {selectedPort} Details</h2>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                className="btn btn-secondary"
                onClick={() => fetchPortStats(selectedPort)}
                disabled={statsLoading}
                style={{ fontSize: '0.8rem', padding: '6px 12px' }}
              >
                {statsLoading ? 'Loading...' : 'Refresh'}
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => clearCounters(selectedPort)}
                disabled={statsLoading}
                style={{ fontSize: '0.8rem', padding: '6px 12px' }}
              >
                Clear Counters
              </button>
            </div>
          </div>

          {/* Port Config */}
          {ports.find(p => p.number === selectedPort) && (
            <div style={{ marginBottom: '20px' }}>
              <h3 style={{ fontSize: '0.9rem', fontWeight: '600', marginBottom: '12px', color: '#334155' }}>Configuration</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
                {(() => {
                  const port = ports.find(p => p.number === selectedPort)
                  return (
                    <>
                      <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '6px' }}>
                        <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>Admin State</div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontWeight: '500' }}>{port.enabled ? 'Enabled' : 'Disabled'}</span>
                          <button
                            className={`btn ${port.enabled ? 'btn-danger' : 'btn-primary'}`}
                            onClick={() => togglePort(port.number, port.enabled)}
                            disabled={loading}
                            style={{ fontSize: '0.7rem', padding: '4px 8px' }}
                          >
                            {port.enabled ? 'Disable' : 'Enable'}
                          </button>
                        </div>
                      </div>
                      <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '6px' }}>
                        <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>Oper Status</div>
                        <div style={{ fontWeight: '500', color: port.operStatus === 'up' ? '#22c55e' : '#64748b' }}>
                          {port.operStatus === 'up' ? 'Link Up' : 'Link Down'}
                        </div>
                      </div>
                      <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '6px' }}>
                        <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>Speed / Duplex</div>
                        <div style={{ fontWeight: '500' }}>{formatSpeed(port.speed)} / {port.duplex || '-'}</div>
                      </div>
                      <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '6px' }}>
                        <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>MAC Address</div>
                        <div style={{ fontWeight: '500', fontFamily: 'monospace', fontSize: '0.85rem' }}>{port.macAddress || '-'}</div>
                      </div>
                      <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '6px' }}>
                        <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>Max Frame Length</div>
                        <div style={{ fontWeight: '500' }}>{port.maxFrameLength || '-'} bytes</div>
                      </div>
                    </>
                  )
                })()}
              </div>
            </div>
          )}

          {/* Port Statistics */}
          {portStats && (
            <div>
              <h3 style={{ fontSize: '0.9rem', fontWeight: '600', marginBottom: '12px', color: '#334155' }}>Statistics</h3>

              {/* Summary Stats */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '8px', marginBottom: '16px' }}>
                <div style={{ padding: '12px', background: '#f0fdf4', borderRadius: '6px', borderLeft: '3px solid #22c55e' }}>
                  <div style={{ fontSize: '0.7rem', color: '#64748b' }}>RX Bytes</div>
                  <div style={{ fontWeight: '600', fontSize: '1rem' }}>{formatBytes(portStats.inOctets)}</div>
                </div>
                <div style={{ padding: '12px', background: '#eff6ff', borderRadius: '6px', borderLeft: '3px solid #3b82f6' }}>
                  <div style={{ fontSize: '0.7rem', color: '#64748b' }}>TX Bytes</div>
                  <div style={{ fontWeight: '600', fontSize: '1rem' }}>{formatBytes(portStats.outOctets)}</div>
                </div>
                <div style={{ padding: '12px', background: '#f0fdf4', borderRadius: '6px', borderLeft: '3px solid #22c55e' }}>
                  <div style={{ fontSize: '0.7rem', color: '#64748b' }}>RX Packets</div>
                  <div style={{ fontWeight: '600', fontSize: '1rem' }}>{(portStats.inUnicast + portStats.inBroadcast + portStats.inMulticast).toLocaleString()}</div>
                </div>
                <div style={{ padding: '12px', background: '#eff6ff', borderRadius: '6px', borderLeft: '3px solid #3b82f6' }}>
                  <div style={{ fontSize: '0.7rem', color: '#64748b' }}>TX Packets</div>
                  <div style={{ fontWeight: '600', fontSize: '1rem' }}>{(portStats.outUnicast + portStats.outBroadcast + portStats.outMulticast).toLocaleString()}</div>
                </div>
                {(portStats.inErrors > 0 || portStats.outErrors > 0) && (
                  <div style={{ padding: '12px', background: '#fef2f2', borderRadius: '6px', borderLeft: '3px solid #ef4444' }}>
                    <div style={{ fontSize: '0.7rem', color: '#64748b' }}>Errors</div>
                    <div style={{ fontWeight: '600', fontSize: '1rem', color: '#ef4444' }}>
                      {portStats.inErrors + portStats.outErrors}
                    </div>
                  </div>
                )}
              </div>

              {/* Detailed Stats Table */}
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Counter</th>
                      <th style={{ textAlign: 'right' }}>RX</th>
                      <th style={{ textAlign: 'right' }}>TX</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Unicast Packets</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{portStats.inUnicast.toLocaleString()}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{portStats.outUnicast.toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td>Broadcast Packets</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{portStats.inBroadcast.toLocaleString()}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{portStats.outBroadcast.toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td>Multicast Packets</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{portStats.inMulticast.toLocaleString()}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{portStats.outMulticast.toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td>Discards</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{portStats.inDiscards}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{portStats.outDiscards}</td>
                    </tr>
                    <tr>
                      <td>Errors</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: portStats.inErrors > 0 ? '#ef4444' : 'inherit' }}>{portStats.inErrors}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: portStats.outErrors > 0 ? '#ef4444' : 'inherit' }}>{portStats.outErrors}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Traffic Class Stats */}
              {portStats.trafficClass.length > 0 && (
                <div style={{ marginTop: '16px' }}>
                  <h4 style={{ fontSize: '0.85rem', fontWeight: '600', marginBottom: '8px', color: '#334155' }}>Traffic Class Counters</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '4px' }}>
                    {portStats.trafficClass.map((tc) => (
                      <div key={tc.tc} style={{ padding: '8px', background: '#f8fafc', borderRadius: '4px', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: '4px' }}>TC{tc.tc}</div>
                        <div style={{ fontSize: '0.75rem' }}>
                          <div style={{ color: '#22c55e' }}>↓{tc.rxPackets}</div>
                          <div style={{ color: '#3b82f6' }}>↑{tc.txPackets}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}
    </div>
  )
}

export default Ports
