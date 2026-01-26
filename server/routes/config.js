import express from 'express';
import { SerialPort } from 'serialport';

const router = express.Router();

// Get available serial ports
router.get('/ports', async (req, res) => {
  try {
    const ports = await SerialPort.list();
    res.json({
      ports: ports.map(p => ({
        path: p.path,
        manufacturer: p.manufacturer || 'Unknown',
        serialNumber: p.serialNumber || 'N/A',
        vendorId: p.vendorId,
        productId: p.productId
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get default configuration
router.get('/defaults', (req, res) => {
  res.json({
    transport: 'serial',
    device: '/dev/ttyACM0',
    host: '192.168.4.1',
    port: 5683
  });
});

export default router;
