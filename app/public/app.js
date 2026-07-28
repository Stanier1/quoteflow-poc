/* QuoteFlow front end — vanilla JS, no build step.
   Layout is responsive via CSS media queries; this file only records which
   kind of device a quote was raised on (for the audit trail). */

const NBSP = '\u202F';
const state = {
  companies: [], quotes: [], next: {},
  companyId: null, screen: 'quotes', openId: null,
  reservation: null,
  draft: { client: '', contact: '', notes: '', items: [{ desc: '', qty: '1', rate: '0' }] }
};

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
  return res.json();
}

async function bootstrap() {
  const data = await api('GET', '/api/bootstrap');
  state.companies = data.companies;
  state.quotes = data.quotes;
  state.next = data.next;
  if (!company()) state.companyId = state.companies[0].id;
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

const NAV = [
  { key: 'quotes', label: 'Quotes', icon: '📄' },
  { key: 'new', label: 'New', icon: '✚' },
  { key: 'companies', label: 'Companies', icon: '🏢' },
  { key: 'activity', label: 'Activity', icon: '🕑' }
];

function renderChrome() {
  const opts = state.companies.map(c =>
    `<option value="${c.id}" ${c.id === state.companyId ? 'selected' : ''}>${esc(c.short)}</option>`).join('');
  ['companyPicker', 'companyPickerMobile'].forEach(id => { el(id).innerHTML = opts; });

  el('sidenav').innerHTML = NAV.map(n =>
    `<button class="navitem ${isActive(n.key) ? 'active' : ''}" data-go="${n.key}">
       <span class="ico">${n.icon}</span><span>${n.label}</span>
     </button>`).join('');

  el('tabbar').innerHTML = NAV.map(n =>
    `<button class="tab ${isActive(n.key) ? 'active' : ''}" data-go="${n.key}">
       <span>${n.icon}</span><span>${n.label}</span>
     </button>`).join('');

  const co = company();
  el('topCompany').textContent = co ? co.name : '';
  el('topTitle').textContent = { quotes: 'Quotes', new: 'New quotation', quote: 'Quotation', companies: 'Companies & branding', activity: 'Number activity' }[state.screen];
  el('nextPill').innerHTML = `<span class="dot"></span>Next: ${esc(state.next[state.companyId] || '—')}`;
}

const isActive = key => state.screen === key || (key === 'quotes' && state.screen === 'quote');

async function go(screen) {
  if (state.screen === 'new' && screen !== 'new') await releaseNumber();
  state.screen = screen;
  if (screen === 'new') await reserveNumber();
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
  const views = { quotes: viewQuotes, new: viewNew, quote: viewQuote, companies: viewCompanies, activity: viewActivity };
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

const COMPANY_FIELDS = [
  ['name', 'Registered name', 'text'], ['short', 'Short name', 'text'],
  ['initials', 'Logo initials', 'text'], ['tagline', 'Tagline', 'text'],
  ['prefix', 'Number prefix', 'text'], ['pad', 'Digits', 'number'],
  ['currency', 'Currency symbol', 'text'], ['vatRate', 'VAT %', 'number'],
  ['validDays', 'Validity (days)', 'number'], ['vatNo', 'VAT number', 'text'],
  ['regNo', 'Reg number', 'text']
];

function viewCompanies() {
  return `
    <p class="muted">Each company keeps its own letterhead, address, VAT number, banking details, numbering format and quote layout — and its own independent number sequence. Edits save to the server, so every device sees them.</p>
    ${state.companies.map(c => {
      const on = c.id === state.companyId;
      return `<div class="card card-pad stack" style="${on ? 'border-color:var(--purple);box-shadow:0 8px 32px rgba(176,45,214,0.12)' : ''}" data-company="${c.id}">
        <div class="row" style="align-items:flex-start">
          <div class="doc-logo">${esc(c.initials)}</div>
          <div style="flex:1;min-width:0">
            <div class="card-title" style="font-size:16px">${esc(c.name)}</div>
            <div class="stat-sub">${esc(c.tagline)}</div>
          </div>
          <button class="btn ${on ? 'primary' : ''}" data-select="${c.id}" ${on ? 'disabled' : ''}>${on ? 'Active' : 'Switch to'}</button>
        </div>

        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
          ${COMPANY_FIELDS.map(([k, label, type]) => `
            <label class="field"><span class="field-label">${label}</span>
              <input class="input" type="${type}" value="${esc(c[k])}" data-co="${c.id}" data-field="${k}" /></label>`).join('')}
          <label class="field"><span class="field-label">Quote layout</span>
            <select class="input" data-co="${c.id}" data-field="layout">
              ${[['band', 'Gradient band'], ['classic', 'Classic bordered'], ['minimal', 'Minimal typographic']]
                .map(([v, l]) => `<option value="${v}" ${c.layout === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select></label>
        </div>

        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">
          <label class="field"><span class="field-label">Address</span>
            <textarea class="input" data-co="${c.id}" data-field="address">${esc(c.address)}</textarea></label>
          <label class="field"><span class="field-label">Banking details</span>
            <textarea class="input" data-co="${c.id}" data-field="banking">${esc(c.banking)}</textarea></label>
          <label class="field"><span class="field-label">Terms</span>
            <textarea class="input" data-co="${c.id}" data-field="terms">${esc(c.terms)}</textarea></label>
          <label class="field"><span class="field-label">Document footer</span>
            <textarea class="input" data-co="${c.id}" data-field="footer">${esc(c.footer)}</textarea></label>
        </div>

        <div class="row">
          <div class="pill tint">Next: ${esc(state.next[c.id] || '—')}</div>
          <button class="btn primary spacer" data-savecompany="${c.id}">Save ${esc(c.short)}</button>
        </div>
      </div>`;
    }).join('')}`;
}

function viewActivity() {
  const rows = state.quotes.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(q => {
    const co = company(q.companyId);
    return `<div class="activity-row">
      <div class="activity-icon">${q.device === 'mobile' ? '📱' : '💻'}</div>
      <div class="activity-main">
        <div class="activity-title">${esc(q.number)} issued to ${esc(q.client)}</div>
        <div class="activity-detail">${esc(co.short)} · ${q.device === 'mobile' ? 'mobile, off-site' : 'desktop, office'} · ${esc(q.status)}</div>
      </div>
      <div class="activity-when">${fmtDate(q.createdAt)}</div>
    </div>`;
  }).join('');

  return `
    <p class="muted">Every number issued across all companies, with the device it came from. This is the audit trail that proves no number is skipped or duplicated while the team is out of office.</p>
    <div class="card" style="overflow:hidden">${rows}</div>`;
}

/* ----------------------------------------------------------------- events */

document.addEventListener('click', async e => {
  const t = e.target.closest('[data-go],[data-open],[data-save],[data-additem],[data-remove],[data-print],[data-select],[data-savecompany]');
  if (!t) return;

  if (t.dataset.go) return go(t.dataset.go);
  if (t.dataset.open) { state.openId = t.dataset.open; return go('quote'); }
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
    t.disabled = true;
    try {
      const out = await api('PUT', '/api/companies/' + id, payload);
      Object.assign(company(id), out.company);
      state.next[id] = out.next;
      renderChrome(); render();
      toast(out.company.short + ' details saved for every device');
    } catch (err) { toast('Could not save: ' + err.message); }
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

bootstrap().catch(err => {
  el('content').innerHTML = `<div class="card card-pad muted">Could not reach the server: ${esc(err.message)}</div>`;
});
