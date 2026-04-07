const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../database');
const { generateToken, authenticateToken } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const db = getDb();
  const dealer = db.prepare('SELECT * FROM dealers WHERE email = ?').get(email.toLowerCase().trim());

  if (!dealer) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  if (!dealer.is_active) {
    return res.status(401).json({ error: 'Account is deactivated. Contact ECC support.' });
  }

  if (!bcrypt.compareSync(password, dealer.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = generateToken(dealer);

  res.json({
    token,
    dealer: {
      id: dealer.id,
      company_name: dealer.company_name,
      contact_name: dealer.contact_name,
      email: dealer.email,
      phone: dealer.phone,
      address: dealer.address,
      city: dealer.city,
      province: dealer.province,
      postal_code: dealer.postal_code,
      account_balance: dealer.account_balance || dealer.credit_balance || 0,
      is_admin: dealer.is_admin,
      role: dealer.role || 'dealer',
      parent_dealer_id: dealer.parent_dealer_id,
      discount_pct: dealer.discount_pct || 0
    }
  });
});

// GET /api/auth/me
router.get('/me', authenticateToken, (req, res) => {
  const db = getDb();
  const dealer = db.prepare(`
    SELECT id, company_name, contact_name, email, phone, address, city, province, postal_code, country,
           account_balance, is_admin, role, parent_dealer_id, discount_pct, created_at
    FROM dealers WHERE id = ?
  `).get(req.dealer.id);

  res.json({ dealer });
});

// PUT /api/auth/password
router.put('/password', authenticateToken, (req, res) => {
  const { current_password, new_password } = req.body;
  const db = getDb();

  const dealer = db.prepare('SELECT password_hash FROM dealers WHERE id = ?').get(req.dealer.id);

  if (!bcrypt.compareSync(current_password, dealer.password_hash)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }

  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE dealers SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?').run(hash, req.dealer.id);

  res.json({ message: 'Password updated successfully' });
});

module.exports = router;
