const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Allowed origins: production Cloudflare URLs + local development
const allowedOrigins = [
  'https://lms-admin-6wg.pages.dev',
  'https://lms-learner.pages.dev',
  'http://localhost:5173',
  'http://localhost:5174',
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS blocked: ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());

// Health check
app.get('/api/v1/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Axara LMS Backend is running',
    timestamp: new Date().toISOString()
  });
});

// Routes
app.use('/api/v1/auth', require('./routes/auth'));
app.use('/api/v1/users', require('./routes/users'));
app.use('/api/v1/invitations', require('./routes/invitations'));
app.use('/api/v1/ppt', require('./routes/ppt'));
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
