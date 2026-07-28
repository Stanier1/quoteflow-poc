/**
 * QuoteFlow — multi-company quotation system (proof of concept)
 *
 * The important bit: quote numbers are issued by THIS server, never by the
 * device. A phone in the field and a laptop in the office both ask the server
 * for the next number, so the sequence stays continuous with no gaps or
 * duplicates. Numbers are reserved while a quote is being drafted and the
 * reservation expires if the draft is abandoned.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SEED_FILE = path.join(__dirname, 'seed.json');
const RESERVATION_MS = 30 * 60 * 1000;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ---------------------------------------------------------------- storage */

let db = null;

function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.copyFileSync(SEED_FILE, DB_FILE);
  }
  db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  db.reservations = [];
}

let writing = Promise.resolve();
function save() {
  const snapshot = JSON.stringify({ companies: db.companies, quotes: db.quotes }, null, 2);
  writing = writing.then(() => fs.promises.writeFile(DB_FILE, snapshot));
  return writing;
}

/* ------------------------------------------------------------- numbering */

function company(id) {
  return db.companies.find(c => c.id === id);
}

function formatNumber(co, n) {
  return co.prefix + '-' + String(n).padStart(co.pad, '0');
}

function pruneReservations() {
  const now = Date.now();
  db.reservations = db.reservations.filter(r => r.expires > now);
}

/**
 * Highest number in play for a company: the last saved quote plus anything
 * currently reserved by another device.
 */
function highestIssued(companyId) {
  pruneReservations();
  const saved = db.quotes.filter(q => q.companyId === companyId).map(q => q.n);
  const held = db.reservations.filter(r => r.companyId === companyId).map(r => r.n);
  return Math.max(0, ...saved, ...held);
}

function nextNumberFor(companyId) {
  return highestIssued(companyId) + 1;
}

/* ------------------------------------------------------------------ api */

app.get('/api/bootstrap', (req, res) => {
  res.json({
    companies: db.companies,
    quotes: db.quotes,
    next: Object.fromEntries(db.companies.map(c => [c.id, formatNumber(c, nextNumberFor(c.id))]))
  });
});

// Reserve the next number for a draft. Returns the number + a token to save with.
app.post('/api/reserve', (req, res) => {
  const co = company(req.body.companyId);
  if (!co) return res.status(404).json({ error: 'Unknown company' });

  const n = nextNumberFor(co.id);
  const token = 'r_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  db.reservations.push({
    token, companyId: co.id, n,
    device: req.body.device || 'unknown',
    expires: Date.now() + RESERVATION_MS
  });
  res.json({ token, n, number: formatNumber(co, n), expiresInMinutes: RESERVATION_MS / 60000 });
});

app.post('/api/release', (req, res) => {
  db.reservations = db.reservations.filter(r => r.token !== req.body.token);
  res.json({ ok: true });
});

app.post('/api/quotes', async (req, res) => {
  const { companyId, token, client, contact, items, device, notes } = req.body;
  const co = company(companyId);
  if (!co) return res.status(404).json({ error: 'Unknown company' });

  pruneReservations();
  const held = db.reservations.find(r => r.token === token && r.companyId === companyId);
  // No valid reservation (expired, or a stale tab) — issue a fresh number so we
  // never reuse one that has since been taken.
  const n = held ? held.n : nextNumberFor(companyId);
  db.reservations = db.reservations.filter(r => r.token !== token);

  if (db.quotes.some(q => q.companyId === companyId && q.n === n)) {
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
  db.quotes.push(quote);
  await save();
  res.status(201).json({ quote, next: formatNumber(co, nextNumberFor(companyId)) });
});

app.put('/api/companies/:id', async (req, res) => {
  const co = company(req.params.id);
  if (!co) return res.status(404).json({ error: 'Unknown company' });

  const editable = ['name', 'short', 'initials', 'tagline', 'address', 'vatNo', 'regNo',
    'banking', 'terms', 'footer', 'prefix', 'pad', 'layout', 'currency', 'vatRate', 'validDays'];
  editable.forEach(k => {
    if (req.body[k] !== undefined && req.body[k] !== null) co[k] = req.body[k];
  });
  co.pad = Math.min(8, Math.max(1, Number(co.pad) || 4));
  co.vatRate = Number(co.vatRate) || 0;
  co.validDays = Number(co.validDays) || 30;
  await save();
  res.json({ company: co, next: formatNumber(co, nextNumberFor(co.id)) });
});

app.patch('/api/quotes/:id', async (req, res) => {
  const q = db.quotes.find(x => x.id === req.params.id);
  if (!q) return res.status(404).json({ error: 'Unknown quote' });
  const allowed = ['Draft', 'Sent', 'Accepted', 'Declined'];
  if (allowed.includes(req.body.status)) q.status = req.body.status;
  await save();
  res.json({ quote: q });
});

app.get('/api/health', (req, res) => res.json({ ok: true, quotes: db.quotes.length }));

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

load();
app.listen(PORT, () => console.log(`QuoteFlow running on http://localhost:${PORT}`));
