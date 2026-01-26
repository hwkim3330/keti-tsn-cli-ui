import { useState, useEffect } from 'react'
import axios from 'axios'

function PTP({ config }) {
  const [profile, setProfile] = useState('bridge')
  const [portRoles, setPortRoles] = useState(() => {
    const roles = {}
    for (let i = 1; i <= 12; i++) roles[i] = 'disabled'
    roles[1] = 'master'
    roles[2] = 'slave'
    return roles
  })
  const [enable1PPS, setEnable1PPS] = useState(true)
  const [enableServo, setEnableServo] = useState(true)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [currentStatus, setCurrentStatus] = useState(null)
  const [lastResult, setLastResult] = useState(null)

  // Parse status from YAML
  const parseStatus = (yamlStr) => {
    if (!yamlStr || yamlStr.includes('instance: null')) return null
    try {
      const status = { profile: 'none', ports: [], servo: null, pps: null }

      const profileMatch = yamlStr.match(/profile:\s*(\w+)/)
      if (profileMatch) status.profile = profileMatch[1]

      // port-state comes before port-index in the YAML
      const portRegex = /port-state:\s*(\w+)[\s\S]*?port-index:\s*(\d+)/g
      let match
      while ((match = portRegex.exec(yamlStr)) !== null) {
        status.ports.push({ index: parseInt(match[2]), state: match[1] })
      }

      if (yamlStr.includes('servo-index:')) status.servo = true
      if (yamlStr.includes('1pps-out')) status.pps = true

      return status
    } catch {
      return null
    }
  }

  // Fetch status
  const fetchStatus = async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const res = await axios.post('/api/fetch', {
        paths: ['/ieee1588-ptp:ptp'],
        transport: config.transport,
        device: config.device,
        host: config.host,
        port: config.port
      })
      setCurrentStatus(parseStatus(res.data.result))
      if (!silent) setError(null)
    } catch (err) {
      if (!silent) setError(err.response?.data?.error || err.message)
    } finally {
      if (!silent) setLoading(false)
    }
  }

  // Apply configuration
  const apply = async () => {
    setLoading(true)
    setError(null)
    setLastResult(null)

    const portList = []
    for (let i = 1; i <= 12; i++) {
      if (portRoles[i] !== 'disabled') {
        portList.push({
          'port-index': i,
          'external-port-config-port-ds': { 'desired-state': portRoles[i] }
        })
      }
    }

    const patches = []

    // Instance
    const instance = {
      'instance-index': 0,
      'default-ds': { 'external-port-config-enable': true },
      'mchp-velocitysp-ptp:automotive': { profile },
      ports: { port: portList }
    }
    if (enableServo) {
      instance['mchp-velocitysp-ptp:servos'] = {
        servo: [{ 'servo-index': 0, 'servo-type': 'pi', 'ltc-index': 0 }]
      }
    }
    patches.push({ path: '/ieee1588-ptp:ptp/instances/instance', value: instance })

    // 1PPS
    if (enable1PPS) {
      patches.push({
        path: '/ieee1588-ptp:ptp/mchp-velocitysp-ptp:ltcs/ltc',
        value: {
          'ltc-index': 0,
          'ptp-pins': { 'ptp-pin': [{ index: 4, function: '1pps-out' }] }
        }
      })
    }

    try {
      const res = await axios.post('/api/patch', {
        patches,
        transport: config.transport,
        device: config.device,
        host: config.host,
        port: config.port
      })
      setLastResult(res.data)
      if (res.data?.summary?.failed === 0) {
        setTimeout(() => fetchStatus(true), 500)
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message)
    } finally {
      setLoading(false)
    }
  }

  // Reset configuration
  const reset = async () => {
    if (!confirm('PTP 설정을 초기화하시겠습니까?')) return
    setLoading(true)
    try {
      await axios.post('/api/patch', {
        patches: [
          { path: "/ieee1588-ptp:ptp/instances/instance[instance-index='0']", value: null },
          { path: "/ieee1588-ptp:ptp/mchp-velocitysp-ptp:ltcs/ltc[ltc-index='0']", value: null }
        ],
        transport: config.transport,
        device: config.device,
        host: config.host,
        port: config.port
      })
      setCurrentStatus(null)
      setLastResult({ reset: true })
    } catch (err) {
      setError(err.response?.data?.error || err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (config.host || config.device) fetchStatus(true)
  }, [config.host, config.device])

  const getPortBg = (role) => {
    if (role === 'master') return '#e0f2fe'
    if (role === 'slave') return '#fef9c3'
    if (role === 'passive') return '#f3e8ff'
    return '#f8fafc'
  }

  const profileLabels = { bridge: 'Bridge', gm: 'Grandmaster', none: 'Standard' }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">PTP Configuration</h1>
      </div>

      {/* Current Status */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Current Status</h2>
          <button className="btn btn-secondary" onClick={() => fetchStatus()} disabled={loading}>
            Refresh
          </button>
        </div>

        {currentStatus ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Profile</div>
              <div style={{ fontSize: '1.1rem', fontWeight: '600' }}>{profileLabels[currentStatus.profile] || currentStatus.profile}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Ports</div>
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                {currentStatus.ports.map(p => (
                  <span key={p.index} style={{
                    padding: '2px 6px', borderRadius: '4px', fontSize: '0.75rem',
                    background: p.state === 'master' ? '#e0f2fe' : '#fef9c3'
                  }}>
                    {p.index}:{p.state[0].toUpperCase()}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Servo</div>
              <div>{currentStatus.servo ? '✓ Active' : '✗ Off'}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>1PPS</div>
              <div>{currentStatus.pps ? '✓ Active' : '✗ Off'}</div>
            </div>
          </div>
        ) : (
          <div style={{ color: '#94a3b8', textAlign: 'center', padding: '20px' }}>
            {loading ? 'Loading...' : 'No PTP configuration'}
          </div>
        )}
      </div>

      {/* Configuration */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Configuration</h2>
        </div>

        {/* Profile & Options */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
          <div>
            <label className="form-label">Profile</label>
            <select className="form-select" value={profile} onChange={(e) => setProfile(e.target.value)}>
              <option value="bridge">Bridge (AED-B)</option>
              <option value="gm">Grandmaster (AED-GM)</option>
              <option value="none">Standard</option>
            </select>
          </div>
          <div>
            <label className="form-label">Options</label>
            <div style={{ display: 'flex', gap: '20px', marginTop: '8px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                <input type="checkbox" checked={enableServo} onChange={(e) => setEnableServo(e.target.checked)} />
                Servo
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                <input type="checkbox" checked={enable1PPS} onChange={(e) => setEnable1PPS(e.target.checked)} />
                1PPS Output
              </label>
            </div>
          </div>
        </div>

        {/* Ports */}
        <div style={{ marginBottom: '20px' }}>
          <label className="form-label">Ports</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '8px' }}>
            {[1,2,3,4,5,6,7,8,9,10,11,12].map(n => (
              <div key={n}>
                <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: '2px' }}>Port {n}</div>
                <select
                  className="form-select"
                  value={portRoles[n]}
                  onChange={(e) => setPortRoles(prev => ({ ...prev, [n]: e.target.value }))}
                  style={{ padding: '6px', fontSize: '0.8rem', background: getPortBg(portRoles[n]) }}
                >
                  <option value="disabled">-</option>
                  <option value="master">M</option>
                  <option value="slave">S</option>
                  <option value="passive">P</option>
                </select>
              </div>
            ))}
          </div>
          <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '4px' }}>
            M=Master, S=Slave, P=Passive, -=Disabled
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', borderTop: '1px solid #e2e8f0', paddingTop: '16px' }}>
          <button className="btn btn-danger" onClick={reset} disabled={loading}>Reset</button>
          <button className="btn btn-primary" onClick={apply} disabled={loading}>
            {loading ? 'Applying...' : 'Apply'}
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {lastResult && (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Result</h2>
          </div>
          {lastResult.reset ? (
            <div style={{ color: '#16a34a' }}>✓ Configuration reset</div>
          ) : (
            <div>
              {lastResult.results?.map((r, i) => (
                <div key={i} style={{ display: 'flex', gap: '8px', padding: '4px 0', fontSize: '0.85rem' }}>
                  <span style={{ color: r.success ? '#16a34a' : '#dc2626' }}>{r.success ? '✓' : '✗'}</span>
                  <span>{r.path.split('/').pop()}</span>
                  {r.error && <span style={{ color: '#dc2626', fontSize: '0.75rem' }}>- {r.error}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default PTP
