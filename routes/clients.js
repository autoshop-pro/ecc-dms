const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../database');
const { authenticateToken } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// GET /api/clients - list clients based on role
// Admin (HQ): sees ALL clients
// Distributor: sees own clients + sub-dealer clients
// Dealer: sees ONLY their own clients
router.get('/', authenticateToken, (req, res) => {
  const db = getDb();
  const { search } = req.query;
  const dealer = req.dealer;

  let baseQuery = `
    SELECT c.*, d.company_name as created_by_company,
      cd.company_name as current_dealer_company,
      (SELECT COUNT(*) FROM vehicles WHERE client_id = c.id) as vehicle_count,
      (SELECT COUNT(*) FROM tune_orders WHERE client_id = c.id) as order_count,
      CASE WHEN c.password_hash IS NOT NULL THEN 1 ELSE 0 END as has_login
    FROM clients c
    LEFT JOIN dealers d ON c.created_by_dealer_id = d.id
    LEFT JOIN dealers cd ON c.current_dealer_id = cd.id
  `;

  let conditions = [];
  let params = [];

  // Role-based filtering
  if (dealer.role === 'admin') {
    // Admin sees everything — no filter
  } else if (dealer.role === 'distributor') {
    // Distributor sees own clients + sub-dealer clients
    conditions.push('(c.current_dealer_id = ? OR c.current_dealer_id IN (SELECT id FROM dealers WHERE parent_dealer_id = ?))');
    params.push(dealer.id, dealer.id);
  } else {
    // Dealer sees only their own clients
    conditions.push('c.current_dealer_id = ?');
    params.push(dealer.id);
  }

  // Search filter
  if (search) {
    conditions.push('(c.first_name LIKE ? OR c.last_name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?)');
    const s = `%${search}%`;
    params.push(s, s, s, s);
  }

  if (conditions.length > 0) {
    baseQuery += ' WHERE ' + conditions.join(' AND ');
  }

  baseQuery += ' ORDER BY c.last_name, c.first_name';

  const clients = db.prepare(baseQuery).all(...params);
  // Strip password_hash from response
  clients.forEach(c => { delete c.password_hash; });
  res.json({ clients });
});

// GET /api/clients/:id - get single client detail
// Admin: can view any client
// Distributor: can view own + sub-dealer clients
// Dealer: can only view own clients
router.get('/:id', authenticateToken, (req, res) => {
  const db = getDb();
  const dealer = req.dealer;

  const client = db.prepare(`
    SELECT c.*, d.company_name as created_by_company, cd.company_name as current_dealer_company,
      CASE WHEN c.password_hash IS NOT NULL THEN 1 ELSE 0 END as has_login
    FROM clients c
    LEFT JOIN dealers d ON c.created_by_dealer_id = d.id
    LEFT JOIN dealers cd ON c.current_dealer_id = cd.id
    WHERE c.id = ?
  `).get(req.params.id);

  if (!client) return res.status(404).json({ error: 'Client not found' });

  // Don't expose the actual password hash to the frontend
  delete client.password_hash;

  // Access check
  if (dealer.role === 'dealer' && client.current_dealer_id !== dealer.id) {
    return res.status(403).json({ error: 'You do not have access to this client' });
  }
  if (dealer.role === 'distributor') {
    const isOwn = client.current_dealer_id === dealer.id;
    const isSubDealer = db.prepare('SELECT id FROM dealers WHERE id = ? AND parent_dealer_id = ?').get(client.current_dealer_id, dealer.id);
    if (!isOwn && !isSubDealer) {
      return res.status(403).json({ error: 'You do not have access to this client' });
    }
  }

  const vehicles = db.prepare('SELECT * FROM vehicles WHERE client_id = ? ORDER BY year DESC').all(client.id);

  const orders = db.prepare(`
    SELECT t.*, v.year, v.make, v.model, v.vin, d.company_name as dealer_name
    FROM tune_orders t
    JOIN vehicles v ON t.vehicle_id = v.id
    JOIN dealers d ON t.dealer_id = d.id
    WHERE t.client_id = ?
    ORDER BY t.created_at DESC
  `).all(client.id);

  // Transfer history
  const transfers = db.prepare(`
    SELECT ct.*,
      fd.company_name as from_dealer_name,
      td.company_name as to_dealer_name
    FROM client_transfers ct
    JOIN dealers fd ON ct.from_dealer_id = fd.id
    JOIN dealers td ON ct.to_dealer_id = td.id
    WHERE ct.client_id = ?
    ORDER BY ct.transferred_at DESC
  `).all(client.id);

  res.json({ client, vehicles, orders, transfers });
});

// POST /api/clients - create new client (assigned to creating dealer)
// If enable_login=true and email is provided, sets up client with a temporary password
router.post('/', authenticateToken, (req, res) => {
  const { first_name, last_name, email, phone, notes, enable_login, temp_password } = req.body;

  if (!first_name || !last_name) {
    return res.status(400).json({ error: 'First and last name are required' });
  }

  const db = getDb();
  const dealerId = req.dealer ? req.dealer.id : (req.client ? req.client.current_dealer_id : null);

  // If enabling login, email is required
  if (enable_login && !email) {
    return res.status(400).json({ error: 'Email is required to enable client login' });
  }

  // Check for duplicate email if provided
  if (email) {
    const existingClient = db.prepare('SELECT id FROM clients WHERE LOWER(email) = LOWER(?)').get(email.trim());
    if (existingClient) {
      return res.status(400).json({ error: 'A client with this email already exists' });
    }
    // Also check dealer emails
    const existingDealer = db.prepare('SELECT id FROM dealers WHERE LOWER(email) = LOWER(?)').get(email.trim());
    if (existingDealer) {
      return res.status(400).json({ error: 'This email is already registered as a dealer account' });
    }
  }

  const id = uuidv4();
  let passwordHash = null;

  if (enable_login && email) {
    // Generate a temp password or use the one provided
    const password = temp_password || (first_name.toLowerCase().replace(/\s/g, '') + '123');
    passwordHash = bcrypt.hashSync(password, 10);
  }

  db.prepare(`
    INSERT INTO clients (id, first_name, last_name, email, phone, notes, password_hash, created_by_dealer_id, current_dealer_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, first_name, last_name, email || null, phone || null, notes || null, passwordHash, dealerId, dealerId);

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
  const response = { client };

  if (enable_login && email) {
    response.login_enabled = true;
    response.temp_password = temp_password || (first_name.toLowerCase().replace(/\s/g, '') + '123');
    response.message = `Client can now log in with email: ${email} and the temporary password. They should change it on first login.`;
  }

  res.status(201).json(response);
});

// PUT /api/clients/:id/enable-login - enable login for an existing client
router.put('/:id/enable-login', authenticateToken, (req, res) => {
  const db = getDb();
  const { temp_password } = req.body;

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  if (!client.email) {
    return res.status(400).json({ error: 'Client must have an email address to enable login' });
  }

  if (client.password_hash) {
    return res.status(400).json({ error: 'Client login is already enabled' });
  }

  const password = temp_password || (client.first_name.toLowerCase().replace(/\s/g, '') + '123');
  const hash = bcrypt.hashSync(password, 10);

  db.prepare("UPDATE clients SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(hash, client.id);

  res.json({
    message: `Login enabled. Temporary password: ${password}`,
    temp_password: password
  });
});

// PUT /api/clients/:id/reset-password - reset client password (dealer action)
router.put('/:id/reset-password', authenticateToken, (req, res) => {
  if (req.userType === 'client') {
    return res.status(403).json({ error: 'Only dealers can reset client passwords' });
  }

  const db = getDb();
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const password = client.first_name.toLowerCase().replace(/\s/g, '') + '123';
  const hash = bcrypt.hashSync(password, 10);

  db.prepare("UPDATE clients SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(hash, client.id);

  res.json({
    message: `Password reset. New temporary password: ${password}`,
    temp_password: password
  });
});

// PUT /api/clients/:id - update client info
router.put('/:id', authenticateToken, (req, res) => {
  const { first_name, last_name, email, phone, notes } = req.body;
  const db = getDb();
  const dealer = req.dealer;

  const existing = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Client not found' });

  // Only the owning dealer, their distributor, or admin can edit
  if (dealer.role === 'dealer' && existing.current_dealer_id !== dealer.id) {
    return res.status(403).json({ error: 'You can only edit your own clients' });
  }

  db.prepare(`
    UPDATE clients SET first_name = ?, last_name = ?, email = ?, phone = ?, notes = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(first_name, last_name, email || null, phone || null, notes || null, req.params.id);

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  res.json({ client });
});

// POST /api/clients/search-transfer - search for a client to transfer
// Requires BOTH full name AND phone number to find the client
// This prevents dealers from browsing other dealers' clients
router.post('/search-transfer', authenticateToken, (req, res) => {
  const { first_name, last_name, phone } = req.body;

  if (!first_name || !last_name || !phone) {
    return res.status(400).json({ error: 'Full name (first + last) and phone number are required to search for a client transfer' });
  }

  const db = getDb();
  const dealer = req.dealer;

  // Exact match on name (case-insensitive), exact match on phone (strip non-digits for comparison)
  const cleanPhone = phone.replace(/\D/g, '');

  const clients = db.prepare(`
    SELECT c.id, c.first_name, c.last_name, c.phone, c.email,
      cd.company_name as current_dealer_company,
      (SELECT COUNT(*) FROM vehicles WHERE client_id = c.id) as vehicle_count,
      (SELECT COUNT(*) FROM tune_orders WHERE client_id = c.id) as order_count
    FROM clients c
    LEFT JOIN dealers cd ON c.current_dealer_id = cd.id
    WHERE LOWER(c.first_name) = LOWER(?)
      AND LOWER(c.last_name) = LOWER(?)
      AND REPLACE(REPLACE(REPLACE(REPLACE(c.phone, '-', ''), '(', ''), ')', ''), ' ', '') = ?
  `).all(first_name.trim(), last_name.trim(), cleanPhone);

  if (clients.length === 0) {
    return res.json({ clients: [], message: 'No matching client found. Please verify the full name and phone number.' });
  }

  res.json({ clients });
});

// POST /api/clients/:id/transfer - transfer a client to the requesting dealer
router.post('/:id/transfer', authenticateToken, (req, res) => {
  const db = getDb();
  const dealer = req.dealer;

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  if (client.current_dealer_id === dealer.id) {
    return res.status(400).json({ error: 'This client is already in your database' });
  }

  const fromDealerId = client.current_dealer_id;

  // Log the transfer
  db.prepare(`
    INSERT INTO client_transfers (id, client_id, from_dealer_id, to_dealer_id)
    VALUES (?, ?, ?, ?)
  `).run(uuidv4(), client.id, fromDealerId, dealer.id);

  // Update ownership
  db.prepare(`
    UPDATE clients SET current_dealer_id = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(dealer.id, client.id);

  const updated = db.prepare(`
    SELECT c.*, cd.company_name as current_dealer_company
    FROM clients c
    LEFT JOIN dealers cd ON c.current_dealer_id = cd.id
    WHERE c.id = ?
  `).get(client.id);

  res.json({ client: updated, message: 'Client transferred successfully' });
});

module.exports = router;
