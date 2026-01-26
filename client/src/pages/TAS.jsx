import { useState } from 'react'
import axios from 'axios'

function TAS({ config }) {
  const [portNumber, setPortNumber] = useState('1')
  const [gateEnabled, setGateEnabled] = useState(true)
  const [adminGateStates, setAdminGateStates] = useState(255)

  // Cycle Time: numerator / denominator (e.g., 140000000 / 1000000000 = 140ms)
  const [cycleTimeNumerator, setCycleTimeNumerator] = useState(140000000)
  const [cycleTimeDenominator, setCycleTimeDenominator] = useState(1000000000)
  const [cycleTimeExtension, setCycleTimeExtension] = useState(10000000) // 10ms in ns

  // Base Time
  const [baseTimeSeconds, setBaseTimeSeconds] = useState(20)
  const [baseTimeNanoseconds, setBaseTimeNanoseconds] = useState(0)

  // Queue Max SDU
  const [maxSduEntries, setMaxSduEntries] = useState([
    { trafficClass: 0, maxSdu: 0 },
    { trafficClass: 7, maxSdu: 0 }
  ])

  // Gate Control List (1-based index as per documentation)
  const [gateControlList, setGateControlList] = useState([
    { index: 1, gateStates: 1, timeInterval: 10000000 },   // TC0 open, 10ms
    { index: 2, gateStates: 8, timeInterval: 40000000 },   // TC3 open, 40ms
    { index: 3, gateStates: 128, timeInterval: 90000000 }  // TC7 open, 90ms
  ])

  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const basePath = `/ietf-interfaces:interfaces/interface[name='${portNumber}']/ieee802-dot1q-bridge:bridge-port/ieee802-dot1q-sched-bridge:gate-parameter-table`

  const handleFetch = async (paths, label) => {
    setLoading(true)
    setError(null)
    try {
      const response = await axios.post('/api/fetch', {
        paths,
        transport: config.transport,
        device: config.device,
        host: config.host,
        port: config.port
      })
      setResult({ type: 'fetch', label, data: response.data.result })
    } catch (err) {
      setError(err.response?.data?.error || err.message)
    } finally {
      setLoading(false)
    }
  }

  const handlePatch = async (patches, label) => {
    setLoading(true)
    setError(null)
    try {
      const response = await axios.post('/api/patch', {
        patches,
        transport: config.transport,
        device: config.device,
        host: config.host,
        port: config.port
      })
      setResult({ type: 'patch', label, data: response.data })
    } catch (err) {
      setError(err.response?.data?.error || err.message)
    } finally {
      setLoading(false)
    }
  }

  // Fetch full Gate Parameter Table
  const fetchGateParameterTable = () => handleFetch([basePath], 'Gate Parameter Table')

  // Fetch config-pending status
  const fetchConfigPending = () => handleFetch([`${basePath}/config-pending`], 'Config Pending')

  // Fetch current-time
  const fetchCurrentTime = () => handleFetch([`${basePath}/current-time`], 'Current Time')

  // Set Gate Enabled
  const applyGateEnabled = () => {
    handlePatch([{ path: `${basePath}/gate-enabled`, value: gateEnabled }], 'Gate Enabled')
  }

  // Set Admin Gate States
  const applyAdminGateStates = () => {
    handlePatch([{ path: `${basePath}/admin-gate-states`, value: adminGateStates }], 'Admin Gate States')
  }

  // Set Queue Max SDU for a traffic class
  const applyMaxSdu = (tc, maxSdu) => {
    handlePatch([{
      path: `${basePath}/queue-max-sdu-table[traffic-class='${tc}']/queue-max-sdu`,
      value: maxSdu
    }], `Max SDU TC${tc}`)
  }

  // Apply all Max SDU entries
  const applyAllMaxSdu = () => {
    const patches = maxSduEntries.map(entry => ({
      path: `${basePath}/queue-max-sdu-table[traffic-class='${entry.trafficClass}']/queue-max-sdu`,
      value: entry.maxSdu
    }))
    handlePatch(patches, 'All Max SDU')
  }

  // Apply Gate Control List entries
  const applyGateControlList = () => {
    const patches = gateControlList.map(entry => ({
      path: `${basePath}/admin-control-list/gate-control-entry`,
      value: {
        index: entry.index,
        'operation-name': 'ieee802-dot1q-sched:set-gate-states',
        'time-interval-value': entry.timeInterval,
        'gate-states-value': entry.gateStates
      }
    }))
    handlePatch(patches, 'Gate Control List')
  }

  // Apply Cycle Time
  const applyCycleTime = () => {
    handlePatch([
      { path: `${basePath}/admin-cycle-time/numerator`, value: cycleTimeNumerator },
      { path: `${basePath}/admin-cycle-time/denominator`, value: cycleTimeDenominator }
    ], 'Cycle Time')
  }

  // Apply Cycle Time Extension
  const applyCycleTimeExtension = () => {
    handlePatch([{ path: `${basePath}/admin-cycle-time-extension`, value: cycleTimeExtension }], 'Cycle Time Extension')
  }

  // Apply Base Time
  const applyBaseTime = () => {
    handlePatch([
      { path: `${basePath}/admin-base-time/seconds`, value: String(baseTimeSeconds) },
      { path: `${basePath}/admin-base-time/nanoseconds`, value: baseTimeNanoseconds }
    ], 'Base Time')
  }

  // Trigger Config Change
  const triggerConfigChange = () => {
    handlePatch([{ path: `${basePath}/config-change`, value: true }], 'Config Change')
  }

  // Apply full TAS configuration
  const applyFullConfig = async () => {
    setLoading(true)
    setError(null)
    try {
      // Build all patches
      const patches = []

      // Gate enabled
      patches.push({ path: `${basePath}/gate-enabled`, value: gateEnabled })

      // Admin gate states
      patches.push({ path: `${basePath}/admin-gate-states`, value: adminGateStates })

      // Max SDU entries
      maxSduEntries.forEach(entry => {
        patches.push({
          path: `${basePath}/queue-max-sdu-table[traffic-class='${entry.trafficClass}']/queue-max-sdu`,
          value: entry.maxSdu
        })
      })

      // Gate control list entries
      gateControlList.forEach(entry => {
        patches.push({
          path: `${basePath}/admin-control-list/gate-control-entry`,
          value: {
            index: entry.index,
            'operation-name': 'ieee802-dot1q-sched:set-gate-states',
            'time-interval-value': entry.timeInterval,
            'gate-states-value': entry.gateStates
          }
        })
      })

      // Cycle time
      patches.push({ path: `${basePath}/admin-cycle-time/numerator`, value: cycleTimeNumerator })
      patches.push({ path: `${basePath}/admin-cycle-time/denominator`, value: cycleTimeDenominator })

      // Cycle time extension
      patches.push({ path: `${basePath}/admin-cycle-time-extension`, value: cycleTimeExtension })

      // Base time
      patches.push({ path: `${basePath}/admin-base-time/seconds`, value: String(baseTimeSeconds) })
      patches.push({ path: `${basePath}/admin-base-time/nanoseconds`, value: baseTimeNanoseconds })

      const response = await axios.post('/api/patch', {
        patches,
        transport: config.transport,
        device: config.device,
        host: config.host,
        port: config.port
      })
      setResult({ type: 'patch', label: 'Full TAS Config', data: response.data })
    } catch (err) {
      setError(err.response?.data?.error || err.message)
    } finally {
      setLoading(false)
    }
  }

  // Gate Control List management
  const addGateEntry = () => {
    const nextIndex = gateControlList.length > 0 ? Math.max(...gateControlList.map(e => e.index)) + 1 : 1
    setGateControlList([...gateControlList, { index: nextIndex, gateStates: 255, timeInterval: 10000000 }])
  }

  const removeGateEntry = (idx) => {
    setGateControlList(gateControlList.filter((_, i) => i !== idx))
  }

  const updateGateEntry = (idx, field, value) => {
    const updated = [...gateControlList]
    updated[idx][field] = parseInt(value)
    setGateControlList(updated)
  }

  // Max SDU management
  const addMaxSduEntry = () => {
    const usedTCs = maxSduEntries.map(e => e.trafficClass)
    const nextTC = [0,1,2,3,4,5,6,7].find(tc => !usedTCs.includes(tc)) ?? 0
    setMaxSduEntries([...maxSduEntries, { trafficClass: nextTC, maxSdu: 0 }])
  }

  const removeMaxSduEntry = (idx) => {
    setMaxSduEntries(maxSduEntries.filter((_, i) => i !== idx))
  }

  const updateMaxSduEntry = (idx, field, value) => {
    const updated = [...maxSduEntries]
    updated[idx][field] = parseInt(value)
    setMaxSduEntries(updated)
  }

  // Calculate total cycle time from entries
  const totalIntervalTime = gateControlList.reduce((sum, e) => sum + e.timeInterval, 0)
  const cycleTimeMs = cycleTimeNumerator / 1000000

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">TAS Configuration (IEEE 802.1Qbv)</h1>
        <p className="page-description">Time-Aware Shaper - Gate Control List Configuration</p>
      </div>

      {/* Port & Status */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Port & Status</h2>
          <div style={{display:'flex',gap:'8px'}}>
            <button className="btn btn-secondary" onClick={fetchGateParameterTable} disabled={loading} style={{fontSize:'0.8rem',padding:'6px 12px'}}>
              Fetch All
            </button>
            <button className="btn btn-secondary" onClick={fetchCurrentTime} disabled={loading} style={{fontSize:'0.8rem',padding:'6px 12px'}}>
              Current Time
            </button>
            <button className="btn btn-secondary" onClick={fetchConfigPending} disabled={loading} style={{fontSize:'0.8rem',padding:'6px 12px'}}>
              Config Pending?
            </button>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Port Number</label>
            <select className="form-select" value={portNumber} onChange={(e) => setPortNumber(e.target.value)}>
              {[1,2,3,4,5,6,7,8].map(p => <option key={p} value={p}>Port {p}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Connection</label>
            <div style={{padding:'10px',background:'#f8fafc',borderRadius:'6px'}}>
              {config.transport === 'wifi' ? `WiFi: ${config.host}:${config.port}` : `Serial: ${config.device}`}
            </div>
          </div>
        </div>
      </div>

      {/* Gate Enable */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Gate Enable</h2>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Gate Enabled</label>
            <select className="form-select" value={gateEnabled} onChange={(e) => setGateEnabled(e.target.value === 'true')}>
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Admin Gate States (0-255)</label>
            <input type="number" className="form-input" value={adminGateStates} onChange={(e) => setAdminGateStates(parseInt(e.target.value))} min="0" max="255" />
            <small style={{color:'#64748b',fontSize:'0.75rem'}}>
              Default gate state when Control List is inactive. 255 = all TCs open
            </small>
          </div>
        </div>
        <div style={{display:'flex',gap:'8px'}}>
          <button className="btn btn-primary" onClick={applyGateEnabled} disabled={loading}>Apply Gate Enable</button>
          <button className="btn btn-primary" onClick={applyAdminGateStates} disabled={loading}>Apply Gate States</button>
        </div>
      </div>

      {/* Queue Max SDU */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Queue Max SDU</h2>
          <button className="btn btn-secondary" onClick={addMaxSduEntry} style={{fontSize:'0.8rem',padding:'6px 12px'}}>
            + Add Entry
          </button>
        </div>
        <p style={{fontSize:'0.85rem',color:'#64748b',marginBottom:'12px'}}>
          Max SDU size per Traffic Class. 0 = use MAC max. Used for Guard Band calculation.
        </p>

        <div style={{overflowX:'auto'}}>
          <table className="table">
            <thead>
              <tr>
                <th>Traffic Class</th>
                <th>Max SDU (bytes)</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {maxSduEntries.map((entry, idx) => (
                <tr key={idx}>
                  <td>
                    <select className="form-select" value={entry.trafficClass} onChange={(e) => updateMaxSduEntry(idx, 'trafficClass', e.target.value)} style={{width:'100px'}}>
                      {[0,1,2,3,4,5,6,7].map(tc => <option key={tc} value={tc}>TC {tc}</option>)}
                    </select>
                  </td>
                  <td>
                    <input type="number" className="form-input" value={entry.maxSdu} onChange={(e) => updateMaxSduEntry(idx, 'maxSdu', e.target.value)} style={{width:'120px'}} min="0" />
                  </td>
                  <td>
                    <button onClick={() => removeMaxSduEntry(idx)} style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626'}}>
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
        <button className="btn btn-primary" onClick={applyAllMaxSdu} disabled={loading} style={{marginTop:'12px'}}>Apply Max SDU</button>
      </div>

      {/* Gate Control List */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Admin Gate Control List</h2>
          <button className="btn btn-secondary" onClick={addGateEntry} style={{fontSize:'0.8rem',padding:'6px 12px'}}>
            + Add Entry
          </button>
        </div>
        <p style={{fontSize:'0.85rem',color:'#64748b',marginBottom:'12px'}}>
          Gate Control List entries. Each entry applies gate-states for the specified time-interval.
        </p>

        <div style={{overflowX:'auto'}}>
          <table className="table">
            <thead>
              <tr>
                <th>Index</th>
                <th>Gate States (0-255)</th>
                <th>Time Interval (ns)</th>
                <th>Time (ms)</th>
                <th>Gates Visualization</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {gateControlList.map((entry, idx) => (
                <tr key={idx}>
                  <td>
                    <input type="number" className="form-input" value={entry.index} onChange={(e) => updateGateEntry(idx, 'index', e.target.value)} style={{width:'70px'}} min="1" />
                  </td>
                  <td>
                    <input type="number" className="form-input" value={entry.gateStates} onChange={(e) => updateGateEntry(idx, 'gateStates', e.target.value)} min="0" max="255" style={{width:'100px'}} />
                  </td>
                  <td>
                    <input type="number" className="form-input" value={entry.timeInterval} onChange={(e) => updateGateEntry(idx, 'timeInterval', e.target.value)} style={{width:'140px'}} />
                  </td>
                  <td style={{color:'#64748b',fontSize:'0.85rem'}}>
                    {(entry.timeInterval / 1000000).toFixed(2)} ms
                  </td>
                  <td>
                    <div style={{display:'flex',gap:'2px'}}>
                      {[7,6,5,4,3,2,1,0].map(tc => (
                        <div key={tc} style={{
                          width:'24px',height:'24px',borderRadius:'4px',
                          background: (entry.gateStates >> tc) & 1 ? '#16a34a' : '#dc2626',
                          display:'flex',alignItems:'center',justifyContent:'center',
                          color:'#fff',fontSize:'0.7rem',fontWeight:'600'
                        }}>
                          {tc}
                        </div>
                      ))}
                    </div>
                  </td>
                  <td>
                    <button onClick={() => removeGateEntry(idx)} style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626'}}>
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

        <div style={{marginTop:'8px',fontSize:'0.75rem',color:'#64748b'}}>
          Green = Open (O), Red = Closed (C). Total Interval: {(totalIntervalTime / 1000000).toFixed(2)} ms
        </div>
        <button className="btn btn-primary" onClick={applyGateControlList} disabled={loading} style={{marginTop:'12px'}}>Apply Gate Control List</button>
      </div>

      {/* Timing Configuration */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Timing Configuration</h2>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Cycle Time Numerator (ns)</label>
            <input type="number" className="form-input" value={cycleTimeNumerator} onChange={(e) => setCycleTimeNumerator(parseInt(e.target.value))} />
            <small style={{color:'#64748b',fontSize:'0.75rem'}}>
              = {cycleTimeMs.toFixed(2)} ms (must be ≥ total interval: {(totalIntervalTime / 1000000).toFixed(2)} ms)
            </small>
          </div>
          <div className="form-group">
            <label className="form-label">Cycle Time Denominator</label>
            <input type="number" className="form-input" value={cycleTimeDenominator} onChange={(e) => setCycleTimeDenominator(parseInt(e.target.value))} />
            <small style={{color:'#64748b',fontSize:'0.75rem'}}>Typically 1000000000 (1 second)</small>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Cycle Time Extension (ns)</label>
            <input type="number" className="form-input" value={cycleTimeExtension} onChange={(e) => setCycleTimeExtension(parseInt(e.target.value))} />
            <small style={{color:'#64748b',fontSize:'0.75rem'}}>= {(cycleTimeExtension / 1000000).toFixed(2)} ms</small>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Base Time (Seconds)</label>
            <input type="number" className="form-input" value={baseTimeSeconds} onChange={(e) => setBaseTimeSeconds(parseInt(e.target.value))} />
            <small style={{color:'#64748b',fontSize:'0.75rem'}}>Pending → Operational transition point (PTP time)</small>
          </div>
          <div className="form-group">
            <label className="form-label">Base Time (Nanoseconds)</label>
            <input type="number" className="form-input" value={baseTimeNanoseconds} onChange={(e) => setBaseTimeNanoseconds(parseInt(e.target.value))} min="0" max="999999999" />
          </div>
        </div>

        <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
          <button className="btn btn-primary" onClick={applyCycleTime} disabled={loading}>Apply Cycle Time</button>
          <button className="btn btn-primary" onClick={applyCycleTimeExtension} disabled={loading}>Apply Extension</button>
          <button className="btn btn-primary" onClick={applyBaseTime} disabled={loading}>Apply Base Time</button>
        </div>
      </div>

      {/* Apply & Config Change */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Apply Configuration</h2>
        </div>
        <p style={{fontSize:'0.85rem',color:'#64748b',marginBottom:'12px'}}>
          1. Apply full config → 2. Trigger Config Change → 3. Becomes Operational at Base Time
        </p>

        <div style={{display:'flex',gap:'12px',flexWrap:'wrap'}}>
          <button className="btn btn-primary" onClick={applyFullConfig} disabled={loading}>
            {loading ? 'Applying...' : '1. Apply Full Config'}
          </button>
          <button className="btn btn-success" onClick={triggerConfigChange} disabled={loading}>
            2. Trigger Config Change
          </button>
        </div>

        <div style={{marginTop:'12px',padding:'12px',background:'#fef3c7',borderRadius:'8px',fontSize:'0.85rem'}}>
          <strong>Note:</strong> After Config Change, Admin → Oper transition occurs at Base Time.
          Base Time must be set to a future time. Check Current Time.
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

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
