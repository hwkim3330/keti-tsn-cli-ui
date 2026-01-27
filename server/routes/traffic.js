import express from 'express';
import Cap from 'cap';

const router = express.Router();
const { Cap: CapLib } = Cap;

// Active traffic generators
const generators = new Map();

// Build Ethernet frame with optional VLAN tag
function buildFrame(options) {
  const {
    dstMac,
    srcMac,
    vlanId = 0,
    pcp = 0,
    etherType = 0x0800, // IPv4
    payloadSize = 64
  } = options;

  // Parse MAC addresses
  const parseMac = (mac) => {
    return Buffer.from(mac.replace(/[:-]/g, ''), 'hex');
  };

  const dstMacBuf = parseMac(dstMac);
  const srcMacBuf = parseMac(srcMac);

  let frame;
  let headerSize;

  if (vlanId > 0) {
    // 802.1Q tagged frame
    // Dst(6) + Src(6) + TPID(2) + TCI(2) + EtherType(2) = 18 bytes header
    headerSize = 18;
    const totalSize = Math.max(headerSize + payloadSize, 64); // Min 64 bytes
    frame = Buffer.alloc(totalSize);

    let offset = 0;
    dstMacBuf.copy(frame, offset); offset += 6;
    srcMacBuf.copy(frame, offset); offset += 6;

    // TPID (802.1Q tag)
    frame.writeUInt16BE(0x8100, offset); offset += 2;

    // TCI: PCP(3) + DEI(1) + VID(12)
    const tci = ((pcp & 0x07) << 13) | (vlanId & 0x0FFF);
    frame.writeUInt16BE(tci, offset); offset += 2;

    // EtherType
    frame.writeUInt16BE(etherType, offset); offset += 2;

    // Fill payload with pattern
    for (let i = offset; i < totalSize; i++) {
      frame[i] = i & 0xFF;
    }
  } else {
    // Untagged frame
    // Dst(6) + Src(6) + EtherType(2) = 14 bytes header
    headerSize = 14;
    const totalSize = Math.max(headerSize + payloadSize, 64);
    frame = Buffer.alloc(totalSize);

    let offset = 0;
    dstMacBuf.copy(frame, offset); offset += 6;
    srcMacBuf.copy(frame, offset); offset += 6;
    frame.writeUInt16BE(etherType, offset); offset += 2;

    // Fill payload with pattern
    for (let i = offset; i < totalSize; i++) {
      frame[i] = i & 0xFF;
    }
  }

  return frame;
}

// Get interface MAC address
function getInterfaceMac(ifaceName) {
  const devices = CapLib.deviceList();
  const device = devices.find(d => d.name === ifaceName);
  if (device && device.addresses) {
    // Find hardware address (MAC)
    for (const addr of device.addresses) {
      if (addr.addr && addr.addr.includes(':') && addr.addr.length === 17) {
        // Looks like a MAC address
        return addr.addr;
      }
    }
  }
  // Return a default if not found
  return '00:00:00:00:00:00';
}

// Get available interfaces
router.get('/interfaces', (req, res) => {
  try {
    const devices = CapLib.deviceList();
    const interfaces = devices
      .filter(d => d.name && !d.name.startsWith('any') && !d.name.startsWith('nf') && !d.name.startsWith('dbus'))
      .map(d => ({
        name: d.name,
        description: d.description || d.name,
        addresses: d.addresses?.map(a => a.addr).filter(Boolean) || []
      }));
    res.json(interfaces);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start traffic generation
router.post('/start', (req, res) => {
  const {
    interface: ifaceName,
    dstMac,
    srcMac,
    vlanId = 0,
    pcp = 0,
    packetSize = 100,
    packetsPerSecond = 100,
    duration = 0, // 0 = unlimited
    count = 0 // 0 = unlimited (use duration)
  } = req.body;

  if (!ifaceName) {
    return res.status(400).json({ error: 'Interface name required' });
  }

  if (!dstMac) {
    return res.status(400).json({ error: 'Destination MAC required' });
  }

  if (generators.has(ifaceName)) {
    return res.status(400).json({ error: `Generator already running on ${ifaceName}` });
  }

  try {
    const cap = new CapLib();
    const buffer = Buffer.alloc(65535);
    const linkType = cap.open(ifaceName, '', 10 * 1024 * 1024, buffer);

    if (linkType !== 'ETHERNET') {
      cap.close();
      return res.status(400).json({ error: `Interface ${ifaceName} is not Ethernet` });
    }

    // Get source MAC if not provided
    const sourceMac = srcMac || getInterfaceMac(ifaceName);

    // Build the frame
    const frame = buildFrame({
      dstMac,
      srcMac: sourceMac,
      vlanId: parseInt(vlanId) || 0,
      pcp: parseInt(pcp) || 0,
      payloadSize: Math.max(46, parseInt(packetSize) - 18) // Min payload for 64 byte frame
    });

    const pps = Math.max(1, Math.min(100000, parseInt(packetsPerSecond) || 100));
    const interval = Math.floor(1000 / pps); // ms between packets

    const stats = {
      sent: 0,
      errors: 0,
      startTime: Date.now(),
      running: true
    };

    const maxPackets = parseInt(count) || 0;
    const maxDuration = (parseInt(duration) || 0) * 1000; // Convert to ms

    // Send packets at specified rate
    const sendPacket = () => {
      if (!stats.running) return;

      // Check limits
      if (maxPackets > 0 && stats.sent >= maxPackets) {
        stopGenerator(ifaceName);
        return;
      }

      if (maxDuration > 0 && (Date.now() - stats.startTime) >= maxDuration) {
        stopGenerator(ifaceName);
        return;
      }

      try {
        cap.send(frame, frame.length);
        stats.sent++;
      } catch (err) {
        stats.errors++;
      }
    };

    // Use setInterval for rate control
    const timer = setInterval(sendPacket, interval);

    generators.set(ifaceName, {
      cap,
      timer,
      stats,
      config: { dstMac, srcMac: sourceMac, vlanId, pcp, packetSize, packetsPerSecond: pps }
    });

    res.json({
      success: true,
      message: `Traffic generator started on ${ifaceName}`,
      config: {
        interface: ifaceName,
        dstMac,
        srcMac: sourceMac,
        vlanId,
        pcp,
        packetSize: frame.length,
        packetsPerSecond: pps,
        duration: duration || 'unlimited',
        count: count || 'unlimited'
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stop generator helper
function stopGenerator(ifaceName) {
  const gen = generators.get(ifaceName);
  if (gen) {
    gen.stats.running = false;
    clearInterval(gen.timer);
    try {
      gen.cap.close();
    } catch (e) {}
    generators.delete(ifaceName);
    return gen.stats;
  }
  return null;
}

// Stop traffic generation
router.post('/stop', (req, res) => {
  const { interface: ifaceName } = req.body;

  if (ifaceName) {
    const stats = stopGenerator(ifaceName);
    if (stats) {
      res.json({
        success: true,
        message: `Traffic generator stopped on ${ifaceName}`,
        stats: {
          sent: stats.sent,
          errors: stats.errors,
          duration: Date.now() - stats.startTime
        }
      });
    } else {
      res.status(404).json({ error: `No generator running on ${ifaceName}` });
    }
  } else {
    // Stop all
    const results = [];
    for (const [name, gen] of generators) {
      const stats = stopGenerator(name);
      results.push({
        interface: name,
        sent: stats.sent,
        errors: stats.errors,
        duration: Date.now() - stats.startTime
      });
    }
    res.json({ success: true, stopped: results });
  }
});

// Get status
router.get('/status', (req, res) => {
  const status = [];
  for (const [name, gen] of generators) {
    status.push({
      interface: name,
      running: gen.stats.running,
      sent: gen.stats.sent,
      errors: gen.stats.errors,
      duration: Date.now() - gen.stats.startTime,
      config: gen.config
    });
  }
  res.json({
    active: generators.size,
    generators: status
  });
});

// Send single packet (for testing)
router.post('/send', (req, res) => {
  const {
    interface: ifaceName,
    dstMac,
    srcMac,
    vlanId = 0,
    pcp = 0,
    packetSize = 100
  } = req.body;

  if (!ifaceName || !dstMac) {
    return res.status(400).json({ error: 'Interface and dstMac required' });
  }

  try {
    const cap = new CapLib();
    const buffer = Buffer.alloc(65535);
    cap.open(ifaceName, '', 10 * 1024 * 1024, buffer);

    const sourceMac = srcMac || getInterfaceMac(ifaceName);
    const frame = buildFrame({
      dstMac,
      srcMac: sourceMac,
      vlanId: parseInt(vlanId) || 0,
      pcp: parseInt(pcp) || 0,
      payloadSize: Math.max(46, parseInt(packetSize) - 18)
    });

    cap.send(frame, frame.length);
    cap.close();

    res.json({
      success: true,
      message: 'Packet sent',
      frameSize: frame.length,
      frameHex: frame.toString('hex').match(/.{2}/g).join(' ').substring(0, 100) + '...'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
