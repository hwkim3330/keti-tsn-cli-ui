import { useState } from 'react'
import axios from 'axios'

function QoS({ config }) {
  const [portNumber, setPortNumber] = useState('1')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  // Default Priority
  const [defaultPriority, setDefaultPriority] = useState(0)

  // Traffic Class Shaper (CBS)
  const [shaperTC, setShaperTC] = useState(3)
  const [idleSlope, setIdleSlope] = useState(100000) // kbps

  // WRR Bandwidth
  const [wrrBandwidth, setWrrBandwidth] = useState([10, 40, 50])

  // Port Policer
  const [policerIndex, setPolicerIndex] = useState(1)
  const [frameSelector, setFrameSelector] = useState('unknown-unicast')
  const [policerType, setPolicerType] = useState('frame-rate')
  const [policerRate, setPolicerRate] = useState(1000)
  const [policerBurst, setPolicerBurst] = useState(2000)

  const basePath = `/ietf-interfaces:interfaces/interface[name='${portNumber}']`
  const bridgePortPath = `${basePath}/ieee802-dot1q-bridge:bridge-port`
  const qosPath = `${basePath}/mchp-velocitysp-port:eth-qos/config`

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

  // Default Priority
  const fetchDefaultPriority = () => handleFetch([`${bridgePortPath}/default-priority`], 'Default Priority')
  const applyDefaultPriority = () => handlePatch([{ path: `${bridgePortPath}/default-priority`, value: defaultPriority }], 'Default Priority')

  // Traffic Class Shaper (CBS)
  const fetchShapers = () => handleFetch([`${qosPath}/traffic-class-shapers`], 'Traffic Class Shapers')
  const applyCreditBasedShaper = () => {
    handlePatch([{
      path: `${qosPath}/traffic-class-shapers`,
      value: {
        'traffic-class': shaperTC,
        'credit-based': { 'idle-slope': idleSlope }
      }
    }], 'Credit Based Shaper')
  }

  // WRR
  const fetchWRR = () => handleFetch([`${qosPath}/traffic-class-schedulers-bandwidth`], 'WRR Bandwidth')
  const applyWRR = () => handlePatch([{ path: `${qosPath}/traffic-class-schedulers-bandwidth`, value: wrrBandwidth }], 'WRR Bandwidth')

  // Port Policer
  const fetchPolicers = () => handleFetch([`${qosPath}/port-policers`], 'Port Policers')
  const applyPolicer = () => {
    const policerValue = {
      index: policerIndex,
      'frame-selector': frameSelector
    }
    if (policerType === 'frame-rate') {
      policerValue['frame-rate'] = { rate: policerRate, 'burst-size': policerBurst }
    } else {
      policerValue['bit-rate'] = { rate: String(policerRate), 'burst-size': policerBurst }
    }
    handlePatch([{ path: `${qosPath}/port-policers`, value: policerValue }], 'Port Policer')
  }
  const deletePolicer = () => {
    handlePatch([{ path: `${qosPath}/port-policers[index='${policerIndex}']`, value: null }], 'Delete Policer')
  }

  const updateWrrBandwidth = (index, value) => {
    const updated = [...wrrBandwidth]
    updated[index] = parseInt(value) || 0
    setWrrBandwidth(updated)
  }

  const addWrrTC = () => setWrrBandwidth([...wrrBandwidth, 0])
  const removeWrrTC = () => setWrrBandwidth(wrrBandwidth.slice(0, -1))

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">QoS Configuration</h1>
        <p className="page-description">Quality of Service - CBS (Credit-Based Shaper), WRR, Policing</p>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Port Selection</h2>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Port</label>
            <select className="form-select" value={portNumber} onChange={(e) => setPortNumber(e.target.value)}>
              {[1,2,3,4,5,6,7,8].map(p => <option key={p} value={p}>Port {p}</option>)}
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

      {/* Default Priority */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Default Priority</h2>
          <button className="btn btn-secondary" onClick={fetchDefaultPriority} disabled={loading} style={{fontSize:'0.8rem',padding:'6px 12px'}}>
            Fetch
          </button>
        </div>
        <p style={{fontSize:'0.85rem',color:'#64748b',marginBottom:'12px'}}>
          Default priority assigned to untagged frames
        </p>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Priority (0-7)</label>
            <select className="form-select" value={defaultPriority} onChange={(e) => setDefaultPriority(parseInt(e.target.value))}>
              {[0,1,2,3,4,5,6,7].map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>
        <button className="btn btn-primary" onClick={applyDefaultPriority} disabled={loading}>Apply</button>
      </div>

      {/* CBS - Credit Based Shaper */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Credit Based Shaper (802.1Qav)</h2>
          <button className="btn btn-secondary" onClick={fetchShapers} disabled={loading} style={{fontSize:'0.8rem',padding:'6px 12px'}}>
            Fetch
          </button>
        </div>
        <p style={{fontSize:'0.85rem',color:'#64748b',marginBottom:'12px'}}>
          Enable CBS on a traffic class with specified idle-slope rate
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
            <input type="number" className="form-input" value={idleSlope} onChange={(e) => setIdleSlope(parseInt(e.target.value))} />
            <small style={{color:'#64748b',fontSize:'0.75rem'}}>e.g., 100000 = 100 Mbps</small>
          </div>
        </div>
        <button className="btn btn-primary" onClick={applyCreditBasedShaper} disabled={loading}>
          Apply CBS
        </button>
      </div>

      {/* WRR Scheduling */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Weighted Round Robin (WRR)</h2>
          <button className="btn btn-secondary" onClick={fetchWRR} disabled={loading} style={{fontSize:'0.8rem',padding:'6px 12px'}}>
            Fetch
          </button>
        </div>
        <p style={{fontSize:'0.85rem',color:'#64748b',marginBottom:'12px'}}>
          WRR bandwidth percentage per TC (starting from TC0). TCs not in the list use Strict Priority.
        </p>

        <div style={{display:'flex',gap:'8px',flexWrap:'wrap',marginBottom:'12px'}}>
          {wrrBandwidth.map((bw, idx) => (
            <div key={idx} style={{display:'flex',alignItems:'center',gap:'4px'}}>
              <span style={{fontSize:'0.8rem',color:'#64748b'}}>TC{idx}:</span>
              <input
                type="number"
                className="form-input"
                value={bw}
                onChange={(e) => updateWrrBandwidth(idx, e.target.value)}
                style={{width:'70px'}}
                min="0"
                max="100"
              />
              <span style={{fontSize:'0.8rem',color:'#64748b'}}>%</span>
            </div>
          ))}
        </div>

        <div style={{display:'flex',gap:'8px',marginBottom:'12px'}}>
          <button className="btn btn-secondary" onClick={addWrrTC} style={{fontSize:'0.8rem',padding:'6px 12px'}}>+ Add TC</button>
          <button className="btn btn-secondary" onClick={removeWrrTC} disabled={wrrBandwidth.length <= 1} style={{fontSize:'0.8rem',padding:'6px 12px'}}>- Remove TC</button>
        </div>

        <div style={{fontSize:'0.75rem',color:'#64748b',marginBottom:'12px'}}>
          Total: {wrrBandwidth.reduce((a,b) => a+b, 0)}% (should be 100%)
        </div>

        <button className="btn btn-primary" onClick={applyWRR} disabled={loading}>Apply WRR</button>
      </div>

      {/* Port Policer */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Port Policer</h2>
          <button className="btn btn-secondary" onClick={fetchPolicers} disabled={loading} style={{fontSize:'0.8rem',padding:'6px 12px'}}>
            Fetch
          </button>
        </div>
        <p style={{fontSize:'0.85rem',color:'#64748b',marginBottom:'12px'}}>
          Ingress rate limiting per frame type
        </p>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Policer Index</label>
            <input type="number" className="form-input" value={policerIndex} onChange={(e) => setPolicerIndex(parseInt(e.target.value))} min="0" />
          </div>
          <div className="form-group">
            <label className="form-label">Frame Selector</label>
            <select className="form-select" value={frameSelector} onChange={(e) => setFrameSelector(e.target.value)}>
              <option value="unknown-unicast">Unknown Unicast</option>
              <option value="known-unicast">Known Unicast</option>
              <option value="unknown-multicast">Unknown Multicast</option>
              <option value="known-multicast">Known Multicast</option>
              <option value="broadcast">Broadcast</option>
              <option value="all">All Frames</option>
            </select>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Rate Type</label>
            <select className="form-select" value={policerType} onChange={(e) => setPolicerType(e.target.value)}>
              <option value="frame-rate">Frame Rate (fps)</option>
              <option value="bit-rate">Bit Rate (bps)</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Rate</label>
            <input type="number" className="form-input" value={policerRate} onChange={(e) => setPolicerRate(parseInt(e.target.value))} />
            <small style={{color:'#64748b',fontSize:'0.75rem'}}>{policerType === 'frame-rate' ? 'frames/sec' : 'bits/sec'}</small>
          </div>
          <div className="form-group">
            <label className="form-label">Burst Size (bytes)</label>
            <input type="number" className="form-input" value={policerBurst} onChange={(e) => setPolicerBurst(parseInt(e.target.value))} />
          </div>
        </div>

        <div style={{display:'flex',gap:'8px'}}>
          <button className="btn btn-primary" onClick={applyPolicer} disabled={loading}>Apply Policer</button>
          <button className="btn btn-danger" onClick={deletePolicer} disabled={loading}>Delete Policer</button>
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

export default QoS
