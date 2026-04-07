const express = require('express');
const multer = require('multer');
const path = require('path');
const { getDb, generateHardwareOrderNumber } = require('../database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// CSV upload config (store in memory for parsing)
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  }
});

// Simple CSV parser (handles quoted fields with commas)
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };

  function parseLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === ',' && !inQuotes) {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    fields.push(current.trim());
    return fields;
  }

  const headers = parseLine(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, '_'));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseLine(lines[i]);
    if (vals.length < 2) continue; // skip empty/malformed rows
    const row = {};
    headers.forEach((h, idx) => { row[h] = vals[idx] || ''; });
    rows.push(row);
  }
  return { headers, rows };
}

// GET /api/hardware - list products (pricing based on dealer role)
// Query params: ?type=tools|hardware  (optional filter by product_type)
router.get('/', authenticateToken, (req, res) => {
  const db = getDb();
  const typeFilter = req.query.type;
  let products;
  if (typeFilter && ['tools', 'hardware'].includes(typeFilter)) {
    products = db.prepare('SELECT * FROM hardware_products WHERE is_active = 1 AND product_type = ? ORDER BY category, name').all(typeFilter);
  } else {
    products = db.prepare('SELECT * FROM hardware_products WHERE is_active = 1 ORDER BY category, name').all();
  }

  // Return role-appropriate pricing
  const role = (req.dealer && req.dealer.role) || 'dealer';
  const mapped = products.map(p => ({
    ...p,
    your_price: role === 'distributor' ? p.distributor_price : p.dealer_price,
    msrp: p.base_price
  }));

  res.json({ products: mapped });
});

// GET /api/hardware/kits - list kits with included products
router.get('/kits', authenticateToken, (req, res) => {
  const db = getDb();
  const kits = db.prepare('SELECT * FROM hardware_kits WHERE is_active = 1 ORDER BY sort_order, name').all();
  const role = req.dealer.role || 'dealer';

  const mapped = kits.map(kit => {
    // Get kit items with product details
    const items = db.prepare(`
      SELECT ki.quantity, p.id as product_id, p.name, p.sku, p.description, p.category, p.stock_qty
      FROM hardware_kit_items ki
      JOIN hardware_products p ON ki.product_id = p.id
      WHERE ki.kit_id = ?
    `).all(kit.id);

    // Check if all items are in stock
    const inStock = items.every(item => item.stock_qty >= item.quantity);

    return {
      ...kit,
      your_price: role === 'distributor' ? kit.distributor_price : kit.dealer_price,
      msrp: kit.base_price,
      savings_pct: Math.round((1 - (role === 'distributor' ? kit.distributor_price : kit.dealer_price) / kit.base_price) * 100),
      in_stock: inStock,
      items
    };
  });

  res.json({ kits: mapped });
});

// POST /api/hardware/kits/order - order a kit (deducts stock for all items, charges kit price)
router.post('/kits/order', authenticateToken, (req, res) => {
  const { kit_id, notes } = req.body;
  if (!kit_id) return res.status(400).json({ error: 'Kit ID is required' });

  const db = getDb();
  const role = req.dealer.role || 'dealer';

  const kit = db.prepare('SELECT * FROM hardware_kits WHERE id = ? AND is_active = 1').get(kit_id);
  if (!kit) return res.status(404).json({ error: 'Kit not found' });

  const kitPrice = role === 'distributor' ? kit.distributor_price : kit.dealer_price;

  // Get kit items and verify stock
  const items = db.prepare(`
    SELECT ki.quantity, p.*
    FROM hardware_kit_items ki
    JOIN hardware_products p ON ki.product_id = p.id
    WHERE ki.kit_id = ?
  `).all(kit_id);

  for (const item of items) {
    if (item.stock_qty < item.quantity) {
      return res.status(400).json({ error: `Insufficient stock for ${item.name}. Need ${item.quantity}, have ${item.stock_qty}` });
    }
  }

  // Check balance
  const dealer = db.prepare('SELECT account_balance FROM dealers WHERE id = ?').get(req.dealer.id);
  if (dealer.account_balance < kitPrice) {
    return res.status(400).json({ error: `Insufficient balance. Need $${kitPrice.toFixed(2)}, have $${dealer.account_balance.toFixed(2)}` });
  }

  // Create hardware order
  const orderId = uuidv4();
  const orderNumber = generateHardwareOrderNumber();

  db.prepare(`
    INSERT INTO hardware_orders (id, order_number, dealer_id, status, total_amount, notes)
    VALUES (?, ?, ?, 'confirmed', ?, ?)
  `).run(orderId, orderNumber, req.dealer.id, kitPrice, notes || `Kit: ${kit.name}`);

  // Create line items + deduct stock
  for (const item of items) {
    const unitPrice = role === 'distributor' ? item.distributor_price : item.dealer_price;
    db.prepare('INSERT INTO hardware_order_items (id, order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?, ?)')
      .run(uuidv4(), orderId, item.id, item.quantity, unitPrice);
    db.prepare('UPDATE hardware_products SET stock_qty = stock_qty - ? WHERE id = ?')
      .run(item.quantity, item.id);
  }

  // Deduct balance
  db.prepare('UPDATE dealers SET account_balance = account_balance - ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(kitPrice, req.dealer.id);
  db.prepare('INSERT INTO account_transactions (id, dealer_id, amount, type, description) VALUES (?, ?, ?, ?, ?)')
    .run(uuidv4(), req.dealer.id, -kitPrice, 'charge', `Hardware kit: ${kit.name} (${orderNumber})`);

  const order = db.prepare('SELECT * FROM hardware_orders WHERE id = ?').get(orderId);
  res.status(201).json({ order });
});

// POST /api/hardware/kits - create a new kit (admin or distributor)
router.post('/kits', authenticateToken, (req, res) => {
  if (!req.dealer.is_admin && req.dealer.role !== 'distributor') {
    return res.status(403).json({ error: 'Admin or distributor access required' });
  }
  const { name, sku, description, badge, base_price, dealer_price, distributor_price, sort_order, items } = req.body;
  if (!name || base_price == null || dealer_price == null) {
    return res.status(400).json({ error: 'Name, base price, and dealer price are required' });
  }

  const db = getDb();
  const kitId = uuidv4();
  db.prepare(`
    INSERT INTO hardware_kits (id, name, sku, description, badge, base_price, dealer_price, distributor_price, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(kitId, name, sku || null, description, badge || null, base_price, dealer_price, distributor_price || 0, sort_order || 0);

  // Add kit items
  if (items && items.length) {
    const stmt = db.prepare('INSERT INTO hardware_kit_items (id, kit_id, product_id, quantity) VALUES (?, ?, ?, ?)');
    for (const item of items) {
      stmt.run(uuidv4(), kitId, item.product_id, item.quantity || 1);
    }
  }

  const kit = db.prepare('SELECT * FROM hardware_kits WHERE id = ?').get(kitId);
  res.status(201).json({ kit });
});

// PUT /api/hardware/kits/:id - update a kit (admin or distributor)
router.put('/kits/:id', authenticateToken, (req, res) => {
  if (!req.dealer.is_admin && req.dealer.role !== 'distributor') {
    return res.status(403).json({ error: 'Admin or distributor access required' });
  }
  const { name, sku, description, badge, base_price, dealer_price, distributor_price, sort_order, is_active, items } = req.body;
  const db = getDb();

  db.prepare(`
    UPDATE hardware_kits SET name=?, sku=?, description=?, badge=?, base_price=?, dealer_price=?, distributor_price=?,
      sort_order=?, is_active=?, updated_at=datetime('now')
    WHERE id = ?
  `).run(name, sku, description, badge, base_price, dealer_price, distributor_price || 0, sort_order || 0, is_active != null ? (is_active ? 1 : 0) : 1, req.params.id);

  // Replace kit items if provided
  if (items) {
    db.prepare('DELETE FROM hardware_kit_items WHERE kit_id = ?').run(req.params.id);
    const stmt = db.prepare('INSERT INTO hardware_kit_items (id, kit_id, product_id, quantity) VALUES (?, ?, ?, ?)');
    for (const item of items) {
      stmt.run(uuidv4(), req.params.id, item.product_id, item.quantity || 1);
    }
  }

  const kit = db.prepare('SELECT * FROM hardware_kits WHERE id = ?').get(req.params.id);
  res.json({ kit });
});

// DELETE /api/hardware/kits/:id - deactivate a kit (admin or distributor)
router.delete('/kits/:id', authenticateToken, (req, res) => {
  if (!req.dealer.is_admin && req.dealer.role !== 'distributor') {
    return res.status(403).json({ error: 'Admin or distributor access required' });
  }
  const db = getDb();
  db.prepare('UPDATE hardware_kits SET is_active = 0, updated_at = datetime(\'now\') WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// GET /api/hardware/orders - list hardware orders (MUST be before /:id)
router.get('/orders', authenticateToken, (req, res) => {
  const db = getDb();
  let orders;
  if (req.dealer.is_admin) {
    orders = db.prepare(`
      SELECT ho.*, d.company_name as dealer_name
      FROM hardware_orders ho
      JOIN dealers d ON ho.dealer_id = d.id
      ORDER BY ho.created_at DESC
    `).all();
  } else {
    orders = db.prepare('SELECT * FROM hardware_orders WHERE dealer_id = ? ORDER BY created_at DESC').all(req.dealer.id);
  }
  res.json({ orders });
});

// GET /api/hardware/:id
router.get('/:id', authenticateToken, (req, res) => {
  const db = getDb();
  const product = db.prepare('SELECT * FROM hardware_products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const role = req.dealer.role || 'dealer';
  product.your_price = role === 'distributor' ? product.distributor_price : product.dealer_price;
  product.msrp = product.base_price;
  res.json({ product });
});

// POST /api/hardware - create product (admin or distributor)
router.post('/', authenticateToken, (req, res) => {
  if (!req.dealer.is_admin && req.dealer.role !== 'distributor') {
    return res.status(403).json({ error: 'Admin or distributor access required' });
  }
  const { name, sku, description, category, product_type, base_price, dealer_price, distributor_price, stock_qty, image_url } = req.body;

  if (!name || base_price == null) {
    return res.status(400).json({ error: 'Name and base price are required' });
  }

  const db = getDb();
  const id = uuidv4();

  db.prepare(`
    INSERT INTO hardware_products (id, name, sku, description, category, product_type, base_price, dealer_price, distributor_price, stock_qty, image_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, sku, description, category, product_type || 'tools', base_price, dealer_price || 0, distributor_price || 0, stock_qty || 0, image_url);

  const product = db.prepare('SELECT * FROM hardware_products WHERE id = ?').get(id);
  res.status(201).json({ product });
});

// PUT /api/hardware/:id - update product (admin or distributor)
router.put('/:id', authenticateToken, (req, res) => {
  if (!req.dealer.is_admin && req.dealer.role !== 'distributor') {
    return res.status(403).json({ error: 'Admin or distributor access required' });
  }
  const { name, sku, description, category, product_type, base_price, dealer_price, distributor_price, stock_qty, image_url, is_active } = req.body;
  const db = getDb();

  db.prepare(`
    UPDATE hardware_products SET name=?, sku=?, description=?, category=?, product_type=?, base_price=?, dealer_price=?, distributor_price=?,
      stock_qty=?, image_url=?, is_active=?, updated_at=datetime('now')
    WHERE id = ?
  `).run(name, sku, description, category, product_type || 'tools', base_price, dealer_price, distributor_price, stock_qty, image_url, is_active ? 1 : 0, req.params.id);

  const product = db.prepare('SELECT * FROM hardware_products WHERE id = ?').get(req.params.id);
  res.json({ product });
});

// POST /api/hardware/order - place hardware order (deducts from account balance)
router.post('/order', authenticateToken, (req, res) => {
  const { items, notes } = req.body; // items: [{product_id, quantity}]

  if (!items || !items.length) {
    return res.status(400).json({ error: 'At least one item is required' });
  }

  const db = getDb();
  const role = req.dealer.role || 'dealer';

  // Calculate total
  let totalAmount = 0;
  const lineItems = [];
  for (const item of items) {
    const product = db.prepare('SELECT * FROM hardware_products WHERE id = ? AND is_active = 1').get(item.product_id);
    if (!product) return res.status(400).json({ error: `Product not found: ${item.product_id}` });
    if (product.stock_qty < item.quantity) {
      return res.status(400).json({ error: `Insufficient stock for ${product.name}. Available: ${product.stock_qty}` });
    }

    const unitPrice = role === 'distributor' ? product.distributor_price : product.dealer_price;
    totalAmount += unitPrice * item.quantity;
    lineItems.push({ product, quantity: item.quantity, unitPrice });
  }

  // Check balance
  const dealer = db.prepare('SELECT account_balance FROM dealers WHERE id = ?').get(req.dealer.id);
  if (dealer.account_balance < totalAmount) {
    return res.status(400).json({ error: `Insufficient balance. Need $${totalAmount.toFixed(2)}, have $${dealer.account_balance.toFixed(2)}` });
  }

  // Create order
  const orderId = uuidv4();
  const orderNumber = generateHardwareOrderNumber();

  db.prepare(`
    INSERT INTO hardware_orders (id, order_number, dealer_id, status, total_amount, notes)
    VALUES (?, ?, ?, 'confirmed', ?, ?)
  `).run(orderId, orderNumber, req.dealer.id, totalAmount, notes);

  // Create line items + deduct stock
  for (const li of lineItems) {
    db.prepare('INSERT INTO hardware_order_items (id, order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?, ?)')
      .run(uuidv4(), orderId, li.product.id, li.quantity, li.unitPrice);
    db.prepare('UPDATE hardware_products SET stock_qty = stock_qty - ? WHERE id = ?')
      .run(li.quantity, li.product.id);
  }

  // Deduct balance
  db.prepare('UPDATE dealers SET account_balance = account_balance - ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(totalAmount, req.dealer.id);
  db.prepare('INSERT INTO account_transactions (id, dealer_id, amount, type, description) VALUES (?, ?, ?, ?, ?)')
    .run(uuidv4(), req.dealer.id, -totalAmount, 'charge', `Hardware order ${orderNumber}`);

  const order = db.prepare('SELECT * FROM hardware_orders WHERE id = ?').get(orderId);
  res.status(201).json({ order });
});

// GET /api/hardware/csv-template - download a blank CSV template
router.get('/csv-template', authenticateToken, (req, res) => {
  if (!req.dealer || (!req.dealer.is_admin && req.dealer.role !== 'distributor')) {
    return res.status(403).json({ error: 'Admin or distributor access required' });
  }

  const csv = [
    'name,sku,description,category,product_type,base_price,dealer_price,distributor_price,stock_qty',
    '"ECC GPF/OPF Emulator","ECC-GPF-02","Gasoline particulate filter emulator module v2","Emulators","hardware",199,149,119,50',
    '"ECC Lambda Sensor Emulator","ECC-LAM-01","Wideband lambda sensor signal emulator","Emulators","hardware",159,119,99,30',
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="ecc-hardware-template.csv"');
  res.send(csv);
});

// POST /api/hardware/import-csv - bulk import products from CSV
router.post('/import-csv', authenticateToken, csvUpload.single('file'), (req, res) => {
  if (!req.dealer || (!req.dealer.is_admin && req.dealer.role !== 'distributor')) {
    return res.status(403).json({ error: 'Admin or distributor access required' });
  }

  if (!req.file) return res.status(400).json({ error: 'No CSV file uploaded' });

  const text = req.file.buffer.toString('utf-8');
  const { headers, rows } = parseCSV(text);

  if (!rows.length) {
    return res.status(400).json({ error: 'CSV file is empty or has no data rows' });
  }

  // Validate required columns
  const requiredCols = ['name'];
  const missing = requiredCols.filter(c => !headers.includes(c));
  if (missing.length) {
    return res.status(400).json({ error: `Missing required columns: ${missing.join(', ')}. Required: name. Optional: sku, description, category, product_type, base_price, dealer_price, distributor_price, stock_qty` });
  }

  const db = getDb();
  const mode = req.body.mode || 'add'; // 'add' = insert new only, 'upsert' = update by SKU if exists

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const errors = [];

  const insertStmt = db.prepare(`
    INSERT INTO hardware_products (id, name, sku, description, category, product_type, base_price, dealer_price, distributor_price, stock_qty)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateStmt = db.prepare(`
    UPDATE hardware_products SET name=?, description=?, category=?, product_type=?, base_price=?, dealer_price=?, distributor_price=?,
      stock_qty=?, updated_at=datetime('now')
    WHERE sku = ?
  `);

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 2; // account for header + 0-index

    if (!r.name) {
      errors.push(`Row ${rowNum}: missing name, skipped`);
      skipped++;
      continue;
    }

    const name = r.name;
    const sku = r.sku || null;
    const description = r.description || '';
    const category = r.category || 'Uncategorized';
    const productType = r.product_type || 'hardware';
    const basePrice = parseFloat(r.base_price) || 0;
    const dealerPrice = parseFloat(r.dealer_price) || 0;
    const distributorPrice = parseFloat(r.distributor_price) || 0;
    const stockQty = parseInt(r.stock_qty) || 0;

    try {
      if (mode === 'upsert' && sku) {
        const existing = db.prepare('SELECT id FROM hardware_products WHERE sku = ?').get(sku);
        if (existing) {
          updateStmt.run(name, description, category, productType, basePrice, dealerPrice, distributorPrice, stockQty, sku);
          updated++;
          continue;
        }
      }

      // Check for duplicate SKU on insert
      if (sku) {
        const existing = db.prepare('SELECT id FROM hardware_products WHERE sku = ?').get(sku);
        if (existing) {
          errors.push(`Row ${rowNum}: SKU "${sku}" already exists, skipped`);
          skipped++;
          continue;
        }
      }

      insertStmt.run(uuidv4(), name, sku, description, category, productType, basePrice, dealerPrice, distributorPrice, stockQty);
      inserted++;
    } catch (err) {
      errors.push(`Row ${rowNum}: ${err.message}`);
      skipped++;
    }
  }

  res.json({
    message: `Import complete: ${inserted} added, ${updated} updated, ${skipped} skipped`,
    inserted,
    updated,
    skipped,
    total_rows: rows.length,
    errors: errors.length ? errors : undefined
  });
});

module.exports = router;
