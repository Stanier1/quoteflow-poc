// db.js - SQLite persistence layer (uses Node's built-in node:sqlite)
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data.sqlite');
const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    quote_prefix TEXT NOT NULL DEFAULT 'QT',
    next_quote_seq INTEGER NOT NULL DEFAULT 0,
    accent_color TEXT NOT NULL DEFAULT '#8B5CF6',
    logo_data_url TEXT,
    address TEXT,
    email TEXT,
    phone TEXT,
    website TEXT,
    bank_name TEXT,
    bank_account_name TEXT,
    bank_account_number TEXT,
    bank_branch TEXT,
    bank_swift TEXT,
    currency TEXT NOT NULL DEFAULT 'USD',
    default_tax_rate REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS quotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    quote_number TEXT NOT NULL,
    seq INTEGER NOT NULL,
    client_name TEXT,
    client_email TEXT,
    client_address TEXT,
    issue_date TEXT,
    valid_until TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    notes TEXT,
    tax_rate REAL NOT NULL DEFAULT 0,
    subtotal REAL NOT NULL DEFAULT 0,
    tax_amount REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    created_by_device TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS quote_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    qty REAL NOT NULL DEFAULT 1,
    unit_price REAL NOT NULL DEFAULT 0,
    line_total REAL NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0
  );
`);

module.exports = db;
