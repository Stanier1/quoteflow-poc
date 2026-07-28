// db.js — Turso-compatible database layer.
//
// Uses @libsql/client, the same client Turso (hosted libSQL) uses in
// production. Locally it just opens a SQLite file, so the whole POC runs
// offline with zero cloud account needed. To point this at a real Turso
// database later, set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN — no schema
// or query changes required, only the connection.
const { createClient } = require('@libsql/client');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || `file:${path.join(DATA_DIR, 'quoteflow.db')}`,
  authToken: process.env.TURSO_AUTH_TOKEN
});

async function migrate() {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      short TEXT NOT NULL,
      initials TEXT NOT NULL,
      tagline TEXT NOT NULL DEFAULT '',
      layout TEXT NOT NULL DEFAULT 'band',
      prefix TEXT NOT NULL,
      pad INTEGER NOT NULL DEFAULT 4,
      currency TEXT NOT NULL DEFAULT '$',
      vatRate REAL NOT NULL DEFAULT 0,
      validDays INTEGER NOT NULL DEFAULT 30,
      address TEXT NOT NULL DEFAULT '',
      vatNo TEXT NOT NULL DEFAULT '',
      regNo TEXT NOT NULL DEFAULT '',
      banking TEXT NOT NULL DEFAULT '',
      terms TEXT NOT NULL DEFAULT '',
      footer TEXT NOT NULL DEFAULT '',
      logoDataUrl TEXT,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS quotes (
      id TEXT PRIMARY KEY,
      companyId TEXT NOT NULL REFERENCES companies(id),
      n INTEGER NOT NULL,
      number TEXT NOT NULL,
      client TEXT NOT NULL DEFAULT '',
      contact TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      itemsJson TEXT NOT NULL DEFAULT '[]',
      vatRate REAL NOT NULL DEFAULT 0,
      device TEXT NOT NULL DEFAULT 'desktop',
      status TEXT NOT NULL DEFAULT 'Sent',
      createdAt TEXT NOT NULL,
      createdByEmail TEXT,
      reissued INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      passwordHash TEXT NOT NULL,
      salt TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'staff',
      name TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id),
      expiresAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      actorEmail TEXT,
      actorRole TEXT,
      action TEXT NOT NULL,
      targetType TEXT,
      targetId TEXT,
      details TEXT,
      device TEXT
    );
  `);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function seedIfEmpty() {
  const { rows } = await db.execute('SELECT COUNT(*) AS n FROM companies');
  if (Number(rows[0].n) > 0) return;

  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed.json'), 'utf8'));

  for (const c of seed.companies) {
    await db.execute({
      sql: `INSERT INTO companies
        (id, name, short, initials, tagline, layout, prefix, pad, currency, vatRate, validDays,
         address, vatNo, regNo, banking, terms, footer, logoDataUrl, active)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
      args: [c.id, c.name, c.short, c.initials, c.tagline, c.layout, c.prefix, c.pad,
        c.currency, c.vatRate, c.validDays, c.address, c.vatNo, c.regNo, c.banking, c.terms, c.footer, null]
    });
  }

  for (const q of (seed.quotes || [])) {
    await db.execute({
      sql: `INSERT INTO quotes
        (id, companyId, n, number, client, contact, notes, itemsJson, vatRate, device, status, createdAt, reissued)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0)`,
      args: [q.id, q.companyId, q.n, q.number, q.client, q.contact, q.notes || '',
        JSON.stringify(q.items || []), q.vatRate, q.device, q.status, q.createdAt]
    });
  }

  // Demo accounts for local testing only — rotate/replace before any real deployment.
  const admin = hashPassword('admin123');
  const staff = hashPassword('staff123');
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO users (id, email, passwordHash, salt, role, name, active, createdAt) VALUES (?,?,?,?,?,?,1,?)`,
    args: ['u_admin', 'admin@quoteflow.demo', admin.hash, admin.salt, 'admin', 'Demo Admin', now]
  });
  await db.execute({
    sql: `INSERT INTO users (id, email, passwordHash, salt, role, name, active, createdAt) VALUES (?,?,?,?,?,?,1,?)`,
    args: ['u_staff', 'staff@quoteflow.demo', staff.hash, staff.salt, 'staff', 'Demo Staff', now]
  });
}

async function audit({ actorEmail, actorRole, action, targetType, targetId, details, device }) {
  await db.execute({
    sql: `INSERT INTO audit_log (at, actorEmail, actorRole, action, targetType, targetId, details, device)
          VALUES (?,?,?,?,?,?,?,?)`,
    args: [new Date().toISOString(), actorEmail || null, actorRole || null, action,
      targetType || null, targetId || null, details ? JSON.stringify(details) : null, device || null]
  });
}

module.exports = { db, migrate, seedIfEmpty, hashPassword, verifyPassword, audit };
