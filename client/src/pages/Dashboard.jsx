import { useState, useEffect, useRef } from 'react'
import axios from 'axios'

function Dashboard({ config }) {
  const [health, setHealth] = useState(null)
  const [catalogs, setCatalogs] = useState([])
  const [loading, setLoading] = useState(true)

  // Multi-device state
  const [devices, setDevices] = useState([])
  const [deviceStatuses, setDeviceStatuses] = useState({})
  const [checkingDevice, setCheckingDevice] = useState(null)

  // Auto PTP
  const [configuringPtp, setConfiguringPtp] = useState(false)
  const [ptpResult, setPtpResult] = useState(null)
  const [ptpPort, setPtpPort] = useState(8) // Default PTP port

  // Load devices from localStorage
  useEffect(() => {
    const savedDevices = localStorage.getItem('tsn-devices')
    if (savedDevices) {
      try {
        setDevices(JSON.parse(savedDevices))
      } catch (e) {
        console.error('Failed to load devices:', e)
      }
    }
  }, [])

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [healthRes, listRes] = await Promise.all([
          axios.get('/api/health'),
          axios.get('/api/list')
        ])
        setHealth(healthRes.data)
        setCatalogs(listRes.data.catalogs)
      } catch (error) {
        console.error('Error fetching data:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  // Fetch status for a single device
  const fetchDeviceStatus = async (device) => {
    setCheckingDevice(device.id)
    try {
      // Fetch board info
      const boardRes = await axios.post('/api/fetch', {
        paths: ["/ietf-hardware:hardware/component[name='Board']"],
        transport: device.transport,
        device: device.device,
        host: device.host,
        port: device.port || 5683
      }, { timeout: 8000 })

      // Fetch PTP status
      const ptpRes = await axios.post('/api/fetch', {
        paths: ['/ieee1588-ptp:ptp/instances'],
        transport: device.transport,
        device: device.device,
        host: device.host,
        port: device.port || 5683
      }, { timeout: 8000 })

      const boardInfo = parseBoardInfo(boardRes.data.result)
      const ptpStatus = parsePtpStatus(ptpRes.data.result)

      setDeviceStatuses(prev => ({
        ...prev,
        [device.id]: {
          online: true,
          boardInfo,
          ptpStatus,
          lastCheck: Date.now()
        }
      }))
    } catch (err) {
      setDeviceStatuses(prev => ({
        ...prev,
        [device.id]: {
          online: false,
          error: err.message,
          lastCheck: Date.now()
        }
      }))
    } finally {
      setCheckingDevice(null)
    }
  }

  // Check all devices sequentially
  const checkAllDevices = async () => {
    for (const device of devices) {
      await fetchDeviceStatus(device)
      await new Promise(r => setTimeout(r, 300))
    }
  }

  // Parse board info from YAML
  const parseBoardInfo = (result) => {
    if (!result) return null
    const info = { model: '-', firmware: '-', chip: '-' }
    const lines = result.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('model-name:')) {
        const modelFull = trimmed.split(':').slice(1).join(':').trim()
        info.model = modelFull
        const chipMatch = modelFull.match(/^(LAN\d+)/)
        if (chipMatch) info.chip = chipMatch[1]
      } else if (trimmed.startsWith('firmware-rev:')) {
        info.firmware = trimmed.split(':')[1]?.trim()
      }
    }
    return info
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
      portState: null
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
      }
    }
    // Servo offset
    const servoMatch = result.match(/servo:[\s\S]*?offset:\s*(-?\d+)[\s\S]*?state:\s*(\d+)/)
    if (servoMatch) {
      status.servoOffset = parseInt(servoMatch[1])
      status.servoState = parseInt(servoMatch[2])
    }
    if (status.clockIdentity && status.grandmasterIdentity) {
      status.isGrandmaster = status.clockIdentity === status.grandmasterIdentity
    }
    return status
  }

  // Auto-configure PTP: Set one device as GM and others as slaves (only online devices)
  const autoPtpConfig = async (gmDeviceId) => {
    // Get only online devices
    const onlineDevices = devices.filter(d => deviceStatuses[d.id]?.online)

    if (onlineDevices.length < 1) {
      setPtpResult([{ device: 'Error', success: false, error: 'No online devices found. Refresh status first.' }])
      return
    }

    setConfiguringPtp(true)
    setPtpResult(null)

    const results = []

    for (const device of onlineDevices) {
      const isGm = device.id === gmDeviceId
      const portRole = isGm ? 'master' : 'slave'

      try {
        const patches = [
          {
            path: '/ieee1588-ptp:ptp/instances/instance',
            value: {
              'instance-index': 0,
              'default-ds': { 'external-port-config-enable': true },
              'mchp-velocitysp-ptp:automotive': { profile: isGm ? 'gm' : 'bridge' },
              'mchp-velocitysp-ptp:servos': {
                servo: [{ 'servo-index': 0, 'servo-type': 'pi', 'ltc-index': 0 }]
              },
              ports: {
                port: [{
                  'port-index': ptpPort,
                  'external-port-config-port-ds': { 'desired-state': portRole }
                }]
              }
            }
          },
          {
            path: '/ieee1588-ptp:ptp/mchp-velocitysp-ptp:ltcs/ltc',
            value: {
              'ltc-index': 0,
              'ptp-pins': { 'ptp-pin': [{ index: 4, function: '1pps-out' }] }
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

        results.push({ device: device.name, success: true, role: isGm ? 'GM' : 'Slave', port: ptpPort })
      } catch (err) {
        results.push({ device: device.name, success: false, error: err.message })
      }

      await new Promise(r => setTimeout(r, 500))
    }

    setPtpResult(results)
    setConfiguringPtp(false)

    // Refresh statuses after config
    setTimeout(() => checkAllDevices(), 1500)
  }

  const servoStateText = (state) => {
    const states = { 0: 'Init', 1: 'Tracking', 2: 'Locked', 3: 'Holdover' }
    return states[state] || '-'
  }

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className="btn btn-secondary"
            onClick={checkAllDevices}
            disabled={checkingDevice !== null}
          >
            {checkingDevice ? 'Checking...' : 'Refresh All'}
          </button>
        </div>
      </div>

      {/* Server Status */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', gap: '24px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              width: '8px', height: '8px', borderRadius: '50%',
              background: health ? '#059669' : '#dc2626'
            }}></div>
            <span style={{ fontSize: '0.85rem' }}>Server: {health ? 'Online' : 'Offline'}</span>
          </div>
          <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
            Catalogs: <b>{catalogs.length}</b>
          </div>
          <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
            Devices: <b>{devices.length}</b> (Online: <b>{Object.values(deviceStatuses).filter(s => s?.online).length}</b>)
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto' }}>
            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>PTP Port:</span>
            <select
              className="form-select"
              value={ptpPort}
              onChange={(e) => setPtpPort(parseInt(e.target.value))}
              style={{ width: '70px', padding: '4px 8px', fontSize: '0.8rem' }}
            >
              {[1,2,3,4,5,6,7,8,9,10,11,12].map(p => (
                <option key={p} value={p}>Port {p}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Device Cards */}
      {devices.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
          No devices configured. Go to Settings to add devices.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px', marginBottom: '24px' }}>
          {devices.map(device => {
            const status = deviceStatuses[device.id]
            const isChecking = checkingDevice === device.id

            return (
              <div key={device.id} className="card" style={{
                padding: '16px',
                border: status?.online ? '1px solid #d1d5db' : status?.online === false ? '1px solid #fca5a5' : '1px solid #e2e8f0'
              }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                  <div>
                    <div style={{ fontWeight: '600', fontSize: '1rem' }}>{device.name}</div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', fontFamily: 'monospace' }}>
                      {device.transport === 'serial' ? device.device : `${device.host}:${device.port || 5683}`}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    {status?.ptpStatus && (
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '0.7rem',
                        fontWeight: '600',
                        background: status.ptpStatus.isGrandmaster ? '#f5f5f4' : '#f1f5f9',
                        color: status.ptpStatus.isGrandmaster ? '#57534e' : '#475569'
                      }}>
                        {status.ptpStatus.isGrandmaster ? 'GM' : 'Slave'}
                      </span>
                    )}
                    <span style={{
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontSize: '0.7rem',
                      fontWeight: '500',
                      background: isChecking ? '#f1f5f9' : status?.online ? '#ecfdf5' : status?.online === false ? '#fef2f2' : '#f8fafc',
                      color: isChecking ? '#64748b' : status?.online ? '#059669' : status?.online === false ? '#b91c1c' : '#94a3b8'
                    }}>
                      {isChecking ? '...' : status?.online ? 'Online' : status?.online === false ? 'Offline' : '-'}
                    </span>
                  </div>
                </div>

                {/* Info */}
                {status?.online && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
                    <div style={{ padding: '8px', background: '#f8fafc', borderRadius: '6px' }}>
                      <div style={{ fontSize: '0.65rem', color: '#64748b' }}>Chip</div>
                      <div style={{ fontSize: '0.85rem', fontWeight: '500', fontFamily: 'monospace' }}>
                        {status.boardInfo?.chip || '-'}
                      </div>
                    </div>
                    <div style={{ padding: '8px', background: '#f8fafc', borderRadius: '6px' }}>
                      <div style={{ fontSize: '0.65rem', color: '#64748b' }}>Firmware</div>
                      <div style={{ fontSize: '0.85rem', fontWeight: '500' }}>
                        {status.boardInfo?.firmware || '-'}
                      </div>
                    </div>
                    {status.ptpStatus && (
                      <>
                        <div style={{ padding: '8px', background: '#f8fafc', borderRadius: '6px' }}>
                          <div style={{ fontSize: '0.65rem', color: '#64748b' }}>Servo Offset</div>
                          <div style={{ fontSize: '0.85rem', fontWeight: '500', fontFamily: 'monospace' }}>
                            {status.ptpStatus.servoOffset !== null ? `${status.ptpStatus.servoOffset} ns` : '-'}
                          </div>
                        </div>
                        <div style={{ padding: '8px', background: '#f8fafc', borderRadius: '6px' }}>
                          <div style={{ fontSize: '0.65rem', color: '#64748b' }}>Servo State</div>
                          <div style={{ fontSize: '0.85rem', fontWeight: '500' }}>
                            {servoStateText(status.ptpStatus.servoState)}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {status?.online === false && (
                  <div style={{ padding: '12px', background: '#fef2f2', borderRadius: '6px', marginBottom: '12px', fontSize: '0.8rem', color: '#b91c1c' }}>
                    {status.error || 'Device offline'}
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    className="btn btn-secondary"
                    onClick={() => fetchDeviceStatus(device)}
                    disabled={isChecking}
                    style={{ fontSize: '0.75rem', padding: '6px 10px' }}
                  >
                    Refresh
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={() => autoPtpConfig(device.id)}
                    disabled={configuringPtp || !status?.online}
                    style={{ flex: 1, fontSize: '0.75rem', padding: '6px 10px' }}
                    title={`Set this device as Grandmaster on Port ${ptpPort} and configure all other online devices as Slaves`}
                  >
                    Set as GM (P{ptpPort})
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* PTP Configuration Result */}
      {ptpResult && (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">PTP Configuration Result</h2>
            <button
              className="btn btn-secondary"
              onClick={() => setPtpResult(null)}
              style={{ fontSize: '0.75rem', padding: '4px 8px' }}
            >
              Clear
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {ptpResult.map((r, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '8px 12px', background: r.success ? '#ecfdf5' : '#fef2f2',
                borderRadius: '6px', fontSize: '0.85rem'
              }}>
                <span style={{ fontWeight: '500' }}>{r.device}</span>
                {r.success ? (
                  <>
                    <span style={{ color: '#059669' }}>OK</span>
                    <span style={{
                      padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem',
                      background: r.role === 'GM' ? '#f5f5f4' : '#f1f5f9',
                      fontWeight: '600'
                    }}>
                      {r.role}
                    </span>
                    {r.port && <span style={{ fontSize: '0.7rem', color: '#64748b' }}>Port {r.port}</span>}
                  </>
                ) : (
                  <span style={{ color: '#b91c1c' }}>Failed: {r.error}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {configuringPtp && (
        <div className="card" style={{ textAlign: 'center', padding: '40px' }}>
          <div className="spinner" style={{ margin: '0 auto 16px' }}></div>
          <div>Configuring PTP on all devices...</div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Quick Actions</h2>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <a href="/ptp-monitor" className="btn btn-primary">PTP Monitor</a>
          <a href="/ports" className="btn btn-secondary">Port Status</a>
          <a href="/ptp" className="btn btn-secondary">PTP Config</a>
          <a href="/settings" className="btn btn-secondary">Device Settings</a>
          <a href="/fetch" className="btn btn-secondary">Fetch</a>
        </div>
      </div>
    </div>
  )
}

export default Dashboard
