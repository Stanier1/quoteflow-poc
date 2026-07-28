# QuoteFlow — multi-company web quotation system (POC)

A small Node/Express app. Quote numbers are issued **by the server**, so a quote
raised on a phone in the field continues the same sequence as the office laptop:
5 quotes exist → the 6th, from any device, is number 6.

## What's in the POC

- **Continuous numbering** — the server reserves the next number when a draft is
  started (held 30 min, released if abandoned), so two people quoting at the same
  time can't collide or duplicate.
- **Multiple companies** — each with its own name, address, VAT/reg number,
  banking details, terms, footer, currency, VAT rate, number format (prefix +
  digit padding) and **quote layout** (gradient band / classic / minimal). All
  editable in the app; saved server-side so every device gets them.
- **Responsive by viewport** — mobile browsers get the stacked layout with a
  bottom tab bar; desktop browsers get the sidebar layout. Pure CSS media
  queries, no device sniffing, same URL.
- **Print / save PDF** — the quote document has print styles (A4 margins,
  chrome hidden).
- **Activity log** — every number issued, with the device it came from.

## Run it locally (VS Code)

```bash
npm install
npm run dev        # or: npm start
```

Open http://localhost:3000

To try the mobile view on your phone while developing, find your machine's LAN
IP (`ipconfig` / `ifconfig`) and open `http://<your-ip>:3000` on the phone —
both devices then share the same number sequence, which is the whole point.

## Deploy to Railway

1. Push this folder to a GitHub repo.
2. Railway → **New Project → Deploy from GitHub repo** → pick the repo.
3. Railway auto-detects Node and runs `npm start`. No build command needed.
   It injects `PORT`; the server already uses it.
4. Settings → **Networking → Generate Domain** to get a public URL.

### Making data survive redeploys

Data is stored in a JSON file (`data/db.json`, seeded from `seed.json` on first
boot). Railway's container filesystem is ephemeral, so for the POC:

- Add a **Volume** in Railway (Service → Data → Add Volume), mount it at
  `/data`, and set the environment variable `DATA_DIR=/data`.

That's enough for a client demo. For production, swap the JSON store in
`server.js` for Postgres (Railway one-click) — the number-issuing logic should
then use a transaction (`UPDATE companies SET seq = seq + 1 RETURNING seq`) so
the database itself guarantees no gaps.

## Files

```
server.js          Express API + number reservation logic
seed.json          Demo companies and quotes (copied to data/db.json on boot)
public/index.html  App shell
public/styles.css  Design-system styling + responsive/print rules
public/app.js      Front end (vanilla JS, no build step)
```

## API

| Method | Route                | Purpose                                  |
| ------ | -------------------- | ---------------------------------------- |
| GET    | `/api/bootstrap`     | companies, quotes, next number per company |
| POST   | `/api/reserve`       | reserve the next number for a draft      |
| POST   | `/api/release`       | release an abandoned reservation         |
| POST   | `/api/quotes`        | save a quote against a reservation       |
| PATCH  | `/api/quotes/:id`    | change status                            |
| PUT    | `/api/companies/:id` | edit company details / layout / numbering |

## Not in the POC (deliberately)

Login and per-user permissions, quote → invoice conversion, PDF emailing,
client database, attachments, multi-currency FX, and approval workflow.
