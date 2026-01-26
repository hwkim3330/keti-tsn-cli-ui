import { useState } from 'react'
import axios from 'axios'

function Download({ config }) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const handleDownload = async () => {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const response = await axios.post('/api/download', {
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

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Download YANG Catalog</h1>
        <p className="page-description">Download YANG catalog from device</p>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Connection Info</h2>
        </div>
        <div style={{ marginBottom: '16px', padding: '12px', background: '#f8fafc', borderRadius: '8px' }}>
          {config.transport === 'wifi' ? (
            <span>WiFi: {config.host}:{config.port}</span>
          ) : (
            <span>Serial: {config.device}</span>
          )}
        </div>
        <button
          className="btn btn-primary"
          onClick={handleDownload}
          disabled={loading}
        >
          {loading ? 'Downloading...' : 'Download Catalog'}
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

          <div className="alert alert-success" style={{ marginBottom: '16px' }}>
            {result.message}
          </div>

          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>Checksum</div>
            <div style={{ fontFamily: 'monospace', fontSize: '1.25rem', fontWeight: '600' }}>{result.checksum}</div>
          </div>

          {result.catalogInfo && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
              <div>
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>Path</div>
                <div style={{ fontSize: '0.875rem', wordBreak: 'break-all' }}>{result.catalogInfo.path}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>YANG Files</div>
                <div style={{ fontSize: '1.25rem', fontWeight: '600' }}>{result.catalogInfo.count?.yang || 0}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>SID Files</div>
                <div style={{ fontSize: '1.25rem', fontWeight: '600' }}>{result.catalogInfo.count?.sid || 0}</div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default Download
