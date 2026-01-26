import { useState } from 'react'
import axios from 'axios'

function TAS({ config }) {
  const [portNumber, setPortNumber] = useState('2')
  const [gateEnabled, setGateEnabled] = useState(true)
  const [adminGateStates, setAdminGateStates] = useState(255)
  const [cycleTimeNumerator, setCycleTimeNumerator] = useState(1000000)
  const [cycleTimeDenominator, setCycleTimeDenominator] = useState(1)
  const [baseTimeSeconds, setBaseTimeSeconds] = useState(0)
  const [baseTimeNanoseconds, setBaseTimeNanoseconds] = useState(0)
  const [gateControlList, setGateControlList] = useState([
    { gateStates: 255, timeInterval: 500000 },
    { gateStates: 1, timeInterval: 500000 }
  ])
  const [loading, setLoading] = useState(false)
  const [fetchLoading, setFetchLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const basePath = `/ietf-interfaces:interfaces/interface[name='${portNumber}']/ieee802-dot1q-bridge:bridge-port/ieee802-dot1q-sched-bridge:gate-parameter-table`

  const addGateEntry = () => {
    setGateControlList([...gateControlList, { gateStates: 255, timeInterval: 100000 }])
  }

  const removeGateEntry = (index) => {
    setGateControlList(gateControlList.filter((_, i) => i !== index))
  }

  const updateGateEntry = (index, field, value) => {
    const updated = [...gateControlList]
    updated[index][field] = parseInt(value)
    setGateControlList(updated)
  }

  const handleFetchConfig = async () => {
    setFetchLoading(true)
    setError(null)

    try {
      const paths = [
        `${basePath}/gate-enabled`,
        `${basePath}/admin-gate-states`,
        `${basePath}/admin-cycle-time`,
        `${basePath}/admin-base-time`
      ]

      const response = await axios.post('/api/fetch', {
        paths,
        transport: config.transport,
        device: config.device,
        host: config.host,
        port: config.port
      })

      setResult({ type: 'fetch', data: response.data.result })
    } catch (err) {
      setError(err.response?.data?.error || err.message)
    } finally {
      setFetchLoading(false)
    }
  }

  const handleApplyConfig = async () => {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const patches = [
        { path: `${basePath}/gate-enabled`, value: gateEnabled },
        { path: `${basePath}/admin-gate-states`, value: adminGateStates },
        { path: `${basePath}/admin-cycle-time/numerator`, value: cycleTimeNumerator },
        { path: `${basePath}/admin-cycle-time/denominator`, value: cycleTimeDenominator },
        { path: `${basePath}/admin-base-time/seconds`, value: baseTimeSeconds },
        { path: `${basePath}/admin-base-time/fractional-seconds`, value: baseTimeNanoseconds }
      ]

      // Add gate control list entries
      gateControlList.forEach((entry, index) => {
        patches.push({
          path: `${basePath}/admin-control-list/gate-control-entry[index='${index}']/gate-states-value`,
          value: entry.gateStates
        })
        patches.push({
          path: `${basePath}/admin-control-list/gate-control-entry[index='${index}']/time-interval-value`,
          value: entry.timeInterval
        })
      })

      const response = await axios.post('/api/patch', {
        patches,
        transport: config.transport,
        device: config.device,
        host: config.host,
        port: config.port
      })

      setResult({ type: 'patch', data: response.data })
    } catch (err) {
      setError(err.response?.data?.error || err.message)
    } finally {
      setLoading(false)
    }
  }

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
      })

      setResult({ type: 'trigger', data: response.data })
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
        <p className="page-description">Time-Aware Shaper / Gate Control List Configuration</p>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Port Selection</h2>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Port Number</label>
            <select className="form-select" value={portNumber} onChange={(e) => setPortNumber(e.target.value)}>
              {[1,2,3,4,5,6,7,8].map(p => (
                <option key={p} value={p}>Port {p}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Connection</label>
            <div style={{ padding: '10px', background: '#f8fafc', borderRadius: '6px' }}>
              {config.transport === 'wifi' ? `WiFi: ${config.host}:${config.port}` : `Serial: ${config.device}`}
            </div>
          </div>
        </div>
        <button className="btn btn-secondary" onClick={handleFetchConfig} disabled={fetchLoading} style={{ marginTop: '8px' }}>
          {fetchLoading ? 'Loading...' : 'Fetch Current Config'}
        </button>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Gate Parameters</h2>
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
            <input
              type="number"
              className="form-input"
              value={adminGateStates}
              onChange={(e) => setAdminGateStates(parseInt(e.target.value))}
              min="0"
              max="255"
            />
            <small style={{ color: '#64748b', fontSize: '0.75rem' }}>
              Bitmask: TC7-TC0 (255 = all open)
            </small>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Cycle Time Numerator (ns)</label>
            <input
              type="number"
              className="form-input"
              value={cycleTimeNumerator}
              onChange={(e) => setCycleTimeNumerator(parseInt(e.target.value))}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Cycle Time Denominator</label>
            <input
              type="number"
              className="form-input"
              value={cycleTimeDenominator}
              onChange={(e) => setCycleTimeDenominator(parseInt(e.target.value))}
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Base Time (Seconds)</label>
            <input
              type="number"
              className="form-input"
              value={baseTimeSeconds}
              onChange={(e) => setBaseTimeSeconds(parseInt(e.target.value))}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Base Time (Nanoseconds)</label>
            <input
              type="number"
              className="form-input"
              value={baseTimeNanoseconds}
              onChange={(e) => setBaseTimeNanoseconds(parseInt(e.target.value))}
            />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Gate Control List</h2>
          <button className="btn btn-secondary" onClick={addGateEntry} style={{ padding: '6px 12px', fontSize: '0.8rem' }}>
            + Add Entry
          </button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Index</th>
                <th>Gate States (0-255)</th>
                <th>Time Interval (ns)</th>
                <th>Gates Visualization</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {gateControlList.map((entry, index) => (
                <tr key={index}>
                  <td>{index}</td>
                  <td>
                    <input
                      type="number"
                      className="form-input"
                      value={entry.gateStates}
                      onChange={(e) => updateGateEntry(index, 'gateStates', e.target.value)}
                      min="0"
                      max="255"
                      style={{ width: '100px' }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      className="form-input"
                      value={entry.timeInterval}
                      onChange={(e) => updateGateEntry(index, 'timeInterval', e.target.value)}
                      style={{ width: '150px' }}
                    />
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '2px' }}>
                      {[7,6,5,4,3,2,1,0].map(tc => (
                        <div
                          key={tc}
                          style={{
                            width: '24px',
                            height: '24px',
                            borderRadius: '4px',
                            background: (entry.gateStates >> tc) & 1 ? '#16a34a' : '#dc2626',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#fff',
                            fontSize: '0.7rem',
                            fontWeight: '600'
                          }}
                        >
                          {tc}
                        </div>
                      ))}
                    </div>
                  </td>
                  <td>
                    <button
                      onClick={() => removeGateEntry(index)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626' }}
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

        <div style={{ marginTop: '8px', fontSize: '0.75rem', color: '#64748b' }}>
          Green = Open (traffic allowed), Red = Closed (traffic blocked). TC = Traffic Class.
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Actions</h2>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn btn-primary" onClick={handleApplyConfig} disabled={loading}>
            {loading ? 'Applying...' : 'Apply Configuration'}
          </button>
          <button className="btn btn-success" onClick={triggerConfigChange} disabled={loading}>
            Trigger Config Change
          </button>
        </div>
        <div style={{ marginTop: '8px', fontSize: '0.75rem', color: '#64748b' }}>
          After applying configuration, trigger config-change to activate the new schedule.
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {result && (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Result</h2>
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
