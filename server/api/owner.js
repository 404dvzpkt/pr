'use strict';

const config = require('../config');
const store = require('../db');
const security = require('../security');
const auth = require('../auth');
const http = require('../http');
const time = require('../time');
const reports = require('../reports');
const reportTokens = require('../reportTokens');
const { ApiError } = require('../errors');
const common = require('./common');

const PRODUCT_CATEGORIES = ['Clothes', 'Shoes', 'Bags', 'Jackets', 'Accessories', 'Random'];
const OWNER_STATUSES = ['open', 'closed'];

function owner(ctx) {
  const user = auth.requireUser(ctx, ['owner']);
  const stall = auth.ownerStall(user);
  return { user, stall };
}

function rangeFor(ctx) {
  return common.resolveRange(ctx.query, config.timezoneOffsetMinutes);
}

function loadOrders(stallId, range) {
  return store.all(
    `SELECT o.*, (SELECT COALESCE(SUM(qty),0) FROM order_items WHERE order_id = o.id) AS qty_sum
     FROM orders o WHERE o.stall_id = ? AND o.created_at >= ? AND o.created_at < ?
     ORDER BY o.created_at DESC`,
    [stallId, range.start, range.end]
  );
}

function briefOrder(row) {
  return {
    id: row.id,
    code: row.code,
    customerName: row.customer_name,
    status: row.status,
    paymentStatus: row.payment_status,
    paymentMethod: row.payment_method,
    totalCents: row.total_cents,
    quantity: Number(row.qty_sum || 0),
    localDateTime: time.fmtLocal(row.created_at, config.timezoneOffsetMinutes),
    createdAt: row.created_at,
    isSample: Boolean(row.is_sample),
  };
}

function cleanUploadList(raw, max = 8) {
  if (!Array.isArray(raw)) return [];
  const values = [];
  for (const entry of raw.slice(0, max)) {
    if (!security.isSafeImageUrl(entry)) throw new ApiError(400, 'One of the image links is not a valid upload.', { field: 'images' });
    if (!values.includes(entry)) values.push(entry);
  }
  return values;
}

function cleanColors(raw, images) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > 8) throw new ApiError(400, 'Add at most 8 colours.', { field: 'colors' });
  const seen = new Set();
  return raw.map((entry) => {
    const name = security.cleanName(entry && entry.name, 40);
    if (!name) throw new ApiError(400, 'Every colour needs a name.', { field: 'colors' });
    if (seen.has(name.toLowerCase())) throw new ApiError(400, `The colour “${name}” appears twice.`, { field: 'colors' });
    seen.add(name.toLowerCase());
    const hex = security.isSafeColorHex(entry && entry.hex) ? entry.hex : '#B79A76';
    let image = '';
    if (entry && entry.image) {
      if (!security.isSafeImageUrl(entry.image)) throw new ApiError(400, `The colour image for “${name}” is not a valid upload.`, { field: 'colors' });
      image = entry.image;
    }
    return { name, hex, image: image || images[0] || '' };
  });
}

function cleanSizes(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > 12) throw new ApiError(400, 'Add at most 12 sizes.', { field: 'sizes' });
  const sizes = [];
  for (const entry of raw) {
    const size = security.cleanText(entry, 20);
    if (!size) continue;
    if (!sizes.includes(size)) sizes.push(size);
  }
  return sizes;
}

function productPayload(body, existing = null) {
  const images = body.images === undefined && existing ? store.parseJson(existing.images, []) : cleanUploadList(body.images);
  if (!images.length) throw new ApiError(400, 'Upload at least one product image before saving.', { field: 'images' });
  const name = security.cleanName(body.name ?? (existing && existing.name), 100);
  if (name.length < 2) throw new ApiError(400, 'Enter a product name.', { field: 'name' });
  const description = security.cleanText(body.description ?? (existing && existing.description), 2000);
  const category = common.str(body.category ?? (existing && existing.category), 40);
  if (!PRODUCT_CATEGORIES.includes(category)) throw new ApiError(400, 'Choose a product category.', { field: 'category' });
  const priceCents = body.price !== undefined
    ? security.parseMoneyToCents(body.price, 50000000)
    : body.priceCents !== undefined
      ? (Number.isInteger(Number(body.priceCents)) && Number(body.priceCents) >= 1 ? Number(body.priceCents) : null)
      : existing
        ? existing.price_cents
        : null;
  if (priceCents === null || priceCents < 1) throw new ApiError(400, 'Enter a valid price such as 149.50.', { field: 'price' });
  const discountPct = common.clampInt(body.discountPct ?? (existing && existing.discount_pct) ?? 0, 0, 90, 0);
  const stock = common.clampInt(body.stock ?? (existing && existing.stock) ?? 0, 0, 100000, 0);
  const colors = body.colors === undefined && existing
    ? store.parseJson(existing.colors, [])
    : cleanColors(body.colors, images);
  const sizes = body.sizes === undefined && existing
    ? store.parseJson(existing.sizes, [])
    : cleanSizes(body.sizes);
  const sku = security.cleanText(body.sku ?? (existing && existing.sku), 40);
  const featured = body.featured === undefined ? Boolean(existing && existing.featured) : Boolean(body.featured);
  return { name, description, category, priceCents, discountPct, stock, colors, sizes, images, sku, featured };
}

function flashReport(ctx, report, meta) {
  const token = reportTokens.store(report, meta);
  return {
    ...report,
    previewToken: token,
    previewExpiresInSeconds: 900,
  };
}

function optionalLeaseDate(value, label, field) {
  const text = security.cleanText(value, 10);
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new ApiError(400, `${label} must be a valid date.`, { field });
  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new ApiError(400, `${label} must be a valid date.`, { field });
  }
  return text;
}

function optionalLeaseRent(value) {
  if (value === '' || value === null || value === undefined) return null;
  const cents = security.parseMoneyToCents(value, 100000000);
  if (cents === null) throw new ApiError(400, 'Enter a valid monthly rent such as 18000.00, or leave it blank.', { field: 'leaseRent' });
  return cents;
}

function optionalLeaseArea(value) {
  const text = security.cleanText(value, 10);
  if (!text) return null;
  if (!/^\d{1,4}(?:\.\d{1,2})?$/.test(text)) throw new ApiError(400, 'Enter a valid floor area in square metres.', { field: 'leaseAreaSqm' });
  const area = Number(text);
  if (!Number.isFinite(area) || area <= 0 || area > 1000) throw new ApiError(400, 'Floor area must be between 0 and 1,000 sqm.', { field: 'leaseAreaSqm' });
  return text;
}

function registerRoutes(router) {
  router.get('/api/owner/overview', (ctx) => {
    const { user, stall } = owner(ctx);
    const offset = config.timezoneOffsetMinutes;
    const today = time.periodRange('daily', null, offset);
    const month = time.periodRange('monthly', null, offset);
    const year = time.periodRange('annual', null, offset);
    const last30 = { start: new Date(Date.parse(today.start) - 29 * time.DAY).toISOString(), end: today.end };
    const todayTotals = reports.computeTotals(loadOrders(stall.id, today));
    const monthTotals = reports.computeTotals(loadOrders(stall.id, month));
    const yearTotals = reports.computeTotals(loadOrders(stall.id, year));
    const pending = store.get(
      `SELECT COUNT(*) AS count, COALESCE(SUM(total_cents),0) AS value FROM orders
       WHERE stall_id = ? AND status IN ('pending','confirmed','shipped')`,
      [stall.id]
    );
    const stock = store.get(
      `SELECT COUNT(*) AS active,
        COALESCE(SUM(CASE WHEN stock = 0 THEN 1 ELSE 0 END),0) AS out_of_stock,
        COALESCE(SUM(CASE WHEN stock > 0 AND stock <= 10 THEN 1 ELSE 0 END),0) AS low_stock
       FROM products WHERE stall_id = ? AND archived = 0`,
      [stall.id]
    );
    const recent = store.all(
      `SELECT o.*, (SELECT COALESCE(SUM(qty),0) FROM order_items WHERE order_id = o.id) AS qty_sum
       FROM orders o WHERE o.stall_id = ? ORDER BY o.created_at DESC LIMIT 6`,
      [stall.id]
    );
    const reviews = store.get(
      `SELECT COUNT(*) AS total,
        ROUND(AVG(CASE WHEN status = 'published' THEN rating END), 1) AS average,
        COALESCE(SUM(CASE WHEN status = 'published' AND owner_reply = '' THEN 1 ELSE 0 END),0) AS unanswered,
        COALESCE(SUM(CASE WHEN status = 'flagged' THEN 1 ELSE 0 END),0) AS held
       FROM reviews WHERE stall_id = ?`,
      [stall.id]
    );
    const unread = store.get('SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND is_read = 0', [user.id]);
    const topProducts = store.all(
      `SELECT oi.product_name, SUM(oi.qty) AS units, SUM(oi.line_total_cents) AS revenue
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE o.stall_id = ? AND o.status = 'delivered' AND o.created_at >= ? AND o.created_at < ?
       GROUP BY oi.product_id ORDER BY revenue DESC LIMIT 5`,
      [stall.id, last30.start, last30.end]
    );
    const recentReviewRows = store.all(
      `SELECT r.*, p.name AS product_name FROM reviews r JOIN products p ON p.id = r.product_id
       WHERE r.stall_id = ? AND r.status = 'published' ORDER BY r.created_at DESC LIMIT 3`,
      [stall.id]
    );
    return {
      stall: common.mapStall(stall),
      owner: { name: user.name, email: user.email, phone: user.phone },
      today: { ...todayTotals, pendingOrders: pending.count, pendingValueCents: pending.value },
      month: monthTotals,
      year: yearTotals,
      pending: { count: pending.count, valueCents: pending.value },
      stock: { active: stock.active, outOfStock: stock.out_of_stock, lowStock: stock.low_stock },
      recentOrders: recent.map(briefOrder),
      reviews: {
        total: reviews.total,
        average: reviews.average === null ? null : Number(reviews.average),
        unanswered: reviews.unanswered,
        held: reviews.held,
        recent: recentReviewRows.map((row) => ({
          id: row.id,
          productName: row.product_name,
          customerName: row.customer_name,
          rating: row.rating,
          comment: row.comment,
          createdAt: row.created_at,
          localDate: time.fmtLocal(row.created_at, offset, { dateOnly: true }),
        })),
      },
      topProducts: topProducts.map((row) => ({ name: row.product_name, units: row.units, revenueCents: row.revenue })),
      unreadNotifications: unread.count,
      sampleOrdersThisMonth: monthTotals.sampleOrderCount,
      timezone: config.timezoneLabel,
    };
  });

  router.get('/api/owner/stall', (ctx) => {
    const { stall } = owner(ctx);
    const ownerUser = store.get("SELECT name, email, phone FROM users WHERE stall_id = ? AND role = 'owner'", [stall.id]);
    return {
      stall: common.mapStall(stall),
      owner: ownerUser || null,
      platformCommissionPct: store.getSettingNumber('commission_pct', 5),
    };
  });

  router.put('/api/owner/stall', async (ctx) => {
    const { user, stall } = owner(ctx);
    const body = await ctx.body();
    const name = security.cleanName(body.name ?? stall.name, 80);
    if (name.length < 2) throw new ApiError(400, 'Enter a stall name.', { field: 'name' });
    const description = security.cleanText(body.description ?? stall.description, 600);
    const location = security.cleanText(body.location ?? stall.location, 120);
    const coverImage = body.coverImage === undefined ? stall.cover_image
      : security.isSafeImageUrl(body.coverImage) ? body.coverImage : null;
    if (coverImage === null) throw new ApiError(400, 'Upload a valid cover image.', { field: 'coverImage' });
    const profileImage = body.profileImage === undefined ? stall.profile_image
      : body.profileImage === '' ? '' : security.isSafeImageUrl(body.profileImage) ? body.profileImage : null;
    if (profileImage === null) throw new ApiError(400, 'Upload a valid profile image.', { field: 'profileImage' });
    const gallery = body.gallery === undefined ? store.parseJson(stall.gallery, []) : cleanUploadList(body.gallery);
    const contactPhone = body.contactPhone === undefined ? stall.contact_phone : security.normalizePhone(body.contactPhone);
    const contactEmail = body.contactEmail === undefined ? stall.contact_email : security.normalizeEmail(body.contactEmail);
    if (body.contactPhone !== undefined && !contactPhone) throw new ApiError(400, 'Enter a valid stall phone number.', { field: 'contactPhone' });
    if (contactEmail && !security.isValidEmail(contactEmail)) throw new ApiError(400, 'Enter a valid stall email.', { field: 'contactEmail' });
    const operatingStatus = body.operatingStatus === undefined ? stall.operating_status : common.str(body.operatingStatus, 30);
    if (!OWNER_STATUSES.includes(operatingStatus)) throw new ApiError(403, 'Owners can set a stall to Open or Closed only. Maintenance and inactive statuses are set by platform staff.', { field: 'operatingStatus' });

    let commissionPct = stall.commission_pct;
    if (body.commissionPct !== undefined) {
      if (body.commissionPct === '' || body.commissionPct === null) {
        commissionPct = null;
      } else {
        const parsed = Number(body.commissionPct);
        if (!Number.isInteger(parsed) || parsed < 0 || parsed > 30) {
          throw new ApiError(400, 'Commission must be a whole number between 0 and 30 percent, or blank for the platform rate.', { field: 'commissionPct' });
        }
        commissionPct = parsed;
      }
    }

    const leaseEdited = ['leaseStart', 'leaseEnd', 'leaseRent', 'leaseAreaSqm', 'leaseNote'].some((key) => body[key] !== undefined);
    const leaseStart = body.leaseStart === undefined ? stall.lease_start : optionalLeaseDate(body.leaseStart, 'Lease start', 'leaseStart');
    const leaseEnd = body.leaseEnd === undefined ? stall.lease_end : optionalLeaseDate(body.leaseEnd, 'Lease end', 'leaseEnd');
    const leaseRent = body.leaseRent === undefined ? stall.lease_rent_cents : optionalLeaseRent(body.leaseRent);
    const leaseArea = body.leaseAreaSqm === undefined ? stall.lease_area_sqm : optionalLeaseArea(body.leaseAreaSqm);
    const leaseNote = body.leaseNote === undefined ? stall.lease_note : security.cleanText(body.leaseNote, 300);
    if (leaseStart && leaseEnd && leaseEnd < leaseStart) {
      throw new ApiError(400, 'The lease end date must be on or after the lease start date.', { field: 'leaseEnd' });
    }

    store.run(
      `UPDATE stalls SET name = ?, description = ?, location = ?, cover_image = ?, profile_image = ?, gallery = ?,
        contact_phone = ?, contact_email = ?, operating_status = ?, commission_pct = ?, lease_start = ?, lease_end = ?,
        lease_rent_cents = ?, lease_area_sqm = ?, lease_is_sample = ?, lease_note = ?, updated_at = ? WHERE id = ?`,
      [name, description, location, coverImage, profileImage, JSON.stringify(gallery), contactPhone, contactEmail, operatingStatus,
        commissionPct, leaseStart, leaseEnd, leaseRent, leaseArea, leaseEdited ? 0 : stall.lease_is_sample, leaseNote,
        new Date().toISOString(), stall.id]
    );
    const changed = [];
    if (leaseEdited) changed.push('lease terms');
    if (body.commissionPct !== undefined) changed.push('commission');
    store.logActivity({
      actor: user, action: 'stall.profile_update', entityType: 'stall', entityId: stall.id,
      details: `Updated stall profile (${operatingStatus})${changed.length ? ' · ' + changed.join(' and ') : ''}`,
      ip: http.clientIp(ctx.req),
    });
    return {
      stall: common.mapStall(store.get('SELECT * FROM stalls WHERE id = ?', [stall.id])),
      message: changed.length ? 'Stall profile, lease, and commission saved.' : 'Stall profile saved.',
    };
  });

  router.get('/api/owner/products', (ctx) => {
    const { stall } = owner(ctx);
    const includeArchived = ctx.query.get('includeArchived') === '1';
    const rows = store.all(
      `SELECT * FROM products WHERE stall_id = ? ${includeArchived ? '' : 'AND archived = 0'} ORDER BY archived ASC, id DESC`,
      [stall.id]
    );
    return { products: rows.map((row) => common.mapProduct(row)), count: rows.length };
  });

  router.post('/api/owner/products', async (ctx) => {
    const { user, stall } = owner(ctx);
    const body = await ctx.body();
    const data = productPayload(body);
    const now = new Date().toISOString();
    const result = store.run(
      `INSERT INTO products(stall_id, name, description, category, price_cents, discount_pct, stock, colors, sizes, images, sku, featured, archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [stall.id, data.name, data.description, data.category, data.priceCents, data.discountPct, data.stock,
        JSON.stringify(data.colors), JSON.stringify(data.sizes), JSON.stringify(data.images), data.sku, data.featured ? 1 : 0, now, now]
    );
    const id = Number(result.lastInsertRowid);
    store.logActivity({
      actor: user, action: 'product.create', entityType: 'product', entityId: id,
      details: `${data.name} · ₱${(data.priceCents / 100).toFixed(2)}`, ip: http.clientIp(ctx.req),
    });
    return { product: common.mapProduct(store.get('SELECT * FROM products WHERE id = ?', [id])), message: 'Product added to your catalogue.' };
  });

  router.put('/api/owner/products/:id', async (ctx) => {
    const { user, stall } = owner(ctx);
    const id = Number(ctx.params.id);
    const existing = store.get('SELECT * FROM products WHERE id = ? AND stall_id = ?', [id, stall.id]);
    if (!existing) throw new ApiError(404, 'Product not found in your stall.');
    const body = await ctx.body();
    const data = productPayload(body, existing);
    store.run(
      `UPDATE products SET name = ?, description = ?, category = ?, price_cents = ?, discount_pct = ?, stock = ?,
        colors = ?, sizes = ?, images = ?, sku = ?, featured = ?, updated_at = ? WHERE id = ? AND stall_id = ?`,
      [data.name, data.description, data.category, data.priceCents, data.discountPct, data.stock,
        JSON.stringify(data.colors), JSON.stringify(data.sizes), JSON.stringify(data.images), data.sku,
        data.featured ? 1 : 0, new Date().toISOString(), id, stall.id]
    );
    store.logActivity({
      actor: user, action: 'product.update', entityType: 'product', entityId: id,
      details: `Updated ${data.name}`, ip: http.clientIp(ctx.req),
    });
    return { product: common.mapProduct(store.get('SELECT * FROM products WHERE id = ?', [id])), message: 'Product saved.' };
  });

  router.post('/api/owner/products/:id/stock', async (ctx) => {
    const { user, stall } = owner(ctx);
    const id = Number(ctx.params.id);
    const existing = store.get('SELECT * FROM products WHERE id = ? AND stall_id = ?', [id, stall.id]);
    if (!existing) throw new ApiError(404, 'Product not found in your stall.');
    const body = await ctx.body();
    const stock = Number(body.stock);
    if (!Number.isInteger(stock) || stock < 0 || stock > 100000) throw new ApiError(400, 'Stock must be a whole number between 0 and 100,000.', { field: 'stock' });
    store.run('UPDATE products SET stock = ?, updated_at = ? WHERE id = ?', [stock, new Date().toISOString(), id]);
    store.logActivity({
      actor: user, action: 'product.stock', entityType: 'product', entityId: id,
      details: `${existing.stock} → ${stock}`, ip: http.clientIp(ctx.req),
    });
    return { product: common.mapProduct(store.get('SELECT * FROM products WHERE id = ?', [id])), message: 'Stock updated.' };
  });

  router.post('/api/owner/products/:id/archive', (ctx) => {
    const { user, stall } = owner(ctx);
    const id = Number(ctx.params.id);
    if (!store.get('SELECT id FROM products WHERE id = ? AND stall_id = ?', [id, stall.id])) throw new ApiError(404, 'Product not found in your stall.');
    store.run('UPDATE products SET archived = 1, updated_at = ? WHERE id = ?', [new Date().toISOString(), id]);
    store.logActivity({ actor: user, action: 'product.archive', entityType: 'product', entityId: id, details: 'Archived product', ip: http.clientIp(ctx.req) });
    return { ok: true, message: 'Product archived. It is hidden from the store but kept for order history.' };
  });

  router.post('/api/owner/products/:id/restore', (ctx) => {
    const { user, stall } = owner(ctx);
    const id = Number(ctx.params.id);
    if (!store.get('SELECT id FROM products WHERE id = ? AND stall_id = ?', [id, stall.id])) throw new ApiError(404, 'Product not found in your stall.');
    store.run('UPDATE products SET archived = 0, updated_at = ? WHERE id = ?', [new Date().toISOString(), id]);
    store.logActivity({ actor: user, action: 'product.restore', entityType: 'product', entityId: id, details: 'Restored product', ip: http.clientIp(ctx.req) });
    return { ok: true, message: 'Product restored to the store.' };
  });

  router.get('/api/owner/orders', (ctx) => {
    const { stall } = owner(ctx);
    const params = [stall.id];
    let where = 'o.stall_id = ?';
    const status = common.str(ctx.query.get('status'), 20);
    if (status) { where += ' AND o.status = ?'; params.push(status); }
    const query = common.str(ctx.query.get('q'), 80);
    if (query) {
      where += ' AND (o.code LIKE ? OR o.customer_name LIKE ? OR o.customer_email LIKE ?)';
      params.push(`%${query}%`, `%${query}%`, `%${query}%`);
    }
    if (ctx.query.get('period')) {
      const range = rangeFor(ctx);
      where += ' AND o.created_at >= ? AND o.created_at < ?';
      params.push(range.start, range.end);
    }
    const limit = http.numberParam(ctx.query.get('limit'), 100, 1, 300);
    const rows = store.all(
      `SELECT o.*, (SELECT COALESCE(SUM(qty),0) FROM order_items WHERE order_id = o.id) AS qty_sum,
        (SELECT product_name FROM order_items WHERE order_id = o.id ORDER BY id LIMIT 1) AS first_item
       FROM orders o WHERE ${where} ORDER BY o.created_at DESC LIMIT ?`,
      [...params, limit]
    );
    const counts = {};
    for (const row of store.all('SELECT status, COUNT(*) AS count FROM orders WHERE stall_id = ? GROUP BY status', [stall.id])) {
      counts[row.status] = row.count;
    }
    return {
      orders: rows.map((row) => ({ ...briefOrder(row), firstItem: row.first_item || '' })),
      counts,
    };
  });

  router.get('/api/owner/orders/:id', (ctx) => {
    const { stall } = owner(ctx);
    const order = common.loadOrderWithItems(Number(ctx.params.id));
    if (!order || order.stall_id !== stall.id) throw new ApiError(404, 'Order not found.');
    return { order };
  });

  router.post('/api/owner/orders/:id/status', async (ctx) => {
    const { user, stall } = owner(ctx);
    const order = store.get('SELECT * FROM orders WHERE id = ? AND stall_id = ?', [Number(ctx.params.id), stall.id]);
    if (!order) throw new ApiError(404, 'Order not found.');
    const body = await ctx.body();
    const to = common.str(body.status, 20);
    if (!['payment_confirmed', 'processing', 'confirmed', 'shipped', 'delivered', 'cancelled', 'refunded'].includes(to)) {
      throw new ApiError(400, 'Choose a valid order status.', { field: 'status' });
    }
    const updated = common.applyStatusChange(order, to, user, http.clientIp(ctx.req));
    return {
      order: common.loadOrderWithItems(updated.id),
      message: `Order ${updated.code} updated to ${common.orderStatusLabel(to)}.`,
    };
  });

  router.get('/api/owner/sales', (ctx) => {
    const { stall } = owner(ctx);
    const range = rangeFor(ctx);
    const data = reports.salesHistory({
      db: store,
      offsetMinutes: config.timezoneOffsetMinutes,
      range,
      stallId: stall.id,
      status: common.str(ctx.query.get('status'), 20),
      query: common.str(ctx.query.get('q'), 80),
      maxRows: 500,
    });
    return data;
  });

  router.get('/api/owner/reviews', (ctx) => {
    const { stall } = owner(ctx);
    const status = common.str(ctx.query.get('status'), 20);
    const params = [stall.id];
    let where = 'r.stall_id = ?';
    if (status) { where += ' AND r.status = ?'; params.push(status); }
    else where += " AND r.status IN ('published','flagged')";
    const rows = store.all(
      `SELECT r.*, p.name AS product_name FROM reviews r JOIN products p ON p.id = r.product_id
       WHERE ${where} ORDER BY r.created_at DESC LIMIT 200`,
      params
    );
    const summary = store.get(
      `SELECT COUNT(*) AS total, ROUND(AVG(CASE WHEN status = 'published' THEN rating END),1) AS average,
        COALESCE(SUM(CASE WHEN status = 'published' AND owner_reply = '' THEN 1 ELSE 0 END),0) AS unanswered,
        COALESCE(SUM(CASE WHEN status = 'flagged' THEN 1 ELSE 0 END),0) AS held
       FROM reviews WHERE stall_id = ?`,
      [stall.id]
    );
    return {
      reviews: rows.map((row) => ({
        id: row.id,
        orderId: row.order_id,
        productId: row.product_id,
        productName: row.product_name,
        customerName: row.customer_name,
        rating: row.rating,
        comment: row.comment,
        status: row.status,
        flagReason: row.status === 'flagged' ? 'Held by the automatic review filter; it is not public.' : '',
        ownerReply: row.owner_reply,
        ownerReplyAt: row.owner_reply_at,
        createdAt: row.created_at,
        localDateTime: time.fmtLocal(row.created_at, config.timezoneOffsetMinutes),
      })),
      summary: {
        total: summary.total,
        average: summary.average === null ? null : Number(summary.average),
        unanswered: summary.unanswered,
        held: summary.held,
      },
    };
  });

  router.post('/api/owner/reviews/:id/reply', async (ctx) => {
    const { user, stall } = owner(ctx);
    const review = store.get('SELECT * FROM reviews WHERE id = ? AND stall_id = ?', [Number(ctx.params.id), stall.id]);
    if (!review) throw new ApiError(404, 'Review not found.');
    if (review.status !== 'published') throw new ApiError(409, 'This review is awaiting moderation and cannot be replied to yet.');
    const body = await ctx.body();
    const reply = security.cleanText(body.reply, 600);
    if (reply.length < 2) throw new ApiError(400, 'Write a reply before saving.', { field: 'reply' });
    store.run('UPDATE reviews SET owner_reply = ?, owner_reply_at = ? WHERE id = ?', [reply, new Date().toISOString(), review.id]);
    store.logActivity({ actor: user, action: 'review.reply', entityType: 'review', entityId: review.id, details: 'Replied to a customer review', ip: http.clientIp(ctx.req) });
    return { message: 'Reply published.' };
  });

  router.get('/api/owner/reports', (ctx) => {
    const { user, stall } = owner(ctx);
    const range = rangeFor(ctx);
    const report = reports.buildReport({ db: store, offsetMinutes: config.timezoneOffsetMinutes, range, stallId: stall.id });
    return flashReport(ctx, report, {
      kind: 'owner', userId: user.id, stallId: stall.id, start: range.start, end: range.end,
    });
  });

  router.get('/api/owner/reports.csv', (ctx) => {
    const { user, stall } = owner(ctx);
    const range = rangeFor(ctx);
    const meta = { kind: 'owner', userId: user.id, stallId: stall.id, start: range.start, end: range.end };
    const preview = reportTokens.consume(ctx.query.get('preview'), meta);
    if (!preview) throw new ApiError(400, 'Preview this report before exporting it. The preview link expires after 15 minutes.');
    const csv = reports.buildReportCsv(preview);
    const safeName = stall.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `stall-${stall.id}`;
    const fileName = `skyworld-${safeName}-${range.value.replace(/[^0-9A-Za-z-]+/g, '_')}.csv`;
    http.sendText(ctx.res, 200, csv, 'text/csv; charset=utf-8', {
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
    });
    return undefined;
  });

  router.get('/api/owner/suppliers', (ctx) => {
    const { stall } = owner(ctx);
    const includeArchived = ctx.query.get('includeArchived') === '1';
    const rows = store.all(
      `SELECT * FROM suppliers WHERE stall_id = ? ${includeArchived ? '' : 'AND archived = 0'} ORDER BY archived ASC, id DESC`,
      [stall.id]
    );
    return { suppliers: rows.map((row) => ({
      id: row.id, name: row.name, contactName: row.contact_name, phone: row.phone, email: row.email,
      address: row.address, notes: row.notes, archived: Boolean(row.archived),
      createdAt: row.created_at, updatedAt: row.updated_at,
    })) };
  });

  router.post('/api/owner/suppliers', async (ctx) => {
    const { user, stall } = owner(ctx);
    const body = await ctx.body();
    const name = security.cleanName(body.name, 100);
    if (name.length < 2) throw new ApiError(400, 'Enter the supplier name.', { field: 'name' });
    const phone = body.phone ? security.normalizePhone(body.phone) : '';
    if (body.phone && !phone) throw new ApiError(400, 'Enter a valid supplier phone number.', { field: 'phone' });
    const email = body.email ? security.normalizeEmail(body.email) : '';
    if (body.email && !security.isValidEmail(email)) throw new ApiError(400, 'Enter a valid supplier email.', { field: 'email' });
    const now = new Date().toISOString();
    const result = store.run(
      `INSERT INTO suppliers(stall_id, name, contact_name, phone, email, address, notes, archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [stall.id, name, security.cleanName(body.contactName, 80), phone, email,
        security.cleanText(body.address, 200), security.cleanText(body.notes, 600), now, now]
    );
    store.logActivity({ actor: user, action: 'supplier.create', entityType: 'supplier', entityId: result.lastInsertRowid, details: name, ip: http.clientIp(ctx.req) });
    return { id: Number(result.lastInsertRowid), message: 'Supplier saved.' };
  });

  router.put('/api/owner/suppliers/:id', async (ctx) => {
    const { user, stall } = owner(ctx);
    const id = Number(ctx.params.id);
    const existing = store.get('SELECT * FROM suppliers WHERE id = ? AND stall_id = ?', [id, stall.id]);
    if (!existing) throw new ApiError(404, 'Supplier not found.');
    const body = await ctx.body();
    const name = security.cleanName(body.name ?? existing.name, 100);
    if (name.length < 2) throw new ApiError(400, 'Enter the supplier name.', { field: 'name' });
    const phone = body.phone === undefined ? existing.phone : body.phone ? security.normalizePhone(body.phone) : '';
    if (body.phone && !phone) throw new ApiError(400, 'Enter a valid supplier phone number.', { field: 'phone' });
    const email = body.email === undefined ? existing.email : body.email ? security.normalizeEmail(body.email) : '';
    if (body.email && !security.isValidEmail(email)) throw new ApiError(400, 'Enter a valid supplier email.', { field: 'email' });
    store.run(
      `UPDATE suppliers SET name = ?, contact_name = ?, phone = ?, email = ?, address = ?, notes = ?, updated_at = ?
       WHERE id = ? AND stall_id = ?`,
      [name, security.cleanName(body.contactName ?? existing.contact_name, 80), phone, email,
        security.cleanText(body.address ?? existing.address, 200), security.cleanText(body.notes ?? existing.notes, 600),
        new Date().toISOString(), id, stall.id]
    );
    store.logActivity({ actor: user, action: 'supplier.update', entityType: 'supplier', entityId: id, details: name, ip: http.clientIp(ctx.req) });
    return { message: 'Supplier updated.' };
  });

  router.post('/api/owner/suppliers/:id/archive', (ctx) => {
    const { user, stall } = owner(ctx);
    const id = Number(ctx.params.id);
    if (!store.get('SELECT id FROM suppliers WHERE id = ? AND stall_id = ?', [id, stall.id])) throw new ApiError(404, 'Supplier not found.');
    store.run('UPDATE suppliers SET archived = 1, updated_at = ? WHERE id = ?', [new Date().toISOString(), id]);
    store.logActivity({ actor: user, action: 'supplier.archive', entityType: 'supplier', entityId: id, details: 'Archived supplier', ip: http.clientIp(ctx.req) });
    return { ok: true, message: 'Supplier archived.' };
  });

  router.post('/api/owner/suppliers/:id/restore', (ctx) => {
    const { user, stall } = owner(ctx);
    const id = Number(ctx.params.id);
    if (!store.get('SELECT id FROM suppliers WHERE id = ? AND stall_id = ?', [id, stall.id])) throw new ApiError(404, 'Supplier not found.');
    store.run('UPDATE suppliers SET archived = 0, updated_at = ? WHERE id = ?', [new Date().toISOString(), id]);
    store.logActivity({ actor: user, action: 'supplier.restore', entityType: 'supplier', entityId: id, details: 'Restored supplier', ip: http.clientIp(ctx.req) });
    return { ok: true, message: 'Supplier restored.' };
  });

  router.get('/api/owner/archives', (ctx) => {
    const { stall } = owner(ctx);
    const products = store.all('SELECT * FROM products WHERE stall_id = ? AND archived = 1 ORDER BY updated_at DESC', [stall.id]);
    const orders = store.all(
      `SELECT o.*, (SELECT COALESCE(SUM(qty),0) FROM order_items WHERE order_id = o.id) AS qty_sum
       FROM orders o WHERE o.stall_id = ? AND o.status IN ('cancelled','refunded') ORDER BY o.created_at DESC LIMIT 200`,
      [stall.id]
    );
    const suppliers = store.all('SELECT * FROM suppliers WHERE stall_id = ? AND archived = 1 ORDER BY updated_at DESC', [stall.id]);
    return {
      products: products.map((row) => common.mapProduct(row)),
      orders: orders.map(briefOrder),
      suppliers: suppliers.map((row) => ({ id: row.id, name: row.name, archived: true, updatedAt: row.updated_at })),
      notes: ['Archived products stay out of the storefront but remain attached to past orders.', 'Cancelled and refunded orders are kept for audit and are never deleted.'],
    };
  });
}

module.exports = { registerRoutes, PRODUCT_CATEGORIES };
