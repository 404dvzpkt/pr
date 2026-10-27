'use strict';

const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const store = require('../db');
const security = require('../security');
const auth = require('../auth');
const http = require('../http');
const uploads = require('../uploads');
const time = require('../time');
const { ApiError } = require('../errors');

function defaultLogoPath() {
  return path.join(config.publicDir, 'shared', 'logo.svg');
}

function resolveLogoPath() {
  const configured = store.getSetting('logo_url', '');
  if (!configured || !security.isSafeImageUrl(configured)) return defaultLogoPath();
  if (configured.startsWith('/uploads/')) {
    const relative = configured.slice('/uploads/'.length);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(relative)) return defaultLogoPath();
    const full = path.join(config.uploadsDir, relative);
    return fs.existsSync(full) ? full : defaultLogoPath();
  }
  const full = path.resolve(config.publicDir, configured.replace(/^\/+/, ''));
  if (!full.startsWith(config.publicDir + path.sep) || !/\.(?:jpe?g|png|webp|svg)$/i.test(full)) return defaultLogoPath();
  return fs.existsSync(full) ? full : defaultLogoPath();
}

function registerRoutes(router) {
  router.get('/api/meta', () => {
    const settings = store.getSettings();
    return {
      siteName: settings.site_name || 'SkyWorld Stall',
      supportEmail: settings.support_email || '',
      currency: settings.currency || 'PHP',
      timezone: config.timezoneLabel,
      demoMode: settings.demo_mode === '1',
      maintenanceMode: settings.maintenance_mode === '1',
      promoHint: settings.promo_hint || '',
      logoUrl: '/api/brand/logo',
      shippingFeeCents: store.getSettingNumber('shipping_fee_cents', 4900),
      freeShippingThresholdCents: store.getSettingNumber('free_shipping_threshold_cents', 200000),
      paymentLinks: {
        gcash: settings.payment_gcash_url || 'https://www.gcash.com/',
        maya: settings.payment_maya_url || 'https://www.maya.ph/',
        bank: settings.payment_bank_url || 'https://www.bdo.com.ph/',
        bdo: settings.payment_bdo_url || 'https://www.bdo.com.ph/',
        bpi: settings.payment_bpi_url || 'https://www.bpi.com.ph/',
      },
      paymentAccounts: {
        gcash: settings.payment_gcash_account || '',
        maya: settings.payment_maya_account || '',
        bdo: settings.payment_bdo_account || '',
        bdoName: settings.payment_bdo_name || '',
        bpi: settings.payment_bpi_account || '',
        bpiName: settings.payment_bpi_name || '',
      },
      stalls: store.get('SELECT COUNT(*) AS count FROM stalls').count,
      providers: { email: config.smtp.configured, sms: config.sms.configured },
      delivery: {
        email: config.smtp.configured,
        sms: config.sms.configured,
        devFallback: !config.isProduction,
      },
      appOrigin: config.appOrigin,
      passwordPolicy: {
        minLength: 8,
        maxLength: 20,
        groupsRequired: 3,
        allowed: 'Letters, numbers, and symbols only (no spaces).',
      },
    };
  });

  router.get('/api/brand/logo', (ctx) => {
    const full = resolveLogoPath();
    const ext = path.extname(full).toLowerCase();
    const type = http.MIME_TYPES[ext] || 'image/png';
    let stat;
    try {
      stat = fs.statSync(full);
    } catch (_) {
      throw new ApiError(404, 'Logo not available.');
    }
    ctx.res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'public, max-age=60',
      'Content-Length': stat.size,
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
    });
    ctx.res.end(fs.readFileSync(full));
    return undefined;
  });

  router.get('/api/health', () => ({
    ok: true,
    time: new Date().toISOString(),
    database: 'ready',
    sampleData: store.getSetting('demo_mode', '1') === '1',
  }));

  router.get('/api/account', (ctx) => {
    const user = auth.requireUser(ctx);
    const row = store.get('SELECT * FROM users WHERE id = ?', [user.id]);
    if (!row) throw new ApiError(404, 'Account not found.');
    let stall = null;
    if (row.role === 'owner' && row.stall_id) {
      stall = store.get('SELECT id, name, occupancy, operating_status, cover_image FROM stalls WHERE id = ?', [row.stall_id]);
    }
    return { user: auth.publicUser(row), stall };
  });

  router.put('/api/account', async (ctx) => {
    const user = auth.requireUser(ctx);
    const body = await ctx.body();
    const row = store.get('SELECT * FROM users WHERE id = ?', [user.id]);
    const name = body.name === undefined ? row.name : security.cleanName(body.name, 80);
    const email = body.email === undefined ? row.email : security.normalizeEmail(body.email);
    const phone = body.phone === undefined ? row.phone : security.normalizePhone(body.phone);
    if (name.length < 2) throw new ApiError(400, 'Enter your full name.', { field: 'name' });
    if (!security.isValidEmail(email)) throw new ApiError(400, 'Enter a valid email address.', { field: 'email' });
    if (!phone) throw new ApiError(400, 'Enter a valid Philippine mobile number.', { field: 'phone' });
    if (email !== row.email) {
      const check = security.verifyPassword(String(body.currentPassword || ''), row.password_hash);
      if (!check) throw new ApiError(403, 'Enter your current password to change your email address.', { field: 'currentPassword' });
    }
    if (store.get('SELECT id FROM users WHERE email = ? AND id <> ?', [email, row.id])) {
      throw new ApiError(409, 'Another account already uses this email address.', { field: 'email' });
    }
    if (store.get('SELECT id FROM users WHERE phone = ? AND id <> ?', [phone, row.id])) {
      throw new ApiError(409, 'Another account already uses this mobile number.', { field: 'phone' });
    }
    store.run('UPDATE users SET name = ?, email = ?, phone = ?, updated_at = ? WHERE id = ?', [name, email, phone, new Date().toISOString(), row.id]);
    if (row.role === 'owner' && row.stall_id) {
      store.run('UPDATE stalls SET contact_email = ?, contact_phone = ?, updated_at = ? WHERE id = ?', [email, phone, new Date().toISOString(), row.stall_id]);
    }
    store.logActivity({
      actor: user,
      action: 'account.profile_update',
      entityType: 'user',
      entityId: row.id,
      details: 'Updated account profile',
      ip: http.clientIp(ctx.req),
    });
    const fresh = store.get('SELECT * FROM users WHERE id = ?', [row.id]);
    return { user: auth.publicUser(fresh), message: 'Account profile saved.' };
  });

  router.post('/api/account/password', async (ctx) => {
    const user = auth.requireUser(ctx);
    const body = await ctx.body();
    const row = store.get('SELECT * FROM users WHERE id = ?', [user.id]);
    if (!security.verifyPassword(String(body.currentPassword || ''), row.password_hash)) {
      throw new ApiError(403, 'The current password is incorrect.', { field: 'currentPassword' });
    }
    const password = String(body.newPassword || '');
    const confirm = String(body.confirmPassword || '');
    const evaluation = security.passwordEvaluation(password);
    if (!evaluation.ok) throw new ApiError(400, security.passwordPolicyMessage(evaluation), { field: 'newPassword', details: evaluation });
    if (password !== confirm) throw new ApiError(400, 'The password confirmation does not match.', { field: 'confirmPassword' });
    if (password === String(body.currentPassword || '')) throw new ApiError(400, 'Choose a password different from your current one.', { field: 'newPassword' });
    store.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [security.hashPassword(password), new Date().toISOString(), row.id]);
    auth.revokeUserSessions(row.id, ctx.session.tokenHash);
    store.logActivity({
      actor: user,
      action: 'account.password_change',
      entityType: 'user',
      entityId: row.id,
      details: 'Changed password; other sessions revoked',
      ip: http.clientIp(ctx.req),
    });
    return { message: 'Password updated. Other signed-in sessions were signed out.' };
  });

  router.get('/api/notifications', (ctx) => {
    const user = auth.requireUser(ctx);
    const limit = http.numberParam(ctx.query.get('limit'), 30, 1, 100);
    const rows = store.all(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
      [user.id, limit]
    );
    const unread = store.get('SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND is_read = 0', [user.id]);
    return {
      notifications: rows.map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        message: row.message,
        link: row.link,
        isRead: Boolean(row.is_read),
        createdAt: row.created_at,
        localDateTime: time.fmtLocal(row.created_at, config.timezoneOffsetMinutes),
      })),
      unread: unread.count,
    };
  });

  router.post('/api/notifications/:id/read', (ctx) => {
    const user = auth.requireUser(ctx);
    store.run('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [Number(ctx.params.id), user.id]);
    return { ok: true };
  });

  router.post('/api/notifications/read-all', (ctx) => {
    const user = auth.requireUser(ctx);
    store.run('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [user.id]);
    return { ok: true };
  });

  router.post('/api/uploads', async (ctx) => {
    const user = auth.requireUser(ctx, ['owner', 'admin']);
    const type = ctx.req.headers['content-type'];
    const buffer = await http.readRawBody(ctx.req, config.maxUploadBytes + 1024);
    const saved = uploads.saveImage(buffer, type);
    store.logActivity({
      actor: user,
      action: 'upload.image',
      entityType: 'file',
      entityId: saved.fileName,
      details: `Uploaded ${saved.bytes} bytes`,
      ip: http.clientIp(ctx.req),
    });
    return { url: saved.url, bytes: saved.bytes, maxBytes: config.maxUploadBytes };
  });
}

module.exports = { registerRoutes };
