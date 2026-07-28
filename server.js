/**
 * QuoteFlow — multi-company quotation system (proof of concept)
 *
 * The important bit: quote numbers are issued by THIS server, never by the
 * device. A phone in the field and a laptop in the office both ask the server
 * for the next number, so the sequence stays continuous with no gaps or
 * duplicates. Numbers are reserved while a quote is being drafted and the
 * reservation expires if the draft is abandoned.
 *
 * Storage is a real database (libSQL — Turso-compatible, see db.js), with
 * cookie-session auth, two access levels (admin / staff), and every mutation
 * written to an audit_log table.
 */

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { db, migrate, seedIfEmpty, hashPassword, verifyPassword, audit } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const RESERVATION_MS = 30 * 60 * 1000;
const SESSION_MS = 12 * 60 * 60 * 1000; // 12h

app.use(express.json({ limit: '8mb' })); // logos come in as base64 data URLs
app.use(express.static(path.join(__dirname, 'public')));

/* --------------------------------------------------------------- cookies */

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

function setSessionCookie(res, token, maxAgeMs) {
  res.setHeader('Set-Cookie',
    `session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

/* -------------------------------------------------------------- sessions */

async function createSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_MS).toISOString();
  await db.execute({ sql: 'INSERT INTO sessions (token, userId, expiresAt) VALUES (?,?,?)', args: [token, userId, expiresAt] });
  return { token, expiresAt };
}

async function sessionUser(req) {
  const token = parseCookies(req).session;
  if (!token) return null;
  const { rows } = await db.execute({
    sql: `SELECT u.id, u.email, u.role, u.name, u.active, s.expiresAt
          FROM sessions s JOIN users u ON u.id = s.userId
          WHERE s.token = ?`,
    args: [token]
  });
  const row = rows[0];
  if (!row) return null;
  if (new Date(row.expiresAt).getTime() < Date.now()) {
    await db.execute({ sql: 'DELETE FROM sessions WHERE token = ?', args: [token] });
    return null;
  }
  if (!row.active) return null;
  return { id: row.id, email: row.email, role: row.role, name: row.name };
}

async function requireAuth(req, res, next) {
  const user = await sessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  req.user = user;
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (req.user.role !== role) return res.status(403).json({ error: `Requires ${role} access` });
    next();
  };
}

/* ---------------------------------------------------------------- mappers */

function rowToCompany(row) {
  return { ...row, active: !!row.active };
}

function rowToQuote(row) {
  return { ...row, items: JSON.parse(row.itemsJson || '[]'), reissued: !!row.reissued, itemsJson: undefined };
}

function slugify(name) {
  return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function formatNumber(co, n) {
  return co.prefix + '-' + String(n).padStart(co.pad, '0');
}

async function getCompany(id) {
  const { rows } = await db.execute({ sql: 'SELECT * FROM companies WHERE id = ?', args: [id] });
  return rows[0] ? rowToCompany(rows[0]) : null;
}

async function quoteCountFor(companyId) {
  const { rows } = await db.execute({ sql: 'SELECT COUNT(*) AS n FROM quotes WHERE companyId = ?', args: [companyId] });
  return Number(rows[0].n);
}

/* ------------------------------------------------------------- numbering */

const reservations = []; // ephemeral — held in memory, never persisted

function pruneReservations() {
  const now = Date.now();
  for (let i = reservations.length - 1; i >= 0; i--) {
    if (reservations[i].expires <= now) reservations.splice(i, 1);
  }
}

async function highestIssued(companyId) {
  pruneReservations();
  const { rows } = await db.execute({ sql: 'SELECT MAX(n) AS m FROM quotes WHERE companyId = ?', args: [companyId] });
  const saved = Number(rows[0].m) || 0;
  const held = reservations.filter(r => r.companyId === companyId).map(r => r.n);
  return Math.max(saved, ...held, 0);
}

async function nextNumberFor(companyId) {
  return (await highestIssued(companyId)) + 1;
}

/* -------------------------------------------------------------------- auth */

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.get('/api/auth/me', async (req, res) => {
  res.json({ user: await sessionUser(req) });
});

app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const { rows } = await db.execute({ sql: 'SELECT * FROM users WHERE email = ?', args: [email] });
  const row = rows[0];
  if (!row || !row.active || !verifyPassword(password, row.salt, row.passwordHash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const { token, expiresAt } = await createSession(row.id);
  setSessionCookie(res, token, SESSION_MS);
  await audit({ actorEmail: row.email, actorRole: row.role, action: 'auth.login', targetType: 'user', targetId: row.id });
  res.json({ user: { id: row.id, email: row.email, role: row.role, name: row.name }, expiresAt });
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  const token = parseCookies(req).session;
  if (token) await db.execute({ sql: 'DELETE FROM sessions WHERE token = ?', args: [token] });
  clearSessionCookie(res);
  await audit({ actorEmail: req.user.email, actorRole: req.user.role, action: 'auth.logout', targetType: 'user', targetId: req.user.id });
  res.json({ ok: true });
});

// Everything below requires a signed-in session.
app.use('/api', requireAuth);

/* ------------------------------------------------------------------ boot */

app.get('/api/bootstrap', async (req, res) => {
  const { rows: companyRows } = await db.execute('SELECT * FROM companies ORDER BY name ASC');
  const { rows: quoteRows } = await db.execute('SELECT * FROM quotes ORDER BY createdAt ASC');
  const companies = companyRows.map(rowToCompany);
  const quotes = quoteRows.map(rowToQuote);
  const next = {};
  for (const c of companies) next[c.id] = formatNumber(c, await nextNumberFor(c.id));
  res.json({ companies, quotes, next, user: req.user });
});

/* ------------------------------------------------------------- companies */

app.post('/api/companies', requireRole('admin'), async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Company name is required' });

  let id = slugify(name) || 'company';
  if (await getCompany(id)) id = `${id}-${Date.now().toString(36)}`;

  const initials = String(b.initials || name).trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 3) || 'CO';
  const co = {
    id, name,
    short: String(b.short || name).trim(),
    initials,
    tagline: String(b.tagline || '').trim(),
    layout: ['band', 'classic', 'minimal'].includes(b.layout) ? b.layout : 'band',
    prefix: (String(b.prefix || '').trim().toUpperCase()) || initials,
    pad: Math.min(8, Math.max(1, Number(b.pad) || 4)),
    currency: String(b.currency || '$').trim(),
    vatRate: Number(b.vatRate) || 0,
    validDays: Number(b.validDays) || 30,
    address: String(b.address || '').trim(),
    vatNo: String(b.vatNo || '').trim(),
    regNo: String(b.regNo || '').trim(),
    banking: String(b.banking || '').trim(),
    terms: String(b.terms || '').trim(),
    footer: String(b.footer || '').trim(),
    logoDataUrl: b.logoDataUrl || null
  };
  await db.execute({
    sql: `INSERT INTO companies (id,name,short,initials,tagline,layout,prefix,pad,currency,vatRate,validDays,address,vatNo,regNo,banking,terms,footer,logoDataUrl,active)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
    args: [co.id, co.name, co.short, co.initials, co.tagline, co.layout, co.prefix, co.pad, co.currency,
      co.vatRate, co.validDays, co.address, co.vatNo, co.regNo, co.banking, co.terms, co.footer, co.logoDataUrl]
  });
  await audit({ actorEmail: req.user.email, actorRole: req.user.role, action: 'company.create', targetType: 'company', targetId: co.id, details: { name: co.name } });
  const saved = await getCompany(co.id);
  res.status(201).json({ company: saved, next: formatNumber(saved, await nextNumberFor(saved.id)) });
});

app.put('/api/companies/:id', requireRole('admin'), async (req, res) => {
  const co = await getCompany(req.params.id);
  if (!co) return res.status(404).json({ error: 'Unknown company' });

  const editable = ['name', 'short', 'initials', 'tagline', 'address', 'vatNo', 'regNo',
    'banking', 'terms', 'footer', 'prefix', 'pad', 'layout', 'currency', 'vatRate', 'validDays', 'active'];
  const merged = { ...co };
  editable.forEach(k => {
    if (req.body[k] !== undefined && req.body[k] !== null) merged[k] = req.body[k];
  });
  if ('logoDataUrl' in req.body) merged.logoDataUrl = req.body.logoDataUrl || null;
  merged.pad = Math.min(8, Math.max(1, Number(merged.pad) || 4));
  merged.vatRate = Number(merged.vatRate) || 0;
  merged.validDays = Number(merged.validDays) || 30;

  await db.execute({
    sql: `UPDATE companies SET name=?,short=?,initials=?,tagline=?,address=?,vatNo=?,regNo=?,banking=?,terms=?,footer=?,
          prefix=?,pad=?,layout=?,currency=?,vatRate=?,validDays=?,logoDataUrl=?,active=? WHERE id=?`,
    args: [merged.name, merged.short, merged.initials, merged.tagline, merged.address, merged.vatNo, merged.regNo,
      merged.banking, merged.terms, merged.footer, merged.prefix, merged.pad, merged.layout, merged.currency,
      merged.vatRate, merged.validDays, merged.logoDataUrl, merged.active ? 1 : 0, co.id]
  });

  let action = 'company.update';
  if (req.body.active === false && co.active) action = 'company.deactivate';
  else if (req.body.active === true && !co.active) action = 'company.reactivate';
  await audit({ actorEmail: req.user.email, actorRole: req.user.role, action, targetType: 'company', targetId: co.id });

  const saved = await getCompany(co.id);
  res.json({ company: saved, next: formatNumber(saved, await nextNumberFor(saved.id)) });
});

// Deleting a company cascades to its quotes — genuinely destructive, so the
// UI forces a 5-second read delay plus a typed "DELETE" confirmation before
// this route is ever called. The deletion is still recorded in audit_log
// (which has no FK on companies), so the fact it happened isn't lost even
// though the underlying rows are gone.
app.delete('/api/companies/:id', requireRole('admin'), async (req, res) => {
  const co = await getCompany(req.params.id);
  if (!co) return res.status(404).json({ error: 'Unknown company' });
  const quotesDeleted = await quoteCountFor(co.id);
  await db.execute({ sql: 'DELETE FROM quotes WHERE companyId = ?', args: [co.id] });
  await db.execute({ sql: 'DELETE FROM companies WHERE id = ?', args: [co.id] });
  await audit({ actorEmail: req.user.email, actorRole: req.user.role, action: 'company.delete', targetType: 'company', targetId: co.id, details: { name: co.name, quotesDeleted } });
  res.status(204).end();
});

/* ----------------------------------------------------------------- quotes */

app.post('/api/reserve', async (req, res) => {
  const co = await getCompany(req.body.companyId);
  if (!co) return res.status(404).json({ error: 'Unknown company' });

  const n = await nextNumberFor(co.id);
  const token = 'r_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  reservations.push({ token, companyId: co.id, n, device: req.body.device || 'unknown', expires: Date.now() + RESERVATION_MS });
  res.json({ token, n, number: formatNumber(co, n), expiresInMinutes: RESERVATION_MS / 60000 });
});

app.post('/api/release', (req, res) => {
  const idx = reservations.findIndex(r => r.token === req.body.token);
  if (idx !== -1) reservations.splice(idx, 1);
  res.json({ ok: true });
});

app.post('/api/quotes', async (req, res) => {
  const { companyId, token, client, contact, items, device, notes } = req.body;
  const co = await getCompany(companyId);
  if (!co) return res.status(404).json({ error: 'Unknown company' });

  pruneReservations();
  const heldIdx = reservations.findIndex(r => r.token === token && r.companyId === companyId);
  const held = heldIdx !== -1 ? reservations[heldIdx] : null;
  // No valid reservation (expired, or a stale tab) — issue a fresh number so we
  // never reuse one that has since been taken.
  const n = held ? held.n : await nextNumberFor(companyId);
  if (heldIdx !== -1) reservations.splice(heldIdx, 1);

  if ((await db.execute({ sql: 'SELECT 1 FROM quotes WHERE companyId=? AND n=?', args: [companyId, n] })).rows.length) {
    return res.status(409).json({ error: 'Number already used — retry' });
  }

  const quote = {
    id: 'q_' + Date.now().toString(36),
    companyId, n,
    number: formatNumber(co, n),
    client: (client || '').trim() || 'Unnamed client',
    contact: (contact || '').trim(),
    notes: (notes || '').trim(),
    items: (items || []).map(it => ({
      desc: String(it.desc || '').trim() || 'Item',
      qty: Number(it.qty) || 0,
      rate: Number(it.rate) || 0
    })),
    vatRate: Number(co.vatRate) || 0,
    device: device === 'mobile' ? 'mobile' : 'desktop',
    status: 'Sent',
    createdAt: new Date().toISOString(),
    reissued: !held
  };
  await db.execute({
    sql: `INSERT INTO quotes (id,companyId,n,number,client,contact,notes,itemsJson,vatRate,device,status,createdAt,createdByEmail,reissued)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [quote.id, quote.companyId, quote.n, quote.number, quote.client, quote.contact, quote.notes,
      JSON.stringify(quote.items), quote.vatRate, quote.device, quote.status, quote.createdAt, req.user.email, quote.reissued ? 1 : 0]
  });
  await audit({
    actorEmail: req.user.email, actorRole: req.user.role, action: 'quote.create',
    targetType: 'quote', targetId: quote.id, device: quote.device,
    details: { number: quote.number, companyId, client: quote.client }
  });
  res.status(201).json({ quote, next: formatNumber(co, await nextNumberFor(companyId)) });
});

app.patch('/api/quotes/:id', async (req, res) => {
  const { rows } = await db.execute({ sql: 'SELECT * FROM quotes WHERE id = ?', args: [req.params.id] });
  const existing = rows[0];
  if (!existing) return res.status(404).json({ error: 'Unknown quote' });
  const allowed = ['Draft', 'Sent', 'Accepted', 'Declined'];
  if (allowed.includes(req.body.status)) {
    await db.execute({ sql: 'UPDATE quotes SET status = ? WHERE id = ?', args: [req.body.status, existing.id] });
    await audit({
      actorEmail: req.user.email, actorRole: req.user.role, action: 'quote.status_change',
      targetType: 'quote', targetId: existing.id, details: { from: existing.status, to: req.body.status, number: existing.number }
    });
  }
  const { rows: updated } = await db.execute({ sql: 'SELECT * FROM quotes WHERE id = ?', args: [existing.id] });
  res.json(rowToQuote(updated[0]));
});

/* ------------------------------------------------------------------- audit */

app.get('/api/audit', requireRole('admin'), async (req, res) => {
  const { rows } = await db.execute('SELECT * FROM audit_log ORDER BY at DESC LIMIT 200');
  res.json(rows.map(r => ({ ...r, details: r.details ? JSON.parse(r.details) : null })));
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

(async () => {
  await migrate();
  await seedIfEmpty();
  app.listen(PORT, () => console.log(`QuoteFlow running on http://localhost:${PORT}`));
})();
