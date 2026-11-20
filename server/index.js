/**
 * server/index.js
 * 
 * Express server listening on port 3000 (0.0.0.0)
 * Uses express, cors, dotenv, and multer.
 * 
 * Routes:
 * - POST /api/generate-song
 * - POST /api/transcribe-language
 * - GET  /audio (Serves server/public/audio statically)
 * - GET  /health
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { handleGenerateSong } = require('./generateSong');
const { handleTranscribeLanguage } = require('./transcribeLanguage');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

// 1. Enable CORS for all origins (Expo mobile app, web, emulator)
app.use(cors());

// 2. Parse JSON & URL-encoded request bodies (up to 25MB)
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// 3. Ensure server/public/audio directory exists & serve statically at /audio
const publicAudioDir = path.join(__dirname, 'public', 'audio');
if (!fs.existsSync(publicAudioDir)) {
  fs.mkdirSync(publicAudioDir, { recursive: true });
}
app.use('/audio', express.static(publicAudioDir));

// 4. Configure Multer memory storage for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB limit
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', serverTime: new Date().toISOString() });
});

// POST /api/generate-song
app.post('/api/generate-song', handleGenerateSong);

// POST /api/transcribe-language (Accepts multipart file upload or JSON Base64)
app.post('/api/transcribe-language', upload.any(), (req, res) => {
  // If multer parsed files, assign first file to req.file
  if (req.files && req.files.length > 0 && !req.file) {
    req.file = req.files[0];
  }
  return handleTranscribeLanguage(req, res);
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: `Cannot ${req.method} ${req.originalUrl}` });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

// Start Express server listening on 0.0.0.0:3000
app.listen(PORT, HOST, () => {
  console.log(`Server is running and listening on http://${HOST}:${PORT}`);
  console.log(`Endpoints available:`);
  console.log(` - POST http://${HOST}:${PORT}/api/generate-song`);
  console.log(` - POST http://${HOST}:${PORT}/api/transcribe-language`);
  console.log(` - Static http://${HOST}:${PORT}/audio -> ${publicAudioDir}`);
});
