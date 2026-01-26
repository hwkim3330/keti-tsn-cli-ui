import { useState, useEffect } from 'react'
import axios from 'axios'

function Dashboard({ config }) {
  const [health, setHealth] = useState(null)
  const [catalogs, setCatalogs] = useState([])
  const [loading, setLoading] = useState(true)

  // Board info
  const [boardInfo, setBoardInfo] = useState(null)
  const [boardLoading, setBoardLoading] = useState(false)
  const [boardError, setBoardError] = useState(null)

  // Checksum status
  const [checksumStatus, setChecksumStatus] = useState(null)
  const [checksumLoading, setChecksumLoading] = useState(false)

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

  // Fetch board info when config changes
  useEffect(() => {
    fetchBoardInfo()
    fetchChecksumStatus()
  }, [config.host])

  const fetchBoardInfo = async () => {
    setBoardLoading(true)
    setBoardError(null)
    try {
      // Fetch hardware info including temperature
      const response = await axios.post('/api/fetch', {
        paths: ['/ietf-hardware:hardware', '/ietf-system:system-state'],
        transport: config.transport,
        device: config.device,
        host: config.host,
        port: config.port
      }, { timeout: 10000 })

      const info = parseBoardInfo(response.data.result)
      setBoardInfo(info)
    } catch (err) {
      setBoardError(err.message)
    } finally {
      setBoardLoading(false)
    }
  }

  const parseBoardInfo = (result) => {
    if (!result) return null

    const info = {
      model: '-',
      firmware: '-',
      temperature: null,
      manufacturer: '-',
      serial: '-'
    }

    const lines = result.split('\n')
    let inComponent = false
    let currentClass = ''

    for (const line of lines) {
      const trimmed = line.trim()

      if (trimmed.startsWith('- class:')) {
        inComponent = true
        currentClass = trimmed.split(':')[1]?.trim()
      } else if (trimmed.startsWith('model-name:') && inComponent) {
        if (currentClass === 'chassis') {
          info.model = trimmed.split(':').slice(1).join(':').trim()
        }
      } else if (trimmed.startsWith('firmware-rev:')) {
        info.firmware = trimmed.split(':')[1]?.trim()
      } else if (trimmed.startsWith('mfg-name:')) {
        info.manufacturer = trimmed.split(':')[1]?.trim()
      } else if (trimmed.startsWith('serial-num:')) {
        info.serial = trimmed.split(':')[1]?.trim().replace(/'/g, '')
      } else if (trimmed.startsWith('value:') && currentClass === 'sensor') {
        info.temperature = parseInt(trimmed.split(':')[1]?.trim())
      } else if (trimmed.startsWith('os-version:')) {
        info.firmware = trimmed.split(':')[1]?.trim()
      } else if (trimmed.startsWith('machine:')) {
        info.model = trimmed.split(':').slice(1).join(':').trim()
      }
    }

    return info
  }

  const fetchChecksumStatus = async () => {
    setChecksumLoading(true)
    try {
      const response = await axios.post('/api/checksum', {
        transport: config.transport,
        device: config.device,
        host: config.host,
        port: config.port
      }, { timeout: 15000 })
      setChecksumStatus(response.data)
    } catch (err) {
      setChecksumStatus({ match: false, error: err.message })
    } finally {
      setChecksumLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
      </div>
    )
  }

  const getTempColor = (temp) => {
    if (temp === null) return '#64748b'
    if (temp < 60) return '#22c55e'
    if (temp < 80) return '#eab308'
    return '#ef4444'
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-description">TSN Switch Configuration Overview</p>
      </div>

      {/* Status Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        {/* Server Status */}
        <div className="card" style={{ padding: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="20" height="20" fill="none" stroke="#16a34a" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Server</div>
              <div style={{ fontSize: '1.25rem', fontWeight: '600' }}>{health ? 'Online' : 'Offline'}</div>
            </div>
          </div>
        </div>

        {/* Board Temperature */}
        <div className="card" style={{ padding: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '40px', height: '40px', borderRadius: '10px',
              background: boardInfo?.temperature ? (boardInfo.temperature < 60 ? '#dcfce7' : boardInfo.temperature < 80 ? '#fef3c7' : '#fee2e2') : '#f1f5f9',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <svg width="20" height="20" fill="none" stroke={getTempColor(boardInfo?.temperature)} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5" />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Temperature</div>
              <div style={{ fontSize: '1.25rem', fontWeight: '600', color: getTempColor(boardInfo?.temperature) }}>
                {boardLoading ? '...' : boardInfo?.temperature !== null ? `${boardInfo.temperature}°C` : '-'}
              </div>
            </div>
          </div>
        </div>

        {/* Checksum Status */}
        <div className="card" style={{ padding: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '40px', height: '40px', borderRadius: '10px',
              background: checksumStatus?.match ? '#dcfce7' : checksumStatus?.error ? '#fee2e2' : '#f1f5f9',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <svg width="20" height="20" fill="none" stroke={checksumStatus?.match ? '#16a34a' : checksumStatus?.error ? '#ef4444' : '#64748b'} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Catalog Sync</div>
              <div style={{ fontSize: '1.25rem', fontWeight: '600', color: checksumStatus?.match ? '#16a34a' : checksumStatus?.error ? '#ef4444' : '#64748b' }}>
                {checksumLoading ? '...' : checksumStatus?.match ? 'OK' : checksumStatus?.error ? 'Error' : 'Mismatch'}
              </div>
            </div>
          </div>
        </div>

        {/* Catalogs */}
        <div className="card" style={{ padding: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="20" height="20" fill="none" stroke="#2563eb" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8" />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Catalogs</div>
              <div style={{ fontSize: '1.25rem', fontWeight: '600' }}>{catalogs.length}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Board Info */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Board Information</h2>
          <button
            className="btn btn-secondary"
            onClick={fetchBoardInfo}
            disabled={boardLoading}
            style={{ fontSize: '0.8rem', padding: '6px 12px' }}
          >
            {boardLoading ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        {boardError ? (
          <div className="alert alert-error">{boardError}</div>
        ) : boardInfo ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
            <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '6px' }}>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>Model</div>
              <div style={{ fontWeight: '500', fontSize: '0.9rem' }}>{boardInfo.model}</div>
            </div>
            <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '6px' }}>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>Firmware</div>
              <div style={{ fontWeight: '500', fontSize: '0.9rem' }}>{boardInfo.firmware}</div>
            </div>
            <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '6px' }}>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>Manufacturer</div>
              <div style={{ fontWeight: '500', fontSize: '0.9rem' }}>{boardInfo.manufacturer}</div>
            </div>
            <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '6px' }}>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>Serial Number</div>
              <div style={{ fontWeight: '500', fontSize: '0.9rem', fontFamily: 'monospace' }}>{boardInfo.serial}</div>
            </div>
          </div>
        ) : boardLoading ? (
          <div style={{ padding: '20px', textAlign: 'center', color: '#64748b' }}>Loading board info...</div>
        ) : (
          <div style={{ padding: '20px', textAlign: 'center', color: '#64748b' }}>Click Refresh to load board info</div>
        )}
      </div>

      {/* Connection Info */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Connection</h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '12px' }}>
          <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '6px' }}>
            <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>Transport</div>
            <div style={{ fontWeight: '500' }}>{config.transport === 'wifi' ? 'WiFi (UDP)' : 'Serial (USB)'}</div>
          </div>
          {config.transport === 'wifi' ? (
            <>
              <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '6px' }}>
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>Host</div>
                <div style={{ fontWeight: '500', fontFamily: 'monospace' }}>{config.host}</div>
              </div>
              <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '6px' }}>
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>Port</div>
                <div style={{ fontWeight: '500', fontFamily: 'monospace' }}>{config.port}</div>
              </div>
            </>
          ) : (
            <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '6px' }}>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>Device</div>
              <div style={{ fontWeight: '500', fontFamily: 'monospace' }}>{config.device}</div>
            </div>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Quick Actions</h2>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <a href="/ports" className="btn btn-primary">Port Status</a>
          <a href="/ptp" className="btn btn-secondary">PTP Config</a>
          <a href="/tas" className="btn btn-secondary">TAS (Qbv)</a>
          <a href="/cbs" className="btn btn-secondary">CBS (Qav)</a>
          <a href="/fetch" className="btn btn-secondary">Fetch</a>
          <a href="/patch" className="btn btn-secondary">Patch</a>
        </div>
      </div>
    </div>
  )
}

export default Dashboard
