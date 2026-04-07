const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'ecc-dms.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initializeDatabase() {
  const db = getDb();

  db.exec(`
    -- Dealers table (3-tier: admin/hq, distributor, dealer)
    CREATE TABLE IF NOT EXISTS dealers (
      id TEXT PRIMARY KEY,
      company_name TEXT NOT NULL,
      contact_name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      city TEXT,
      province TEXT,
      postal_code TEXT,
      country TEXT DEFAULT 'Canada',
      account_balance REAL DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      is_admin INTEGER DEFAULT 0,
      role TEXT DEFAULT 'dealer',
      parent_dealer_id TEXT,
      discount_pct REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (parent_dealer_id) REFERENCES dealers(id)
    );

    -- Clients table (shared across dealers)
    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      notes TEXT,
      created_by_dealer_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (created_by_dealer_id) REFERENCES dealers(id)
    );

    -- Vehicles table (linked to clients)
    CREATE TABLE IF NOT EXISTS vehicles (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      vin TEXT,
      year INTEGER,
      make TEXT,
      model TEXT,
      engine TEXT,
      engine_code TEXT,
      transmission TEXT,
      ecu_type TEXT,
      tcu_type TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (client_id) REFERENCES clients(id)
    );

    -- Tune orders table
    CREATE TABLE IF NOT EXISTS tune_orders (
      id TEXT PRIMARY KEY,
      order_number TEXT UNIQUE NOT NULL,
      dealer_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      vehicle_id TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      tune_type TEXT NOT NULL,
      options TEXT,
      notes TEXT,
      stock_file_path TEXT,
      stock_file_name TEXT,
      tuned_file_path TEXT,
      tuned_file_name TEXT,
      price REAL DEFAULT 0,
      is_paid INTEGER DEFAULT 0,
      admin_notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      FOREIGN KEY (dealer_id) REFERENCES dealers(id),
      FOREIGN KEY (client_id) REFERENCES clients(id),
      FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
    );

    -- Additional files for orders (photos, logs, etc.)
    CREATE TABLE IF NOT EXISTS order_files (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_type TEXT,
      uploaded_by TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (order_id) REFERENCES tune_orders(id),
      FOREIGN KEY (uploaded_by) REFERENCES dealers(id)
    );

    -- Account transactions (dollar-based)
    CREATE TABLE IF NOT EXISTS account_transactions (
      id TEXT PRIMARY KEY,
      dealer_id TEXT NOT NULL,
      amount REAL NOT NULL,
      type TEXT NOT NULL,
      description TEXT,
      order_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (dealer_id) REFERENCES dealers(id),
      FOREIGN KEY (order_id) REFERENCES tune_orders(id)
    );

    -- Hardware catalog
    CREATE TABLE IF NOT EXISTS hardware_products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sku TEXT UNIQUE,
      description TEXT,
      category TEXT,
      product_type TEXT DEFAULT 'tools',
      base_price REAL NOT NULL DEFAULT 0,
      dealer_price REAL NOT NULL DEFAULT 0,
      distributor_price REAL NOT NULL DEFAULT 0,
      stock_qty INTEGER DEFAULT 0,
      image_url TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Hardware orders
    CREATE TABLE IF NOT EXISTS hardware_orders (
      id TEXT PRIMARY KEY,
      order_number TEXT UNIQUE NOT NULL,
      dealer_id TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      total_amount REAL DEFAULT 0,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (dealer_id) REFERENCES dealers(id)
    );

    -- Hardware order items
    CREATE TABLE IF NOT EXISTS hardware_order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL,
      FOREIGN KEY (order_id) REFERENCES hardware_orders(id),
      FOREIGN KEY (product_id) REFERENCES hardware_products(id)
    );

    -- Hardware kits (bundles of products at a package price)
    CREATE TABLE IF NOT EXISTS hardware_kits (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sku TEXT UNIQUE,
      description TEXT,
      badge TEXT,
      base_price REAL NOT NULL DEFAULT 0,
      dealer_price REAL NOT NULL DEFAULT 0,
      distributor_price REAL NOT NULL DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Kit items (which products are included in a kit)
    CREATE TABLE IF NOT EXISTS hardware_kit_items (
      id TEXT PRIMARY KEY,
      kit_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (kit_id) REFERENCES hardware_kits(id),
      FOREIGN KEY (product_id) REFERENCES hardware_products(id)
    );

    -- Tune pricing table (admin sets prices per tune type)
    CREATE TABLE IF NOT EXISTS tune_pricing (
      id TEXT PRIMARY KEY,
      tune_key TEXT UNIQUE NOT NULL,
      label TEXT NOT NULL,
      dealer_price REAL NOT NULL DEFAULT 0,
      distributor_price REAL NOT NULL DEFAULT 0,
      is_active INTEGER DEFAULT 1
    );
  `);

  // Migration: add new columns to existing tables if they don't exist
  const cols = db.prepare("PRAGMA table_info(dealers)").all().map(c => c.name);
  if (!cols.includes('role')) {
    db.exec("ALTER TABLE dealers ADD COLUMN role TEXT DEFAULT 'dealer'");
  }
  if (!cols.includes('parent_dealer_id')) {
    db.exec("ALTER TABLE dealers ADD COLUMN parent_dealer_id TEXT");
  }
  if (!cols.includes('discount_pct')) {
    db.exec("ALTER TABLE dealers ADD COLUMN discount_pct REAL DEFAULT 0");
  }
  if (!cols.includes('account_balance')) {
    // Rename credit_balance → account_balance for clarity
    try { db.exec("ALTER TABLE dealers ADD COLUMN account_balance REAL DEFAULT 0"); } catch(e) {}
    // Copy old credit_balance values if they exist
    if (cols.includes('credit_balance')) {
      try { db.exec("UPDATE dealers SET account_balance = credit_balance WHERE account_balance = 0 AND credit_balance > 0"); } catch(e) {}
    }
  }

  const hwCols = db.prepare("PRAGMA table_info(hardware_products)").all().map(c => c.name);
  if (!hwCols.includes('product_type')) {
    db.exec("ALTER TABLE hardware_products ADD COLUMN product_type TEXT DEFAULT 'tools'");
    // Set emulators as 'hardware' (performance hardware)
    db.exec("UPDATE hardware_products SET product_type = 'hardware' WHERE category = 'Emulators'");
  }

  const tuneCols = db.prepare("PRAGMA table_info(tune_orders)").all().map(c => c.name);
  if (!tuneCols.includes('price')) {
    db.exec("ALTER TABLE tune_orders ADD COLUMN price REAL DEFAULT 0");
  }
  if (!tuneCols.includes('is_paid')) {
    db.exec("ALTER TABLE tune_orders ADD COLUMN is_paid INTEGER DEFAULT 0");
  }

  // Seed admin (HQ) account if none exists
  const adminExists = db.prepare('SELECT id FROM dealers WHERE is_admin = 1').get();
  if (!adminExists) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare(`
      INSERT INTO dealers (id, company_name, contact_name, email, password_hash, phone, is_admin, role, account_balance)
      VALUES (?, ?, ?, ?, ?, ?, 1, 'admin', 0)
    `).run(uuidv4(), 'ECC Tuned', 'Admin', 'admin@ecctuned.com', hash, '519-000-0000');
  } else {
    // Update existing admin role
    db.prepare("UPDATE dealers SET role = 'admin' WHERE is_admin = 1 AND (role IS NULL OR role = 'dealer')").run();
  }

  // Seed demo dealer if none exists
  const dealerExists = db.prepare("SELECT id FROM dealers WHERE is_admin = 0 AND email = 'dejan@foreignautomotive.ca'").get();
  if (!dealerExists) {
    const hash = bcrypt.hashSync('dealer123', 10);
    db.prepare(`
      INSERT INTO dealers (id, company_name, contact_name, email, password_hash, phone, address, city, province, postal_code, role, account_balance)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'dealer', ?)
    `).run(uuidv4(), 'Foreign Automotive', 'Dejan Zunic', 'dejan@foreignautomotive.ca', hash, '519-555-0100', '123 Auto Lane', 'Kitchener', 'ON', 'N2G 1A1', 500.00);
  }

  // Seed default tune pricing if empty
  const pricingExists = db.prepare('SELECT id FROM tune_pricing LIMIT 1').get();
  if (!pricingExists) {
    const pricing = [
      { key: 'stage1', label: 'Stage 1', dealer: 350, dist: 250 },
      { key: 'stage2', label: 'Stage 2', dealer: 500, dist: 375 },
      { key: 'stage3', label: 'Custom Stage 3', dealer: 800, dist: 600 },
      { key: 'eco_tune', label: 'Economy Tune', dealer: 300, dist: 225 },
      { key: 'custom', label: 'Custom', dealer: 0, dist: 0 },
      { key: 'dpf_delete', label: 'DPF Delete (add-on)', dealer: 150, dist: 100 },
      { key: 'egr_delete', label: 'EGR Delete (add-on)', dealer: 100, dist: 75 },
      { key: 'adblue_delete', label: 'AdBlue Delete (add-on)', dealer: 125, dist: 90 },
      { key: 'tcu_tune', label: 'TCU Tune (add-on)', dealer: 250, dist: 175 },
    ];
    const stmt = db.prepare('INSERT INTO tune_pricing (id, tune_key, label, dealer_price, distributor_price) VALUES (?, ?, ?, ?, ?)');
    for (const p of pricing) {
      stmt.run(uuidv4(), p.key, p.label, p.dealer, p.dist);
    }
  }

  // Seed sample hardware if empty
  const hwExists = db.prepare('SELECT id FROM hardware_products LIMIT 1').get();
  if (!hwExists) {
    const products = [
      { name: 'ECC FlexRead Pro', sku: 'ECC-FRP-01', desc: 'Universal OBD2 ECU read/write tool. Supports bench and OBD protocols.', cat: 'Tools', type: 'tools', base: 899, dealer: 699, dist: 549, qty: 25 },
      { name: 'ECC BenchLink Cable Set', sku: 'ECC-BLC-01', desc: 'Boot-mode bench cable kit for Bosch, Siemens, Delphi ECUs.', cat: 'Cables', type: 'tools', base: 349, dealer: 249, dist: 199, qty: 40 },
      { name: 'ECC TCU Adapter', sku: 'ECC-TCU-01', desc: 'TCU read/write adapter for ZF, DSG, and PDK transmissions.', cat: 'Adapters', type: 'tools', base: 499, dealer: 379, dist: 299, qty: 15 },
      { name: 'ECC GPF/OPF Emulator', sku: 'ECC-GPF-01', desc: 'Gasoline particulate filter emulator module.', cat: 'Emulators', type: 'hardware', base: 199, dealer: 149, dist: 119, qty: 60 },
      { name: 'ECC DPF Pressure Sensor Emulator', sku: 'ECC-DPF-EM', desc: 'Differential pressure sensor emulator for diesel DPF deletes.', cat: 'Emulators', type: 'hardware', base: 149, dealer: 109, dist: 89, qty: 50 },
      { name: 'ECC NOx Sensor Emulator', sku: 'ECC-NOX-01', desc: 'NOx sensor signal emulator for SCR/AdBlue delete applications.', cat: 'Emulators', type: 'hardware', base: 179, dealer: 129, dist: 99, qty: 35 },
    ];
    const stmt = db.prepare('INSERT INTO hardware_products (id, name, sku, description, category, product_type, base_price, dealer_price, distributor_price, stock_qty) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const p of products) {
      stmt.run(uuidv4(), p.name, p.sku, p.desc, p.cat, p.type, p.base, p.dealer, p.dist, p.qty);
    }
  }

  // Seed hardware kits if empty
  const kitsExist = db.prepare('SELECT id FROM hardware_kits LIMIT 1').get();
  if (!kitsExist) {
    // Get product IDs by SKU for building kit contents
    const getBySku = (sku) => db.prepare('SELECT id FROM hardware_products WHERE sku = ?').get(sku);

    const kits = [
      {
        name: 'Dealer Starter Kit',
        sku: 'KIT-DEALER-START',
        desc: 'Everything a new dealer needs to start offering ECU tuning. Includes the FlexRead Pro tool, bench cable set, and a bundle of emulators to handle the most common jobs.',
        badge: 'Most Popular',
        base: 2274, dealer: 1599, dist: 1249, sort: 1,
        items: [
          { sku: 'ECC-FRP-01', qty: 1 },   // FlexRead Pro
          { sku: 'ECC-BLC-01', qty: 1 },   // BenchLink Cable Set
          { sku: 'ECC-GPF-01', qty: 2 },   // GPF Emulator x2
          { sku: 'ECC-DPF-EM', qty: 2 },   // DPF Emulator x2
          { sku: 'ECC-NOX-01', qty: 2 },   // NOx Emulator x2
        ]
      },
      {
        name: 'Diesel Specialist Kit',
        sku: 'KIT-DIESEL-PRO',
        desc: 'Full diesel tuning package. FlexRead Pro, bench cables, plus DPF, NOx, and EGR emulators in bulk for high-volume diesel delete work.',
        badge: 'Diesel Shops',
        base: 2425, dealer: 1749, dist: 1349, sort: 2,
        items: [
          { sku: 'ECC-FRP-01', qty: 1 },   // FlexRead Pro
          { sku: 'ECC-BLC-01', qty: 1 },   // BenchLink Cable Set
          { sku: 'ECC-DPF-EM', qty: 5 },   // DPF Emulator x5
          { sku: 'ECC-NOX-01', qty: 5 },   // NOx Emulator x5
        ]
      },
      {
        name: 'Performance Pro Kit',
        sku: 'KIT-PERF-PRO',
        desc: 'For shops focused on performance tuning. FlexRead Pro, bench cables, TCU adapter, and GPF emulators for gas performance builds.',
        badge: 'Performance',
        base: 2445, dealer: 1799, dist: 1399, sort: 3,
        items: [
          { sku: 'ECC-FRP-01', qty: 1 },   // FlexRead Pro
          { sku: 'ECC-BLC-01', qty: 1 },   // BenchLink Cable Set
          { sku: 'ECC-TCU-01', qty: 1 },   // TCU Adapter
          { sku: 'ECC-GPF-01', qty: 3 },   // GPF Emulator x3
        ]
      },
      {
        name: 'Emulator Refill Pack',
        sku: 'KIT-EMU-REFILL',
        desc: 'Restock your emulator inventory. Bulk pack of the three most common emulators at a significant discount.',
        badge: 'Restock',
        base: 1585, dealer: 1099, dist: 849, sort: 4,
        items: [
          { sku: 'ECC-GPF-01', qty: 5 },   // GPF Emulator x5
          { sku: 'ECC-DPF-EM', qty: 5 },   // DPF Emulator x5
          { sku: 'ECC-NOX-01', qty: 5 },   // NOx Emulator x5
        ]
      },
      {
        name: 'Full Shop Kit',
        sku: 'KIT-FULL-SHOP',
        desc: 'The complete ECC tuning setup. Every tool, adapter, and emulator you need to handle gas, diesel, and TCU work from day one. Best value.',
        badge: 'Best Value',
        base: 3549, dealer: 2499, dist: 1899, sort: 0,
        items: [
          { sku: 'ECC-FRP-01', qty: 1 },   // FlexRead Pro
          { sku: 'ECC-BLC-01', qty: 1 },   // BenchLink Cable Set
          { sku: 'ECC-TCU-01', qty: 1 },   // TCU Adapter
          { sku: 'ECC-GPF-01', qty: 3 },   // GPF Emulator x3
          { sku: 'ECC-DPF-EM', qty: 3 },   // DPF Emulator x3
          { sku: 'ECC-NOX-01', qty: 3 },   // NOx Emulator x3
        ]
      }
    ];

    const kitStmt = db.prepare('INSERT INTO hardware_kits (id, name, sku, description, badge, base_price, dealer_price, distributor_price, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const kitItemStmt = db.prepare('INSERT INTO hardware_kit_items (id, kit_id, product_id, quantity) VALUES (?, ?, ?, ?)');

    for (const kit of kits) {
      const kitId = uuidv4();
      kitStmt.run(kitId, kit.name, kit.sku, kit.desc, kit.badge, kit.base, kit.dealer, kit.dist, kit.sort);

      for (const item of kit.items) {
        const product = getBySku(item.sku);
        if (product) {
          kitItemStmt.run(uuidv4(), kitId, product.id, item.qty);
        }
      }
    }
  }

  console.log('Database initialized successfully');
}

function generateHardwareOrderNumber() {
  const db = getDb();
  const last = db.prepare('SELECT order_number FROM hardware_orders ORDER BY created_at DESC LIMIT 1').get();
  if (!last) return 'HW-0001';
  const lastNum = parseInt(last.order_number.split('-')[1]);
  return `HW-${String(lastNum + 1).padStart(4, '0')}`;
}

function generateOrderNumber() {
  const db = getDb();
  const lastOrder = db.prepare('SELECT order_number FROM tune_orders ORDER BY created_at DESC LIMIT 1').get();
  if (!lastOrder) return 'ECC-0001';
  const lastNum = parseInt(lastOrder.order_number.split('-')[1]);
  return `ECC-${String(lastNum + 1).padStart(4, '0')}`;
}

module.exports = { getDb, initializeDatabase, generateOrderNumber, generateHardwareOrderNumber };
