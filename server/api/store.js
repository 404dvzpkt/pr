'use strict';

const config = require('../config');
const store = require('../db');
const security = require('../security');
const reviewFilter = require('../reviewFilter');
const sms = require('../sms');
const time = require('../time');
const http = require('../http');
const { ApiError } = require('../errors');
const common = require('./common');

const PAYMENT_METHODS = ['Cash on Delivery', 'GCash', 'Maya', 'Bank Transfer (BDO)', 'Bank Transfer (BPI)'];

function publicStall(row, extra = {}) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    description: row.description,
    location: row.location,
    coverImage: row.cover_image,
    profileImage: row.profile_image,
    operatingStatus: row.operating_status,
    occupancy: row.occupancy,
    productCount: row.product_count === undefined ? undefined : Number(row.product_count || 0),
    rating: row.rating_avg === null || row.rating_avg === undefined ? null : Math.round(Number(row.rating_avg) * 10) / 10,
    reviewCount: Number(row.review_count || 0),
    ...extra,
  };
}

const STALL_SELECT = `
  SELECT s.*,
    (SELECT COUNT(*) FROM products p WHERE p.stall_id = s.id AND p.archived = 0) AS product_count,
    (SELECT ROUND(AVG(r.rating), 1) FROM reviews r WHERE r.stall_id = s.id AND r.status = 'published') AS rating_avg,
    (SELECT COUNT(*) FROM reviews r WHERE r.stall_id = s.id AND r.status = 'published') AS review_count
  FROM stalls s`;

const PRODUCT_SELECT = `
  SELECT p.*, s.name AS stall_name, s.operating_status AS stall_status, s.occupancy AS stall_occupancy,
    (SELECT ROUND(AVG(r.rating), 1) FROM reviews r WHERE r.product_id = p.id AND r.status = 'published') AS rating_avg,
    (SELECT COUNT(*) FROM reviews r WHERE r.product_id = p.id AND r.status = 'published') AS review_count
  FROM products p JOIN stalls s ON s.id = p.stall_id`;

function publicProduct(row) {
  if (!row) return null;
  return {
    id: row.id,
    stallId: row.stall_id,
    stallName: row.stall_name,
    stallStatus: row.stall_status,
    category: row.category,
    name: row.name,
    description: row.description,
    priceCents: row.price_cents,
    discountPct: row.discount_pct,
    finalPriceCents: Math.round(row.price_cents * (100 - row.discount_pct) / 100),
    stock: row.stock,
    inStock: row.stock > 0,
    colors: store.parseJson(row.colors, []),
    sizes: store.parseJson(row.sizes, []),
    images: store.parseJson(row.images, []),
    sku: row.sku,
    featured: Boolean(row.featured),
    rating: row.rating_avg === null || row.rating_avg === undefined ? null : Number(row.rating_avg),
    reviewCount: Number(row.review_count || 0),
    createdAt: row.created_at,
  };
}

function reviewRow(row) {
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name || '',
    customerName: row.customer_name,
    rating: row.rating,
    comment: row.comment,
    ownerReply: row.owner_reply,
    createdAt: row.created_at,
    localDate: time.fmtLocal(row.created_at, config.timezoneOffsetMinutes, { dateOnly: true }),
  };
}

function resolveVoucher(code, eligibleCents) {
  const clean = String(code || '').trim().toUpperCase();
  if (!clean) return { voucher: null, discountCents: 0 };
  const voucher = store.get('SELECT * FROM vouchers WHERE code = ?', [clean]);
  if (!voucher || !voucher.active) throw new ApiError(400, 'That voucher code is not active.', { field: 'voucherCode' });
  if (voucher.expires_at && Date.parse(voucher.expires_at) <= Date.now()) {
    throw new ApiError(400, 'That voucher code has expired.', { field: 'voucherCode' });
  }
  if (voucher.max_uses !== null && voucher.used_count >= voucher.max_uses) {
    throw new ApiError(400, 'That voucher code has reached its usage limit.', { field: 'voucherCode' });
  }
  if (eligibleCents < voucher.min_subtotal_cents) {
    throw new ApiError(400, `That voucher needs a minimum spend of ${formatMoney(voucher.min_subtotal_cents)}.`, { field: 'voucherCode' });
  }
  const discount = voucher.type === 'percent'
    ? Math.round(eligibleCents * Number(voucher.value) / 100)
    : Math.min(Number(voucher.value), eligibleCents);
  return {
    voucher,
    discountCents: Math.max(0, discount),
  };
}

function formatMoney(cents) {
  return `₱${(Number(cents) / 100).toFixed(2)}`;
}

function buildQuote({ stallId, rawItems, voucherCode }) {
  const stall = store.get('SELECT * FROM stalls WHERE id = ?', [stallId]);
  if (!stall) throw new ApiError(404, 'That stall does not exist.');
  if (!Array.isArray(rawItems) || rawItems.length < 1) throw new ApiError(400, 'Your cart is empty.', { field: 'items' });
  if (rawItems.length > 25) throw new ApiError(400, 'Too many cart lines.');
  const stockNeeded = new Map();
  const lines = rawItems.map((raw, index) => {
    const productId = Number(raw.productId ?? raw.id);
    if (!Number.isInteger(productId) || productId <= 0) throw new ApiError(400, 'A cart item is missing its product.', { field: 'items' });
    const qty = Math.trunc(Number(raw.qty));
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) throw new ApiError(400, 'Quantities must be between 1 and 20.', { field: 'items' });
    const row = store.get(`${PRODUCT_SELECT} WHERE p.id = ?`, [productId]);
    if (!row || row.archived) throw new ApiError(404, `A product in your cart is no longer available. (#${index + 1})`, { field: 'items' });
    if (row.stall_id !== stallId) throw new ApiError(400, 'All items must come from the same stall. Clear your cart and try again.', { field: 'items' });
    if (row.stall_status !== 'open') throw new ApiError(409, `${stall.name} is currently ${row.stall_status.replace(/_/g, ' ')} and cannot accept new orders.`, { field: 'stallId' });
    const colors = store.parseJson(row.colors, []);
    const sizes = store.parseJson(row.sizes, []);
    const colorName = String(raw.color || '').trim().slice(0, 60);
    let color = null;
    if (colors.length) {
      color = colors.find((entry) => entry.name === colorName);
      if (!color) throw new ApiError(400, `Choose an available colour for ${row.name}.`, { field: 'items' });
    }
    const size = String(raw.size || '').trim().slice(0, 30);
    if (sizes.length && !sizes.includes(size)) throw new ApiError(400, `Choose an available size for ${row.name}.`, { field: 'items' });
    stockNeeded.set(row.id, (stockNeeded.get(row.id) || 0) + qty);
    const unitCents = Math.round(row.price_cents * (100 - row.discount_pct) / 100);
    return {
      productId: row.id,
      name: row.name,
      image: (color && color.image) || store.parseJson(row.images, [])[0] || '',
      color: colorName,
      colorHex: color ? color.hex : '',
      size,
      qty,
      originalUnitCents: row.price_cents,
      unitCents,
      lineTotalCents: unitCents * qty,
      stock: row.stock,
      discountPct: row.discount_pct,
    };
  });
  for (const [productId, needed] of stockNeeded) {
    const row = store.get('SELECT stock FROM products WHERE id = ?', [productId]);
    if (!row) throw new ApiError(404, 'A product in your cart is no longer available.', { field: 'items' });
    if (needed > row.stock) {
      throw new ApiError(409, `Only ${row.stock} left in stock for one of your items. Adjust the quantity to continue.`, { field: 'items' });
    }
  }
  const subtotalCents = lines.reduce((sum, line) => sum + line.originalUnitCents * line.qty, 0);
  const productDiscountCents = lines.reduce((sum, line) => sum + (line.originalUnitCents - line.unitCents) * line.qty, 0);
  const eligibleCents = subtotalCents - productDiscountCents;
  const { voucher, discountCents: voucherDiscountCents } = resolveVoucher(voucherCode, eligibleCents);
  const shippingFee = store.getSettingNumber('shipping_fee_cents', 4900);
  const freeShipping = store.getSettingNumber('free_shipping_threshold_cents', 200000);
  const shippingCents = eligibleCents >= freeShipping ? 0 : shippingFee;
  const totalCents = Math.max(0, eligibleCents - voucherDiscountCents + shippingCents);
  const commissionPct = stall.commission_pct === null || stall.commission_pct === undefined
    ? store.getSettingNumber('commission_pct', 5)
    : stall.commission_pct;
  return {
    stall: publicStall(stall),
    lines,
    subtotalCents,
    productDiscountCents,
    voucher: voucher ? {
      code: voucher.code,
      type: voucher.type,
      value: voucher.value,
    } : null,
    voucherDiscountCents,
    shippingCents,
    totalCents,
    commissionPct,
    platformFeeCents: Math.round((eligibleCents - voucherDiscountCents) * commissionPct / 100),
    freeShippingThresholdCents: freeShipping,
    shippingFeeCents: shippingFee,
  };
}

function customerFrom(body) {
  const customer = {
    name: security.cleanName(body.name ?? body.customerName, 80),
    email: security.normalizeEmail(body.email ?? body.customerEmail),
    phone: security.normalizePhone(body.phone ?? body.customerPhone),
    address: security.cleanText(body.address ?? body.customerAddress, 220),
    city: security.cleanName(body.city, 80),
    notes: security.cleanText(body.notes, 500),
  };
  if (customer.name.length < 2) throw new ApiError(400, 'Enter the recipient name.', { field: 'name' });
  if (!security.isValidEmail(customer.email)) throw new ApiError(400, 'Enter a valid email address.', { field: 'email' });
  if (!customer.phone) throw new ApiError(400, 'Enter a valid Philippine mobile number.', { field: 'phone' });
  if (customer.address.length < 5) throw new ApiError(400, 'Enter a complete delivery address.', { field: 'address' });
  if (!customer.city) throw new ApiError(400, 'Enter the city or municipality.', { field: 'city' });
  return customer;
}

function nextOrderCode(year) {
  const prefix = `SW-${year}-`;
  const last = store.get('SELECT code FROM orders WHERE code LIKE ? ORDER BY code DESC LIMIT 1', [`${prefix}%`]);
  let suffix = last ? Number(String(last.code).slice(prefix.length)) + 1 : 1;
  if (!Number.isFinite(suffix) || suffix < 1) suffix = 1;
  let code = `${prefix}${String(suffix).padStart(5, '0')}`;
  while (store.get('SELECT id FROM orders WHERE code = ?', [code])) {
    suffix += 1;
    code = `${prefix}${String(suffix).padStart(5, '0')}`;
  }
  return code;
}

function mapOrderForCustomer(order, items) {
  return {
    id: order.id,
    code: order.code,
    status: order.status,
    paymentStatus: order.payment_status,
    paymentMethod: order.payment_method,
    customerName: order.customer_name,
    customerEmail: order.customer_email,
    customerPhone: order.customer_phone,
    address: order.address,
    city: order.city,
    notes: order.notes,
    subtotalCents: order.subtotal_cents,
    productDiscountCents: order.product_discount_cents,
    voucherCode: order.voucher_code,
    voucherDiscountCents: order.voucher_discount_cents,
    shippingCents: order.shipping_cents,
    totalCents: order.total_cents,
    isSample: Boolean(order.is_sample),
    smsStatus: order.sms_status,
    smsDetail: order.sms_detail,
    createdAt: order.created_at,
    localDateTime: time.fmtLocal(order.created_at, config.timezoneOffsetMinutes),
    items: items.map((item) => ({
      productId: item.product_id,
      name: item.product_name,
      color: item.color,
      colorHex: item.color_hex,
      size: item.size,
      qty: item.qty,
      unitCents: item.unit_cents,
      lineTotalCents: item.line_total_cents,
      image: item.image_url,
    })),
  };
}

function registerRoutes(router) {
  router.get('/api/store/stalls', () => {
    const rows = store.all(`${STALL_SELECT} ORDER BY s.id`);
    // Stall is "taken" only while an active owner account is linked to it.
    const taken = new Set(
      store.all("SELECT stall_id FROM users WHERE role = 'owner' AND status = 'active' AND stall_id IS NOT NULL")
        .map((r) => Number(r.stall_id))
    );
    return {
      stalls: rows.map((row) => publicStall({
        ...row,
        occupancy: taken.has(Number(row.id)) ? 'occupied' : 'available',
      })),
    };
  });

  router.get('/api/store/stalls/:id', (ctx) => {
    const id = Number(ctx.params.id);
    const row = store.get(`${STALL_SELECT} WHERE s.id = ?`, [id]);
    if (!row) throw new ApiError(404, 'That stall does not exist.');
    const products = store.all(
      `${PRODUCT_SELECT} WHERE p.stall_id = ? AND p.archived = 0 ORDER BY p.featured DESC, p.id ASC`,
      [id]
    ).map(publicProduct);
    const reviews = store.all(
      `SELECT r.*, p.name AS product_name FROM reviews r JOIN products p ON p.id = r.product_id
       WHERE r.stall_id = ? AND r.status = 'published' ORDER BY r.created_at DESC LIMIT 8`,
      [id]
    ).map(reviewRow);
    return { stall: publicStall(row), products, reviews };
  });

  router.get('/api/store/products', (ctx) => {
    const params = ['1=1'];
    const values = [];
    const stallId = Number(ctx.query.get('stallId') || 0);
    if (stallId) { params.push('p.stall_id = ?'); values.push(stallId); }
    const category = common.str(ctx.query.get('category'), 60);
    if (category) { params.push('p.category = ?'); values.push(category); }
    const query = common.str(ctx.query.get('q'), 80);
    if (query) {
      params.push('(p.name LIKE ? OR p.description LIKE ? OR p.sku LIKE ?)');
      values.push(`%${query}%`, `%${query}%`, `%${query}%`);
    }
    if (ctx.query.get('featured') === '1') params.push('p.featured = 1');
    const sort = common.str(ctx.query.get('sort'), 20);
    const order = sort === 'price_asc' ? 'p.price_cents ASC'
      : sort === 'price_desc' ? 'p.price_cents DESC'
        : sort === 'name' ? 'p.name ASC'
          : 'p.featured DESC, p.id ASC';
    const limit = http.numberParam(ctx.query.get('limit'), 120, 1, 200);
    const rows = store.all(
      `${PRODUCT_SELECT} WHERE p.archived = 0 AND ${params.join(' AND ')} ORDER BY ${order} LIMIT ?`,
      [...values, limit]
    );
    const categories = store.all(
      `SELECT p.category, COUNT(*) AS count FROM products p WHERE p.archived = 0 GROUP BY p.category ORDER BY count DESC`
    );
    return { products: rows.map(publicProduct), categories };
  });

  router.get('/api/store/products/:id', (ctx) => {
    const id = Number(ctx.params.id);
    const row = store.get(`${PRODUCT_SELECT} WHERE p.id = ?`, [id]);
    if (!row || row.archived) throw new ApiError(404, 'That product is no longer available.');
    const stall = store.get(`${STALL_SELECT} WHERE s.id = ?`, [row.stall_id]);
    const reviews = store.all(
      `SELECT r.*, p.name AS product_name FROM reviews r JOIN products p ON p.id = r.product_id
       WHERE r.product_id = ? AND r.status = 'published' ORDER BY r.created_at DESC LIMIT 12`,
      [id]
    ).map(reviewRow);
    return { product: publicProduct(row), stall: publicStall(stall), reviews };
  });

  router.post('/api/store/quote', async (ctx) => {
    const body = await ctx.body();
    const stallId = Number(body.stallId);
    if (!Number.isInteger(stallId) || stallId <= 0) throw new ApiError(400, 'Choose a stall.');
    const quote = buildQuote({ stallId, rawItems: body.items, voucherCode: body.voucherCode });
    return {
      quote: {
        stall: quote.stall,
        lines: quote.lines,
        subtotalCents: quote.subtotalCents,
        productDiscountCents: quote.productDiscountCents,
        voucher: quote.voucher,
        voucherDiscountCents: quote.voucherDiscountCents,
        shippingCents: quote.shippingCents,
        totalCents: quote.totalCents,
        freeShippingThresholdCents: quote.freeShippingThresholdCents,
        shippingFeeCents: quote.shippingFeeCents,
      },
    };
  });

  router.post('/api/store/checkout', async (ctx) => {
    const ip = http.clientIp(ctx.req);
    const gate = security.consumeRateHit(`checkout:${ip}`, { limit: 40, windowMs: 60 * 60 * 1000, lockMs: 30 * 60 * 1000 });
    if (!gate.allowed) throw new ApiError(429, 'Too many checkout attempts. Please wait a while.', { headers: { 'Retry-After': gate.retryAfter } });
    const body = await ctx.body();
    const stallId = Number(body.stallId);
    if (!Number.isInteger(stallId) || stallId <= 0) throw new ApiError(400, 'Choose a stall.', { field: 'stallId' });
    const idempotencyKey = common.str(body.idempotencyKey, 100);
    if (idempotencyKey.length < 8) throw new ApiError(400, 'A checkout idempotency key is required.', { field: 'idempotencyKey' });
    const existing = store.get('SELECT * FROM orders WHERE idempotency_key = ?', [idempotencyKey]);
    if (existing) {
      const items = store.all('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', [existing.id]);
      return { order: mapOrderForCustomer(existing, items), duplicate: true, smsConfigured: config.sms.configured };
    }
    const customer = customerFrom(body.customer || body);
    let paymentMethod = PAYMENT_METHODS.includes(body.paymentMethod) ? body.paymentMethod : '';
    if (!paymentMethod && body.paymentMethod === 'Bank Transfer') paymentMethod = 'Bank Transfer (BDO)';
    if (!paymentMethod) throw new ApiError(400, 'Choose a payment method.', { field: 'paymentMethod' });
    const quote = buildQuote({ stallId, rawItems: body.items, voucherCode: body.voucherCode });
    const now = new Date().toISOString();
    const local = time.localParts(Date.now(), config.timezoneOffsetMinutes);
    let orderId;
    let code;
    store.tx(() => {
      for (const [productId, needed] of quote.lines.reduce((map, line) => {
        map.set(line.productId, (map.get(line.productId) || 0) + line.qty);
        return map;
      }, new Map())) {
        const result = store.run(
          'UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ? AND stock >= ?',
          [needed, now, productId, needed]
        );
        if (!result.changes) throw new ApiError(409, 'One of your items just sold out. Refresh your cart and try again.', { field: 'items' });
      }
      if (quote.voucher) {
        const update = store.run(
          'UPDATE vouchers SET used_count = used_count + 1 WHERE code = ? AND active = 1 AND (max_uses IS NULL OR used_count < max_uses)',
          [quote.voucher.code]
        );
        if (!update.changes) throw new ApiError(409, 'That voucher was just fully claimed. Remove it and try again.', { field: 'voucherCode' });
      }
      code = nextOrderCode(local.year);
      const insert = store.run(
        `INSERT INTO orders(code, stall_id, customer_name, customer_email, customer_phone, address, city, notes,
          subtotal_cents, product_discount_cents, voucher_code, voucher_discount_cents, shipping_cents,
          platform_fee_cents, total_cents, status, payment_method, payment_status, idempotency_key,
          stock_restored, sms_status, sms_detail, is_sample, created_at, updated_at, delivered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 'unpaid', ?, 0, 'pending', 'Sending is attempted after the order is saved.', 0, ?, ?, NULL)`,
        [
          code, stallId, customer.name, customer.email, customer.phone, customer.address, customer.city, customer.notes,
          quote.subtotalCents, quote.productDiscountCents, quote.voucher ? quote.voucher.code : null,
          quote.voucherDiscountCents, quote.shippingCents, quote.platformFeeCents, quote.totalCents,
          paymentMethod, idempotencyKey, now, now,
        ]
      );
      orderId = Number(insert.lastInsertRowid);
      for (const line of quote.lines) {
        store.run(
          `INSERT INTO order_items(order_id, product_id, product_name, color, color_hex, size, qty,
            original_unit_cents, unit_cents, line_total_cents, image_url)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [orderId, line.productId, line.name, line.color, line.colorHex, line.size, line.qty, line.originalUnitCents, line.unitCents, line.lineTotalCents, line.image]
        );
      }
      const owner = store.get("SELECT id FROM users WHERE role = 'owner' AND stall_id = ? AND status = 'active'", [stallId]);
      if (owner) {
        store.notifyUser(owner.id, 'order_new', 'New online order', `${code} · ${formatMoney(quote.totalCents)}`, '/owner/#orders');
      }
      store.logActivity({
        action: 'order.place',
        entityType: 'order',
        entityId: code,
        details: `Guest checkout · ${paymentMethod} · ${formatMoney(quote.totalCents)}`,
        ip,
      });
    });
    let smsResult = { sent: false, reason: 'not_configured' };
    if (config.sms.configured) {
      smsResult = await sms.sendSms(
        customer.phone,
        `SkyWorld Stall: order ${code} received from ${quote.stall.name}. Total ₱${(quote.totalCents / 100).toFixed(2)}. We will message you when it ships.`
      );
    }
    const smsStatus = smsResult.sent ? 'sent' : (smsResult.reason || 'failed');
    const smsDetail = smsResult.sent
      ? `Confirmation sent via ${smsResult.provider || 'the configured SMS provider'}.`
      : smsResult.reason === 'not_configured'
        ? 'No SMS provider is configured on this server, so no confirmation text was sent.'
        : 'The SMS provider could not be reached. The order is saved; contact the stall for updates.';
    store.run('UPDATE orders SET sms_status = ?, sms_detail = ? WHERE id = ?', [smsStatus, smsDetail, orderId]);
    const order = store.get('SELECT * FROM orders WHERE id = ?', [orderId]);
    const items = store.all('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', [orderId]);
    return {
      order: mapOrderForCustomer(order, items),
      duplicate: false,
      smsConfigured: config.sms.configured,
      smsSent: Boolean(smsResult.sent),
      smsMessage: smsDetail,
      message: `Order ${code} was placed. Keep your order code and email to track it.`,
    };
  });

  router.post('/api/store/orders/lookup', async (ctx) => {
    const ip = http.clientIp(ctx.req);
    const gate = security.consumeRateHit(`lookup:${ip}`, { limit: 30, windowMs: 15 * 60 * 1000, lockMs: 15 * 60 * 1000 });
    if (!gate.allowed) throw new ApiError(429, 'Too many lookups. Try again later.', { headers: { 'Retry-After': gate.retryAfter } });
    const body = await ctx.body();
    const code = common.str(body.code, 40).toUpperCase();
    const email = security.normalizeEmail(body.email);
    const phone = security.normalizePhone(body.phone);
    if (!code || (!email && !phone)) throw new ApiError(400, 'Enter your order code and the email or mobile number used at checkout.');
    const order = store.get(
      'SELECT * FROM orders WHERE code = ? AND (LOWER(customer_email) = ? OR customer_phone = ?)',
      [code, email || '\u0000', phone || '\u0000']
    );
    if (!order) throw new ApiError(404, 'No order matches those details.');
    const items = store.all('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', [order.id]);
    const stall = store.get('SELECT name, cover_image FROM stalls WHERE id = ?', [order.stall_id]);
    return { order: mapOrderForCustomer(order, items), stall };
  });

  router.post('/api/store/reviews', async (ctx) => {
    const ip = http.clientIp(ctx.req);
    const gate = security.consumeRateHit(`review:${ip}`, { limit: 12, windowMs: 60 * 60 * 1000, lockMs: 60 * 60 * 1000 });
    if (!gate.allowed) throw new ApiError(429, 'Too many review submissions. Try again later.', { headers: { 'Retry-After': gate.retryAfter } });
    const body = await ctx.body();
    const code = common.str(body.orderCode, 40).toUpperCase();
    const email = security.normalizeEmail(body.email);
    const productId = Number(body.productId);
    const rating = Math.trunc(Number(body.rating));
    const comment = security.cleanText(body.comment, 1000);
    if (!code || !email) throw new ApiError(400, 'Use the order code and email from your purchase.');
    if (!Number.isInteger(productId) || productId <= 0) throw new ApiError(400, 'Choose the product you are reviewing.');
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new ApiError(400, 'Choose a rating from 1 to 5.', { field: 'rating' });
    if (comment.length < 3) throw new ApiError(400, 'Write a short review before submitting.', { field: 'comment' });
    const order = store.get(
      'SELECT * FROM orders WHERE code = ? AND LOWER(customer_email) = ?',
      [code, email]
    );
    if (!order) throw new ApiError(404, 'No delivered order matches those details. Reviews require a delivered order.');
    if (order.status !== 'delivered') throw new ApiError(409, 'You can review products after your order is delivered.');
    const item = store.get('SELECT * FROM order_items WHERE order_id = ? AND product_id = ?', [order.id, productId]);
    if (!item) throw new ApiError(404, 'That product is not part of this order.');
    if (store.get('SELECT id FROM reviews WHERE order_id = ? AND product_id = ?', [order.id, productId])) {
      throw new ApiError(409, 'You have already reviewed this product for this order.');
    }
    const words = store.parseJson(store.getSetting('prohibited_words', '[]'), []);
    const filter = reviewFilter.filterComment(comment, words, { enabled: store.getSettingBool('review_filter_enabled', true) });
    const status = filter.flagged ? 'flagged' : 'published';
    store.run(
      `INSERT INTO reviews(product_id, stall_id, order_id, customer_name, customer_email, rating, comment,
        status, flag_reason, owner_reply, owner_reply_at, is_sample, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', NULL, 0, ?)`,
      [productId, order.stall_id, order.id, order.customer_name, email, rating, comment, status,
        filter.flagged ? filter.reason : '', new Date().toISOString()]
    );
    if (status === 'flagged') {
      for (const admin of store.all("SELECT id FROM users WHERE role = 'admin' AND status = 'active'")) {
        store.notifyUser(admin.id, 'review_flagged', 'Review held for moderation', `A review for order ${code} was automatically held.`, '/admin/#reviews');
      }
    }
    const owner = store.get("SELECT id FROM users WHERE role = 'owner' AND stall_id = ? AND status = 'active'", [order.stall_id]);
    if (owner) store.notifyUser(owner.id, 'review_new', 'New customer review', `${rating}★ on ${item.product_name}.`, '/owner/#reviews');
    return {
      message: status === 'flagged'
        ? 'Thank you. Your review was received and will be checked by our team before it appears.'
        : 'Thank you. Your review is now visible on the product page.',
      published: status === 'published',
    };
  });

  router.post('/api/store/feedback', async (ctx) => {
    const ip = http.clientIp(ctx.req);
    const gate = security.consumeRateHit(`feedback:${ip}`, { limit: 6, windowMs: 60 * 60 * 1000, lockMs: 60 * 60 * 1000 });
    if (!gate.allowed) throw new ApiError(429, 'Too many feedback messages. Try again later.', { headers: { 'Retry-After': gate.retryAfter } });
    const body = await ctx.body();
    const name = security.cleanName(body.name, 80);
    const contact = security.cleanText(body.contact, 120);
    const subject = security.cleanText(body.subject, 120);
    const message = security.cleanText(body.message, 2000);
    if (name.length < 2) throw new ApiError(400, 'Enter your name.', { field: 'name' });
    if (contact.length < 3) throw new ApiError(400, 'Enter an email address or mobile number.', { field: 'contact' });
    if (subject.length < 3) throw new ApiError(400, 'Enter a subject.', { field: 'subject' });
    if (message.length < 10) throw new ApiError(400, 'Tell us a little more (at least 10 characters).', { field: 'message' });
    store.run(
      `INSERT INTO feedback(name, contact, subject, message, status, is_sample, created_at)
       VALUES (?, ?, ?, ?, 'new', 0, ?)`,
      [name, contact, subject, message, new Date().toISOString()]
    );
    return { message: 'Thank you. Your message is with the platform team.' };
  });

  router.get('/api/store/reviews', (ctx) => {
    const limit = http.numberParam(ctx.query.get('limit'), 20, 1, 50);
    const rows = store.all(
      `SELECT r.*, p.name AS product_name, s.name AS stall_name
       FROM reviews r JOIN products p ON p.id = r.product_id JOIN stalls s ON s.id = r.stall_id
       WHERE r.status = 'published' ORDER BY r.created_at DESC LIMIT ?`,
      [limit]
    ).map((row) => ({ ...reviewRow(row), stallName: row.stall_name }));
    return { reviews: rows };
  });
}

module.exports = { registerRoutes, publicProduct, publicStall, buildQuote };
