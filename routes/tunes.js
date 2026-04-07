const express = require('express');
const multer = require('multer');
const path = require('path');
const { getDb, generateOrderNumber } = require('../database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// File upload config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'uploads')),
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
});

// Available tune options
const TUNE_OPTIONS = {
  performance: [
    { id: 'stage1', label: 'Stage 1', category: 'Performance' },
    { id: 'stage2', label: 'Stage 2', category: 'Performance' },
    { id: 'stage3', label: 'Custom Stage 3', category: 'Performance' },
    { id: 'eco_tune', label: 'Economy Tune', category: 'Performance' },
  ],
  emissions: [
    { id: 'dpf_delete', label: 'DPF Delete', category: 'Emissions' },
    { id: 'egr_delete', label: 'EGR Delete', category: 'Emissions' },
    { id: 'adblue_delete', label: 'AdBlue / SCR Delete', category: 'Emissions' },
    { id: 'cat_delete', label: 'Catalyst Delete', category: 'Emissions' },
    { id: 'o2_delete', label: 'O2 Sensor Delete', category: 'Emissions' },
    { id: 'swirl_flap', label: 'Swirl Flap Delete', category: 'Emissions' },
    { id: 'exhaust_flap', label: 'Exhaust Flap Delete', category: 'Emissions' },
  ],
  features: [
    { id: 'pops_bangs', label: 'Crackles & Pops (Burble)', category: 'Features' },
    { id: 'launch_control', label: 'Launch Control', category: 'Features' },
    { id: 'speed_limiter', label: 'Speed Limiter Remove', category: 'Features' },
    { id: 'rev_limiter', label: 'Rev Limiter Increase', category: 'Features' },
    { id: 'start_stop_disable', label: 'Start/Stop Disable', category: 'Features' },
    { id: 'cold_start_fix', label: 'Cold Start Noise Fix', category: 'Features' },
    { id: 'immo_off', label: 'Immobilizer Off', category: 'Features' },
    { id: 'dtc_off', label: 'DTC / CEL Off', category: 'Features' },
    { id: 'hardcut_limiter', label: 'Hardcut Limiter (Pop on Shift)', category: 'Features' },
    { id: 'decat_pops', label: 'Decat Crackles', category: 'Features' },
  ],
  transmission: [
    { id: 'tcu_tune', label: 'TCU Tune', category: 'Transmission' },
    { id: 'tcu_launch', label: 'TCU Launch Control', category: 'Transmission' },
    { id: 'tcu_shift_speed', label: 'Faster Shift Speed', category: 'Transmission' },
  ]
};

// GET /api/tunes/options - get available tune options
router.get('/options', authenticateToken, (req, res) => {
  res.json({ options: TUNE_OPTIONS });
});

// GET /api/tunes - list tune orders
router.get('/', authenticateToken, (req, res) => {
  const db = getDb();
  const { status, client_id } = req.query;

  let query = `
    SELECT t.*, v.year, v.make, v.model, v.vin, v.ecu_type,
           c.first_name, c.last_name, c.email as client_email,
           d.company_name as dealer_name
    FROM tune_orders t
    JOIN vehicles v ON t.vehicle_id = v.id
    JOIN clients c ON t.client_id = c.id
    JOIN dealers d ON t.dealer_id = d.id
  `;
  const params = [];

  const conditions = [];
  if (!req.dealer.is_admin) {
    conditions.push('t.dealer_id = ?');
    params.push(req.dealer.id);
  }
  if (status) {
    conditions.push('t.status = ?');
    params.push(status);
  }
  if (client_id) {
    conditions.push('t.client_id = ?');
    params.push(client_id);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' ORDER BY t.created_at DESC';

  const orders = db.prepare(query).all(...params);
  res.json({ orders });
});

// GET /api/tunes/:id
router.get('/:id', authenticateToken, (req, res) => {
  const db = getDb();

  let query = `
    SELECT t.*, v.year, v.make, v.model, v.vin, v.engine, v.engine_code, v.ecu_type, v.tcu_type, v.transmission,
           c.first_name, c.last_name, c.email as client_email, c.phone as client_phone,
           d.company_name as dealer_name, d.contact_name as dealer_contact
    FROM tune_orders t
    JOIN vehicles v ON t.vehicle_id = v.id
    JOIN clients c ON t.client_id = c.id
    JOIN dealers d ON t.dealer_id = d.id
    WHERE t.id = ?
  `;

  if (!req.dealer.is_admin) {
    query += ' AND t.dealer_id = ?';
    const order = db.prepare(query).get(req.params.id, req.dealer.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const files = db.prepare('SELECT * FROM order_files WHERE order_id = ?').all(order.id);
    return res.json({ order, files });
  }

  const order = db.prepare(query).get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const files = db.prepare('SELECT * FROM order_files WHERE order_id = ?').all(order.id);
  res.json({ order, files });
});

// POST /api/tunes - create new tune order
router.post('/', authenticateToken, upload.single('stock_file'), (req, res) => {
  const { client_id, vehicle_id, tune_type, options, notes } = req.body;

  if (!client_id || !vehicle_id || !tune_type) {
    return res.status(400).json({ error: 'Client, vehicle, and tune type are required' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'Stock ECU file is required' });
  }

  const db = getDb();
  const id = uuidv4();
  const orderNumber = generateOrderNumber();

  db.prepare(`
    INSERT INTO tune_orders (id, order_number, dealer_id, client_id, vehicle_id, tune_type, options, notes, stock_file_path, stock_file_name, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(
    id, orderNumber, req.dealer.id, client_id, vehicle_id,
    tune_type, options || '[]', notes || null,
    req.file.path, req.file.originalname
  );

  const order = db.prepare(`
    SELECT t.*, v.year, v.make, v.model, v.vin,
           c.first_name, c.last_name
    FROM tune_orders t
    JOIN vehicles v ON t.vehicle_id = v.id
    JOIN clients c ON t.client_id = c.id
    WHERE t.id = ?
  `).get(id);

  res.status(201).json({ order });
});

// PUT /api/tunes/:id/status - update order status (admin)
router.put('/:id/status', authenticateToken, requireAdmin, (req, res) => {
  const { status, admin_notes } = req.body;
  const validStatuses = ['pending', 'in_progress', 'completed', 'on_hold', 'cancelled'];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const db = getDb();
  const completedAt = status === 'completed' ? "datetime('now')" : null;

  db.prepare(`
    UPDATE tune_orders
    SET status = ?, admin_notes = ?, updated_at = datetime('now'), completed_at = ${completedAt ? completedAt : 'completed_at'}
    WHERE id = ?
  `).run(status, admin_notes || null, req.params.id);

  const order = db.prepare('SELECT * FROM tune_orders WHERE id = ?').get(req.params.id);
  res.json({ order });
});

// POST /api/tunes/:id/tuned-file - upload completed tune file + set price (admin)
router.post('/:id/tuned-file', authenticateToken, requireAdmin, upload.single('tuned_file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Tuned file is required' });
  }

  const db = getDb();
  const price = parseFloat(req.body.price) || 0;

  db.prepare(`
    UPDATE tune_orders SET tuned_file_path = ?, tuned_file_name = ?, price = ?, status = 'completed', completed_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).run(req.file.path, req.file.originalname, price, req.params.id);

  const order = db.prepare('SELECT * FROM tune_orders WHERE id = ?').get(req.params.id);
  res.json({ order });
});

// PUT /api/tunes/:id/set-price - admin sets price on order
router.put('/:id/set-price', authenticateToken, requireAdmin, (req, res) => {
  const { price } = req.body;
  if (price == null || price < 0) return res.status(400).json({ error: 'Valid price required' });

  const db = getDb();
  db.prepare('UPDATE tune_orders SET price = ?, updated_at = datetime(\'now\') WHERE id = ?').run(price, req.params.id);
  const order = db.prepare('SELECT * FROM tune_orders WHERE id = ?').get(req.params.id);
  res.json({ order });
});

// POST /api/tunes/:id/pay - dealer pays for tune to unlock download
router.post('/:id/pay', authenticateToken, (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT * FROM tune_orders WHERE id = ?').get(req.params.id);

  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (!req.dealer.is_admin && order.dealer_id !== req.dealer.id) {
    return res.status(403).json({ error: 'Access denied' });
  }
  if (order.is_paid) return res.status(400).json({ error: 'Already paid' });
  if (!order.tuned_file_path) return res.status(400).json({ error: 'Tuned file not yet available' });
  if (order.price <= 0) return res.status(400).json({ error: 'No price set for this order' });

  // Check balance
  const dealer = db.prepare('SELECT account_balance FROM dealers WHERE id = ?').get(order.dealer_id);
  if (dealer.account_balance < order.price) {
    return res.status(400).json({
      error: `Insufficient balance. Need $${order.price.toFixed(2)}, have $${dealer.account_balance.toFixed(2)}`
    });
  }

  // Charge
  db.prepare('UPDATE dealers SET account_balance = account_balance - ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(order.price, order.dealer_id);
  db.prepare('UPDATE tune_orders SET is_paid = 1, updated_at = datetime(\'now\') WHERE id = ?')
    .run(order.id);
  db.prepare('INSERT INTO account_transactions (id, dealer_id, amount, type, description, order_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(uuidv4(), order.dealer_id, -order.price, 'charge', `Tune order ${order.order_number}`, order.id);

  const updated = db.prepare('SELECT * FROM tune_orders WHERE id = ?').get(order.id);
  res.json({ order: updated });
});

// GET /api/tunes/:id/download/:type - download stock or tuned file
router.get('/:id/download/:type', authenticateToken, (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT * FROM tune_orders WHERE id = ?').get(req.params.id);

  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (!req.dealer.is_admin && order.dealer_id !== req.dealer.id) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const fileType = req.params.type;
  if (fileType === 'stock' && order.stock_file_path) {
    return res.download(order.stock_file_path, order.stock_file_name);
  } else if (fileType === 'tuned' && order.tuned_file_path) {
    // Gate tuned file download behind payment (admin always has access)
    if (!req.dealer.is_admin && order.price > 0 && !order.is_paid) {
      return res.status(402).json({ error: 'Payment required before downloading tuned file. Please pay from your order details page.' });
    }
    return res.download(order.tuned_file_path, order.tuned_file_name);
  }

  res.status(404).json({ error: 'File not found' });
});

module.exports = router;
