import { useState } from 'react'
import axios from 'axios'

function Encode() {
  const [yamlInput, setYamlInput] = useState(`# Example: Instance-identifier format
- /ietf-interfaces:interfaces/interface[name='1']/ieee802-dot1q-bridge:bridge-port/ieee802-dot1q-sched-bridge:gate-parameter-table/gate-enabled: true
- /ietf-interfaces:interfaces/interface[name='1']/ieee802-dot1q-bridge:bridge-port/ieee802-dot1q-sched-bridge:gate-parameter-table/admin-gate-states: 255`)
  const [sortMode, setSortMode] = useState('velocity')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const handleEncode = async () => {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const response = await axios.post('/api/encode', {
        yaml: yamlInput,
        sortMode
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
        <h1 className="page-title">Encode (YAML to CBOR)</h1>
        <p className="page-description">Convert YAML configuration to CBOR binary (offline)</p>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Input (YAML)</h2>
        </div>

        <div className="form-group">
          <textarea
            className="form-textarea"
            value={yamlInput}
            onChange={(e) => setYamlInput(e.target.value)}
            rows={10}
            placeholder="Enter YAML configuration..."
          />
        </div>

        <div className="form-row" style={{ marginBottom: '16px' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Sort Mode</label>
            <select
              className="form-select"
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value)}
            >
              <option value="velocity">Velocity</option>
              <option value="rfc8949">RFC 8949</option>
            </select>
          </div>
        </div>

        <button
          className="btn btn-primary"
          onClick={handleEncode}
          disabled={loading || !yamlInput.trim()}
        >
          {loading ? 'Encoding...' : 'Encode to CBOR'}
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
            <span className="status-badge info">{result.size} bytes</span>
          </div>

          <div className="result-container">
            <div className="result-header">
              <span className="result-title">CBOR (Hex)</span>
              <button
                className="btn btn-secondary"
                style={{ padding: '4px 12px', fontSize: '0.75rem' }}
                onClick={() => copyToClipboard(result.cbor)}
              >
                Copy
              </button>
            </div>
            <div className="result-content">
              <pre>{result.cbor}</pre>
            </div>
          </div>

          <div className="result-container" style={{ marginTop: '16px' }}>
            <div className="result-header">
              <span className="result-title">CBOR (Base64)</span>
              <button
                className="btn btn-secondary"
                style={{ padding: '4px 12px', fontSize: '0.75rem' }}
                onClick={() => copyToClipboard(result.cborBase64)}
              >
                Copy
              </button>
            </div>
            <div className="result-content">
              <pre>{result.cborBase64}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Encode
