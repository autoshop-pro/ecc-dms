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

// POST /api/pricing/deposit - dealer adds funds to their account
router.post('/deposit', authenticateToken, (req, res) => {
  const { amount } = req.body;

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Valid positive amount required' });
  }

  // In a real system this would integrate with Stripe/PayPal
  // For now, just record the deposit (admin will approve manually or it goes through)
  const db = getDb();

  db.prepare('UPDATE dealers SET account_balance = account_balance + ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(amount, req.dealer.id);

  db.prepare('INSERT INTO account_transactions (id, dealer_id, amount, type, description) VALUES (?, ?, ?, ?, ?)')
    .run(uuidv4(), req.dealer.id, amount, 'deposit', 'Account top-up');

  const dealer = db.prepare('SELECT account_balance FROM dealers WHERE id = ?').get(req.dealer.id);
  res.json({ account_balance: dealer.account_balance, message: `$${amount.toFixed(2)} added to your account` });
});

module.exports = router;
