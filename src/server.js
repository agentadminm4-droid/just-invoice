// Load environment before anything else that reads it.
require('dotenv').config({ override: false });

if (!process.env.SESSION_SECRET) {
  console.error(
    'FATAL: SESSION_SECRET is not set. Set it in .env (use `openssl rand -hex 32` to generate one).'
  );
  process.exit(1);
}

const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);

const { db, allSettings, writeSetting } = require('./db');
const invoicesLib = require('./invoices');
const usersLib = require('./users');
const { toCents, formatMoney, fromCents, lineTotal, invoiceTotal } = require('./money');
const pdfLib = require('./pdf');
const paymentsLib = require('./payments');
const { getStripe, isConfigured: stripeConfigured, isWebhookConfigured } = require('./stripe-client');
const mailer = require('./mailer');
const { isConfigured: emailConfigured } = require('./email-client');

// Helper: get tax config { rate, name } for a user. Returns null if tax is disabled.
function getOwnerTaxConfig(userId) {
  if (!userId) return null;
  const enabled = db.prepare(`SELECT value FROM settings WHERE user_id = ? AND key = 'tax_enabled'`).get(userId);
  if (!enabled || enabled.value !== '1') return null;
  const rateRow = db.prepare(`SELECT value FROM settings WHERE user_id = ? AND key = 'tax_rate'`).get(userId);
  if (!rateRow) return null;
  const nameRow = db.prepare(`SELECT value FROM settings WHERE user_id = ? AND key = 'tax_name'`).get(userId);
  return {
    rate: parseFloat(rateRow.value) || null,
    name: nameRow ? nameRow.value : 'Tax',
  };
}

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

// -----------------------------------------------------------------------------
// Stripe webhook — MUST come before body parsers so we get the raw body for
// signature verification, AND before session middleware so no session cookie
// games happen on the webhook path.
// -----------------------------------------------------------------------------
app.post(
  '/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    const stripe = getStripe();
    if (!stripe) return res.status(503).send('Stripe not configured');
    if (!isWebhookConfigured()) {
      return res.status(503).send('STRIPE_WEBHOOK_SECRET not set');
    }
    const signature = req.headers['stripe-signature'];
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body, signature, process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    try {
      if (event.type === 'checkout.session.completed') {
        const s = event.data.object;
        const changed = paymentsLib.markPaidFromSession(s);
        console.log(
          `[webhook] checkout.session.completed session=${s.id} ` +
          `invoice=${s.metadata?.invoice_id} changed=${changed}`
        );
      }
    } catch (err) {
      console.error('[webhook] handler error:', err);
      return res.status(500).send('Internal error');
    }
    res.status(200).json({ received: true });
  }
);

// -----------------------------------------------------------------------------
// Regular body parsers + session store for everything else.
// -----------------------------------------------------------------------------
// Trust Railway's proxy so req.protocol is correct for Stripe redirect URLs.
app.set('trust proxy', 1);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/static', express.static(path.join(__dirname, '..', 'public')));

app.use(session({
  store: new SQLiteStore({
    db: 'sessions.db',
    dir: path.join(__dirname, '..', 'data'),
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  name: 'ji.sid',
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  },
}));

// Template helpers — always available, with user-scoped settings when logged in.
app.use((req, res, next) => {
  res.locals.formatMoney = formatMoney;
  res.locals.lineTotal = lineTotal;
  res.locals.invoiceTotal = invoiceTotal;
  res.locals.fromCents = fromCents;
  res.locals.stripeConfigured = stripeConfigured();
  res.locals.emailConfigured = emailConfigured();
  res.locals.currentUser = req.session.userId
    ? { id: req.session.userId, email: req.session.userEmail }
    : null;
  res.locals.settings = req.session.userId
    ? allSettings(req.session.userId)
    : allSettings(); // fallback defaults, only used on public invoice render
  next();
});

// -----------------------------------------------------------------------------
// Auth middleware
// -----------------------------------------------------------------------------
function requireAuth(req, res, next) {
  if (req.session.userId) return next();
  return res.redirect('/login');
}

function requireGuest(req, res, next) {
  if (req.session.userId) return res.redirect('/');
  next();
}

// -----------------------------------------------------------------------------
// Auth routes (public)
// -----------------------------------------------------------------------------
app.get('/pricing', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.render('pricing', { title: 'Pricing — JustInvoice' });
});

app.get('/signup', requireGuest, (req, res) => {
  res.render('signup', { title: 'Sign up — JustInvoice', error: req.query.error || null, email: req.query.email || '' });
});

app.post('/signup', requireGuest, async (req, res) => {
  try {
    const { email, password, password_confirm } = req.body;
    const user = await usersLib.createUser({
      email, password, passwordConfirm: password_confirm,
    });
    req.session.userId = user.id;
    req.session.userEmail = user.email;
    if (user.legacyClaim && user.legacyClaim.claimed > 0) {
      console.log(
        `[auth] first user ${user.email} claimed legacy data: ${JSON.stringify(user.legacyClaim)}`
      );
    }
    req.session.save(() => res.redirect('/'));
  } catch (err) {
    res.redirect(
      `/signup?error=${encodeURIComponent(err.message)}&email=${encodeURIComponent(req.body.email || '')}`
    );
  }
});

app.get('/login', requireGuest, (req, res) => {
  res.render('login', { title: 'Log in — JustInvoice', error: req.query.error || null, email: req.query.email || '' });
});

app.post('/login', requireGuest, async (req, res) => {
  const { email, password } = req.body;
  const user = await usersLib.authenticate({ email, password });
  if (!user) {
    return res.redirect(
      `/login?error=${encodeURIComponent('Invalid email or password')}&email=${encodeURIComponent(email || '')}`
    );
  }
  req.session.userId = user.id;
  req.session.userEmail = user.email;
  req.session.save(() => res.redirect('/'));
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('ji.sid');
    res.redirect('/login');
  });
});

// -----------------------------------------------------------------------------
// Public invoice routes (no auth)
// -----------------------------------------------------------------------------
app.get('/i/:token', (req, res) => {
  // First get to check existence and get user_id
  const invoice = invoicesLib.getInvoiceByToken(req.params.token, null, null);
  if (!invoice) return res.status(404).render('error', { message: 'Invoice not found' });
  // Re-fetch with owner's tax config
  const taxCfg = getOwnerTaxConfig(invoice.user_id);
  const invoiceWithTax = invoicesLib.getInvoiceByToken(req.params.token, taxCfg?.rate ?? null, taxCfg?.name ?? null);
  const ownerSettings = allSettings(invoice.user_id);
  res.render('invoice-public', { invoice: invoiceWithTax, settings: ownerSettings });
});

app.post('/i/:token/pay', async (req, res, next) => {
  try {
    if (!stripeConfigured()) {
      return res.status(503).render('error', {
        message: 'Online payment is not configured on this invoice. Please contact the sender.',
      });
    }
    const invoice = invoicesLib.getInvoiceByToken(req.params.token, null, null);
    if (!invoice) return res.status(404).render('error', { message: 'Invoice not found' });
    if (invoice.status === 'paid') {
      return res.redirect(`/i/${invoice.public_token}/paid`);
    }
    // Re-fetch with owner's tax config for the Stripe session
    const taxCfg = getOwnerTaxConfig(invoice.user_id);
    const invoiceWithTax = invoicesLib.getInvoiceByToken(req.params.token, taxCfg?.rate ?? null, taxCfg?.name ?? null);
    const stripeSession = await paymentsLib.createCheckoutSession(invoiceWithTax, req);
    res.redirect(303, stripeSession.url);
  } catch (err) { next(err); }
});

app.get('/i/:token/paid', async (req, res, next) => {
  try {
    const invoice = invoicesLib.getInvoiceByToken(req.params.token, null, null);
    if (!invoice) return res.status(404).render('error', { message: 'Invoice not found' });
    const sessionId = req.query.session_id;
    if (sessionId && invoice.status !== 'paid') {
      const stripe = getStripe();
      if (stripe) {
        try {
          const s = await stripe.checkout.sessions.retrieve(sessionId);
          if (s.payment_status === 'paid') paymentsLib.markPaidFromSession(s);
        } catch (err) {
          console.warn('[paid] session lookup failed:', err.message);
        }
      }
    }
    const taxCfg = getOwnerTaxConfig(invoice.user_id);
    const invoiceWithTax = invoicesLib.getInvoiceByToken(req.params.token, taxCfg?.rate ?? null, taxCfg?.name ?? null);
    res.render('invoice-paid', { invoice: invoiceWithTax });
  } catch (err) { next(err); }
});

app.get('/i/:token/pdf', async (req, res, next) => {
  const invoice = invoicesLib.getInvoiceByToken(req.params.token, null, null);
  if (!invoice) return res.status(404).render('error', { message: 'Invoice not found' });
  const taxCfg = getOwnerTaxConfig(invoice.user_id);
  const invoiceWithTax = invoicesLib.getInvoiceByToken(req.params.token, taxCfg?.rate ?? null, taxCfg?.name ?? null);
  try {
    const settings = allSettings(invoice.user_id);
    const pdf = await pdfLib.generatePdf(invoiceWithTax, settings);
    const buf = Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename="${invoice.number}.pdf"`);
    res.end(buf);
  } catch (err) { next(err); }
});

// -----------------------------------------------------------------------------
// Authenticated app routes
// -----------------------------------------------------------------------------
app.get('/', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.render('landing', { title: 'JustInvoice — Flat-rate invoicing for freelancers' });
});

app.get('/dashboard', requireAuth, (req, res) => {
  const invoices = invoicesLib.listInvoicesForUser(req.session.userId);
  const totals = {
    total: invoices.reduce((s, i) => s + i.total_cents, 0),
    outstanding: invoices.filter(i => i.status !== 'paid').reduce((s, i) => s + i.total_cents, 0),
    paid: invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.total_cents, 0),
    count: invoices.length,
  };
  res.render('dashboard', { invoices, totals });
});

app.get('/invoices/new', requireAuth, (req, res) => {
  const clients = invoicesLib.listClientsForUser(req.session.userId);
  const userSettings = allSettings(req.session.userId);
  res.render('invoice-form', { clients, settings: userSettings, isEdit: false });
});

app.post('/invoices', requireAuth, (req, res) => {
  try {
    const body = req.body;
    const descriptions = [].concat(body['item_description'] || []);
    const quantities = [].concat(body['item_quantity'] || []);
    const unitPrices = [].concat(body['item_unit_price'] || []);
    const items = descriptions.map((desc, i) => ({
      description: desc,
      quantity: parseFloat(quantities[i]) || 1,
      unit_price_cents: toCents(unitPrices[i]),
    })).filter(it => it.description && it.description.trim());

    const userSettings = allSettings(req.session.userId);
    const invoice = invoicesLib.createInvoice(req.session.userId, {
      client_name: body.client_name,
      client_email: body.client_email,
      client_address: body.client_address || '',
      issue_date: body.issue_date,
      due_date: body.due_date,
      currency: body.currency || 'USD',
      notes: body.notes,
      items,
      prefix: userSettings.invoice_prefix || 'INV',
      apply_tax: body.apply_tax === '1',
    });
    res.redirect(`/invoices/${invoice.id}`);
  } catch (err) {
    res.status(400).render('error', { message: err.message });
  }
});

app.get('/invoices/:id', requireAuth, (req, res) => {
  const invoice = invoicesLib.getInvoiceForUser(req.session.userId, parseInt(req.params.id, 10));
  if (!invoice) return res.status(404).render('error', { message: 'Invoice not found' });
  const shareUrl = `${req.protocol}://${req.get('host')}/i/${invoice.public_token}`;
  const flash = {
    sent: req.query.sent === '1',
    error: req.query.error ? String(req.query.error).slice(0, 300) : null,
  };
  res.render('invoice-view', { invoice, shareUrl, flash });
});

app.post('/invoices/:id/status', requireAuth, (req, res) => {
  try {
    invoicesLib.setStatusForUser(
      req.session.userId, parseInt(req.params.id, 10), req.body.status
    );
    res.redirect(`/invoices/${req.params.id}`);
  } catch (err) {
    res.status(400).render('error', { message: err.message });
  }
});

app.get('/invoices/:id/edit', requireAuth, (req, res) => {
  const invoice = invoicesLib.getInvoiceForUser(req.session.userId, parseInt(req.params.id, 10));
  if (!invoice) return res.status(404).render('error', { message: 'Invoice not found' });
  if (invoice.status !== 'draft') {
    return res.redirect(`/invoices/${invoice.id}`);
  }
  const clients = invoicesLib.listClientsForUser(req.session.userId);
  const userSettings = allSettings(req.session.userId);
  res.render('invoice-form', {
    invoice,
    clients,
    settings: userSettings,
    isEdit: true,
  });
});

app.post('/invoices/:id/edit', requireAuth, (req, res) => {
  // PUT via query string: /invoices/:id/edit?_method=PUT
  if (req.query._method !== 'PUT') return res.redirect(`/invoices/${req.params.id}`);
  try {
    const body = req.body;
    const descriptions = [].concat(body['item_description'] || []);
    const quantities = [].concat(body['item_quantity'] || []);
    const unitPrices = [].concat(body['item_unit_price'] || []);
    const items = descriptions.map((desc, i) => ({
      description: desc,
      quantity: parseFloat(quantities[i]) || 1,
      unit_price_cents: toCents(unitPrices[i]),
    })).filter(it => it.description && it.description.trim());

    const deleted = body.deleted_items
      ? body.deleted_items.split(',').map(s => parseInt(s, 10)).filter(n => !isNaN(n))
      : [];

    const invoice = invoicesLib.updateInvoice(req.session.userId, parseInt(req.params.id, 10), {
      client_name: body.client_name,
      client_email: body.client_email,
      client_address: body.client_address || '',
      issue_date: body.issue_date,
      due_date: body.due_date,
      currency: body.currency || 'USD',
      notes: body.notes,
      items,
      apply_tax: body.apply_tax === '1',
      deleted_items: deleted,
    });
    res.redirect(`/invoices/${invoice.id}`);
  } catch (err) {
    res.status(400).render('error', { message: err.message });
  }
});

app.post('/invoices/:id/delete', requireAuth, (req, res) => {
  try {
    invoicesLib.deleteInvoice(req.session.userId, parseInt(req.params.id, 10));
    res.redirect('/');
  } catch (err) {
    res.status(400).render('error', { message: err.message });
  }
});

app.post('/invoices/:id/send', requireAuth, async (req, res, next) => {
  try {
    const invoice = invoicesLib.getInvoiceForUser(req.session.userId, parseInt(req.params.id, 10));
    if (!invoice) return res.status(404).render('error', { message: 'Invoice not found' });
    if (!emailConfigured()) {
      return res.redirect(
        `/invoices/${invoice.id}?error=${encodeURIComponent('Email is not configured. Set RESEND_API_KEY in .env.')}`
      );
    }
    if (!invoice.client_email) {
      return res.redirect(
        `/invoices/${invoice.id}?error=${encodeURIComponent('This client has no email address on file.')}`
      );
    }
    const shareUrl = `${req.protocol}://${req.get('host')}/i/${invoice.public_token}`;
    const settings = allSettings(req.session.userId);
    try {
      await mailer.sendInvoiceEmail(invoice, settings, shareUrl);
      res.redirect(`/invoices/${invoice.id}?sent=1`);
    } catch (err) {
      console.error('[send] failed:', err.message);
      res.redirect(`/invoices/${invoice.id}?error=${encodeURIComponent(err.message || 'Email send failed')}`);
    }
  } catch (err) { next(err); }
});

app.get('/invoices/:id/pdf', requireAuth, async (req, res, next) => {
  const invoice = invoicesLib.getInvoiceForUser(req.session.userId, parseInt(req.params.id, 10));
  if (!invoice) return res.status(404).render('error', { message: 'Invoice not found' });
  try {
    const settings = allSettings(req.session.userId);
    const pdf = await pdfLib.generatePdf(invoice, settings);
    const buf = Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename="${invoice.number}.pdf"`);
    res.end(buf);
  } catch (err) { next(err); }
});

app.get('/settings', requireAuth, (req, res) => {
  res.render('settings', {
    values: allSettings(req.session.userId),
    stripe: { configured: stripeConfigured(), webhookConfigured: isWebhookConfigured() },
    email: { configured: emailConfigured(), from: process.env.EMAIL_FROM || null },
  });
});

app.post('/settings', requireAuth, (req, res) => {
  const keys = ['business_name', 'business_email', 'business_phone', 'business_address', 'invoice_prefix'];
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(req.body, k)) {
      writeSetting(req.session.userId, k, String(req.body[k] || ''));
    }
  }
  // Tax settings
  writeSetting(req.session.userId, 'tax_name', String(req.body.tax_name || 'Tax').trim().slice(0, 20));
  writeSetting(req.session.userId, 'tax_rate', String(req.body.tax_rate || '0'));
  writeSetting(req.session.userId, 'tax_enabled', req.body.tax_enabled === '1' ? '1' : '0');
  res.redirect('/settings');
});

// -----------------------------------------------------------------------------
// Admin stats page
// -----------------------------------------------------------------------------
app.get('/admin/stats', (req, res) => {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) {
    return res.status(403).send('403 Forbidden: ADMIN_KEY not configured');
  }
  if (req.query.key !== adminKey) {
    return res.status(403).send('403 Forbidden: invalid key');
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19);

  const totalUsers = db.prepare(`SELECT COUNT(*) AS n FROM users`).get().n;
  const totalInvoices = db.prepare(`SELECT COUNT(*) AS n FROM invoices`).get().n;
  const statusCounts = db.prepare(
    `SELECT status, COUNT(*) AS n FROM invoices GROUP BY status`
  ).all().reduce((acc, r) => { acc[r.status] = r.n; return acc; }, {});
  const newUsers7d = db.prepare(
    `SELECT COUNT(*) AS n FROM users WHERE created_at >= ?`
  ).get(sevenDaysAgo).n;
  const newInvoices7d = db.prepare(
    `SELECT COUNT(*) AS n FROM invoices WHERE created_at >= ?`
  ).get(sevenDaysAgo).n;
  const latestSignup = db.prepare(
    `SELECT created_at FROM users ORDER BY created_at DESC LIMIT 1`
  ).get();

  const draft = statusCounts.draft || 0;
  const sent = statusCounts.sent || 0;
  const paid = statusCounts.paid || 0;
  const latestSignupDate = latestSignup ? latestSignup.created_at : 'N/A';
  const generatedAt = new Date().toISOString();

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>JustInvoice — Admin Stats</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 700px; margin: 40px auto; padding: 0 20px; color: #222; }
    h1 { font-size: 1.5rem; margin-bottom: 4px; }
    .subtitle { color: #666; font-size: 0.875rem; margin-bottom: 2rem; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 2rem; }
    th { background: #f4f4f5; text-align: left; padding: 10px 12px; border: 1px solid #ddd; font-size: 0.875rem; text-transform: uppercase; letter-spacing: 0.04em; }
    td { padding: 10px 12px; border: 1px solid #ddd; }
    tr:nth-child(even) td { background: #fafafa; }
    .section-title { font-weight: 600; font-size: 1rem; margin: 1.5rem 0 0.5rem; }
    .generated { font-size: 0.8rem; color: #999; margin-top: 2rem; }
  </style>
</head>
<body>
  <h1>📊 JustInvoice Admin Stats</h1>
  <div class="subtitle">Generated at ${generatedAt}</div>

  <div class="section-title">Users</div>
  <table>
    <tr><th>Metric</th><th>Value</th></tr>
    <tr><td>Total users registered</td><td>${totalUsers}</td></tr>
    <tr><td>New users (last 7 days)</td><td>${newUsers7d}</td></tr>
    <tr><td>Most recent signup</td><td>${latestSignupDate}</td></tr>
  </table>

  <div class="section-title">Invoices</div>
  <table>
    <tr><th>Metric</th><th>Value</th></tr>
    <tr><td>Total invoices created</td><td>${totalInvoices}</td></tr>
    <tr><td>New invoices (last 7 days)</td><td>${newInvoices7d}</td></tr>
    <tr><td>Status: draft</td><td>${draft}</td></tr>
    <tr><td>Status: sent</td><td>${sent}</td></tr>
    <tr><td>Status: paid</td><td>${paid}</td></tr>
  </table>

  <div class="generated">JustInvoice admin — do not share this URL</div>
</body>
</html>`);
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { message: err.message || 'Something went wrong' });
});

const server = app.listen(PORT, () => {
  console.log(`JustInvoice running at http://localhost:${PORT}`);
  console.log(`  Stripe: ${stripeConfigured() ? 'configured' : 'not configured'}`);
  console.log(`  Webhook secret: ${isWebhookConfigured() ? 'configured' : 'not set'}`);
  console.log(`  Email (Resend): ${emailConfigured() ? 'configured' : 'not configured'}`);
  console.log(`  Users in DB: ${usersLib.count()}`);
});

async function shutdown() {
  console.log('\nShutting down…');
  await pdfLib.shutdown();
  server.close(() => {
    try { db.close(); } catch {}
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
