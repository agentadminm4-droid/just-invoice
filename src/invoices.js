const { customAlphabet } = require('nanoid');
const { db } = require('./db');
const { toCents, lineTotal, invoiceTotal, calcTax } = require('./money');

const publicToken = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 20);
const invoiceNumberGen = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 8);

// Year-prefixed invoice number: INV-2026-A1B2C3D4
// Unique by construction (nanoid), no DB read needed.
function nextInvoiceNumber(userId, prefix = 'INV') {
  const year = new Date().getFullYear();
  return `${prefix}-${year}-${invoiceNumberGen()}`;
}

function attachItems(invoice) {
  if (!invoice) return invoice;
  invoice.items = db.prepare(
    'SELECT * FROM line_items WHERE invoice_id = ? ORDER BY position, id'
  ).all(invoice.id);
  invoice.subtotal_cents = invoiceTotal(invoice.items);
  invoice.total_cents = invoice.subtotal_cents; // may be overwritten by attachTotals
  return invoice;
}

// Compute tax and grand total. Pass taxRate as a decimal (e.g. 0.13).
// If invoice.apply_tax is falsy, tax is 0.
function attachTotals(invoice, taxRate, taxName) {
  if (!invoice || !invoice.items) return invoice;
  const subtotal = invoice.subtotal_cents;
  const doTax = invoice.apply_tax && taxRate;
  invoice.tax_cents = doTax ? calcTax(invoice.items, taxRate) : 0;
  invoice.total_cents = subtotal + invoice.tax_cents;
  invoice.tax_name = doTax ? (taxName || 'Tax') : null;
  invoice.tax_rate_pct = doTax ? Math.round(taxRate * 100 * 10) / 10 : null;
  return invoice;
}

// Returns { rate, name } or null if tax is disabled for the user.
function getTaxConfigForUser(userId) {
  if (!userId) return null;
  const enabled = db.prepare(
    `SELECT value FROM settings WHERE user_id = ? AND key = 'tax_enabled'`
  ).get(userId);
  if (!enabled || enabled.value !== '1') return null;
  const rateRow = db.prepare(
    `SELECT value FROM settings WHERE user_id = ? AND key = 'tax_rate'`
  ).get(userId);
  if (!rateRow) return null;
  const nameRow = db.prepare(
    `SELECT value FROM settings WHERE user_id = ? AND key = 'tax_name'`
  ).get(userId);
  return {
    rate: parseFloat(rateRow.value) || null,
    name: nameRow ? nameRow.value : 'Tax',
  };
}

function listInvoicesForUser(userId) {
  const rows = db.prepare(`
    SELECT i.*, c.name AS client_name, c.email AS client_email, c.address AS client_address
    FROM invoices i
    JOIN clients c ON c.id = i.client_id
    WHERE i.user_id = ?
    ORDER BY i.created_at DESC
  `).all(userId);
  const cfg = getTaxConfigForUser(userId);
  for (const r of rows) {
    attachItems(r);
    attachTotals(r, cfg?.rate ?? null, cfg?.name ?? null);
  }
  return rows;
}

function getInvoiceForUser(userId, id) {
  const inv = db.prepare(`
    SELECT i.*, c.name AS client_name, c.email AS client_email, c.address AS client_address
    FROM invoices i
    JOIN clients c ON c.id = i.client_id
    WHERE i.id = ? AND i.user_id = ?
  `).get(id, userId);
  if (!inv) return null;
  attachItems(inv);
  const cfg = getTaxConfigForUser(userId);
  attachTotals(inv, cfg?.rate ?? null, cfg?.name ?? null);
  return inv;
}

// Internal: no user scoping — webhook only.
function getInvoiceUnscoped(id) {
  const inv = db.prepare(`
    SELECT i.*, c.name AS client_name, c.email AS client_email, c.address AS client_address
    FROM invoices i
    JOIN clients c ON c.id = i.client_id
    WHERE i.id = ?
  `).get(id);
  return attachItems(inv);
}

// Public: lookup by opaque token. taxRate + taxName come from the owner's settings.
function getInvoiceByToken(token, taxRate, taxName) {
  const inv = db.prepare(`
    SELECT i.*, c.name AS client_name, c.email AS client_email, c.address AS client_address
    FROM invoices i
    JOIN clients c ON c.id = i.client_id
    WHERE i.public_token = ?
  `).get(token);
  if (!inv) return null;
  attachItems(inv);
  attachTotals(inv, taxRate, taxName);
  return inv;
}

function findOrCreateClient(userId, { name, email, address }) {
  const clean = (name || '').trim();
  if (!clean) throw new Error('Client name is required');
  const existing = db.prepare(`
    SELECT * FROM clients
    WHERE user_id = ? AND name = ? AND IFNULL(email, '') = IFNULL(?, '')
  `).get(userId, clean, email || null);
  if (existing) {
    // Update address if provided
    if (address !== undefined) {
      db.prepare(`UPDATE clients SET address = ? WHERE id = ?`).run(address || '', existing.id);
      existing.address = address || '';
    }
    return existing;
  }
  const info = db.prepare(
    `INSERT INTO clients (user_id, name, email, address) VALUES (?, ?, ?, ?)`
  ).run(userId, clean, email || null, address || '');
  return db.prepare('SELECT * FROM clients WHERE id = ?').get(info.lastInsertRowid);
}

function createInvoice(userId, { client_name, client_email, client_address, issue_date, due_date, currency, notes, items, prefix, apply_tax }) {
  if (!userId) throw new Error('User is required');
  if (!items || items.length === 0) throw new Error('At least one line item is required');
  if (!due_date) throw new Error('Due date is required');

  const client = findOrCreateClient(userId, { name: client_name, email: client_email, address: client_address });
  const token = publicToken();

  // Invoice number uses nanoid — unique by construction, no collision possible.
  const number = nextInvoiceNumber(userId, prefix || 'INV');
  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO invoices (user_id, public_token, number, client_id, issue_date, due_date, currency, notes, status, apply_tax)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)
    `).run(
      userId, token, number, client.id,
      issue_date || new Date().toISOString().slice(0, 10),
      due_date, currency || 'USD', notes || null,
      apply_tax ? 1 : 0
    );
    invoiceId = info.lastInsertRowid;
    const insertItem = db.prepare(`
      INSERT INTO line_items (invoice_id, description, quantity, unit_price_cents, position)
      VALUES (?, ?, ?, ?, ?)
    `);
    items.forEach((it, idx) => {
      const description = (it.description || '').trim();
      if (!description) return;
      const quantity = Number(it.quantity) || 1;
      const price = typeof it.unit_price_cents === 'number' ? it.unit_price_cents : toCents(it.unit_price);
      insertItem.run(invoiceId, description, quantity, price, idx);
    });
  });
  tx();

  const inv = db.prepare(`
    SELECT i.*, c.name AS client_name, c.email AS client_email, c.address AS client_address
    FROM invoices i JOIN clients c ON c.id = i.client_id
    WHERE i.id = ? AND i.user_id = ?
  `).get(invoiceId, userId);
  attachItems(inv);
  const cfg = getTaxConfigForUser(userId);
  attachTotals(inv, cfg?.rate ?? null, cfg?.name ?? null);
  return inv;
}

function setStatusForUser(userId, id, status) {
  if (!['draft', 'sent', 'paid'].includes(status)) throw new Error('Invalid status');
  const info = db.prepare(`
    UPDATE invoices SET status = ?, updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).run(status, id, userId);
  if (info.changes === 0) throw new Error('Invoice not found');
  return getInvoiceForUser(userId, id);
}

function listClientsForUser(userId) {
  return db.prepare(`SELECT * FROM clients WHERE user_id = ? ORDER BY name`).all(userId);
}

// Update an existing draft invoice: fields + all line items replaced.
// deletedItems: array of line_item_ids that were removed in the UI.
function updateInvoice(userId, id, { client_name, client_email, client_address, issue_date, due_date, currency, notes, items, apply_tax, deleted_items }) {
  const inv = db.prepare(`SELECT * FROM invoices WHERE id = ? AND user_id = ?`).get(id, userId);
  if (!inv) throw new Error('Invoice not found');
  if (inv.status !== 'draft') throw new Error('Only draft invoices can be edited');

  const client = findOrCreateClient(userId, { name: client_name, email: client_email, address: client_address });

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE invoices
      SET client_id=?, issue_date=?, due_date=?, currency=?, notes=?, apply_tax=?, updated_at=datetime('now')
      WHERE id=? AND user_id=?
    `).run(client.id, issue_date, due_date, currency || 'USD', notes || null, apply_tax ? 1 : 0, id, userId);

    // Delete items explicitly removed in the UI
    if (deleted_items && deleted_items.length > 0) {
      const placeholders = deleted_items.map(() => '?').join(',');
      db.prepare(`DELETE FROM line_items WHERE id IN (${placeholders}) AND invoice_id = ?`).run(...deleted_items, id);
    }

    // Delete all remaining items (remaining ones are replaced)
    db.prepare('DELETE FROM line_items WHERE invoice_id = ?').run(id);

    const insertItem = db.prepare(`
      INSERT INTO line_items (invoice_id, description, quantity, unit_price_cents, position)
      VALUES (?, ?, ?, ?, ?)
    `);
    items.forEach((it, idx) => {
      const description = (it.description || '').trim();
      if (!description) return;
      const quantity = Number(it.quantity) || 1;
      const price = typeof it.unit_price_cents === 'number' ? it.unit_price_cents : toCents(it.unit_price);
      insertItem.run(id, description, quantity, price, idx);
    });
  });

  tx();
  return getInvoiceForUser(userId, id);
}

// Delete a draft invoice and all its line items.
function deleteInvoice(userId, id) {
  const inv = db.prepare(`SELECT * FROM invoices WHERE id = ? AND user_id = ?`).get(id, userId);
  if (!inv) throw new Error('Invoice not found');
  if (inv.status !== 'draft') throw new Error('Only draft invoices can be deleted');

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM line_items WHERE invoice_id = ?').run(id);
    db.prepare('DELETE FROM invoices WHERE id = ? AND user_id = ?').run(id, userId);
  });
  tx();
  return { deleted: true };
}

module.exports = {
  listInvoicesForUser,
  getInvoiceForUser,
  getInvoiceUnscoped,
  getInvoiceByToken,
  createInvoice,
  setStatusForUser,
  updateInvoice,
  deleteInvoice,
  listClientsForUser,
  lineTotal,
  invoiceTotal,
};
