'use strict';

const time = require('./time');

const SALES_STATUSES = ['delivered', 'refunded'];

function moneyFromCents(cents) {
  const value = Number(cents || 0);
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

function computeTotals(orders) {
  const totals = {
    orderCount: 0,
    deliveredCount: 0,
    refundedCount: 0,
    cancelledCount: 0,
    pendingCount: 0,
    confirmedCount: 0,
    shippedCount: 0,
    unitsSold: 0,
    completedSalesCents: 0,
    grossSalesCents: 0,
    refundsCents: 0,
    discountsCents: 0,
    shippingCents: 0,
    platformFeesCents: 0,
    netSalesCents: 0,
    ownerNetCents: 0,
    pendingValueCents: 0,
    cancelledValueCents: 0,
    sampleOrderCount: 0,
  };
  for (const order of orders) {
    const status = order.status;
    const total = Number(order.total_cents) || 0;
    const discount = (Number(order.product_discount_cents) || 0) + (Number(order.voucher_discount_cents) || 0);
    totals.orderCount += 1;
    if (order.is_sample) totals.sampleOrderCount += 1;
    if (status === 'delivered') {
      totals.deliveredCount += 1;
      totals.completedSalesCents += total;
      totals.platformFeesCents += Number(order.platform_fee_cents) || 0;
      totals.unitsSold += Number(order.qty_sum) || 0;
    } else if (status === 'refunded') {
      totals.refundedCount += 1;
      totals.refundsCents += total;
      totals.unitsSold += Number(order.qty_sum) || 0;
    } else if (status === 'cancelled') {
      totals.cancelledCount += 1;
      totals.cancelledValueCents += total;
    } else if (status === 'pending') {
      totals.pendingCount += 1;
      totals.pendingValueCents += total;
    } else if (status === 'confirmed') {
      totals.confirmedCount += 1;
      totals.pendingValueCents += total;
    } else if (status === 'shipped') {
      totals.shippedCount += 1;
      totals.pendingValueCents += total;
    }
    if (SALES_STATUSES.includes(status)) {
      totals.discountsCents += discount;
      totals.shippingCents += Number(order.shipping_cents) || 0;
    }
  }
  totals.grossSalesCents = totals.completedSalesCents + totals.refundsCents;
  totals.netSalesCents = totals.grossSalesCents - totals.refundsCents;
  totals.ownerNetCents = totals.netSalesCents - totals.platformFeesCents;
  return totals;
}

function loadItemsByOrder(db, start, end, stallId = null) {
  const params = [start, end];
  let sql = `SELECT oi.order_id, oi.product_name, oi.color, oi.size, oi.qty, oi.unit_cents, oi.image_url, oi.line_total_cents
             FROM order_items oi JOIN orders o ON o.id = oi.order_id
             WHERE o.created_at >= ? AND o.created_at < ?`;
  if (stallId) {
    sql += ' AND o.stall_id = ?';
    params.push(stallId);
  }
  sql += ' ORDER BY oi.id ASC';
  const map = new Map();
  for (const item of db.all(sql, params)) {
    if (!map.has(item.order_id)) map.set(item.order_id, []);
    map.get(item.order_id).push(item);
  }
  return map;
}

function itemSummary(items) {
  if (!items || !items.length) return '—';
  return items.map((item) => `${item.product_name} ×${item.qty}`).join(', ');
}

function variantSummary(items) {
  if (!items || !items.length) return '—';
  return items.map((item) => {
    const bits = [];
    if (item.color) bits.push(item.color);
    if (item.size) bits.push(`Size ${item.size}`);
    bits.push(`×${item.qty}`);
    return bits.join(' / ');
  }).join('; ');
}

function buildReport({ db, offsetMinutes, range, stallId = null, includeBreakdown = false }) {
  const params = [range.start, range.end];
  let where = 'WHERE o.created_at >= ? AND o.created_at < ?';
  if (stallId) {
    where += ' AND o.stall_id = ?';
    params.push(stallId);
  }
  const orders = db.all(
    `SELECT o.*, s.name AS stall_name,
       (SELECT COALESCE(SUM(qty), 0) FROM order_items WHERE order_id = o.id) AS qty_sum
     FROM orders o JOIN stalls s ON s.id = o.stall_id
     ${where}
     ORDER BY o.created_at ASC, o.id ASC`,
    params
  );
  const itemsByOrder = loadItemsByOrder(db, range.start, range.end, stallId);
  const records = orders.map((order) => {
    const items = itemsByOrder.get(order.id) || [];
    return {
      id: order.id,
      code: order.code,
      createdAt: order.created_at,
      localDate: time.localDateString(order.created_at, offsetMinutes),
      localDateTime: time.fmtLocal(order.created_at, offsetMinutes),
      stallId: order.stall_id,
      stallName: order.stall_name,
      customerName: order.customer_name,
      status: order.status,
      items: items.map((item) => ({
        productName: item.product_name,
        color: item.color,
        size: item.size,
        qty: item.qty,
        unitCents: item.unit_cents,
        lineTotalCents: item.line_total_cents,
        image: item.image_url,
      })),
      itemSummary: itemSummary(items),
      variantSummary: variantSummary(items),
      quantity: Number(order.qty_sum) || 0,
      subtotalCents: order.subtotal_cents,
      productDiscountCents: order.product_discount_cents,
      voucherCode: order.voucher_code || '',
      voucherDiscountCents: order.voucher_discount_cents,
      discountCents: (Number(order.product_discount_cents) || 0) + (Number(order.voucher_discount_cents) || 0),
      shippingCents: order.shipping_cents,
      platformFeeCents: order.platform_fee_cents,
      totalCents: order.total_cents,
      isSample: Boolean(order.is_sample),
      smsStatus: order.sms_status,
    };
  });

  const totals = computeTotals(orders);
  let breakdown = [];
  if (includeBreakdown) {
    const rows = db.all(
      `SELECT s.id, s.name, s.occupancy, s.operating_status,
         COUNT(o.id) AS order_count,
         COALESCE(SUM(CASE WHEN o.status = 'delivered' THEN o.total_cents ELSE 0 END), 0) AS delivered_cents,
         COALESCE(SUM(CASE WHEN o.status = 'refunded' THEN o.total_cents ELSE 0 END), 0) AS refunded_cents,
         COALESCE(SUM(CASE WHEN o.status = 'delivered' THEN o.platform_fee_cents ELSE 0 END), 0) AS fees_cents,
         COALESCE(SUM(CASE WHEN o.status = 'delivered' THEN 1 ELSE 0 END), 0) AS delivered_orders
       FROM stalls s
       LEFT JOIN orders o ON o.stall_id = s.id AND o.created_at >= ? AND o.created_at < ?
       GROUP BY s.id ORDER BY s.id`,
      [range.start, range.end]
    );
    breakdown = rows.map((row) => ({
      stallId: row.id,
      stallName: row.name,
      occupancy: row.occupancy,
      operatingStatus: row.operating_status,
      orderCount: row.order_count,
      deliveredOrders: row.delivered_orders,
      deliveredCents: row.delivered_cents,
      refundedCents: row.refunded_cents,
      feesCents: row.fees_cents,
    }));
  }

  return {
    range: {
      label: range.label,
      period: range.period,
      value: range.value,
      start: range.start,
      end: range.end,
      startLocal: time.fmtLocal(range.start, offsetMinutes, { dateOnly: true }),
      endLocal: time.fmtLocal(new Date(Date.parse(range.end) - 1).toISOString(), offsetMinutes, { dateOnly: true }),
      timezone: 'F. Calderon St. Baguio City, Benguet',
    },
    generatedAt: new Date().toISOString(),
    records,
    totals,
    breakdown,
    notes: [
      'Sales are recognised when an order status becomes Delivered. Pending, Confirmed, and Shipped orders are not counted as completed sales.',
      'Gross sales include delivered and refunded orders; refunds are shown separately. Platform fees only apply to delivered orders.',
      'Seeded demonstration orders are marked Sample = YES. They are not real revenue.',
    ],
  };
}

function csvCell(value) {
  const text = String(value ?? '');
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function buildReportCsv(report) {
  const t = report.totals;
  const rows = [];
  rows.push(['SkyWorld Stall — Sales Report']);
  rows.push(['Period', report.range.label]);
  rows.push(['Range (F. Calderon St. Baguio City, Benguet)', `${report.range.startLocal} to ${report.range.endLocal}`]);
  rows.push(['Timezone', report.range.timezone]);
  rows.push(['Generated at', time.fmtLocal(report.generatedAt, 480)]);
  rows.push(['Sample data included', 'YES — rows with Sample = YES are demonstration data, not real revenue.']);
  rows.push([]);
  rows.push(['Summary', 'Value (PHP)']);
  rows.push(['Completed sales (Delivered)', moneyFromCents(t.completedSalesCents)]);
  rows.push(['Gross sales (Delivered + Refunded)', moneyFromCents(t.grossSalesCents)]);
  rows.push(['Refunds', moneyFromCents(t.refundsCents)]);
  rows.push(['Product and voucher discounts', moneyFromCents(t.discountsCents)]);
  rows.push(['Platform fees (Delivered)', moneyFromCents(t.platformFeesCents)]);
  rows.push(['Net sales after refunds', moneyFromCents(t.netSalesCents)]);
  rows.push(['Owner net after platform fees', moneyFromCents(t.ownerNetCents)]);
  rows.push(['Orders included', t.orderCount]);
  rows.push(['Delivered / Refunded / Cancelled / Pending', `${t.deliveredCount} / ${t.refundedCount} / ${t.cancelledCount} / ${t.pendingCount}`]);
  rows.push(['Units sold (Delivered + Refunded)', t.unitsSold]);
  rows.push([]);
  if (report.breakdown && report.breakdown.length) {
    rows.push(['Sales by stall', 'Delivered orders', 'Delivered sales (PHP)', 'Refunds (PHP)', 'Platform fees (PHP)']);
    for (const row of report.breakdown) {
      rows.push([
        row.stallName,
        row.deliveredOrders,
        moneyFromCents(row.deliveredCents),
        moneyFromCents(row.refundedCents),
        moneyFromCents(row.feesCents),
      ]);
    }
    rows.push([]);
  }
  rows.push([
    'Order ID', 'Date (F. Calderon St. Baguio City, Benguet)', 'Stall', 'Customer', 'Items', 'Variants', 'Qty',
    'Subtotal (PHP)', 'Discounts (PHP)', 'Shipping (PHP)', 'Platform fee (PHP)', 'Total (PHP)',
    'Status', 'Sample',
  ]);
  for (const record of report.records) {
    rows.push([
      record.code,
      record.localDateTime,
      record.stallName,
      record.customerName,
      record.itemSummary,
      record.variantSummary,
      record.quantity,
      moneyFromCents(record.subtotalCents),
      moneyFromCents(record.discountCents),
      moneyFromCents(record.shippingCents),
      moneyFromCents(record.platformFeeCents),
      moneyFromCents(record.totalCents),
      record.status,
      record.isSample ? 'YES' : 'NO',
    ]);
  }
  const rowTotals = report.records.reduce((acc, record) => {
    acc.qty += record.quantity;
    acc.subtotal += record.subtotalCents;
    acc.discount += record.discountCents;
    acc.shipping += record.shippingCents;
    acc.fees += record.platformFeeCents;
    acc.total += record.totalCents;
    return acc;
  }, { qty: 0, subtotal: 0, discount: 0, shipping: 0, fees: 0, total: 0 });
  rows.push([
    'ROW TOTALS', '', '', '', '', '', rowTotals.qty,
    moneyFromCents(rowTotals.subtotal), moneyFromCents(rowTotals.discount),
    moneyFromCents(rowTotals.shipping), moneyFromCents(rowTotals.fees), moneyFromCents(rowTotals.total),
    '', '',
  ]);
  rows.push([]);
  for (const note of report.notes) rows.push([note]);
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

function salesHistory({ db, offsetMinutes, range, stallId = null, status = '', query = '', maxRows = 500 }) {
  const params = [range.start, range.end];
  let where = 'WHERE o.created_at >= ? AND o.created_at < ?';
  if (stallId) {
    where += ' AND o.stall_id = ?';
    params.push(stallId);
  }
  if (status) {
    where += ' AND o.status = ?';
    params.push(status);
  }
  if (query) {
    where += ' AND (o.code LIKE ? OR o.customer_name LIKE ? OR o.customer_email LIKE ?)';
    const q = `%${query}%`;
    params.push(q, q, q);
  }
  const orders = db.all(
    `SELECT o.*, s.name AS stall_name,
       (SELECT COALESCE(SUM(qty), 0) FROM order_items WHERE order_id = o.id) AS qty_sum
     FROM orders o JOIN stalls s ON s.id = o.stall_id
     ${where} ORDER BY o.created_at DESC LIMIT ?`,
    [...params, maxRows]
  );
  const totals = computeTotals(orders);
  return {
    orders: orders.map((order) => ({
      id: order.id,
      code: order.code,
      createdAt: order.created_at,
      localDateTime: time.fmtLocal(order.created_at, offsetMinutes),
      stallId: order.stall_id,
      stallName: order.stall_name,
      customerName: order.customer_name,
      status: order.status,
      quantity: order.qty_sum,
      subtotalCents: order.subtotal_cents,
      discountCents: order.product_discount_cents + order.voucher_discount_cents,
      shippingCents: order.shipping_cents,
      platformFeeCents: order.platform_fee_cents,
      totalCents: order.total_cents,
      isSample: Boolean(order.is_sample),
    })),
    totals,
    capped: orders.length >= maxRows,
    maxRows,
    range: {
      label: range.label,
      start: range.start,
      end: range.end,
      startLocal: time.fmtLocal(range.start, offsetMinutes, { dateOnly: true }),
      endLocal: time.fmtLocal(new Date(Date.parse(range.end) - 1).toISOString(), offsetMinutes, { dateOnly: true }),
      timezone: 'F. Calderon St. Baguio City, Benguet',
    },
  };
}

function dailyStallStats(db, start, end) {
  return db.all(
    `SELECT s.id AS stall_id, s.name AS stall_name, s.operating_status, s.occupancy,
       COUNT(o.id) AS order_count,
       COALESCE(SUM(CASE WHEN o.status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_count,
       COALESCE(SUM(CASE WHEN o.status IN ('confirmed','shipped') THEN 1 ELSE 0 END), 0) AS active_count,
       COALESCE(SUM(CASE WHEN o.status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled_count,
       COALESCE(SUM(CASE WHEN o.status = 'refunded' THEN 1 ELSE 0 END), 0) AS refunded_count,
       COALESCE(SUM(CASE WHEN o.status = 'delivered' THEN 1 ELSE 0 END), 0) AS delivered_count,
       COALESCE(SUM(CASE WHEN o.status = 'delivered' THEN o.total_cents ELSE 0 END), 0) AS delivered_cents
     FROM stalls s
     LEFT JOIN orders o ON o.stall_id = s.id AND o.created_at >= ? AND o.created_at < ?
     GROUP BY s.id ORDER BY s.id`,
    [start, end]
  );
}

module.exports = {
  computeTotals,
  buildReport,
  buildReportCsv,
  salesHistory,
  dailyStallStats,
  moneyFromCents,
  csvCell,
};
