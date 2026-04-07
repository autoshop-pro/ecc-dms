const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../database');
const { generateToken, authenticateToken, requireDealer } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login - unified login (checks dealers first, then clients)
router.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const db = getDb();
  const emailLower = email.toLowerCase().trim();

  // Try dealer login first
  const dealer = db.prepare('SELECT * FROM dealers WHERE email = ?').get(emailLower);

  if (dealer) {
    if (!dealer.is_active) {
      return res.status(401).json({ error: 'Account is deactivated. Contact ECC support.' });
    }
    if (!bcrypt.compareSync(password, dealer.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = generateToken(dealer, 'dealer');
    return res.json({
      token,
      user_type: 'dealer',
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
  }

  // Try client login
  const client = db.prepare('SELECT * FROM clients WHERE LOWER(email) = ?').get(emailLower);

  if (client) {
    if (!client.is_active) {
      return res.status(401).json({ error: 'Account is deactivated. Contact your dealer.' });
    }
    if (!client.password_hash) {
      return res.status(401).json({ error: 'Your account has not been activated yet. Contact your dealer to set up your login.' });
    }
    if (!bcrypt.compareSync(password, client.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = generateToken(client, 'client');
    return res.json({
      token,
      user_type: 'client',
      client: {
        id: client.id,
        first_name: client.first_name,
        last_name: client.last_name,
        email: client.email,
        phone: client.phone,
        current_dealer_id: client.current_dealer_id
      }
    });
  }

  return res.status(401).json({ error: 'Invalid email or password' });
});

// GET /api/auth/me
router.get('/me', authenticateToken, (req, res) => {
  const db = getDb();

  if (req.userType === 'client') {
    const client = db.prepare(`
      SELECT c.id, c.first_name, c.last_name, c.email, c.phone, c.current_dealer_id, c.created_at,
        d.company_name as dealer_name
      FROM clients c
      LEFT JOIN dealers d ON c.current_dealer_id = d.id
      WHERE c.id = ?
    `).get(req.client.id);
    return res.json({ user_type: 'client', client });
  }

  const dealer = db.prepare(`
    SELECT id, company_name, contact_name, email, phone, address, city, province, postal_code, country,
           account_balance, is_admin, role, parent_dealer_id, discount_pct, created_at
    FROM dealers WHERE id = ?
  `).get(req.dealer.id);

  res.json({ user_type: 'dealer', dealer });
});

// PUT /api/auth/password
router.put('/password', authenticateToken, (req, res) => {
  const { current_password, new_password } = req.body;
  const db = getDb();

  if (req.userType === 'client') {
    const client = db.prepare('SELECT password_hash FROM clients WHERE id = ?').get(req.client.id);
    if (client.password_hash && !bcrypt.compareSync(current_password, client.password_hash)) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    const hash = bcrypt.hashSync(new_password, 10);
    db.prepare("UPDATE clients SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(hash, req.client.id);
    return res.json({ message: 'Password updated successfully' });
  }

  const dealer = db.prepare('SELECT password_hash FROM dealers WHERE id = ?').get(req.dealer.id);
  if (!bcrypt.compareSync(current_password, dealer.password_hash)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }

  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare("UPDATE dealers SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(hash, req.dealer.id);

  res.json({ message: 'Password updated successfully' });
});

module.exports = router;
