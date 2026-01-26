import { useState } from 'react'
import axios from 'axios'

function Fetch({ config }) {
  const [paths, setPaths] = useState(["/ietf-interfaces:interfaces/interface[name='2']/ieee802-dot1q-bridge:bridge-port/ieee802-dot1q-sched-bridge:gate-parameter-table/admin-gate-states"])
  const [newPath, setNewPath] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const addPath = () => {
    if (newPath.trim()) {
      setPaths([...paths, newPath.trim()])
      setNewPath('')
    }
  }

  const removePath = (index) => {
    setPaths(paths.filter((_, i) => i !== index))
  }

  const handleFetch = async () => {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const response = await axios.post('/api/fetch', {
        paths,
        transport: config.transport,
        device: config.device,
        host: config.host,
        port: config.port
      })
      setResult(response.data)
    } catch (err) {
      setError(err.response?.data?.error || err.message)
    } finally {
      setLoading(false)
    }
  }

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text)
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Fetch Configuration (iFETCH)</h1>
        <p className="page-description">Query specific configuration values from device</p>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Connection</h2>
        </div>
        <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '8px' }}>
          {config.transport === 'wifi' ? (
            <span>WiFi: {config.host}:{config.port}</span>
          ) : (
            <span>Serial: {config.device}</span>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Query Paths</h2>
        </div>

        <div style={{ marginBottom: '16px' }}>
          {paths.map((path, index) => (
            <div
              key={index}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                background: '#f1f5f9',
                borderRadius: '6px',
                marginBottom: '8px',
                fontSize: '0.875rem',
                fontFamily: 'monospace'
              }}
            >
              <span style={{ flex: 1, wordBreak: 'break-all' }}>{path}</span>
              <button
                onClick={() => removePath(index)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#dc2626',
                  padding: '4px'
                }}
              >
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <input
            type="text"
            className="form-input"
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            placeholder="/module:container/list[key='value']/leaf"
            onKeyPress={(e) => e.key === 'Enter' && addPath()}
          />
          <button className="btn btn-secondary" onClick={addPath}>
            Add
          </button>
        </div>

        <button
          className="btn btn-primary"
          onClick={handleFetch}
          disabled={loading || paths.length === 0}
        >
          {loading ? 'Fetching...' : 'Fetch Values'}
        </button>
      </div>

      {error && (
        <div className="alert alert-error">
          {error}
        </div>
      )}

      {result && (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Result</h2>
            <span className="status-badge success">Success</span>
          </div>

          <div className="result-container">
            <div className="result-header">
              <span className="result-title">Response ({result.format})</span>
              <button
                className="btn btn-secondary"
                style={{ padding: '4px 12px', fontSize: '0.75rem' }}
                onClick={() => copyToClipboard(result.result)}
              >
                Copy
              </button>
            </div>
            <div className="result-content">
              <pre>{result.result}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Fetch
