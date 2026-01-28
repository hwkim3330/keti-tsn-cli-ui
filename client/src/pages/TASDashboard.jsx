import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import axios from 'axios'
import { useDevices } from '../contexts/DeviceContext'

const TAP_INTERFACE = 'enxc84d44231cc2'
const TRAFFIC_INTERFACE_PREFIX = 'enx00e'
const BOARD1_PORT8_MAC = 'E6:F4:41:C9:57:08'  // TAS 설정된 포트
const BOARD2_PORT8_MAC = 'FA:AE:C9:26:A4:08'  // TAS 없는 포트
const TX_SOURCE_MAC = '00:e0:4c:68:13:36'
const TRAFFIC_API = 'http://localhost:3001'

const colors = {
  text: '#1e293b',
  textMuted: '#64748b',
  textLight: '#94a3b8',
  bg: '#f8fafc',
  bgAlt: '#f1f5f9',
  border: '#e2e8f0',
  accent: '#475569',
  success: '#059669',
  warning: '#d97706',
  error: '#dc2626',
}

const tcColors = {
  0: '#94a3b8', 1: '#f97316', 2: '#eab308', 3: '#22c55e',
  4: '#06b6d4', 5: '#3b82f6', 6: '#8b5cf6', 7: '#ec4899',
}

const tcNames = ['BE(BG)', 'BE', 'EE', 'CA', 'Video', 'Voice', 'IC', 'NC']

function TASDashboard() {
  const { devices } = useDevices()

  const [tasData, setTasData] = useState({})
  const [loading, setLoading] = useState(false)
  const [autoSetupStatus, setAutoSetupStatus] = useState(null)
  const [autoSetupMessage, setAutoSetupMessage] = useState('')

  const [trafficInterface, setTrafficInterface] = useState(null)
  const [trafficRunning, setTrafficRunning] = useState(false)
  const [selectedTCs, setSelectedTCs] = useState([0, 1, 2, 3, 4, 5, 6, 7])  // TC0 included (CBS 설정 필요)
  const [vlanId, setVlanId] = useState(100)
  const [packetsPerSecond, setPacketsPerSecond] = useState(100)
  const [duration, setDuration] = useState(7)

  const [capturing, setCapturing] = useState(false)
  const [tapConnected, setTapConnected] = useState(false)
  const [capturedPackets, setCapturedPackets] = useState([])
  const wsRef = useRef(null)
  const startTimeRef = useRef(null)

  const board1 = devices.find(d => d.name?.includes('#1') || d.device?.includes('ACM0'))
  const board2 = devices.find(d => d.name?.includes('#2') || d.device?.includes('ACM1'))
  const TAS_PORT = 8
  const tasBoard = board1 || board2  // Board 1 우선 (Port 9 UP인 보드)

  const getBasePath = (port) => `/ietf-interfaces:interfaces/interface[name='${port}']/ieee802-dot1q-bridge:bridge-port/ieee802-dot1q-sched-bridge:gate-parameter-table`

  // Fetch TAS status
  const fetchTASStatus = async () => {
    if (!tasBoard) return
    setLoading(true)
    try {
      const basePath = getBasePath(TAS_PORT)
      const res = await axios.post('/api/fetch', {
        paths: [basePath],
        transport: tasBoard.transport || 'serial',
        device: tasBoard.device,
        host: tasBoard.host,
        port: tasBoard.port || 5683
      }, { timeout: 15000 })

      const yaml = res.data?.result || ''
      const status = {
        gateEnabled: false,
        adminGateStates: 255,
        cycleTimeNs: 0,
        cycleTimeExtensionNs: 0,  // Guard band
        tickGranularity: 0,
        adminControlList: [],
        online: true
      }

      status.gateEnabled = /gate-enabled:\s*true/.test(yaml)

      const gsMatch = yaml.match(/admin-gate-states:\s*(\d+)/)
      if (gsMatch) status.adminGateStates = parseInt(gsMatch[1])

      const cycleMatch = yaml.match(/admin-cycle-time:[\s\S]*?numerator:\s*(\d+)/)
      if (cycleMatch) status.cycleTimeNs = parseInt(cycleMatch[1])

      // Parse cycle-time-extension (guard band)
      const extMatch = yaml.match(/admin-cycle-time-extension:\s*(\d+)/)
      if (extMatch) status.cycleTimeExtensionNs = parseInt(extMatch[1])

      // Parse tick-granularity
      const tickMatch = yaml.match(/tick-granularity:\s*(\d+)/)
      if (tickMatch) status.tickGranularity = parseInt(tickMatch[1])

      const adminListMatch = yaml.match(/admin-control-list:[\s\S]*?gate-control-entry:([\s\S]*?)(?=oper-|$)/)
      if (adminListMatch) {
        const listContent = adminListMatch[1]
        const entries = []
        const entryMatches = listContent.matchAll(/gate-states-value:\s*(\d+)[\s\S]*?time-interval-value:\s*(\d+)/g)
        for (const m of entryMatches) {
          entries.push({ gateStates: parseInt(m[1]), timeInterval: parseInt(m[2]) })
        }
        status.adminControlList = entries
      }

      setTasData(status)
    } catch {
      setTasData({ online: false, error: 'Connection failed' })
    }
    setLoading(false)
  }

  // Auto Setup TAS
  const autoSetupTAS = async () => {
    if (!tasBoard) return
    setAutoSetupStatus('running')
    setAutoSetupMessage('Configuring TAS...')
    try {
      const basePath = getBasePath(TAS_PORT)
      // TC0 항상 열림, TC1~7 순서대로 100ms씩
      const gclEntries = []
      for (let i = 1; i <= 7; i++) {
        gclEntries.push({
          index: i - 1,
          'operation-name': 'ieee802-dot1q-sched:set-gate-states',
          'time-interval-value': 100000000,  // 100ms
          'gate-states-value': (1 << i) | 1  // TC0 + TCi
        })
      }
      const patches = [
        { path: `${basePath}/gate-enabled`, value: true },
        { path: `${basePath}/admin-gate-states`, value: 255 },
        { path: `${basePath}/admin-control-list/gate-control-entry`, value: gclEntries },
        { path: `${basePath}/admin-cycle-time/numerator`, value: 700000000 },  // 700ms cycle
        { path: `${basePath}/admin-cycle-time/denominator`, value: 1 },
      ]
      await axios.post('/api/patch', { patches, transport: tasBoard.transport, device: tasBoard.device, host: tasBoard.host }, { timeout: 30000 })
      await axios.post('/api/patch', { patches: [{ path: `${basePath}/config-change`, value: true }], transport: tasBoard.transport, device: tasBoard.device, host: tasBoard.host }, { timeout: 10000 })
      setAutoSetupStatus('success')
      setAutoSetupMessage('TAS configured!')
      setTimeout(() => { fetchTASStatus(); setAutoSetupStatus(null) }, 1500)
    } catch (err) {
      setAutoSetupStatus('error')
      setAutoSetupMessage(`Failed: ${err.message}`)
    }
  }

  const resetTAS = async () => {
    if (!tasBoard) return
    setAutoSetupStatus('running')
    try {
      await axios.post('/api/patch', {
        patches: [{ path: `${getBasePath(TAS_PORT)}/gate-enabled`, value: false }],
        transport: tasBoard.transport, device: tasBoard.device, host: tasBoard.host
      }, { timeout: 15000 })
      setAutoSetupStatus('success')
      setAutoSetupMessage('TAS disabled')
      setTimeout(() => { fetchTASStatus(); setAutoSetupStatus(null) }, 1500)
    } catch (err) {
      setAutoSetupStatus('error')
      setAutoSetupMessage(`Failed: ${err.message}`)
    }
  }

  // Auto-fetch TAS status when board is available
  useEffect(() => {
    if (!tasBoard) return
    const loadStatus = async () => {
      setLoading(true)
      try {
        const basePath = getBasePath(TAS_PORT)
        const res = await axios.post('/api/fetch', {
          paths: [basePath],
          transport: tasBoard.transport || 'serial',
          device: tasBoard.device,
          host: tasBoard.host,
          port: tasBoard.port || 5683
        }, { timeout: 15000 })

        const yaml = res.data?.result || ''
        const status = {
          gateEnabled: false,
          adminGateStates: 255,
          cycleTimeNs: 0,
          cycleTimeExtensionNs: 0,
          tickGranularity: 0,
          adminControlList: [],
          online: true
        }

        // Parse gate-enabled
        status.gateEnabled = /gate-enabled:\s*true/.test(yaml)

        // Parse admin-gate-states
        const gsMatch = yaml.match(/admin-gate-states:\s*(\d+)/)
        if (gsMatch) status.adminGateStates = parseInt(gsMatch[1])

        // Parse admin-cycle-time numerator
        const cycleMatch = yaml.match(/admin-cycle-time:[\s\S]*?numerator:\s*(\d+)/)
        if (cycleMatch) status.cycleTimeNs = parseInt(cycleMatch[1])

        // Parse cycle-time-extension (guard band)
        const extMatch = yaml.match(/admin-cycle-time-extension:\s*(\d+)/)
        if (extMatch) status.cycleTimeExtensionNs = parseInt(extMatch[1])

        // Parse tick-granularity
        const tickMatch = yaml.match(/tick-granularity:\s*(\d+)/)
        if (tickMatch) status.tickGranularity = parseInt(tickMatch[1])

        // Parse admin-control-list entries
        const adminListMatch = yaml.match(/admin-control-list:[\s\S]*?gate-control-entry:([\s\S]*?)(?=oper-|$)/)
        if (adminListMatch) {
          const listContent = adminListMatch[1]
          const entries = []
          const entryMatches = listContent.matchAll(/gate-states-value:\s*(\d+)[\s\S]*?time-interval-value:\s*(\d+)/g)
          for (const m of entryMatches) {
            entries.push({ gateStates: parseInt(m[1]), timeInterval: parseInt(m[2]) })
          }
          status.adminControlList = entries
        }

        setTasData(status)
      } catch {
        setTasData({ online: false, error: 'Connection failed' })
      }
      setLoading(false)
    }
    loadStatus()
  }, [tasBoard])

  // Fetch interfaces
  useEffect(() => {
    axios.get(`${TRAFFIC_API}/api/traffic/interfaces`).then(res => {
      const iface = res.data.find(i => i.name.startsWith(TRAFFIC_INTERFACE_PREFIX))
      if (iface) setTrafficInterface(iface.name)
    }).catch(() => {})
  }, [])

  // WebSocket for capture
  useEffect(() => {
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/capture`
    const connect = () => {
      const ws = new WebSocket(wsUrl)
      ws.onopen = () => setTapConnected(true)
      ws.onclose = () => { setTapConnected(false); setTimeout(connect, 3000) }
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'packet') handlePacket(msg.data)
          else if (msg.type === 'stopped') setCapturing(false)
        } catch {}
      }
      wsRef.current = ws
    }
    connect()
    return () => wsRef.current?.close()
  }, [])

  const handlePacket = useCallback((packet) => {
    if (packet.protocol === 'PTP') return
    if (packet.length < 56 || packet.length > 200) return

    const pcp = packet.vlan?.pcp ?? 0
    const hasVlan = !!packet.vlan
    const vid = packet.vlan?.vid || 0
    const srcMac = (packet.srcMac || packet.source || '').toLowerCase().replace(/[:-]/g, '')
    const isTx = packet.interface?.startsWith(TRAFFIC_INTERFACE_PREFIX)
    const isRx = packet.interface === TAP_INTERFACE

    // RX: only count VLAN packets (temporarily disabled strict filtering for debug)
    if (isRx && !hasVlan) return

    if (isTx || isRx) {
      // Use high-resolution capture timestamp if available (nanoseconds)
      // Convert to milliseconds for consistency with Date.now()
      let captureTimeMs = Date.now()
      try {
        if (packet.captureNs) {
          captureTimeMs = Number(BigInt(packet.captureNs) / 1000000n)
        }
      } catch {
        // Fallback to Date.now() if BigInt conversion fails
      }

      setCapturedPackets(prev => [...prev, {
        time: captureTimeMs,
        timeNs: packet.captureNs,  // Keep original nanosecond precision
        pcp,
        length: packet.length,
        vid,
        hasVlan,
        src: packet.srcMac || packet.source,
        dst: packet.dstMac || packet.destination,
        direction: isTx ? 'TX' : 'RX'
      }].slice(-1000))
    }
  }, [vlanId])

  const startTest = async () => {
    if (!trafficInterface || selectedTCs.length === 0) return
    setCapturedPackets([])
    startTimeRef.current = Date.now()

    try {
      await axios.post('/api/capture/start', {
        interfaces: [trafficInterface, TAP_INTERFACE],
        captureMode: 'all'
      })
      setCapturing(true)
    } catch {}

    setTrafficRunning(true)
    try {
      // Use precision C sender for accurate timing
      await axios.post(`${TRAFFIC_API}/api/traffic/start-precision`, {
        interface: trafficInterface,
        dstMac: BOARD2_PORT8_MAC,  // Board 2로 전송 (Board 1 Port 8 egress에서 TAS 적용)
        vlanId,
        tcList: selectedTCs,
        packetsPerSecond,
        duration
      })
    } catch (err) {
      console.error('Failed to start precision traffic:', err)
      setTrafficRunning(false)
    }

    setTimeout(stopTest, (duration + 2) * 1000)
  }

  const stopTest = async () => {
    setTrafficRunning(false)
    try { await axios.post(`${TRAFFIC_API}/api/traffic/stop-precision`, {}) } catch {}
    try { await axios.post('/api/capture/stop', {}); setCapturing(false) } catch {}
  }

  const toggleTC = (tc) => setSelectedTCs(prev => prev.includes(tc) ? prev.filter(t => t !== tc) : [...prev, tc].sort())

  // Stats
  const txPackets = capturedPackets.filter(p => p.direction === 'TX')
  const rxPackets = capturedPackets.filter(p => p.direction === 'RX')
  const txByTc = {}
  const rxByTc = {}
  txPackets.forEach(p => { if (p.hasVlan) txByTc[p.pcp] = (txByTc[p.pcp] || 0) + 1 })
  rxPackets.forEach(p => { if (p.hasVlan) rxByTc[p.pcp] = (rxByTc[p.pcp] || 0) + 1 })

  // GCL Analysis - analyze RX packets to estimate gate schedule
  const cycleTimeMs = tasData.cycleTimeNs ? tasData.cycleTimeNs / 1000000 : 700
  const guardBandMs = tasData.cycleTimeExtensionNs ? tasData.cycleTimeExtensionNs / 1000000 : 0
  const numSlots = tasData.adminControlList?.length || 7

  // Calculate actual slot times and start positions from config
  const slotTimes = useMemo(() => {
    const slots = []
    let startMs = 0
    if (tasData.adminControlList?.length > 0) {
      tasData.adminControlList.forEach((entry, idx) => {
        const durationMs = entry.timeInterval / 1000000  // ns to ms
        slots.push({
          index: idx,
          startMs,
          endMs: startMs + durationMs,
          durationMs,
          gateStates: entry.gateStates
        })
        startMs += durationMs
      })
      // TC7 (last slot) gets guard band extra time
      if (slots.length > 0) {
        slots[slots.length - 1].endMs += guardBandMs
        slots[slots.length - 1].durationMs += guardBandMs
        slots[slots.length - 1].hasGuardBand = true
      }
    } else {
      // Default: equal slots
      const defaultSlotMs = cycleTimeMs / 7
      for (let i = 0; i < 7; i++) {
        slots.push({
          index: i,
          startMs: i * defaultSlotMs,
          endMs: (i + 1) * defaultSlotMs + (i === 6 ? guardBandMs : 0),
          durationMs: defaultSlotMs + (i === 6 ? guardBandMs : 0),
          gateStates: (1 << (i + 1)) | 1,  // TC0 + TCx
          hasGuardBand: i === 6
        })
      }
    }
    return slots
  }, [tasData.adminControlList, cycleTimeMs, guardBandMs])

  const slotTimeMs = cycleTimeMs / numSlots  // Average for backward compat

  // Calculate slot distribution for each TC with auto offset correction
  const gclAnalysis = useMemo(() => {
    if (rxPackets.length < 5) return null
    // Include TC0-7 (TC0 is always open, TC7 has slack time after last slot)
    const vlanPackets = rxPackets.filter(p => p.hasVlan && p.pcp >= 0 && p.pcp <= 7)
    if (vlanPackets.length < 5) return null

    const firstTime = vlanPackets[0]?.time || 0

    // Try different offsets to find best alignment with expected GCL
    // Expected: TC1 in slot0, TC2 in slot1, ..., TC7 in slot6
    // TC0 is always open (no expected slot)
    // TC7 has slack time - can overflow to slot0 of next cycle
    let bestOffset = 0
    let bestScore = 0
    const searchStep = Math.max(1, slotTimeMs / 20)  // 5ms for 100ms slots

    // Helper function for slot calculation using actual slot boundaries
    const getSlot = (relTime) => {
      const cyclePos = ((relTime % cycleTimeMs) + cycleTimeMs) % cycleTimeMs
      // Use actual slot boundaries from config
      for (let i = 0; i < slotTimes.length; i++) {
        if (cyclePos >= slotTimes[i].startMs && cyclePos < slotTimes[i].endMs) {
          return i
        }
      }
      return Math.max(0, slotTimes.length - 1)  // Default to last slot
    }

    // Score function considering TC0 (always open) and TC7 (slack time)
    const calcScore = (offsetMs) => {
      let score = 0
      let penalty = 0
      vlanPackets.forEach(p => {
        const relTime = p.time - firstTime + offsetMs
        const slot = getSlot(relTime)

        if (p.pcp === 0) {
          // TC0 is always open - any slot is valid, small bonus
          score += 0.5
        } else {
          const expectedSlot = p.pcp - 1
          if (slot === expectedSlot) {
            score += 2  // Correct slot: +2
          } else if (p.pcp === 7 && slot === 0) {
            // TC7 slack: slot0 (next cycle start) is acceptable
            score += 1  // Partial credit for TC7 overflow
          } else {
            // Wrong slot: penalty based on distance
            const dist = Math.min(Math.abs(slot - expectedSlot), numSlots - Math.abs(slot - expectedSlot))
            penalty += dist * 0.5
          }
        }
      })
      return score - penalty
    }

    for (let offsetMs = 0; offsetMs < cycleTimeMs; offsetMs += searchStep) {
      const netScore = calcScore(offsetMs)
      if (netScore > bestScore) {
        bestScore = netScore
        bestOffset = offsetMs
      }
    }

    // Fine-tune offset with 1ms precision around best offset
    const fineStart = Math.max(0, bestOffset - searchStep)
    const fineEnd = Math.min(cycleTimeMs - 1, bestOffset + searchStep)
    for (let offsetMs = fineStart; offsetMs <= fineEnd; offsetMs += 1) {
      const netScore = calcScore(offsetMs)
      if (netScore > bestScore) {
        bestScore = netScore
        bestOffset = offsetMs
      }
    }

    // Calculate slot hits with best offset
    const slotHits = {}
    for (let i = 0; i < numSlots; i++) {
      slotHits[i] = {}
      for (let tc = 0; tc < 8; tc++) slotHits[i][tc] = 0
    }

    // Also track per-cycle data for analysis
    const cycleData = []
    let lastCycle = -1

    vlanPackets.forEach(p => {
      const relTime = p.time - firstTime + bestOffset
      const slot = getSlot(relTime)
      const cyclePos = ((relTime % cycleTimeMs) + cycleTimeMs) % cycleTimeMs
      const cycleNum = Math.floor(relTime / cycleTimeMs)

      if (slotHits[slot]) {
        slotHits[slot][p.pcp] = (slotHits[slot][p.pcp] || 0) + 1
      }

      // Track cycle data
      if (cycleNum !== lastCycle) {
        cycleData.push({ cycle: cycleNum, packets: [] })
        lastCycle = cycleNum
      }
      if (cycleData.length > 0) {
        cycleData[cycleData.length - 1].packets.push({ tc: p.pcp, slot, cyclePos })
      }
    })

    // Find max for normalization
    let maxHits = 1
    for (let i = 0; i < numSlots; i++) {
      for (let tc = 0; tc < 8; tc++) {
        if (slotHits[i][tc] > maxHits) maxHits = slotHits[i][tc]
      }
    }

    // Calculate accuracy - TC0 excluded (always open), TC7 allows slot0 overflow
    let correctCount = 0
    let nearCorrectCount = 0  // ±1 slot
    let totalCount = 0
    let tc0Count = 0  // TC0 is always open, track separately
    for (let i = 0; i < numSlots; i++) {
      // TC0: always open, count all hits
      tc0Count += slotHits[i][0] || 0

      // TC1-7: check expected slots
      for (let tc = 1; tc <= 7; tc++) {
        const hits = slotHits[i][tc] || 0
        totalCount += hits
        const expectedSlot = tc - 1

        if (i === expectedSlot) {
          correctCount += hits
        } else if (tc === 7 && i === 0) {
          // TC7 slack: slot0 (next cycle) counts as correct
          correctCount += hits
        } else if (Math.abs(i - expectedSlot) === 1 || Math.abs(i - expectedSlot) === numSlots - 1) {
          nearCorrectCount += hits
        }
      }
    }
    const accuracy = totalCount > 0 ? (correctCount / totalCount * 100) : 0
    const nearAccuracy = totalCount > 0 ? ((correctCount + nearCorrectCount) / totalCount * 100) : 0

    // Calculate jitter from expected slot position using actual slot times
    const slotJitters = {}
    // TC0: jitter not meaningful (always open)
    slotJitters[0] = null

    for (let tc = 1; tc <= 7; tc++) {
      const expectedSlot = tc - 1
      // Use actual slot start time from config
      const expectedStartMs = slotTimes[expectedSlot]?.startMs ?? (expectedSlot * slotTimeMs)
      const expectedEndMs = slotTimes[expectedSlot]?.endMs ?? ((expectedSlot + 1) * slotTimeMs)
      const tcPackets = vlanPackets.filter(p => p.pcp === tc)
      if (tcPackets.length > 0) {
        const deviations = tcPackets.map(p => {
          const relTime = p.time - firstTime + bestOffset
          let cyclePos = ((relTime % cycleTimeMs) + cycleTimeMs) % cycleTimeMs

          // TC7: if in slot0 area, consider it as end of cycle (guard band overflow)
          if (tc === 7 && cyclePos < slotTimes[0]?.endMs) {
            cyclePos += cycleTimeMs  // Treat as overflow
          }

          // Distance from expected slot start (0 if within slot)
          if (cyclePos >= expectedStartMs && cyclePos < expectedEndMs) {
            return 0  // Within expected slot - no deviation
          }
          return Math.min(
            Math.abs(cyclePos - expectedStartMs),
            Math.abs(cyclePos - expectedEndMs)
          )
        })
        const avgDev = deviations.reduce((a, b) => a + b, 0) / deviations.length
        slotJitters[tc] = avgDev
      }
    }

    return {
      slotHits,
      maxHits,
      bestOffset,
      accuracy,
      nearAccuracy,
      totalPackets: vlanPackets.length,
      tc0Count,  // TC0는 항상 열림
      cycleCount: cycleData.length,
      slotJitters
    }
  }, [rxPackets, cycleTimeMs, numSlots, slotTimeMs, slotTimes])

  const cellStyle = { padding: '6px 10px', borderBottom: `1px solid ${colors.border}`, fontSize: '0.75rem' }
  const headerStyle = { ...cellStyle, fontWeight: '600', background: colors.bgAlt }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">TAS Dashboard</h1>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {autoSetupStatus && (
            <span style={{ fontSize: '0.7rem', padding: '4px 8px', borderRadius: '4px', background: autoSetupStatus === 'success' ? '#dcfce7' : autoSetupStatus === 'error' ? '#fef2f2' : colors.bgAlt }}>
              {autoSetupMessage}
            </span>
          )}
          <button className="btn btn-secondary" onClick={fetchTASStatus} disabled={loading}>{loading ? '...' : 'Refresh'}</button>
          <button className="btn btn-primary" onClick={autoSetupTAS} disabled={!tasBoard}>Auto Setup</button>
          <button className="btn btn-secondary" onClick={resetTAS} disabled={!tasBoard}>Reset</button>
        </div>
      </div>

      {/* TAS Config Table + Test Controls */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
        {/* TAS Configuration - 8x8 Matrix */}
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">TAS Configuration</h2>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ fontSize: '0.65rem', padding: '2px 6px', background: colors.bgAlt, borderRadius: '4px', color: colors.text, fontWeight: '600' }}>
                {tasBoard?.name || '-'} ({tasBoard?.device || '-'}) Port {TAS_PORT}
              </span>
              <span style={{ fontSize: '0.65rem', color: tasData.gateEnabled ? colors.success : colors.textLight, fontWeight: '600' }}>
                {tasData.gateEnabled ? '● ON' : '○ OFF'}
              </span>
            </div>
          </div>

          {/* Gate Control Matrix */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.7rem', fontFamily: 'monospace' }}>
              <thead>
                <tr>
                  <th style={{ ...headerStyle, width: '50px', textAlign: 'center' }}>Slot</th>
                  {[0,1,2,3,4,5,6,7].map(tc => (
                    <th key={tc} style={{ ...headerStyle, width: '40px', textAlign: 'center', background: tcColors[tc], color: '#fff' }}>
                      TC{tc}
                    </th>
                  ))}
                  <th style={{ ...headerStyle, textAlign: 'center' }}>Time</th>
                </tr>
              </thead>
              <tbody>
                {tasData.adminControlList?.length > 0 ? (
                  tasData.adminControlList.map((entry, idx) => (
                    <tr key={idx}>
                      <td style={{ ...cellStyle, textAlign: 'center', fontWeight: '600' }}>#{idx}</td>
                      {[0,1,2,3,4,5,6,7].map(tc => {
                        const isOpen = (entry.gateStates >> tc) & 1
                        return (
                          <td key={tc} style={{ ...cellStyle, textAlign: 'center', background: isOpen ? '#dcfce7' : '#fef2f2' }}>
                            {isOpen ? '●' : '○'}
                          </td>
                        )
                      })}
                      <td style={{ ...cellStyle, textAlign: 'center', color: colors.textMuted }}>
                        {entry.timeInterval >= 1000000
                          ? `${(entry.timeInterval / 1000000).toFixed(0)}ms`
                          : `${(entry.timeInterval / 1000).toFixed(0)}μs`}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td style={{ ...cellStyle, textAlign: 'center' }}>-</td>
                    {[0,1,2,3,4,5,6,7].map(tc => (
                      <td key={tc} style={{ ...cellStyle, textAlign: 'center', background: '#dcfce7' }}>●</td>
                    ))}
                    <td style={{ ...cellStyle, textAlign: 'center', color: colors.textMuted }}>All Open</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Cycle Info */}
          <div style={{ display: 'flex', gap: '16px', marginTop: '8px', fontSize: '0.7rem', color: colors.textMuted, flexWrap: 'wrap' }}>
            <span>Cycle: {tasData.cycleTimeNs
              ? (tasData.cycleTimeNs >= 1000000
                  ? `${(tasData.cycleTimeNs / 1000000).toFixed(0)}ms`
                  : `${(tasData.cycleTimeNs / 1000).toFixed(0)}μs`)
              : '-'}</span>
            <span>Entries: {tasData.adminControlList?.length || 0}</span>
            {tasData.cycleTimeExtensionNs > 0 && (
              <span style={{ color: colors.accent }}>Guard Band: {tasData.cycleTimeExtensionNs}ns</span>
            )}
            <span>TC0: Always Open</span>
          </div>
        </div>

        {/* Test Controls */}
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Traffic Test</h2>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', fontSize: '0.7rem' }}>
            <div style={{ flex: 1, padding: '6px', background: trafficInterface ? '#ecfdf5' : '#fef2f2', borderRadius: '4px' }}>
              TX: {trafficInterface || 'N/A'}
            </div>
            <div style={{ flex: 1, padding: '6px', background: tapConnected ? '#ecfdf5' : '#fef2f2', borderRadius: '4px' }}>
              RX: {TAP_INTERFACE}
            </div>
          </div>

          <div style={{ marginBottom: '10px' }}>
            <div style={{ fontSize: '0.65rem', color: colors.textMuted, marginBottom: '4px' }}>Traffic Classes:</div>
            <div style={{ display: 'flex', gap: '4px' }}>
              {[0,1,2,3,4,5,6,7].map(tc => (
                <button key={tc} onClick={() => !trafficRunning && toggleTC(tc)} disabled={trafficRunning}
                  style={{ padding: '4px 8px', borderRadius: '4px', border: 'none', background: selectedTCs.includes(tc) ? tcColors[tc] : colors.bgAlt, color: selectedTCs.includes(tc) ? '#fff' : colors.textMuted, fontSize: '0.7rem', fontWeight: '600', cursor: trafficRunning ? 'not-allowed' : 'pointer' }}>
                  TC{tc}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '10px', fontSize: '0.7rem' }}>
            <div>
              <div style={{ color: colors.textMuted, marginBottom: '2px' }}>VLAN</div>
              <input type="number" value={vlanId} onChange={e => setVlanId(parseInt(e.target.value) || 0)} disabled={trafficRunning} style={{ width: '100%', padding: '4px', borderRadius: '4px', border: `1px solid ${colors.border}` }} />
            </div>
            <div>
              <div style={{ color: colors.textMuted, marginBottom: '2px' }}>PPS</div>
              <input type="number" value={packetsPerSecond} onChange={e => setPacketsPerSecond(parseInt(e.target.value) || 1)} disabled={trafficRunning} style={{ width: '100%', padding: '4px', borderRadius: '4px', border: `1px solid ${colors.border}` }} />
            </div>
            <div>
              <div style={{ color: colors.textMuted, marginBottom: '2px' }}>Duration</div>
              <input type="number" value={duration} onChange={e => setDuration(parseInt(e.target.value) || 10)} disabled={trafficRunning} style={{ width: '100%', padding: '4px', borderRadius: '4px', border: `1px solid ${colors.border}` }} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            {!trafficRunning ? (
              <button className="btn btn-primary" onClick={startTest} disabled={!trafficInterface || !tapConnected} style={{ flex: 1 }}>Start Test</button>
            ) : (
              <button className="btn" onClick={stopTest} style={{ flex: 1, background: '#fef2f2', color: colors.error }}>Stop</button>
            )}
            <button className="btn btn-secondary" onClick={() => setCapturedPackets([])}>Clear</button>
          </div>

          {/* Stats - Per TC */}
          <div style={{ marginTop: '10px' }}>
            <div style={{ fontSize: '0.65rem', color: colors.textMuted, marginBottom: '4px' }}>TX / RX per TC:</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '4px', fontSize: '0.65rem' }}>
              {[0,1,2,3,4,5,6,7].map(tc => {
                const tx = txByTc[tc] || 0
                const rx = rxByTc[tc] || 0
                const pass = tx > 0 ? ((rx / tx) * 100).toFixed(0) : '-'
                return (
                  <div key={tc} style={{ padding: '4px', background: colors.bgAlt, borderRadius: '4px', textAlign: 'center', borderTop: `3px solid ${tcColors[tc]}` }}>
                    <div style={{ fontWeight: '700', color: tcColors[tc] }}>TC{tc}</div>
                    <div style={{ color: '#3b82f6' }}>{tx}</div>
                    <div style={{ color: '#22c55e' }}>{rx}</div>
                    <div style={{ color: tx > 0 && rx === 0 ? colors.error : (pass === '100' ? colors.success : colors.warning), fontWeight: '600' }}>
                      {tx > 0 ? `${pass}%` : '-'}
                    </div>
                  </div>
                )
              })}
            </div>
            <div style={{ display: 'flex', gap: '16px', marginTop: '6px', fontSize: '0.65rem', color: colors.textMuted }}>
              <span>Total TX: <b style={{ color: '#3b82f6' }}>{txPackets.length}</b></span>
              <span>Total RX: <b style={{ color: '#22c55e' }}>{rxPackets.length}</b></span>
              <span>Pass: <b style={{ color: txPackets.length > 0 ? (rxPackets.length / txPackets.length > 0.9 ? colors.success : colors.warning) : colors.textMuted }}>
                {txPackets.length > 0 ? `${((rxPackets.length / txPackets.length) * 100).toFixed(0)}%` : '-'}
              </b></span>
            </div>
          </div>
        </div>
      </div>

      {/* Packet Timeline */}
      {capturedPackets.length > 0 && (
        <div className="card" style={{ marginBottom: '16px' }}>
          <div className="card-header">
            <h2 className="card-title">Packet Timeline</h2>
            <span style={{ fontSize: '0.7rem', color: colors.textMuted }}>TX: {txPackets.length} | RX: {rxPackets.length}</span>
          </div>

          {/* Timeline Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            {/* TX Timeline */}
            <div>
              <div style={{ fontSize: '0.65rem', color: colors.textMuted, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ background: '#3b82f6', color: '#fff', padding: '1px 6px', borderRadius: '3px', fontWeight: '600' }}>TX</span>
                송신
              </div>
              <div style={{ background: colors.bgAlt, borderRadius: '4px', padding: '8px' }}>
                <div style={{ display: 'flex' }}>
                  <div style={{ width: '30px' }}>
                    {[7,6,5,4,3,2,1,0].map(tc => (
                      <div key={tc} style={{ height: '14px', fontSize: '0.5rem', color: tcColors[tc], fontWeight: '600', textAlign: 'right', paddingRight: '4px' }}>TC{tc}</div>
                    ))}
                  </div>
                  <div style={{ flex: 1, position: 'relative', height: '112px', background: '#fff', border: `1px solid ${colors.border}`, borderRadius: '4px', overflow: 'hidden' }}>
                    {(() => {
                      const pkts = txPackets.filter(p => p.hasVlan).slice(-400)
                      if (pkts.length === 0) return <div style={{ padding: '20px', textAlign: 'center', color: colors.textLight, fontSize: '0.7rem' }}>No TX</div>
                      const minT = pkts[0]?.time || 0
                      const maxT = pkts[pkts.length - 1]?.time || 1
                      const range = Math.max(maxT - minT, 1)
                      return pkts.map((p, i) => (
                        <div key={i} style={{ position: 'absolute', left: `${((p.time - minT) / range) * 100}%`, top: `${(7 - p.pcp) * 14}px`, width: '2px', height: '12px', background: tcColors[p.pcp], opacity: 0.8 }} />
                      ))
                    })()}
                  </div>
                </div>
                {/* Time axis */}
                {txPackets.length > 0 && (() => {
                  const pkts = txPackets.filter(p => p.hasVlan)
                  if (pkts.length === 0) return null
                  const dur = ((pkts[pkts.length - 1]?.time || 0) - (pkts[0]?.time || 0)) / 1000
                  return (
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginLeft: '30px', marginTop: '4px', fontSize: '0.55rem', color: colors.textMuted }}>
                      <span>0s</span><span>{(dur/2).toFixed(1)}s</span><span>{dur.toFixed(1)}s</span>
                    </div>
                  )
                })()}
              </div>
            </div>

            {/* RX Timeline */}
            <div>
              <div style={{ fontSize: '0.65rem', color: colors.textMuted, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ background: '#22c55e', color: '#fff', padding: '1px 6px', borderRadius: '3px', fontWeight: '600' }}>RX</span>
                수신
              </div>
              <div style={{ background: colors.bgAlt, borderRadius: '4px', padding: '8px' }}>
                <div style={{ display: 'flex' }}>
                  <div style={{ width: '30px' }}>
                    {[7,6,5,4,3,2,1,0].map(tc => (
                      <div key={tc} style={{ height: '14px', fontSize: '0.5rem', color: tcColors[tc], fontWeight: '600', textAlign: 'right', paddingRight: '4px' }}>TC{tc}</div>
                    ))}
                  </div>
                  <div style={{ flex: 1, position: 'relative', height: '112px', background: '#fff', border: `1px solid ${colors.border}`, borderRadius: '4px', overflow: 'hidden' }}>
                    {(() => {
                      const pkts = rxPackets.filter(p => p.hasVlan).slice(-400)
                      if (pkts.length === 0) return <div style={{ padding: '20px', textAlign: 'center', color: colors.textLight, fontSize: '0.7rem' }}>No RX</div>
                      const minT = pkts[0]?.time || 0
                      const maxT = pkts[pkts.length - 1]?.time || 1
                      const range = Math.max(maxT - minT, 1)
                      return pkts.map((p, i) => (
                        <div key={i} style={{ position: 'absolute', left: `${((p.time - minT) / range) * 100}%`, top: `${(7 - p.pcp) * 14}px`, width: '2px', height: '12px', background: tcColors[p.pcp], opacity: 0.8 }} />
                      ))
                    })()}
                  </div>
                </div>
                {/* Time axis */}
                {rxPackets.length > 0 && (() => {
                  const pkts = rxPackets.filter(p => p.hasVlan)
                  if (pkts.length === 0) return null
                  const dur = ((pkts[pkts.length - 1]?.time || 0) - (pkts[0]?.time || 0)) / 1000
                  return (
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginLeft: '30px', marginTop: '4px', fontSize: '0.55rem', color: colors.textMuted }}>
                      <span>0s</span><span>{(dur/2).toFixed(1)}s</span><span>{dur.toFixed(1)}s</span>
                    </div>
                  )
                })()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* GCL Analysis - Estimated Gate Schedule from RX */}
      {gclAnalysis && rxPackets.length > 10 && (
        <div className="card" style={{ marginBottom: '16px' }}>
          <div className="card-header">
            <h2 className="card-title">GCL Analysis (Estimated)</h2>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{
                fontSize: '0.7rem',
                padding: '2px 8px',
                borderRadius: '4px',
                background: gclAnalysis.accuracy >= 80 ? '#dcfce7' : gclAnalysis.accuracy >= 50 ? '#fef3c7' : '#fef2f2',
                color: gclAnalysis.accuracy >= 80 ? colors.success : gclAnalysis.accuracy >= 50 ? colors.warning : colors.error,
                fontWeight: '600'
              }}>
                정확: {gclAnalysis.accuracy.toFixed(1)}%
              </span>
              <span style={{
                fontSize: '0.65rem',
                padding: '2px 6px',
                borderRadius: '4px',
                background: gclAnalysis.nearAccuracy >= 90 ? '#dcfce7' : colors.bgAlt,
                color: gclAnalysis.nearAccuracy >= 90 ? colors.success : colors.textMuted
              }}>
                ±1슬롯: {gclAnalysis.nearAccuracy?.toFixed(1) || '-'}%
              </span>
              <span style={{ fontSize: '0.65rem', color: colors.textMuted }}>
                Offset: {gclAnalysis.bestOffset.toFixed(0)}ms
              </span>
              <span style={{ fontSize: '0.65rem', color: colors.textMuted }}>
                {cycleTimeMs.toFixed(0)}ms×{gclAnalysis.cycleCount || 0} cycles | {gclAnalysis.totalPackets} pkts
              </span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            {/* Estimated GCL Heatmap */}
            <div>
              <div style={{ fontSize: '0.65rem', color: colors.textMuted, marginBottom: '4px' }}>
                Slot별 TC 통과량 (히트맵)
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.6rem', fontFamily: 'monospace' }}>
                  <thead>
                    <tr>
                      <th style={{ ...cellStyle, width: '40px', textAlign: 'center', background: colors.bgAlt }}>Slot</th>
                      {[0,1,2,3,4,5,6,7].map(tc => (
                        <th key={tc} style={{ ...cellStyle, width: '35px', textAlign: 'center', background: tcColors[tc], color: '#fff', padding: '4px' }}>
                          {tc}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: numSlots }, (_, slot) => (
                      <tr key={slot}>
                        <td style={{ ...cellStyle, textAlign: 'center', fontWeight: '600', padding: '4px' }}>#{slot}</td>
                        {[0,1,2,3,4,5,6,7].map(tc => {
                          const hits = gclAnalysis.slotHits[slot]?.[tc] || 0
                          const intensity = hits / gclAnalysis.maxHits
                          const isOpen = tasData.adminControlList?.[slot] ? ((tasData.adminControlList[slot].gateStates >> tc) & 1) : 1
                          return (
                            <td key={tc} style={{
                              ...cellStyle,
                              textAlign: 'center',
                              padding: '4px',
                              background: hits > 0
                                ? `rgba(${isOpen ? '34,197,94' : '239,68,68'}, ${0.2 + intensity * 0.8})`
                                : (isOpen ? '#f0fdf4' : '#fef2f2'),
                              fontWeight: hits > 0 ? '600' : '400',
                              color: hits > 0 ? '#000' : colors.textLight
                            }}>
                              {hits > 0 ? hits : '-'}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Config vs Actual Comparison */}
            <div>
              <div style={{ fontSize: '0.65rem', color: colors.textMuted, marginBottom: '4px' }}>
                설정 vs 실측 비교
              </div>
              <div style={{ background: colors.bgAlt, borderRadius: '4px', padding: '8px' }}>
                {/* TC0 - Always Open */}
                {gclAnalysis.tc0Count > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', fontSize: '0.55rem' }}>
                    <span style={{ padding: '2px 6px', borderRadius: '3px', background: tcColors[0], color: '#fff', fontWeight: '600', minWidth: '28px', textAlign: 'center' }}>
                      TC0
                    </span>
                    <span style={{ fontWeight: '600', color: colors.textMuted }}>항상열림</span>
                    <span style={{ color: colors.textMuted }}>→</span>
                    <span style={{ fontWeight: '600', color: colors.success }}>
                      {gclAnalysis.tc0Count}개
                    </span>
                    <span style={{ fontSize: '0.5rem', color: colors.textMuted }}>
                      (전 슬롯 분산)
                    </span>
                  </div>
                )}
                {/* TC1-7 */}
                {[1,2,3,4,5,6,7].map(tc => {
                  const actualSlots = Object.entries(gclAnalysis.slotHits)
                    .filter(([_, tcs]) => tcs[tc] > 0)
                    .map(([slot]) => parseInt(slot))
                  const mainSlot = actualSlots.reduce((max, slot) =>
                    (gclAnalysis.slotHits[slot][tc] > (gclAnalysis.slotHits[max]?.[tc] || 0)) ? slot : max, actualSlots[0])
                  const jitter = gclAnalysis.slotJitters?.[tc]
                  const totalHits = Object.values(gclAnalysis.slotHits).reduce((s, h) => s + (h[tc] || 0), 0)
                  // TC7: slot0 also counts as correct (overflow to next cycle)
                  const expectedSlot = tc - 1
                  let correctHits = gclAnalysis.slotHits[expectedSlot]?.[tc] || 0
                  if (tc === 7) {
                    correctHits += gclAnalysis.slotHits[0]?.[tc] || 0  // TC7 slack
                  }
                  const tcAccuracy = totalHits > 0 ? (correctHits / totalHits * 100) : 0
                  const isTC7Overflow = tc === 7 && mainSlot === 0

                  return (
                    <div key={tc} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', fontSize: '0.55rem' }}>
                      <span style={{ padding: '2px 6px', borderRadius: '3px', background: tcColors[tc], color: '#fff', fontWeight: '600', minWidth: '28px', textAlign: 'center' }}>
                        TC{tc}
                      </span>
                      <span style={{ fontWeight: '600', minWidth: '18px' }}>#{expectedSlot}</span>
                      <span style={{ color: colors.textMuted }}>→</span>
                      <span style={{ fontWeight: '600', color: (mainSlot === expectedSlot || isTC7Overflow) ? colors.success : colors.warning, minWidth: '18px' }}>
                        {mainSlot !== undefined ? `#${mainSlot}` : '-'}
                        {isTC7Overflow && <span style={{ fontSize: '0.45rem' }}>(여유)</span>}
                      </span>
                      <span style={{
                        padding: '1px 4px',
                        borderRadius: '3px',
                        fontSize: '0.5rem',
                        background: tcAccuracy >= 80 ? '#dcfce7' : tcAccuracy >= 50 ? '#fef3c7' : '#fef2f2',
                        color: tcAccuracy >= 80 ? colors.success : tcAccuracy >= 50 ? colors.warning : colors.error,
                        fontWeight: '600'
                      }}>
                        {tcAccuracy.toFixed(0)}%
                      </span>
                      {jitter !== undefined && (
                        <span style={{ fontSize: '0.5rem', color: colors.textMuted }}>
                          ±{jitter.toFixed(0)}ms
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Packet Capture Log - TX/RX Split */}
      {capturedPackets.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Packet Capture</h2>
            <span style={{ fontSize: '0.7rem', color: colors.textMuted }}>{capturedPackets.length} packets</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            {/* TX Packets */}
            <div>
              <div style={{ fontSize: '0.65rem', color: colors.textMuted, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ background: '#3b82f6', color: '#fff', padding: '1px 6px', borderRadius: '3px', fontWeight: '600' }}>TX</span>
                송신 ({txPackets.length})
              </div>
              <div style={{ maxHeight: '300px', overflowY: 'auto', background: colors.bgAlt, borderRadius: '4px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.65rem', fontFamily: 'monospace' }}>
                  <thead>
                    <tr style={{ background: '#dbeafe', position: 'sticky', top: 0 }}>
                      <th style={{ ...cellStyle, width: '60px' }}>Time</th>
                      <th style={{ ...cellStyle, width: '40px' }}>TC</th>
                      <th style={{ ...cellStyle, width: '40px' }}>Len</th>
                    </tr>
                  </thead>
                  <tbody>
                    {txPackets.slice(-30).reverse().map((pkt, idx) => {
                      const time = startTimeRef.current ? ((pkt.time - startTimeRef.current) / 1000).toFixed(3) : '0.000'
                      return (
                        <tr key={idx} style={{ background: '#eff6ff' }}>
                          <td style={cellStyle}>{time}s</td>
                          <td style={cellStyle}>
                            <span style={{ padding: '1px 4px', borderRadius: '3px', background: tcColors[pkt.pcp], color: '#fff', fontWeight: '600', fontSize: '0.6rem' }}>
                              {pkt.pcp}
                            </span>
                          </td>
                          <td style={cellStyle}>{pkt.length}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* RX Packets */}
            <div>
              <div style={{ fontSize: '0.65rem', color: colors.textMuted, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ background: '#22c55e', color: '#fff', padding: '1px 6px', borderRadius: '3px', fontWeight: '600' }}>RX</span>
                수신 ({rxPackets.length})
              </div>
              <div style={{ maxHeight: '300px', overflowY: 'auto', background: colors.bgAlt, borderRadius: '4px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.65rem', fontFamily: 'monospace' }}>
                  <thead>
                    <tr style={{ background: '#dcfce7', position: 'sticky', top: 0 }}>
                      <th style={{ ...cellStyle, width: '60px' }}>Time</th>
                      <th style={{ ...cellStyle, width: '40px' }}>TC</th>
                      <th style={{ ...cellStyle, width: '40px' }}>Len</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rxPackets.slice(-30).reverse().map((pkt, idx) => {
                      const time = startTimeRef.current ? ((pkt.time - startTimeRef.current) / 1000).toFixed(3) : '0.000'
                      return (
                        <tr key={idx} style={{ background: '#f0fdf4' }}>
                          <td style={cellStyle}>{time}s</td>
                          <td style={cellStyle}>
                            <span style={{ padding: '1px 4px', borderRadius: '3px', background: tcColors[pkt.pcp], color: '#fff', fontWeight: '600', fontSize: '0.6rem' }}>
                              {pkt.pcp}
                            </span>
                          </td>
                          <td style={cellStyle}>{pkt.length}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default TASDashboard
