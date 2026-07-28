// server.js - Multi-company quotation system (proof of concept)
const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
app.use(express.json({ limit: '8mb' })); // logos come in as base64 data URLs
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 4000;

// ---------- helpers ----------
function slugify(name) {
  return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function padSeq(seq) {
  return String(seq).padStart(4, '0');
}

function companyRowToJson(row) {
  return row;
}

// ---------- company routes ----------

// list companies (lightweight - no logo blob to keep list snappy)
app.get('/api/companies', (req, res) => {
  const rows = db.prepare(`
    SELECT id, slug, name, quote_prefix, next_quote_seq, accent_color, currency,
           address, email, phone, website
    FROM companies ORDER BY name ASC
  `).all();
  res.json(rows);
});

// get one company (includes logo + banking - used for settings screen & printing)
app.get('/api/companies/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM companies WHERE id = ?`).get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Company not found' });
  res.json(row);
});

// create a company
app.post('/api/companies', (req, res) => {
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) {
    return res.status(400).json({ error: 'Company name is required' });
  }
  let slug = slugify(b.name);
  const exists = db.prepare(`SELECT id FROM companies WHERE slug = ?`).get(slug);
  if (exists) slug = `${slug}-${Date.now().toString(36)}`;

  const prefix = (b.quote_prefix && String(b.quote_prefix).trim()) ||
    slug.split('-').map(w => w[0]).join('').toUpperCase().slice(0, 4) || 'QT';

  const stmt = db.prepare(`
    INSERT INTO companies
      (slug, name, quote_prefix, next_quote_seq, accent_color, logo_data_url,
       address, email, phone, website,
       bank_name, bank_account_name, bank_account_number, bank_branch, bank_swift,
       currency, default_tax_rate)
    VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    slug, b.name.trim(), prefix, b.accent_color || '#8B5CF6', b.logo_data_url || null,
    b.address || null, b.email || null, b.phone || null, b.website || null,
    b.bank_name || null, b.bank_account_name || null, b.bank_account_number || null,
    b.bank_branch || null, b.bank_swift || null,
    b.currency || 'USD', Number(b.default_tax_rate || 0)
  );
  const row = db.prepare(`SELECT * FROM companies WHERE id = ?`).get(Number(info.lastInsertRowid));
  res.status(201).json(row);
});

// update a company
app.put('/api/companies/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare(`SELECT * FROM companies WHERE id = ?`).get(id);
  if (!existing) return res.status(404).json({ error: 'Company not found' });
  const b = req.body || {};
  const merged = { ...existing, ...b };
  db.prepare(`
    UPDATE companies SET
      name = ?, quote_prefix = ?, accent_color = ?, logo_data_url = ?,
      address = ?, email = ?, phone = ?, website = ?,
      bank_name = ?, bank_account_name = ?, bank_account_number = ?, bank_branch = ?, bank_swift = ?,
      currency = ?, default_tax_rate = ?
    WHERE id = ?
  `).run(
    merged.name, merged.quote_prefix, merged.accent_color, merged.logo_data_url,
    merged.address, merged.email, merged.phone, merged.website,
    merged.bank_name, merged.bank_account_name, merged.bank_account_number, merged.bank_branch, merged.bank_swift,
    merged.currency, Number(merged.default_tax_rate || 0),
    id
  );
  const row = db.prepare(`SELECT * FROM companies WHERE id = ?`).get(id);
  res.json(row);
});

app.delete('/api/companies/:id', (req, res) => {
  const id = Number(req.params.id);
  db.prepare(`DELETE FROM companies WHERE id = ?`).run(id);
  res.status(204).end();
});

// ---------- quote routes ----------

// list quotes for a company (most recent first)
app.get('/api/companies/:id/quotes', (req, res) => {
  const companyId = Number(req.params.id);
  const rows = db.prepare(`
    SELECT * FROM quotes WHERE company_id = ? ORDER BY seq DESC
  `).all(companyId);
  res.json(rows);
});

// create a quote for a company - THIS is where sequential numbering continuity happens.
// The counter lives on the company row in the shared database, not on the device that
// creates the quote. Whichever device (office desktop, or a phone anywhere else) calls
// this endpoint next always gets next_quote_seq + 1, in order, because SQLite serializes
// these synchronous statements on the single server process.
app.post('/api/companies/:id/quotes', (req, res) => {
  const companyId = Number(req.params.id);
  const company = db.prepare(`SELECT * FROM companies WHERE id = ?`).get(companyId);
  if (!company) return res.status(404).json({ error: 'Company not found' });

  const b = req.body || {};
  const items = Array.isArray(b.items) ? b.items : [];
  if (items.length === 0) return res.status(400).json({ error: 'At least one line item is required' });

  const taxRate = Number(b.tax_rate ?? company.default_tax_rate ?? 0);
  const subtotal = items.reduce((sum, it) => sum + (Number(it.qty) || 0) * (Number(it.unit_price) || 0), 0);
  const taxAmount = subtotal * (taxRate / 100);
  const total = subtotal + taxAmount;

  // --- atomic increment: the whole point of this POC ---
  db.exec('BEGIN IMMEDIATE');
  let seq;
  try {
    db.prepare(`UPDATE companies SET next_quote_seq = next_quote_seq + 1 WHERE id = ?`).run(companyId);
    seq = db.prepare(`SELECT next_quote_seq FROM companies WHERE id = ?`).get(companyId).next_quote_seq;

    const quoteNumber = `${company.quote_prefix}-${padSeq(seq)}`;

    const info = db.prepare(`
      INSERT INTO quotes
        (company_id, quote_number, seq, client_name, client_email, client_address,
         issue_date, valid_until, status, notes, tax_rate, subtotal, tax_amount, total, created_by_device)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      companyId, quoteNumber, seq,
      b.client_name || null, b.client_email || null, b.client_address || null,
      b.issue_date || new Date().toISOString().slice(0, 10),
      b.valid_until || null,
      b.status || 'draft',
      b.notes || null,
      taxRate, subtotal, taxAmount, total,
      b.created_by_device || 'unknown device'
    );

    const quoteId = Number(info.lastInsertRowid);
    items.forEach((it, idx) => {
      const lineTotal = (Number(it.qty) || 0) * (Number(it.unit_price) || 0);
      db.prepare(`
        INSERT INTO quote_items (quote_id, description, qty, unit_price, line_total, sort_order)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(quoteId, it.description || '', Number(it.qty) || 0, Number(it.unit_price) || 0, lineTotal, idx);
    });

    db.exec('COMMIT');

    const quote = db.prepare(`SELECT * FROM quotes WHERE id = ?`).get(quoteId);
    const quoteItems = db.prepare(`SELECT * FROM quote_items WHERE quote_id = ? ORDER BY sort_order ASC`).all(quoteId);
    res.status(201).json({ ...quote, items: quoteItems });
  } catch (err) {
    db.exec('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to create quote' });
  }
});

// get a single quote with items + company snapshot (for the printable view)
app.get('/api/quotes/:id', (req, res) => {
  const id = Number(req.params.id);
  const quote = db.prepare(`SELECT * FROM quotes WHERE id = ?`).get(id);
  if (!quote) return res.status(404).json({ error: 'Quote not found' });
  const items = db.prepare(`SELECT * FROM quote_items WHERE quote_id = ? ORDER BY sort_order ASC`).all(id);
  const company = db.prepare(`SELECT * FROM companies WHERE id = ?`).get(quote.company_id);
  res.json({ ...quote, items, company });
});

app.patch('/api/quotes/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare(`SELECT * FROM quotes WHERE id = ?`).get(id);
  if (!existing) return res.status(404).json({ error: 'Quote not found' });
  const status = req.body?.status;
  if (status) {
    db.prepare(`UPDATE quotes SET status = ? WHERE id = ?`).run(status, id);
  }
  const row = db.prepare(`SELECT * FROM quotes WHERE id = ?`).get(id);
  res.json(row);
});

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`Quote POC server running on http://localhost:${PORT}`);
});
