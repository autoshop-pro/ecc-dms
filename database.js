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
    -- Dealers table
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
      credit_balance REAL DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      is_admin INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
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
      credit_cost REAL DEFAULT 0,
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

    -- Credit transactions
    CREATE TABLE IF NOT EXISTS credit_transactions (
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
  `);

  // Seed admin account if none exists
  const adminExists = db.prepare('SELECT id FROM dealers WHERE is_admin = 1').get();
  if (!adminExists) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare(`
      INSERT INTO dealers (id, company_name, contact_name, email, password_hash, phone, is_admin, credit_balance)
      VALUES (?, ?, ?, ?, ?, ?, 1, 99999)
    `).run(uuidv4(), 'ECC Tuned', 'Admin', 'admin@ecctuned.com', hash, '519-000-0000');
  }

  // Seed a demo dealer if none exists
  const dealerExists = db.prepare('SELECT id FROM dealers WHERE is_admin = 0').get();
  if (!dealerExists) {
    const hash = bcrypt.hashSync('dealer123', 10);
    const dealerId = uuidv4();
    db.prepare(`
      INSERT INTO dealers (id, company_name, contact_name, email, password_hash, phone, address, city, province, postal_code, credit_balance)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(dealerId, 'Foreign Automotive', 'Dejan Zunic', 'dejan@foreignautomotive.ca', hash, '519-555-0100', '123 Auto Lane', 'Kitchener', 'ON', 'N2G 1A1', 500);
  }

  console.log('Database initialized successfully');
}

function generateOrderNumber() {
  const db = getDb();
  const lastOrder = db.prepare('SELECT order_number FROM tune_orders ORDER BY created_at DESC LIMIT 1').get();
  if (!lastOrder) return 'ECC-0001';
  const lastNum = parseInt(lastOrder.order_number.split('-')[1]);
  return `ECC-${String(lastNum + 1).padStart(4, '0')}`;
}

module.exports = { getDb, initializeDatabase, generateOrderNumber };
