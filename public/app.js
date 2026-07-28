/* QuoteFlow front end — vanilla JS, no build step.
   Layout is responsive via CSS media queries; this file only records which
   kind of device a quote was raised on (for the audit trail). */

const NBSP = '\u202F';
const state = {
  companies: [], quotes: [], next: {},
  companyId: null, screen: 'quotes', openId: null,
  reservation: null,
  draft: { client: '', contact: '', notes: '', items: [{ desc: '', qty: '1', rate: '0' }] },
  newCompanyDraft: null,
  companyLogoEdits: {},
  editingCompanyId: null,
  deleteConfirm: null, // { id, secondsLeft, text }
  user: null,
  auditLog: []
};
let deleteCountdownTimer = null;

const isAdmin = () => !!state.user && state.user.role === 'admin';

function freshCompanyDraft() {
  return {
    name: '', short: '', initials: '', tagline: '', prefix: '', pad: 4,
    currency: '$', vatRate: 15, validDays: 30, address: '', vatNo: '', regNo: '',
    banking: '', terms: '', footer: '', layout: 'band', logoDataUrl: null
  };
}

const el = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function isMobileDevice() {
  return window.matchMedia('(max-width: 719px)').matches ||
    (navigator.maxTouchPoints > 1 && window.matchMedia('(pointer: coarse)').matches);
}

function company(id = state.companyId) { return state.companies.find(c => c.id === id); }

function money(n, co = company()) {
  const v = (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
  const [i, d] = v.split('.');
  return (co ? co.currency : '$') + ' ' + i.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP) + '.' + d;
}

function quoteTotals(q) {
  const sub = (q.items || []).reduce((a, it) => a + (Number(it.qty) || 0) * (Number(it.rate) || 0), 0);
  const rate = Number(q.vatRate) || 0;
  return { sub, vat: sub * rate / 100, grand: sub * (1 + rate / 100), rate };
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function addDays(iso, days) {
  const d = new Date(iso); d.setDate(d.getDate() + Number(days || 30));
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ------------------------------------------------------------------- api */

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  if (res.status === 204) return null;
  return res.json();
}

async function bootstrap() {
  const data = await api('GET', '/api/bootstrap');
  state.companies = data.companies;
  state.quotes = data.quotes;
  state.next = data.next;
  if (!company() || company().active === false) {
    const firstActive = state.companies.find(c => c.active !== false);
    state.companyId = firstActive ? firstActive.id : (state.companies[0] && state.companies[0].id);
  }
  renderChrome();
  render();
}

async function reserveNumber() {
  const r = await api('POST', '/api/reserve', { companyId: state.companyId, device: isMobileDevice() ? 'mobile' : 'desktop' });
  state.reservation = r;
  state.next[state.companyId] = r.number;
}

async function releaseNumber() {
  if (!state.reservation) return;
  const token = state.reservation.token;
  state.reservation = null;
  await api('POST', '/api/release', { token }).catch(() => {});
  const data = await api('GET', '/api/bootstrap');
  state.next = data.next;
}

/* ----------------------------------------------------------------- chrome */

// Company management and the audit trail are admin-only screens. Staff's
// nav is deliberately just Quotes (view + toggle status) and New (create) —
// company data (banking, VAT, addresses, logos) never renders for them
// outside of a quote they're actively working with.
const NAV = [
  { key: 'quotes', label: 'Quotes', icon: '📄' },
  { key: 'new', label: 'New', icon: '✚' },
  { key: 'companies', label: 'Companies', icon: '🏢', roles: ['admin'] },
  { key: 'activity', label: 'Activity', icon: '🕑', roles: ['admin'] }
];
const GATED_SCREENS = { companies: 'admin', 'company-new': 'admin', 'company-detail': 'admin', activity: 'admin' };
const visibleNav = () => NAV.filter(n => !n.roles || (state.user && n.roles.includes(state.user.role)));

function renderChrome() {
  const activeCompanies = state.companies.filter(c => c.active !== false);
  const opts = activeCompanies.map(c =>
    `<option value="${c.id}" ${c.id === state.companyId ? 'selected' : ''}>${esc(c.short)}</option>`).join('');
  ['companyPicker', 'companyPickerMobile'].forEach(id => { el(id).innerHTML = opts; });

  const nav = visibleNav();
  el('sidenav').innerHTML = nav.map(n =>
    `<button class="navitem ${isActive(n.key) ? 'active' : ''}" data-go="${n.key}">
       <span class="ico">${n.icon}</span><span>${n.label}</span>
     </button>`).join('');

  el('tabbar').innerHTML = nav.map(n =>
    `<button class="tab ${isActive(n.key) ? 'active' : ''}" data-go="${n.key}">
       <span>${n.icon}</span><span>${n.label}</span>
     </button>`).join('');

  const co = company();
  el('topCompany').textContent = co ? co.name : '';
  el('topTitle').textContent = {
    quotes: 'Quotes', new: 'New quotation', quote: 'Quotation',
    companies: 'Companies & branding', 'company-new': 'Add a company',
    'company-detail': 'Company details', activity: 'Audit trail'
  }[state.screen];
  el('nextPill').innerHTML = `<span class="dot"></span>Next: ${esc(state.next[state.companyId] || '—')}`;

  if (el('userCard') && state.user) {
    el('userCard').innerHTML = `
      <div style="font-size:13px;font-weight:700;color:var(--black)">${esc(state.user.name || state.user.email)}</div>
      <div class="stat-sub" style="text-transform:capitalize">${esc(state.user.role)} access</div>`;
  }
}

const isActive = key => state.screen === key || (key === 'quotes' && state.screen === 'quote') ||
  (key === 'companies' && (state.screen === 'company-new' || state.screen === 'company-detail'));

async function go(screen) {
  const requiredRole = GATED_SCREENS[screen];
  if (requiredRole && (!state.user || state.user.role !== requiredRole)) {
    toast(`${requiredRole[0].toUpperCase()}${requiredRole.slice(1)} access is required`);
    return;
  }
  if (state.screen === 'new' && screen !== 'new') await releaseNumber();
  if (state.deleteConfirm) { clearInterval(deleteCountdownTimer); state.deleteConfirm = null; }
  state.screen = screen;
  if (screen === 'new') await reserveNumber();
  if (screen === 'company-new') state.newCompanyDraft = freshCompanyDraft();
  if (screen === 'activity') state.auditLog = await api('GET', '/api/audit').catch(() => state.auditLog || []);
  renderChrome();
  render();
  window.scrollTo(0, 0);
}

function toast(msg) {
  const t = el('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 4500);
}

/* ---------------------------------------------------------------- screens */

function render() {
  const views = {
    quotes: viewQuotes, new: viewNew, quote: viewQuote,
    companies: viewCompanies, 'company-new': viewCompanyNew, 'company-detail': viewCompanyDetail,
    activity: viewActivity
  };
  el('content').innerHTML = views[state.screen]();
  el('content').style.animation = 'none'; void el('content').offsetWidth; el('content').style.animation = '';
}

function viewQuotes() {
  const co = company();
  const mine = state.quotes.filter(q => q.companyId === co.id).sort((a, b) => b.n - a.n);
  const value = mine.reduce((a, q) => a + quoteTotals(q).grand, 0);
  const mobileCount = mine.filter(q => q.device === 'mobile').length;

  const stats = [
    ['Quotes issued', String(mine.length), 'this company, all devices'],
    ['Next number', state.next[co.id] || '—', 'server-issued, no gaps'],
    ['Pipeline value', money(value), 'incl. VAT'],
    ['From mobile', `${mobileCount}/${mine.length}`, 'raised off-site']
  ].map(([l, v, s]) => `<div class="card stat"><div class="eyebrow">${l}</div><div class="stat-value">${esc(v)}</div><div class="stat-sub">${s}</div></div>`).join('');

  const rows = mine.length ? mine.map(q => {
    const t = quoteTotals(q);
    return `<button class="quote-row" data-open="${q.id}">
      <span class="quote-row-main">
        <span class="row" style="gap:8px">
          <span class="quote-no">${esc(q.number)}</span>
          <span class="badge ${q.status.toLowerCase()}">${esc(q.status)}</span>
        </span>
        <span class="quote-client">${esc(q.client)}</span>
      </span>
      <span class="quote-row-side">
        <span class="quote-total">${money(t.grand)}</span>
        <span class="quote-meta">${q.device === 'mobile' ? '📱' : '💻'} ${fmtDate(q.createdAt)}</span>
      </span>
    </button>`;
  }).join('') : `<div class="card-pad muted">No quotes yet for this company.</div>`;

  return `
    <div class="grid">${stats}</div>
    <div class="card" style="overflow:hidden">
      <div class="card-head">
        <div class="card-title">Quotes for ${esc(co.short)}</div>
        <button class="btn primary" data-go="new">New quote</button>
      </div>
      ${rows}
    </div>
    <div class="card card-pad stack" style="gap:8px">
      <div class="eyebrow accent">How continuity works</div>
      <p class="muted">The number never lives on the phone or the laptop. When anyone starts a quote, this server hands out the next number in that company's sequence and holds it for 30 minutes while the quote is drafted — so two people quoting at the same time can't collide, and an abandoned draft releases its number. ${esc(co.short)} has ${mine.length} quotes, so the next one — from any device, anywhere — is <strong style="color:var(--black)">${esc(state.next[co.id])}</strong>.</p>
    </div>`;
}

function viewNew() {
  const co = company();
  const r = state.reservation;
  const items = state.draft.items.map((it, i) => `
    <div class="lineitem">
      <input class="input" placeholder="Description of work" value="${esc(it.desc)}" data-item="${i}" data-key="desc" />
      <div class="lineitem-controls">
        <label class="field"><span class="field-label">Qty</span>
          <input class="input" inputmode="decimal" value="${esc(it.qty)}" data-item="${i}" data-key="qty" /></label>
        <label class="field wide"><span class="field-label">Unit price</span>
          <input class="input" inputmode="decimal" value="${esc(it.rate)}" data-item="${i}" data-key="rate" /></label>
        <div class="lineitem-total">
          <div class="field-label">Line total</div>
          <div class="amount">${money((Number(it.qty) || 0) * (Number(it.rate) || 0))}</div>
        </div>
        <button class="btn ghost" data-remove="${i}">Remove</button>
      </div>
    </div>`).join('');

  const sub = state.draft.items.reduce((a, it) => a + (Number(it.qty) || 0) * (Number(it.rate) || 0), 0);
  const vat = sub * (Number(co.vatRate) || 0) / 100;

  return `
    <div class="card card-pad row" style="justify-content:space-between">
      <div class="stack" style="gap:4px">
        <div class="eyebrow">Number reserved from server</div>
        <div class="stat-value" style="font-size:26px">${esc(r ? r.number : '…')}</div>
      </div>
      <div class="stack" style="gap:5px;align-items:flex-start">
        <div class="pill tint">${isMobileDevice() ? '📱' : '💻'} Drafting on ${isMobileDevice() ? 'mobile' : 'desktop'}</div>
        <div class="stat-sub">Held for 30 min · released if abandoned</div>
      </div>
    </div>

    <div class="card card-pad stack">
      <div class="card-title">Client</div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
        <label class="field"><span class="field-label">Client name</span>
          <input class="input" placeholder="Acme Manufacturing" value="${esc(state.draft.client)}" data-draft="client" /></label>
        <label class="field"><span class="field-label">Contact / site</span>
          <input class="input" placeholder="T. Mokoena · Midrand site" value="${esc(state.draft.contact)}" data-draft="contact" /></label>
      </div>
      <label class="field"><span class="field-label">Notes on the quote (optional)</span>
        <textarea class="input" data-draft="notes" placeholder="Scope assumptions, access requirements…">${esc(state.draft.notes)}</textarea></label>
    </div>

    <div class="card card-pad stack">
      <div class="row" style="justify-content:space-between">
        <div class="card-title">Line items</div>
        <button class="btn" data-additem>+ Add line</button>
      </div>
      <div class="stack" style="gap:12px">${items}</div>
      <div class="totals">
        <div class="totals-line"><span>Subtotal</span><span>${money(sub)}</span></div>
        <div class="totals-line"><span>VAT (${co.vatRate}%)</span><span>${money(vat)}</span></div>
        <div class="totals-grand"><span class="label">Total</span><span class="value">${money(sub + vat)}</span></div>
      </div>
    </div>

    <div class="row">
      <button class="btn primary block" style="flex:1;min-width:200px" data-save>Save &amp; issue ${esc(r ? r.number : '')}</button>
      <button class="btn" data-go="quotes">Cancel</button>
    </div>`;
}

function viewQuote() {
  const q = state.quotes.find(x => x.id === state.openId);
  if (!q) return `<div class="card card-pad muted">Quote not found.</div>`;
  const co = company(q.companyId);
  const t = quoteTotals(q);

  const lines = q.items.map(it => {
    const amt = (Number(it.qty) || 0) * (Number(it.rate) || 0);
    return `<div class="doc-line">
      <span class="col-desc">${esc(it.desc)}</span>
      <span class="col-qty">${esc(it.qty)}</span>
      <span class="col-rate">${money(it.rate, co)}</span>
      <span class="col-amt">${money(amt, co)}</span>
      <span class="mobile-meta"><span class="qtyrate">${esc(it.qty)} × ${money(it.rate, co)}</span><span class="amount">${money(amt, co)}</span></span>
    </div>`;
  }).join('');

  return `
    <div class="row no-print">
      <button class="btn" data-go="quotes">← Back</button>
      <button class="btn dark" data-print>Print / save PDF</button>
      <select class="input compact" data-status>
        ${['Draft', 'Sent', 'Accepted', 'Declined'].map(s => `<option ${s === q.status ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
      <div class="stat-sub spacer">Layout: ${esc({ band: 'Gradient band', classic: 'Classic bordered', minimal: 'Minimal typographic' }[co.layout] || co.layout)}</div>
    </div>

    <div class="doc ${esc(co.layout)}">
      <div class="doc-head">
        <div class="row" style="gap:12px;flex-wrap:nowrap">
          <div class="doc-logo">${esc(co.initials)}</div>
          <div>
            <div class="doc-company">${esc(co.name)}</div>
            <div class="doc-tagline">${esc(co.tagline)}</div>
          </div>
        </div>
        <div class="doc-id">
          <div class="doc-label">Quotation</div>
          <div class="doc-number">${esc(q.number)}</div>
          <div class="doc-date">${fmtDate(q.createdAt)}</div>
        </div>
      </div>

      <div class="doc-body">
        <div class="doc-parties">
          <div class="doc-block">
            <div class="doc-mini-label">From</div>
            <div class="name">${esc(co.name)}</div>
            <div class="lines">${esc(co.address)}</div>
            <div class="lines">VAT ${esc(co.vatNo)}${co.regNo ? ' · Reg ' + esc(co.regNo) : ''}</div>
          </div>
          <div class="doc-block">
            <div class="doc-mini-label">Quote to</div>
            <div class="name">${esc(q.client)}</div>
            <div class="lines">${esc(q.contact)}</div>
            <div class="lines">Valid until ${addDays(q.createdAt, co.validDays)}</div>
          </div>
        </div>

        <div>
          <div class="doc-thead">
            <span class="col-desc">Description</span>
            <span class="col-qty">Qty</span>
            <span class="col-rate">Unit</span>
            <span class="col-amt">Amount</span>
          </div>
          ${lines}
        </div>

        ${q.notes ? `<div class="doc-block"><div class="doc-mini-label">Notes</div><div class="lines">${esc(q.notes)}</div></div>` : ''}

        <div class="doc-totals">
          <div class="doc-totals-inner">
            <div class="totals-line"><span>Subtotal</span><span>${money(t.sub, co)}</span></div>
            <div class="totals-line"><span>VAT (${t.rate}%)</span><span>${money(t.vat, co)}</span></div>
            <div class="doc-grand"><span>Total due</span><span>${money(t.grand, co)}</span></div>
          </div>
        </div>

        <div class="doc-parties" style="border-top:1px solid var(--gray-100);padding-top:18px">
          <div class="doc-block">
            <div class="doc-mini-label">Banking details</div>
            <div class="lines">${esc(co.banking)}</div>
          </div>
          <div class="doc-block">
            <div class="doc-mini-label">Terms</div>
            <div class="lines">${esc(co.terms)}</div>
          </div>
        </div>
      </div>

      <div class="doc-foot">${esc(co.footer)}</div>
    </div>`;
}

const BUSINESS_FIELDS = [
  ['name', 'Registered name', 'text'], ['short', 'Short name', 'text'],
  ['initials', 'Logo initials', 'text'], ['tagline', 'Tagline', 'text'],
  ['currency', 'Currency symbol', 'text'], ['vatRate', 'VAT %', 'number']
];
const NUMBERING_FIELDS = [
  ['prefix', 'Number prefix', 'text'], ['pad', 'Digits', 'number'],
  ['validDays', 'Validity (days)', 'number']
];
const REG_FIELDS = [['vatNo', 'VAT number', 'text'], ['regNo', 'Reg number', 'text']];

function fieldInputs(c, fields) {
  return fields.map(([k, label, type]) => `
    <label class="field"><span class="field-label">${label}</span>
      <input class="input" type="${type}" value="${esc(c[k])}" data-co="${c.id}" data-field="${k}" /></label>`).join('');
}

// Companies is admin-only (gated in go()), so no read-only branching needed here.
function viewCompanies() {
  const cards = state.companies.map(c => {
    const on = c.id === state.companyId;
    const inactive = c.active === false;
    const logoUrl = state.companyLogoEdits[c.id] !== undefined ? state.companyLogoEdits[c.id] : c.logoDataUrl;
    const quoteCount = state.quotes.filter(q => q.companyId === c.id).length;
    return `<button type="button" class="card card-pad stack company-card" style="${on ? 'border-color:var(--purple)' : ''}${inactive ? ';opacity:0.55' : ''}" data-editcompany="${c.id}">
      <div class="row" style="align-items:flex-start">
        <div class="doc-logo">${logoUrl ? `<img src="${logoUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:11px" />` : esc(c.initials)}</div>
        <div style="flex:1;min-width:0">
          <div class="card-title" style="font-size:15px">${esc(c.name)}</div>
          <div class="stat-sub">${esc(c.tagline || '')}</div>
        </div>
      </div>
      <div class="row" style="justify-content:space-between;align-items:center">
        <div class="pill tint">Next: ${esc(state.next[c.id] || '—')}</div>
        ${inactive ? '<span class="badge">Inactive</span>' : (on ? '<span class="badge sent">Selected</span>' : '')}
      </div>
      <div class="stat-sub">${quoteCount} quote${quoteCount === 1 ? '' : 's'} issued</div>
    </button>`;
  }).join('');

  const addTile = `<button type="button" class="card card-pad stack company-card" style="align-items:center;justify-content:center;text-align:center;border-style:dashed;gap:4px" data-go="company-new">
    <div style="font-size:26px;color:var(--gray-400);line-height:1">+</div>
    <div class="stat-sub">Add a company</div>
  </button>`;

  return `
    <p class="muted">Each company keeps its own letterhead, address, VAT number, banking details, numbering format and quote layout — and its own independent number sequence. Click a card to view or edit it.</p>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">${cards}${addTile}</div>`;
}

function deleteConfirmBlock(c, quoteCount) {
  const dc = state.deleteConfirm;
  if (!dc || dc.id !== c.id) {
    return `<button class="btn" style="color:#B91C1C" data-startdelete="${c.id}">Delete company</button>`;
  }
  const locked = dc.secondsLeft > 0;
  const textOk = dc.text.trim() === 'DELETE';
  return `
    <div class="stack" style="border:1px solid #FCA5A5;background:#FEF2F2;border-radius:12px;padding:14px;gap:10px">
      <div class="card-title" style="color:#B91C1C">Delete ${esc(c.name)}?</div>
      <p class="muted">This permanently deletes the company ${quoteCount ? `and all <strong>${quoteCount}</strong> of its quotes` : ''} — including its numbering history in the audit trail. This cannot be undone.</p>
      <label class="field"><span class="field-label">Type DELETE to confirm</span>
        <input class="input" data-deleteinput value="${esc(dc.text)}" ${locked ? 'disabled' : ''} placeholder="DELETE" autocomplete="off" /></label>
      <div class="row">
        <button class="btn" style="background:#B91C1C;color:#fff;border-color:#B91C1C" data-confirmdelete="${c.id}" ${locked || !textOk ? 'disabled' : ''}>
          ${locked ? `Wait ${dc.secondsLeft}s…` : 'Permanently delete'}
        </button>
        <button class="btn" data-canceldelete>Cancel</button>
      </div>
    </div>`;
}

function viewCompanyDetail() {
  const c = company(state.editingCompanyId);
  if (!c) return `<div class="card card-pad muted stack">Company not found.<button class="btn" data-go="companies" style="align-self:flex-start">← Back to companies</button></div>`;

  const inactive = c.active === false;
  const on = c.id === state.companyId;
  const logoUrl = state.companyLogoEdits[c.id] !== undefined ? state.companyLogoEdits[c.id] : c.logoDataUrl;
  const quoteCount = state.quotes.filter(q => q.companyId === c.id).length;

  return `
    <div class="row no-print" style="justify-content:space-between">
      <button class="btn" data-go="companies">← Back to companies</button>
      <button class="btn ${on ? 'primary' : ''}" data-select="${c.id}" ${on || inactive ? 'disabled' : ''}>${on ? 'Selected' : 'Switch to'}</button>
    </div>

    <div>
      <div class="eyebrow accent">Edit company${inactive ? ' · Inactive' : ''}</div>
      <h2 style="font-size:26px;margin:2px 0 4px">${esc(c.name)}</h2>
      <div class="stat-sub">${esc(c.tagline || '')}${c.tagline ? ' · ' : ''}${quoteCount} quote${quoteCount === 1 ? '' : 's'} issued</div>
    </div>

    <div class="card card-pad stack">
      <div class="card-title">Business details</div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
        ${fieldInputs(c, BUSINESS_FIELDS)}
        ${fieldInputs(c, NUMBERING_FIELDS)}
        ${fieldInputs(c, REG_FIELDS)}
        <label class="field"><span class="field-label">Quote layout</span>
          <select class="input" data-co="${c.id}" data-field="layout">
            ${[['band', 'Gradient band'], ['classic', 'Classic bordered'], ['minimal', 'Minimal typographic']]
              .map(([v, l]) => `<option value="${v}" ${c.layout === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select></label>
      </div>

      <label class="field"><span class="field-label">Address</span>
        <textarea class="input" data-co="${c.id}" data-field="address">${esc(c.address)}</textarea></label>

      <div class="card-title" style="margin-top:6px">Logo</div>
      <label class="logo-drop" for="logoFile-${c.id}">
        ${logoUrl ? `<img src="${logoUrl}" style="width:36px;height:36px;object-fit:cover;border-radius:8px;flex:none" />` : ''}
        <span>${logoUrl ? 'Click to change logo (PNG/JPG, shown on quotes)' : 'Click to upload a logo (PNG/JPG, shown on quotes)'}</span>
      </label>
      <input type="file" id="logoFile-${c.id}" accept="image/*" data-logoupload="${c.id}" style="display:none" />

      <div class="card-title" style="margin-top:6px">Banking details <span class="stat-sub">(printed on quotes)</span></div>
      <textarea class="input" data-co="${c.id}" data-field="banking">${esc(c.banking)}</textarea>

      <div class="card-title" style="margin-top:6px">Document text</div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">
        <label class="field"><span class="field-label">Terms</span>
          <textarea class="input" data-co="${c.id}" data-field="terms">${esc(c.terms)}</textarea></label>
        <label class="field"><span class="field-label">Document footer</span>
          <textarea class="input" data-co="${c.id}" data-field="footer">${esc(c.footer)}</textarea></label>
      </div>

      <div class="row" style="margin-top:6px">
        <div class="pill tint">Next: ${esc(state.next[c.id] || '—')}</div>
        <button class="btn primary spacer" data-savecompany="${c.id}">Save ${esc(c.short)}</button>
        <button class="btn" data-toggleactive="${c.id}">${inactive ? 'Reactivate' : 'Deactivate'}</button>
        ${state.deleteConfirm && state.deleteConfirm.id === c.id ? '' : deleteConfirmBlock(c, quoteCount)}
      </div>
      ${state.deleteConfirm && state.deleteConfirm.id === c.id ? deleteConfirmBlock(c, quoteCount) : ''}
    </div>`;
}

function viewCompanyNew() {
  const d = state.newCompanyDraft;
  return `
    <p class="muted">Set up a new company — its own letterhead, VAT number, banking details, numbering format and quote layout, with an independent number sequence starting at 1.</p>
    <div class="card card-pad stack">
      <div class="card-title">Business details</div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
        <label class="field"><span class="field-label">Registered name *</span>
          <input class="input" placeholder="Acme Electrical Services" value="${esc(d.name)}" data-newco="name" /></label>
        <label class="field"><span class="field-label">Short name</span>
          <input class="input" placeholder="Acme Electrical" value="${esc(d.short)}" data-newco="short" /></label>
        <label class="field"><span class="field-label">Logo initials</span>
          <input class="input" placeholder="ACM" value="${esc(d.initials)}" data-newco="initials" /></label>
        <label class="field"><span class="field-label">Tagline</span>
          <input class="input" value="${esc(d.tagline)}" data-newco="tagline" /></label>
        <label class="field"><span class="field-label">Number prefix</span>
          <input class="input" placeholder="ACM-Q" value="${esc(d.prefix)}" data-newco="prefix" /></label>
        <label class="field"><span class="field-label">Digits</span>
          <input class="input" type="number" value="${esc(d.pad)}" data-newco="pad" /></label>
        <label class="field"><span class="field-label">Currency symbol</span>
          <input class="input" value="${esc(d.currency)}" data-newco="currency" /></label>
        <label class="field"><span class="field-label">VAT %</span>
          <input class="input" type="number" value="${esc(d.vatRate)}" data-newco="vatRate" /></label>
        <label class="field"><span class="field-label">Validity (days)</span>
          <input class="input" type="number" value="${esc(d.validDays)}" data-newco="validDays" /></label>
        <label class="field"><span class="field-label">Quote layout</span>
          <select class="input" data-newco="layout">
            ${[['band', 'Gradient band'], ['classic', 'Classic bordered'], ['minimal', 'Minimal typographic']]
              .map(([v, l]) => `<option value="${v}" ${d.layout === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select></label>
      </div>
      <label class="field"><span class="field-label">Address</span>
        <textarea class="input" data-newco="address">${esc(d.address)}</textarea></label>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
        <label class="field"><span class="field-label">VAT number</span>
          <input class="input" value="${esc(d.vatNo)}" data-newco="vatNo" /></label>
        <label class="field"><span class="field-label">Reg number</span>
          <input class="input" value="${esc(d.regNo)}" data-newco="regNo" /></label>
      </div>

      <div class="row" style="align-items:center">
        <div class="doc-logo">${d.logoDataUrl ? `<img src="${d.logoDataUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:11px" />` : esc(d.initials || '?')}</div>
        <label class="btn" for="logoFile-new">Upload logo</label>
        <input type="file" id="logoFile-new" accept="image/*" data-logoupload="new" style="display:none" />
        <div class="stat-sub">PNG/JPG, shown on quotes &amp; in the sidebar</div>
      </div>

      <label class="field"><span class="field-label">Banking details</span>
        <textarea class="input" data-newco="banking">${esc(d.banking)}</textarea></label>
      <label class="field"><span class="field-label">Terms</span>
        <textarea class="input" data-newco="terms">${esc(d.terms)}</textarea></label>
      <label class="field"><span class="field-label">Document footer</span>
        <textarea class="input" data-newco="footer">${esc(d.footer)}</textarea></label>

      <div class="row">
        <button class="btn primary" data-savenewcompany>Create company</button>
        <button class="btn" data-go="companies">Cancel</button>
      </div>
    </div>`;
}

const AUDIT_LABEL = {
  'quote.create': a => `${a.details?.number || 'Quote'} issued to ${a.details?.client || 'a client'}`,
  'quote.status_change': a => `${a.details?.number || 'Quote'} marked ${a.details?.to || ''}`,
  'company.create': a => `Company created: ${a.details?.name || a.targetId}`,
  'company.update': a => `Company details updated: ${a.targetId}`,
  'company.deactivate': a => `Company deactivated: ${a.targetId}`,
  'company.reactivate': a => `Company reactivated: ${a.targetId}`,
  'company.delete': a => `Company deleted: ${a.details?.name || a.targetId}${a.details?.quotesDeleted ? ` (${a.details.quotesDeleted} quotes deleted with it)` : ''}`,
  'auth.login': a => `${a.actorEmail} signed in`,
  'auth.logout': a => `${a.actorEmail} signed out`
};
const AUDIT_ICON = a => a.action.startsWith('auth') ? '🔑' : a.action.startsWith('company') ? '🏢' : (a.device === 'mobile' ? '📱' : '💻');

function viewActivity() {
  const rows = (state.auditLog || []).map(a => `<div class="activity-row">
      <div class="activity-icon">${AUDIT_ICON(a)}</div>
      <div class="activity-main">
        <div class="activity-title">${esc((AUDIT_LABEL[a.action] || (x => x.action))(a))}</div>
        <div class="activity-detail">${esc(a.actorEmail || 'system')}${a.actorRole ? ' · ' + esc(a.actorRole) : ''}</div>
      </div>
      <div class="activity-when">${fmtDate(a.at)}</div>
    </div>`).join('');

  return `
    <p class="muted">Every action across the system — quotes issued, companies changed, sign-ins — with who did it and when. This is the audit trail: server-recorded, not derived from the browser.</p>
    <div class="card" style="overflow:hidden">${rows || '<div class="card-pad muted">No activity yet.</div>'}</div>`;
}

/* ----------------------------------------------------------------- events */

document.addEventListener('click', async e => {
  const t = e.target.closest('[data-go],[data-open],[data-editcompany],[data-save],[data-additem],[data-remove],[data-print],[data-select],[data-savecompany],[data-toggleactive],[data-startdelete],[data-canceldelete],[data-confirmdelete],[data-savenewcompany],[data-logout]');
  if (!t) return;

  if (t.hasAttribute('data-logout')) {
    try { await api('POST', '/api/auth/logout'); } catch (_) { /* session already gone */ }
    state.user = null;
    renderLogin();
    return;
  }

  if (t.dataset.go) return go(t.dataset.go);
  if (t.dataset.open) { state.openId = t.dataset.open; return go('quote'); }
  if (t.dataset.editcompany) { state.editingCompanyId = t.dataset.editcompany; return go('company-detail'); }
  if (t.hasAttribute('data-print')) return window.print();

  if (t.hasAttribute('data-additem')) {
    state.draft.items.push({ desc: '', qty: '1', rate: '0' });
    return render();
  }
  if (t.dataset.remove) {
    state.draft.items.splice(Number(t.dataset.remove), 1);
    if (!state.draft.items.length) state.draft.items.push({ desc: '', qty: '1', rate: '0' });
    return render();
  }

  if (t.dataset.select) {
    state.companyId = t.dataset.select;
    return go('quotes');
  }

  if (t.dataset.savecompany) {
    const id = t.dataset.savecompany;
    const payload = {};
    document.querySelectorAll(`[data-co="${id}"]`).forEach(f => { payload[f.dataset.field] = f.value; });
    if (id in state.companyLogoEdits) payload.logoDataUrl = state.companyLogoEdits[id];
    t.disabled = true;
    try {
      const out = await api('PUT', '/api/companies/' + id, payload);
      Object.assign(company(id), out.company);
      delete state.companyLogoEdits[id];
      state.next[id] = out.next;
      renderChrome(); render();
      toast(out.company.short + ' details saved for every device');
    } catch (err) { toast('Could not save: ' + err.message); }
    t.disabled = false;
    return;
  }

  if (t.dataset.toggleactive) {
    const id = t.dataset.toggleactive;
    const co = company(id);
    const nextActiveState = co.active === false;
    t.disabled = true;
    try {
      const out = await api('PUT', '/api/companies/' + id, { active: nextActiveState });
      Object.assign(co, out.company);
      if (!nextActiveState && state.companyId === id) {
        const fallback = state.companies.find(c2 => c2.id !== id && c2.active !== false);
        if (fallback) state.companyId = fallback.id;
      }
      renderChrome(); render();
      toast(`${co.short} ${nextActiveState ? 'reactivated' : 'deactivated'}`);
    } catch (err) { toast('Could not update: ' + err.message); }
    t.disabled = false;
    return;
  }

  if (t.dataset.startdelete) {
    const id = t.dataset.startdelete;
    state.deleteConfirm = { id, secondsLeft: 5, text: '' };
    render();
    clearInterval(deleteCountdownTimer);
    deleteCountdownTimer = setInterval(() => {
      if (!state.deleteConfirm || state.deleteConfirm.id !== id) { clearInterval(deleteCountdownTimer); return; }
      state.deleteConfirm.secondsLeft -= 1;
      if (state.deleteConfirm.secondsLeft <= 0) {
        state.deleteConfirm.secondsLeft = 0;
        clearInterval(deleteCountdownTimer);
        render(); // unlock the confirm input/button
      } else {
        const btn = document.querySelector('[data-confirmdelete]');
        if (btn) btn.textContent = `Wait ${state.deleteConfirm.secondsLeft}s…`;
      }
    }, 1000);
    return;
  }

  if (t.hasAttribute('data-canceldelete')) {
    clearInterval(deleteCountdownTimer);
    state.deleteConfirm = null;
    render();
    return;
  }

  if (t.dataset.confirmdelete) {
    const id = t.dataset.confirmdelete;
    const co = company(id);
    t.disabled = true;
    try {
      await api('DELETE', '/api/companies/' + id);
      state.companies = state.companies.filter(c2 => c2.id !== id);
      state.quotes = state.quotes.filter(q => q.companyId !== id);
      delete state.companyLogoEdits[id];
      if (state.companyId === id) {
        const fallback = state.companies.find(c2 => c2.active !== false) || state.companies[0];
        state.companyId = fallback ? fallback.id : null;
      }
      state.deleteConfirm = null;
      if (state.editingCompanyId === id) state.screen = 'companies';
      renderChrome(); render();
      toast(`${co.name} permanently deleted`);
    } catch (err) { toast('Could not delete: ' + err.message); t.disabled = false; }
    return;
  }

  if (t.hasAttribute('data-savenewcompany')) {
    if (!state.newCompanyDraft.name || !state.newCompanyDraft.name.trim()) {
      toast('Company name is required');
      return;
    }
    t.disabled = true;
    try {
      const out = await api('POST', '/api/companies', state.newCompanyDraft);
      state.companies.push(out.company);
      state.next[out.company.id] = out.next;
      state.companyId = out.company.id;
      state.screen = 'quotes';
      renderChrome(); render(); window.scrollTo(0, 0);
      toast(`${out.company.name} added — first quote will be ${out.next}`);
    } catch (err) { toast('Could not create company: ' + err.message); }
    t.disabled = false;
    return;
  }

  if (t.hasAttribute('data-save')) {
    t.disabled = true;
    try {
      const out = await api('POST', '/api/quotes', {
        companyId: state.companyId,
        token: state.reservation && state.reservation.token,
        client: state.draft.client, contact: state.draft.contact, notes: state.draft.notes,
        items: state.draft.items,
        device: isMobileDevice() ? 'mobile' : 'desktop'
      });
      state.quotes.push(out.quote);
      state.next[state.companyId] = out.next;
      state.reservation = null;
      state.openId = out.quote.id;
      state.draft = { client: '', contact: '', notes: '', items: [{ desc: '', qty: '1', rate: '0' }] };
      state.screen = 'quote';
      renderChrome(); render(); window.scrollTo(0, 0);
      toast(`${out.quote.number} issued from ${out.quote.device} · sequence advanced for everyone`);
    } catch (err) { toast('Could not save: ' + err.message); t.disabled = false; }
  }
});

document.addEventListener('input', e => {
  const f = e.target;
  if (f.dataset.draft) { state.draft[f.dataset.draft] = f.value; return; }
  if (f.dataset.newco) { state.newCompanyDraft[f.dataset.newco] = f.value; return; }
  if (f.hasAttribute('data-deleteinput')) {
    state.deleteConfirm.text = f.value;
    const btn = document.querySelector('[data-confirmdelete]');
    if (btn) btn.disabled = state.deleteConfirm.secondsLeft > 0 || f.value.trim() !== 'DELETE';
    return;
  }
  if (f.dataset.item !== undefined && f.dataset.key) {
    const it = state.draft.items[Number(f.dataset.item)];
    it[f.dataset.key] = f.value;
    if (f.dataset.key !== 'desc') {
      // live totals without losing focus
      const box = f.closest('.lineitem');
      box.querySelector('.lineitem-total .amount').textContent = money((Number(it.qty) || 0) * (Number(it.rate) || 0));
      const co = company();
      const sub = state.draft.items.reduce((a, x) => a + (Number(x.qty) || 0) * (Number(x.rate) || 0), 0);
      const vat = sub * (Number(co.vatRate) || 0) / 100;
      const t = document.querySelectorAll('.totals .totals-line span:last-child');
      if (t[0]) t[0].textContent = money(sub);
      if (t[1]) t[1].textContent = money(vat);
      const g = document.querySelector('.totals-grand .value');
      if (g) g.textContent = money(sub + vat);
    }
  }
});

document.addEventListener('change', async e => {
  const f = e.target;
  if (f.id === 'companyPicker' || f.id === 'companyPickerMobile') {
    if (state.screen === 'new') await releaseNumber();
    state.companyId = f.value;
    state.openId = null;
    return go(state.screen === 'quote' ? 'quotes' : state.screen);
  }
  if (f.dataset.logoupload !== undefined) {
    const file = f.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (f.dataset.logoupload === 'new') {
        state.newCompanyDraft.logoDataUrl = reader.result;
      } else {
        state.companyLogoEdits[f.dataset.logoupload] = reader.result;
      }
      render();
    };
    reader.readAsDataURL(file);
    return;
  }
  if (f.hasAttribute('data-status')) {
    const q = state.quotes.find(x => x.id === state.openId);
    try {
      await api('PATCH', '/api/quotes/' + q.id, { status: f.value });
      q.status = f.value;
      toast(q.number + ' marked ' + f.value.toLowerCase());
    } catch (err) { toast('Could not update: ' + err.message); }
  }
});

window.addEventListener('beforeunload', () => {
  if (state.reservation && navigator.sendBeacon) {
    navigator.sendBeacon('/api/release', new Blob([JSON.stringify({ token: state.reservation.token })], { type: 'application/json' }));
  }
});

/* ------------------------------------------------------------------- auth */

const APP_SHELL_HTML = document.querySelector('.app').innerHTML;

function renderLogin(error) {
  document.querySelector('.app').innerHTML = `
    <div style="min-height:100dvh;width:100%;display:flex;align-items:center;justify-content:center;padding:24px">
      <div class="card card-pad stack" style="width:100%;max-width:360px">
        <div class="stack" style="gap:6px;align-items:center;text-align:center">
          <div class="brand-mark" style="width:40px;height:40px;border-radius:11px;background:var(--gradient);color:#fff;display:grid;place-items:center;font-weight:900">Q</div>
          <div class="card-title" style="font-size:18px">Sign in to QuoteFlow</div>
          <div class="stat-sub">Companies, quotes and numbering are shared across every signed-in device.</div>
        </div>
        <label class="field"><span class="field-label">Email</span>
          <input class="input" id="loginEmail" type="email" placeholder="admin@quoteflow.demo" /></label>
        <label class="field"><span class="field-label">Password</span>
          <input class="input" id="loginPassword" type="password" placeholder="••••••••" /></label>
        ${error ? `<p style="color:#B91C1C;font-size:13px">${esc(error)}</p>` : ''}
        <button class="btn primary block" id="loginSubmit">Sign in</button>
        <div class="stat-sub" style="text-align:center;line-height:1.6">Demo accounts (local test data) —<br/>admin@quoteflow.demo / admin123 (full access)<br/>staff@quoteflow.demo / staff123 (quotes only)</div>
      </div>
    </div>`;

  const submit = async () => {
    const email = el('loginEmail').value.trim();
    const password = el('loginPassword').value;
    el('loginSubmit').disabled = true;
    try {
      const out = await api('POST', '/api/auth/login', { email, password });
      state.user = out.user;
      await startApp();
    } catch (err) {
      renderLogin(err.message);
    }
  };
  el('loginSubmit').onclick = submit;
  el('loginPassword').addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
}

async function startApp() {
  document.querySelector('.app').innerHTML = APP_SHELL_HTML;
  await bootstrap();
}

async function boot() {
  try {
    const me = await api('GET', '/api/auth/me');
    if (me.user) { state.user = me.user; await startApp(); }
    else renderLogin();
  } catch (err) {
    renderLogin(err.message);
  }
}

boot();
