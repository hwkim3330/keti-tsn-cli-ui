import { useState, useEffect } from 'react'
import axios from 'axios'

function Settings({ config, setConfig }) {
  const [ports, setPorts] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetchPorts()
  }, [])

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

  const presetConfigs = [
    { name: 'ESP32 #1', host: '10.42.0.11', port: 5683 },
    { name: 'ESP32 #2', host: '10.42.0.12', port: 5683 },
    { name: 'ESP32 #3', host: '10.42.0.13', port: 5683 },
    { name: 'ESP32 #4', host: '10.42.0.14', port: 5683 },
    { name: 'Default AP', host: '192.168.4.1', port: 5683 }
  ]

  const applyPreset = (preset) => {
    setConfig({
      ...config,
      transport: 'wifi',
      host: preset.host,
      port: preset.port
    })
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-description">Configure transport and connection settings</p>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Transport Type</h2>
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
          <div>
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

            <div style={{ marginTop: '16px' }}>
              <div style={{ fontSize: '0.875rem', fontWeight: '500', marginBottom: '8px' }}>Quick Presets</div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {presetConfigs.map((preset) => (
                  <button
                    key={preset.name}
                    className={`btn ${config.host === preset.host ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => applyPreset(preset)}
                    style={{ padding: '8px 16px', fontSize: '0.875rem' }}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

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
