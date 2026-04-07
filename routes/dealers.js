const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// Middleware: require admin or distributor
function requireAdminOrDistributor(req, res, next) {
  if (req.dealer.is_admin || req.dealer.role === 'distributor') return next();
  res.status(403).json({ error: 'Admin or distributor access required' });
}

// GET /api/dealers - list dealers (admin sees all, distributor sees their sub-dealers)
router.get('/', authenticateToken, requireAdminOrDistributor, (req, res) => {
  const db = getDb();
  let dealers;
  if (req.dealer.is_admin) {
    dealers = db.prepare(`
      SELECT d.id, d.company_name, d.contact_name, d.email, d.phone, d.city, d.province,
             d.account_balance, d.is_active, d.is_admin, d.role, d.parent_dealer_id, d.discount_pct, d.created_at,
             (SELECT COUNT(*) FROM tune_orders WHERE dealer_id = d.id) as order_count,
             p.company_name as parent_name
      FROM dealers d
      LEFT JOIN dealers p ON d.parent_dealer_id = p.id
      ORDER BY d.role DESC, d.company_name
    `).all();
  } else {
    // Distributor: see their own sub-dealers
    dealers = db.prepare(`
      SELECT d.id, d.company_name, d.contact_name, d.email, d.phone, d.city, d.province,
             d.account_balance, d.is_active, d.role, d.parent_dealer_id, d.discount_pct, d.created_at,
             (SELECT COUNT(*) FROM tune_orders WHERE dealer_id = d.id) as order_count
      FROM dealers d
      WHERE d.parent_dealer_id = ?
      ORDER BY d.company_name
    `).all(req.dealer.id);
  }
  res.json({ dealers });
});

// POST /api/dealers - create dealer (admin creates any, distributor creates sub-dealers)
router.post('/', authenticateToken, requireAdminOrDistributor, (req, res) => {
  const { company_name, contact_name, email, password, phone, address, city, province, postal_code, account_balance, role, discount_pct } = req.body;

  if (!company_name || !contact_name || !email || !password) {
    return res.status(400).json({ error: 'Company name, contact name, email, and password are required' });
  }

  const db = getDb();
  const existing = db.prepare('SELECT id FROM dealers WHERE email = ?').get(email.toLowerCase().trim());
  if (existing) return res.status(400).json({ error: 'Email already registered' });

  const id = uuidv4();
  const hash = bcrypt.hashSync(password, 10);

  // Determine role and parent
  let dealerRole = 'dealer';
  let parentId = null;

  if (req.dealer.is_admin) {
    dealerRole = role || 'dealer';  // Admin can create distributors or dealers
    parentId = req.body.parent_dealer_id || null;
  } else if (req.dealer.role === 'distributor') {
    dealerRole = 'dealer';  // Distributors can only create standard dealers
    parentId = req.dealer.id;  // Auto-set parent to the distributor
  }

  db.prepare(`
    INSERT INTO dealers (id, company_name, contact_name, email, password_hash, phone, address, city, province, postal_code, account_balance, role, parent_dealer_id, discount_pct)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, company_name, contact_name, email.toLowerCase().trim(), hash, phone, address, city, province, postal_code, account_balance || 0, dealerRole, parentId, discount_pct || 0);

  const dealer = db.prepare(`
    SELECT id, company_name, contact_name, email, phone, city, province, account_balance, is_active, role, parent_dealer_id, discount_pct, created_at
    FROM dealers WHERE id = ?
  `).get(id);
  res.status(201).json({ dealer });
});

// PUT /api/dealers/:id - update dealer (admin or parent distributor)
router.put('/:id', authenticateToken, requireAdminOrDistributor, (req, res) => {
  const { company_name, contact_name, phone, address, city, province, postal_code, account_balance, is_active, role, discount_pct, parent_dealer_id } = req.body;
  const db = getDb();

  // Distributor can only update their own sub-dealers
  if (!req.dealer.is_admin) {
    const target = db.prepare('SELECT parent_dealer_id FROM dealers WHERE id = ?').get(req.params.id);
    if (!target || target.parent_dealer_id !== req.dealer.id) {
      return res.status(403).json({ error: 'Cannot modify this dealer' });
    }
  }

  if (req.dealer.is_admin) {
    db.prepare(`
      UPDATE dealers SET company_name=?, contact_name=?, phone=?, address=?, city=?, province=?, postal_code=?,
        account_balance=?, is_active=?, role=?, discount_pct=?, parent_dealer_id=?, updated_at=datetime('now')
      WHERE id = ?
    `).run(company_name, contact_name, phone, address, city, province, postal_code,
      account_balance, is_active ? 1 : 0, role || 'dealer', discount_pct || 0, parent_dealer_id || null, req.params.id);
  } else {
    // Distributor can update basic info and discount for their sub-dealers
    db.prepare(`
      UPDATE dealers SET company_name=?, contact_name=?, phone=?, address=?, city=?, province=?, postal_code=?,
        is_active=?, discount_pct=?, updated_at=datetime('now')
      WHERE id = ?
    `).run(company_name, contact_name, phone, address, city, province, postal_code,
      is_active ? 1 : 0, discount_pct || 0, req.params.id);
  }

  const dealer = db.prepare(`
    SELECT id, company_name, contact_name, email, phone, city, province, account_balance, is_active, role, parent_dealer_id, discount_pct, created_at
    FROM dealers WHERE id = ?
  `).get(req.params.id);
  res.json({ dealer });
});

// PUT /api/dealers/:id/balance - adjust account balance (admin or parent distributor)
router.put('/:id/balance', authenticateToken, requireAdminOrDistributor, (req, res) => {
  const { amount, description } = req.body;
  const db = getDb();

  // Distributor can only fund their own sub-dealers
  if (!req.dealer.is_admin) {
    const target = db.prepare('SELECT parent_dealer_id FROM dealers WHERE id = ?').get(req.params.id);
    if (!target || target.parent_dealer_id !== req.dealer.id) {
      return res.status(403).json({ error: 'Cannot modify this dealer' });
    }
  }

  db.prepare('UPDATE dealers SET account_balance = account_balance + ?, updated_at = datetime(\'now\') WHERE id = ?').run(amount, req.params.id);

  db.prepare(`
    INSERT INTO account_transactions (id, dealer_id, amount, type, description)
    VALUES (?, ?, ?, ?, ?)
  `).run(uuidv4(), req.params.id, amount, amount > 0 ? 'deposit' : 'charge', description || 'Manual adjustment');

  const dealer = db.prepare('SELECT id, company_name, account_balance FROM dealers WHERE id = ?').get(req.params.id);
  res.json({ dealer });
});

// GET /api/dealers/stats - dashboard stats
router.get('/stats', authenticateToken, (req, res) => {
  const db = getDb();
  const dealerId = req.dealer.is_admin ? null : req.dealer.id;

  const whereClause = dealerId ? 'WHERE dealer_id = ?' : '';
  const params = dealerId ? [dealerId] : [];

  const totalOrders = db.prepare(`SELECT COUNT(*) as count FROM tune_orders ${whereClause}`).get(...params).count;
  const pendingOrders = db.prepare(`SELECT COUNT(*) as count FROM tune_orders ${whereClause ? whereClause + ' AND' : 'WHERE'} status = 'pending'`).get(...params).count;
  const inProgressOrders = db.prepare(`SELECT COUNT(*) as count FROM tune_orders ${whereClause ? whereClause + ' AND' : 'WHERE'} status = 'in_progress'`).get(...params).count;
  const completedOrders = db.prepare(`SELECT COUNT(*) as count FROM tune_orders ${whereClause ? whereClause + ' AND' : 'WHERE'} status = 'completed'`).get(...params).count;

  const recentOrders = db.prepare(`
    SELECT t.order_number, t.id, t.status, t.created_at, t.tune_type, t.options, t.notes, t.stock_file_name, t.price, t.is_paid,
           v.year, v.make, v.model, v.vin, v.ecu_type, v.engine,
           c.first_name, c.last_name,
           d.company_name as dealer_name, d.contact_name as dealer_contact
    FROM tune_orders t
    JOIN vehicles v ON t.vehicle_id = v.id
    JOIN clients c ON t.client_id = c.id
    JOIN dealers d ON t.dealer_id = d.id
    ${whereClause}
    ORDER BY t.created_at DESC LIMIT 10
  `).all(...params);

  // For admin: get the full work queue (pending + in_progress)
  let workQueue = [];
  if (req.dealer.is_admin) {
    workQueue = db.prepare(`
      SELECT t.id, t.order_number, t.status, t.created_at, t.tune_type, t.options, t.notes, t.stock_file_name, t.price, t.is_paid,
             v.year, v.make, v.model, v.vin, v.ecu_type, v.engine, v.engine_code,
             c.first_name, c.last_name, c.email as client_email,
             d.company_name as dealer_name, d.contact_name as dealer_contact, d.role as dealer_role
      FROM tune_orders t
      JOIN vehicles v ON t.vehicle_id = v.id
      JOIN clients c ON t.client_id = c.id
      JOIN dealers d ON t.dealer_id = d.id
      WHERE t.status IN ('pending', 'in_progress')
      ORDER BY
        CASE t.status WHEN 'in_progress' THEN 0 WHEN 'pending' THEN 1 END,
        t.created_at ASC
    `).all();
  }

  const dealer = db.prepare('SELECT account_balance FROM dealers WHERE id = ?').get(req.dealer.id);

  // Get tune pricing for frontend
  const tunePricing = db.prepare('SELECT tune_key, label, dealer_price, distributor_price FROM tune_pricing WHERE is_active = 1').all();

  res.json({
    stats: { totalOrders, pendingOrders, inProgressOrders, completedOrders },
    recentOrders,
    workQueue,
    account_balance: dealer.account_balance || 0,
    tunePricing
  });
});

// GET /api/dealers/transactions - account transaction history
router.get('/transactions', authenticateToken, (req, res) => {
  const db = getDb();
  const dealerId = req.dealer.is_admin ? (req.query.dealer_id || req.dealer.id) : req.dealer.id;

  const transactions = db.prepare(`
    SELECT t.*, o.order_number
    FROM account_transactions t
    LEFT JOIN tune_orders o ON t.order_id = o.id
    WHERE t.dealer_id = ?
    ORDER BY t.created_at DESC
    LIMIT 50
  `).all(dealerId);

  res.json({ transactions });
});

// GET /api/dealers/distributors - list distributors (for admin creating dealers)
router.get('/distributors', authenticateToken, requireAdmin, (req, res) => {
  const db = getDb();
  const distributors = db.prepare(`
    SELECT id, company_name, contact_name, discount_pct
    FROM dealers WHERE role = 'distributor' AND is_active = 1
    ORDER BY company_name
  `).all();
  res.json({ distributors });
});

module.exports = router;
