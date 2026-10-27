'use strict';

const crypto = require('node:crypto');
const config = require('./config');
const db = require('./db');

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

function verifyPassword(password, stored) {
  try {
    const parts = String(stored || '').split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const n = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = Buffer.from(parts[4], 'base64');
    const expected = Buffer.from(parts[5], 'base64');
    const actual = crypto.scryptSync(String(password), salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: 64 * 1024 * 1024,
    });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch (_) {
    return false;
  }
}

function passwordEvaluation(password) {
  const value = String(password || '');
  const allowed = /^[A-Za-z0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?~`]+$/.test(value);
  const groups = {
    upper: /[A-Z]/.test(value),
    lower: /[a-z]/.test(value),
    number: /[0-9]/.test(value),
    symbol: /[^A-Za-z0-9]/.test(value),
  };
  const groupCount = Object.values(groups).filter(Boolean).length;
  const lengthOk = value.length >= 8 && value.length <= 20;
  const rules = {
    length: lengthOk,
    allowed,
    groups: groupCount >= 3,
  };
  return {
    ok: rules.length && rules.allowed && rules.groups,
    rules,
    groups,
    groupCount,
    length: value.length,
  };
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(value) {
  const email = normalizeEmail(value);
  if (email.length < 5 || email.length > 160) return false;
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(email);
}

function normalizePhone(value) {
  let digits = String(value || '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('63')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  if (!/^9\d{9}$/.test(digits)) return '';
  return `+63${digits}`;
}

function isValidPhone(value) {
  return Boolean(normalizePhone(value));
}

function cleanText(value, max = 1000) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);
}

function cleanName(value, max = 80) {
  return cleanText(value, max).replace(/\s+/g, ' ');
}

function parseMoneyToCents(value, maxCents = 1000000000) {
  if (value === null || value === undefined) return null;
  let text = String(value).replace(/[₱,\s]/g, '');
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > maxCents) return null;
  return cents;
}

function isSafeImageUrl(value) {
  if (typeof value !== 'string') return false;
  if (value.length < 8 || value.length > 300) return false;
  if (value.includes('..') || value.includes('\\') || value.includes('//')) return false;
  if (!/^\/(?:uploads|shared)\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)) return false;
  return /\.(?:jpe?g|png|webp|svg)$/i.test(value);
}

function isSafeColorHex(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

function isSafePaymentUrl(value) {
  if (value === '' || value === null || value === undefined) return true;
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (text.length < 12 || text.length > 500) return false;
  try {
    const url = new URL(text);
    return url.protocol === 'https:'
      && url.username === ''
      && url.password === ''
      && Boolean(url.hostname)
      && !url.hostname.includes(' ');
  } catch (_) {
    return false;
  }
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function resetCodeHash(code, userId, expiresAt) {
  return crypto
    .createHmac('sha256', config.resetPepper)
    .update(`${String(code)}|${userId}|${expiresAt}`)
    .digest('hex');
}

function verificationHash(code, scope, expiresAt) {
  return crypto
    .createHmac('sha256', config.resetPepper)
    .update(`${String(code)}|${String(scope)}|${expiresAt}`)
    .digest('hex');
}

function randomResetCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function safeEqualHex(a, b) {
  const left = Buffer.from(String(a), 'hex');
  const right = Buffer.from(String(b), 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function rateLockSeconds(key) {
  const row = db.get('SELECT locked_until FROM rate_limits WHERE key = ?', [key]);
  if (!row) return 0;
  const remaining = Number(row.locked_until) - Date.now();
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

function consumeRateHit(key, { limit, windowMs, lockMs = windowMs }) {
  const now = Date.now();
  const row = db.get('SELECT * FROM rate_limits WHERE key = ?', [key]);
  if (row && Number(row.locked_until) > now) {
    return { allowed: false, retryAfter: Math.ceil((Number(row.locked_until) - now) / 1000), count: row.count };
  }
  let count = 1;
  let windowStart = now;
  if (row && Number(row.window_start) + windowMs > now) {
    count = Number(row.count) + 1;
    windowStart = Number(row.window_start);
  }
  const blocked = count > limit;
  const lockedUntil = blocked ? now + lockMs : 0;
  db.run(
    `INSERT INTO rate_limits(key, count, window_start, locked_until) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET count = excluded.count, window_start = excluded.window_start, locked_until = excluded.locked_until`,
    [key, count, windowStart, lockedUntil]
  );
  return {
    allowed: !blocked,
    retryAfter: blocked ? Math.ceil(lockMs / 1000) : 0,
    count,
  };
}

function recordRateFailure(key, { max, windowMs, lockMs }) {
  const now = Date.now();
  const row = db.get('SELECT * FROM rate_limits WHERE key = ?', [key]);
  if (row && Number(row.locked_until) > now) {
    return { blocked: true, retryAfter: Math.ceil((Number(row.locked_until) - now) / 1000) };
  }
  let count = 1;
  let windowStart = now;
  if (row && Number(row.window_start) + windowMs > now) {
    count = Number(row.count) + 1;
    windowStart = Number(row.window_start);
  }
  const blocked = count >= max;
  const lockedUntil = blocked ? now + lockMs : 0;
  db.run(
    `INSERT INTO rate_limits(key, count, window_start, locked_until) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET count = excluded.count, window_start = excluded.window_start, locked_until = excluded.locked_until`,
    [key, count, windowStart, lockedUntil]
  );
  return { blocked, retryAfter: blocked ? Math.ceil(lockMs / 1000) : 0, remaining: Math.max(0, max - count) };
}

function clearRateLimit(key) {
  db.run('DELETE FROM rate_limits WHERE key = ?', [key]);
}

function passwordPolicyMessage(evaluation) {
  if (!evaluation.rules.length) return 'Password must be 8 to 20 characters long.';
  if (!evaluation.rules.allowed) return 'Password may only contain letters, numbers, and symbols (no spaces).';
  if (!evaluation.rules.groups) return 'Password must include at least three of: uppercase letters, lowercase letters, numbers, symbols.';
  return 'Password does not meet the policy.';
}

module.exports = {
  hashPassword,
  verifyPassword,
  passwordEvaluation,
  passwordPolicyMessage,
  normalizeEmail,
  isValidEmail,
  normalizePhone,
  isValidPhone,
  cleanText,
  cleanName,
  parseMoneyToCents,
  isSafeImageUrl,
  isSafeColorHex,
  isSafePaymentUrl,
  randomToken,
  sha256,
  resetCodeHash,
  verificationHash,
  randomResetCode,
  safeEqualHex,
  rateLockSeconds,
  consumeRateHit,
  recordRateFailure,
  clearRateLimit,
};
