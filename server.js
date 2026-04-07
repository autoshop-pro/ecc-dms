const express = require('express');
const cors = require('cors');
const path = require('path');
const { initializeDatabase } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Initialize database
initializeDatabase();

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/dealers', require('./routes/dealers'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/vehicles', require('./routes/vehicles'));
app.use('/api/tunes', require('./routes/tunes'));
app.use('/api/hardware', require('./routes/hardware'));
app.use('/api/pricing', require('./routes/pricing'));

// Serve frontend for all non-API routes
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`ECC DMS running on http://localhost:${PORT}`);
});
