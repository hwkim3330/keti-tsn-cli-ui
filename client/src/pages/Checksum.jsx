import { useState, useEffect } from 'react'
import axios from 'axios'

function Checksum({ config }) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadResult, setDownloadResult] = useState(null)
  const [autoChecked, setAutoChecked] = useState(false)

  // Auto-check on mount
  useEffect(() => {
    if (!autoChecked) {
      handleChecksum()
      setAutoChecked(true)
    }
  }, [config.host])

  const handleChecksum = async () => {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const response = await axios.post('/api/checksum', {
        transport: config.transport,
        device: config.device,
        host: config.host,
        port: config.port
      }, { timeout: 15000 })
      setResult(response.data)
    } catch (err) {
      setError(err.response?.data?.error || err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = async () => {
    setDownloading(true)
    setDownloadResult(null)

    try {
      const response = await axios.post('/api/download', {
        transport: config.transport,
        device: config.device,
        host: config.host,
        port: config.port
      }, { timeout: 120000 }) // 2 min timeout for download

      setDownloadResult(response.data)

      // Re-check after download
      await handleChecksum()
    } catch (err) {
      setDownloadResult({ error: err.response?.data?.error || err.message })
    } finally {
      setDownloading(false)
    }
  }

  // Auto-download if checksum mismatch
  useEffect(() => {
    if (result && !result.match && !result.cached && !downloading && !downloadResult) {
      handleDownload()
    }
  }, [result])

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">YANG Catalog Sync</h1>
        <p className="page-description">Verify and sync YANG catalog with device</p>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Connection</h2>
        </div>
        <div style={{ marginBottom: '16px', padding: '12px', background: '#f8fafc', borderRadius: '8px', fontFamily: 'monospace' }}>
          {config.transport === 'wifi' ? `${config.host}:${config.port}` : config.device}
        </div>
        <button
          className="btn btn-primary"
          onClick={handleChecksum}
          disabled={loading || downloading}
        >
          {loading ? 'Checking...' : 'Check Sync'}
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
            <h2 className="card-title">Catalog Status</h2>
            <span className={`status-badge ${result.match ? 'success' : 'warning'}`}>
              {result.match ? 'Synced' : 'Out of Sync'}
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px', marginBottom: '16px' }}>
            <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '6px' }}>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>Device Checksum</div>
              <div style={{ fontFamily: 'monospace', fontSize: '0.9rem', fontWeight: '500' }}>{result.checksum}</div>
            </div>
            {result.catalogInfo && (
              <>
                <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '6px' }}>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>Local Checksum</div>
                  <div style={{ fontFamily: 'monospace', fontSize: '0.9rem', fontWeight: '500' }}>
                    {result.catalogInfo.checksum || '-'}
                  </div>
                </div>
                <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '6px' }}>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>YANG Files</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: '600' }}>{result.catalogInfo.count?.yang || 0}</div>
                </div>
                <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '6px' }}>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>SID Files</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: '600' }}>{result.catalogInfo.count?.sid || 0}</div>
                </div>
              </>
            )}
          </div>

          {!result.match && (
            <div style={{ marginTop: '16px' }}>
              {downloading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '16px', background: '#eff6ff', borderRadius: '8px' }}>
                  <div className="spinner" style={{ width: '20px', height: '20px' }}></div>
                  <span style={{ color: '#1d4ed8' }}>Downloading catalog from device...</span>
                </div>
              ) : (
                <button className="btn btn-primary" onClick={handleDownload} disabled={downloading}>
                  Download Catalog
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {downloadResult && (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Download Result</h2>
            <span className={`status-badge ${downloadResult.error ? 'error' : 'success'}`}>
              {downloadResult.error ? 'Failed' : 'Success'}
            </span>
          </div>

          {downloadResult.error ? (
            <div className="alert alert-error">{downloadResult.error}</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '12px' }}>
              <div style={{ padding: '12px', background: '#f0fdf4', borderRadius: '6px' }}>
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>YANG Files</div>
                <div style={{ fontSize: '1.1rem', fontWeight: '600', color: '#16a34a' }}>{downloadResult.yangCount || 0}</div>
              </div>
              <div style={{ padding: '12px', background: '#f0fdf4', borderRadius: '6px' }}>
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>SID Files</div>
                <div style={{ fontSize: '1.1rem', fontWeight: '600', color: '#16a34a' }}>{downloadResult.sidCount || 0}</div>
              </div>
              <div style={{ padding: '12px', background: '#f0fdf4', borderRadius: '6px' }}>
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>Path</div>
                <div style={{ fontSize: '0.8rem', fontFamily: 'monospace', wordBreak: 'break-all' }}>{downloadResult.path}</div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default Checksum
