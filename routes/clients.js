const express = require('express');
const { getDb } = require('../database');
const { authenticateToken } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// GET /api/clients - list all clients (shared across dealers)
router.get('/', authenticateToken, (req, res) => {
  const db = getDb();
  const { search } = req.query;

  let query = `
    SELECT c.*, d.company_name as created_by_company,
      (SELECT COUNT(*) FROM vehicles WHERE client_id = c.id) as vehicle_count,
      (SELECT COUNT(*) FROM tune_orders WHERE client_id = c.id) as order_count
    FROM clients c
    LEFT JOIN dealers d ON c.created_by_dealer_id = d.id
  `;

  if (search) {
    query += ` WHERE c.first_name LIKE ? OR c.last_name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?`;
    const s = `%${search}%`;
    const clients = db.prepare(query + ' ORDER BY c.last_name, c.first_name').all(s, s, s, s);
    return res.json({ clients });
  }

  const clients = db.prepare(query + ' ORDER BY c.last_name, c.first_name').all();
  res.json({ clients });
});

// GET /api/clients/:id
router.get('/:id', authenticateToken, (req, res) => {
  const db = getDb();
  const client = db.prepare(`
    SELECT c.*, d.company_name as created_by_company
    FROM clients c
    LEFT JOIN dealers d ON c.created_by_dealer_id = d.id
    WHERE c.id = ?
  `).get(req.params.id);

  if (!client) return res.status(404).json({ error: 'Client not found' });

  const vehicles = db.prepare('SELECT * FROM vehicles WHERE client_id = ? ORDER BY year DESC').all(client.id);

  const orders = db.prepare(`
    SELECT t.*, v.year, v.make, v.model, v.vin, d.company_name as dealer_name
    FROM tune_orders t
    JOIN vehicles v ON t.vehicle_id = v.id
    JOIN dealers d ON t.dealer_id = d.id
    WHERE t.client_id = ?
    ORDER BY t.created_at DESC
  `).all(client.id);

  res.json({ client, vehicles, orders });
});

// POST /api/clients
router.post('/', authenticateToken, (req, res) => {
  const { first_name, last_name, email, phone, notes } = req.body;

  if (!first_name || !last_name) {
    return res.status(400).json({ error: 'First and last name are required' });
  }

  const db = getDb();
  const id = uuidv4();

  db.prepare(`
    INSERT INTO clients (id, first_name, last_name, email, phone, notes, created_by_dealer_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, first_name, last_name, email || null, phone || null, notes || null, req.dealer.id);

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
  res.status(201).json({ client });
});

// PUT /api/clients/:id
router.put('/:id', authenticateToken, (req, res) => {
  const { first_name, last_name, email, phone, notes } = req.body;
  const db = getDb();

  const existing = db.prepare('SELECT id FROM clients WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Client not found' });

  db.prepare(`
    UPDATE clients SET first_name = ?, last_name = ?, email = ?, phone = ?, notes = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(first_name, last_name, email || null, phone || null, notes || null, req.params.id);

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  res.json({ client });
});

module.exports = router;
