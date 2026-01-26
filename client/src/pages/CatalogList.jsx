import { useState, useEffect } from 'react'
import axios from 'axios'

function CatalogList() {
  const [catalogs, setCatalogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchCatalogs()
  }, [])

  const fetchCatalogs = async () => {
    try {
      const response = await axios.get('/api/list')
      setCatalogs(response.data.catalogs)
    } catch (err) {
      setError(err.response?.data?.error || err.message)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Cached YANG Catalogs</h1>
        <p className="page-description">List of downloaded YANG catalogs (offline)</p>
      </div>

      {error && (
        <div className="alert alert-error">
          {error}
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Catalogs ({catalogs.length})</h2>
          <button className="btn btn-secondary" onClick={fetchCatalogs}>
            Refresh
          </button>
        </div>

        {catalogs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
            <svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ margin: '0 auto 16px' }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
            </svg>
            <p>No catalogs cached yet.</p>
            <p style={{ fontSize: '0.875rem', marginTop: '8px' }}>
              Use the <a href="/download" style={{ color: '#2563eb' }}>Download</a> page to download a catalog from device.
            </p>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Checksum</th>
                <th>YANG Files</th>
                <th>SID Files</th>
                <th>Path</th>
              </tr>
            </thead>
            <tbody>
              {catalogs.map((catalog, index) => (
                <tr key={index}>
                  <td style={{ fontFamily: 'monospace' }}>{catalog.checksum}</td>
                  <td>{catalog.count?.yang || 0}</td>
                  <td>{catalog.count?.sid || 0}</td>
                  <td style={{ fontSize: '0.75rem', color: '#64748b', wordBreak: 'break-all' }}>{catalog.path}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export default CatalogList
