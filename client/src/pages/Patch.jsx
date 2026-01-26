import { useState } from 'react'
import axios from 'axios'

function Patch({ config }) {
  const [patches, setPatches] = useState([
    { path: "/ietf-interfaces:interfaces/interface[name='2']/ieee802-dot1q-bridge:bridge-port/ieee802-dot1q-sched-bridge:gate-parameter-table/admin-gate-states", value: 255 }
  ])
  const [newPath, setNewPath] = useState('')
  const [newValue, setNewValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const addPatch = () => {
    if (newPath.trim() && newValue.trim()) {
      let parsedValue = newValue.trim()
      // Try to parse as number or boolean
      if (parsedValue === 'true') parsedValue = true
      else if (parsedValue === 'false') parsedValue = false
      else if (!isNaN(parsedValue)) parsedValue = Number(parsedValue)

      setPatches([...patches, { path: newPath.trim(), value: parsedValue }])
      setNewPath('')
      setNewValue('')
    }
  }

  const removePatch = (index) => {
    setPatches(patches.filter((_, i) => i !== index))
  }

  const handlePatch = async () => {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const response = await axios.post('/api/patch', {
        patches,
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
        <h1 className="page-title">Patch Configuration (iPATCH)</h1>
        <p className="page-description">Modify configuration values on device</p>
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
          <h2 className="card-title">Patch Operations</h2>
        </div>

        <div style={{ marginBottom: '16px' }}>
          {patches.map((patch, index) => (
            <div
              key={index}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '12px',
                background: '#f1f5f9',
                borderRadius: '6px',
                marginBottom: '8px'
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>Path</div>
                <div style={{ fontSize: '0.875rem', fontFamily: 'monospace', wordBreak: 'break-all' }}>{patch.path}</div>
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '8px', marginBottom: '4px' }}>Value</div>
                <div style={{ fontSize: '0.875rem', fontFamily: 'monospace' }}>
                  <span style={{
                    background: typeof patch.value === 'boolean' ? '#dbeafe' : typeof patch.value === 'number' ? '#dcfce7' : '#fef3c7',
                    padding: '2px 8px',
                    borderRadius: '4px'
                  }}>
                    {String(patch.value)}
                  </span>
                </div>
              </div>
              <button
                onClick={() => removePatch(index)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#dc2626',
                  padding: '4px'
                }}
              >
                <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: '8px', marginBottom: '16px' }}>
          <input
            type="text"
            className="form-input"
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            placeholder="Path (e.g., /module:container/leaf)"
          />
          <input
            type="text"
            className="form-input"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="Value"
            onKeyPress={(e) => e.key === 'Enter' && addPatch()}
          />
          <button className="btn btn-secondary" onClick={addPatch}>
            Add
          </button>
        </div>

        <button
          className="btn btn-primary"
          onClick={handlePatch}
          disabled={loading || patches.length === 0}
        >
          {loading ? 'Applying...' : 'Apply Patches'}
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
            <span className={`status-badge ${result.summary.failed === 0 ? 'success' : 'warning'}`}>
              {result.summary.success}/{result.summary.total} Success
            </span>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', textAlign: 'center' }}>
              <div style={{ padding: '16px', background: '#f8fafc', borderRadius: '8px' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: '600' }}>{result.summary.total}</div>
                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Total</div>
              </div>
              <div style={{ padding: '16px', background: '#dcfce7', borderRadius: '8px' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: '600', color: '#166534' }}>{result.summary.success}</div>
                <div style={{ fontSize: '0.75rem', color: '#166534' }}>Success</div>
              </div>
              <div style={{ padding: '16px', background: result.summary.failed > 0 ? '#fee2e2' : '#f8fafc', borderRadius: '8px' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: '600', color: result.summary.failed > 0 ? '#991b1b' : '#64748b' }}>{result.summary.failed}</div>
                <div style={{ fontSize: '0.75rem', color: result.summary.failed > 0 ? '#991b1b' : '#64748b' }}>Failed</div>
              </div>
            </div>
          </div>

          <table className="table">
            <thead>
              <tr>
                <th>Path</th>
                <th>Status</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {result.results.map((r, index) => (
                <tr key={index}>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.75rem', wordBreak: 'break-all' }}>{r.path}</td>
                  <td>
                    <span className={`status-badge ${r.success ? 'success' : 'error'}`}>
                      {r.success ? 'Success' : 'Failed'}
                    </span>
                  </td>
                  <td style={{ fontSize: '0.75rem', color: '#991b1b' }}>{r.error || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default Patch
