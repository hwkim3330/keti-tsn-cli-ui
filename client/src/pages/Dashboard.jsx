import { useState, useEffect, useRef, useCallback } from 'react'
import axios from 'axios'
import { useDevices } from '../contexts/DeviceContext'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'

function Dashboard() {
  const { devices } = useDevices()
  const [boardStatus, setBoardStatus] = useState({})
  const [loading, setLoading] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true) // Default ON
  const [refreshInterval, setRefreshInterval] = useState(5000) // 5s default
  const intervalRef = useRef(null)
  const [offsetHistory, setOffsetHistory] = useState([])
  const [connectionStats, setConnectionStats] = useState({})
  const MAX_HISTORY = 120 // 4 minutes at 2s interval

  // Fetch GM status (full data, cached on server)
  const fetchGmHealth = useCallback(async (device) => {
    try {
      const res = await axios.get(`/api/ptp/health/${device.host}`, { timeout: 25000 })
      setConnectionStats(prev => ({
        ...prev,
        [device.id]: { ...prev[device.id], successCount: (prev[device.id]?.successCount || 0) + 1, latency: res.data.latency }
      }))
      return {
        online: res.data.online,
        ptp: res.data.ptp,
        latency: res.data.latency,
        cached: res.data.cached
      }
    } catch (err) {
      setConnectionStats(prev => ({ ...prev, [device.id]: { ...prev[device.id], failCount: (prev[device.id]?.failCount || 0) + 1 } }))
      return { online: false, error: err.message }
    }
  }, [])

  // Fetch Slave offset only (faster endpoint)
  const fetchSlaveOffset = useCallback(async (device) => {
    try {
      const res = await axios.get(`/api/ptp/offset/${device.host}`, { timeout: 20000 })
      setConnectionStats(prev => ({
        ...prev,
        [device.id]: { ...prev[device.id], successCount: (prev[device.id]?.successCount || 0) + 1, latency: res.data.latency }
      }))
      return {
        online: res.data.online,
        ptp: {
          offset: res.data.offset,
          servoState: res.data.servoState,
          portState: res.data.portState,
          profile: res.data.profile,
          asCapable: res.data.asCapable,
          meanLinkDelay: res.data.meanLinkDelay
        },
        latency: res.data.latency
      }
    } catch (err) {
      setConnectionStats(prev => ({ ...prev, [device.id]: { ...prev[device.id], failCount: (prev[device.id]?.failCount || 0) + 1 } }))
      return { online: false, error: err.message }
    }
  }, [])

  const fetchAll = useCallback(async () => {
    if (devices.length === 0) return

    setLoading(true)
    const timestamp = new Date().toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    const historyEntry = { time: timestamp }
    const newStatus = { ...boardStatus }

    const slaveDevice = devices.find(d => d.host === '10.42.0.12' || d.name.includes('#2'))
    const gmDevice = devices.find(d => d.host === '10.42.0.11' || d.name.includes('#1'))

    // Fetch Slave offset (faster endpoint)
    if (slaveDevice) {
      const result = await fetchSlaveOffset(slaveDevice)
      newStatus[slaveDevice.id] = {
        ...newStatus[slaveDevice.id],
        ...result
      }
      if (result.ptp?.offset !== null && result.ptp?.offset !== undefined) {
        historyEntry[slaveDevice.name] = result.ptp.offset
      }
    }

    // GM uses full health (cached on server for 30s)
    if (gmDevice) {
      const result = await fetchGmHealth(gmDevice)
      newStatus[gmDevice.id] = result
    }

    setBoardStatus(newStatus)

    if (historyEntry[slaveDevice?.name] !== undefined) {
      setOffsetHistory(prev => [...prev, historyEntry].slice(-MAX_HISTORY))
    }

    setLoading(false)
  }, [devices, fetchSlaveOffset, fetchGmHealth, boardStatus])

  // Initial fetch and auto-refresh
  useEffect(() => {
    if (devices.length > 0) {
      fetchAll()
    }
  }, [devices])

  useEffect(() => {
    if (autoRefresh && devices.length > 0) {
      intervalRef.current = setInterval(fetchAll, refreshInterval)
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [autoRefresh, devices, refreshInterval, fetchAll])

  const servoStateText = (state) => {
    const states = { 0: 'Init', 1: 'Tracking', 2: 'Locked', 3: 'Holdover' }
    return states[state] ?? '-'
  }

  const servoStateColor = (state) => {
    const colors = { 0: '#94a3b8', 1: '#059669', 2: '#2563eb', 3: '#d97706' }
    return colors[state] ?? '#94a3b8'
  }

  // Board identification - use host IP or #1/#2 suffix
  const board1 = devices.find(d => d.host === '10.42.0.11' || d.name.includes('#1'))
  const board2 = devices.find(d => d.host === '10.42.0.12' || d.name.includes('#2'))
  const board1Status = board1 ? boardStatus[board1.id] : null
  const board2Status = board2 ? boardStatus[board2.id] : null
  const isSynced = board1Status?.online && board2Status?.online &&
    board1Status?.ptp?.isGM && board2Status?.ptp?.portState === 'slave' &&
    board2Status?.ptp?.servoState >= 1

  // Calculate offset stats
  const getOffsetStats = () => {
    const offsets = offsetHistory
      .map(h => h[board2?.name])
      .filter(v => v !== undefined && v !== null)
    if (offsets.length === 0) return null

    const avg = offsets.reduce((a, b) => a + b, 0) / offsets.length
    const max = Math.max(...offsets.map(Math.abs))
    const min = Math.min(...offsets)
    const maxVal = Math.max(...offsets)

    return { avg: avg.toFixed(0), max, min, maxVal, count: offsets.length }
  }

  const offsetStats = getOffsetStats()

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <select
            value={refreshInterval}
            onChange={(e) => setRefreshInterval(parseInt(e.target.value))}
            style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #e2e8f0', fontSize: '0.8rem' }}
          >
            <option value={3000}>3s</option>
            <option value={5000}>5s</option>
            <option value={10000}>10s</option>
            <option value={15000}>15s</option>
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto
          </label>
          <button className="btn btn-secondary" onClick={fetchAll} disabled={loading}>
            {loading ? '...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Topology Overview */}
      <div className="card" style={{ marginBottom: '16px', padding: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '48px' }}>
          {/* Board 1 */}
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: '140px', height: '90px', border: '2px solid #64748b', borderRadius: '8px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              background: board1Status?.online ? '#f8fafc' : '#fef2f2',
              position: 'relative'
            }}>
              {board1Status?.online && (
                <div style={{
                  position: 'absolute', top: '-6px', right: '-6px',
                  width: '12px', height: '12px', borderRadius: '50%',
                  background: '#059669', border: '2px solid #fff'
                }} />
              )}
              <div style={{ fontWeight: '600', fontSize: '0.95rem', color: '#334155' }}>Board 1</div>
              <div style={{ fontSize: '0.7rem', color: '#64748b' }}>LAN9692</div>
              {board1Status?.ptp?.isGM && (
                <div style={{
                  fontSize: '0.65rem', background: '#475569', color: '#fff',
                  padding: '2px 8px', borderRadius: '4px', marginTop: '4px', fontWeight: '500'
                }}>
                  GM
                </div>
              )}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '6px' }}>
              {board1?.host || '10.42.0.11'}
            </div>
            {connectionStats[board1?.id]?.latency && (
              <div style={{ fontSize: '0.65rem', color: '#94a3b8' }}>
                {connectionStats[board1?.id].latency}ms
              </div>
            )}
          </div>

          {/* Connection Line */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
            <div style={{ fontSize: '0.7rem', color: '#64748b' }}>Port 8 ↔ Port 8</div>
            <div style={{
              width: '80px', height: '3px',
              background: isSynced ? '#059669' : '#cbd5e1',
              borderRadius: '2px'
            }} />
            <div style={{
              fontSize: '0.75rem',
              color: isSynced ? '#059669' : '#94a3b8',
              fontWeight: '500'
            }}>
              {isSynced ? 'SYNCED' : 'NOT SYNCED'}
            </div>
            {isSynced && board2Status?.ptp?.offset !== null && (
              <div style={{ fontSize: '0.65rem', color: '#64748b', fontFamily: 'monospace' }}>
                {board2Status.ptp.offset} ns
              </div>
            )}
          </div>

          {/* Board 2 */}
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: '140px', height: '90px', border: '2px solid #64748b', borderRadius: '8px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              background: board2Status?.online ? '#f8fafc' : '#fef2f2',
              position: 'relative'
            }}>
              {board2Status?.online && (
                <div style={{
                  position: 'absolute', top: '-6px', right: '-6px',
                  width: '12px', height: '12px', borderRadius: '50%',
                  background: '#059669', border: '2px solid #fff'
                }} />
              )}
              <div style={{ fontWeight: '600', fontSize: '0.95rem', color: '#334155' }}>Board 2</div>
              <div style={{ fontSize: '0.7rem', color: '#64748b' }}>LAN9692</div>
              {board2Status?.ptp?.portState === 'slave' && (
                <div style={{
                  fontSize: '0.65rem', background: '#475569', color: '#fff',
                  padding: '2px 8px', borderRadius: '4px', marginTop: '4px', fontWeight: '500'
                }}>
                  SLAVE
                </div>
              )}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '6px' }}>
              {board2?.host || '10.42.0.12'}
            </div>
            {connectionStats[board2?.id]?.latency && (
              <div style={{ fontSize: '0.65rem', color: '#94a3b8' }}>
                {connectionStats[board2?.id].latency}ms
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Board Status Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
        {devices.map((device, idx) => {
          const status = boardStatus[device.id]
          const ptp = status?.ptp
          const isBoard1 = device.name.includes('1') || device.host?.includes('.11')

          return (
            <div key={device.id} className="card">
              <div className="card-header">
                <h2 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    width: '10px', height: '10px', borderRadius: '50%',
                    background: status?.online ? '#22c55e' : '#ef4444'
                  }} />
                  {device.name}
                  {status?.online && ptp && (
                    <span style={{
                      fontSize: '0.6rem', padding: '2px 6px', borderRadius: '3px',
                      background: '#e2e8f0',
                      color: '#475569', fontWeight: '500'
                    }}>
                      {ptp.isGM ? 'GM' : ptp.portState?.toUpperCase() || 'N/A'}
                    </span>
                  )}
                </h2>
                <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                  {status?.latency ? `${status.latency}ms` : ''}
                </span>
              </div>

              {status?.online && ptp ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                  <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '6px' }}>
                    <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginBottom: '2px' }}>Profile</div>
                    <div style={{ fontWeight: '600', fontSize: '0.9rem' }}>{ptp.profile || '-'}</div>
                  </div>
                  <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '6px' }}>
                    <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginBottom: '2px' }}>AS-Capable</div>
                    <div style={{
                      fontWeight: '600', fontSize: '0.9rem',
                      color: ptp.asCapable ? '#22c55e' : '#ef4444'
                    }}>
                      {ptp.asCapable ? 'Yes' : 'No'}
                    </div>
                  </div>
                  <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '6px' }}>
                    <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginBottom: '2px' }}>Servo</div>
                    <div style={{
                      fontWeight: '600', fontSize: '0.9rem',
                      color: servoStateColor(ptp.servoState)
                    }}>
                      {servoStateText(ptp.servoState)}
                    </div>
                  </div>
                  <div style={{
                    padding: '12px', background: '#f1f5f9',
                    borderRadius: '6px', gridColumn: '1 / -1'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: '0.65rem', color: '#64748b', marginBottom: '2px' }}>Offset</div>
                        <div style={{
                          fontWeight: '600', fontSize: '1.1rem', fontFamily: 'monospace',
                          color: '#334155'
                        }}>
                          {ptp.offset !== null ? `${ptp.offset} ns` : '-'}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginBottom: '2px' }}>Link Delay</div>
                        <div style={{ fontWeight: '500', fontSize: '0.85rem', fontFamily: 'monospace' }}>
                          {ptp.meanLinkDelay ? `${(ptp.meanLinkDelay / 65536).toFixed(0)} ns` : '-'}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ padding: '24px', textAlign: 'center', color: '#94a3b8' }}>
                  {status?.error || 'Connecting...'}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Offset Graph */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">PTP Offset History</h2>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            {offsetStats && (
              <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                Avg: <b>{offsetStats.avg}ns</b> |
                Max: <b>±{offsetStats.max}ns</b> |
                Samples: {offsetStats.count}
              </div>
            )}
            <button
              className="btn btn-secondary"
              onClick={() => setOffsetHistory([])}
              style={{ fontSize: '0.7rem', padding: '4px 8px' }}
            >
              Clear
            </button>
          </div>
        </div>
        <div style={{ height: '220px' }}>
          {offsetHistory.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={offsetHistory} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 10 }}
                  stroke="#94a3b8"
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 10 }}
                  stroke="#94a3b8"
                  domain={['auto', 'auto']}
                  tickFormatter={(v) => `${v}`}
                  label={{ value: 'ns', angle: -90, position: 'insideLeft', fontSize: 10 }}
                />
                <Tooltip
                  contentStyle={{ fontSize: '0.75rem', background: '#fff', border: '1px solid #e2e8f0' }}
                  formatter={(value) => [`${value} ns`, 'Offset']}
                />
                <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
                {devices.map((device, idx) => (
                  <Line
                    key={device.id}
                    type="monotone"
                    dataKey={device.name}
                    stroke={idx === 0 ? '#64748b' : '#0891b2'}
                    strokeWidth={1.5}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div style={{
              height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#94a3b8', fontSize: '0.85rem'
            }}>
              {autoRefresh ? 'Collecting offset data...' : 'Enable auto-refresh to collect data'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default Dashboard
