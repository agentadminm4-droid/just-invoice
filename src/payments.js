// Invoice-level Stripe payment operations: create Checkout session, mark paid, idempotent handlers.

const { db } = require('./db');
const { getStripe, baseUrl } = require('./stripe-client');
const { lineTotal } = require('./money');
const { getInvoiceUnscoped } = require('./invoices');

// Zero-decimal currencies per https://stripe.com/docs/currencies#zero-decimal
// For these, Stripe expects the amount as whole units, not cents.
const ZERO_DECIMAL = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF',
  'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);

function centsToStripeAmount(cents, currency) {
  return ZERO_DECIMAL.has((currency || 'USD').toUpperCase())
    ? Math.round(cents / 100)
    : Math.round(cents);
}

async function createCheckoutSession(invoice, req, stripeInstance) {
  const stripe = stripeInstance || getStripe();
  if (!stripe) throw new Error('Stripe is not configured on this server');
  if (invoice.status === 'paid') throw new Error('Invoice is already paid');
  if (!invoice.items.length) throw new Error('Invoice has no line items');

  const currency = (invoice.currency || 'USD').toLowerCase();
  const origin = baseUrl(req);

  const line_items = invoice.items.map(it => ({
    price_data: {
      currency,
      product_data: { name: it.description.slice(0, 250) },
      unit_amount: centsToStripeAmount(lineTotal(it), currency),
    },
    quantity: 1,
  }));

  // Add tax as a separate line item if applicable.
  if (invoice.tax_cents > 0) {
    line_items.push({
      price_data: {
        currency,
        product_data: { name: `${invoice.tax_name || 'Tax'} (${invoice.tax_rate_pct || ''}%)` },
        unit_amount: centsToStripeAmount(invoice.tax_cents, currency),
      },
      quantity: 1,
    });
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items,
    client_reference_id: String(invoice.id),
    metadata: {
      invoice_id: String(invoice.id),
      invoice_number: invoice.number,
      public_token: invoice.public_token,
    },
    customer_email: invoice.client_email || undefined,
    success_url: `${origin}/i/${invoice.public_token}/paid?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/i/${invoice.public_token}`,
  });

  db.prepare(`
    UPDATE invoices
    SET stripe_checkout_session_id = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(session.id, invoice.id);

  return session;
}

// Idempotently mark invoice paid. Accepts a Stripe Checkout Session object.
// Returns true if newly paid, false if already paid or not found.
function markPaidFromSession(session) {
  const invoiceId = Number(session.metadata?.invoice_id || session.client_reference_id);
  if (!invoiceId) return false;
  const invoice = getInvoiceUnscoped(invoiceId);
  if (!invoice) return false;

  if (invoice.status === 'paid') return false;

  const paymentIntentId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id || null;

  db.prepare(`
    UPDATE invoices
    SET status = 'paid',
        paid_at = datetime('now'),
        stripe_payment_intent_id = COALESCE(?, stripe_payment_intent_id),
        stripe_checkout_session_id = COALESCE(stripe_checkout_session_id, ?),
        updated_at = datetime('now')
    WHERE id = ? AND status != 'paid'
  `).run(paymentIntentId, session.id, invoice.id);

  return true;
}

module.exports = { createCheckoutSession, markPaidFromSession };
