const express = require('express');
const { getDb } = require('../database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// GET /api/pricing - get tune pricing (all authenticated users)
router.get('/', authenticateToken, (req, res) => {
  const db = getDb();
  const pricing = db.prepare('SELECT * FROM tune_pricing WHERE is_active = 1 ORDER BY tune_key').all();

  const role = req.dealer.role || 'dealer';
  const mapped = pricing.map(p => ({
    ...p,
    your_price: role === 'distributor' ? p.distributor_price : p.dealer_price
  }));

  res.json({ pricing: mapped });
});

// PUT /api/pricing/:id - update pricing (admin)
router.put('/:id', authenticateToken, requireAdmin, (req, res) => {
  const { label, dealer_price, distributor_price, is_active } = req.body;
  const db = getDb();

  db.prepare('UPDATE tune_pricing SET label=?, dealer_price=?, distributor_price=?, is_active=? WHERE id = ?')
    .run(label, dealer_price, distributor_price, is_active ? 1 : 0, req.params.id);

  const pricing = db.prepare('SELECT * FROM tune_pricing WHERE id = ?').get(req.params.id);
  res.json({ pricing });
});

// POST /api/pricing - add pricing entry (admin)
router.post('/', authenticateToken, requireAdmin, (req, res) => {
  const { tune_key, label, dealer_price, distributor_price } = req.body;
  if (!tune_key || !label) return res.status(400).json({ error: 'Key and label required' });

  const db = getDb();
  const id = uuidv4();
  db.prepare('INSERT INTO tune_pricing (id, tune_key, label, dealer_price, distributor_price) VALUES (?, ?, ?, ?, ?)')
    .run(id, tune_key, label, dealer_price || 0, distributor_price || 0);

  const pricing = db.prepare('SELECT * FROM tune_pricing WHERE id = ?').get(id);
  res.status(201).json({ pricing });
});

// POST /api/pricing/deposit - dealer requests a deposit (pending approval)
router.post('/deposit', authenticateToken, (req, res) => {
  const { amount, notes } = req.body;

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Valid positive amount required' });
  }

  const db = getDb();
  const id = uuidv4();

  db.prepare(`
    INSERT INTO deposit_requests (id, dealer_id, amount, status, notes)
    VALUES (?, ?, ?, 'pending', ?)
  `).run(id, req.dealer.id, amount, notes || null);

  res.status(201).json({
    request: { id, amount, status: 'pending' },
    message: `Deposit request for $${amount.toFixed(2)} submitted. Awaiting approval.`
  });
});

// GET /api/pricing/deposits - list deposit requests
// Admin sees all, distributor sees their sub-dealers', dealer sees own
router.get('/deposits', authenticateToken, (req, res) => {
  const db = getDb();
  let requests;

  if (req.dealer.is_admin) {
    requests = db.prepare(`
      SELECT dr.*, d.company_name, d.contact_name, d.email as dealer_email, d.parent_dealer_id,
             a.company_name as approved_by_name
      FROM deposit_requests dr
      JOIN dealers d ON dr.dealer_id = d.id
      LEFT JOIN dealers a ON dr.approved_by = a.id
      ORDER BY dr.status = 'pending' DESC, dr.created_at DESC
    `).all();
  } else if (req.dealer.role === 'distributor') {
    // Distributor sees their own + their sub-dealers' requests
    requests = db.prepare(`
      SELECT dr.*, d.company_name, d.contact_name, d.email as dealer_email, d.parent_dealer_id,
             a.company_name as approved_by_name
      FROM deposit_requests dr
      JOIN dealers d ON dr.dealer_id = d.id
      LEFT JOIN dealers a ON dr.approved_by = a.id
      WHERE dr.dealer_id = ? OR d.parent_dealer_id = ?
      ORDER BY dr.status = 'pending' DESC, dr.created_at DESC
    `).all(req.dealer.id, req.dealer.id);
  } else {
    requests = db.prepare(`
      SELECT dr.*, d.company_name, d.contact_name
      FROM deposit_requests dr
      JOIN dealers d ON dr.dealer_id = d.id
      WHERE dr.dealer_id = ?
      ORDER BY dr.created_at DESC
    `).all(req.dealer.id);
  }

  res.json({ requests });
});

// PUT /api/pricing/deposits/:id/approve - approve a deposit request (admin or parent distributor)
router.put('/deposits/:id/approve', authenticateToken, (req, res) => {
  const db = getDb();
  const request = db.prepare('SELECT * FROM deposit_requests WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  if (request.status !== 'pending') return res.status(400).json({ error: 'Request is not pending' });

  // Check permission: admin can approve any, distributor can approve their sub-dealers'
  if (!req.dealer.is_admin) {
    if (req.dealer.role === 'distributor') {
      const subDealer = db.prepare('SELECT id FROM dealers WHERE id = ? AND parent_dealer_id = ?').get(request.dealer_id, req.dealer.id);
      if (!subDealer && request.dealer_id !== req.dealer.id) {
        return res.status(403).json({ error: 'Cannot approve this request' });
      }
    } else {
      return res.status(403).json({ error: 'Admin or distributor access required' });
    }
  }

  // Approve: credit the balance
  db.prepare('UPDATE deposit_requests SET status = ?, approved_by = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run('approved', req.dealer.id, request.id);

  db.prepare('UPDATE dealers SET account_balance = account_balance + ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(request.amount, request.dealer_id);

  db.prepare('INSERT INTO account_transactions (id, dealer_id, amount, type, description) VALUES (?, ?, ?, ?, ?)')
    .run(uuidv4(), request.dealer_id, request.amount, 'deposit', 'Approved deposit request');

  const dealer = db.prepare('SELECT company_name, account_balance FROM dealers WHERE id = ?').get(request.dealer_id);
  res.json({ success: true, message: `$${request.amount.toFixed(2)} credited to ${dealer.company_name}`, new_balance: dealer.account_balance });
});

// PUT /api/pricing/deposits/:id/reject - reject a deposit request
router.put('/deposits/:id/reject', authenticateToken, (req, res) => {
  const db = getDb();
  const request = db.prepare('SELECT * FROM deposit_requests WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  if (request.status !== 'pending') return res.status(400).json({ error: 'Request is not pending' });

  if (!req.dealer.is_admin) {
    if (req.dealer.role === 'distributor') {
      const subDealer = db.prepare('SELECT id FROM dealers WHERE id = ? AND parent_dealer_id = ?').get(request.dealer_id, req.dealer.id);
      if (!subDealer && request.dealer_id !== req.dealer.id) {
        return res.status(403).json({ error: 'Cannot reject this request' });
      }
    } else {
      return res.status(403).json({ error: 'Admin or distributor access required' });
    }
  }

  db.prepare('UPDATE deposit_requests SET status = ?, approved_by = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run('rejected', req.dealer.id, request.id);

  res.json({ success: true, message: 'Deposit request rejected' });
});

module.exports = router;
