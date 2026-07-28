// seed.js - creates two demo companies so the client has something to click into immediately
const db = require('./db');

const companies = [
  {
    slug: 'acme-electrical',
    name: 'Acme Electrical Services',
    quote_prefix: 'ACM',
    accent_color: '#F59E0B',
    address: '14 Baines Avenue, Harare, Zimbabwe',
    email: 'accounts@acmeelectrical.co.zw',
    phone: '+263 77 123 4567',
    website: 'www.acmeelectrical.co.zw',
    bank_name: 'CBZ Bank',
    bank_account_name: 'Acme Electrical Services (Pvt) Ltd',
    bank_account_number: '01234567890123',
    bank_branch: 'Borrowdale Branch',
    bank_swift: 'CBZWZWHA',
    currency: 'USD',
    default_tax_rate: 15
  },
  {
    slug: 'greenfield-logistics',
    name: 'Greenfield Logistics',
    quote_prefix: 'GFL',
    accent_color: '#10B981',
    address: '88 Simon Mazorodze Rd, Harare, Zimbabwe',
    email: 'quotes@greenfieldlogistics.com',
    phone: '+263 71 987 6543',
    website: 'www.greenfieldlogistics.com',
    bank_name: 'Stanbic Bank',
    bank_account_name: 'Greenfield Logistics Pvt Ltd',
    bank_account_number: '98765432109876',
    bank_branch: 'Msasa Branch',
    bank_swift: 'SBICZWHX',
    currency: 'USD',
    default_tax_rate: 15
  }
];

const insert = db.prepare(`
  INSERT OR IGNORE INTO companies
    (slug, name, quote_prefix, next_quote_seq, accent_color, address, email, phone, website,
     bank_name, bank_account_name, bank_account_number, bank_branch, bank_swift, currency, default_tax_rate)
  VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

for (const c of companies) {
  insert.run(
    c.slug, c.name, c.quote_prefix, c.accent_color, c.address, c.email, c.phone, c.website,
    c.bank_name, c.bank_account_name, c.bank_account_number, c.bank_branch, c.bank_swift,
    c.currency, c.default_tax_rate
  );
}

console.log('Seeded demo companies: Acme Electrical Services, Greenfield Logistics');
