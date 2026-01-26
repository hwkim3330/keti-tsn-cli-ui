import { useState } from 'react'
import axios from 'axios'

function PTP({ config }) {
  const [instanceIndex, setInstanceIndex] = useState(0)
  const [instanceEnabled, setInstanceEnabled] = useState(true)
  const [domainNumber, setDomainNumber] = useState(0)
  const [priority1, setPriority1] = useState(128)
  const [priority2, setPriority2] = useState(128)
  const [instanceType, setInstanceType] = useState('ordinary-clock')
  const [automotiveProfile, setAutomotiveProfile] = useState('none')

  const [portConfigs, setPortConfigs] = useState([
    { portIndex: 1, enabled: true, logSyncInterval: -3, logPdelayInterval: 0 }
  ])

  const [loading, setLoading] = useState(false)
  const [fetchLoading, setFetchLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const basePath = `/ieee1588-ptp:ptp/instances/instance[instance-index='${instanceIndex}']`

  const addPort = () => {
    const nextIndex = portConfigs.length > 0 ? Math.max(...portConfigs.map(p => p.portIndex)) + 1 : 1
    setPortConfigs([...portConfigs, { portIndex: nextIndex, enabled: true, logSyncInterval: -3, logPdelayInterval: 0 }])
  }

  const removePort = (index) => {
    setPortConfigs(portConfigs.filter((_, i) => i !== index))
  }

  const updatePort = (index, field, value) => {
    const updated = [...portConfigs]
    if (field === 'enabled') {
      updated[index][field] = value === 'true'
    } else {
      updated[index][field] = parseInt(value)
    }
    setPortConfigs(updated)
  }

  const handleFetchConfig = async () => {
    setFetchLoading(true)
    setError(null)

    try {
      const paths = [
        `${basePath}/instance-enable`,
        `${basePath}/domain-number`,
        `${basePath}/default-ds/priority1`,
        `${basePath}/default-ds/priority2`,
        `/ieee1588-ptp:ptp/mchp-velocitysp-ptp:automotive/profile`
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
        { path: `${basePath}/instance-enable`, value: instanceEnabled },
        { path: `${basePath}/domain-number`, value: domainNumber },
        { path: `${basePath}/default-ds/priority1`, value: priority1 },
        { path: `${basePath}/default-ds/priority2`, value: priority2 },
        { path: `/ieee1588-ptp:ptp/mchp-velocitysp-ptp:automotive/profile`, value: automotiveProfile }
      ]

      // Add port configurations
      portConfigs.forEach((port) => {
        const portPath = `${basePath}/ports/port[port-index='${port.portIndex}']`
        patches.push({ path: `${portPath}/port-enable`, value: port.enabled })
        patches.push({ path: `${portPath}/log-sync-interval`, value: port.logSyncInterval })
        patches.push({ path: `${portPath}/log-min-pdelay-req-interval`, value: port.logPdelayInterval })
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

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">PTP Configuration (IEEE 1588 / 802.1AS)</h1>
        <p className="page-description">Precision Time Protocol / gPTP Configuration</p>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Instance Settings</h2>
          <button className="btn btn-secondary" onClick={handleFetchConfig} disabled={fetchLoading}>
            {fetchLoading ? 'Loading...' : 'Fetch Current'}
          </button>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Instance Index</label>
            <input
              type="number"
              className="form-input"
              value={instanceIndex}
              onChange={(e) => setInstanceIndex(parseInt(e.target.value))}
              min="0"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Instance Enabled</label>
            <select className="form-select" value={instanceEnabled} onChange={(e) => setInstanceEnabled(e.target.value === 'true')}>
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Domain Number</label>
            <input
              type="number"
              className="form-input"
              value={domainNumber}
              onChange={(e) => setDomainNumber(parseInt(e.target.value))}
              min="0"
              max="255"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Instance Type</label>
            <select className="form-select" value={instanceType} onChange={(e) => setInstanceType(e.target.value)}>
              <option value="ordinary-clock">Ordinary Clock</option>
              <option value="boundary-clock">Boundary Clock</option>
              <option value="p2p-tc">P2P Transparent Clock</option>
              <option value="e2e-tc">E2E Transparent Clock</option>
            </select>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Priority 1</label>
            <input
              type="number"
              className="form-input"
              value={priority1}
              onChange={(e) => setPriority1(parseInt(e.target.value))}
              min="0"
              max="255"
            />
            <small style={{ color: '#64748b', fontSize: '0.75rem' }}>Lower = higher priority for BMCA</small>
          </div>
          <div className="form-group">
            <label className="form-label">Priority 2</label>
            <input
              type="number"
              className="form-input"
              value={priority2}
              onChange={(e) => setPriority2(parseInt(e.target.value))}
              min="0"
              max="255"
            />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Automotive Profile (gPTP)</label>
          <select className="form-select" value={automotiveProfile} onChange={(e) => setAutomotiveProfile(e.target.value)}>
            <option value="none">None (Standard gPTP)</option>
            <option value="gm">Grandmaster</option>
            <option value="bridge">Bridge (AED-B)</option>
          </select>
          <small style={{ color: '#64748b', fontSize: '0.75rem' }}>
            Automotive Ethernet gPTP profile for vehicle networks
          </small>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Port Configuration</h2>
          <button className="btn btn-secondary" onClick={addPort} style={{ padding: '6px 12px', fontSize: '0.8rem' }}>
            + Add Port
          </button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Port Index</th>
                <th>Enabled</th>
                <th>Log Sync Interval</th>
                <th>Log Pdelay Interval</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {portConfigs.map((port, index) => (
                <tr key={index}>
                  <td>
                    <input
                      type="number"
                      className="form-input"
                      value={port.portIndex}
                      onChange={(e) => updatePort(index, 'portIndex', e.target.value)}
                      style={{ width: '80px' }}
                    />
                  </td>
                  <td>
                    <select
                      className="form-select"
                      value={port.enabled}
                      onChange={(e) => updatePort(index, 'enabled', e.target.value)}
                      style={{ width: '100px' }}
                    >
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </select>
                  </td>
                  <td>
                    <select
                      className="form-select"
                      value={port.logSyncInterval}
                      onChange={(e) => updatePort(index, 'logSyncInterval', e.target.value)}
                      style={{ width: '150px' }}
                    >
                      <option value="-7">-7 (7.8ms)</option>
                      <option value="-6">-6 (15.6ms)</option>
                      <option value="-5">-5 (31.25ms)</option>
                      <option value="-4">-4 (62.5ms)</option>
                      <option value="-3">-3 (125ms)</option>
                      <option value="-2">-2 (250ms)</option>
                      <option value="-1">-1 (500ms)</option>
                      <option value="0">0 (1s)</option>
                      <option value="1">1 (2s)</option>
                    </select>
                  </td>
                  <td>
                    <select
                      className="form-select"
                      value={port.logPdelayInterval}
                      onChange={(e) => updatePort(index, 'logPdelayInterval', e.target.value)}
                      style={{ width: '150px' }}
                    >
                      <option value="-4">-4 (62.5ms)</option>
                      <option value="-3">-3 (125ms)</option>
                      <option value="-2">-2 (250ms)</option>
                      <option value="-1">-1 (500ms)</option>
                      <option value="0">0 (1s)</option>
                      <option value="1">1 (2s)</option>
                    </select>
                  </td>
                  <td>
                    <button
                      onClick={() => removePort(index)}
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
          Log intervals: negative values = sub-second, 0 = 1 second, positive = multiple seconds
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Connection</h2>
        </div>
        <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '8px', marginBottom: '16px' }}>
          {config.transport === 'wifi' ? `WiFi: ${config.host}:${config.port}` : `Serial: ${config.device}`}
        </div>
        <button className="btn btn-primary" onClick={handleApplyConfig} disabled={loading}>
          {loading ? 'Applying...' : 'Apply Configuration'}
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

export default PTP
