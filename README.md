# QuoteFlow — multi-company web quotation system (POC)

A small Node/Express app. Quote numbers are issued **by the server**, so a quote
raised on a phone in the field continues the same sequence as the office laptop:
5 quotes exist → the 6th, from any device, is number 6.

## Demo credentials

Sign-in is required. Two seeded accounts, for local testing only:

| Email                    | Password  | Role  | Can do                                    |
| ------------------------- | --------- | ----- | ------------------------------------------ |
| `admin@quoteflow.demo`    | `admin123`| admin | Everything — manage companies, quotes, users' activity |
| `staff@quoteflow.demo`    | `staff123`| staff | Create & view quotes; companies are read-only |

Rotate or replace these before any real deployment.

## What's in the POC

- **Continuous numbering** — the server reserves the next number when a draft is
  started (held 30 min, released if abandoned), so two people quoting at the same
  time can't collide or duplicate.
- **Real database** — [libSQL](https://turso.tech) via `@libsql/client`, the
  same client Turso (hosted libSQL) uses in production. Runs against a local
  SQLite file out of the box (`data/quoteflow.db`, zero cloud account needed);
  point it at a real Turso database later by setting `TURSO_DATABASE_URL` and
  `TURSO_AUTH_TOKEN` — no schema or query changes required.
- **Authentication & access levels** — cookie-based sessions, scrypt-hashed
  passwords, two roles (`admin` / `staff`). Company management (create,
  deactivate, delete, logo, banking/VAT details) is admin-only, enforced both
  in the UI and on the server (403 if bypassed). Quote creation is open to any
  signed-in user.
- **Audit trail** — a dedicated `audit_log` table (not derived from quotes)
  records every login/logout, company change, and quote create/status-change
  with who, what, and when. Viewable on the Activity tab.
- **Multiple companies** — each with its own name, address, VAT/reg number,
  banking details, terms, footer, currency, VAT rate, number format (prefix +
  digit padding), logo, and **quote layout** (gradient band / classic / minimal).
  Admins can add, edit, deactivate/reactivate, or delete (if it has no quotes yet)
  a company — all saved server-side so every device sees it.
- **Responsive by viewport** — mobile browsers get the stacked layout with a
  bottom tab bar; desktop browsers get the sidebar layout. Pure CSS media
  queries, no device sniffing, same URL.
- **Print / save PDF** — the quote document has print styles (A4 margins,
  chrome hidden).

## Run it locally

```bash
npm install
npm run dev        # or: npm start
```

Open http://localhost:3000 and sign in with one of the demo accounts above.

To try the mobile view on your phone while developing, find your machine's LAN
IP (`ipconfig` / `ifconfig`) and open `http://<your-ip>:3000` on the phone —
both devices then share the same number sequence, which is the whole point.

## Deploy to Railway

1. Push this repo to GitHub.
2. Railway → **New Project → Deploy from GitHub repo** → pick the repo.
3. Railway auto-detects Node and runs `npm start`. No build command needed.
   It injects `PORT`; the server already uses it.
4. Settings → **Networking → Generate Domain** to get a public URL.

### Database

By default the app opens a local SQLite file at `data/quoteflow.db`. Railway's
container filesystem is ephemeral, so for a persistent demo either:

- Add a **Volume** (Service → Data → Add Volume), mount it at `/data`, and set
  `DATA_DIR=/data`; or
- Point at a real [Turso](https://turso.tech) database instead — create one,
  then set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` as environment
  variables. No code changes needed; `db.js` picks them up automatically.

## Files

```
server.js          Express API, auth/session middleware, number reservation logic
db.js              Database layer (libSQL/Turso), schema migration, seeding, audit()
seed.json          Demo companies and quotes, loaded on first boot if the DB is empty
public/index.html  App shell
public/styles.css  Design-system styling + responsive/print rules
public/app.js      Front end (vanilla JS, no build step) — login, quotes, companies, activity
```

## API

| Method | Route                 | Auth        | Purpose                                    |
| ------ | --------------------- | ----------- | ------------------------------------------- |
| POST   | `/api/auth/login`     | —           | sign in, sets session cookie                |
| POST   | `/api/auth/logout`    | signed in   | end session                                 |
| GET    | `/api/auth/me`        | —           | current user, or `{user: null}`             |
| GET    | `/api/bootstrap`      | signed in   | companies, quotes, next number per company  |
| POST   | `/api/reserve`        | signed in   | reserve the next number for a draft         |
| POST   | `/api/release`        | signed in   | release an abandoned reservation            |
| POST   | `/api/quotes`         | signed in   | save a quote against a reservation          |
| PATCH  | `/api/quotes/:id`     | signed in   | change status                               |
| POST   | `/api/companies`      | admin       | create a company                            |
| PUT    | `/api/companies/:id`  | admin       | edit details / layout / numbering / active  |
| DELETE | `/api/companies/:id`  | admin       | delete (only if it has zero quotes)         |
| GET    | `/api/audit`          | signed in   | last 200 audit trail entries                |

## Not in the POC (deliberately)

Quote → invoice conversion, PDF emailing, client database, attachments,
multi-currency FX, approval workflow, and self-service signup (accounts are
seeded, not registered).
