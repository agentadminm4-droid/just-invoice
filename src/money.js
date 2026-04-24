// All money stored as integer cents. Format on the way out.

function toCents(value) {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(/[^0-9.\-]/g, ''));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function fromCents(cents) {
  return (Number(cents || 0) / 100);
}

function formatMoney(cents, currency = 'USD') {
  const amount = fromCents(cents);
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function lineTotal(item) {
  const qty = Number(item.quantity || 0);
  const price = Number(item.unit_price_cents || 0);
  return Math.round(qty * price);
}

function invoiceTotal(items, taxRate) {
  const subtotal = items.reduce((sum, it) => sum + lineTotal(it), 0);
  if (!taxRate) return subtotal;
  return Math.round(subtotal * (1 + taxRate));
}

function calcTax(items, taxRate) {
  if (!taxRate) return 0;
  const subtotal = items.reduce((sum, it) => sum + lineTotal(it), 0);
  return Math.round(subtotal * taxRate);
}

module.exports = { toCents, fromCents, formatMoney, lineTotal, invoiceTotal, calcTax };
