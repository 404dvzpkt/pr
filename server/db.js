'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

const DEFAULT_PROHIBITED_WORDS = [
  'idiot', 'stupid', 'moron', 'scammer', 'scam', 'garbage', 'trash', 'pathetic',
  'fraud', 'fake seller', 'hate you', 'bobo', 'tanga', 'ulol', 'gago', 'tarantado',
  'kupal', 'punyeta', 'putangina', 'fuck', 'shit', 'bitch', 'bastard'
];

const PAYMENT_DEFAULTS = {
  payment_gcash_url: 'https://www.gcash.com/',
  payment_maya_url: 'https://www.maya.ph/',
  payment_bank_url: 'https://www.bdo.com.ph/',
  payment_bdo_url: 'https://www.bdo.com.ph/',
  payment_bpi_url: 'https://www.bpi.com.ph/',
  payment_gcash_account: '',
  payment_maya_account: '',
  payment_bdo_account: '',
  payment_bdo_name: 'SkyWorld Stall',
  payment_bpi_account: '',
  payment_bpi_name: 'SkyWorld Stall',
};

const DEFAULT_SETTINGS = {
  schema_version: '3',
  site_name: 'SkyWorld Stall',
  support_email: 'hello@skyworld.example',
  currency: 'PHP',
  commission_pct: '5',
  shipping_fee_cents: '4900',
  free_shipping_threshold_cents: '200000',
  promo_hint: 'SKY50',
  maintenance_mode: '0',
  review_filter_enabled: '1',
  prohibited_words: JSON.stringify(DEFAULT_PROHIBITED_WORDS),
  demo_mode: '1',
  logo_url: '',
  ...PAYMENT_DEFAULTS,
};

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA synchronous = NORMAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');

const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schemaSql);

function nowIso() {
  return new Date().toISOString();
}

function get(sql, params = []) {
  return db.prepare(sql).get(...params);
}

function all(sql, params = []) {
  return db.prepare(sql).all(...params);
}

function run(sql, params = []) {
  return db.prepare(sql).run(...params);
}

function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) { /* ignore rollback errors */ }
    throw error;
  }
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed === null ? fallback : parsed;
  } catch (_) {
    return fallback;
  }
}

function setSetting(key, value) {
  run(
    'INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, String(value)]
  );
}

function getSetting(key, fallback = '') {
  const row = get('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : fallback;
}

function getSettingNumber(key, fallback = 0) {
  const value = Number(getSetting(key, String(fallback)));
  return Number.isFinite(value) ? value : fallback;
}

function getSettingBool(key, fallback = false) {
  const value = getSetting(key, fallback ? '1' : '0');
  return value === '1' || value === 'true';
}

function getSettings() {
  const rows = all('SELECT key, value FROM settings');
  const map = {};
  for (const row of rows) map[row.key] = row.value;
  return map;
}

function logActivity({ actor = null, action, entityType = '', entityId = '', details = '', ip = '', isSample = 0 }) {
  run(
    `INSERT INTO activity_logs(actor_id, actor_role, actor_name, action, entity_type, entity_id, details, ip, is_sample, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      actor ? actor.id : null,
      actor ? actor.role : '',
      actor ? actor.name : 'System',
      action,
      entityType,
      String(entityId ?? ''),
      String(details ?? '').slice(0, 1000),
      ip || '',
      isSample ? 1 : 0,
      nowIso(),
    ]
  );
}

function notifyUser(userId, type, title, message, link = '') {
  run(
    'INSERT INTO notifications(user_id, type, title, message, link, is_read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
    [userId, type, title, message, link, nowIso()]
  );
}

for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
  run('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING', [key, value]);
}

if (getSetting('schema_version', '1') !== '2') {
  for (const [key, value] of Object.entries(PAYMENT_DEFAULTS)) {
    if (!getSetting(key, '')) setSetting(key, value);
  }
  setSetting('schema_version', '2');
}

// v3: allow deactivated owners to release their stall so it becomes available again.
if (getSetting('schema_version', '2') !== '3') {
  try {
    db.exec('BEGIN IMMEDIATE');
    db.exec(`
      CREATE TABLE IF NOT EXISTS users_v3 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL COLLATE NOCASE UNIQUE,
        phone TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'operator', 'owner')),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deactivated')),
        stall_id INTEGER REFERENCES stalls(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_login_at TEXT,
        CHECK (
          (role = 'owner' AND (stall_id IS NOT NULL OR status = 'deactivated'))
          OR (role <> 'owner' AND stall_id IS NULL)
        )
      );
    `);
    db.exec(`
      INSERT OR IGNORE INTO users_v3(id, name, email, phone, password_hash, role, status, stall_id, created_at, updated_at, last_login_at)
      SELECT id, name, email, phone, password_hash, role, status, stall_id, created_at, updated_at, last_login_at FROM users
    `);
    db.exec('DROP TABLE users');
    db.exec('ALTER TABLE users_v3 RENAME TO users');
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_owner_stall_active
      ON users(stall_id) WHERE role = 'owner' AND stall_id IS NOT NULL AND status = 'active'`);
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (_) { /* ignore */ }
    // Table may already match v3 on a fresh install that ran schema.sql.
  }
  setSetting('schema_version', '3');
}

db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(nowIso());

module.exports = {
  config,
  db,
  nowIso,
  get,
  all,
  run,
  tx,
  parseJson,
  getSetting,
  setSetting,
  getSettingNumber,
  getSettingBool,
  getSettings,
  logActivity,
  notifyUser,
  DEFAULT_PROHIBITED_WORDS,
};
