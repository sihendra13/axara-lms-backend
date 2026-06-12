const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/api/v1/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Axara LMS Backend is running',
    timestamp: new Date().toISOString()
  });
});

// Routes (akan di-implement nanti)
// app.use('/api/v1/auth', require('./routes/auth'));
// app.use('/api/v1/users', require('./routes/users'));
// app.use('/api/v1/videos', require('./routes/videos'));

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error Handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
  ╔════════════════════════════════════╗
  ║  🚀 Axara LMS Backend              ║
  ║  ✅ Server running on port ${PORT}    ║
  ║  📍 Environment: ${process.env.NODE_ENV}       ║
  ╚════════════════════════════════════╝
  `);
});
