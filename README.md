# JustInvoice

A dead-simple, flat-rate invoicing app for freelancers and micro-businesses. Type work → enter amount → send a professional PDF. That's it.

No transaction fees. No bookkeeping features you don't need. No invoice cap.

## What it does

- **Multi-user accounts** — each freelancer signs up, owns their data, nothing leaks between users
- **Create invoices** with client, line items, dates, currency, and notes
- **Generate a clean PDF** of any invoice (print-ready, Letter size)
- **Shareable URL** per invoice — send the link, client views in browser + downloads PDF
- **Email delivery** — send the invoice to the client with one click (via Resend)
- **Stripe Checkout** — clients pay with a card right from their invoice link
- **Status tracking** — Draft → Sent → Paid (auto-sent on email, auto-paid via Stripe webhook)
- **Dashboard** with totals (outstanding, paid, lifetime)
- **Client list** auto-built as you invoice them
- **Business settings** — name, email, address, invoice prefix

## What it doesn't do (yet)

- No tax calculation
- No expense tracking
- No multi-user / teams
- No email template editor / multiple recipients / scheduled reminders
- No subscription/recurring billing

## Stack

- Node.js + Express
- SQLite (via `better-sqlite3`) — single file at `data/just-invoice.db`
- EJS server-rendered templates
- Puppeteer for PDF generation

## Setup

Requires Node 18+.

```bash
cd products/just-invoice
cp .env.example .env   # then edit .env
npm install
npm start
```

Then open http://localhost:3000.

First time you run `npm install`, puppeteer will download a local Chromium (~150MB). That's normal.

### Configuration

All configuration lives in `.env`. See `.env.example` for the full list.

- `PORT` — default 3000
- `SESSION_SECRET` — **required.** Signing secret for user sessions. Generate with `openssl rand -hex 32`. The server refuses to start without it.
- `BASE_URL` — public URL of the app (used for Stripe redirect URLs). Default `http://localhost:3000`.
- `STRIPE_SECRET_KEY` — Stripe secret key. **Omit to run without online payments.**
- `STRIPE_WEBHOOK_SECRET` — Stripe webhook signing secret.
- `RESEND_API_KEY` — Resend API key for email sending. **Omit to hide the "Send to Client" button.**
- `EMAIL_FROM` — from address used for invoice emails. Defaults to `onboarding@resend.dev`.

The app runs fine with no Stripe or Resend config — those features just hide.

### First-run checklist

1. Open http://localhost:3000 — you'll be sent to the sign-up page.
2. Create an account (email + password, min 8 chars).
3. Go to **Settings**, fill in your business name, email, and address.
4. Click **+ New invoice**, fill in a client and line items, save.
5. If you configured Resend: hit **Send to client** — email goes out.
6. Otherwise: copy the share link and send it yourself.
7. Client clicks "Pay Now" → Stripe Checkout → back to a thank-you page. Status auto-updates to Paid via webhook.

### Stripe setup

1. Sign up at https://stripe.com and grab your test keys from https://dashboard.stripe.com/test/apikeys.
2. Put the secret key in `.env` as `STRIPE_SECRET_KEY=sk_test_...`.
3. For webhook signing in local dev, install the Stripe CLI and run:

   ```bash
   stripe listen --forward-to localhost:3000/webhooks/stripe
   ```

   That command prints a `whsec_...` string — put it in `.env` as `STRIPE_WEBHOOK_SECRET`.
4. Restart the server. The Settings page should now show **Connected**.
5. Use Stripe's test card `4242 4242 4242 4242` with any future expiry / CVC to test a full checkout.

For production, swap `sk_test_...` for `sk_live_...`, register a real webhook at https://dashboard.stripe.com/webhooks pointed at `https://yourdomain.com/webhooks/stripe`, and put *that* signing secret in `.env`.

### Email setup (Resend)

1. Sign up at https://resend.com (free tier: 100 emails/day, 3,000/month).
2. Create an API key at https://resend.com/api-keys and put it in `.env` as `RESEND_API_KEY=re_...`.
3. For testing, leave `EMAIL_FROM=onboarding@resend.dev` — Resend's shared sender works without domain verification.
4. For production, verify your domain at https://resend.com/domains and set `EMAIL_FROM=invoices@yourdomain.com`.
5. Restart the server. Settings page should show **Email: Connected**.

On an invoice view, you'll now see a **Send to Client** button (only if the client has an email on file). Click it and the invoice goes out with a clean HTML body, a plain-text fallback, a **View & Pay Invoice** button, and `reply_to` set to your business email. Status flips to `sent` and `last sent` is shown.

---

## Deploy to Railway

Railway is the recommended host for JustInvoice. It has a generous free tier, persistent disk support, and a one-click GitHub deploy.

> ⚠️ **SQLite and persistence:** JustInvoice stores all data in `./data/just-invoice.db`. Railway's free tier resets the filesystem on every cold deploy unless you mount a persistent volume at `./data`. The `railway.toml` in this repo configures this automatically — do not skip it.

> ⚠️ **Single instance only.** JustInvoice uses SQLite which does not support multi-instance concurrent access. Do not enable auto-scaling on Railway (or any host) — keep it at 1 instance. Your data will corrupt otherwise.

### Step 1: Push to GitHub

1. Create a GitHub repo and push the `just-invoice` folder:

   ```bash
   cd products/just-invoice
git init
git add .
git commit -m "JustInvoice v1.0"
gh repo create just-invoice --private --push
   ```

### Step 2: Create a Railway project

1. Go to [railway.app](https://railway.app) and sign up (free $5 credit on signup).
2. Click **New Project** → **Deploy from GitHub repo** → select your `just-invoice` repo.
3. Railway will detect Node.js automatically.

### Step 3: Mount the persistent volume

> This step is critical. Without it, your SQLite database will be wiped on every deploy.

1. In the Railway project dashboard, click on the service (the Node.js app).
2. Go to the **Volumes** tab.
3. Click **Add Volume**, name it `data`, and set the mount path to `./data`.
4. The `railway.toml` in this repo also declares the volume mount — Railway should pick it up automatically, but verify it's set.

### Step 4: Set environment variables

In the Railway project dashboard → **Variables** tab, add each of these:

| Variable | Value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | Enables secure cookies + production optimizations |
| `PORT` | `3000` | Railway exposes this automatically; 3000 is fine inside the container |
| `SESSION_SECRET` | (result of `openssl rand -hex 32`) | **Required.** Generate locally and paste in. Keep it secret. |
| `BASE_URL` | `https://your-domain.com` | The public URL of your deployed app |
| `STRIPE_SECRET_KEY` | `sk_live_...` | Live key from [Stripe Dashboard → API keys](https://dashboard.stripe.com/apikeys) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | From Stripe Webhooks dashboard (see Step 5 below) |
| `RESEND_API_KEY` | `re_...` | From [resend.com/api-keys](https://resend.com/api-keys) |
| `EMAIL_FROM` | `invoices@your-domain.com` | Your verified sending domain |

> **Do not use test keys in production.** Swap `sk_test_...` for `sk_live_...` before deploying.

### Step 5: Configure Stripe webhooks (production)

1. In [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks), click **Add endpoint**.
2. Endpoint URL: `https://your-domain.com/webhooks/stripe`
3. Select event: `checkout.session.completed`
4. Click **Add endpoint**.
5. Copy the **Signing secret** (`whsec_...`) and set it as `STRIPE_WEBHOOK_SECRET` in Railway.

To test locally before deploying, use the Stripe CLI:
```bash
stripe listen --forward-to localhost:3000/webhooks/stripe
```

To trigger a test webhook in production:
```bash
stripe trigger checkout.session.completed --scope webhookScope=https://your-domain.com/webhooks/stripe
```

### Step 6: Custom domain (optional)

1. In Railway → your service → **Settings** → **Networking** → **Custom Domains**, add your domain (e.g. `invoices.yourdomain.com`).
2. Add the DNS record Railway provides (CNAME or A record) to your DNS provider.
3. Wait for DNS propagation (can take up to 48h, usually minutes).
4. Update `BASE_URL` to your custom domain and redeploy.

Railway automatically provisions SSL for custom domains.

### Step 7: Resend domain verification (optional)

Required only if using a custom `EMAIL_FROM` domain:
1. In [Resend → Domains](https://resend.com/domains), add your sending domain.
2. Add the DKIM, SPF, and MX records shown to your DNS.
3. Wait for verification (Resend shows a ✓ when ready).
4. Set `EMAIL_FROM=invoices@your-domain.com` in Railway.

### Step 8: Verify the deployment

Once Railway reports the deploy as successful:

- [ ] `https://your-domain.com/` loads the landing page
- [ ] `https://your-domain.com/pricing` loads the pricing page
- [ ] Signing up creates an account and shows the dashboard
- [ ] Creating an invoice and sending it emails the client (if Resend is configured)
- [ ] Stripe Checkout completes and the invoice status flips to **Paid** (webhook verification)

### Production checklist

- [ ] `SESSION_SECRET` is set to a long random value (not a placeholder)
- [ ] `NODE_ENV=production`
- [ ] `STRIPE_SECRET_KEY` is a **live** key (`sk_live_...`), not test
- [ ] `STRIPE_WEBHOOK_SECRET` is set (not just the test CLI value)
- [ ] `BASE_URL` matches the actual production URL (no `localhost`)
- [ ] Persistent volume mounted at `./data` in Railway
- [ ] Only **1 instance** running (no auto-scaling)
- [ ] Stripe webhook endpoint registered at `https://your-domain.com/webhooks/stripe`
- [ ] Resend domain verified (if using a custom `EMAIL_FROM` domain)

### Troubleshooting

**"Invoice not found" errors on the public invoice URL after deploy:**
→ `BASE_URL` is probably wrong. The share URL in emails is built from `BASE_URL`. If it doesn't match the actual URL, the token won't resolve.

**Payments are not updating to Paid:**
→ Check Stripe webhook is registered and `STRIPE_WEBHOOK_SECRET` is set. In Railway logs, look for `[webhook] checkout.session.completed` messages.

**Session keeps logging out after deploy:**
→ `NODE_ENV` might not be set. Without it, the session cookie `secure: true` flag is not set in production, but Railway's proxy may be terminating TLS, causing cookie issues.

**Database resets on every deploy:**
→ The persistent volume at `./data` is not mounted. Delete the old Railway service and recreate it, making sure to add the volume before the first deploy.

## File layout

```
products/just-invoice/
├── src/
│   ├── server.js         Express app + routes
│   ├── db.js             SQLite schema + migrations + settings
│   ├── invoices.js       Invoice CRUD + numbering
│   ├── money.js          Cents ↔ display helpers
│   ├── pdf.js            Puppeteer PDF renderer
│   ├── stripe-client.js  Lazy Stripe SDK loader
│   ├── payments.js       Stripe Checkout session + idempotent mark-paid
│   ├── email-client.js   Lazy Resend SDK loader
│   ├── mailer.js         Invoice email composition + send
│   └── users.js          Signup, login, bcrypt password hashing
├── views/                EJS templates
├── public/app.css        Styles
├── public/landing.css    Marketing site styles
├── data/                 SQLite DB + sessions (persistent volume — do NOT reset)
├── .env.example          Copy to .env and fill in
├── railway.toml          Railway deployment config (volume mount, start command)
└── package.json
```

## Design decisions

- **Money stored as integer cents** — no floating-point drift.
- **Public invoice tokens are random 20-char strings** — unguessable but shareable. Dashboard is local-only.
- **PDF view is a separate EJS template** from the web view — print CSS isn't screen CSS, don't pretend otherwise.
- **No auth** — MVP is single-user, runs locally. If this ships to multi-user, add sessions and per-user scoping first.
- **SQLite + WAL** — fine for one user and thousands of invoices; easy to back up (copy the `.db` file).
- **Multi-tenancy is enforced in SQL, not just routes.** Every query takes a `user_id` and filters by it. Attempting to access another user's invoice by id returns 404, not 403 — we don't admit the row exists.
- **Passwords hashed with bcrypt, 12 rounds.** Plaintext is never stored, never logged.
- **Sessions persisted in SQLite** via `connect-sqlite3` in `data/sessions.db` — no Redis needed, survives restarts, easy to back up.
- **Emails normalized to lowercase on write and compare.** Login is case-insensitive.
- **Server refuses to start without `SESSION_SECRET`.** No unsafe default fallback.
- **First user claims legacy data.** If the DB was built by an earlier, auth-less version, the first account you create takes ownership of all existing invoices/clients/settings. Subsequent users start clean.
- **Stripe webhook is the source of truth for paid status.** The post-checkout success page also does a defensive lookup for cases where the user arrives before the webhook fires. `markPaidFromSession` is idempotent — safe to call twice. The webhook intentionally looks up invoices unscoped by user because it's authenticated by Stripe signature, not by session.
- **Zero-decimal currencies** (JPY, KRW, etc.) get their amounts passed to Stripe as whole units per Stripe's API requirements.
- **Stripe line items are one-per-invoice-line with quantity=1** on Stripe's side. We pre-multiply `quantity * unit_price_cents` locally so decimal quantities (e.g. "1.5 hours") work cleanly.

## Known sharp edges

- Share link uses `BASE_URL` if set, else `req.protocol` + `req.get('host')`. For production, set `BASE_URL` to the public URL — otherwise the token URLs in emails won't resolve.
- Puppeteer's first PDF render spins up Chromium (~1s); subsequent renders reuse the browser.
- Deleting a client that has invoices is blocked by FK (intentional — delete the invoices first).
- If you set `STRIPE_SECRET_KEY` but skip `STRIPE_WEBHOOK_SECRET`, payments work but status updates depend on the client returning from Stripe (not recommended for production).
- **Railway deployment:** always mount a persistent volume at `./data`. SQLite is single-instance only — do not enable auto-scaling.
