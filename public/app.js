// app.js - tiny client-side router + views. No build step, no framework.
const el = document.getElementById('app');
const nav = document.getElementById('navActions');
document.getElementById('brandHome').onclick = () => go('companies');

let state = { view: 'companies', companyId: null, quoteId: null };

// Each browser tab gets its own "device" label (sessionStorage, not shared) so you can
// open two tabs / an incognito window and demo "office PC" vs "phone off-site" creating
// quotes back-to-back against the same shared counter.
if (!sessionStorage.getItem('deviceLabel')) {
  const labels = ['Office Desktop', 'Front Desk PC', 'Warehouse Tablet'];
  sessionStorage.setItem('deviceLabel', labels[Math.floor(Math.random() * labels.length)]);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function money(n, currency) {
  const v = Number(n || 0);
  return `${currency ? currency + ' ' : ''}${v.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}`;
}
async function api(path, opts) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function go(view, params = {}) {
  state = { view, companyId: null, quoteId: null, ...params };
  render();
}

function renderNav() {
  const device = sessionStorage.getItem('deviceLabel');
  nav.innerHTML = `
    <span class="tag" style="margin-right:6px">This tab is acting as:</span>
    <select id="deviceSelect" style="width:auto; margin:0; padding:8px 10px; font-size:12px;">
      ${['Office Desktop','Front Desk PC','Warehouse Tablet','Mobile — Off Site','Mobile — Client Visit','Sales Rep Laptop']
        .map(l => `<option value="${escapeHtml(l)}" ${l === device ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}
    </select>
  `;
  document.getElementById('deviceSelect').onchange = (e) => {
    sessionStorage.setItem('deviceLabel', e.target.value);
  };
}

async function render() {
  renderNav();
  el.innerHTML = `<p class="tag">Loading…</p>`;
  try {
    if (state.view === 'companies') return renderCompanies();
    if (state.view === 'company-form') return renderCompanyForm(state.companyId);
    if (state.view === 'dashboard') return renderDashboard(state.companyId);
    if (state.view === 'quote-form') return renderQuoteForm(state.companyId);
    if (state.view === 'quote-view') return renderQuoteView(state.quoteId);
  } catch (err) {
    el.innerHTML = `<div class="panel"><p style="color:#ef4444">${escapeHtml(err.message)}</p></div>`;
  }
}

// ---------------- Companies list ----------------
async function renderCompanies() {
  const companies = await api('/api/companies');
  el.innerHTML = `
    <div class="tag">Proof of concept</div>
    <h1 class="hero-line serif">Your Companies.<br/>One Shared System.</h1>
    <p class="hero-sub">Each company below has its own logo, address, banking details and quote numbering sequence — all served from one system, accessible from any device.</p>
    <div class="company-grid" id="grid"></div>
  `;
  const grid = document.getElementById('grid');
  grid.innerHTML = companies.map(c => `
    <div class="company-card" data-id="${c.id}">
      <div class="accent-bar" style="background:${c.accent_color}"></div>
      <h3>${escapeHtml(c.name)}</h3>
      <div class="meta">${escapeHtml(c.email || '')}${c.email && c.phone ? ' · ' : ''}${escapeHtml(c.phone || '')}</div>
      <div class="meta">${escapeHtml(c.address || 'No address set')}</div>
      <span class="seq-pill">Next quote: ${c.quote_prefix}-${String(c.next_quote_seq + 1).padStart(4,'0')}</span>
    </div>
  `).join('') + `<div class="company-card add-new" id="addCompany">+ Add a company</div>`;

  grid.querySelectorAll('.company-card[data-id]').forEach(card => {
    card.onclick = () => go('dashboard', { companyId: Number(card.dataset.id) });
  });
  document.getElementById('addCompany').onclick = () => go('company-form');
}

// ---------------- Company create/edit form ----------------
async function renderCompanyForm(companyId) {
  const company = companyId ? await api(`/api/companies/${companyId}`) : null;
  el.innerHTML = `
    <div class="tag">${company ? 'Edit company' : 'New company'}</div>
    <h2 class="serif" style="font-size:26px">${company ? escapeHtml(company.name) : 'Set up a new company'}</h2>
    <div class="panel">
      <h2>Business details</h2>
      <div class="form-grid">
        <div><label>Company name *</label><input id="f_name" value="${escapeHtml(company?.name || '')}" placeholder="Acme Electrical Services"></div>
        <div><label>Quote prefix</label><input id="f_prefix" value="${escapeHtml(company?.quote_prefix || '')}" placeholder="ACM"></div>
        <div><label>Email</label><input id="f_email" value="${escapeHtml(company?.email || '')}"></div>
        <div><label>Phone</label><input id="f_phone" value="${escapeHtml(company?.phone || '')}"></div>
        <div><label>Website</label><input id="f_website" value="${escapeHtml(company?.website || '')}"></div>
        <div><label>Currency</label><input id="f_currency" value="${escapeHtml(company?.currency || 'USD')}"></div>
        <div><label>Default tax rate (%)</label><input id="f_tax" type="number" step="0.01" value="${company?.default_tax_rate ?? 0}"></div>
        <div><label>Brand / accent colour</label><input id="f_color" type="color" value="${company?.accent_color || '#8B5CF6'}"></div>
      </div>
      <label>Address</label><textarea id="f_address" rows="2">${escapeHtml(company?.address || '')}</textarea>

      <label>Logo</label>
      <div class="logo-drop" id="logoDrop">Click to upload a logo (PNG/JPG, shown on quotes &amp; PDFs)</div>
      <input type="file" id="logoFile" accept="image/*" style="display:none">
      ${company?.logo_data_url ? `<img class="logo-preview" id="logoPreview" src="${company.logo_data_url}">` : `<img class="logo-preview hidden" id="logoPreview">`}

      <h2 style="margin-top:24px">Banking details <span class="tag">(printed on quotes)</span></h2>
      <div class="form-grid">
        <div><label>Bank name</label><input id="f_bank_name" value="${escapeHtml(company?.bank_name || '')}"></div>
        <div><label>Account name</label><input id="f_bank_acc_name" value="${escapeHtml(company?.bank_account_name || '')}"></div>
        <div><label>Account number</label><input id="f_bank_acc_num" value="${escapeHtml(company?.bank_account_number || '')}"></div>
        <div><label>Branch</label><input id="f_bank_branch" value="${escapeHtml(company?.bank_branch || '')}"></div>
        <div><label>SWIFT / routing</label><input id="f_bank_swift" value="${escapeHtml(company?.bank_swift || '')}"></div>
      </div>

      <div style="display:flex; gap:10px; margin-top:10px; flex-wrap:wrap">
        <button class="btn solid" id="saveCompany">${company ? 'Save changes' : 'Create company'}</button>
        <button class="btn ghost" id="cancelCompany">Cancel</button>
        ${company ? `<button class="btn danger" id="deleteCompany" style="margin-left:auto">Delete company</button>` : ''}
      </div>
      <p id="formError" style="color:#ef4444; margin-top:10px"></p>
    </div>
  `;

  let logoDataUrl = company?.logo_data_url || null;
  document.getElementById('logoDrop').onclick = () => document.getElementById('logoFile').click();
  document.getElementById('logoFile').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      logoDataUrl = reader.result;
      const img = document.getElementById('logoPreview');
      img.src = logoDataUrl;
      img.classList.remove('hidden');
    };
    reader.readAsDataURL(file);
  };

  document.getElementById('cancelCompany').onclick = () => go(company ? 'dashboard' : 'companies', company ? { companyId: company.id } : {});

  document.getElementById('saveCompany').onclick = async () => {
    const payload = {
      name: document.getElementById('f_name').value.trim(),
      quote_prefix: document.getElementById('f_prefix').value.trim().toUpperCase(),
      email: document.getElementById('f_email').value.trim(),
      phone: document.getElementById('f_phone').value.trim(),
      website: document.getElementById('f_website').value.trim(),
      currency: document.getElementById('f_currency').value.trim() || 'USD',
      default_tax_rate: Number(document.getElementById('f_tax').value || 0),
      accent_color: document.getElementById('f_color').value,
      address: document.getElementById('f_address').value.trim(),
      logo_data_url: logoDataUrl,
      bank_name: document.getElementById('f_bank_name').value.trim(),
      bank_account_name: document.getElementById('f_bank_acc_name').value.trim(),
      bank_account_number: document.getElementById('f_bank_acc_num').value.trim(),
      bank_branch: document.getElementById('f_bank_branch').value.trim(),
      bank_swift: document.getElementById('f_bank_swift').value.trim(),
    };
    if (!payload.name) {
      document.getElementById('formError').textContent = 'Company name is required.';
      return;
    }
    try {
      const saved = company
        ? await api(`/api/companies/${company.id}`, { method: 'PUT', body: JSON.stringify(payload) })
        : await api('/api/companies', { method: 'POST', body: JSON.stringify(payload) });
      go('dashboard', { companyId: saved.id });
    } catch (err) {
      document.getElementById('formError').textContent = err.message;
    }
  };

  if (company) {
    document.getElementById('deleteCompany').onclick = async () => {
      if (!confirm(`Delete ${company.name}? This also removes its quotes.`)) return;
      await api(`/api/companies/${company.id}`, { method: 'DELETE' });
      go('companies');
    };
  }
}

// ---------------- Company dashboard (quote list) ----------------
async function renderDashboard(companyId) {
  const [company, quotes] = await Promise.all([
    api(`/api/companies/${companyId}`),
    api(`/api/companies/${companyId}/quotes`)
  ]);

  el.innerHTML = `
    <div class="panel-header" style="margin-bottom:6px; border:none; padding:0">
      <div style="display:flex; align-items:center; gap:14px">
        ${company.logo_data_url ? `<img class="company-logo-sm" src="${company.logo_data_url}">` : `<div class="company-logo-sm" style="display:flex;align-items:center;justify-content:center;color:${company.accent_color};font-weight:700">${escapeHtml(company.name[0])}</div>`}
        <div>
          <div class="tag">Company</div>
          <h1 class="serif" style="margin:2px 0; font-size:26px">${escapeHtml(company.name)}</h1>
        </div>
      </div>
      <div style="display:flex; gap:10px">
        <button class="btn ghost small" id="editCompany">Edit details</button>
        <button class="btn ghost small" id="allCompanies">All companies</button>
      </div>
    </div>

    <div class="panel" style="margin-top:20px">
      <div class="panel-header">
        <div>
          <h2 style="margin:0">Quotes</h2>
          <p class="device-note">Next number will be <b>${company.quote_prefix}-${String(company.next_quote_seq + 1).padStart(4,'0')}</b> — assigned by the server the instant "Create quote" is pressed, from <b>${escapeHtml(sessionStorage.getItem('deviceLabel'))}</b> (this tab).</p>
        </div>
        <button class="btn solid" id="newQuote" style="border-color:${company.accent_color}; background:${company.accent_color}">+ New quote</button>
      </div>
      ${quotes.length === 0 ? `<p class="tag">No quotes yet for this company.</p>` : `
        <div class="quote-list-row head">
          <span>Number</span><span>Client</span><span>Date</span><span>Total</span><span>Status</span>
        </div>
        ${quotes.map(q => `
          <div class="quote-list-row" data-id="${q.id}">
            <span>${escapeHtml(q.quote_number)}</span>
            <span>${escapeHtml(q.client_name || '—')}</span>
            <span>${escapeHtml(q.issue_date || '')}</span>
            <span>${money(q.total, company.currency)}</span>
            <span class="status-pill status-${q.status}">${q.status}</span>
          </div>
        `).join('')}
      `}
    </div>
  `;

  document.getElementById('editCompany').onclick = () => go('company-form', { companyId });
  document.getElementById('allCompanies').onclick = () => go('companies');
  document.getElementById('newQuote').onclick = () => go('quote-form', { companyId });
  el.querySelectorAll('.quote-list-row[data-id]').forEach(row => {
    row.onclick = () => go('quote-view', { quoteId: Number(row.dataset.id) });
  });
}

// ---------------- New quote form ----------------
async function renderQuoteForm(companyId) {
  const company = await api(`/api/companies/${companyId}`);
  let items = [{ description: '', qty: 1, unit_price: 0 }];

  el.innerHTML = `
    <div class="tag">${escapeHtml(company.name)}</div>
    <h2 class="serif" style="font-size:26px">New quote</h2>
    <p class="device-note">Creating from <b>${escapeHtml(sessionStorage.getItem('deviceLabel'))}</b> — number is assigned on save by the shared server counter, continuing from wherever the last quote (on any device) left off.</p>

    <div class="panel">
      <h2>Client</h2>
      <div class="form-grid">
        <div><label>Client name</label><input id="q_client_name"></div>
        <div><label>Client email</label><input id="q_client_email"></div>
        <div><label>Issue date</label><input id="q_issue_date" type="date" value="${new Date().toISOString().slice(0,10)}"></div>
        <div><label>Valid until</label><input id="q_valid_until" type="date"></div>
      </div>
      <label>Client address</label><textarea id="q_client_address" rows="2"></textarea>
    </div>

    <div class="panel">
      <div class="panel-header"><h2 style="margin:0">Line items</h2><button class="btn ghost small" id="addItem">+ Add line</button></div>
      <table>
        <thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Line total</th><th></th></tr></thead>
        <tbody id="itemsBody"></tbody>
      </table>
      <div class="form-grid" style="margin-top:10px">
        <div><label>Tax rate (%)</label><input id="q_tax_rate" type="number" step="0.01" value="${company.default_tax_rate}"></div>
      </div>
      <div class="totals-box" id="totalsBox"></div>
    </div>

    <div class="panel">
      <label>Notes</label><textarea id="q_notes" rows="2" placeholder="Payment terms, validity, extra info..."></textarea>
      <div style="display:flex; gap:10px; flex-wrap:wrap">
        <button class="btn solid" id="saveQuote" style="border-color:${company.accent_color}; background:${company.accent_color}">Create quote</button>
        <button class="btn ghost" id="cancelQuote">Cancel</button>
      </div>
      <p id="quoteError" style="color:#ef4444; margin-top:10px"></p>
    </div>
  `;

  function renderItems() {
    document.getElementById('itemsBody').innerHTML = items.map((it, i) => `
      <tr class="item-row" data-i="${i}">
        <td><input class="it-desc" value="${escapeHtml(it.description)}" placeholder="Item description"></td>
        <td><input class="it-qty" type="number" step="0.01" value="${it.qty}" style="width:80px"></td>
        <td><input class="it-price" type="number" step="0.01" value="${it.unit_price}" style="width:100px"></td>
        <td>${money(it.qty * it.unit_price, company.currency)}</td>
        <td>${items.length > 1 ? `<button class="remove-row" data-i="${i}">✕</button>` : ''}</td>
      </tr>
    `).join('');

    document.querySelectorAll('.it-desc').forEach((inp,i) => inp.oninput = () => { items[i].description = inp.value; });
    document.querySelectorAll('.it-qty').forEach((inp,i) => inp.oninput = () => { items[i].qty = Number(inp.value); renderTotals(); renderItems(); });
    document.querySelectorAll('.it-price').forEach((inp,i) => inp.oninput = () => { items[i].unit_price = Number(inp.value); renderTotals(); renderItems(); });
    document.querySelectorAll('.remove-row').forEach(btn => btn.onclick = () => { items.splice(Number(btn.dataset.i),1); renderTotals(); renderItems(); });
    renderTotals();
  }

  function renderTotals() {
    const subtotal = items.reduce((s,it) => s + (Number(it.qty)||0)*(Number(it.unit_price)||0), 0);
    const taxRate = Number(document.getElementById('q_tax_rate')?.value || 0);
    const tax = subtotal * (taxRate/100);
    document.getElementById('totalsBox').innerHTML = `
      <div class="row"><span>Subtotal</span><span>${money(subtotal, company.currency)}</span></div>
      <div class="row"><span>Tax (${taxRate}%)</span><span>${money(tax, company.currency)}</span></div>
      <div class="row grand"><span>Total</span><span>${money(subtotal+tax, company.currency)}</span></div>
    `;
  }

  renderItems();
  document.getElementById('addItem').onclick = () => { items.push({ description:'', qty:1, unit_price:0 }); renderItems(); };
  document.getElementById('q_tax_rate').oninput = renderTotals;
  document.getElementById('cancelQuote').onclick = () => go('dashboard', { companyId });

  document.getElementById('saveQuote').onclick = async () => {
    const payload = {
      client_name: document.getElementById('q_client_name').value.trim(),
      client_email: document.getElementById('q_client_email').value.trim(),
      client_address: document.getElementById('q_client_address').value.trim(),
      issue_date: document.getElementById('q_issue_date').value,
      valid_until: document.getElementById('q_valid_until').value,
      tax_rate: Number(document.getElementById('q_tax_rate').value || 0),
      notes: document.getElementById('q_notes').value.trim(),
      items: items.filter(it => it.description.trim() !== ''),
      created_by_device: sessionStorage.getItem('deviceLabel'),
    };
    if (payload.items.length === 0) {
      document.getElementById('quoteError').textContent = 'Add at least one line item.';
      return;
    }
    try {
      const quote = await api(`/api/companies/${companyId}/quotes`, { method: 'POST', body: JSON.stringify(payload) });
      go('quote-view', { quoteId: quote.id });
    } catch (err) {
      document.getElementById('quoteError').textContent = err.message;
    }
  };
}

// ---------------- Quote print / view ----------------
async function renderQuoteView(quoteId) {
  const q = await api(`/api/quotes/${quoteId}`);
  const c = q.company;

  el.innerHTML = `
    <div class="print-toolbar">
      <button class="btn ghost small" id="backDash">← Back to ${escapeHtml(c.name)}</button>
      <button class="btn solid small" id="printBtn" style="border-color:${c.accent_color}; background:${c.accent_color}">Print / Save as PDF</button>
    </div>
    <div class="quote-doc" style="border-top:6px solid ${c.accent_color}">
      <div class="doc-top">
        <div class="company-block">
          ${c.logo_data_url ? `<img src="${c.logo_data_url}">` : ''}
          <h3>${escapeHtml(c.name)}</h3>
          <p>${escapeHtml(c.address || '')}</p>
          <p>${escapeHtml(c.email || '')}${c.email && c.phone ? ' · ' : ''}${escapeHtml(c.phone || '')}</p>
          <p>${escapeHtml(c.website || '')}</p>
        </div>
        <div class="doc-meta">
          <p class="doc-title" style="color:${c.accent_color}">Quotation</p>
          <p class="doc-number">${escapeHtml(q.quote_number)}</p>
          <p>Issued: ${escapeHtml(q.issue_date || '')}</p>
          ${q.valid_until ? `<p>Valid until: ${escapeHtml(q.valid_until)}</p>` : ''}
          <p style="text-transform:capitalize">Status: ${q.status}</p>
        </div>
      </div>

      <div class="bill-to">
        <label>Quoted to</label>
        <div><strong>${escapeHtml(q.client_name || '—')}</strong></div>
        <div>${escapeHtml(q.client_email || '')}</div>
        <div>${escapeHtml(q.client_address || '')}</div>
      </div>

      <table>
        <thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Line total</th></tr></thead>
        <tbody>
          ${q.items.map(it => `
            <tr>
              <td>${escapeHtml(it.description)}</td>
              <td>${it.qty}</td>
              <td>${money(it.unit_price, c.currency)}</td>
              <td>${money(it.line_total, c.currency)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div class="totals-box">
        <div class="row"><span>Subtotal</span><span>${money(q.subtotal, c.currency)}</span></div>
        <div class="row"><span>Tax (${q.tax_rate}%)</span><span>${money(q.tax_amount, c.currency)}</span></div>
        <div class="row grand"><span>Total</span><span>${money(q.total, c.currency)}</span></div>
      </div>

      ${q.notes ? `<div class="notes"><strong>Notes:</strong> ${escapeHtml(q.notes)}</div>` : ''}

      <div class="bank-box">
        <b>Payment details</b><br/>
        ${c.bank_name ? `Bank: ${escapeHtml(c.bank_name)}<br/>` : ''}
        ${c.bank_account_name ? `Account name: ${escapeHtml(c.bank_account_name)}<br/>` : ''}
        ${c.bank_account_number ? `Account number: ${escapeHtml(c.bank_account_number)}<br/>` : ''}
        ${c.bank_branch ? `Branch: ${escapeHtml(c.bank_branch)}<br/>` : ''}
        ${c.bank_swift ? `SWIFT/Routing: ${escapeHtml(c.bank_swift)}<br/>` : ''}
      </div>
    </div>
    <p class="device-note" style="text-align:center; margin-top:14px">Created from <b>${escapeHtml(q.created_by_device || 'unknown device')}</b></p>
  `;

  document.getElementById('backDash').onclick = () => go('dashboard', { companyId: c.id });
  document.getElementById('printBtn').onclick = () => window.print();
}

render();
