import express from 'express';
import cors from 'cors';
import { spawn, execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

let activeProcess = null;
let stats = null;

function getInterfaceMac(ifaceName) {
  try {
    const result = execSync(`cat /sys/class/net/${ifaceName}/address 2>/dev/null || echo "00:00:00:00:00:00"`, { encoding: 'utf8' });
    return result.trim();
  } catch {
    return '00:00:00:00:00:00';
  }
}

function getInterfaces() {
  try {
    const result = execSync('ls /sys/class/net', { encoding: 'utf8' });
    return result.trim().split('\n').filter(n => n && !n.startsWith('lo'));
  } catch {
    return [];
  }
}

app.get('/api/traffic/interfaces', (req, res) => {
  const interfaces = getInterfaces().map(name => ({
    name,
    description: name,
    mac: getInterfaceMac(name)
  }));
  res.json(interfaces);
});

app.post('/api/traffic/start', (req, res) => {
  const { interface: ifaceName, dstMac, srcMac, vlanId = 100, tcList = [1,2,3,4,5,6,7], packetsPerSecond = 100, duration = 10 } = req.body;

  if (!ifaceName || !dstMac) return res.status(400).json({ error: 'Interface and dstMac required' });
  if (activeProcess) return res.status(400).json({ error: 'Generator already running' });

  const sourceMac = srcMac || getInterfaceMac(ifaceName);
  const tcs = Array.isArray(tcList) ? tcList : [1,2,3,4,5,6,7];
  const pps = Math.max(1, Math.min(5000, parseInt(packetsPerSecond) || 100));
  const dur = parseInt(duration) || 10;

  stats = { sent: {}, total: 0, startTime: Date.now(), running: true };
  tcs.forEach(tc => stats.sent[tc] = 0);

  const scriptPath = path.join(__dirname, 'traffic-sender.py');
  activeProcess = spawn('python3', [
    scriptPath,
    ifaceName,
    dstMac,
    sourceMac,
    vlanId.toString(),
    JSON.stringify(tcs),
    pps.toString(),
    dur.toString()
  ]);

  let output = '';
  activeProcess.stdout.on('data', (data) => { output += data.toString(); });
  activeProcess.stderr.on('data', (data) => { console.error('Python error:', data.toString()); });

  activeProcess.on('close', (code) => {
    try {
      const result = JSON.parse(output);
      if (result.sent) stats.sent = result.sent;
      if (result.total) stats.total = result.total;
    } catch {}
    stats.running = false;
    activeProcess = null;
  });

  res.json({ success: true, config: { interface: ifaceName, tcs, packetsPerSecond: pps, duration: dur } });
});

app.post('/api/traffic/stop', (req, res) => {
  if (activeProcess) {
    activeProcess.kill('SIGINT');
    activeProcess = null;
  }
  res.json({ success: true, stats: stats ? { sent: stats.sent, total: stats.total } : null });
});

app.get('/api/traffic/status', (req, res) => {
  if (stats?.running) {
    res.json({ running: true, sent: stats.sent, total: stats.total, elapsed: Date.now() - stats.startTime });
  } else if (stats) {
    res.json({ running: false, sent: stats.sent, total: stats.total });
  } else {
    res.json({ running: false });
  }
});

app.post('/api/traffic/send', (req, res) => {
  const { interface: ifaceName, dstMac, srcMac, vlanId = 100, pcp = 0 } = req.body;
  if (!ifaceName || !dstMac) return res.status(400).json({ error: 'Interface and dstMac required' });

  const sourceMac = srcMac || getInterfaceMac(ifaceName);
  const scriptPath = path.join(__dirname, 'traffic-sender.py');

  try {
    execSync(`python3 ${scriptPath} ${ifaceName} ${dstMac} ${sourceMac} ${vlanId} '[${pcp}]' 1 1`, { timeout: 5000 });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Traffic Server running on http://localhost:${PORT}`));
