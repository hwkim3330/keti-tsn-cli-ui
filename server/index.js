import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

import checksumRoutes from './routes/checksum.js';
import downloadRoutes from './routes/download.js';
import listRoutes from './routes/list.js';
import encodeRoutes from './routes/encode.js';
import decodeRoutes from './routes/decode.js';
import fetchRoutes from './routes/fetch.js';
import patchRoutes from './routes/patch.js';
import getRoutes from './routes/get.js';
import configRoutes from './routes/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API Routes
app.use('/api/checksum', checksumRoutes);
app.use('/api/download', downloadRoutes);
app.use('/api/list', listRoutes);
app.use('/api/encode', encodeRoutes);
app.use('/api/decode', decodeRoutes);
app.use('/api/fetch', fetchRoutes);
app.use('/api/patch', patchRoutes);
app.use('/api/get', getRoutes);
app.use('/api/config', configRoutes);

// Serve static files in production
const clientBuildPath = join(__dirname, '../client/dist');
if (fs.existsSync(clientBuildPath)) {
  app.use(express.static(clientBuildPath));
  app.get('*', (req, res) => {
    res.sendFile(join(clientBuildPath, 'index.html'));
  });
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`TSN CLI UI Server running on http://localhost:${PORT}`);
});
