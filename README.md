# QuoteFlow — Multi-Company Quotation System (Proof of Concept)

A working proof of concept for a web-based quotation system, themed on Zano Systems'
dark/violet visual identity. Built to demonstrate the two hard requirements before any
further investment: **shared quote-number continuity across devices** and **multi-company
branding**.

## What this proves

1. **Quote numbers never reset or collide across devices.** The counter lives on the
   server's database, on the company record — not in the browser. If someone in the
   office creates quotes 1–5, and a completely different phone that has never opened
   the app before creates the next one, it is issued number 6. This was tested directly
   (see "Continuity test" below) and works because the number is assigned in one atomic
   database transaction at the moment "Create quote" is pressed, not by the device.

2. **Each company is fully self-contained.** Name, address, logo, bank details, currency,
   default tax rate, quote-number prefix, and even a brand accent colour are all stored
   per company. The printable quote document pulls its layout and branding from whichever
   company it belongs to, so two companies in the same system never look alike or share
   a numbering sequence.

3. **Responsive on phone and desktop.** Single set of HTML/CSS/JS, no separate mobile app,
   works in any modern browser.

## Continuity test (already run once, reproducible)

With the server running, five quotes were created back to back (simulating in-office use),
then a sixth was created from a separate "device label" simulating an off-site phone:

```
ACM-0001 | Office Desktop   | Client A
ACM-0002 | Office Desktop   | Client B
ACM-0003 | Front Desk PC    | Client C
ACM-0004 | Office Desktop   | Client D
ACM-0005 | Front Desk PC    | Client E
ACM-0006 | Mobile - Off Site| Client F (off-site)   <-- continues correctly, no reset
```

In the actual product, "device label" would just be whichever phone/laptop is logged in —
it's exposed in this POC's top bar purely so you can demo the continuity live (open two
browser tabs or an incognito window, set one to "Mobile — Off Site", and create quotes
from both to watch the numbers interleave correctly).

## Running it

Requires Node.js 22.5 or newer (uses Node's built-in SQLite; no external database to install).

```bash
npm install
npm run seed      # creates two demo companies with sample branding/banking info
npm start         # starts the server on http://localhost:4000
```

Open `http://localhost:4000` in a browser (or on a phone on the same network, using the
machine's IP instead of localhost) — the layout adapts automatically.

## What's real vs. what's simulated in this POC

- **Real:** the database, the atomic quote-number counter, company branding/storage,
  quote creation, totals/tax calculation, the printable quote view (Print → Save as PDF).
- **Simulated for the demo:** the "device label" picker in the top bar. In production this
  would simply be "whichever user is logged in on whichever device," with no manual picker —
  it's here only so the continuity behaviour is visible and demonstrable in one browser.
- **Not yet built (next phase, if this POC is approved):** user accounts/login and
  permissions, sending quotes by email, e-signature/acceptance flow, converting an accepted
  quote to an invoice, and hosting it somewhere with a real domain (this POC runs locally;
  going live means deploying it to a small cloud server so it's reachable from any device
  anywhere, not just one machine).

## Design

Colour palette, dark theme, and typography are modelled on zanosystems.com (near-black
background, violet accent `#8B5CF6`, bold serif headlines, uppercase tracked labels,
outlined buttons). Each company can still set its own accent colour so its quotes look
like its own brand, not Zano's.

## File structure

```
quotepoc/
  server.js        Express server + REST API + the atomic quote-numbering logic
  db.js            SQLite schema (companies, quotes, quote_items)
  seed.js           Demo data
  public/
    index.html
    styles.css
    app.js         Entire frontend (no framework, no build step)
```
