#!/usr/bin/env node
/**
 * capture-screenshots.js
 * Generates three product screenshots for the JustInvoice landing page
 * using Puppeteer with self-contained HTML mockups.
 *
 * Output: public/images/screenshots/
 *   invoice-preview.png  (1200x800)
 *   dashboard.png        (1200x800)
 *   settings.png         (1200x800)
 */

import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'public', 'images', 'screenshots');
mkdirSync(OUT_DIR, { recursive: true });

/* ── Shared design tokens ───────────────────────────── */
const baseCSS = `
  :root {
    --bg: #fafaf9;
    --card: #ffffff;
    --ink: #1a1a1a;
    --muted: #666;
    --line: #e5e5e3;
    --accent: #111;
    --accent-soft: #f1f1ef;
    --green: #0a7a3b;
    --amber: #a66100;
    --red: #9a1f1f;
    --blue: #2563eb;
  }
  * { box-sizing: border-box; margin:0; padding:0; }
  html, body {
    background: var(--bg);
    color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  a { color: var(--ink); text-decoration: none; }
`;

/* ── 1. Invoice preview ─────────────────────────────── */
const invoiceHTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<style>
${baseCSS}
body { background: #f8fafc; padding: 0; font-size: 11pt; }
.chrome {
  background: #fff;
  border-bottom: 1px solid #e0e0e0;
  padding: 0.6rem 1.25rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.78rem;
  color: #888;
}
.chrome-dots { display:flex; gap:5px; }
.chrome-dots span {
  width: 12px; height: 12px; border-radius: 50%;
  display: inline-block;
}
.dot-red   { background: #ff5f57; }
.dot-amber { background: #febc2e; }
.dot-green { background: #28c840; }
.chrome-url {
  flex: 1;
  background: #f1f3f4;
  border-radius: 6px;
  padding: 0.25rem 0.75rem;
  font-size: 0.75rem;
  color: #555;
  max-width: 420px;
}
.page { padding: 2.5rem 3rem; max-width: 860px; margin: 0 auto; background: #fff; min-height: 100vh; }
.nav-bar {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 1.75rem; padding-bottom: 1rem;
  border-bottom: 1px solid var(--line);
}
.nav-bar .logo { font-size: 1.15rem; font-weight: 700; letter-spacing: -0.01em; }
.nav-bar .logo span { color: var(--blue); }
.nav-bar nav { display: flex; gap: 1rem; font-size: 0.875rem; color: var(--muted); }
.nav-bar nav .primary { color: var(--ink); font-weight: 600; }
.invoice-header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 2rem; }
.invoice-title { font-size: 2rem; font-weight: 800; letter-spacing: -0.02em; }
.invoice-num { color: var(--muted); font-size: 0.875rem; margin-top: 0.2rem; }
.business-info { text-align: right; }
.business-info strong { font-size: 1rem; }
.business-info .muted { color: var(--muted); font-size: 0.8rem; line-height: 1.6; }
.meta { display:flex; gap: 2rem; padding: 1rem 0; border-top: 1px solid #ddd; border-bottom: 1px solid #ddd; margin-bottom: 1.75rem; }
.meta-block .label { text-transform: uppercase; letter-spacing: 0.05em; font-size: 0.7rem; color: #888; margin-bottom: 0.2rem; }
.meta-block .value { font-size: 0.9rem; font-weight: 600; }
.meta-block .sub { font-size: 0.8rem; color: var(--muted); }
table { width: 100%; border-collapse: collapse; margin-bottom: 1.5rem; }
th { text-align: left; padding: 0.5rem 0.5rem; font-size: 0.72rem; color: #888; text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 2px solid var(--ink); }
td { padding: 0.65rem 0.5rem; font-size: 0.9rem; border-bottom: 1px solid #eee; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
.totals-wrap { display:flex; justify-content:flex-end; }
.totals { width: 42%; }
.totals td { border:none; padding: 0.3rem 0.5rem; font-size: 0.9rem; }
.totals .grand td { border-top: 2px solid var(--ink); font-weight: 700; font-size: 1rem; padding-top: 0.5rem; }
.actions { display:flex; gap:0.75rem; margin-top:2rem; }
.btn { display:inline-flex; align-items:center; gap:0.4rem; padding: 0.55rem 1.2rem; border-radius:7px; font-size:0.9rem; font-weight:600; border:none; cursor:pointer; }
.btn-primary { background:var(--blue); color:#fff; }
.btn-outline { background:transparent; border:1.5px solid #ccc; color:var(--ink); }
.status-bar { display:flex; align-items:center; gap:0.75rem; margin-bottom:1.5rem; }
.badge { display:inline-block; padding:0.2rem 0.65rem; font-size:0.75rem; border-radius:999px; text-transform:uppercase; letter-spacing:0.05em; font-weight:600; }
.badge.sent { background:#fff3d9; color:var(--amber); }
</style>
</head><body>
<div class="chrome">
  <div class="chrome-dots"><span class="dot-red"></span><span class="dot-amber"></span><span class="dot-green"></span></div>
  <div class="chrome-url">getjustinvoice.app/invoices/42</div>
</div>
<div class="page">
  <div class="nav-bar">
    <div class="logo">Just<span>Invoice</span></div>
    <nav>
      <a href="#">Dashboard</a>
      <a href="#" class="primary">+ New invoice</a>
      <a href="#">Settings</a>
      <span class="muted" style="font-size:0.8rem; color:#aaa;">jane@janesmith.design</span>
      <a href="#">Log out</a>
    </nav>
  </div>

  <div class="invoice-header">
    <div>
      <div class="invoice-title">Invoice</div>
      <div class="invoice-num">#INV-2025-0042</div>
    </div>
    <div class="business-info">
      <strong>Jane Smith Design</strong><br>
      <div class="muted">
        jane@janesmith.design<br>
        +1 (416) 555-0182<br>
        123 Spadina Ave, Toronto, ON
      </div>
    </div>
  </div>

  <div class="status-bar">
    <span class="badge sent">Sent</span>
    <span style="font-size:0.8rem; color:var(--muted);">Sent on May 20, 2025 · Due Jun 3, 2025</span>
  </div>

  <div class="meta">
    <div class="meta-block">
      <div class="label">Billed to</div>
      <div class="value">Acme Corp</div>
      <div class="sub">billing@acmecorp.com</div>
    </div>
    <div class="meta-block">
      <div class="label">Issue date</div>
      <div class="value">May 20, 2025</div>
    </div>
    <div class="meta-block">
      <div class="label">Due date</div>
      <div class="value">Jun 3, 2025</div>
    </div>
    <div class="meta-block">
      <div class="label">Currency</div>
      <div class="value">CAD</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th class="num" style="width:70px">Qty</th>
        <th class="num" style="width:110px">Unit price</th>
        <th class="num" style="width:120px">Amount</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Website Design</td>
        <td class="num">10</td>
        <td class="num">$150.00</td>
        <td class="num">$1,500.00</td>
      </tr>
      <tr>
        <td>Brand Identity & Logo Refresh</td>
        <td class="num">1</td>
        <td class="num">$600.00</td>
        <td class="num">$600.00</td>
      </tr>
      <tr>
        <td>Project Management &amp; Communication</td>
        <td class="num">3</td>
        <td class="num">$100.00</td>
        <td class="num">$300.00</td>
      </tr>
    </tbody>
  </table>

  <div class="totals-wrap">
    <table class="totals">
      <tbody>
        <tr><td>Subtotal</td><td class="num">$2,400.00</td></tr>
        <tr><td>HST (13%)</td><td class="num">$312.00</td></tr>
        <tr class="grand"><td>Total due</td><td class="num">$2,712.00 CAD</td></tr>
      </tbody>
    </table>
  </div>

  <div class="actions">
    <button class="btn btn-primary">💳 Pay now</button>
    <button class="btn btn-outline">⬇ Download PDF</button>
    <button class="btn btn-outline">✉ Resend email</button>
  </div>
</div>
</body></html>`;

/* ── 2. Dashboard ───────────────────────────────────── */
const dashboardHTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<style>
${baseCSS}
body { background: var(--bg); }
.chrome {
  background: #fff;
  border-bottom: 1px solid #e0e0e0;
  padding: 0.6rem 1.25rem;
  display: flex; align-items: center; gap: 0.5rem;
  font-size: 0.78rem; color: #888;
}
.chrome-dots { display:flex; gap:5px; }
.chrome-dots span { width:12px; height:12px; border-radius:50%; display:inline-block; }
.dot-red { background:#ff5f57; } .dot-amber { background:#febc2e; } .dot-green { background:#28c840; }
.chrome-url { flex:1; background:#f1f3f4; border-radius:6px; padding:0.25rem 0.75rem; font-size:0.75rem; color:#555; max-width:380px; }
.page { max-width: 960px; margin: 0 auto; padding: 2rem 1.5rem; }
.nav-bar { display:flex; justify-content:space-between; align-items:center; margin-bottom:2rem; padding-bottom:1rem; border-bottom:1px solid var(--line); }
.nav-bar .logo { font-size:1.15rem; font-weight:700; letter-spacing:-0.01em; }
.nav-bar .logo span { color: var(--blue); }
.nav-bar nav { display:flex; gap:1rem; font-size:0.875rem; color:var(--muted); }
.nav-bar nav .primary { background:var(--ink); color:#fff; padding:0.4rem 0.9rem; border-radius:6px; font-weight:600; }
h2 { font-size:1.4rem; font-weight:700; letter-spacing:-0.01em; margin-bottom:1rem; }
.stats { display:grid; grid-template-columns:repeat(4,1fr); gap:0.75rem; margin-bottom:1.5rem; }
.stat { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:1rem 1.25rem; }
.stat .label { font-size:0.75rem; color:var(--muted); text-transform:uppercase; letter-spacing:0.05em; }
.stat .value { font-size:1.45rem; font-weight:600; margin-top:0.2rem; }
table { width:100%; border-collapse:collapse; background:var(--card); border:1px solid var(--line); border-radius:10px; overflow:hidden; }
th { text-align:left; padding:0.75rem 1rem; font-size:0.75rem; color:var(--muted); text-transform:uppercase; letter-spacing:0.05em; font-weight:600; background:var(--accent-soft); border-bottom:1px solid var(--line); }
td { padding:0.8rem 1rem; font-size:0.9rem; border-bottom:1px solid var(--line); }
tr:last-child td { border-bottom:none; }
td.num, th.num { text-align:right; font-variant-numeric:tabular-nums; }
td a { color:var(--blue); font-weight:600; }
.badge { display:inline-block; padding:0.15rem 0.55rem; font-size:0.72rem; border-radius:999px; text-transform:uppercase; letter-spacing:0.05em; font-weight:600; }
.badge.draft { background:var(--accent-soft); color:var(--muted); }
.badge.sent  { background:#fff3d9; color:var(--amber); }
.badge.paid  { background:#d8f0e0; color:var(--green); }
.new-btn { display:inline-flex; align-items:center; gap:0.4rem; background:var(--ink); color:#fff; padding:0.45rem 1rem; border-radius:7px; font-weight:600; font-size:0.875rem; margin-bottom:1.25rem; }
</style>
</head><body>
<div class="chrome">
  <div class="chrome-dots"><span class="dot-red"></span><span class="dot-amber"></span><span class="dot-green"></span></div>
  <div class="chrome-url">getjustinvoice.app</div>
</div>
<div class="page">
  <div class="nav-bar">
    <div class="logo">Just<span>Invoice</span></div>
    <nav>
      <a href="#">Dashboard</a>
      <a href="#" class="primary">+ New invoice</a>
      <a href="#">Settings</a>
    </nav>
  </div>

  <h2>Invoices</h2>

  <div class="stats">
    <div class="stat">
      <div class="label">Total invoices</div>
      <div class="value">7</div>
    </div>
    <div class="stat">
      <div class="label">Outstanding</div>
      <div class="value">$3,412</div>
    </div>
    <div class="stat">
      <div class="label">Paid</div>
      <div class="value">$9,840</div>
    </div>
    <div class="stat">
      <div class="label">Lifetime total</div>
      <div class="value">$13,252</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Number</th>
        <th>Client</th>
        <th>Due</th>
        <th>Status</th>
        <th class="num">Amount</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><a href="#">INV-2025-0042</a></td>
        <td>Acme Corp</td>
        <td>Jun 3, 2025</td>
        <td><span class="badge sent">Sent</span></td>
        <td class="num">$2,712.00</td>
      </tr>
      <tr>
        <td><a href="#">INV-2025-0041</a></td>
        <td>Bright Ideas Studio</td>
        <td>May 28, 2025</td>
        <td><span class="badge paid">Paid</span></td>
        <td class="num">$1,356.00</td>
      </tr>
      <tr>
        <td><a href="#">INV-2025-0040</a></td>
        <td>Northstar Media</td>
        <td>Jun 10, 2025</td>
        <td><span class="badge draft">Draft</span></td>
        <td class="num">$700.00</td>
      </tr>
      <tr>
        <td><a href="#">INV-2025-0039</a></td>
        <td>Acme Corp</td>
        <td>May 15, 2025</td>
        <td><span class="badge paid">Paid</span></td>
        <td class="num">$3,390.00</td>
      </tr>
      <tr>
        <td><a href="#">INV-2025-0038</a></td>
        <td>Bright Ideas Studio</td>
        <td>May 1, 2025</td>
        <td><span class="badge paid">Paid</span></td>
        <td class="num">$847.00</td>
      </tr>
    </tbody>
  </table>
</div>
</body></html>`;

/* ── 3. Settings ────────────────────────────────────── */
const settingsHTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<style>
${baseCSS}
body { background: var(--bg); }
.chrome {
  background:#fff; border-bottom:1px solid #e0e0e0;
  padding:0.6rem 1.25rem; display:flex; align-items:center; gap:0.5rem;
  font-size:0.78rem; color:#888;
}
.chrome-dots { display:flex; gap:5px; }
.chrome-dots span { width:12px; height:12px; border-radius:50%; display:inline-block; }
.dot-red { background:#ff5f57; } .dot-amber { background:#febc2e; } .dot-green { background:#28c840; }
.chrome-url { flex:1; background:#f1f3f4; border-radius:6px; padding:0.25rem 0.75rem; font-size:0.75rem; color:#555; max-width:380px; }
.page { max-width:960px; margin:0 auto; padding:2rem 1.5rem; }
.nav-bar { display:flex; justify-content:space-between; align-items:center; margin-bottom:2rem; padding-bottom:1rem; border-bottom:1px solid var(--line); }
.nav-bar .logo { font-size:1.15rem; font-weight:700; letter-spacing:-0.01em; }
.nav-bar .logo span { color: #2563eb; }
.nav-bar nav { display:flex; gap:1rem; font-size:0.875rem; color:var(--muted); }
.nav-bar nav .active { color:var(--ink); font-weight:600; }
h2 { font-size:1.4rem; font-weight:700; letter-spacing:-0.01em; margin-bottom:0.25rem; }
.sub { font-size:0.875rem; color:var(--muted); margin-bottom:1.25rem; }
.card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:1.25rem 1.5rem; margin-bottom:1rem; }
.card h3 { font-size:0.8rem; color:var(--muted); text-transform:uppercase; letter-spacing:0.06em; margin:0 0 1rem; }
.row { display:flex; gap:1rem; }
.row > * { flex:1; }
.field { margin-bottom:0.85rem; }
label { display:block; font-size:0.82rem; color:var(--muted); margin-bottom:0.3rem; }
input[type=text], input[type=email], input[type=tel], textarea {
  width:100%; padding:0.5rem 0.65rem; border:1px solid var(--line);
  border-radius:6px; font-size:0.9rem; font-family:inherit; background:#fff;
  color: var(--ink);
}
textarea { min-height:70px; resize:none; }
.btn-save { background:var(--ink); color:#fff; padding:0.55rem 1.5rem; border:none; border-radius:7px; font-size:0.9rem; font-weight:600; cursor:pointer; }
.badge-connected { display:inline-block; padding:0.15rem 0.6rem; font-size:0.72rem; border-radius:999px; background:#d8f0e0; color:#0a7a3b; font-weight:600; text-transform:uppercase; letter-spacing:0.05em; }
.badge-warn { background:#fff3d9; color:#a66100; }
.hint { font-size:0.78rem; color:var(--muted); margin-top:0.3rem; }
.actions { display:flex; gap:0.75rem; margin-top:0.5rem; }
.btn-ghost { background:transparent; border:1.5px solid var(--line); color:var(--ink); padding:0.5rem 1.2rem; border-radius:7px; font-size:0.875rem; cursor:pointer; }
</style>
</head><body>
<div class="chrome">
  <div class="chrome-dots"><span class="dot-red"></span><span class="dot-amber"></span><span class="dot-green"></span></div>
  <div class="chrome-url">getjustinvoice.app/settings</div>
</div>
<div class="page">
  <div class="nav-bar">
    <div class="logo">Just<span>Invoice</span></div>
    <nav>
      <a href="#">Dashboard</a>
      <a href="#" style="font-weight:600; color:#1a1a1a;">Settings</a>
    </nav>
  </div>

  <h2>Settings</h2>
  <p class="sub">This info appears on every invoice.</p>

  <div class="card">
    <h3>Email (Resend)</h3>
    <p style="margin:0; font-size:0.875rem;">
      <span class="badge-connected">Connected</span>
      &nbsp;Resend API key detected. Sending from <code>jane@janesmith.design</code>.
    </p>
  </div>

  <div class="card">
    <h3>Payments (Stripe)</h3>
    <p style="margin:0; font-size:0.875rem;">
      <span class="badge-connected">Connected</span>
      &nbsp;Stripe secret key configured. Webhook signing secret active.
    </p>
  </div>

  <div class="card">
    <h3>Sales Tax</h3>
    <div class="row">
      <div class="field">
        <label>Tax name</label>
        <input type="text" value="HST">
        <div class="hint">e.g. HST, GST, VAT, Sales Tax</div>
      </div>
      <div class="field">
        <label>Tax rate (decimal)</label>
        <input type="text" value="0.13">
        <div class="hint">0.13 = 13%</div>
      </div>
    </div>
    <label style="display:flex; align-items:center; gap:0.5rem; cursor:pointer; font-size:0.875rem; color:var(--ink); margin-top:0.25rem;">
      <input type="checkbox" checked style="width:auto; margin:0; accent-color:#1a1a1a;">
      Enable sales tax — show tax line on invoices
    </label>
  </div>

  <div class="card">
    <h3>Business info</h3>
    <div class="field">
      <label>Business name</label>
      <input type="text" value="Jane Smith Design">
    </div>
    <div class="row">
      <div class="field">
        <label>Business email</label>
        <input type="email" value="jane@janesmith.design">
      </div>
      <div class="field">
        <label>Business phone</label>
        <input type="tel" value="+1 (416) 555-0182">
      </div>
    </div>
    <div class="field">
      <label>Business address</label>
      <textarea>123 Spadina Ave
Toronto, ON  M5V 2L4</textarea>
    </div>
    <div class="field">
      <label>Invoice number prefix</label>
      <input type="text" value="INV">
      <div class="hint">Numbers look like <code>INV-2025-0001</code></div>
    </div>
  </div>

  <div class="actions">
    <button class="btn-save">Save settings</button>
    <button class="btn-ghost">Back</button>
  </div>
</div>
</body></html>`;

/* ── Capture helper ─────────────────────────────────── */
async function capture(browser, html, outPath) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 800, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: 'networkidle0' });
  // Short wait to let fonts/layout settle
  await new Promise(r => setTimeout(r, 300));
  await page.screenshot({ path: outPath, fullPage: false });
  await page.close();
  console.log(`✓  Saved ${outPath}`);
}

/* ── Main ───────────────────────────────────────────── */
(async () => {
  console.log('Launching Puppeteer…');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    await capture(browser, invoiceHTML,   `${OUT_DIR}/invoice-preview.png`);
    await capture(browser, dashboardHTML, `${OUT_DIR}/dashboard.png`);
    await capture(browser, settingsHTML,  `${OUT_DIR}/settings.png`);
    console.log('\nAll screenshots saved to public/images/screenshots/');
  } finally {
    await browser.close();
  }
})();
