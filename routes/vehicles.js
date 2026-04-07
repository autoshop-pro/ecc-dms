const express = require('express');
const { getDb } = require('../database');
const { authenticateToken } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const https = require('https');

const router = express.Router();

// GET /api/vehicles/decode-vin/:vin - NHTSA VIN decoder
router.get('/decode-vin/:vin', authenticateToken, (req, res) => {
  const vin = req.params.vin.toUpperCase().trim();

  if (vin.length !== 17) {
    return res.status(400).json({ error: 'VIN must be exactly 17 characters' });
  }

  const url = `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/${vin}?format=json`;

  https.get(url, (response) => {
    let data = '';
    response.on('data', chunk => data += chunk);
    response.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        const result = parsed.Results[0];

        const decoded = {
          vin: vin,
          year: result.ModelYear ? parseInt(result.ModelYear) : null,
          make: result.Make || null,
          model: result.Model || null,
          engine: [
            result.DisplacementL ? `${result.DisplacementL}L` : '',
            result.EngineCylinders ? `${result.EngineCylinders}cyl` : '',
            result.FuelTypePrimary || ''
          ].filter(Boolean).join(' ') || null,
          engine_code: result.EngineModel || null,
          transmission: result.TransmissionStyle || null,
          body_class: result.BodyClass || null,
          drive_type: result.DriveType || null,
          plant_city: result.PlantCity || null,
          plant_country: result.PlantCountry || null,
          turbo: result.Turbo || null,
          displacement: result.DisplacementL || null,
          cylinders: result.EngineCylinders || null,
          fuel_type: result.FuelTypePrimary || null,
          horsepower: result.EngineHP || null
        };

        res.json({ decoded });
      } catch (err) {
        res.status(500).json({ error: 'Failed to parse VIN data' });
      }
    });
  }).on('error', (err) => {
    res.status(500).json({ error: 'Failed to reach VIN decoder service' });
  });
});

// GET /api/vehicles - list vehicles, optionally by client
router.get('/', authenticateToken, (req, res) => {
  const db = getDb();
  const { client_id, search } = req.query;

  let query = `
    SELECT v.*, c.first_name, c.last_name, c.email as client_email
    FROM vehicles v
    JOIN clients c ON v.client_id = c.id
  `;
  const params = [];

  if (client_id) {
    query += ' WHERE v.client_id = ?';
    params.push(client_id);
  } else if (search) {
    query += ' WHERE v.vin LIKE ? OR v.make LIKE ? OR v.model LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ?';
    const s = `%${search}%`;
    params.push(s, s, s, s, s);
  }

  query += ' ORDER BY v.created_at DESC';
  const vehicles = db.prepare(query).all(...params);
  res.json({ vehicles });
});

// POST /api/vehicles
router.post('/', authenticateToken, (req, res) => {
  const { client_id, vin, year, make, model, engine, engine_code, transmission, ecu_type, tcu_type, notes } = req.body;

  if (!client_id) return res.status(400).json({ error: 'Client ID is required' });

  const db = getDb();
  const id = uuidv4();

  db.prepare(`
    INSERT INTO vehicles (id, client_id, vin, year, make, model, engine, engine_code, transmission, ecu_type, tcu_type, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, client_id, vin || null, year || null, make || null, model || null, engine || null, engine_code || null, transmission || null, ecu_type || null, tcu_type || null, notes || null);

  const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id);
  res.status(201).json({ vehicle });
});

// PUT /api/vehicles/:id
router.put('/:id', authenticateToken, (req, res) => {
  const { vin, year, make, model, engine, engine_code, transmission, ecu_type, tcu_type, notes } = req.body;
  const db = getDb();

  db.prepare(`
    UPDATE vehicles SET vin=?, year=?, make=?, model=?, engine=?, engine_code=?, transmission=?, ecu_type=?, tcu_type=?, notes=?, updated_at=datetime('now')
    WHERE id = ?
  `).run(vin, year, make, model, engine, engine_code, transmission, ecu_type, tcu_type, notes, req.params.id);

  const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(req.params.id);
  res.json({ vehicle });
});

module.exports = router;
