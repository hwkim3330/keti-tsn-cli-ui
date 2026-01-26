import { useState, useEffect } from 'react'
import axios from 'axios'

function CBS({ config }) {
  const [portNumber, setPortNumber] = useState('1')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Current status (fetched from device)
  const [currentShapers, setCurrentShapers] = useState(null)

  // CBS Configuration
  const [shaperTC, setShaperTC] = useState(3)
  const [idleSlope, setIdleSlope] = useState(100000) // kbps

  const qosPath = `/ietf-interfaces:interfaces/interface[name='${portNumber}']/mchp-velocitysp-port:eth-qos/config`

  // Fetch current shaper status
  const fetchCurrentStatus = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await axios.post('/api/fetch', {
        paths: [`${qosPath}/traffic-class-shapers`],
        transport: config.transport,
        device: config.device,
        host: config.host,
        port: config.port
      })
      setCurrentShapers(response.data.result)
    } catch (err) {
      setError(err.response?.data?.error || err.message)
      setCurrentShapers(null)
    } finally {
      setLoading(false)
    }
  }

  // Fetch on mount and when port changes
  useEffect(() => {
    fetchCurrentStatus()
  }, [portNumber, config.host])

  // Apply CBS shaper
  const applyCBS = async () => {
    setLoading(true)
    setError(null)
    try {
      await axios.post('/api/patch', {
        patches: [{
          path: `${qosPath}/traffic-class-shapers`,
          value: {
            'traffic-class': shaperTC,
            'credit-based': { 'idle-slope': idleSlope }
          }
        }],
        transport: config.transport,
        device: config.device,
        host: config.host,
        port: config.port
      })
      // Refresh status after apply
      await fetchCurrentStatus()
    } catch (err) {
      setError(err.response?.data?.error || err.message)
    } finally {
      setLoading(false)
    }
  }

  // Delete shaper for a TC
  const deleteShaper = async (tc) => {
    setLoading(true)
    setError(null)
    try {
      await axios.post('/api/patch', {
        patches: [{
          path: `${qosPath}/traffic-class-shapers[traffic-class='${tc}']`,
          value: null
        }],
        transport: config.transport,
        device: config.device,
        host: config.host,
        port: config.port
      })
      await fetchCurrentStatus()
    } catch (err) {
      setError(err.response?.data?.error || err.message)
    } finally {
      setLoading(false)
    }
  }

  // Parse current shapers from YAML response
  const parseShapers = () => {
    if (!currentShapers) return []
    try {
      // Parse YAML-like response
      const lines = currentShapers.split('\n')
      const shapers = []
      let current = null

      for (const line of lines) {
        if (line.includes('traffic-class:')) {
          if (current) shapers.push(current)
          current = { tc: parseInt(line.split(':')[1].trim()) }
        } else if (line.includes('idle-slope:') && current) {
          current.idleSlope = parseInt(line.split(':')[1].trim())
          current.type = 'credit-based'
        }
      }
      if (current) shapers.push(current)
      return shapers
    } catch {
      return []
    }
  }

  const activeShapers = parseShapers()

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">CBS Configuration (802.1Qav)</h1>
        <p className="page-description">Credit-Based Shaper - AVB Traffic Shaping</p>
      </div>

      {/* Connection Info */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Connection</h2>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Port</label>
            <select className="form-select" value={portNumber} onChange={(e) => setPortNumber(e.target.value)}>
              {Array.from({length: 12}, (_, i) => i + 1).map(p => <option key={p} value={p}>Port {p}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Device</label>
            <div style={{ padding: '10px', background: '#f8fafc', borderRadius: '6px', fontFamily: 'monospace' }}>
              {config.transport === 'wifi' ? `${config.host}:${config.port}` : config.device}
            </div>
          </div>
        </div>
      </div>

      {/* Current Status */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Current Status</h2>
          <button className="btn btn-secondary" onClick={fetchCurrentStatus} disabled={loading} style={{fontSize:'0.8rem',padding:'6px 12px'}}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        {activeShapers.length > 0 ? (
          <div style={{overflowX:'auto'}}>
            <table className="table">
              <thead>
                <tr>
                  <th>Traffic Class</th>
                  <th>Type</th>
                  <th>Idle Slope</th>
                  <th>Rate</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {activeShapers.map((shaper, idx) => (
                  <tr key={idx}>
                    <td><strong>TC {shaper.tc}</strong></td>
                    <td>Credit-Based</td>
                    <td>{shaper.idleSlope?.toLocaleString()} kbps</td>
                    <td>{shaper.idleSlope ? `${(shaper.idleSlope / 1000).toFixed(1)} Mbps` : '-'}</td>
                    <td>
                      <button
                        className="btn btn-danger"
                        onClick={() => deleteShaper(shaper.tc)}
                        disabled={loading}
                        style={{fontSize:'0.75rem',padding:'4px 8px'}}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{padding:'20px',textAlign:'center',color:'#64748b'}}>
            {loading ? 'Loading...' : 'No CBS shapers configured on this port'}
          </div>
        )}
      </div>

      {/* Configure CBS */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Configure CBS</h2>
        </div>
        <p style={{fontSize:'0.85rem',color:'#64748b',marginBottom:'16px'}}>
          Enable Credit-Based Shaper on a traffic class with specified idle-slope rate.
          CBS shapes traffic to ensure bounded latency for time-sensitive streams.
        </p>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Traffic Class</label>
            <select className="form-select" value={shaperTC} onChange={(e) => setShaperTC(parseInt(e.target.value))}>
              {[0,1,2,3,4,5,6,7].map(tc => <option key={tc} value={tc}>TC {tc}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Idle Slope (kbps)</label>
            <input
              type="number"
              className="form-input"
              value={idleSlope}
              onChange={(e) => setIdleSlope(parseInt(e.target.value) || 0)}
            />
            <small style={{color:'#64748b',fontSize:'0.75rem'}}>
              {idleSlope > 0 ? `= ${(idleSlope / 1000).toFixed(1)} Mbps` : ''}
            </small>
          </div>
        </div>

        <div style={{display:'flex',gap:'8px',marginTop:'8px'}}>
          <button className="btn btn-primary" onClick={applyCBS} disabled={loading}>
            {loading ? 'Applying...' : 'Apply CBS'}
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
    </div>
  )
}

export default CBS
