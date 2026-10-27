'use strict';

const config = require('../config');
const store = require('../db');
const security = require('../security');
const auth = require('../auth');
const http = require('../http');
const time = require('../time');
const reports = require('../reports');
const reportTokens = require('../reportTokens');
const mailer = require('../mailer');
const sms = require('../sms');
const providers = require('../providers');
const { ApiError } = require('../errors');
const common = require('./common');

const BACKUP_FORMAT = 'skyworld-backup';
const BACKUP_VERSION = 1;
const BACKUP_TABLES = [
  'stalls', 'settings', 'users', 'vouchers', 'products', 'orders', 'order_items', 'reviews',
  'notifications', 'suppliers', 'feedback', 'tickets', 'visits', 'activity_logs',
];

function admin(ctx) {
  return auth.requireUser(ctx, ['admin']);
}

function rangeFor(ctx) {
  return common.resolveRange(ctx.query, config.timezoneOffsetMinutes);
}

function count(table, where = '', params = []) {
  return store.get(`SELECT COUNT(*) AS count FROM ${table} ${where}`, params).count;
}

function parseWords(input) {
  let values = [];
  if (Array.isArray(input)) values = input;
  else if (typeof input === 'string') values = input.split(/[\n,]/);
  else throw new ApiError(400, 'Provide prohibited words as a list.', { field: 'prohibitedWords' });
  const words = [];
  for (const value of values.slice(0, 300)) {
    const word = security.cleanText(value, 40).toLowerCase();
    if (word && !words.includes(word)) words.push(word);
  }
  return words;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function adminUserRow(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    status: row.status,
    stallId: row.stall_id,
    stallName: row.stall_name || null,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at || null,
  };
}

function revokeSessionsFor(userId) {
  store.run('DELETE FROM sessions WHERE user_id = ?', [userId]);
}

function confirmRestoreBackup(backup) {
  if (!backup || typeof backup !== 'object' || backup.format !== BACKUP_FORMAT || backup.version !== BACKUP_VERSION) {
    throw new ApiError(400, 'That file is not a SkyWorld backup (format/version mismatch).');
  }
  if (!backup.tables || typeof backup.tables !== 'object') throw new ApiError(400, 'The backup has no table data.');
  for (const table of BACKUP_TABLES) {
    const rows = backup.tables[table];
    if (!Array.isArray(rows)) throw new ApiError(400, `Backup is missing the ${table} table.`);
    if (rows.length > 20000) throw new ApiError(400, `Backup table ${table} is too large.`);
  }
  if (!Array.isArray(backup.tables.users) || !Array.isArray(backup.tables.stalls)) {
    throw new ApiError(400, 'The backup must contain users and stalls.');
  }
  if (!backup.tables.users.some((user) => user.role === 'admin')) {
    throw new ApiError(400, 'The backup must contain at least one administrator account.');
  }
  return true;
}

function registerRoutes(router) {
  router.get('/api/admin/overview', (ctx) => {
    admin(ctx);
    const offset = config.timezoneOffsetMinutes;
    const today = time.periodRange('daily', null, offset);
    const month = time.periodRange('monthly', null, offset);
    const year = time.periodRange('annual', null, offset);
    const load = (range) => store.all(
      `SELECT o.*, (SELECT COALESCE(SUM(qty),0) FROM order_items WHERE order_id = o.id) AS qty_sum
       FROM orders o WHERE o.created_at >= ? AND o.created_at < ? ORDER BY o.created_at DESC`,
      [range.start, range.end]
    );
    const todayOrders = load(today);
    const monthOrders = load(month);
    const yearOrders = load(year);
    const monthTotals = reports.computeTotals(monthOrders);
    const yearTotals = reports.computeTotals(yearOrders);
    const stalls = store.all('SELECT occupancy, operating_status, COUNT(*) AS count FROM stalls GROUP BY occupancy, operating_status');
    const roleCounts = store.all('SELECT role, status, COUNT(*) AS count FROM users GROUP BY role, status');
    const lowStock = count('products', 'WHERE archived = 0 AND stock <= 10');
    const flagged = count('reviews', "WHERE status = 'flagged'");
    const feedbackNew = count('feedback', "WHERE status = 'new'");
    const openTickets = count('tickets', "WHERE status IN ('open','in_progress')");
    const topStalls = store.all(
      `SELECT s.id, s.name, COUNT(o.id) AS delivered_orders, COALESCE(SUM(o.total_cents),0) AS gross_cents,
         COALESCE(SUM(o.platform_fee_cents),0) AS fee_cents
       FROM stalls s LEFT JOIN orders o ON o.stall_id = s.id AND o.status = 'delivered'
         AND o.created_at >= ? AND o.created_at < ?
       GROUP BY s.id ORDER BY gross_cents DESC LIMIT 5`,
      [month.start, month.end]
    );
    const recentOrders = monthOrders.slice(0, 8).map((row) => ({
      id: row.id, code: row.code, stallName: store.get('SELECT name FROM stalls WHERE id = ?', [row.stall_id]).name,
      customerName: row.customer_name, status: row.status, totalCents: row.total_cents,
      localDateTime: time.fmtLocal(row.created_at, offset), isSample: Boolean(row.is_sample),
    }));
    const recentLogs = store.all('SELECT * FROM activity_logs ORDER BY id DESC LIMIT 8');
    return {
      stalls: {
        total: count('stalls'),
        occupied: count('stalls', "WHERE occupancy = 'occupied'"),
        available: count('stalls', "WHERE occupancy = 'available'"),
        byStatus: stalls,
      },
      users: { byRole: roleCounts },
      today: {
        orders: todayOrders.length,
        ...reports.computeTotals(todayOrders),
      },
      month: monthTotals,
      year: {
        completedSalesCents: yearTotals.completedSalesCents,
        refundsCents: yearTotals.refundsCents,
        platformFeesCents: yearTotals.platformFeesCents,
        netSalesCents: yearTotals.netSalesCents,
        orderCount: yearTotals.orderCount,
      },
      attention: { lowStock, flaggedReviews: flagged, newFeedback: feedbackNew, openTickets },
      topStalls: topStalls.map((row) => ({
        id: row.id, name: row.name, deliveredOrders: row.delivered_orders,
        grossCents: row.gross_cents, feeCents: row.fee_cents,
      })),
      recentOrders,
      recentLogs: recentLogs.map((row) => ({
        id: row.id, actorName: row.actor_name, actorRole: row.actor_role, action: row.action,
        details: row.details, localDateTime: time.fmtLocal(row.created_at, offset),
      })),
      providers: {
        email: config.smtp.configured,
        sms: config.sms.configured,
        smsProvider: config.sms.configured ? config.sms.provider : 'not configured',
      },
      timezone: config.timezoneLabel,
      sampleData: true,
    };
  });

  router.get('/api/admin/owners', (ctx) => {
    admin(ctx);
    const rows = store.all(
      `SELECT u.id, u.name, u.email, u.phone, u.role, u.status, u.stall_id, u.created_at, u.last_login_at,
        s.name AS stall_name
       FROM users u LEFT JOIN stalls s ON s.id = u.stall_id
       WHERE u.role = 'owner' ORDER BY u.id`
    );
    return { owners: rows.map(adminUserRow) };
  });

  router.patch('/api/admin/owners/:id', async (ctx) => {
    const actor = admin(ctx);
    const id = Number(ctx.params.id);
    const target = store.get("SELECT * FROM users WHERE id = ? AND role = 'owner'", [id]);
    if (!target) throw new ApiError(404, 'Stall owner not found.');
    const body = await ctx.body();
    const status = common.str(body.status, 20);
    if (!['active', 'deactivated'].includes(status)) throw new ApiError(400, 'Choose active or deactivated.', { field: 'status' });
    if (status === target.status) return { message: 'No change was needed.' };
    const now = new Date().toISOString();
    if (status === 'deactivated') {
      revokeSessionsFor(id);
      // Release the stall so it is available for a new owner registration.
      store.run('UPDATE users SET status = ?, stall_id = NULL, updated_at = ? WHERE id = ?', [status, now, id]);
      if (target.stall_id) {
        store.run("UPDATE stalls SET occupancy = 'available', updated_at = ? WHERE id = ?", [now, target.stall_id]);
      }
    } else {
      store.run('UPDATE users SET status = ?, updated_at = ? WHERE id = ?', [status, now, id]);
    }
    store.notifyUser(id, 'account_status', 'Account status updated', `Your owner account is now ${status}.`, '/portal/');
    store.logActivity({
      actor, action: 'owner.status', entityType: 'user', entityId: id,
      details: `${target.email}: ${target.status} → ${status}`, ip: http.clientIp(ctx.req),
    });
    return { message: `Owner account ${status === 'active' ? 'reactivated' : 'deactivated'}.` };
  });

  router.get('/api/admin/stalls', (ctx) => {
    admin(ctx);
    const rows = store.all(
      `SELECT s.*, u.id AS owner_id, u.name AS owner_name, u.email AS owner_email, u.status AS owner_status,
        (SELECT COUNT(*) FROM products p WHERE p.stall_id = s.id AND p.archived = 0) AS product_count,
        (SELECT COUNT(*) FROM orders o WHERE o.stall_id = s.id) AS order_count
       FROM stalls s LEFT JOIN users u ON u.stall_id = s.id AND u.role = 'owner'
       ORDER BY s.id`
    );
    return {
      stalls: rows.map((row) => ({
        ...common.mapStall(row),
        owner: row.owner_id ? { id: row.owner_id, name: row.owner_name, email: row.owner_email, status: row.owner_status } : null,
        productCount: row.product_count,
        orderCount: row.order_count,
      })),
    };
  });

  router.put('/api/admin/stalls/:id', async (ctx) => {
    const actor = admin(ctx);
    const id = Number(ctx.params.id);
    const stall = store.get('SELECT * FROM stalls WHERE id = ?', [id]);
    if (!stall) throw new ApiError(404, 'Stall not found.');
    const body = await ctx.body();
    const name = security.cleanName(body.name ?? stall.name, 80);
    if (name.length < 2) throw new ApiError(400, 'Enter a stall name.', { field: 'name' });
    const description = security.cleanText(body.description ?? stall.description, 600);
    const location = security.cleanText(body.location ?? stall.location, 120);
    const operatingStatus = common.str(body.operatingStatus ?? stall.operating_status, 30);
    if (!['open', 'closed', 'under_maintenance', 'inactive'].includes(operatingStatus)) {
      throw new ApiError(400, 'Choose a valid operating status.', { field: 'operatingStatus' });
    }
    let commissionPct = stall.commission_pct;
    if (body.commissionPct !== undefined) {
      if (body.commissionPct === null || body.commissionPct === '') commissionPct = null;
      else {
        const number = Number(body.commissionPct);
        if (!Number.isFinite(number) || number < 0 || number > 30) throw new ApiError(400, 'Stall commission must be between 0 and 30, or blank to use the platform default.', { field: 'commissionPct' });
        commissionPct = Math.round(number * 100) / 100;
      }
    }
    const contactEmail = body.contactEmail === undefined ? stall.contact_email : security.normalizeEmail(body.contactEmail);
    if (contactEmail && !security.isValidEmail(contactEmail)) throw new ApiError(400, 'Enter a valid stall email.', { field: 'contactEmail' });
    store.run(
      `UPDATE stalls SET name = ?, description = ?, location = ?, operating_status = ?, commission_pct = ?,
        contact_email = ?, updated_at = ? WHERE id = ?`,
      [name, description, location, operatingStatus, commissionPct, contactEmail, new Date().toISOString(), id]
    );
    if (stall.operating_status !== operatingStatus) {
      store.logActivity({
        actor, action: 'stall.status', entityType: 'stall', entityId: id,
        details: `${stall.name}: ${stall.operating_status} → ${operatingStatus}`, ip: http.clientIp(ctx.req),
      });
    }
    store.logActivity({ actor, action: 'stall.update', entityType: 'stall', entityId: id, details: 'Updated stall settings', ip: http.clientIp(ctx.req) });
    return { stall: common.mapStall(store.get('SELECT * FROM stalls WHERE id = ?', [id])), message: 'Stall updated.' };
  });

  router.get('/api/admin/users', (ctx) => {
    admin(ctx);
    const role = common.str(ctx.query.get('role'), 20);
    const params = [];
    let where = "u.role IN ('admin','operator')";
    if (role === 'admin' || role === 'operator') { where = 'u.role = ?'; params.push(role); }
    const rows = store.all(
      `SELECT u.*, NULL AS stall_name FROM users u WHERE ${where} ORDER BY u.role, u.id`,
      params
    );
    return { users: rows.map(adminUserRow) };
  });

  router.patch('/api/admin/users/:id', async (ctx) => {
    const actor = admin(ctx);
    const id = Number(ctx.params.id);
    const target = store.get('SELECT * FROM users WHERE id = ?', [id]);
    if (!target) throw new ApiError(404, 'User not found.');
    if (target.id === actor.id) throw new ApiError(400, 'You cannot change your own role or deactivate your own account.');
    if (target.role === 'owner') throw new ApiError(400, 'Owner accounts are managed from Stall Owner Management and keep their stall assignment.');
    const body = await ctx.body();
    const nextRole = body.role === undefined ? target.role : common.str(body.role, 20);
    const nextStatus = body.status === undefined ? target.status : common.str(body.status, 20);
    if (!['admin', 'operator'].includes(nextRole)) throw new ApiError(400, 'Staff roles can only be admin or operator.', { field: 'role' });
    if (!['active', 'deactivated'].includes(nextStatus)) throw new ApiError(400, 'Choose active or deactivated.', { field: 'status' });
    if (target.role === 'admin' && (nextRole !== 'admin' || nextStatus !== 'active')) {
      const activeAdmins = count('users', "WHERE role = 'admin' AND status = 'active'");
      if (activeAdmins <= 1) throw new ApiError(409, 'At least one active administrator must remain.');
    }
    store.run('UPDATE users SET role = ?, status = ?, stall_id = NULL, updated_at = ? WHERE id = ?', [nextRole, nextStatus, new Date().toISOString(), id]);
    if (target.role !== nextRole || target.status !== nextStatus) revokeSessionsFor(id);
    store.logActivity({
      actor, action: 'user.update', entityType: 'user', entityId: id,
      details: `${target.email}: ${target.role}/${target.status} → ${nextRole}/${nextStatus}`,
      ip: http.clientIp(ctx.req),
    });
    return { message: 'Staff account updated.' };
  });

  router.get('/api/admin/analytics', (ctx) => {
    admin(ctx);
    const range = rangeFor(ctx);
    const report = reports.buildReport({ db: store, offsetMinutes: config.timezoneOffsetMinutes, range, includeBreakdown: true });
    const deliveredOrders = store.all(
      `SELECT o.*, s.name AS stall_name, (SELECT COALESCE(SUM(qty),0) FROM order_items WHERE order_id = o.id) AS qty_sum
       FROM orders o JOIN stalls s ON s.id = o.stall_id
       WHERE o.status = 'delivered' AND o.created_at >= ? AND o.created_at < ?`,
      [range.start, range.end]
    );
    const seriesMap = new Map();
    for (const record of report.records) {
      if (!seriesMap.has(record.localDate)) seriesMap.set(record.localDate, { date: record.localDate, deliveredCents: 0, refundedCents: 0, orders: 0 });
      const point = seriesMap.get(record.localDate);
      if (record.status === 'delivered') { point.orders += 1; point.deliveredCents += record.totalCents; }
      if (record.status === 'refunded') point.refundedCents += record.totalCents;
    }
    const dailySeries = time.eachLocalDate(range.start, range.end, config.timezoneOffsetMinutes)
      .map((date) => seriesMap.get(date) || { date, deliveredCents: 0, refundedCents: 0, orders: 0 });
    const topProducts = store.all(
      `SELECT oi.product_name, oi.product_id, SUM(oi.qty) AS units, SUM(oi.line_total_cents) AS revenue,
         COUNT(DISTINCT oi.order_id) AS orders
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE o.status = 'delivered' AND o.created_at >= ? AND o.created_at < ?
       GROUP BY oi.product_id ORDER BY revenue DESC LIMIT 10`,
      [range.start, range.end]
    );
    const categories = store.all(
      `SELECT p.category, SUM(oi.qty) AS units, SUM(oi.line_total_cents) AS revenue
       FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
       WHERE o.status = 'delivered' AND o.created_at >= ? AND o.created_at < ?
       GROUP BY p.category ORDER BY revenue DESC`,
      [range.start, range.end]
    );
    const ratings = store.get(
      "SELECT COUNT(*) AS count, ROUND(AVG(rating),2) AS average FROM reviews WHERE status = 'published'"
    );
    return {
      range: report.range,
      totals: report.totals,
      breakdown: report.breakdown,
      dailySeries,
      topProducts: topProducts.map((row) => ({
        productId: row.product_id, name: row.product_name, units: row.units,
        revenueCents: row.revenue, orders: row.orders,
      })),
      categories: categories.map((row) => ({ category: row.category, units: row.units, revenueCents: row.revenue })),
      averageOrderCents: report.totals.deliveredCount ? Math.round(report.totals.completedSalesCents / report.totals.deliveredCount) : 0,
      ratings: { count: ratings.count, average: ratings.average === null ? null : Number(ratings.average) },
      notes: report.notes,
    };
  });

  router.get('/api/admin/reports', (ctx) => {
    const actor = admin(ctx);
    const range = rangeFor(ctx);
    const report = reports.buildReport({
      db: store, offsetMinutes: config.timezoneOffsetMinutes, range, includeBreakdown: true,
    });
    const token = reportTokens.store(report, { kind: 'admin', userId: actor.id, start: range.start, end: range.end });
    return { ...report, previewToken: token, previewExpiresInSeconds: 900 };
  });

  router.get('/api/admin/reports.csv', (ctx) => {
    const actor = admin(ctx);
    const range = rangeFor(ctx);
    const meta = { kind: 'admin', userId: actor.id, start: range.start, end: range.end };
    const preview = reportTokens.consume(ctx.query.get('preview'), meta);
    if (!preview) throw new ApiError(400, 'Preview this report before exporting it. The preview link expires after 15 minutes.');
    const csv = reports.buildReportCsv(preview);
    http.sendText(ctx.res, 200, csv, 'text/csv; charset=utf-8', {
      'Content-Disposition': `attachment; filename="skyworld-platform-${range.value.replace(/[^0-9A-Za-z-]+/g, '_')}.csv"`,
      'Cache-Control': 'no-store',
    });
    return undefined;
  });

  router.get('/api/admin/transactions', (ctx) => {
    admin(ctx);
    const range = rangeFor(ctx);
    return reports.salesHistory({
      db: store, offsetMinutes: config.timezoneOffsetMinutes, range,
      status: common.str(ctx.query.get('status'), 20), query: common.str(ctx.query.get('q'), 80), maxRows: 500,
    });
  });

  router.get('/api/admin/settings', (ctx) => {
    admin(ctx);
    const settings = store.getSettings();
    return {
      settings: {
        siteName: settings.site_name,
        supportEmail: settings.support_email,
        promoHint: settings.promo_hint,
        maintenanceMode: settings.maintenance_mode === '1',
        reviewFilterEnabled: settings.review_filter_enabled === '1',
        prohibitedWords: store.parseJson(settings.prohibited_words, []),
        demoMode: settings.demo_mode === '1',
        logoUrl: settings.logo_url || '',
        paymentLinks: {
          gcash: settings.payment_gcash_url || '',
          maya: settings.payment_maya_url || '',
          bank: settings.payment_bank_url || '',
        },
      },
      fees: {
        commissionPct: store.getSettingNumber('commission_pct', 5),
        shippingFeeCents: store.getSettingNumber('shipping_fee_cents', 4900),
        freeShippingThresholdCents: store.getSettingNumber('free_shipping_threshold_cents', 200000),
      },
      providers: {
        email: { configured: config.smtp.configured, source: config.smtp.source || 'none', from: config.smtp.configured ? config.smtp.from : '', host: config.smtp.configured ? config.smtp.host : '' },
        sms: { configured: config.sms.configured, source: config.sms.source || 'none', provider: config.sms.provider || 'not configured' },
      },
      timezone: config.timezoneLabel,
    };
  });

  router.put('/api/admin/settings', async (ctx) => {
    const actor = admin(ctx);
    const body = await ctx.body();
    const updates = [];
    if (body.siteName !== undefined) {
      const name = security.cleanName(body.siteName, 80);
      if (name.length < 2) throw new ApiError(400, 'Enter a site name.', { field: 'siteName' });
      updates.push(['site_name', name]);
    }
    if (body.supportEmail !== undefined) {
      const email = security.normalizeEmail(body.supportEmail);
      if (!security.isValidEmail(email)) throw new ApiError(400, 'Enter a valid support email.', { field: 'supportEmail' });
      updates.push(['support_email', email]);
    }
    if (body.promoHint !== undefined) updates.push(['promo_hint', security.cleanText(body.promoHint, 40).toUpperCase()]);
    if (body.maintenanceMode !== undefined) updates.push(['maintenance_mode', body.maintenanceMode ? '1' : '0']);
    if (body.reviewFilterEnabled !== undefined) updates.push(['review_filter_enabled', body.reviewFilterEnabled ? '1' : '0']);
    if (body.prohibitedWords !== undefined) {
      const words = parseWords(body.prohibitedWords);
      if (!words.length) throw new ApiError(400, 'Keep at least one prohibited word, or turn the filter off instead.', { field: 'prohibitedWords' });
      updates.push(['prohibited_words', JSON.stringify(words)]);
    }
    if (body.logoUrl !== undefined) {
      const logo = typeof body.logoUrl === 'string' ? body.logoUrl.trim() : '';
      if (logo && !security.isSafeImageUrl(logo)) {
        throw new ApiError(400, 'Upload a valid logo image, or reset to the default logo.', { field: 'logoUrl' });
      }
      updates.push(['logo_url', logo]);
    }
    if (body.paymentLinks !== undefined) {
      if (!body.paymentLinks || typeof body.paymentLinks !== 'object') {
        throw new ApiError(400, 'Send payment page links as an object.', { field: 'paymentLinks' });
      }
      for (const [key, setting, field] of [['gcash', 'payment_gcash_url', 'paymentGcash'], ['maya', 'payment_maya_url', 'paymentMaya'], ['bank', 'payment_bank_url', 'paymentBank']]) {
        if (body.paymentLinks[key] === undefined) continue;
        const link = typeof body.paymentLinks[key] === 'string' ? body.paymentLinks[key].trim() : '';
        if (!security.isSafePaymentUrl(link)) {
          throw new ApiError(400, 'Payment page links must start with https:// and cannot contain credentials.', { field });
        }
        updates.push([setting, link]);
      }
    }
    store.tx(() => {
      for (const [key, value] of updates) store.setSetting(key, value);
      store.logActivity({
        actor, action: 'settings.update', entityType: 'settings', entityId: '',
        details: updates.map(([key]) => key).join(', ') || 'No changes', ip: http.clientIp(ctx.req),
      });
    });
    return { message: 'Platform settings saved.', settings: store.getSettings() };
  });

  router.get('/api/admin/delivery', (ctx) => {
    admin(ctx);
    return {
      ...providers.status(),
      permissions: { canEdit: true },
      hints: [
        'Gmail requires an App Password, not your normal Google password. Enable 2-Step Verification, then create an App Password for Mail.',
        'Semaphore needs an API key from semaphore.co. Twilio needs an Account SID, Auth Token, and a sender number.',
        'Credentials saved here are stored on the server in data/providers.json and are never returned to the browser.',
      ],
    };
  });

  router.put('/api/admin/delivery', async (ctx) => {
    const actor = admin(ctx);
    const body = await ctx.body();
    try {
      providers.save(body || {});
    } catch (error) {
      throw new ApiError(400, error.message || 'Enter valid delivery provider details.');
    }
    const status = providers.status();
    store.logActivity({
      actor,
      action: 'settings.delivery',
      entityType: 'settings',
      entityId: 'delivery',
      details: `Email: ${status.email.configured ? 'configured' : 'not configured'} (${status.email.source}); SMS: ${status.sms.configured ? 'configured' : 'not configured'} (${status.sms.source})`,
      ip: http.clientIp(ctx.req),
    });
    return { message: 'Delivery provider settings saved. New verification codes will use them immediately.', ...status };
  });

  router.post('/api/admin/providers/test', async (ctx) => {
    const actor = admin(ctx);
    const body = await ctx.body();
    const channel = body.channel === 'email' ? 'email' : body.channel === 'sms' ? 'sms' : '';
    if (!channel) throw new ApiError(400, 'Choose email or SMS to test.', { field: 'channel' });
    let result;
    if (channel === 'email') {
      if (!config.smtp.configured) throw new ApiError(400, 'Email delivery is not configured. Add an SMTP provider under Admin → Settings → Delivery providers, then try again.');
      result = await mailer.sendSmtp({
        to: actor.email,
        subject: 'SkyWorld Stall delivery test',
        text: `Hello ${actor.name}, this is a test message from your SkyWorld Stall server. If you received it, password recovery codes can be delivered to registered email addresses.`,
        html: `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#FAF4E8;border-radius:16px;color:#3A2A1C"><h2 style="color:#6F5236">Delivery test</h2><p>Hello ${escapeHtml(actor.name)},</p><p>This is a test message from your SkyWorld Stall server. If you received it, password recovery codes can be delivered to registered email addresses.</p><p style="font-size:13px;color:#7A6650">Sent by an administrator from the System Settings page.</p></div>`,
      });
    } else {
      if (!config.sms.configured) throw new ApiError(400, 'SMS delivery is not configured. Add a Semaphore, Twilio, or webhook provider under Admin → Settings → Delivery providers, then try again.');
      result = await sms.sendSms(actor.phone, 'SkyWorld Stall: this is a delivery test. If you received it, SMS verification and order alerts can be delivered.');
    }
    const sent = Boolean(result.sent);
    store.logActivity({
      actor,
      action: 'settings.provider_test',
      entityType: 'settings',
      entityId: channel,
      details: `${channel} test ${sent ? 'delivered' : 'failed'}${result.reason ? ` (${result.reason})` : ''}`,
      ip: http.clientIp(ctx.req),
    });
    return {
      channel,
      sent,
      provider: result.provider || (channel === 'email' ? 'smtp' : config.sms.provider),
      message: sent
        ? `Test ${channel === 'email' ? 'email' : 'SMS'} sent to your registered ${channel === 'email' ? 'email address' : 'mobile number'}.`
        : `The provider did not accept the test ${channel === 'email' ? 'email' : 'SMS'}. Check the server logs and credentials.`,
    };
  });

  router.get('/api/admin/fees', (ctx) => {
    admin(ctx);
    return {
      commissionPct: store.getSettingNumber('commission_pct', 5),
      shippingFeeCents: store.getSettingNumber('shipping_fee_cents', 4900),
      freeShippingThresholdCents: store.getSettingNumber('free_shipping_threshold_cents', 200000),
      stallOverrides: store.all('SELECT id, name, commission_pct FROM stalls WHERE commission_pct IS NOT NULL ORDER BY id'),
      notes: ['The platform fee is calculated on the discounted subtotal, excluding shipping.', 'Per-stall overrides take precedence over the platform rate.'],
    };
  });

  router.put('/api/admin/fees', async (ctx) => {
    const actor = admin(ctx);
    const body = await ctx.body();
    const commission = Number(body.commissionPct);
    if (!Number.isFinite(commission) || commission < 0 || commission > 30) throw new ApiError(400, 'Commission must be between 0 and 30 percent.', { field: 'commissionPct' });
    const shipping = security.parseMoneyToCents(body.shippingFee, 100000);
    if (shipping === null) throw new ApiError(400, 'Enter a valid shipping fee such as 49.00.', { field: 'shippingFee' });
    const threshold = security.parseMoneyToCents(body.freeShippingThreshold, 10000000);
    if (threshold === null) throw new ApiError(400, 'Enter a valid free-shipping threshold such as 2000.00.', { field: 'freeShippingThreshold' });
    if (threshold < shipping) throw new ApiError(400, 'The free-shipping threshold should be at least the shipping fee.', { field: 'freeShippingThreshold' });
    store.tx(() => {
      store.setSetting('commission_pct', String(commission));
      store.setSetting('shipping_fee_cents', String(shipping));
      store.setSetting('free_shipping_threshold_cents', String(threshold));
      store.logActivity({
        actor, action: 'settings.fees', entityType: 'settings', entityId: '',
        details: `Commission ${commission}% · shipping ₱${(shipping / 100).toFixed(2)} · free over ₱${(threshold / 100).toFixed(2)}`,
        ip: http.clientIp(ctx.req),
      });
    });
    return { message: 'Commission and fee settings saved.' };
  });

  router.get('/api/admin/reviews', (ctx) => {
    admin(ctx);
    const status = common.str(ctx.query.get('status'), 20) || 'flagged';
    const params = [];
    let where = '';
    if (status !== 'all') { where = 'WHERE r.status = ?'; params.push(status); }
    const rows = store.all(
      `SELECT r.*, p.name AS product_name, s.name AS stall_name
       FROM reviews r JOIN products p ON p.id = r.product_id JOIN stalls s ON s.id = r.stall_id
       ${where} ORDER BY r.created_at DESC LIMIT 200`,
      params
    );
    return {
      reviews: rows.map((row) => ({
        id: row.id, productId: row.product_id, productName: row.product_name, stallName: row.stall_name,
        customerName: row.customer_name, rating: row.rating, comment: row.comment, status: row.status,
        flagReason: row.flag_reason, ownerReply: row.owner_reply, createdAt: row.created_at,
        localDateTime: time.fmtLocal(row.created_at, config.timezoneOffsetMinutes),
      })),
      counts: {
        flagged: count('reviews', "WHERE status = 'flagged'"),
        published: count('reviews', "WHERE status = 'published'"),
        rejected: count('reviews', "WHERE status = 'rejected'"),
      },
    };
  });

  router.patch('/api/admin/reviews/:id', async (ctx) => {
    const actor = admin(ctx);
    const id = Number(ctx.params.id);
    const review = store.get('SELECT * FROM reviews WHERE id = ?', [id]);
    if (!review) throw new ApiError(404, 'Review not found.');
    const body = await ctx.body();
    const action = common.str(body.action, 20);
    if (!['approve', 'reject'].includes(action)) throw new ApiError(400, 'Choose approve or reject.', { field: 'action' });
    const status = action === 'approve' ? 'published' : 'rejected';
    store.run('UPDATE reviews SET status = ? WHERE id = ?', [status, id]);
    store.logActivity({
      actor, action: `review.${action}`, entityType: 'review', entityId: id,
      details: `${review.customer_name} / rating ${review.rating}: ${review.flag_reason || 'manual moderation'}`,
      ip: http.clientIp(ctx.req),
    });
    const owner = store.get("SELECT id FROM users WHERE role = 'owner' AND stall_id = ?", [review.stall_id]);
    if (owner) store.notifyUser(owner.id, 'review_moderated', 'Review moderation update', `A review was ${action === 'approve' ? 'published' : 'rejected'} by the platform team.`, '/owner/#reviews');
    return { message: action === 'approve' ? 'Review approved and published.' : 'Review rejected and hidden.' };
  });

  router.get('/api/admin/feedback', (ctx) => {
    admin(ctx);
    const status = common.str(ctx.query.get('status'), 20);
    const params = [];
    let where = '';
    if (status) { where = 'WHERE status = ?'; params.push(status); }
    const rows = store.all(`SELECT * FROM feedback ${where} ORDER BY created_at DESC LIMIT 200`, params);
    return {
      feedback: rows.map((row) => ({
        id: row.id, name: row.name, contact: row.contact, subject: row.subject, message: row.message,
        status: row.status, isSample: Boolean(row.is_sample), createdAt: row.created_at,
        localDateTime: time.fmtLocal(row.created_at, config.timezoneOffsetMinutes),
      })),
      counts: {
        new: count('feedback', "WHERE status = 'new'"),
        reviewed: count('feedback', "WHERE status = 'reviewed'"),
        resolved: count('feedback', "WHERE status = 'resolved'"),
      },
    };
  });

  router.patch('/api/admin/feedback/:id', async (ctx) => {
    const actor = admin(ctx);
    const id = Number(ctx.params.id);
    const row = store.get('SELECT * FROM feedback WHERE id = ?', [id]);
    if (!row) throw new ApiError(404, 'Feedback not found.');
    const body = await ctx.body();
    const status = common.str(body.status, 20);
    if (!['new', 'reviewed', 'resolved'].includes(status)) throw new ApiError(400, 'Choose a valid feedback status.', { field: 'status' });
    store.run('UPDATE feedback SET status = ? WHERE id = ?', [status, id]);
    store.logActivity({ actor, action: 'feedback.status', entityType: 'feedback', entityId: id, details: `${row.status} → ${status}`, ip: http.clientIp(ctx.req) });
    return { message: 'Feedback updated.' };
  });

  router.get('/api/admin/logs', (ctx) => {
    admin(ctx);
    const params = [];
    const where = [];
    const role = common.str(ctx.query.get('role'), 20);
    if (role) { where.push('actor_role = ?'); params.push(role); }
    const query = common.str(ctx.query.get('q'), 80);
    if (query) {
      where.push('(actor_name LIKE ? OR action LIKE ? OR details LIKE ? OR entity_id LIKE ?)');
      params.push(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`);
    }
    const limit = http.numberParam(ctx.query.get('limit'), 100, 1, 300);
    const rows = store.all(
      `SELECT * FROM activity_logs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`,
      [...params, limit]
    );
    return {
      logs: rows.map((row) => ({
        id: row.id, actorName: row.actor_name, actorRole: row.actor_role, action: row.action,
        entityType: row.entity_type, entityId: row.entity_id, details: row.details, ip: row.ip,
        isSample: Boolean(row.is_sample), createdAt: row.created_at,
        localDateTime: time.fmtLocal(row.created_at, config.timezoneOffsetMinutes),
      })),
    };
  });

  router.get('/api/admin/archives', (ctx) => {
    admin(ctx);
    const products = store.all(
      `SELECT p.*, s.name AS stall_name FROM products p JOIN stalls s ON s.id = p.stall_id
       WHERE p.archived = 1 ORDER BY p.updated_at DESC LIMIT 200`
    );
    const orders = store.all(
      `SELECT o.*, s.name AS stall_name FROM orders o JOIN stalls s ON s.id = o.stall_id
       WHERE o.status IN ('cancelled','refunded') ORDER BY o.created_at DESC LIMIT 200`
    );
    const users = store.all(
      "SELECT u.*, s.name AS stall_name FROM users u LEFT JOIN stalls s ON s.id = u.stall_id WHERE u.status = 'deactivated' ORDER BY u.updated_at DESC"
    );
    return {
      products: products.map((row) => ({ ...common.mapProduct(row), stallName: row.stall_name })),
      orders: orders.map((row) => ({
        id: row.id, code: row.code, stallName: row.stall_name, customerName: row.customer_name,
        status: row.status, totalCents: row.total_cents, isSample: Boolean(row.is_sample),
        localDateTime: time.fmtLocal(row.created_at, config.timezoneOffsetMinutes),
      })),
      users: users.map(adminUserRow),
      notes: ['Archived records are retained for audit and order history. Nothing here is counted as an active listing.'],
    };
  });

  router.get('/api/admin/backup', (ctx) => {
    const actor = admin(ctx);
    const tables = {};
    for (const table of BACKUP_TABLES) tables[table] = store.all(`SELECT * FROM ${table}`);
    const payload = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      generatedAt: new Date().toISOString(),
      generator: 'SkyWorld Stall',
      warnings: ['This backup contains hashed passwords and customer order data. Store it securely and never share it.'],
      tables,
    };
    store.logActivity({ actor, action: 'system.backup', entityType: 'system', entityId: '', details: `Backup downloaded (${BACKUP_TABLES.length} tables)`, ip: http.clientIp(ctx.req) });
    const json = JSON.stringify(payload);
    http.sendText(ctx.res, 200, json, 'application/json; charset=utf-8', {
      'Content-Disposition': `attachment; filename="skyworld-backup-${new Date().toISOString().slice(0, 10)}.json"`,
      'Cache-Control': 'no-store',
    });
    return undefined;
  });

  router.post('/api/admin/restore', async (ctx) => {
    const actor = admin(ctx);
    const body = await ctx.body(config.maxBackupBytes);
    if (body.confirm !== 'RESTORE') throw new ApiError(400, 'Type RESTORE to confirm replacing the current database.');
    const backup = body.backup;
    confirmRestoreBackup(backup);
    const now = new Date().toISOString();
    store.tx(() => {
      const deleteOrder = [
        'tickets', 'visits', 'reviews', 'order_items', 'orders', 'suppliers', 'notifications',
        'activity_logs', 'feedback', 'products', 'vouchers', 'users', 'stalls', 'settings',
      ];
      for (const table of deleteOrder) store.run(`DELETE FROM ${table}`);
      const insertOrder = [
        'stalls', 'settings', 'users', 'vouchers', 'products', 'orders', 'order_items', 'reviews',
        'notifications', 'suppliers', 'feedback', 'tickets', 'visits', 'activity_logs',
      ];
      for (const table of insertOrder) {
        const rows = backup.tables[table] || [];
        if (!rows.length) continue;
        const columns = store.all(`PRAGMA table_info(${table})`).map((column) => column.name);
        for (const row of rows) {
          const keys = Object.keys(row).filter((key) => columns.includes(key));
          if (!keys.length) continue;
          const placeholders = keys.map(() => '?').join(', ');
          store.run(
            `INSERT INTO ${table}(${keys.join(', ')}) VALUES (${placeholders})`,
            keys.map((key) => (row[key] === null ? null : typeof row[key] === 'object' ? JSON.stringify(row[key]) : row[key]))
          );
        }
      }
      const backupAdmins = store.get("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND status = 'active'").count;
      if (!backupAdmins) throw new ApiError(400, 'The backup has no active administrator. Restore aborted.');
      store.run(`INSERT INTO activity_logs(actor_id, actor_role, actor_name, action, entity_type, entity_id, details, ip, is_sample, created_at)
                 VALUES (NULL, 'admin', ?, 'system.restore', 'system', '', 'Database restored from uploaded backup; all sessions revoked', ?, 0, ?)`,
        [actor.name, http.clientIp(ctx.req), now]);
      store.run('DELETE FROM sessions');
    });
    return { message: 'Backup restored. All sessions were revoked; sign in again.', reauth: true };
  });

  router.get('/api/admin/security', (ctx) => {
    const actor = admin(ctx);
    const sessions = store.all(
      `SELECT se.created_at, se.expires_at, se.ip, se.user_agent, u.id AS user_id, u.name, u.email, u.role
       FROM sessions se JOIN users u ON u.id = se.user_id
       WHERE se.expires_at > ? ORDER BY se.created_at DESC LIMIT 200`,
      [new Date().toISOString()]
    );
    const resets = store.get(
      "SELECT COUNT(*) AS count FROM password_resets WHERE created_at >= ?",
      [new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()]
    );
    return {
      passwordPolicy: {
        minLength: 8, maxLength: 20, groupsRequired: 3,
        hashing: 'scrypt (N=16384, r=8, p=1) with a random per-password salt',
        resetCodeTtlMinutes: 15,
      },
      sessions: sessions.map((row) => ({
        userId: row.user_id, name: row.name, email: row.email, role: row.role,
        ip: row.ip, userAgent: row.user_agent, createdAt: row.created_at, expiresAt: row.expires_at,
      })),
      resetRequestsLast24h: resets.count,
      providers: { email: config.smtp.configured, sms: config.sms.configured },
      notes: [
        'Password hashes and reset codes are never exposed through this page or the API.',
        'Administrators cannot impersonate owners or view owner passwords.',
        'Revoking sessions signs the selected account out on every device.',
      ],
      currentUserId: actor.id,
    };
  });

  router.post('/api/admin/security/revoke', async (ctx) => {
    const actor = admin(ctx);
    const body = await ctx.body();
    const userId = Number(body.userId);
    if (!Number.isInteger(userId) || userId <= 0) throw new ApiError(400, 'Choose a user.', { field: 'userId' });
    if (userId === actor.id) throw new ApiError(400, 'To end your own session, use Sign out.');
    const user = store.get('SELECT id, name, email FROM users WHERE id = ?', [userId]);
    if (!user) throw new ApiError(404, 'User not found.');
    const before = count('sessions', 'WHERE user_id = ?', [userId]);
    revokeSessionsFor(userId);
    store.logActivity({ actor, action: 'security.revoke_sessions', entityType: 'user', entityId: userId, details: `${user.email}: ${before} session(s) revoked`, ip: http.clientIp(ctx.req) });
    return { message: `${before} session${before === 1 ? '' : 's'} revoked for ${user.email}.` };
  });
}

module.exports = { registerRoutes };
