// Lazy Stripe client + config helpers.
// The app must run with or without Stripe configured.

let _stripe = null;

function isConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

function isWebhookConfigured() {
  return Boolean(process.env.STRIPE_WEBHOOK_SECRET);
}

function getStripe() {
  if (!isConfigured()) return null;
  if (!_stripe) {
    const Stripe = require('stripe');
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return _stripe;
}

// Returns a per-user Stripe instance using the user's own secret key,
// falling back to the global STRIPE_SECRET_KEY env var, or null if neither is set.
function getStripeForUser(userId) {
  if (userId) {
    // Lazy-require to avoid circular dep at module load time.
    const { readSetting } = require('./db');
    const userKey = readSetting(userId, 'stripe_secret_key');
    if (userKey && userKey.trim()) {
      const Stripe = require('stripe');
      return new Stripe(userKey.trim());
    }
  }
  // Fall back to global env var.
  return getStripe();
}

function baseUrl(req) {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

module.exports = { getStripe, getStripeForUser, isConfigured, isWebhookConfigured, baseUrl };
