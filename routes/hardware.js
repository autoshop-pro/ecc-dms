const express = require('express');
const { getDb, generateHardwareOrderNumber } = require('../database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// GET /api/hardware - list products (pricing based on dealer role)
router.get('/', authenticateToken, (req, res) => {
  const db = getDb();
  const products = db.prepare('SELECT * FROM hardware_products WHERE is_active = 1 ORDER BY category, name').all();

  // Return role-appropriate pricing
  const role = req.dealer.role || 'dealer';
  const mapped = products.map(p => ({
    ...p,
    your_price: role === 'distributor' ? p.distributor_price : p.dealer_price,
    msrp: p.base_price
  }));

  res.json({ products: mapped });
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

// POST /api/hardware - create product (admin)
router.post('/', authenticateToken, requireAdmin, (req, res) => {
  const { name, sku, description, category, base_price, dealer_price, distributor_price, stock_qty, image_url } = req.body;

  if (!name || base_price == null) {
    return res.status(400).json({ error: 'Name and base price are required' });
  }

  const db = getDb();
  const id = uuidv4();

  db.prepare(`
    INSERT INTO hardware_products (id, name, sku, description, category, base_price, dealer_price, distributor_price, stock_qty, image_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, sku, description, category, base_price, dealer_price || 0, distributor_price || 0, stock_qty || 0, image_url);

  const product = db.prepare('SELECT * FROM hardware_products WHERE id = ?').get(id);
  res.status(201).json({ product });
});

// PUT /api/hardware/:id - update product (admin)
router.put('/:id', authenticateToken, requireAdmin, (req, res) => {
  const { name, sku, description, category, base_price, dealer_price, distributor_price, stock_qty, image_url, is_active } = req.body;
  const db = getDb();

  db.prepare(`
    UPDATE hardware_products SET name=?, sku=?, description=?, category=?, base_price=?, dealer_price=?, distributor_price=?,
      stock_qty=?, image_url=?, is_active=?, updated_at=datetime('now')
    WHERE id = ?
  `).run(name, sku, description, category, base_price, dealer_price, distributor_price, stock_qty, image_url, is_active ? 1 : 0, req.params.id);

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

// GET /api/hardware/orders - list hardware orders
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

module.exports = router;
