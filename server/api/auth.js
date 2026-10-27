'use strict';

const config = require('../config');
const store = require('../db');
const security = require('../security');
const auth = require('../auth');
const http = require('../http');
const delivery = require('../delivery');
const { ApiError } = require('../errors');

const RESET_TTL_MS = 15 * 60 * 1000;
const RESET_MAX_ATTEMPTS = 5;
const SIGNUP_TTL_MS = 10 * 60 * 1000;
const SIGNUP_MAX_ATTEMPTS = 6;
const SIGNUP_MAX_RESENDS = 3;
const SIGNUP_WINDOW_MS = 30 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000;

function normalizeIdentifier(value) {
  const text = String(value || '').trim();
  if (!text) return { email: '', phone: '', identifier: '' };
  if (text.includes('@')) {
    const email = security.normalizeEmail(text);
    return { email, phone: '', identifier: email };
  }
  const phone = security.normalizePhone(text);
  return { email: '', phone, identifier: phone };
}

function roleHome(role) {
  return role === 'admin' ? '/admin/' : role === 'operator' ? '/operator/' : '/owner/';
}

function activeAdmins() {
  return store.all("SELECT id FROM users WHERE role = 'admin' AND status = 'active'");
}

function registrationPayload(body) {
  const role = ['owner', 'admin', 'operator'].includes(body.role) ? body.role : 'owner';
  const name = security.cleanName(body.name, 80);
  const email = security.normalizeEmail(body.email);
  const phone = security.normalizePhone(body.phone);
  const password = String(body.password || '');
  const confirm = String(body.confirmPassword ?? body.confirm ?? '');
  if (name.length < 2) throw new ApiError(400, 'Enter your full name.', { field: 'name' });
  if (!security.isValidEmail(email)) throw new ApiError(400, 'Enter a valid email address.', { field: 'email' });
  if (!phone) throw new ApiError(400, 'Enter a valid Philippine mobile number (e.g. 0917 123 4567).', { field: 'phone' });
  const evaluation = security.passwordEvaluation(password);
  if (!evaluation.ok) throw new ApiError(400, security.passwordPolicyMessage(evaluation), { field: 'password', details: evaluation });
  if (password !== confirm) throw new ApiError(400, 'The password confirmation does not match.', { field: 'confirmPassword' });
  return { role, name, email, phone, password };
}

function checkUnique(email, phone) {
  if (store.get('SELECT id FROM users WHERE email = ?', [email])) {
    throw new ApiError(409, 'An account already uses this email address.', { field: 'email' });
  }
  if (store.get('SELECT id FROM users WHERE phone = ?', [phone])) {
    throw new ApiError(409, 'An account already uses this mobile number.', { field: 'phone' });
  }
}

function selectChannel(body, email, phone) {
  const channel = body.channel === 'phone' || body.channel === 'sms' ? 'phone' : 'email';
  return { channel, contact: channel === 'email' ? email : phone };
}

function availableOwnerStall(stallId) {
  const id = Number(stallId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(400, 'Choose the stall you are registering.', { field: 'stallId' });
  }
  const stall = store.get('SELECT * FROM stalls WHERE id = ?', [id]);
  if (!stall) throw new ApiError(404, 'That stall does not exist.', { field: 'stallId' });
  // Stall is taken only while an active owner account is linked to it.
  const activeOwner = store.get("SELECT id FROM users WHERE stall_id = ? AND role = 'owner' AND status = 'active'", [id]);
  if (activeOwner || stall.occupancy === 'occupied') {
    // If occupancy is stale (no active owner), free it so registration can proceed.
    if (!activeOwner && stall.occupancy === 'occupied') {
      store.run("UPDATE stalls SET occupancy = 'available', updated_at = ? WHERE id = ?", [new Date().toISOString(), id]);
      return store.get('SELECT * FROM stalls WHERE id = ?', [id]);
    }
    throw new ApiError(409, 'That stall already has an owner. Choose another available stall.', { field: 'stallId' });
  }
  return stall;
}

function signupResponse({ token, channel, contact, deliveryResult, code }) {
  const masked = deliveryResult.contact || delivery.maskContact(channel, contact);
  return {
    token,
    channel,
    contact: masked,
    sent: Boolean(deliveryResult.sent),
    demo: false,
    devCode: '',
    expiresInMinutes: SIGNUP_TTL_MS / 60000,
    message: deliveryResult.sent
      ? `We sent a six-digit code to ${masked}. It expires in 10 minutes.`
      : `Verification is temporarily unavailable because no ${channel === 'email' ? 'email' : 'SMS'} provider is configured. Ask the platform administrator to configure delivery in Admin → Settings → Delivery providers.`,
  };
}

async function deliverSignupCode(row, code, expiresAt) {
  const result = await delivery.sendCode({
    channel: row.channel,
    to: row.contact,
    name: row.name,
    code,
    purpose: 'signup',
    expiresMinutes: SIGNUP_TTL_MS / 60000,
  });
  const status = result.sent ? 'sent' : result.demo ? 'demo' : (result.reason || 'failed');
  store.run(
    'UPDATE signup_codes SET delivery_status = ?, last_sent_at = ?, expires_at = ? WHERE id = ?',
    [status, new Date().toISOString(), expiresAt, row.id]
  );
  return result;
}

function deliveryUnavailable(channel) {
  const configured = channel === 'email' ? config.smtp.configured : config.sms.configured;
  if (!configured) {
    throw new ApiError(503, `${channel === 'email' ? 'Email' : 'SMS'} verification is temporarily unavailable because no delivery provider is configured. Ask the platform administrator to add a provider in Admin → Settings → Delivery providers.`, { code: 'provider_not_configured' });
  }
}

function signupByToken(token) {
  if (!/^[a-f0-9]{32,64}$/.test(token)) return null;
  return store.get('SELECT * FROM signup_codes WHERE token_hash = ? AND used = 0', [security.sha256(token)]);
}

function registerRoutes(router) {
  router.get('/api/auth/me', (ctx) => {
    if (!ctx.session) {
      return { user: null, csrf: null, stall: null, unreadNotifications: 0 };
    }
    const user = ctx.session.user;
    let stall = null;
    if (user.role === 'owner' && user.stallId) {
      stall = store.get('SELECT id, name, occupancy, operating_status, cover_image FROM stalls WHERE id = ?', [user.stallId]);
    }
    const unread = store.get('SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND is_read = 0', [user.id]);
    return {
      user,
      csrf: ctx.session.csrf,
      stall,
      unreadNotifications: unread ? unread.count : 0,
      home: roleHome(user.role),
      providers: {
        email: config.smtp.configured,
        sms: config.sms.configured,
      },
    };
  });

  router.get('/api/auth/availability', (ctx) => {
    const ip = http.clientIp(ctx.req);
    const gate = security.consumeRateHit(`availability:${ip}`, { limit: 60, windowMs: 60 * 1000, lockMs: 60 * 1000 });
    if (!gate.allowed) throw new ApiError(429, 'Too many checks. Please wait a moment.', { headers: { 'Retry-After': gate.retryAfter } });
    const email = security.normalizeEmail(ctx.query.get('email') || '');
    const phone = security.normalizePhone(ctx.query.get('phone') || '');
    return {
      emailValid: email ? security.isValidEmail(email) : null,
      phoneValid: phone ? Boolean(phone) : null,
      emailAvailable: email && security.isValidEmail(email)
        ? !store.get('SELECT id FROM users WHERE email = ?', [email])
        : null,
      phoneAvailable: phone ? !store.get('SELECT id FROM users WHERE phone = ?', [phone]) : null,
    };
  });

  router.post('/api/auth/register/start', async (ctx) => {
    const ip = http.clientIp(ctx.req);
    const gate = security.consumeRateHit(`register:${ip}`, { limit: 12, windowMs: 60 * 60 * 1000, lockMs: 30 * 60 * 1000 });
    if (!gate.allowed) throw new ApiError(429, 'Too many registration attempts. Try again later.', { headers: { 'Retry-After': gate.retryAfter } });
    const body = await ctx.body();
    const { role, name, email, phone, password } = registrationPayload(body);
    checkUnique(email, phone);
    const stall = role === 'owner' ? availableOwnerStall(body.stallId) : null;
    // Direct registration: create the account immediately (no email/SMS verification).
    // User is signed in and sent to their dashboard. Active admins are notified so they
    // can review whether to keep the account (deactivate from the admin desk if needed).
    const now = new Date().toISOString();
    let userId;
    try {
      userId = store.tx(() => {
        if (role === 'owner') {
          const fresh = store.get('SELECT occupancy FROM stalls WHERE id = ?', [stall.id]);
          if (!fresh || fresh.occupancy !== 'available') {
            throw new ApiError(409, 'That stall was just taken. Choose another available stall.', { field: 'stallId', code: 'stall_taken' });
          }
          store.run(
            'UPDATE stalls SET occupancy = ?, contact_email = ?, contact_phone = ?, updated_at = ? WHERE id = ?',
            ['occupied', email, phone, now, stall.id]
          );
        }
        const result = store.run(
          `INSERT INTO users(name, email, phone, password_hash, role, status, stall_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
          [name, email, phone, security.hashPassword(password), role, stall ? stall.id : null, now, now]
        );
        return Number(result.lastInsertRowid);
      });
    } catch (error) {
      if (String(error.message || '').includes('UNIQUE')) {
        throw new ApiError(409, 'An account or stall assignment with these details already exists.', { field: 'email' });
      }
      throw error;
    }
    const user = store.get('SELECT * FROM users WHERE id = ?', [userId]);
    const session = auth.createSession(user, ctx.req);
    ctx.res.setHeader('Set-Cookie', auth.sessionCookie(session.token));
    const welcomeMsg = role === 'owner'
      ? `${stall.name} is now linked to your account.`
      : role === 'admin'
        ? 'Your administrator account is ready.'
        : 'Your operator account is ready.';
    store.notifyUser(userId, 'welcome', 'Welcome to SkyWorld Stall', welcomeMsg, roleHome(role));
    // Notify existing admins so they can decide whether to keep this account.
    const roleLabel = role === 'owner' ? 'stall owner' : role;
    const detail = role === 'owner'
      ? `${name} registered as stall owner for ${stall.name} (stall ${stall.id}). Review under Stall owners — deactivate if this account should not be kept.`
      : `${name} registered as ${roleLabel}. Review under Staff accounts — deactivate if this account should not be kept.`;
    const adminLink = role === 'owner' ? '/admin/#stall-owners' : '/admin/#staff';
    for (const admin of activeAdmins()) {
      if (admin.id === userId) continue;
      store.notifyUser(
        admin.id,
        'account_registered',
        `New ${roleLabel} registered`,
        detail,
        adminLink
      );
    }
    store.logActivity({
      actor: { id: user.id, role: user.role, name: user.name },
      action: 'account.register',
      entityType: 'user',
      entityId: user.id,
      details: role === 'owner' ? `Direct register owner for stall ${stall.id}` : `Direct register ${role} account`,
      ip,
    });
    return {
      bootstrapped: true,
      user: auth.publicUser(user),
      csrf: session.csrf,
      home: roleHome(role),
      message: role === 'owner'
        ? `${stall.name} is now linked to your account. You are signed in.`
        : `${role === 'admin' ? 'Administrator' : 'Operator'} account created. You are signed in.`,
    };
  });

  router.post('/api/auth/register/resend', async (ctx) => {
    const ip = http.clientIp(ctx.req);
    const gate = security.consumeRateHit(`signup-resend:${ip}`, { limit: 20, windowMs: 60 * 60 * 1000, lockMs: 30 * 60 * 1000 });
    if (!gate.allowed) throw new ApiError(429, 'Too many resend attempts. Try again later.', { headers: { 'Retry-After': gate.retryAfter } });
    const body = await ctx.body();
    const token = String(body.token || '');
    const row = signupByToken(token);
    if (!row) throw new ApiError(400, 'This verification session has ended. Start the registration again.', { code: 'signup_expired' });
    if (Date.now() - new Date(row.created_at).getTime() > SIGNUP_WINDOW_MS) {
      store.run('UPDATE signup_codes SET used = 1 WHERE id = ?', [row.id]);
      throw new ApiError(400, 'This verification session has ended. Start the registration again.', { code: 'signup_expired' });
    }
    if (row.resend_count >= SIGNUP_MAX_RESENDS) {
      throw new ApiError(429, 'You have requested the maximum number of codes. Start the registration again.', { code: 'resend_limit' });
    }
    const since = row.last_sent_at ? Date.now() - new Date(row.last_sent_at).getTime() : RESEND_COOLDOWN_MS;
    if (since < RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((RESEND_COOLDOWN_MS - since) / 1000);
      throw new ApiError(429, `Wait ${wait} more second${wait === 1 ? '' : 's'} before requesting another code.`, {
        headers: { 'Retry-After': wait },
        details: { retryAfter: wait },
      });
    }
    checkUnique(row.email, row.phone);
    if (row.role === 'owner') availableOwnerStall(row.stall_id);
    deliveryUnavailable(row.channel);
    const code = security.randomResetCode();
    const expiresAt = new Date(Date.now() + SIGNUP_TTL_MS).toISOString();
    store.run(
      'UPDATE signup_codes SET code_hash = ?, expires_at = ?, attempts = 0, resend_count = resend_count + 1, delivery_status = ?, last_sent_at = ? WHERE id = ?',
      [security.verificationHash(code, token, expiresAt), expiresAt, 'pending', new Date().toISOString(), row.id]
    );
    const result = await deliverSignupCode(row, code, expiresAt);
    if (!result.sent && !result.demo) {
      store.logActivity({
        action: 'account.register_code_failed', entityType: 'signup', entityId: row.id,
        details: `resend ${row.channel} delivery failed: ${result.reason || 'unknown'}`, ip,
      });
      throw new ApiError(502, 'The verification code could not be delivered. Check the delivery provider settings in the admin dashboard, then try again.', { code: 'delivery_failed' });
    }
    return signupResponse({ token, channel: row.channel, contact: row.contact, deliveryResult: result, code });
  });

  router.post('/api/auth/register/verify', async (ctx) => {
    const ip = http.clientIp(ctx.req);
    const gate = security.consumeRateHit(`signup-verify:${ip}`, { limit: 40, windowMs: 15 * 60 * 1000, lockMs: 15 * 60 * 1000 });
    if (!gate.allowed) throw new ApiError(429, 'Too many verification attempts. Try again later.', { headers: { 'Retry-After': gate.retryAfter } });
    const body = await ctx.body();
    const token = String(body.token || '');
    const code = String(body.code || '').trim();
    if (!/^\d{6}$/.test(code)) throw new ApiError(400, 'Enter the six-digit code.', { field: 'code' });
    const row = signupByToken(token);
    if (!row) throw new ApiError(400, 'This verification session has ended. Start the registration again.', { code: 'signup_expired' });
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      throw new ApiError(400, 'That code has expired. Request a new code.', { code: 'code_expired', field: 'code' });
    }
    if (row.attempts >= SIGNUP_MAX_ATTEMPTS) {
      throw new ApiError(400, 'Too many incorrect codes. Request a new code.', { code: 'code_locked', field: 'code' });
    }
    const expected = security.verificationHash(code, token, row.expires_at);
    if (!security.safeEqualHex(expected, row.code_hash)) {
      store.run('UPDATE signup_codes SET attempts = attempts + 1 WHERE id = ?', [row.id]);
      const remaining = Math.max(0, SIGNUP_MAX_ATTEMPTS - (row.attempts + 1));
      throw new ApiError(400, remaining
        ? `That verification code is incorrect. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
        : 'Too many incorrect codes. Request a new code.', { field: 'code', code: remaining ? 'code_invalid' : 'code_locked' });
    }
    checkUnique(row.email, row.phone);
    const stall = row.role === 'owner' ? availableOwnerStall(row.stall_id) : null;
    const now = new Date().toISOString();
    let userId;
    try {
      userId = store.tx(() => {
        if (row.role === 'owner') {
          const fresh = store.get('SELECT occupancy FROM stalls WHERE id = ?', [row.stall_id]);
          if (!fresh || fresh.occupancy !== 'available') {
            throw new ApiError(409, 'That stall was just taken. Choose another available stall.', { field: 'stallId', code: 'stall_taken' });
          }
          store.run(
            'UPDATE stalls SET occupancy = ?, contact_email = ?, contact_phone = ?, updated_at = ? WHERE id = ?',
            ['occupied', row.email, row.phone, now, row.stall_id]
          );
        }
        const result = store.run(
          `INSERT INTO users(name, email, phone, password_hash, role, status, stall_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
          [row.name, row.email, row.phone, row.password_hash, row.role, row.stall_id, now, now]
        );
        store.run('UPDATE signup_codes SET used = 1 WHERE id = ?', [row.id]);
        return Number(result.lastInsertRowid);
      });
    } catch (error) {
      store.run('UPDATE signup_codes SET used = 1 WHERE id = ?', [row.id]);
      if (String(error.message || '').includes('UNIQUE')) {
        throw new ApiError(409, 'An account or stall assignment with these details already exists.', { field: 'email' });
      }
      throw error;
    }
    const user = store.get('SELECT * FROM users WHERE id = ?', [userId]);
    const session = auth.createSession(user, ctx.req);
    ctx.res.setHeader('Set-Cookie', auth.sessionCookie(session.token));
    store.notifyUser(userId, 'welcome', 'Welcome to SkyWorld Stall', `Your ${row.role === 'owner' ? 'stall owner' : row.role} account is ready.`, roleHome(row.role));
    if (row.role === 'owner') {
      for (const admin of activeAdmins()) {
        store.notifyUser(admin.id, 'owner_registered', 'New stall owner registered', `${row.name} registered ${stall.name}.`, '/admin/#stall-owners');
      }
    }
    store.logActivity({
      actor: { id: user.id, role: user.role, name: user.name },
      action: 'account.register',
      entityType: 'user',
      entityId: user.id,
      details: row.role === 'owner' ? `Verified owner for stall ${row.stall_id}` : `Verified ${row.role} account via ${row.channel}`,
      ip,
    });
    return {
      user: auth.publicUser(user),
      csrf: session.csrf,
      home: roleHome(row.role),
      message: row.role === 'owner'
        ? `${stall.name} is now linked to your account.`
        : 'Your staff account is verified and ready.',
    };
  });

  router.post('/api/auth/login', async (ctx) => {
    const body = await ctx.body();
    const ip = http.clientIp(ctx.req);
    const { identifier } = normalizeIdentifier(body.identifier || body.email || body.phone);
    if (!identifier) throw new ApiError(400, 'Enter your email address or mobile number.', { field: 'identifier' });
    const key = `login:${ip}:${security.sha256(identifier).slice(0, 24)}`;
    const locked = security.rateLockSeconds(key);
    if (locked > 0) throw new ApiError(429, 'Too many sign-in attempts. Try again shortly.', { headers: { 'Retry-After': locked } });
    const user = store.get('SELECT * FROM users WHERE email = ? OR phone = ?', [identifier, identifier]);
    const passwordOk = user ? security.verifyPassword(String(body.password || ''), user.password_hash) : false;
    if (!user || !passwordOk) {
      const failure = security.recordRateFailure(key, { max: 6, windowMs: 15 * 60 * 1000, lockMs: 15 * 60 * 1000 });
      if (failure.blocked) {
        throw new ApiError(429, 'Too many sign-in attempts. Try again shortly.', { headers: { 'Retry-After': failure.retryAfter } });
      }
      throw new ApiError(401, 'The email/mobile number or password is incorrect.', { field: 'identifier' });
    }
    if (user.status !== 'active') {
      throw new ApiError(403, 'This account is deactivated. Contact the platform administrator.');
    }
    security.clearRateLimit(key);
    const session = auth.createSession(user, ctx.req);
    ctx.res.setHeader('Set-Cookie', auth.sessionCookie(session.token));
    store.logActivity({
      actor: { id: user.id, role: user.role, name: user.name },
      action: 'account.login',
      entityType: 'session',
      entityId: '',
      details: 'Signed in',
      ip,
    });
    return {
      user: auth.publicUser(user),
      csrf: session.csrf,
      home: roleHome(user.role),
      message: `Welcome back, ${user.name.split(' ')[0]}.`,
    };
  });

  router.post('/api/auth/logout', (ctx) => {
    auth.requireUser(ctx);
    const user = ctx.session.user;
    auth.endSession(ctx.req);
    ctx.res.setHeader('Set-Cookie', auth.clearCookie());
    store.logActivity({
      actor: { id: user.id, role: user.role, name: user.name },
      action: 'account.logout',
      entityType: 'session',
      entityId: '',
      details: 'Signed out',
      ip: http.clientIp(ctx.req),
    });
    return { ok: true };
  });

  router.post('/api/auth/forgot-password', async (ctx) => {
    const ip = http.clientIp(ctx.req);
    const gate = security.consumeRateHit(`forgot:${ip}`, { limit: 8, windowMs: 15 * 60 * 1000, lockMs: 15 * 60 * 1000 });
    if (!gate.allowed) throw new ApiError(429, 'Too many reset requests. Try again later.', { headers: { 'Retry-After': gate.retryAfter } });
    if (config.isProduction && !config.smtp.configured && !config.sms.configured) {
      throw new ApiError(503, 'Password recovery is unavailable because this server has no email or SMS provider configured. Ask the platform administrator to configure delivery first.', { code: 'provider_not_configured' });
    }
    const body = await ctx.body();
    const contactRaw = String(body.contact || '').trim();
    const generic = {
      message: 'If that email address or mobile number belongs to a SkyWorld account, a reset code has been sent. The code expires in 15 minutes.',
      delivered: true,
    };
    const isEmail = contactRaw.includes('@');
    const contact = isEmail ? security.normalizeEmail(contactRaw) : security.normalizePhone(contactRaw);
    if (!contact) return generic;
    const user = store.get('SELECT * FROM users WHERE email = ? OR phone = ?', [contact, contact]);
    if (!user || user.status !== 'active') return generic;
    const channel = user.email === contact ? 'email' : 'phone';
    const code = security.randomResetCode();
    const expiresAt = new Date(Date.now() + RESET_TTL_MS).toISOString();
    const now = new Date().toISOString();
    const result = await delivery.sendCode({
      channel,
      to: contact,
      name: user.name,
      code,
      purpose: 'reset',
      expiresMinutes: RESET_TTL_MS / 60000,
    });
    const status = result.sent ? 'sent' : result.demo ? 'demo' : (result.reason || 'failed');
    store.tx(() => {
      store.run('UPDATE password_resets SET used = 1 WHERE user_id = ? AND used = 0', [user.id]);
      store.run(
        `INSERT INTO password_resets(user_id, channel, contact, code_hash, expires_at, attempts, used, delivery_status, created_at, ip)
         VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
        [user.id, channel, contact, security.resetCodeHash(code, user.id, expiresAt), expiresAt, status, now, ip]
      );
      store.logActivity({
        actor: { id: user.id, role: user.role, name: user.name },
        action: 'account.password_reset_request',
        entityType: 'user',
        entityId: user.id,
        details: `Reset code requested via ${channel}; delivery: ${status}`,
        ip,
      });
    });
    if (!result.sent) {
      return {
        message: 'Verification is temporarily unavailable because no delivery provider is configured, or the provider could not be reached. Ask the platform administrator to check Admin → Settings → Delivery providers, then try again.',
        delivered: false,
        demo: false,
        devCode: '',
      };
    }
    return generic;
  });

  router.post('/api/auth/reset-password', async (ctx) => {
    const ip = http.clientIp(ctx.req);
    const gate = security.consumeRateHit(`reset:${ip}`, { limit: 20, windowMs: 60 * 60 * 1000, lockMs: 60 * 60 * 1000 });
    if (!gate.allowed) throw new ApiError(429, 'Too many attempts. Try again later.', { headers: { 'Retry-After': gate.retryAfter } });
    const body = await ctx.body();
    const contactRaw = String(body.contact || '').trim();
    const code = String(body.code || '').trim();
    const contact = contactRaw.includes('@') ? security.normalizeEmail(contactRaw) : security.normalizePhone(contactRaw);
    const invalid = () => new ApiError(400, 'That reset code is invalid or has expired. Request a new code.', { field: 'code' });
    if (!contact || !/^\d{6}$/.test(code)) throw invalid();
    const row = store.get(
      'SELECT * FROM password_resets WHERE contact = ? AND used = 0 ORDER BY id DESC LIMIT 1',
      [contact]
    );
    if (!row) throw invalid();
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      store.run('UPDATE password_resets SET used = 1 WHERE id = ?', [row.id]);
      throw invalid();
    }
    if (row.attempts >= RESET_MAX_ATTEMPTS) {
      store.run('UPDATE password_resets SET used = 1 WHERE id = ?', [row.id]);
      throw invalid();
    }
    const expected = security.resetCodeHash(code, row.user_id, row.expires_at);
    if (!security.safeEqualHex(expected, row.code_hash)) {
      store.run('UPDATE password_resets SET attempts = attempts + 1 WHERE id = ?', [row.id]);
      const remaining = Math.max(0, RESET_MAX_ATTEMPTS - (row.attempts + 1));
      throw new ApiError(400, remaining
        ? `That reset code is invalid or has expired. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
        : 'That reset code is invalid or has expired. Request a new code.', { field: 'code' });
    }
    const password = String(body.password || '');
    const confirm = String(body.confirmPassword ?? body.confirm ?? '');
    const evaluation = security.passwordEvaluation(password);
    if (!evaluation.ok) throw new ApiError(400, security.passwordPolicyMessage(evaluation), { field: 'password', details: evaluation });
    if (password !== confirm) throw new ApiError(400, 'The password confirmation does not match.', { field: 'confirmPassword' });
    const user = store.get('SELECT * FROM users WHERE id = ?', [row.user_id]);
    if (!user) throw invalid();
    store.tx(() => {
      store.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [security.hashPassword(password), new Date().toISOString(), user.id]);
      store.run('UPDATE password_resets SET used = 1 WHERE user_id = ?', [user.id]);
      store.run('DELETE FROM sessions WHERE user_id = ?', [user.id]);
      store.logActivity({
        actor: { id: user.id, role: user.role, name: user.name },
        action: 'account.password_reset',
        entityType: 'user',
        entityId: user.id,
        details: 'Password reset with a one-time code; existing sessions revoked',
        ip,
      });
    });
    return { message: 'Your password has been changed. Sign in with your new password.' };
  });
}

module.exports = { registerRoutes, roleHome };
