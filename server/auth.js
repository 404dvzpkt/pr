'use strict';

const crypto = require('node:crypto');
const config = require('./config');
const store = require('./db');
const security = require('./security');
const { ApiError } = require('./errors');
const http = require('./http');

const SESSION_COOKIE = 'sky_session';
const SESSION_MAX_AGE_SECONDS = config.sessionDays * 24 * 60 * 60;

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    status: row.status,
    stallId: row.stall_id || null,
    lastLoginAt: row.last_login_at || null,
    createdAt: row.created_at,
  };
}

function sessionByToken(token) {
  if (!token || token.length < 32) return null;
  const hash = security.sha256(token);
  const row = store.get(
    `SELECT se.token_hash, se.csrf, se.expires_at, se.ip, se.user_agent,
            u.id, u.name, u.email, u.phone, u.role, u.status, u.stall_id, u.last_login_at, u.created_at
     FROM sessions se JOIN users u ON u.id = se.user_id
     WHERE se.token_hash = ? AND se.expires_at > ?`,
    [hash, new Date().toISOString()]
  );
  if (!row || row.status !== 'active') return null;
  return {
    tokenHash: row.token_hash,
    csrf: row.csrf,
    expiresAt: row.expires_at,
    user: publicUser(row),
  };
}

function readSession(req) {
  const cookies = http.parseCookies(req);
  if (!req._skyCookies) req._skyCookies = cookies;
  return sessionByToken(cookies[SESSION_COOKIE]);
}

function sessionCookie(token) {
  return http.cookie(SESSION_COOKIE, token, {
    maxAge: SESSION_MAX_AGE_SECONDS,
    secure: config.isProduction,
    sameSite: 'Lax',
    httpOnly: true,
  });
}

function clearCookie() {
  return http.cookie(SESSION_COOKIE, '', { maxAge: 0, sameSite: 'Lax', httpOnly: true });
}

function createSession(user, req) {
  const token = crypto.randomBytes(32).toString('hex');
  const csrf = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  store.run(
    `INSERT INTO sessions(token_hash, user_id, csrf, created_at, expires_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      security.sha256(token), user.id, csrf,
      new Date().toISOString(), expires.toISOString(),
      http.clientIp(req).slice(0, 80),
      String(req.headers['user-agent'] || '').slice(0, 250),
    ]
  );
  store.run('UPDATE users SET last_login_at = ? WHERE id = ?', [new Date().toISOString(), user.id]);
  store.run('DELETE FROM sessions WHERE expires_at < ?', [new Date().toISOString()]);
  return { token, csrf, expiresAt: expires.toISOString() };
}

function endSession(req) {
  const token = (req._skyCookies || http.parseCookies(req))[SESSION_COOKIE];
  if (token) store.run('DELETE FROM sessions WHERE token_hash = ?', [security.sha256(token)]);
}

function revokeUserSessions(userId, exceptTokenHash = null) {
  if (exceptTokenHash) {
    store.run('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', [userId, exceptTokenHash]);
  } else {
    store.run('DELETE FROM sessions WHERE user_id = ?', [userId]);
  }
}

function requireUser(ctx, roles = null) {
  if (!ctx.session) throw new ApiError(401, 'Please sign in to continue.', { code: 'auth_required' });
  if (roles && roles.length && !roles.includes(ctx.session.user.role)) {
    throw new ApiError(403, 'Your account does not have access to this area.', { code: 'forbidden' });
  }
  return ctx.session.user;
}

function ownerStall(user) {
  const stall = store.get('SELECT * FROM stalls WHERE id = ?', [user.stallId]);
  if (!stall) throw new ApiError(403, 'No stall is linked to this owner account.');
  return stall;
}

function csrfValid(ctx) {
  if (!ctx.session) return true;
  const header = String(ctx.req.headers['x-csrf-token'] || '');
  return header.length === ctx.session.csrf.length
    && crypto.timingSafeEqual(Buffer.from(header), Buffer.from(ctx.session.csrf));
}

module.exports = {
  SESSION_COOKIE,
  publicUser,
  readSession,
  sessionCookie,
  clearCookie,
  createSession,
  endSession,
  revokeUserSessions,
  requireUser,
  ownerStall,
  csrfValid,
};
