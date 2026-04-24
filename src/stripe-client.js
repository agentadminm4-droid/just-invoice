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

function baseUrl(req) {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

module.exports = { getStripe, isConfigured, isWebhookConfigured, baseUrl };
