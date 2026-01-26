import { useState } from 'react'
import axios from 'axios'

function GetConfig({ config }) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const handleGet = async () => {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const response = await axios.post('/api/get', {
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

  const downloadAsFile = () => {
    if (!result) return
    const blob = new Blob([result.result], { type: 'text/yaml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tsn-config-${new Date().toISOString().slice(0, 10)}.yaml`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Get Full Configuration</h1>
        <p className="page-description">Retrieve complete configuration from device (Block-wise GET)</p>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Connection</h2>
        </div>
        <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '8px', marginBottom: '16px' }}>
          {config.transport === 'wifi' ? (
            <span>WiFi: {config.host}:{config.port}</span>
          ) : (
            <span>Serial: {config.device}</span>
          )}
        </div>

        <div className="alert alert-info" style={{ marginBottom: '16px' }}>
          This operation retrieves the full device configuration using Block-wise transfer.
          It may take some time depending on the configuration size.
        </div>

        <button
          className="btn btn-primary"
          onClick={handleGet}
          disabled={loading}
        >
          {loading ? 'Retrieving...' : 'Get Full Configuration'}
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
            <h2 className="card-title">Configuration</h2>
            <div style={{ display: 'flex', gap: '8px' }}>
              <span className="status-badge info">{result.size} bytes (CBOR)</span>
              <button
                className="btn btn-secondary"
                style={{ padding: '4px 12px', fontSize: '0.75rem' }}
                onClick={() => copyToClipboard(result.result)}
              >
                Copy
              </button>
              <button
                className="btn btn-primary"
                style={{ padding: '4px 12px', fontSize: '0.75rem' }}
                onClick={downloadAsFile}
              >
                Download
              </button>
            </div>
          </div>

          <div className="result-container">
            <div className="result-header">
              <span className="result-title">YAML Output ({result.format})</span>
            </div>
            <div className="result-content" style={{ maxHeight: '500px', overflow: 'auto' }}>
              <pre>{result.result}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default GetConfig
