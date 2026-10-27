'use strict';

const store = require('../db');
const time = require('../time');
const config = require('../config');
const { ApiError } = require('../errors');

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function str(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

function required(value, label, max = 200) {
  const text = str(value, max);
  if (!text) throw new ApiError(400, `${label} is required.`, { field: label.toLowerCase().replace(/\s+/g, '_') });
  return text;
}

function mapProduct(row, { includeArchived = false } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    stallId: row.stall_id,
    name: row.name,
    description: row.description,
    category: row.category,
    priceCents: row.price_cents,
    discountPct: row.discount_pct,
    stock: row.stock,
    colors: store.parseJson(row.colors, []),
    sizes: store.parseJson(row.sizes, []),
    images: store.parseJson(row.images, []),
    sku: row.sku,
    featured: Boolean(row.featured),
    archived: Boolean(row.archived),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(includeArchived ? {} : {}),
  };
}

function mapStall(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    description: row.description,
    location: row.location,
    coverImage: row.cover_image,
    profileImage: row.profile_image,
    gallery: store.parseJson(row.gallery, []),
    contactPhone: row.contact_phone,
    contactEmail: row.contact_email,
    operatingStatus: row.operating_status,
    occupancy: row.occupancy,
    commissionPct: row.commission_pct,
    lease: {
      start: row.lease_start,
      end: row.lease_end,
      rentCents: row.lease_rent_cents,
      areaSqm: row.lease_area_sqm,
      isSample: Boolean(row.lease_is_sample),
      note: row.lease_note,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function ownerStallRow(stallId) {
  return store.get('SELECT * FROM stalls WHERE id = ?', [stallId]);
}

function resolveRange(query, offsetMinutes = config.timezoneOffsetMinutes) {
  const period = str(query.get('period') || 'monthly', 20).toLowerCase();
  const value = str(query.get('value') || '', 20);
  if (period === 'custom') {
    const from = str(query.get('from') || '', 20);
    const to = str(query.get('to') || '', 20);
    if (!from || !to) throw new ApiError(400, 'Choose a start and end date for a custom range.');
    return time.customRange(from, to, offsetMinutes);
  }
  return time.periodRange(period, value, offsetMinutes);
}

function orderStatusLabel(status) {
  return String(status || '').replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

const TRANSITIONS = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['shipped', 'cancelled'],
  shipped: ['delivered', 'cancelled'],
  delivered: ['refunded'],
  cancelled: [],
  refunded: [],
};

function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

function applyStatusChange(order, to, actor, ip) {
  if (!canTransition(order.status, to)) {
    throw new ApiError(409, `An order marked ${orderStatusLabel(order.status)} cannot be changed to ${orderStatusLabel(to)}.`);
  }
  const now = new Date().toISOString();
  let paymentStatus = order.payment_status;
  let deliveredAt = order.delivered_at;
  if (to === 'delivered') {
    paymentStatus = 'paid';
    deliveredAt = now;
  }
  if (to === 'refunded') paymentStatus = 'refunded';
  let stockRestored = order.stock_restored;
  const restore = (to === 'cancelled' || to === 'refunded') && !order.stock_restored;
  store.tx(() => {
    if (restore) {
      const items = store.all('SELECT product_id, qty FROM order_items WHERE order_id = ?', [order.id]);
      for (const item of items) {
        store.run('UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?', [item.qty, now, item.product_id]);
      }
      stockRestored = 1;
    }
    store.run(
      `UPDATE orders SET status = ?, payment_status = ?, delivered_at = ?, stock_restored = ?, updated_at = ?
       WHERE id = ? AND status = ?`,
      [to, paymentStatus, deliveredAt, stockRestored, now, order.id, order.status]
    );
    const fresh = store.get('SELECT * FROM orders WHERE id = ?', [order.id]);
    if (!fresh || fresh.status !== to) throw new ApiError(409, 'The order status changed while you were updating it. Refresh and try again.');
    store.logActivity({
      actor,
      action: 'order.status',
      entityType: 'order',
      entityId: order.code,
      details: `${orderStatusLabel(order.status)} → ${orderStatusLabel(to)}${restore && !order.stock_restored ? ' · stock restored' : ''}`,
      ip,
    });
  });
  return store.get('SELECT * FROM orders WHERE id = ?', [order.id]);
}

function loadOrderWithItems(orderId) {
  const order = store.get('SELECT * FROM orders WHERE id = ?', [orderId]);
  if (!order) return null;
  const items = store.all('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', [orderId]);
  const stall = store.get('SELECT id, name, operating_status, occupancy, cover_image FROM stalls WHERE id = ?', [order.stall_id]);
  return {
    ...order,
    items: items.map((item) => ({
      id: item.id,
      productId: item.product_id,
      name: item.product_name,
      color: item.color,
      colorHex: item.color_hex,
      size: item.size,
      qty: item.qty,
      originalUnitCents: item.original_unit_cents,
      unitCents: item.unit_cents,
      lineTotalCents: item.line_total_cents,
      image: item.image_url,
    })),
    stall,
  };
}

function mustDate(value, label) {
  const text = str(value, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new ApiError(400, `${label} must be a valid date.`);
  return text;
}

module.exports = {
  clampInt,
  str,
  required,
  mapProduct,
  mapStall,
  ownerStallRow,
  resolveRange,
  orderStatusLabel,
  canTransition,
  applyStatusChange,
  loadOrderWithItems,
  mustDate,
};
