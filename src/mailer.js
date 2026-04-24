// Compose and send invoice emails via Resend.

const path = require('path');
const ejs = require('ejs');
const { db } = require('./db');
const emailClient = require('./email-client');
const { formatMoney, lineTotal } = require('./money');

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildSubject(invoice, settings) {
  const biz = settings.business_name || 'JustInvoice';
  const total = formatMoney(invoice.total_cents, invoice.currency);
  return `Invoice ${invoice.number} from ${biz} — ${total} due ${invoice.due_date}`;
}

async function renderHtml(invoice, settings, shareUrl) {
  const view = path.join(__dirname, '..', 'views', 'email-invoice.ejs');
  return ejs.renderFile(view, {
    invoice,
    settings,
    shareUrl,
    formatMoney,
    lineTotal,
  });
}

function renderText(invoice, settings, shareUrl) {
  const lines = [];
  lines.push(`Invoice ${invoice.number} from ${settings.business_name || 'JustInvoice'}`);
  lines.push('');
  lines.push(`Hi ${invoice.client_name},`);
  lines.push('');
  lines.push(`Please find your invoice below. Total due: ${formatMoney(invoice.total_cents, invoice.currency)} by ${invoice.due_date}.`);
  lines.push('');
  lines.push('Line items:');
  for (const it of invoice.items) {
    lines.push(`  - ${it.description} × ${it.quantity} @ ${formatMoney(it.unit_price_cents, invoice.currency)} = ${formatMoney(lineTotal(it), invoice.currency)}`);
  }
  lines.push('');
  lines.push(`Total: ${formatMoney(invoice.total_cents, invoice.currency)}`);
  lines.push('');
  lines.push(`View and pay online: ${shareUrl}`);
  if (invoice.notes) {
    lines.push('');
    lines.push('Notes:');
    lines.push(invoice.notes);
  }
  lines.push('');
  lines.push(settings.business_name || '');
  if (settings.business_email) lines.push(settings.business_email);
  if (settings.business_address) lines.push(settings.business_address);
  return lines.filter(Boolean).join('\n');
}

/**
 * Send the invoice email. Returns { id } from Resend on success, throws on failure.
 * On success: marks the invoice as `sent` and stamps `sent_at` (if not already paid).
 */
async function sendInvoiceEmail(invoice, settings, shareUrl) {
  if (!invoice.client_email) throw new Error('Client email is required to send');
  const resend = emailClient.getResend();
  if (!resend) throw new Error('Email is not configured on this server');

  const subject = buildSubject(invoice, settings);
  const html = await renderHtml(invoice, settings, shareUrl);
  const text = renderText(invoice, settings, shareUrl);

  const payload = {
    from: emailClient.fromAddress(settings.business_name),
    to: [invoice.client_email],
    subject,
    html,
    text,
  };
  if (settings.business_email) payload.reply_to = settings.business_email;

  const response = await resend.emails.send(payload);
  // Resend v4 SDK returns { data, error }. Older shapes return the object directly.
  if (response && response.error) {
    const msg = response.error.message || response.error.name || JSON.stringify(response.error);
    throw new Error(`Resend: ${msg}`);
  }
  const result = response && response.data ? response.data : response;

  // Mark as sent (don't downgrade a paid invoice).
  db.prepare(`
    UPDATE invoices
    SET sent_at = datetime('now'),
        status = CASE WHEN status = 'paid' THEN status ELSE 'sent' END,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(invoice.id);

  return { id: result && result.id, subject, to: invoice.client_email };
}

module.exports = {
  sendInvoiceEmail,
  renderText,
  buildSubject,
  _escapeHtml: escapeHtml,
};
