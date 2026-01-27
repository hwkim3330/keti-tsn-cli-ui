import { useState, useEffect, useRef, useCallback } from 'react'
import axios from 'axios'
import { useDevices } from '../contexts/DeviceContext'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'

function Dashboard() {
  const { devices } = useDevices()
  const [boardStatus, setBoardStatus] = useState({})
  const [loading, setLoading] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true) // Default ON
  const [refreshInterval, setRefreshInterval] = useState(2000)
  const intervalRef = useRef(null)
  const [offsetHistory, setOffsetHistory] = useState([])
  const [connectionStats, setConnectionStats] = useState({})
  const MAX_HISTORY = 120 // 4 minutes at 2s interval

  // Fetch single board status using new PTP API
  const fetchBoardHealth = useCallback(async (device) => {
    const startTime = Date.now()
    try {
      const res = await axios.get(`/api/ptp/health/${device.host}`, { timeout: 15000 })
      const latency = Date.now() - startTime

      // Update connection stats
      setConnectionStats(prev => ({
        ...prev,
        [device.id]: {
          ...prev[device.id],
          successCount: (prev[device.id]?.successCount || 0) + 1,
          lastSuccess: Date.now(),
          latency
        }
      }))

      return {
        online: res.data.online,
        ptp: res.data.ptp,
        latency: res.data.latency,
        lastUpdate: Date.now()
      }
    } catch (err) {
      // Update connection stats
      setConnectionStats(prev => ({
        ...prev,
        [device.id]: {
          ...prev[device.id],
          failCount: (prev[device.id]?.failCount || 0) + 1,
          lastError: err.message
        }
      }))

      return {
        online: false,
        error: err.message,
        lastUpdate: Date.now()
      }
    }
  }, [])

  const fetchAll = useCallback(async () => {
    if (devices.length === 0) return

    setLoading(true)
    const timestamp = new Date().toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    const historyEntry = { time: timestamp }
    const newStatus = {}

    // Fetch all boards in parallel
    const results = await Promise.allSettled(
      devices.map(device => fetchBoardHealth(device))
    )

    results.forEach((result, idx) => {
      const device = devices[idx]
      if (result.status === 'fulfilled') {
        newStatus[device.id] = result.value

        // Add offset to history
        if (result.value.ptp?.offset !== null && result.value.ptp?.offset !== undefined) {
          historyEntry[device.name] = result.value.ptp.offset
        }
      } else {
        newStatus[device.id] = { online: false, error: result.reason?.message }
      }
    })

    setBoardStatus(newStatus)

    // Add to history if we have offset data
    if (Object.keys(historyEntry).length > 1) {
      setOffsetHistory(prev => [...prev, historyEntry].slice(-MAX_HISTORY))
    }

    setLoading(false)
  }, [devices, fetchBoardHealth])

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
    const colors = { 0: '#94a3b8', 1: '#22c55e', 2: '#3b82f6', 3: '#f59e0b' }
    return colors[state] ?? '#94a3b8'
  }

  // Board identification
  const board1 = devices.find(d => d.name.includes('1') || d.host?.includes('.11'))
  const board2 = devices.find(d => d.name.includes('2') || d.host?.includes('.12'))
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
            <option value={1000}>1s</option>
            <option value={2000}>2s</option>
            <option value={5000}>5s</option>
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
              width: '140px', height: '90px', border: '3px solid #292524', borderRadius: '8px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              background: board1Status?.online ? '#fafaf9' : '#fef2f2',
              position: 'relative'
            }}>
              {board1Status?.online && (
                <div style={{
                  position: 'absolute', top: '-8px', right: '-8px',
                  width: '16px', height: '16px', borderRadius: '50%',
                  background: '#22c55e', border: '2px solid #fff'
                }} />
              )}
              <div style={{ fontWeight: '700', fontSize: '1rem' }}>Board 1</div>
              <div style={{ fontSize: '0.7rem', color: '#57534e' }}>LAN9692</div>
              {board1Status?.ptp?.isGM && (
                <div style={{
                  fontSize: '0.7rem', background: '#292524', color: '#fff',
                  padding: '2px 10px', borderRadius: '4px', marginTop: '4px', fontWeight: '600'
                }}>
                  GRANDMASTER
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
            <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: '600' }}>Port 8 ↔ Port 8</div>
            <div style={{
              width: '100px', height: '6px',
              background: isSynced ? 'linear-gradient(90deg, #22c55e, #16a34a)' : '#e5e7eb',
              borderRadius: '3px',
              boxShadow: isSynced ? '0 0 8px rgba(34, 197, 94, 0.5)' : 'none'
            }} />
            <div style={{
              fontSize: '0.8rem',
              color: isSynced ? '#16a34a' : '#94a3b8',
              fontWeight: '600'
            }}>
              {isSynced ? '● PTP SYNC' : '○ NO SYNC'}
            </div>
            {isSynced && board2Status?.ptp?.offset !== null && (
              <div style={{ fontSize: '0.7rem', color: '#64748b', fontFamily: 'monospace' }}>
                Offset: {board2Status.ptp.offset} ns
              </div>
            )}
          </div>

          {/* Board 2 */}
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: '140px', height: '90px', border: '3px solid #0891b2', borderRadius: '8px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              background: board2Status?.online ? '#f0fdfa' : '#fef2f2',
              position: 'relative'
            }}>
              {board2Status?.online && (
                <div style={{
                  position: 'absolute', top: '-8px', right: '-8px',
                  width: '16px', height: '16px', borderRadius: '50%',
                  background: '#22c55e', border: '2px solid #fff'
                }} />
              )}
              <div style={{ fontWeight: '700', fontSize: '1rem' }}>Board 2</div>
              <div style={{ fontSize: '0.7rem', color: '#0e7490' }}>LAN9692</div>
              {board2Status?.ptp?.portState === 'slave' && (
                <div style={{
                  fontSize: '0.7rem', background: '#0891b2', color: '#fff',
                  padding: '2px 10px', borderRadius: '4px', marginTop: '4px', fontWeight: '600'
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
                      fontSize: '0.65rem', padding: '2px 8px', borderRadius: '4px',
                      background: isBoard1 ? '#292524' : '#0891b2',
                      color: '#fff', fontWeight: '600'
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
                    padding: '12px', background: isBoard1 ? '#f5f3ff' : '#fef3c7',
                    borderRadius: '6px', gridColumn: '1 / -1'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginBottom: '2px' }}>Offset</div>
                        <div style={{
                          fontWeight: '700', fontSize: '1.2rem', fontFamily: 'monospace',
                          color: isBoard1 ? '#6366f1' : '#f59e0b'
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
                    stroke={idx === 0 ? '#6366f1' : '#f59e0b'}
                    strokeWidth={2}
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
