import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import axios from 'axios'
import { useCapture } from '../contexts/CaptureContext'

const MAX_PACKETS = 500
const UPDATE_INTERVAL = 200

function Capture() {
  const {
    capturing, status, error, wsConnected, activeInterfaces,
    startCapture, stopCapture, addPacketListener, setError
  } = useCapture()

  const [packets, setPackets] = useState([])
  const [selectedPacket, setSelectedPacket] = useState(null)
  const [interfaces, setInterfaces] = useState([])
  const [selectedInterfaces, setSelectedInterfaces] = useState([])
  const [filterHost, setFilterHost] = useState('')
  const [filterPort, setFilterPort] = useState('5683')
  const [captureMode, setCaptureMode] = useState('all')
  const [autoScroll, setAutoScroll] = useState(true)
  const [protocolFilter, setProtocolFilter] = useState('all')
  const [paused, setPaused] = useState(false)

  const tableRef = useRef(null)
  const packetBufferRef = useRef([])
  const updateTimerRef = useRef(null)
  const pausedRef = useRef(false)

  // Keep pausedRef in sync
  useEffect(() => {
    pausedRef.current = paused
  }, [paused])

  // Flush packet buffer to state
  const flushBuffer = useCallback(() => {
    if (pausedRef.current) return
    if (packetBufferRef.current.length === 0) return

    const newPackets = packetBufferRef.current
    packetBufferRef.current = []

    setPackets(prev => {
      const combined = [...prev, ...newPackets]
      return combined.length > MAX_PACKETS ? combined.slice(-MAX_PACKETS) : combined
    })
  }, [])

  // Handle incoming packet
  const handlePacket = useCallback((packet) => {
    packetBufferRef.current.push(packet)
  }, [])

  // Register packet listener
  useEffect(() => {
    const unsubscribe = addPacketListener(handlePacket)

    // Start update timer
    updateTimerRef.current = setInterval(flushBuffer, UPDATE_INTERVAL)

    return () => {
      unsubscribe()
      if (updateTimerRef.current) {
        clearInterval(updateTimerRef.current)
      }
    }
  }, [addPacketListener, handlePacket, flushBuffer])

  // Load interfaces
  useEffect(() => {
    loadInterfaces()
  }, [])

  // Sync selected interfaces with active
  useEffect(() => {
    if (capturing && activeInterfaces.length > 0) {
      setSelectedInterfaces(activeInterfaces)
    }
  }, [capturing, activeInterfaces])

  // Auto scroll
  useEffect(() => {
    if (autoScroll && !paused && tableRef.current) {
      tableRef.current.scrollTop = tableRef.current.scrollHeight
    }
  }, [packets, autoScroll, paused])

  const loadInterfaces = async () => {
    try {
      const res = await axios.get('/api/capture/interfaces')
      const sorted = res.data
        .filter(i => i.name !== 'ap')
        .sort((a, b) => {
          const aEsp = a.name.startsWith('esp')
          const bEsp = b.name.startsWith('esp')
          if (aEsp && !bEsp) return -1
          if (!aEsp && bEsp) return 1
          return a.name.localeCompare(b.name)
        })
      setInterfaces(sorted)
    } catch (err) {
      setError('Failed to load interfaces')
    }
  }

  const toggleInterface = (name) => {
    setSelectedInterfaces(prev =>
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
    )
  }

  const handleStart = () => {
    setPackets([])
    packetBufferRef.current = []
    startCapture({
      interfaces: selectedInterfaces,
      port: parseInt(filterPort) || 5683,
      host: filterHost || '',
      captureMode
    })
  }

  const handleClear = () => {
    setPackets([])
    packetBufferRef.current = []
    setSelectedPacket(null)
  }

  const formatTime = (isoTime) => {
    const date = new Date(isoTime)
    return date.toLocaleTimeString('en-US', {
      hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3
    })
  }

  const getProtocolColor = (protocol) => {
    const colors = {
      'CoAP': '#4ade80', 'PTP': '#a78bfa', 'TCP': '#f97316',
      'ICMP': '#06b6d4', 'UDP': '#60a5fa'
    }
    return colors[protocol] || '#94a3b8'
  }

  const getCodeColor = (code) => {
    if (!code) return '#94a3b8'
    if (code.startsWith('2.')) return '#4ade80'
    if (code.startsWith('4.') || code.startsWith('5.')) return '#f87171'
    return '#fbbf24'
  }

  const formatHexDump = (hexStr, asciiStr) => {
    if (!hexStr) return []
    const bytes = hexStr.split(' ')
    const lines = []
    for (let i = 0; i < bytes.length; i += 16) {
      lines.push({
        offset: i.toString(16).padStart(4, '0'),
        hex: bytes.slice(i, i + 16).join(' ').padEnd(47, ' '),
        ascii: asciiStr ? asciiStr.slice(i, i + 16) : ''
      })
    }
    return lines
  }

  const filteredPackets = useMemo(() => {
    if (protocolFilter === 'all') return packets
    return packets.filter(p => p.protocol === protocolFilter)
  }, [packets, protocolFilter])

  const stats = useMemo(() => ({
    total: packets.length,
    coap: packets.filter(p => p.protocol === 'CoAP').length,
    ptp: packets.filter(p => p.protocol === 'PTP').length,
    tcp: packets.filter(p => p.protocol === 'TCP').length,
    udp: packets.filter(p => p.protocol === 'UDP').length
  }), [packets])

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Packet Capture</h1>
      </div>

      {/* Controls */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Capture</h2>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{
              padding: '4px 8px', borderRadius: '12px', fontSize: '0.7rem', fontWeight: '500',
              background: wsConnected ? '#ecfdf5' : '#fef2f2',
              color: wsConnected ? '#059669' : '#b91c1c'
            }}>
              <span style={{
                display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%',
                background: wsConnected ? '#059669' : '#dc2626', marginRight: '4px'
              }}></span>
              WS
            </span>

            {capturing && (
              <span style={{
                padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: '500',
                background: paused ? '#fefce8' : '#ecfdf5',
                color: paused ? '#a16207' : '#059669'
              }}>
                {paused ? 'Paused' : 'Capturing'}
              </span>
            )}

            {!capturing ? (
              <button className="btn btn-primary" onClick={handleStart}
                disabled={selectedInterfaces.length === 0 || !wsConnected}>
                Start
              </button>
            ) : (
              <>
                <button className="btn btn-secondary" onClick={() => setPaused(p => !p)}>
                  {paused ? 'Resume' : 'Pause'}
                </button>
                <button className="btn btn-danger" onClick={stopCapture}>Stop</button>
              </>
            )}
            <button className="btn btn-secondary" onClick={handleClear}>Clear</button>
          </div>
        </div>

        {/* Interfaces */}
        <div style={{ marginBottom: '12px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {interfaces.map(iface => (
              <label key={iface.name} style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '6px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem',
                background: selectedInterfaces.includes(iface.name) ? '#f1f5f9' : '#f8fafc',
                border: selectedInterfaces.includes(iface.name) ? '2px solid #475569' : '2px solid transparent'
              }}>
                <input type="checkbox"
                  checked={selectedInterfaces.includes(iface.name)}
                  onChange={() => toggleInterface(iface.name)}
                  disabled={capturing || (!selectedInterfaces.includes(iface.name) && selectedInterfaces.length >= 4)}
                />
                <span style={{ fontWeight: '500' }}>{iface.name}</span>
                <span style={{ fontSize: '0.7rem', color: '#64748b', fontFamily: 'monospace' }}>
                  {iface.addresses?.[0] || ''}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Filters */}
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Mode</label>
            <select className="form-select" value={captureMode}
              onChange={(e) => setCaptureMode(e.target.value)} disabled={capturing}>
              <option value="all">All</option>
              <option value="coap">CoAP</option>
              <option value="ptp">PTP</option>
            </select>
          </div>
          {captureMode === 'coap' && (
            <div className="form-group">
              <label className="form-label">Port</label>
              <input type="text" className="form-input" value={filterPort}
                onChange={(e) => setFilterPort(e.target.value)} disabled={capturing} style={{ width: '70px' }} />
            </div>
          )}
          <div className="form-group">
            <label className="form-label">Filter</label>
            <select className="form-select" value={protocolFilter} onChange={(e) => setProtocolFilter(e.target.value)}>
              <option value="all">All</option>
              <option value="CoAP">CoAP</option>
              <option value="PTP">PTP</option>
              <option value="TCP">TCP</option>
              <option value="UDP">UDP</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">&nbsp;</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
              <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
              Auto-scroll
            </label>
          </div>
        </div>

        {/* Stats bar */}
        <div style={{ display: 'flex', gap: '16px', padding: '8px 0', fontSize: '0.8rem', color: '#64748b' }}>
          <span>Total: <b>{stats.total}</b></span>
          <span style={{ color: '#166534' }}>CoAP: <b>{stats.coap}</b></span>
          <span style={{ color: '#6d28d9' }}>PTP: <b>{stats.ptp}</b></span>
          <span style={{ color: '#c2410c' }}>TCP: <b>{stats.tcp}</b></span>
          <span style={{ color: '#1e40af' }}>UDP: <b>{stats.udp}</b></span>
          {filteredPackets.length !== packets.length && (
            <span>Showing: <b>{filteredPackets.length}</b></span>
          )}
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* Packet Table */}
      <div className="card" style={{ padding: 0 }}>
        <div ref={tableRef} style={{ height: '400px', overflow: 'auto', fontSize: '0.75rem', fontFamily: 'monospace' }}>
          <table className="table" style={{ marginBottom: 0 }}>
            <thead style={{ position: 'sticky', top: 0, background: '#f8fafc', zIndex: 1 }}>
              <tr>
                <th style={{ width: '50px' }}>No</th>
                <th style={{ width: '90px' }}>Time</th>
                <th style={{ width: '75px' }}>Iface</th>
                <th style={{ width: '130px' }}>Source</th>
                <th style={{ width: '130px' }}>Dest</th>
                <th style={{ width: '50px' }}>Proto</th>
                <th>Info</th>
              </tr>
            </thead>
            <tbody>
              {filteredPackets.length === 0 ? (
                <tr><td colSpan="7" style={{ textAlign: 'center', padding: '60px', color: '#64748b' }}>
                  {capturing ? 'Waiting for packets...' : 'Select interface and Start'}
                </td></tr>
              ) : (
                filteredPackets.map(pkt => (
                  <tr key={pkt.id} onClick={() => setSelectedPacket(pkt)}
                    style={{ cursor: 'pointer', background: selectedPacket?.id === pkt.id ? '#f1f5f9' : '' }}>
                    <td>{pkt.id}</td>
                    <td>{formatTime(pkt.time)}</td>
                    <td>{pkt.interface?.split(/[:/]/)[0]}</td>
                    <td>{pkt.source}{pkt.srcPort ? `:${pkt.srcPort}` : ''}</td>
                    <td>{pkt.destination}{pkt.dstPort ? `:${pkt.dstPort}` : ''}</td>
                    <td>
                      <span style={{
                        padding: '1px 5px', borderRadius: '3px', fontSize: '0.7rem',
                        background: getProtocolColor(pkt.protocol) + '22',
                        color: getProtocolColor(pkt.protocol)
                      }}>{pkt.protocol}</span>
                    </td>
                    <td style={{ color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '250px' }}>
                      {pkt.info}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Packet Details */}
      {selectedPacket && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div className="card">
            <h3 style={{ fontSize: '0.9rem', marginBottom: '12px' }}>Packet #{selectedPacket.id}</h3>
            <div style={{ fontSize: '0.8rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div style={{ padding: '6px', background: '#f8fafc', borderRadius: '4px' }}>
                <div style={{ fontSize: '0.65rem', color: '#64748b' }}>Source</div>
                <div style={{ fontFamily: 'monospace' }}>{selectedPacket.source}:{selectedPacket.srcPort}</div>
              </div>
              <div style={{ padding: '6px', background: '#f8fafc', borderRadius: '4px' }}>
                <div style={{ fontSize: '0.65rem', color: '#64748b' }}>Destination</div>
                <div style={{ fontFamily: 'monospace' }}>{selectedPacket.destination}:{selectedPacket.dstPort}</div>
              </div>
            </div>

            {selectedPacket.coap && (
              <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #e2e8f0' }}>
                <div style={{ fontWeight: '600', color: '#4ade80', marginBottom: '8px' }}>CoAP</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', fontSize: '0.8rem' }}>
                  <div style={{ padding: '4px', background: '#f8fafc', borderRadius: '4px' }}>
                    <div style={{ fontSize: '0.6rem', color: '#64748b' }}>Type</div>
                    <div>{selectedPacket.coap.type}</div>
                  </div>
                  <div style={{ padding: '4px', background: '#f8fafc', borderRadius: '4px' }}>
                    <div style={{ fontSize: '0.6rem', color: '#64748b' }}>Code</div>
                    <div style={{ color: getCodeColor(selectedPacket.coap.code) }}>{selectedPacket.coap.code}</div>
                  </div>
                  <div style={{ padding: '4px', background: '#f8fafc', borderRadius: '4px' }}>
                    <div style={{ fontSize: '0.6rem', color: '#64748b' }}>MID</div>
                    <div>{selectedPacket.coap.messageId}</div>
                  </div>
                  <div style={{ padding: '4px', background: '#f8fafc', borderRadius: '4px' }}>
                    <div style={{ fontSize: '0.6rem', color: '#64748b' }}>Token</div>
                    <div>{selectedPacket.coap.token || '-'}</div>
                  </div>
                </div>
              </div>
            )}

            {selectedPacket.ptp && (
              <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #e2e8f0' }}>
                <div style={{ fontWeight: '600', color: '#a78bfa', marginBottom: '8px' }}>PTP</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', fontSize: '0.8rem' }}>
                  <div style={{ padding: '4px', background: '#f8fafc', borderRadius: '4px' }}>
                    <div style={{ fontSize: '0.6rem', color: '#64748b' }}>Type</div>
                    <div>{selectedPacket.ptp.msgType}</div>
                  </div>
                  <div style={{ padding: '4px', background: '#f8fafc', borderRadius: '4px' }}>
                    <div style={{ fontSize: '0.6rem', color: '#64748b' }}>Seq</div>
                    <div>{selectedPacket.ptp.sequenceId}</div>
                  </div>
                  <div style={{ padding: '4px', background: '#f8fafc', borderRadius: '4px' }}>
                    <div style={{ fontSize: '0.6rem', color: '#64748b' }}>Domain</div>
                    <div>{selectedPacket.ptp.domain}</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="card">
            <h3 style={{ fontSize: '0.9rem', marginBottom: '12px' }}>Hex ({selectedPacket.length} bytes)</h3>
            <div style={{
              fontFamily: 'monospace', fontSize: '0.68rem',
              background: '#1e293b', color: '#e2e8f0',
              padding: '10px', borderRadius: '6px',
              overflow: 'auto', maxHeight: '200px'
            }}>
              {formatHexDump(selectedPacket.hex, selectedPacket.ascii).map((line, i) => (
                <div key={i} style={{ display: 'flex', gap: '10px' }}>
                  <span style={{ color: '#64748b' }}>{line.offset}</span>
                  <span style={{ color: '#60a5fa' }}>{line.hex}</span>
                  <span style={{ color: '#4ade80' }}>{line.ascii}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Capture
