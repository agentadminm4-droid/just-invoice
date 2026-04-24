const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'just-invoice.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// -----------------------------------------------------------------------------
// Base schema. Everything is CREATE TABLE IF NOT EXISTS, additive-only.
// Anything that requires a shape change is done below in the migrations block.
// -----------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT,
    address TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_token TEXT NOT NULL UNIQUE,
    number TEXT NOT NULL UNIQUE,
    client_id INTEGER NOT NULL,
    issue_date TEXT NOT NULL,
    due_date TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'draft', -- draft | sent | paid
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS line_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL,
    description TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 1,
    unit_price_cents INTEGER NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
  CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id);
  CREATE INDEX IF NOT EXISTS idx_line_items_invoice ON line_items(invoice_id);
`);

// -----------------------------------------------------------------------------
// Additive column migrations (safe to run repeatedly).
// -----------------------------------------------------------------------------
function tableColumns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
}
function ensureColumn(table, column, ddl) {
  if (!tableColumns(table).includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}
ensureColumn('invoices', 'stripe_checkout_session_id', 'stripe_checkout_session_id TEXT');
ensureColumn('invoices', 'stripe_payment_intent_id', 'stripe_payment_intent_id TEXT');
ensureColumn('invoices', 'paid_at', 'paid_at TEXT');
ensureColumn('invoices', 'sent_at', 'sent_at TEXT');
ensureColumn('invoices', 'apply_tax', 'apply_tax INTEGER');  /* 1=yes, 0=no, NULL=follow global */

// user_id on invoices + clients. Nullable at first so we can backfill.
ensureColumn('invoices', 'user_id', 'user_id INTEGER REFERENCES users(id)');
ensureColumn('clients', 'user_id', 'user_id INTEGER REFERENCES users(id)');
ensureColumn('clients', 'address', "address TEXT DEFAULT ''");

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_invoices_user ON invoices(user_id);
  CREATE INDEX IF NOT EXISTS idx_clients_user ON clients(user_id);
`);

// -----------------------------------------------------------------------------
// Settings table migration: old schema was (key PK, value).
// New schema is (user_id, key) composite PK, value. Migrate if needed.
// -----------------------------------------------------------------------------
function settingsNeedsMigration() {
  const info = db.prepare(`PRAGMA table_info(settings)`).all();
  if (info.length === 0) return false; // fresh DB, CREATE TABLE below will handle
  return !info.find(c => c.name === 'user_id');
}

if (settingsNeedsMigration()) {
  // Pull old rows, recreate with new shape, copy as "legacy" rows with user_id=NULL
  // (they'll be re-assigned to user 1 during the legacy-claim step).
  const oldRows = db.prepare(`SELECT key, value FROM settings`).all();
  db.exec(`
    DROP TABLE settings;
    CREATE TABLE settings (
      user_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (user_id, key),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS _legacy_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  const insertLegacy = db.prepare(`INSERT OR REPLACE INTO _legacy_settings (key, value) VALUES (?, ?)`);
  for (const r of oldRows) insertLegacy.run(r.key, r.value);
} else {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      user_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (user_id, key),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
}

// -----------------------------------------------------------------------------
// Legacy data claim: if there are rows with user_id IS NULL and there exists
// at least one user, assign them to the lowest-id user. This runs on boot and
// after each signup (via claimLegacyData below).
// -----------------------------------------------------------------------------
function claimLegacyData(userId) {
  // Only run for the *first* user — otherwise we'd cross-assign.
  // Strategy: pick the user with the smallest id; if they match userId AND
  // there are unassigned rows, claim them.
  const first = db.prepare(`SELECT id FROM users ORDER BY id ASC LIMIT 1`).get();
  if (!first || first.id !== userId) return { claimed: 0 };

  const tx = db.transaction(() => {
    const inv = db.prepare(`UPDATE invoices SET user_id = ? WHERE user_id IS NULL`).run(userId);
    const cli = db.prepare(`UPDATE clients SET user_id = ? WHERE user_id IS NULL`).run(userId);
    // Move legacy settings rows into this user's settings if table exists.
    const hasLegacy = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='_legacy_settings'`
    ).get();
    let settingsMoved = 0;
    if (hasLegacy) {
      const legacy = db.prepare(`SELECT key, value FROM _legacy_settings`).all();
      const ins = db.prepare(`
        INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?)
        ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value
      `);
      for (const r of legacy) { ins.run(userId, r.key, r.value); settingsMoved++; }
      db.exec(`DROP TABLE _legacy_settings`);
    }
    return {
      invoicesClaimed: inv.changes,
      clientsClaimed: cli.changes,
      settingsMoved,
    };
  });
  const result = tx();
  return { claimed: result.invoicesClaimed + result.clientsClaimed + result.settingsMoved, ...result };
}

// -----------------------------------------------------------------------------
// Per-user settings helpers. Defaults are seeded on first access per user.
// -----------------------------------------------------------------------------
const DEFAULT_SETTINGS = {
  business_name: 'Your Business Name',
  business_email: '',
  business_address: '',
  invoice_prefix: 'INV',
  tax_name: 'HST',
  tax_rate: '0.13',
  tax_enabled: '0',
};

function seedUserSettings(userId, overrides = {}) {
  const values = { ...DEFAULT_SETTINGS, ...overrides };
  const ins = db.prepare(
    `INSERT OR IGNORE INTO settings (user_id, key, value) VALUES (?, ?, ?)`
  );
  for (const [k, v] of Object.entries(values)) ins.run(userId, k, v);
}

function readSetting(userId, key) {
  const row = db.prepare(`SELECT value FROM settings WHERE user_id = ? AND key = ?`).get(userId, key);
  return row ? row.value : (DEFAULT_SETTINGS[key] ?? null);
}

function writeSetting(userId, key, value) {
  db.prepare(`
    INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?)
    ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value
  `).run(userId, key, value);
}

function allSettings(userId) {
  if (!userId) return { ...DEFAULT_SETTINGS };
  const rows = db.prepare(`SELECT key, value FROM settings WHERE user_id = ?`).all(userId);
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return { ...DEFAULT_SETTINGS, ...map };
}

module.exports = {
  db,
  readSetting,
  writeSetting,
  allSettings,
  seedUserSettings,
  claimLegacyData,
};
