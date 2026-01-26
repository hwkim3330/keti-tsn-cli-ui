import { useState, useEffect } from 'react'
import axios from 'axios'

function Dashboard({ config }) {
  const [health, setHealth] = useState(null)
  const [catalogs, setCatalogs] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [healthRes, listRes] = await Promise.all([
          axios.get('/api/health'),
          axios.get('/api/list')
        ])
        setHealth(healthRes.data)
        setCatalogs(listRes.data.catalogs)
      } catch (error) {
        console.error('Error fetching data:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

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
        <h1 className="page-title">Dashboard</h1>
        <p className="page-description">TSN Switch Configuration Overview</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', marginBottom: '24px' }}>
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="24" height="24" fill="none" stroke="#16a34a" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: '0.875rem', color: '#64748b' }}>Server Status</div>
              <div style={{ fontSize: '1.5rem', fontWeight: '600' }}>
                {health ? 'Online' : 'Offline'}
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="24" height="24" fill="none" stroke="#2563eb" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: '0.875rem', color: '#64748b' }}>Cached Catalogs</div>
              <div style={{ fontSize: '1.5rem', fontWeight: '600' }}>{catalogs.length}</div>
            </div>
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="24" height="24" fill="none" stroke="#f59e0b" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: '0.875rem', color: '#64748b' }}>Transport</div>
              <div style={{ fontSize: '1.5rem', fontWeight: '600', textTransform: 'capitalize' }}>{config.transport}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Current Configuration</h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
          <div>
            <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>Transport Type</div>
            <div style={{ fontWeight: '500' }}>{config.transport === 'wifi' ? 'WiFi (UDP)' : 'Serial (USB)'}</div>
          </div>
          {config.transport === 'wifi' ? (
            <>
              <div>
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>Host</div>
                <div style={{ fontWeight: '500' }}>{config.host}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>Port</div>
                <div style={{ fontWeight: '500' }}>{config.port}</div>
              </div>
            </>
          ) : (
            <div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>Device</div>
              <div style={{ fontWeight: '500' }}>{config.device}</div>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Quick Actions</h2>
        </div>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <a href="/checksum" className="btn btn-primary">Check Connection</a>
          <a href="/fetch" className="btn btn-secondary">Fetch Config</a>
          <a href="/patch" className="btn btn-secondary">Apply Patch</a>
          <a href="/get" className="btn btn-secondary">Get Full Config</a>
        </div>
      </div>
    </div>
  )
}

export default Dashboard
