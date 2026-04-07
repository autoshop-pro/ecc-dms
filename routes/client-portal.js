const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../database');
const { authenticateToken } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// File upload config for client uploads (logs, stock files, etc.)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'uploads')),
  filename: (req, file, cb) => {
    const uniqueName = `client-${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// Middleware: ensure the user is a client
function requireClient(req, res, next) {
  if (req.userType !== 'client') {
    return res.status(403).json({ error: 'Client access required' });
  }
  next();
}

// GET /api/portal/dashboard - client dashboard overview
router.get('/dashboard', authenticateToken, requireClient, (req, res) => {
  const db = getDb();
  const clientId = req.client.id;

  const vehicles = db.prepare('SELECT * FROM vehicles WHERE client_id = ? ORDER BY year DESC').all(clientId);

  const orders = db.prepare(`
    SELECT t.*, v.year, v.make, v.model, v.vin, d.company_name as dealer_name
    FROM tune_orders t
    JOIN vehicles v ON t.vehicle_id = v.id
    JOIN dealers d ON t.dealer_id = d.id
    WHERE t.client_id = ?
    ORDER BY t.created_at DESC
  `).all(clientId);

  const dealer = db.prepare('SELECT company_name, phone, email FROM dealers WHERE id = ?').get(req.client.current_dealer_id);

  const stats = {
    total_orders: orders.length,
    pending_orders: orders.filter(o => o.status === 'pending' || o.status === 'in_progress').length,
    completed_orders: orders.filter(o => o.status === 'completed').length,
    total_vehicles: vehicles.length
  };

  res.json({ client: req.client, dealer, vehicles, orders, stats });
});

// GET /api/portal/vehicles - list client's vehicles
router.get('/vehicles', authenticateToken, requireClient, (req, res) => {
  const db = getDb();
  const vehicles = db.prepare(`
    SELECT v.*,
      (SELECT COUNT(*) FROM tune_orders WHERE vehicle_id = v.id) as order_count
    FROM vehicles v
    WHERE v.client_id = ?
    ORDER BY v.year DESC
  `).all(req.client.id);

  res.json({ vehicles });
});

// GET /api/portal/orders - list client's tune orders
router.get('/orders', authenticateToken, requireClient, (req, res) => {
  const db = getDb();
  const orders = db.prepare(`
    SELECT t.*, v.year, v.make, v.model, v.vin, d.company_name as dealer_name
    FROM tune_orders t
    JOIN vehicles v ON t.vehicle_id = v.id
    JOIN dealers d ON t.dealer_id = d.id
    WHERE t.client_id = ?
    ORDER BY t.created_at DESC
  `).all(req.client.id);

  res.json({ orders });
});

// GET /api/portal/orders/:id - single order detail for client
router.get('/orders/:id', authenticateToken, requireClient, (req, res) => {
  const db = getDb();
  const order = db.prepare(`
    SELECT t.*, v.year, v.make, v.model, v.vin, v.engine, v.ecu_type,
      d.company_name as dealer_name
    FROM tune_orders t
    JOIN vehicles v ON t.vehicle_id = v.id
    JOIN dealers d ON t.dealer_id = d.id
    WHERE t.id = ? AND t.client_id = ?
  `).get(req.params.id, req.client.id);

  if (!order) return res.status(404).json({ error: 'Order not found' });

  // Get additional files
  const files = db.prepare(`
    SELECT of.*, d.company_name as uploaded_by_name
    FROM order_files of
    LEFT JOIN dealers d ON of.uploaded_by = d.id
    WHERE of.order_id = ?
    ORDER BY of.created_at DESC
  `).all(order.id);

  res.json({ order, files });
});

// POST /api/portal/orders/:id/upload - client uploads files (logs, stock reads, etc.)
router.post('/orders/:id/upload', authenticateToken, requireClient, upload.single('file'), (req, res) => {
  const db = getDb();

  const order = db.prepare('SELECT * FROM tune_orders WHERE id = ? AND client_id = ?').get(req.params.id, req.client.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const fileId = uuidv4();
  db.prepare(`
    INSERT INTO order_files (id, order_id, file_path, file_name, file_type, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(fileId, order.id, req.file.path, req.file.originalname, req.body.file_type || 'log', req.client.id);

  res.status(201).json({ message: 'File uploaded successfully', file_id: fileId });
});

// GET /api/portal/orders/:id/files/:fileId/download - client downloads a file
router.get('/orders/:id/files/:fileId/download', authenticateToken, requireClient, (req, res) => {
  const db = getDb();

  const order = db.prepare('SELECT * FROM tune_orders WHERE id = ? AND client_id = ?').get(req.params.id, req.client.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const file = db.prepare('SELECT * FROM order_files WHERE id = ? AND order_id = ?').get(req.params.fileId, order.id);
  if (!file) return res.status(404).json({ error: 'File not found' });

  if (!fs.existsSync(file.file_path)) {
    return res.status(404).json({ error: 'File no longer available on server.' });
  }
  res.download(file.file_path, file.file_name);
});

module.exports = router;
