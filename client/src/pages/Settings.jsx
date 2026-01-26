import { useState, useEffect } from 'react'
import axios from 'axios'

function Settings({ config, setConfig }) {
  const [ports, setPorts] = useState([])
  const [loading, setLoading] = useState(false)
  const [saveLoading, setSaveLoading] = useState(false)
  const [saveResult, setSaveResult] = useState(null)

  // Multi-device management
  const [devices, setDevices] = useState([])
  const [editingDevice, setEditingDevice] = useState(null)
  const [newDevice, setNewDevice] = useState({ name: '', host: '', port: 5683, transport: 'wifi', device: '/dev/ttyACM0' })

  // Load saved devices from localStorage
  useEffect(() => {
    const savedDevices = localStorage.getItem('tsn-devices')
    if (savedDevices) {
      setDevices(JSON.parse(savedDevices))
    } else {
      // Default devices (PC hotspot: 10.42.0.1, ESP32s: 10.42.0.11~)
      const defaultDevices = [
        { id: 1, name: 'ESP32 #1', host: '10.42.0.11', port: 5683, transport: 'wifi' },
        { id: 2, name: 'ESP32 #2', host: '10.42.0.12', port: 5683, transport: 'wifi' },
        { id: 3, name: 'ESP32 #3', host: '10.42.0.13', port: 5683, transport: 'wifi' },
        { id: 4, name: 'ESP32 #4', host: '10.42.0.14', port: 5683, transport: 'wifi' }
      ]
      setDevices(defaultDevices)
      localStorage.setItem('tsn-devices', JSON.stringify(defaultDevices))
    }
  }, [])

  useEffect(() => {
    fetchPorts()
  }, [])

  // Save devices to localStorage whenever they change
  useEffect(() => {
    if (devices.length > 0) {
      localStorage.setItem('tsn-devices', JSON.stringify(devices))
    }
  }, [devices])

  const fetchPorts = async () => {
    setLoading(true)
    try {
      const response = await axios.get('/api/config/ports')
      setPorts(response.data.ports)
    } catch (error) {
      console.error('Error fetching ports:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleTransportChange = (transport) => {
    setConfig({ ...config, transport })
  }

  const handleInputChange = (field, value) => {
    setConfig({ ...config, [field]: value })
  }

  const selectDevice = (device) => {
    setConfig({
      transport: device.transport || 'wifi',
      host: device.host,
      port: device.port,
      device: device.device || '/dev/ttyACM0'
    })
  }

  const addDevice = () => {
    if (!newDevice.name || (!newDevice.host && newDevice.transport === 'wifi')) return
    const device = {
      id: Date.now(),
      ...newDevice
    }
    setDevices([...devices, device])
    setNewDevice({ name: '', host: '', port: 5683, transport: 'wifi', device: '/dev/ttyACM0' })
  }

  const deleteDevice = (id) => {
    setDevices(devices.filter(d => d.id !== id))
  }

  const updateDevice = (id, updates) => {
    setDevices(devices.map(d => d.id === id ? { ...d, ...updates } : d))
    setEditingDevice(null)
  }

  // Save config to device
  const saveConfigToDevice = async () => {
    setSaveLoading(true)
    setSaveResult(null)
    try {
      const response = await axios.post('/api/patch', {
        patches: [{
          path: '/mchp-velocitysp-system:save-config',
          value: null
        }],
        transport: config.transport,
        device: config.device,
        host: config.host,
        port: config.port
      })
      setSaveResult({ success: true, message: 'Configuration saved to device successfully' })
    } catch (err) {
      setSaveResult({ success: false, message: err.response?.data?.error || err.message })
    } finally {
      setSaveLoading(false)
    }
  }

  const isCurrentDevice = (device) => {
    if (device.transport === 'wifi' || !device.transport) {
      return config.transport === 'wifi' && config.host === device.host && config.port === device.port
    }
    return config.transport === 'serial' && config.device === device.device
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-description">Configure transport and device connections</p>
      </div>

      {/* Device List */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Saved Devices</h2>
        </div>
        <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '16px' }}>
          Select a device to connect to, or add new devices below.
        </p>

        <div style={{ display: 'grid', gap: '8px', marginBottom: '16px' }}>
          {devices.map((device) => (
            <div
              key={device.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '12px 16px',
                background: isCurrentDevice(device) ? '#dbeafe' : '#f8fafc',
                border: isCurrentDevice(device) ? '2px solid #3b82f6' : '1px solid #e2e8f0',
                borderRadius: '8px',
                gap: '12px'
              }}
            >
              {editingDevice === device.id ? (
                <div style={{ flex: 1, display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    className="form-input"
                    value={device.name}
                    onChange={(e) => updateDevice(device.id, { name: e.target.value })}
                    style={{ width: '120px' }}
                    placeholder="Name"
                  />
                  <input
                    type="text"
                    className="form-input"
                    value={device.host}
                    onChange={(e) => updateDevice(device.id, { host: e.target.value })}
                    style={{ width: '120px' }}
                    placeholder="Host"
                  />
                  <input
                    type="number"
                    className="form-input"
                    value={device.port}
                    onChange={(e) => updateDevice(device.id, { port: parseInt(e.target.value) })}
                    style={{ width: '80px' }}
                    placeholder="Port"
                  />
                  <button className="btn btn-primary" onClick={() => setEditingDevice(null)} style={{ padding: '6px 12px', fontSize: '0.8rem' }}>
                    Done
                  </button>
                </div>
              ) : (
                <>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: '500' }}>{device.name}</div>
                    <div style={{ fontSize: '0.8rem', color: '#64748b', fontFamily: 'monospace' }}>
                      {device.transport === 'serial' ? device.device : `${device.host}:${device.port}`}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      className={`btn ${isCurrentDevice(device) ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => selectDevice(device)}
                      style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                    >
                      {isCurrentDevice(device) ? 'Connected' : 'Connect'}
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={() => setEditingDevice(device.id)}
                      style={{ padding: '6px 8px', fontSize: '0.8rem' }}
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn-danger"
                      onClick={() => deleteDevice(device.id)}
                      style={{ padding: '6px 8px', fontSize: '0.8rem' }}
                    >
                      ×
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        {/* Add new device */}
        <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '16px' }}>
          <div style={{ fontSize: '0.9rem', fontWeight: '500', marginBottom: '8px' }}>Add New Device</div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" style={{ fontSize: '0.75rem' }}>Name</label>
              <input
                type="text"
                className="form-input"
                value={newDevice.name}
                onChange={(e) => setNewDevice({ ...newDevice, name: e.target.value })}
                placeholder="My Device"
                style={{ width: '120px' }}
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" style={{ fontSize: '0.75rem' }}>Type</label>
              <select
                className="form-select"
                value={newDevice.transport}
                onChange={(e) => setNewDevice({ ...newDevice, transport: e.target.value })}
                style={{ width: '100px' }}
              >
                <option value="wifi">WiFi</option>
                <option value="serial">Serial</option>
              </select>
            </div>
            {newDevice.transport === 'wifi' ? (
              <>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" style={{ fontSize: '0.75rem' }}>Host</label>
                  <input
                    type="text"
                    className="form-input"
                    value={newDevice.host}
                    onChange={(e) => setNewDevice({ ...newDevice, host: e.target.value })}
                    placeholder="10.42.0.11"
                    style={{ width: '120px' }}
                  />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" style={{ fontSize: '0.75rem' }}>Port</label>
                  <input
                    type="number"
                    className="form-input"
                    value={newDevice.port}
                    onChange={(e) => setNewDevice({ ...newDevice, port: parseInt(e.target.value) })}
                    placeholder="5683"
                    style={{ width: '80px' }}
                  />
                </div>
              </>
            ) : (
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" style={{ fontSize: '0.75rem' }}>Device Path</label>
                <input
                  type="text"
                  className="form-input"
                  value={newDevice.device}
                  onChange={(e) => setNewDevice({ ...newDevice, device: e.target.value })}
                  placeholder="/dev/ttyACM0"
                  style={{ width: '140px' }}
                />
              </div>
            )}
            <button className="btn btn-primary" onClick={addDevice} style={{ padding: '8px 16px' }}>
              Add
            </button>
          </div>
        </div>
      </div>

      {/* Current Connection */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Current Connection</h2>
        </div>

        <div className="transport-toggle" style={{ marginBottom: '16px' }}>
          <button
            className={config.transport === 'serial' ? 'active' : ''}
            onClick={() => handleTransportChange('serial')}
          >
            Serial (USB)
          </button>
          <button
            className={config.transport === 'wifi' ? 'active' : ''}
            onClick={() => handleTransportChange('wifi')}
          >
            WiFi (UDP)
          </button>
        </div>

        {config.transport === 'serial' ? (
          <div>
            <div className="form-group">
              <label className="form-label">Serial Device</label>
              <select
                className="form-select"
                value={config.device}
                onChange={(e) => handleInputChange('device', e.target.value)}
              >
                <option value={config.device}>{config.device}</option>
                {ports.map((port) => (
                  <option key={port.path} value={port.path}>
                    {port.path} - {port.manufacturer}
                  </option>
                ))}
              </select>
            </div>
            <button className="btn btn-secondary" onClick={fetchPorts} disabled={loading}>
              {loading ? 'Scanning...' : 'Scan Ports'}
            </button>

            {ports.length > 0 && (
              <div style={{ marginTop: '16px' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Path</th>
                      <th>Manufacturer</th>
                      <th>Serial Number</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ports.map((port) => (
                      <tr
                        key={port.path}
                        onClick={() => handleInputChange('device', port.path)}
                        style={{ cursor: 'pointer' }}
                      >
                        <td>{port.path}</td>
                        <td>{port.manufacturer}</td>
                        <td>{port.serialNumber}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Host (IP Address)</label>
              <input
                type="text"
                className="form-input"
                value={config.host}
                onChange={(e) => handleInputChange('host', e.target.value)}
                placeholder="192.168.4.1"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Port</label>
              <input
                type="number"
                className="form-input"
                value={config.port}
                onChange={(e) => handleInputChange('port', parseInt(e.target.value))}
                placeholder="5683"
              />
            </div>
          </div>
        )}
      </div>

      {/* Save Config to Device */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Device Configuration</h2>
        </div>
        <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '16px' }}>
          Save the current running configuration to the device's non-volatile storage.
          This will persist settings across reboots.
        </p>
        <button
          className="btn btn-primary"
          onClick={saveConfigToDevice}
          disabled={saveLoading}
        >
          {saveLoading ? 'Saving...' : 'Save Config to Device'}
        </button>
        {saveResult && (
          <div className={`alert ${saveResult.success ? 'alert-success' : 'alert-error'}`} style={{ marginTop: '12px' }}>
            {saveResult.message}
          </div>
        )}
      </div>

      {/* Current Config JSON */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Current Configuration</h2>
        </div>

        <div className="result-container">
          <div className="result-content">
            <pre>{JSON.stringify(config, null, 2)}</pre>
          </div>
        </div>
      </div>

      {/* Architecture Diagram */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Architecture</h2>
        </div>

        <div style={{ fontFamily: 'monospace', fontSize: '0.8rem', background: '#1e293b', color: '#e2e8f0', padding: '16px', borderRadius: '8px', overflow: 'auto' }}>
          <pre style={{ margin: 0 }}>{`
${config.transport === 'wifi' ? `
┌─────────────┐      WiFi (UDP)      ┌─────────────┐      Serial      ┌─────────────┐
│  Host (PC)  │ ◀─────────────────▶  │   ESP32     │ ◀─────────────▶  │  LAN9662    │
│  (Station)  │     MUP1 frames      │   (Bridge)  │     MUP1         │  (Target)   │
└─────────────┘      Port ${config.port}       └─────────────┘                  └─────────────┘
       │               ${config.host}              │
       └──────── WiFi Connection ──────────────────┘
` : `
┌─────────────┐      USB/UART       ┌─────────────┐
│  Host (PC)  │ ◀─────────────────▶ │  LAN9662    │
│             │     MUP1 frames     │  (Target)   │
└─────────────┘    ${config.device}    └─────────────┘
`}
          `}</pre>
        </div>
      </div>
    </div>
  )
}

export default Settings
