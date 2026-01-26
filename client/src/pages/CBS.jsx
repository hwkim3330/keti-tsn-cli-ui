import { useState } from 'react'
import axios from 'axios'

function CBS({ config }) {
  const [portNumber, setPortNumber] = useState('2')
  const [trafficClass, setTrafficClass] = useState(7)

  // CBS parameters
  const [idleSlope, setIdleSlope] = useState(50000000) // bits per second
  const [sendSlope, setSendSlope] = useState(-950000000)
  const [hiCredit, setHiCredit] = useState(150000) // bytes
  const [loCredit, setLoCredit] = useState(-150000)

  // Stream Filter parameters
  const [streamHandle, setStreamHandle] = useState(0)
  const [maxSduSize, setMaxSduSize] = useState(1522)
  const [streamGateRef, setStreamGateRef] = useState(0)

  // Flow Meter parameters
  const [cir, setCir] = useState(100000000) // bits per second
  const [cbs, setCbs] = useState(4096) // bytes
  const [eir, setEir] = useState(0)
  const [ebs, setEbs] = useState(0)

  const [loading, setLoading] = useState(false)
  const [fetchLoading, setFetchLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const bridgePath = `/ieee802-dot1q-bridge:bridges/bridge[name='switch']`
  const portPath = `/ietf-interfaces:interfaces/interface[name='${portNumber}']/ieee802-dot1q-bridge:bridge-port`

  const handleFetchConfig = async () => {
    setFetchLoading(true)
    setError(null)

    try {
      const paths = [
        `${portPath}/ieee802-dot1q-sched-bridge:queue-max-sdu-table`,
        `${bridgePath}/component[name='switch']/ieee802-dot1q-psfp-bridge:stream-filters`,
        `${bridgePath}/component[name='switch']/ieee802-dot1q-psfp-bridge:stream-gates`,
        `${bridgePath}/component[name='switch']/ieee802-dot1q-psfp-bridge:flow-meters`
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

  const handleApplyCBS = async () => {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      // CBS is typically configured via queue parameters
      const patches = [
        {
          path: `${portPath}/ieee802-dot1q-sched-bridge:queue-max-sdu-table/queue-max-sdu-entry[traffic-class='${trafficClass}']/queue-max-sdu`,
          value: maxSduSize
        }
      ]

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

  const handleApplyStreamFilter = async () => {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const filterPath = `${bridgePath}/component[name='switch']/ieee802-dot1q-psfp-bridge:stream-filters/stream-filter-instance-table/stream-filter-instance-entry[stream-filter-instance-id='${streamHandle}']`

      const patches = [
        { path: `${filterPath}/stream-handle`, value: streamHandle },
        { path: `${filterPath}/max-sdu-size`, value: maxSduSize },
        { path: `${filterPath}/stream-gate-ref`, value: streamGateRef }
      ]

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

  const handleApplyFlowMeter = async () => {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const meterPath = `${bridgePath}/component[name='switch']/ieee802-dot1q-psfp-bridge:flow-meters/flow-meter-instance-table/flow-meter-instance-entry[flow-meter-instance-id='0']`

      const patches = [
        { path: `${meterPath}/committed-information-rate`, value: cir },
        { path: `${meterPath}/committed-burst-size`, value: cbs },
        { path: `${meterPath}/excess-information-rate`, value: eir },
        { path: `${meterPath}/excess-burst-size`, value: ebs }
      ]

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

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">CBS / PSFP Configuration</h1>
        <p className="page-description">Credit-Based Shaper (802.1Qav) & Per-Stream Filtering and Policing (802.1Qci)</p>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Port & Connection</h2>
          <button className="btn btn-secondary" onClick={handleFetchConfig} disabled={fetchLoading}>
            {fetchLoading ? 'Loading...' : 'Fetch Current'}
          </button>
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
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Queue Max SDU (CBS)</h2>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Traffic Class</label>
            <select className="form-select" value={trafficClass} onChange={(e) => setTrafficClass(parseInt(e.target.value))}>
              {[0,1,2,3,4,5,6,7].map(tc => (
                <option key={tc} value={tc}>TC {tc}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Max SDU Size (bytes)</label>
            <input
              type="number"
              className="form-input"
              value={maxSduSize}
              onChange={(e) => setMaxSduSize(parseInt(e.target.value))}
            />
          </div>
        </div>

        <button className="btn btn-primary" onClick={handleApplyCBS} disabled={loading}>
          {loading ? 'Applying...' : 'Apply Queue Config'}
        </button>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Stream Filter (PSFP)</h2>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Stream Handle</label>
            <input
              type="number"
              className="form-input"
              value={streamHandle}
              onChange={(e) => setStreamHandle(parseInt(e.target.value))}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Stream Gate Reference</label>
            <input
              type="number"
              className="form-input"
              value={streamGateRef}
              onChange={(e) => setStreamGateRef(parseInt(e.target.value))}
            />
          </div>
        </div>

        <button className="btn btn-primary" onClick={handleApplyStreamFilter} disabled={loading}>
          {loading ? 'Applying...' : 'Apply Stream Filter'}
        </button>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Flow Meter (Rate Limiter)</h2>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">CIR (bits/sec)</label>
            <input
              type="number"
              className="form-input"
              value={cir}
              onChange={(e) => setCir(parseInt(e.target.value))}
            />
            <small style={{ color: '#64748b', fontSize: '0.75rem' }}>Committed Information Rate</small>
          </div>
          <div className="form-group">
            <label className="form-label">CBS (bytes)</label>
            <input
              type="number"
              className="form-input"
              value={cbs}
              onChange={(e) => setCbs(parseInt(e.target.value))}
            />
            <small style={{ color: '#64748b', fontSize: '0.75rem' }}>Committed Burst Size</small>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">EIR (bits/sec)</label>
            <input
              type="number"
              className="form-input"
              value={eir}
              onChange={(e) => setEir(parseInt(e.target.value))}
            />
            <small style={{ color: '#64748b', fontSize: '0.75rem' }}>Excess Information Rate</small>
          </div>
          <div className="form-group">
            <label className="form-label">EBS (bytes)</label>
            <input
              type="number"
              className="form-input"
              value={ebs}
              onChange={(e) => setEbs(parseInt(e.target.value))}
            />
            <small style={{ color: '#64748b', fontSize: '0.75rem' }}>Excess Burst Size</small>
          </div>
        </div>

        <button className="btn btn-primary" onClick={handleApplyFlowMeter} disabled={loading}>
          {loading ? 'Applying...' : 'Apply Flow Meter'}
        </button>
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

export default CBS
