import { useState } from 'react'
import axios from 'axios'

function PTP({ config }) {
  const [instanceIndex, setInstanceIndex] = useState(0)
  const [instanceEnabled, setInstanceEnabled] = useState(true)
  const [domainNumber, setDomainNumber] = useState(0)
  const [priority1, setPriority1] = useState(246)
  const [priority2, setPriority2] = useState(248)
  const [instanceType, setInstanceType] = useState('relay')
  const [externalPortConfig, setExternalPortConfig] = useState(false)
  const [automotiveProfile, setAutomotiveProfile] = useState('none')

  // Servo
  const [servoEnabled, setServoEnabled] = useState(true)
  const [servoIndex, setServoIndex] = useState(0)
  const [servoType, setServoType] = useState('pi')
  const [ltcIndex, setLtcIndex] = useState(0)

  // L2 Configuration
  const [macAddress, setMacAddress] = useState('00-00-00-00-00-00')
  const [macAddressEnabled, setMacAddressEnabled] = useState(false)
  const [vlan, setVlan] = useState(0)
  const [vlanEnabled, setVlanEnabled] = useState(false)

  // 1PPS
  const [ppsLtcIndex, setPpsLtcIndex] = useState(1)
  const [ppsPinIndex, setPpsPinIndex] = useState(4)
  const [ppsFunction, setPpsFunction] = useState('1pps-out')

  // Ports
  const [portConfigs, setPortConfigs] = useState([
    { portIndex: 25, enabled: true, logSyncInterval: -3, logPdelayInterval: 0, desiredState: 'disabled', oneStepEnabled: false }
  ])

  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const basePath = `/ieee1588-ptp:ptp/instances/instance[instance-index='${instanceIndex}']`

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

  const addPort = () => {
    const nextIndex = portConfigs.length > 0 ? Math.max(...portConfigs.map(p => p.portIndex)) + 1 : 25
    setPortConfigs([...portConfigs, { portIndex: nextIndex, enabled: true, logSyncInterval: -3, logPdelayInterval: 0, desiredState: 'disabled', oneStepEnabled: false }])
  }

  const removePort = (index) => {
    setPortConfigs(portConfigs.filter((_, i) => i !== index))
  }

  const updatePort = (index, field, value) => {
    const updated = [...portConfigs]
    if (field === 'enabled' || field === 'oneStepEnabled') {
      updated[index][field] = value === 'true'
    } else if (field === 'desiredState') {
      updated[index][field] = value
    } else {
      updated[index][field] = parseInt(value)
    }
    setPortConfigs(updated)
  }

  // Fetch current instance configuration
  const fetchInstance = () => handleFetch([basePath], 'PTP Instance')

  // Delete instance
  const deleteInstance = () => handlePatch([{ path: basePath, value: null }], 'Delete Instance')

  // Apply instance with ports and optional servo
  const applyInstance = () => {
    // Build instance value object
    const instanceValue = {
      'instance-index': instanceIndex,
      'default-ds': {
        'instance-type': instanceType,
        'priority1': priority1,
        'priority2': priority2,
        'domain-number': domainNumber,
        'external-port-config-enable': externalPortConfig
      },
      'mchp-velocitysp-ptp:automotive': {
        profile: automotiveProfile
      },
      'mchp-velocitysp-ptp:l2': {
        'mac-address': macAddress,
        'mac-address-enable': macAddressEnabled,
        'vlan': vlan,
        'vlan-enable': vlanEnabled
      },
      ports: {
        port: portConfigs.map(p => {
          const portObj = {
            'port-index': p.portIndex,
            'port-ds': {
              'port-enable': p.enabled,
              'log-sync-interval': p.logSyncInterval,
              'log-min-pdelay-req-interval': p.logPdelayInterval
            }
          }
          // For automotive or external port config
          if (externalPortConfig) {
            portObj['external-port-config-port-ds'] = {
              'desired-state': p.desiredState
            }
          }
          // For 1-step transparent clock
          if (instanceType === 'p2p-tc' && p.oneStepEnabled) {
            portObj['port-ds']['ieee802-dot1as-ptp:use-mgt-one-step-tx-oper'] = true
            portObj['port-ds']['ieee802-dot1as-ptp:mgt-one-step-tx-oper'] = 1
          }
          return portObj
        })
      }
    }

    // Add servo if enabled
    if (servoEnabled) {
      instanceValue['mchp-velocitysp-ptp:servos'] = {
        servo: [{
          'servo-index': servoIndex,
          'servo-type': servoType,
          'ltc-index': ltcIndex
        }]
      }
    }

    handlePatch([{ path: '/ieee1588-ptp:ptp/instances/instance', value: instanceValue }], 'PTP Instance')
  }

  // 1PPS Configuration
  const apply1PPS = () => {
    handlePatch([{
      path: `/ieee1588-ptp:ptp/mchp-velocitysp-ptp:ltcs/ltc`,
      value: {
        'ltc-index': ppsLtcIndex,
        'ptp-pins': {
          'ptp-pin': [{
            'index': ppsPinIndex,
            'function': ppsFunction
          }]
        }
      }
    }], '1PPS Output')
  }

  const disable1PPS = () => {
    handlePatch([{
      path: `/ieee1588-ptp:ptp/mchp-velocitysp-ptp:ltcs/ltc[ltc-index='${ppsLtcIndex}']`,
      value: null
    }], 'Disable 1PPS')
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">PTP Configuration (IEEE 1588 / 802.1AS)</h1>
        <p className="page-description">Precision Time Protocol / gPTP / Automotive gPTP Configuration</p>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Instance Settings</h2>
          <div style={{display:'flex',gap:'8px'}}>
            <button className="btn btn-secondary" onClick={fetchInstance} disabled={loading} style={{fontSize:'0.8rem',padding:'6px 12px'}}>
              Fetch
            </button>
            <button className="btn btn-danger" onClick={deleteInstance} disabled={loading} style={{fontSize:'0.8rem',padding:'6px 12px'}}>
              Delete
            </button>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Instance Index</label>
            <input type="number" className="form-input" value={instanceIndex} onChange={(e) => setInstanceIndex(parseInt(e.target.value))} min="0" />
          </div>
          <div className="form-group">
            <label className="form-label">Instance Type</label>
            <select className="form-select" value={instanceType} onChange={(e) => setInstanceType(e.target.value)}>
              <option value="ordinary-clock">Ordinary Clock</option>
              <option value="boundary-clock">Boundary Clock</option>
              <option value="relay">Relay (802.1AS)</option>
              <option value="p2p-tc">P2P Transparent Clock</option>
              <option value="e2e-tc">E2E Transparent Clock</option>
            </select>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Domain Number</label>
            <input type="number" className="form-input" value={domainNumber} onChange={(e) => setDomainNumber(parseInt(e.target.value))} min="0" max="255" />
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
            <label className="form-label">Priority 1</label>
            <input type="number" className="form-input" value={priority1} onChange={(e) => setPriority1(parseInt(e.target.value))} min="0" max="255" />
            <small style={{color:'#64748b',fontSize:'0.75rem'}}>Lower = higher priority for BMCA</small>
          </div>
          <div className="form-group">
            <label className="form-label">Priority 2</label>
            <input type="number" className="form-input" value={priority2} onChange={(e) => setPriority2(parseInt(e.target.value))} min="0" max="255" />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Automotive Profile (gPTP)</label>
            <select className="form-select" value={automotiveProfile} onChange={(e) => setAutomotiveProfile(e.target.value)}>
              <option value="none">None (Standard gPTP)</option>
              <option value="gm">Grandmaster (AED-GM)</option>
              <option value="bridge">Bridge (AED-B)</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">External Port Config</label>
            <select className="form-select" value={externalPortConfig} onChange={(e) => setExternalPortConfig(e.target.value === 'true')}>
              <option value="false">Disabled (BMCA)</option>
              <option value="true">Enabled (Manual)</option>
            </select>
            <small style={{color:'#64748b',fontSize:'0.75rem'}}>Automotive profiles require external port config</small>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Servo (Time Synchronization)</h2>
        </div>
        <p style={{fontSize:'0.85rem',color:'#64748b',marginBottom:'12px'}}>
          Servo adjusts local time to synchronize with grandmaster. Required for TAS/PSFP.
        </p>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Servo Enabled</label>
            <select className="form-select" value={servoEnabled} onChange={(e) => setServoEnabled(e.target.value === 'true')}>
              <option value="true">Enabled</option>
              <option value="false">Disabled (Relay only)</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Servo Index</label>
            <input type="number" className="form-input" value={servoIndex} onChange={(e) => setServoIndex(parseInt(e.target.value))} min="0" disabled={!servoEnabled} />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Servo Type</label>
            <select className="form-select" value={servoType} onChange={(e) => setServoType(e.target.value)} disabled={!servoEnabled}>
              <option value="pi">PI Controller</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">LTC Index</label>
            <input type="number" className="form-input" value={ltcIndex} onChange={(e) => setLtcIndex(parseInt(e.target.value))} min="0" disabled={!servoEnabled} />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">L2 Configuration (MAC/VLAN)</h2>
        </div>
        <p style={{fontSize:'0.85rem',color:'#64748b',marginBottom:'12px'}}>
          Optional custom MAC address and VLAN tag for PTP frames.
        </p>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">MAC Address</label>
            <input type="text" className="form-input" value={macAddress} onChange={(e) => setMacAddress(e.target.value)} placeholder="00-11-22-33-44-55" />
          </div>
          <div className="form-group">
            <label className="form-label">MAC Enabled</label>
            <select className="form-select" value={macAddressEnabled} onChange={(e) => setMacAddressEnabled(e.target.value === 'true')}>
              <option value="false">Disabled</option>
              <option value="true">Enabled</option>
            </select>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">VLAN ID</label>
            <input type="number" className="form-input" value={vlan} onChange={(e) => setVlan(parseInt(e.target.value))} min="0" max="4095" />
          </div>
          <div className="form-group">
            <label className="form-label">VLAN Enabled</label>
            <select className="form-select" value={vlanEnabled} onChange={(e) => setVlanEnabled(e.target.value === 'true')}>
              <option value="false">Disabled</option>
              <option value="true">Enabled</option>
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Port Configuration</h2>
          <button className="btn btn-secondary" onClick={addPort} style={{fontSize:'0.8rem',padding:'6px 12px'}}>
            + Add Port
          </button>
        </div>

        <div style={{overflowX:'auto'}}>
          <table className="table">
            <thead>
              <tr>
                <th>Port Index</th>
                <th>Enabled</th>
                <th>Log Sync Interval</th>
                <th>Log Pdelay Interval</th>
                {externalPortConfig && <th>Desired State</th>}
                {instanceType === 'p2p-tc' && <th>1-Step TX</th>}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {portConfigs.map((port, index) => (
                <tr key={index}>
                  <td>
                    <input type="number" className="form-input" value={port.portIndex} onChange={(e) => updatePort(index, 'portIndex', e.target.value)} style={{width:'80px'}} />
                  </td>
                  <td>
                    <select className="form-select" value={port.enabled} onChange={(e) => updatePort(index, 'enabled', e.target.value)} style={{width:'90px'}}>
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </select>
                  </td>
                  <td>
                    <select className="form-select" value={port.logSyncInterval} onChange={(e) => updatePort(index, 'logSyncInterval', e.target.value)} style={{width:'140px'}}>
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
                    <select className="form-select" value={port.logPdelayInterval} onChange={(e) => updatePort(index, 'logPdelayInterval', e.target.value)} style={{width:'140px'}}>
                      <option value="-4">-4 (62.5ms)</option>
                      <option value="-3">-3 (125ms)</option>
                      <option value="-2">-2 (250ms)</option>
                      <option value="-1">-1 (500ms)</option>
                      <option value="0">0 (1s)</option>
                      <option value="1">1 (2s)</option>
                    </select>
                  </td>
                  {externalPortConfig && (
                    <td>
                      <select className="form-select" value={port.desiredState} onChange={(e) => updatePort(index, 'desiredState', e.target.value)} style={{width:'100px'}}>
                        <option value="disabled">Disabled</option>
                        <option value="master">Master</option>
                        <option value="slave">Slave</option>
                        <option value="passive">Passive</option>
                      </select>
                    </td>
                  )}
                  {instanceType === 'p2p-tc' && (
                    <td>
                      <select className="form-select" value={port.oneStepEnabled} onChange={(e) => updatePort(index, 'oneStepEnabled', e.target.value)} style={{width:'80px'}}>
                        <option value="false">No</option>
                        <option value="true">Yes</option>
                      </select>
                    </td>
                  )}
                  <td>
                    <button onClick={() => removePort(index)} style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626'}}>
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
          Log intervals: negative = sub-second (2^n seconds), 0 = 1 second, positive = multiple seconds
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">1PPS Output</h2>
        </div>
        <p style={{fontSize:'0.85rem',color:'#64748b',marginBottom:'12px'}}>
          Generate 1PPS pulse for synchronization verification between devices.
        </p>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">LTC Index</label>
            <input type="number" className="form-input" value={ppsLtcIndex} onChange={(e) => setPpsLtcIndex(parseInt(e.target.value))} min="0" />
          </div>
          <div className="form-group">
            <label className="form-label">PTP Pin Index</label>
            <input type="number" className="form-input" value={ppsPinIndex} onChange={(e) => setPpsPinIndex(parseInt(e.target.value))} min="0" />
          </div>
          <div className="form-group">
            <label className="form-label">Function</label>
            <select className="form-select" value={ppsFunction} onChange={(e) => setPpsFunction(e.target.value)}>
              <option value="1pps-out">1PPS Output</option>
            </select>
          </div>
        </div>

        <div style={{display:'flex',gap:'8px'}}>
          <button className="btn btn-primary" onClick={apply1PPS} disabled={loading}>Enable 1PPS</button>
          <button className="btn btn-danger" onClick={disable1PPS} disabled={loading}>Disable 1PPS</button>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Apply Configuration</h2>
        </div>
        <div style={{padding:'12px',background:'#f8fafc',borderRadius:'8px',marginBottom:'16px'}}>
          {config.transport === 'wifi' ? `WiFi: ${config.host}:${config.port}` : `Serial: ${config.device}`}
        </div>
        <button className="btn btn-primary" onClick={applyInstance} disabled={loading}>
          {loading ? 'Applying...' : 'Apply PTP Instance'}
        </button>
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

export default PTP
