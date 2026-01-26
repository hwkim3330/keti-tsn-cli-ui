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

  // Save config
  const [saveLoading, setSaveLoading] = useState(false)
  const [saveResult, setSaveResult] = useState(null)

  // PTP status
  const [ptpStatus, setPtpStatus] = useState(null)
  const [ptpLoading, setPtpLoading] = useState(false)

  const cacheKey = `dashboard_${config.host}`

  // Load cached data on mount
  useEffect(() => {
    const cached = localStorage.getItem(cacheKey)
    if (cached) {
      try {
        const data = JSON.parse(cached)
        if (data.boardInfo) setBoardInfo(data.boardInfo)
        if (data.checksumStatus) setChecksumStatus(data.checksumStatus)
        if (data.ptpStatus) setPtpStatus(data.ptpStatus)
      } catch (e) {
        console.error('Failed to load cached dashboard:', e)
      }
    }
  }, [cacheKey])

  // Save to cache
  const saveCache = (board, checksum, ptp) => {
    const data = {
      boardInfo: board,
      checksumStatus: checksum,
      ptpStatus: ptp,
      timestamp: new Date().toISOString()
    }
    localStorage.setItem(cacheKey, JSON.stringify(data))
  }

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

  // Fetch board info when config changes (only if no cache)
  useEffect(() => {
    const cached = localStorage.getItem(cacheKey)
    if (!cached) {
      const fetchAll = async () => {
        const board = await fetchBoardInfo()
        const checksum = await fetchChecksumStatus()
        const ptp = await fetchPtpStatus()
        saveCache(board, checksum, ptp)
      }
      fetchAll()
    }
  }, [config.host])

  const fetchBoardInfo = async () => {
    setBoardLoading(true)
    setBoardError(null)
    try {
      // Fetch components sequentially (device can't handle concurrent requests)
      const boardRes = await axios.post('/api/fetch', {
        paths: ["/ietf-hardware:hardware/component[name='Board']"],
        transport: config.transport,
        device: config.device,
        host: config.host,
        port: config.port
      }, { timeout: 10000 })

      const tempRes = await axios.post('/api/fetch', {
        paths: ["/ietf-hardware:hardware/component[name='SwTmp']"],
        transport: config.transport,
        device: config.device,
        host: config.host,
        port: config.port
      }, { timeout: 10000 })

      const combinedResult = (boardRes.data.result || '') + '\n' + (tempRes.data.result || '')
      const info = parseBoardInfo(combinedResult)
      setBoardInfo(info)
      return info
    } catch (err) {
      setBoardError(err.message)
      return null
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
      chip: '-'
    }

    const lines = result.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()

      if (trimmed.startsWith('model-name:')) {
        const modelFull = trimmed.split(':').slice(1).join(':').trim()
        info.model = modelFull
        // Extract chip name (e.g., LAN9692 from "LAN9692VAO - ...")
        const chipMatch = modelFull.match(/^(LAN\d+)/)
        if (chipMatch) info.chip = chipMatch[1]
      } else if (trimmed.startsWith('firmware-rev:')) {
        info.firmware = trimmed.split(':')[1]?.trim()
      } else if (trimmed.startsWith('mfg-name:')) {
        info.manufacturer = trimmed.split(':')[1]?.trim()
      } else if (trimmed.startsWith('value:')) {
        info.temperature = parseInt(trimmed.split(':')[1]?.trim())
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
      return response.data
    } catch (err) {
      const errorStatus = { match: false, error: err.message }
      setChecksumStatus(errorStatus)
      return errorStatus
    } finally {
      setChecksumLoading(false)
    }
  }

  const fetchPtpStatus = async () => {
    setPtpLoading(true)
    try {
      const response = await axios.post('/api/fetch', {
        paths: ["/ieee1588-ptp:ptp/instances"],
        transport: config.transport,
        device: config.device,
        host: config.host,
        port: config.port
      }, { timeout: 10000 })
      const status = parsePtpStatus(response.data.result)
      setPtpStatus(status)
      return status
    } catch (err) {
      const errorStatus = { error: err.message }
      setPtpStatus(errorStatus)
      return errorStatus
    } finally {
      setPtpLoading(false)
    }
  }

  const parsePtpStatus = (result) => {
    if (!result) return null

    const status = {
      clockIdentity: null,
      grandmasterIdentity: null,
      isGrandmaster: false,
      offset: null,
      portState: null,
      instanceIndex: null
    }

    const lines = result.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()

      if (trimmed.startsWith('instance-index:')) {
        status.instanceIndex = parseInt(trimmed.split(':')[1]?.trim())
      } else if (trimmed.startsWith('clock-identity:')) {
        status.clockIdentity = trimmed.split(':').slice(1).join(':').trim()
      } else if (trimmed.startsWith('grandmaster-identity:')) {
        status.grandmasterIdentity = trimmed.split(':').slice(1).join(':').trim()
      } else if (trimmed.startsWith('current-utc-offset:')) {
        status.offset = parseInt(trimmed.split(':')[1]?.trim())
      } else if (trimmed.startsWith('port-state:')) {
        status.portState = trimmed.split(':')[1]?.trim()
      }
    }

    // Determine if this device is the grandmaster
    if (status.clockIdentity && status.grandmasterIdentity) {
      status.isGrandmaster = status.clockIdentity === status.grandmasterIdentity
    }

    return status
  }

  const saveConfig = async () => {
    setSaveLoading(true)
    setSaveResult(null)
    try {
      const response = await axios.post('/api/rpc/save-config', {
        transport: config.transport,
        device: config.device,
        host: config.host,
        port: config.port
      }, { timeout: 15000 })
      setSaveResult({ success: true, message: 'Configuration saved!' })
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message
      setSaveResult({ success: false, message: errorMsg })
    } finally {
      setSaveLoading(false)
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
              background: boardInfo && boardInfo.temperature != null ? (boardInfo.temperature < 60 ? '#dcfce7' : boardInfo.temperature < 80 ? '#fef3c7' : '#fee2e2') : '#f1f5f9',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <svg width="20" height="20" fill="none" stroke={getTempColor(boardInfo?.temperature)} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5" />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Temperature</div>
              <div style={{ fontSize: '1.25rem', fontWeight: '600', color: getTempColor(boardInfo?.temperature) }}>
                {boardLoading ? '...' : boardInfo && boardInfo.temperature != null ? `${boardInfo.temperature}°C` : '-'}
              </div>
            </div>
          </div>
        </div>

        {/* Checksum Status */}
        <div className="card" style={{ padding: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '40px', height: '40px', borderRadius: '10px',
              background: checksumStatus?.cached ? '#dcfce7' : checksumStatus?.error ? '#fee2e2' : '#fef3c7',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <svg width="20" height="20" fill="none" stroke={checksumStatus?.cached ? '#16a34a' : checksumStatus?.error ? '#ef4444' : '#d97706'} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Catalog Sync</div>
              <div style={{ fontSize: '1.25rem', fontWeight: '600', color: checksumStatus?.cached ? '#16a34a' : checksumStatus?.error ? '#ef4444' : '#d97706' }}>
                {checksumLoading ? '...' : checksumStatus?.cached ? 'OK' : checksumStatus?.error ? 'Error' : 'Need Sync'}
              </div>
            </div>
          </div>
        </div>

        {/* PTP Status */}
        <div className="card" style={{ padding: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '40px', height: '40px', borderRadius: '10px',
              background: ptpStatus?.isGrandmaster ? '#fef3c7' : ptpStatus?.error ? '#fee2e2' : ptpStatus ? '#dbeafe' : '#f1f5f9',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <svg width="20" height="20" fill="none" stroke={ptpStatus?.isGrandmaster ? '#d97706' : ptpStatus?.error ? '#ef4444' : ptpStatus ? '#2563eb' : '#64748b'} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>PTP Role</div>
              <div style={{ fontSize: '1.25rem', fontWeight: '600', color: ptpStatus?.isGrandmaster ? '#d97706' : ptpStatus?.error ? '#ef4444' : ptpStatus ? '#2563eb' : '#64748b' }}>
                {ptpLoading ? '...' : ptpStatus?.isGrandmaster ? 'GM' : ptpStatus?.error ? 'Error' : ptpStatus ? 'Slave' : '-'}
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
            onClick={async () => {
              const board = await fetchBoardInfo()
              const checksum = await fetchChecksumStatus()
              const ptp = await fetchPtpStatus()
              saveCache(board, checksum, ptp)
            }}
            disabled={boardLoading || checksumLoading || ptpLoading}
            style={{ fontSize: '0.8rem', padding: '6px 12px' }}
          >
            {boardLoading || checksumLoading || ptpLoading ? 'Loading...' : 'Refresh'}
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
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>Chip</div>
              <div style={{ fontWeight: '500', fontSize: '0.9rem', fontFamily: 'monospace' }}>{boardInfo.chip}</div>
            </div>
          </div>
        ) : boardLoading ? (
          <div style={{ padding: '20px', textAlign: 'center', color: '#64748b' }}>Loading board info...</div>
        ) : (
          <div style={{ padding: '20px', textAlign: 'center', color: '#64748b' }}>Click Refresh to load board info</div>
        )}
      </div>

      {/* PTP Info */}
      {ptpStatus && !ptpStatus.error && (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">PTP Status</h2>
            <span style={{
              padding: '4px 12px',
              borderRadius: '12px',
              fontSize: '0.75rem',
              fontWeight: '600',
              background: ptpStatus.isGrandmaster ? '#fef3c7' : '#dbeafe',
              color: ptpStatus.isGrandmaster ? '#92400e' : '#1e40af'
            }}>
              {ptpStatus.isGrandmaster ? 'Grandmaster' : 'Slave'}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
            <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '6px' }}>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>Clock Identity</div>
              <div style={{ fontWeight: '500', fontSize: '0.8rem', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                {ptpStatus.clockIdentity || '-'}
              </div>
            </div>
            <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '6px' }}>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>Grandmaster Identity</div>
              <div style={{ fontWeight: '500', fontSize: '0.8rem', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                {ptpStatus.grandmasterIdentity || '-'}
              </div>
            </div>
            {ptpStatus.portState && (
              <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '6px' }}>
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>Port State</div>
                <div style={{ fontWeight: '500', fontSize: '0.9rem' }}>{ptpStatus.portState}</div>
              </div>
            )}
            {ptpStatus.offset !== null && (
              <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '6px' }}>
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>UTC Offset</div>
                <div style={{ fontWeight: '500', fontSize: '0.9rem' }}>{ptpStatus.offset}s</div>
              </div>
            )}
          </div>
        </div>
      )}

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

      {/* Save Configuration */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Save Configuration</h2>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <button
            className="btn btn-primary"
            onClick={saveConfig}
            disabled={saveLoading}
            style={{ minWidth: '150px' }}
          >
            {saveLoading ? 'Saving...' : 'Save to Startup'}
          </button>
          {saveResult && (
            <span style={{
              color: saveResult.success ? '#16a34a' : '#ef4444',
              fontSize: '0.9rem'
            }}>
              {saveResult.message}
            </span>
          )}
        </div>
        <p style={{ marginTop: '8px', fontSize: '0.8rem', color: '#64748b' }}>
          Save current running configuration to startup. Applied on next reboot.
        </p>
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
