const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// GET /api/dealers - list all dealers (admin only)
router.get('/', authenticateToken, requireAdmin, (req, res) => {
  const db = getDb();
  const dealers = db.prepare(`
    SELECT id, company_name, contact_name, email, phone, city, province, credit_balance, is_active, is_admin, created_at,
      (SELECT COUNT(*) FROM tune_orders WHERE dealer_id = dealers.id) as order_count
    FROM dealers ORDER BY company_name
  `).all();
  res.json({ dealers });
});

// POST /api/dealers - create dealer (admin only)
router.post('/', authenticateToken, requireAdmin, (req, res) => {
  const { company_name, contact_name, email, password, phone, address, city, province, postal_code, credit_balance } = req.body;

  if (!company_name || !contact_name || !email || !password) {
    return res.status(400).json({ error: 'Company name, contact name, email, and password are required' });
  }

  const db = getDb();
  const existing = db.prepare('SELECT id FROM dealers WHERE email = ?').get(email.toLowerCase().trim());
  if (existing) return res.status(400).json({ error: 'Email already registered' });

  const id = uuidv4();
  const hash = bcrypt.hashSync(password, 10);

  db.prepare(`
    INSERT INTO dealers (id, company_name, contact_name, email, password_hash, phone, address, city, province, postal_code, credit_balance)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, company_name, contact_name, email.toLowerCase().trim(), hash, phone, address, city, province, postal_code, credit_balance || 0);

  const dealer = db.prepare('SELECT id, company_name, contact_name, email, phone, city, province, credit_balance, is_active, created_at FROM dealers WHERE id = ?').get(id);
  res.status(201).json({ dealer });
});

// PUT /api/dealers/:id - update dealer (admin only)
router.put('/:id', authenticateToken, requireAdmin, (req, res) => {
  const { company_name, contact_name, phone, address, city, province, postal_code, credit_balance, is_active } = req.body;
  const db = getDb();

  db.prepare(`
    UPDATE dealers SET company_name=?, contact_name=?, phone=?, address=?, city=?, province=?, postal_code=?, credit_balance=?, is_active=?, updated_at=datetime('now')
    WHERE id = ?
  `).run(company_name, contact_name, phone, address, city, province, postal_code, credit_balance, is_active ? 1 : 0, req.params.id);

  const dealer = db.prepare('SELECT id, company_name, contact_name, email, phone, city, province, credit_balance, is_active, created_at FROM dealers WHERE id = ?').get(req.params.id);
  res.json({ dealer });
});

// PUT /api/dealers/:id/credits - adjust credits (admin only)
router.put('/:id/credits', authenticateToken, requireAdmin, (req, res) => {
  const { amount, description } = req.body;
  const db = getDb();

  db.prepare('UPDATE dealers SET credit_balance = credit_balance + ?, updated_at = datetime("now") WHERE id = ?').run(amount, req.params.id);

  db.prepare(`
    INSERT INTO credit_transactions (id, dealer_id, amount, type, description)
    VALUES (?, ?, ?, ?, ?)
  `).run(uuidv4(), req.params.id, amount, amount > 0 ? 'credit' : 'debit', description || 'Manual adjustment');

  const dealer = db.prepare('SELECT id, company_name, credit_balance FROM dealers WHERE id = ?').get(req.params.id);
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
    SELECT t.order_number, t.id, t.status, t.created_at, t.tune_type, t.options, t.notes, t.stock_file_name,
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
      SELECT t.id, t.order_number, t.status, t.created_at, t.tune_type, t.options, t.notes, t.stock_file_name,
             v.year, v.make, v.model, v.vin, v.ecu_type, v.engine, v.engine_code,
             c.first_name, c.last_name, c.email as client_email,
             d.company_name as dealer_name, d.contact_name as dealer_contact
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

  const dealer = db.prepare('SELECT credit_balance FROM dealers WHERE id = ?').get(req.dealer.id);

  res.json({
    stats: { totalOrders, pendingOrders, inProgressOrders, completedOrders },
    recentOrders,
    workQueue,
    credit_balance: dealer.credit_balance
  });
});

module.exports = router;
