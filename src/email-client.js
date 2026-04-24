// Lazy Resend client + config helpers. Mirror of stripe-client.js.

let _resend = null;

function isConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

function getResend() {
  if (!isConfigured()) return null;
  if (!_resend) {
    const { Resend } = require('resend');
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
}

function fromAddress(businessName) {
  const addr = process.env.EMAIL_FROM || 'onboarding@resend.dev';
  if (businessName && !addr.includes('<')) {
    // Wrap as "Business Name <addr>"
    const safe = businessName.replace(/[<>"]/g, '').trim();
    if (safe) return `${safe} <${addr}>`;
  }
  return addr;
}

module.exports = { getResend, isConfigured, fromAddress };
