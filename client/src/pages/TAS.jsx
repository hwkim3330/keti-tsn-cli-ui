import { useState, useEffect } from 'react'
import axios from 'axios'

function TAS({ config }) {
  const [portNumber, setPortNumber] = useState('1')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  // Current device config (loaded from device)
  const [currentConfig, setCurrentConfig] = useState(null)

  // Admin config (editable)
  const [gateEnabled, setGateEnabled] = useState(true)
  const [adminGateStates, setAdminGateStates] = useState(255)
  const [cycleTimeUs, setCycleTimeUs] = useState(1000) // microseconds for easier input
  const [cycleTimeExtensionUs, setCycleTimeExtensionUs] = useState(10)
  const [baseTimeSeconds, setBaseTimeSeconds] = useState(100)

  // Gate Control List - visual format
  const [gateEntries, setGateEntries] = useState([
    { timeUs: 125, gates: [true, false, false, false, false, false, false, false] }, // TC0 open
    { timeUs: 125, gates: [false, true, false, false, false, false, false, false] }, // TC1 open
    { timeUs: 125, gates: [false, false, true, false, false, false, false, false] }, // TC2 open
    { timeUs: 125, gates: [false, false, false, true, false, false, false, false] }, // TC3 open
    { timeUs: 125, gates: [false, false, false, false, true, false, false, false] }, // TC4 open
    { timeUs: 125, gates: [false, false, false, false, false, true, false, false] }, // TC5 open
    { timeUs: 125, gates: [false, false, false, false, false, false, true, false] }, // TC6 open
    { timeUs: 125, gates: [false, false, false, false, false, false, false, true] }, // TC7 open
  ])

  const basePath = `/ietf-interfaces:interfaces/interface[name='${portNumber}']/ieee802-dot1q-bridge:bridge-port/ieee802-dot1q-sched-bridge:gate-parameter-table`

  // Load current config from device
  const loadFromDevice = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await axios.post('/api/fetch', {
        paths: [basePath],
        transport: config.transport,
        device: config.device,
        host: config.host,
        port: config.port
      }, { timeout: 15000 })

      const data = parseYamlResponse(response.data.result)
      setCurrentConfig(data)

      // Update form with loaded values
      if (data) {
        setGateEnabled(data.gateEnabled ?? true)
        setAdminGateStates(data.adminGateStates ?? 255)
        if (data.cycleTimeNs > 0) {
          setCycleTimeUs(Math.round(data.cycleTimeNs / 1000))
        }
        if (data.cycleTimeExtensionNs > 0) {
          setCycleTimeExtensionUs(Math.round(data.cycleTimeExtensionNs / 1000))
        }
        if (data.baseTimeSeconds > 0) {
          setBaseTimeSeconds(data.baseTimeSeconds)
        }
        if (data.adminControlList && data.adminControlList.length > 0) {
          setGateEntries(data.adminControlList.map(entry => ({
            timeUs: Math.round(entry.timeInterval / 1000),
            gates: Array.from({ length: 8 }, (_, i) => ((entry.gateStates >> i) & 1) === 1)
          })))
        }
      }

      setResult({ type: 'fetch', label: 'Load Config', data: response.data.result })
    } catch (err) {
      setError(err.response?.data?.error || err.message)
    } finally {
      setLoading(false)
    }
  }

  // Parse YAML response to structured data
  const parseYamlResponse = (yamlStr) => {
    if (!yamlStr) return null

    const data = {
      gateEnabled: true,
      adminGateStates: 255,
      operGateStates: 255,
      cycleTimeNs: 0,
      cycleTimeExtensionNs: 0,
      baseTimeSeconds: 0,
      baseTimeNs: 0,
      currentTimeSeconds: 0,
      currentTimeNs: 0,
      configPending: false,
      adminControlList: [],
      operControlList: []
    }

    const lines = yamlStr.split('\n')
    let section = ''
    let currentEntry = null

    const pushEntry = () => {
      if (currentEntry && currentEntry.timeInterval > 0) {
        if (section === 'admin-control-list') {
          data.adminControlList.push({ ...currentEntry })
        } else if (section === 'oper-control-list') {
          data.operControlList.push({ ...currentEntry })
        }
      }
      currentEntry = null
    }

    for (const line of lines) {
      const trimmed = line.trim()

      if (trimmed.startsWith('gate-enabled:')) {
        data.gateEnabled = trimmed.includes('true')
      } else if (trimmed.startsWith('admin-gate-states:')) {
        data.adminGateStates = parseInt(trimmed.split(':')[1]) || 255
      } else if (trimmed.startsWith('oper-gate-states:')) {
        data.operGateStates = parseInt(trimmed.split(':')[1]) || 255
      } else if (trimmed.startsWith('config-pending:')) {
        data.configPending = trimmed.includes('true')
      } else if (trimmed.startsWith('admin-cycle-time-extension:')) {
        data.cycleTimeExtensionNs = parseInt(trimmed.split(':')[1]) || 0
      } else if (trimmed === 'admin-control-list:') {
        pushEntry()
        section = 'admin-control-list'
      } else if (trimmed === 'oper-control-list:') {
        pushEntry()
        section = 'oper-control-list'
      } else if (trimmed === 'admin-cycle-time:' || trimmed === 'admin-base-time:' ||
                 trimmed === 'current-time:' || trimmed === 'oper-cycle-time:' ||
                 trimmed === 'queue-max-sdu-table:' || trimmed === 'oper-base-time:') {
        pushEntry()
        section = ''
      } else if (trimmed.startsWith('- gate-states-value:') || trimmed.startsWith('- index:')) {
        // New entry starts
        pushEntry()
        currentEntry = { index: 0, gateStates: 255, timeInterval: 0 }
        if (trimmed.startsWith('- gate-states-value:')) {
          currentEntry.gateStates = parseInt(trimmed.split(':')[1]) || 255
        } else if (trimmed.startsWith('- index:')) {
          currentEntry.index = parseInt(trimmed.split(':')[1]) || 0
        }
      } else if (currentEntry && (section === 'admin-control-list' || section === 'oper-control-list')) {
        if (trimmed.startsWith('gate-states-value:')) {
          currentEntry.gateStates = parseInt(trimmed.split(':')[1]) || 255
        } else if (trimmed.startsWith('time-interval-value:')) {
          currentEntry.timeInterval = parseInt(trimmed.split(':')[1]) || 0
        } else if (trimmed.startsWith('index:')) {
          currentEntry.index = parseInt(trimmed.split(':')[1]) || 0
        }
      }

      // Parse cycle time numerator
      if (trimmed.startsWith('numerator:') && section === '') {
        const val = parseInt(trimmed.split(':')[1]) || 0
        if (val > 0) data.cycleTimeNs = val
      }
    }

    // Push last entry
    pushEntry()

    return data
  }

  // Convert gates array to integer (bitmask)
  const gatesToInt = (gates) => {
    return gates.reduce((acc, open, idx) => acc | (open ? (1 << idx) : 0), 0)
  }

  // Toggle a gate in an entry
  const toggleGate = (entryIdx, tcIdx) => {
    const updated = [...gateEntries]
    updated[entryIdx].gates[tcIdx] = !updated[entryIdx].gates[tcIdx]
    setGateEntries(updated)
  }

  // Update time for an entry
  const updateEntryTime = (entryIdx, timeUs) => {
    const updated = [...gateEntries]
    updated[entryIdx].timeUs = parseInt(timeUs) || 0
    setGateEntries(updated)
  }

  // Add new entry
  const addEntry = () => {
    setGateEntries([...gateEntries, { timeUs: 125, gates: [true, true, true, true, true, true, true, true] }])
  }

  // Remove entry
  const removeEntry = (idx) => {
    if (gateEntries.length > 1) {
      setGateEntries(gateEntries.filter((_, i) => i !== idx))
    }
  }

  // Calculate totals
  const totalTimeUs = gateEntries.reduce((sum, e) => sum + e.timeUs, 0)

  // Apply full configuration
  const applyConfig = async () => {
    // Validate cycle time >= total GCL time
    if (cycleTimeUs < totalTimeUs) {
      setError(`Cycle time (${cycleTimeUs} µs) must be >= total GCL time (${totalTimeUs} µs)`)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const patches = []

      // Gate enabled
      patches.push({ path: `${basePath}/gate-enabled`, value: gateEnabled })

      // Admin gate states
      patches.push({ path: `${basePath}/admin-gate-states`, value: adminGateStates })

      // Gate control list entries
      gateEntries.forEach((entry, idx) => {
        patches.push({
          path: `${basePath}/admin-control-list/gate-control-entry`,
          value: {
            index: idx + 1,
            'operation-name': 'ieee802-dot1q-sched:set-gate-states',
            'time-interval-value': entry.timeUs * 1000, // convert to nanoseconds
            'gate-states-value': gatesToInt(entry.gates)
          }
        })
      })

      // Cycle time (numerator in nanoseconds, denominator = 1)
      patches.push({ path: `${basePath}/admin-cycle-time/numerator`, value: cycleTimeUs * 1000 })
      patches.push({ path: `${basePath}/admin-cycle-time/denominator`, value: 1 })

      // Cycle time extension
      patches.push({ path: `${basePath}/admin-cycle-time-extension`, value: cycleTimeExtensionUs * 1000 })

      // Base time
      patches.push({ path: `${basePath}/admin-base-time/seconds`, value: String(baseTimeSeconds) })
      patches.push({ path: `${basePath}/admin-base-time/nanoseconds`, value: 0 })

      const response = await axios.post('/api/patch', {
        patches,
        transport: config.transport,
        device: config.device,
        host: config.host,
        port: config.port
      }, { timeout: 30000 })

      setResult({ type: 'patch', label: 'Apply Config', data: response.data })
    } catch (err) {
      setError(err.response?.data?.error || err.message)
    } finally {
      setLoading(false)
    }
  }

  // Trigger config change
  const triggerConfigChange = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await axios.post('/api/patch', {
        patches: [{ path: `${basePath}/config-change`, value: true }],
        transport: config.transport,
        device: config.device,
        host: config.host,
        port: config.port
      }, { timeout: 10000 })
      setResult({ type: 'patch', label: 'Config Change', data: response.data })
    } catch (err) {
      setError(err.response?.data?.error || err.message)
    } finally {
      setLoading(false)
    }
  }

  // Fetch current time from device
  const fetchCurrentTime = async () => {
    setLoading(true)
    try {
      const response = await axios.post('/api/fetch', {
        paths: [`${basePath}/current-time`],
        transport: config.transport,
        device: config.device,
        host: config.host,
        port: config.port
      }, { timeout: 10000 })
      setResult({ type: 'fetch', label: 'Current Time', data: response.data.result })
    } catch (err) {
      setError(err.response?.data?.error || err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">TAS Configuration (IEEE 802.1Qbv)</h1>
        <p className="page-description">Time-Aware Shaper - Gate Control List Configuration</p>
      </div>

      {/* Port Selection & Load */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Port Selection</h2>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-secondary" onClick={loadFromDevice} disabled={loading}>
              {loading ? 'Loading...' : 'Load from Device'}
            </button>
            <button className="btn btn-secondary" onClick={fetchCurrentTime} disabled={loading}>
              Current Time
            </button>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Port</label>
            <select className="form-select" value={portNumber} onChange={(e) => setPortNumber(e.target.value)}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map(p => (
                <option key={p} value={p}>Port {p}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Gate Enabled</label>
            <select className="form-select" value={gateEnabled} onChange={(e) => setGateEnabled(e.target.value === 'true')}>
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Default Gate States</label>
            <input
              type="number"
              className="form-input"
              value={adminGateStates}
              onChange={(e) => setAdminGateStates(parseInt(e.target.value) || 0)}
              min="0"
              max="255"
            />
            <small style={{ color: '#64748b', fontSize: '0.7rem' }}>255 = all gates open when GCL inactive</small>
          </div>
        </div>
      </div>

      {/* Gate Control List Table */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Gate Control List</h2>
          <button className="btn btn-secondary" onClick={addEntry} style={{ fontSize: '0.8rem', padding: '6px 12px' }}>
            + Add Entry
          </button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ minWidth: '700px' }}>
            <thead>
              <tr>
                <th style={{ width: '50px' }}>#</th>
                <th style={{ width: '100px' }}>Time (µs)</th>
                <th style={{ textAlign: 'center' }}>TC7</th>
                <th style={{ textAlign: 'center' }}>TC6</th>
                <th style={{ textAlign: 'center' }}>TC5</th>
                <th style={{ textAlign: 'center' }}>TC4</th>
                <th style={{ textAlign: 'center' }}>TC3</th>
                <th style={{ textAlign: 'center' }}>TC2</th>
                <th style={{ textAlign: 'center' }}>TC1</th>
                <th style={{ textAlign: 'center' }}>TC0</th>
                <th style={{ width: '80px' }}>Value</th>
                <th style={{ width: '50px' }}></th>
              </tr>
            </thead>
            <tbody>
              {gateEntries.map((entry, idx) => (
                <tr key={idx}>
                  <td style={{ fontWeight: '600', color: '#64748b' }}>{idx + 1}</td>
                  <td>
                    <input
                      type="number"
                      className="form-input"
                      value={entry.timeUs}
                      onChange={(e) => updateEntryTime(idx, e.target.value)}
                      style={{ width: '90px' }}
                      min="1"
                    />
                  </td>
                  {[7, 6, 5, 4, 3, 2, 1, 0].map(tc => (
                    <td key={tc} style={{ textAlign: 'center' }}>
                      <button
                        onClick={() => toggleGate(idx, tc)}
                        style={{
                          width: '36px',
                          height: '36px',
                          borderRadius: '6px',
                          border: 'none',
                          cursor: 'pointer',
                          background: entry.gates[tc] ? '#22c55e' : '#ef4444',
                          color: '#fff',
                          fontWeight: '600',
                          fontSize: '0.8rem',
                          transition: 'all 0.15s'
                        }}
                      >
                        {entry.gates[tc] ? 'O' : 'C'}
                      </button>
                    </td>
                  ))}
                  <td style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: '#64748b' }}>
                    {gatesToInt(entry.gates)}
                  </td>
                  <td>
                    <button
                      onClick={() => removeEntry(idx)}
                      disabled={gateEntries.length <= 1}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: gateEntries.length > 1 ? 'pointer' : 'not-allowed',
                        color: gateEntries.length > 1 ? '#dc2626' : '#ccc'
                      }}
                    >
                      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: '12px', padding: '12px', background: '#f8fafc', borderRadius: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span style={{ color: '#22c55e', fontWeight: '600' }}>O</span> = Open (transmit allowed)
            <span style={{ marginLeft: '16px', color: '#ef4444', fontWeight: '600' }}>C</span> = Closed (blocked)
          </div>
          <div style={{ fontWeight: '500' }}>
            Total: <span style={{ fontFamily: 'monospace' }}>{totalTimeUs} µs</span>
            {totalTimeUs !== cycleTimeUs && (
              <span style={{ marginLeft: '8px', color: totalTimeUs > cycleTimeUs ? '#ef4444' : '#eab308', fontSize: '0.85rem' }}>
                (Cycle: {cycleTimeUs} µs)
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Timing Configuration */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Timing Configuration</h2>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Cycle Time (µs)</label>
            <input
              type="number"
              className="form-input"
              value={cycleTimeUs}
              onChange={(e) => setCycleTimeUs(parseInt(e.target.value) || 0)}
              min="1"
            />
            <small style={{ color: '#64748b', fontSize: '0.7rem' }}>
              Must be ≥ total GCL time ({totalTimeUs} µs)
            </small>
          </div>
          <div className="form-group">
            <label className="form-label">Cycle Time Extension (µs)</label>
            <input
              type="number"
              className="form-input"
              value={cycleTimeExtensionUs}
              onChange={(e) => setCycleTimeExtensionUs(parseInt(e.target.value) || 0)}
              min="0"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Base Time (seconds)</label>
            <input
              type="number"
              className="form-input"
              value={baseTimeSeconds}
              onChange={(e) => setBaseTimeSeconds(parseInt(e.target.value) || 0)}
              min="0"
            />
            <small style={{ color: '#64748b', fontSize: '0.7rem' }}>
              PTP time when schedule becomes active
            </small>
          </div>
        </div>

        {/* Auto-fill cycle time button */}
        <button
          className="btn btn-secondary"
          onClick={() => setCycleTimeUs(totalTimeUs)}
          style={{ marginTop: '8px' }}
        >
          Set Cycle Time = Total GCL Time ({totalTimeUs} µs)
        </button>
      </div>

      {/* Apply Configuration */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Apply Configuration</h2>
        </div>
        <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '16px' }}>
          1. Apply Config → 2. Trigger Config Change → Schedule becomes active at Base Time
        </p>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={applyConfig} disabled={loading}>
            {loading ? 'Applying...' : '1. Apply Config'}
          </button>
          <button className="btn btn-success" onClick={triggerConfigChange} disabled={loading}>
            2. Trigger Config Change
          </button>
        </div>

        <div style={{ marginTop: '16px', padding: '12px', background: '#fef3c7', borderRadius: '8px', fontSize: '0.85rem' }}>
          <strong>Note:</strong> Base Time must be set to a future PTP time. After Config Change,
          the Admin config becomes Operational at Base Time.
        </div>
      </div>

      {/* Error */}
      {error && <div className="alert alert-error">{error}</div>}

      {/* Result */}
      {result && (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Result: {result.label}</h2>
            <span className={`status-badge ${result.type === 'fetch' ? 'info' : 'success'}`}>
              {result.type === 'fetch' ? 'Fetched' : 'Applied'}
            </span>
          </div>
          <div className="result-container">
            <div className="result-content">
              <pre>{typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2)}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default TAS
