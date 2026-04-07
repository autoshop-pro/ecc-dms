const express = require('express');
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
      (SELECT COUNT(*) FROM tune_orders WHERE client_id = c.id) as order_count
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
    SELECT c.*, d.company_name as created_by_company, cd.company_name as current_dealer_company
    FROM clients c
    LEFT JOIN dealers d ON c.created_by_dealer_id = d.id
    LEFT JOIN dealers cd ON c.current_dealer_id = cd.id
    WHERE c.id = ?
  `).get(req.params.id);

  if (!client) return res.status(404).json({ error: 'Client not found' });

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
router.post('/', authenticateToken, (req, res) => {
  const { first_name, last_name, email, phone, notes } = req.body;

  if (!first_name || !last_name) {
    return res.status(400).json({ error: 'First and last name are required' });
  }

  const db = getDb();
  const id = uuidv4();

  db.prepare(`
    INSERT INTO clients (id, first_name, last_name, email, phone, notes, created_by_dealer_id, current_dealer_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, first_name, last_name, email || null, phone || null, notes || null, req.dealer.id, req.dealer.id);

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
  res.status(201).json({ client });
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
