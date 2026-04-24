const bcrypt = require('bcrypt');
const { db, seedUserSettings, claimLegacyData } = require('./db');

const BCRYPT_ROUNDS = 12;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function validatePassword(pw) {
  if (typeof pw !== 'string') return 'Password is required';
  if (pw.length < 8) return 'Password must be at least 8 characters';
  if (pw.length > 200) return 'Password is too long';
  return null;
}

function validateEmail(email) {
  const e = normalizeEmail(email);
  if (!e) return 'Email is required';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return 'Please enter a valid email address';
  return null;
}

function getByEmail(email) {
  return db.prepare(`SELECT * FROM users WHERE email = ?`).get(normalizeEmail(email));
}

function getById(id) {
  return db.prepare(`SELECT id, email, created_at FROM users WHERE id = ?`).get(id);
}

async function createUser({ email, password, passwordConfirm }) {
  const emailErr = validateEmail(email);
  if (emailErr) throw new Error(emailErr);

  const pwErr = validatePassword(password);
  if (pwErr) throw new Error(pwErr);

  if (passwordConfirm !== undefined && password !== passwordConfirm) {
    throw new Error("Passwords don't match");
  }

  const normalized = normalizeEmail(email);
  const existing = getByEmail(normalized);
  if (existing) throw new Error('An account with that email already exists');

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const info = db.prepare(`
    INSERT INTO users (email, password_hash) VALUES (?, ?)
  `).run(normalized, hash);
  const userId = info.lastInsertRowid;

  // Seed default settings; copy over business_email from signup email as a sensible default.
  seedUserSettings(userId, { business_email: normalized });

  // If this is the first user, claim any legacy (pre-auth) data.
  const claim = claimLegacyData(userId);

  return { id: userId, email: normalized, legacyClaim: claim };
}

async function authenticate({ email, password }) {
  const user = getByEmail(email);
  if (!user) return null;
  const ok = await bcrypt.compare(String(password || ''), user.password_hash);
  if (!ok) return null;
  return { id: user.id, email: user.email };
}

function count() {
  return db.prepare(`SELECT COUNT(*) AS c FROM users`).get().c;
}

module.exports = {
  createUser,
  authenticate,
  getById,
  getByEmail,
  count,
  normalizeEmail,
  validateEmail,
  validatePassword,
};
