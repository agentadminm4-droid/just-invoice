const bcrypt = require('bcrypt');
const crypto = require('crypto');
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

function createResetToken(email) {
  const user = getByEmail(email);
  if (!user) return null; // don't leak whether email exists
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 19);
  db.prepare(
    `INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)`
  ).run(user.id, token, expiresAt);
  return { token, email: user.email };
}

function getResetToken(token) {
  return db.prepare(
    `SELECT * FROM password_reset_tokens WHERE token = ? AND used = 0 AND expires_at > datetime('now')`
  ).get(token);
}

async function resetPassword(token, newPassword) {
  const rec = getResetToken(token);
  if (!rec) throw new Error('This reset link is invalid or has expired.');
  const pwErr = validatePassword(newPassword);
  if (pwErr) throw new Error(pwErr);
  const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hash, rec.user_id);
  db.prepare(`UPDATE password_reset_tokens SET used = 1 WHERE id = ?`).run(rec.id);
  return true;
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
  createResetToken,
  getResetToken,
  resetPassword,
};
