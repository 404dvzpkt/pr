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

function operator(ctx) {
  return auth.requireUser(ctx, ['operator']);
}

function todayRange(offset = config.timezoneOffsetMinutes) {
  return time.periodRange('daily', null, offset);
}

function sanitizeReport(report) {
  return {
    ...report,
    records: report.records.map((record) => ({ ...record, customerName: 'Protected' })),
  };
}

function computeIssues() {
  const issues = [];
  const lowStock = store.all(
    `SELECT p.id, p.name, p.stock, p.stall_id, s.name AS stall_name FROM products p JOIN stalls s ON s.id = p.stall_id
     WHERE p.archived = 0 AND p.stock <= 5 ORDER BY p.stock ASC, p.id LIMIT 40`
  );
  for (const row of lowStock) {
    issues.push({
      severity: row.stock === 0 ? 'high' : 'medium',
      type: 'inventory',
      stallId: row.stall_id,
      stallName: row.stall_name,
      title: row.stock === 0 ? `${row.name} is out of stock` : `${row.name} is low on stock (${row.stock} left)`,
      link: '/operator/#stall-status',
    });
  }
  const stale = store.all(
    `SELECT o.id, o.code, o.status, o.created_at, o.stall_id, s.name AS stall_name FROM orders o JOIN stalls s ON s.id = o.stall_id
     WHERE o.status IN ('pending','confirmed') AND o.created_at < ? ORDER BY o.created_at ASC LIMIT 30`,
    [new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()]
  );
  for (const row of stale) {
    issues.push({
      severity: row.status === 'pending' ? 'high' : 'medium',
      type: 'order_aging',
      stallId: row.stall_id,
      stallName: row.stall_name,
      title: `${row.code} has been ${row.status} for more than 24 hours`,
      link: '/operator/#daily-ops',
    });
  }
  const urgentTickets = store.all(
    `SELECT t.id, t.code, t.title, t.priority, t.status, t.stall_id, s.name AS stall_name
     FROM tickets t JOIN stalls s ON s.id = t.stall_id
     WHERE t.status IN ('open','in_progress') AND t.priority IN ('high','urgent') ORDER BY t.id DESC LIMIT 20`
  );
  for (const row of urgentTickets) {
    issues.push({
      severity: row.priority === 'urgent' ? 'high' : 'medium',
      type: 'ticket',
      stallId: row.stall_id,
      stallName: row.stall_name,
      title: `${row.code} · ${row.title}`,
      link: '/operator/#tickets',
    });
  }
  const closedWithWork = store.all(
    `SELECT s.id, s.name, s.operating_status, COUNT(o.id) AS pending_orders
     FROM stalls s JOIN orders o ON o.stall_id = s.id AND o.status IN ('pending','confirmed','shipped')
     WHERE s.operating_status IN ('closed','under_maintenance','inactive')
     GROUP BY s.id ORDER BY s.id`
  );
  for (const row of closedWithWork) {
    issues.push({
      severity: 'medium',
      type: 'stall_status',
      stallId: row.id,
      stallName: row.name,
      title: `${row.name} is ${row.operating_status.replace(/_/g, ' ')} with ${row.pending_orders} open order(s)`,
      link: '/operator/#stall-status',
    });
  }
  return issues;
}

function ticketRow(row) {
  return {
    id: row.id,
    code: row.code,
    stallId: row.stall_id,
    stallName: row.stall_name || '',
    title: row.title,
    description: row.description,
    category: row.category,
    priority: row.priority,
    status: row.status,
    assignedTo: row.assigned_to,
    assigneeName: row.assignee_name || '',
    resolution: row.resolution,
    isSample: Boolean(row.is_sample),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    localDateTime: time.fmtLocal(row.updated_at, config.timezoneOffsetMinutes),
  };
}

function visitRow(row) {
  return {
    id: row.id,
    stallId: row.stall_id,
    stallName: row.stall_name || '',
    operatorId: row.operator_id,
    operatorName: row.operator_name || '',
    visitDate: row.visit_date,
    purpose: row.purpose,
    observations: row.observations,
    issues: row.issues,
    recommendedActions: row.recommended_actions,
    followUpStatus: row.follow_up_status,
    isSample: Boolean(row.is_sample),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function nextTicketCode(year) {
  const prefix = `TKT-${year}-`;
  const last = store.get('SELECT code FROM tickets WHERE code LIKE ? ORDER BY code DESC LIMIT 1', [`${prefix}%`]);
  let suffix = last ? Number(String(last.code).slice(prefix.length)) + 1 : 1;
  let code = `${prefix}${String(suffix).padStart(4, '0')}`;
  while (store.get('SELECT id FROM tickets WHERE code = ?', [code])) {
    suffix += 1;
    code = `${prefix}${String(suffix).padStart(4, '0')}`;
  }
  return code;
}

function registerRoutes(router) {
  router.get('/api/operator/overview', (ctx) => {
    operator(ctx);
    const offset = config.timezoneOffsetMinutes;
    const today = todayRange(offset);
    const month = time.periodRange('monthly', null, offset);
    const orderRows = store.all(
      `SELECT o.*, s.name AS stall_name FROM orders o JOIN stalls s ON s.id = o.stall_id
       WHERE o.created_at >= ? AND o.created_at < ? ORDER BY o.created_at DESC`,
      [today.start, today.end]
    );
    const totals = reports.computeTotals(orderRows);
    const statuses = store.all('SELECT operating_status, COUNT(*) AS count FROM stalls GROUP BY operating_status');
    const openTickets = store.get("SELECT COUNT(*) AS count FROM tickets WHERE status IN ('open','in_progress')").count;
    const monthLocalEnd = time.fmtLocal(new Date(Date.parse(month.end) - 1), offset, { dateOnly: true });
    const monthVisits = store.get('SELECT COUNT(*) AS count FROM visits WHERE visit_date >= ? AND visit_date <= ?', [
      month.start.slice(0, 10), monthLocalEnd,
    ]).count;
    const feedbackNew = store.get("SELECT COUNT(*) AS count FROM feedback WHERE status = 'new'").count;
    const issues = computeIssues();
    const daily = reports.dailyStallStats(store, today.start, today.end);
    const upcomingVisits = store.all(
      `SELECT v.*, s.name AS stall_name, u.name AS operator_name FROM visits v
       JOIN stalls s ON s.id = v.stall_id JOIN users u ON u.id = v.operator_id
       WHERE v.visit_date >= ? ORDER BY v.visit_date ASC, v.id ASC LIMIT 6`,
      [today.start.slice(0, 10)]
    );
    return {
      today: {
        ...totals,
        stallRows: daily.map((row) => ({
          stallId: row.stall_id, stallName: row.stall_name, operatingStatus: row.operating_status,
          occupancy: row.occupancy, orderCount: row.order_count, pending: row.pending_count,
          active: row.active_count, delivered: row.delivered_count, cancelled: row.cancelled_count,
          refunded: row.refunded_count, deliveredCents: row.delivered_cents,
        })),
        recentOrders: orderRows.slice(0, 8).map((row) => ({
          code: row.code, stallName: row.stall_name, status: row.status, totalCents: row.total_cents,
          localTime: time.fmtLocal(row.created_at, offset, { dateOnly: false }),
        })),
      },
      stalls: {
        total: store.get('SELECT COUNT(*) AS count FROM stalls').count,
        byStatus: statuses,
      },
      openTickets,
      monthVisits,
      feedbackNew,
      issues: { total: issues.length, high: issues.filter((issue) => issue.severity === 'high').length, items: issues.slice(0, 8) },
      upcomingVisits: upcomingVisits.map(visitRow),
      timezone: config.timezoneLabel,
    };
  });

  router.get('/api/operator/stalls', (ctx) => {
    operator(ctx);
    const rows = store.all(
      `SELECT s.*, 
        (SELECT COUNT(*) FROM products p WHERE p.stall_id = s.id AND p.archived = 0) AS product_count,
        (SELECT COUNT(*) FROM orders o WHERE o.stall_id = s.id AND o.status IN ('pending','confirmed','shipped')) AS open_orders,
        (SELECT u.name FROM users u WHERE u.role = 'owner' AND u.stall_id = s.id LIMIT 1) AS owner_name
       FROM stalls s ORDER BY s.id`
    );
    return {
      stalls: rows.map((row) => ({
        id: row.id,
        name: row.name,
        category: row.category,
        location: row.location,
        coverImage: row.cover_image,
        profileImage: row.profile_image,
        operatingStatus: row.operating_status,
        occupancy: row.occupancy,
        productCount: row.product_count,
        openOrders: row.open_orders,
        ownerName: row.owner_name || null,
        owner: row.owner_name ? { name: row.owner_name } : null,
        lease: {
          start: row.lease_start, end: row.lease_end, rentCents: row.lease_rent_cents,
          areaSqm: row.lease_area_sqm, isSample: Boolean(row.lease_is_sample), note: row.lease_note,
        },
      })),
    };
  });

  router.patch('/api/operator/stalls/:id/status', async (ctx) => {
    const actor = operator(ctx);
    const id = Number(ctx.params.id);
    const stall = store.get('SELECT * FROM stalls WHERE id = ?', [id]);
    if (!stall) throw new ApiError(404, 'Stall not found.');
    const body = await ctx.body();
    const status = common.str(body.status, 30);
    if (!['open', 'closed', 'under_maintenance', 'inactive'].includes(status)) {
      throw new ApiError(400, 'Choose Open, Closed, Under Maintenance, or Inactive.', { field: 'status' });
    }
    if (status === stall.operating_status) return { message: 'The stall already has that status.' };
    store.run('UPDATE stalls SET operating_status = ?, updated_at = ? WHERE id = ?', [status, new Date().toISOString(), id]);
    store.logActivity({
      actor, action: 'stall.operating_status', entityType: 'stall', entityId: id,
      details: `${stall.name}: ${stall.operating_status} → ${status}`, ip: http.clientIp(ctx.req),
    });
    const ownerUser = store.get("SELECT id FROM users WHERE role = 'owner' AND stall_id = ?", [id]);
    if (ownerUser) store.notifyUser(ownerUser.id, 'stall_status', 'Stall status changed', `${stall.name} is now ${status.replace(/_/g, ' ')}.`, '/owner/');
    return { message: `${stall.name} set to ${status.replace(/_/g, ' ')}.` };
  });

  router.get('/api/operator/orders', (ctx) => {
    operator(ctx);
    const params = [];
    const where = [];
    const date = common.str(ctx.query.get('date'), 20) || time.todayLocal(config.timezoneOffsetMinutes);
    const range = time.periodRange('daily', date, config.timezoneOffsetMinutes);
    where.push('o.created_at >= ? AND o.created_at < ?');
    params.push(range.start, range.end);
    const status = common.str(ctx.query.get('status'), 20);
    if (status) { where.push('o.status = ?'); params.push(status); }
    const stallId = Number(ctx.query.get('stallId') || 0);
    if (stallId) { where.push('o.stall_id = ?'); params.push(stallId); }
    const q = common.str(ctx.query.get('q'), 60);
    if (q) { where.push('(o.code LIKE ? OR o.customer_name LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
    const rows = store.all(
      `SELECT o.*, s.name AS stall_name, (SELECT COALESCE(SUM(qty),0) FROM order_items WHERE order_id = o.id) AS qty_sum
       FROM orders o JOIN stalls s ON s.id = o.stall_id
       WHERE ${where.join(' AND ')} ORDER BY o.created_at DESC LIMIT 300`,
      params
    );
    return {
      range: { date, start: range.start, end: range.end, timezone: config.timezoneLabel },
      orders: rows.map((row) => ({
        id: row.id, code: row.code, stallId: row.stall_id, stallName: row.stall_name,
        customerLabel: String(row.customer_name || '').split(/\s+/)[0] || 'Customer',
        status: row.status, paymentStatus: row.payment_status, totalCents: row.total_cents,
        quantity: Number(row.qty_sum || 0), isSample: Boolean(row.is_sample),
        localTime: time.fmtLocal(row.created_at, config.timezoneOffsetMinutes),
      })),
      counts: Object.fromEntries(store.all(
        `SELECT status, COUNT(*) AS count FROM orders WHERE created_at >= ? AND created_at < ? GROUP BY status`,
        [range.start, range.end]
      ).map((row) => [row.status, row.count])),
    };
  });

  router.get('/api/operator/issues', (ctx) => {
    operator(ctx);
    const issues = computeIssues();
    return { issues, generatedAt: new Date().toISOString(), notes: ['Issues are derived from current inventory, order ageing, stall status, and open tickets.'] };
  });

  router.get('/api/operator/tickets', (ctx) => {
    operator(ctx);
    const params = [];
    const where = [];
    const status = common.str(ctx.query.get('status'), 20);
    if (status) { where.push('t.status = ?'); params.push(status); }
    const stallId = Number(ctx.query.get('stallId') || 0);
    if (stallId) { where.push('t.stall_id = ?'); params.push(stallId); }
    const rows = store.all(
      `SELECT t.*, s.name AS stall_name, u.name AS assignee_name FROM tickets t
       JOIN stalls s ON s.id = t.stall_id LEFT JOIN users u ON u.id = t.assigned_to
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY t.updated_at DESC LIMIT 200`,
      params
    );
    return {
      tickets: rows.map(ticketRow),
      counts: Object.fromEntries(store.all('SELECT status, COUNT(*) AS count FROM tickets GROUP BY status').map((row) => [row.status, row.count])),
    };
  });

  router.post('/api/operator/tickets', async (ctx) => {
    const actor = operator(ctx);
    const body = await ctx.body();
    const stallId = Number(body.stallId);
    if (!store.get('SELECT id FROM stalls WHERE id = ?', [stallId])) throw new ApiError(404, 'Choose a valid stall.', { field: 'stallId' });
    const title = security.cleanName(body.title, 120);
    if (title.length < 4) throw new ApiError(400, 'Enter a short ticket title.', { field: 'title' });
    const description = security.cleanText(body.description, 2000);
    if (description.length < 1) throw new ApiError(400, 'Describe the issue briefly.', { field: 'description' });
    const category = common.str(body.category, 40) || 'Operations';
    const priority = ['low', 'normal', 'high', 'urgent'].includes(body.priority) ? body.priority : 'normal';
    const now = new Date().toISOString();
    const local = time.localParts(Date.now(), config.timezoneOffsetMinutes);
    const code = nextTicketCode(local.year);
    const result = store.run(
      `INSERT INTO tickets(code, stall_id, title, description, category, priority, status, assigned_to, resolution, created_by, is_sample, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?, '', ?, 0, ?, ?)`,
      [code, stallId, title, description, category, priority, Number(body.assignToSelf) ? actor.id : null, actor.id, now, now]
    );
    store.logActivity({ actor, action: 'ticket.create', entityType: 'ticket', entityId: code, details: title, ip: http.clientIp(ctx.req) });
    return { id: Number(result.lastInsertRowid), code, message: `Ticket ${code} created.` };
  });

  router.patch('/api/operator/tickets/:id', async (ctx) => {
    const actor = operator(ctx);
    const id = Number(ctx.params.id);
    const ticket = store.get('SELECT * FROM tickets WHERE id = ?', [id]);
    if (!ticket) throw new ApiError(404, 'Ticket not found.');
    const body = await ctx.body();
    const status = body.status === undefined ? ticket.status : common.str(body.status, 20);
    if (!['open', 'in_progress', 'resolved', 'closed'].includes(status)) throw new ApiError(400, 'Choose a valid ticket status.', { field: 'status' });
    const priority = body.priority === undefined ? ticket.priority : common.str(body.priority, 20);
    if (!['low', 'normal', 'high', 'urgent'].includes(priority)) throw new ApiError(400, 'Choose a valid priority.', { field: 'priority' });
    const resolution = body.resolution === undefined ? ticket.resolution : security.cleanText(body.resolution, 2000);
    let assignedTo = ticket.assigned_to;
    if (body.assignToMe === true) assignedTo = actor.id;
    if (body.assignedTo === null) assignedTo = null;
    if (body.assignedTo !== undefined && body.assignedTo !== null) {
      const assignee = store.get("SELECT id FROM users WHERE id = ? AND role IN ('operator','admin') AND status = 'active'", [Number(body.assignedTo)]);
      if (!assignee) throw new ApiError(400, 'Choose an active staff member.', { field: 'assignedTo' });
      assignedTo = assignee.id;
    }
    if ((status === 'resolved' || status === 'closed') && !resolution.trim()) {
      throw new ApiError(400, 'Add a resolution note before resolving or closing a ticket.', { field: 'resolution' });
    }
    store.run(
      'UPDATE tickets SET status = ?, priority = ?, resolution = ?, assigned_to = ?, updated_at = ? WHERE id = ?',
      [status, priority, resolution, assignedTo, new Date().toISOString(), id]
    );
    store.logActivity({ actor, action: 'ticket.update', entityType: 'ticket', entityId: ticket.code, details: `${ticket.status} → ${status}`, ip: http.clientIp(ctx.req) });
    return { message: `Ticket ${ticket.code} updated.` };
  });

  router.get('/api/operator/visits', (ctx) => {
    operator(ctx);
    const params = [];
    const where = [];
    const stallId = Number(ctx.query.get('stallId') || 0);
    if (stallId) { where.push('v.stall_id = ?'); params.push(stallId); }
    const month = common.str(ctx.query.get('month'), 10);
    if (month) {
      const range = time.periodRange('monthly', month, config.timezoneOffsetMinutes);
      where.push('v.visit_date >= ? AND v.visit_date <= ?');
      params.push(range.start.slice(0, 10), time.fmtLocal(new Date(Date.parse(range.end) - 1), config.timezoneOffsetMinutes, { dateOnly: true }));
    }
    const rows = store.all(
      `SELECT v.*, s.name AS stall_name, u.name AS operator_name FROM visits v
       JOIN stalls s ON s.id = v.stall_id JOIN users u ON u.id = v.operator_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY v.visit_date DESC, v.id DESC LIMIT 200`,
      params
    );
    const counts = store.all(
      `SELECT substr(visit_date,1,7) AS month, COUNT(*) AS count FROM visits GROUP BY month ORDER BY month DESC LIMIT 12`
    );
    return { visits: rows.map(visitRow), monthlyCounts: counts };
  });

  router.post('/api/operator/visits', async (ctx) => {
    const actor = operator(ctx);
    const body = await ctx.body();
    const stallId = Number(body.stallId);
    if (!store.get('SELECT id FROM stalls WHERE id = ?', [stallId])) throw new ApiError(404, 'Choose a valid stall.', { field: 'stallId' });
    const visitDate = common.str(body.visitDate, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(visitDate)) throw new ApiError(400, 'Choose a valid visit date.', { field: 'visitDate' });
    const purpose = security.cleanText(body.purpose, 160);
    if (purpose.length < 3) throw new ApiError(400, 'Describe the purpose of the visit.', { field: 'purpose' });
    const followUp = body.followUpStatus === undefined ? 'pending' : common.str(body.followUpStatus, 20);
    if (!['pending', 'in_progress', 'closed'].includes(followUp)) throw new ApiError(400, 'Choose a valid follow-up status.', { field: 'followUpStatus' });
    const now = new Date().toISOString();
    const result = store.run(
      `INSERT INTO visits(stall_id, operator_id, visit_date, purpose, observations, issues, recommended_actions, follow_up_status, is_sample, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [stallId, actor.id, visitDate, purpose, security.cleanText(body.observations, 2000),
        security.cleanText(body.issues, 1000), security.cleanText(body.recommendedActions, 1000), followUp, now, now]
    );
    store.logActivity({ actor, action: 'visit.create', entityType: 'visit', entityId: result.lastInsertRowid, details: `${visitDate}: ${purpose}`, ip: http.clientIp(ctx.req) });
    return { id: Number(result.lastInsertRowid), message: 'Visit record saved.' };
  });

  router.patch('/api/operator/visits/:id', async (ctx) => {
    const actor = operator(ctx);
    const id = Number(ctx.params.id);
    const visit = store.get('SELECT * FROM visits WHERE id = ?', [id]);
    if (!visit) throw new ApiError(404, 'Visit not found.');
    if (visit.operator_id !== actor.id) throw new ApiError(403, 'You can only edit visits that you recorded.');
    const body = await ctx.body();
    const followUp = body.followUpStatus === undefined ? visit.follow_up_status : common.str(body.followUpStatus, 20);
    if (!['pending', 'in_progress', 'closed'].includes(followUp)) throw new ApiError(400, 'Choose a valid follow-up status.', { field: 'followUpStatus' });
    store.run(
      `UPDATE visits SET observations = ?, issues = ?, recommended_actions = ?, follow_up_status = ?, updated_at = ? WHERE id = ?`,
      [security.cleanText(body.observations ?? visit.observations, 2000),
        security.cleanText(body.issues ?? visit.issues, 1000),
        security.cleanText(body.recommendedActions ?? visit.recommended_actions, 1000),
        followUp, new Date().toISOString(), id]
    );
    store.logActivity({ actor, action: 'visit.update', entityType: 'visit', entityId: id, details: `Follow-up: ${followUp}`, ip: http.clientIp(ctx.req) });
    return { message: 'Visit record updated.' };
  });

  router.get('/api/operator/leases', (ctx) => {
    operator(ctx);
    const rows = store.all('SELECT * FROM stalls ORDER BY id');
    return {
      leases: rows.map((row) => ({
        stallId: row.id, stallName: row.name, occupancy: row.occupancy,
        leaseStart: row.lease_start, leaseEnd: row.lease_end, rentCents: row.lease_rent_cents,
        areaSqm: row.lease_area_sqm, isSample: Boolean(row.lease_is_sample), note: row.lease_note,
      })),
      notes: [
        'Lease figures in this demo are clearly labelled sample records.',
        'Operators can view lease and space data but cannot change rent, ownership, or commission settings.',
      ],
    };
  });

  router.get('/api/operator/reports', (ctx) => {
    const actor = operator(ctx);
    const range = common.resolveRange(ctx.query, config.timezoneOffsetMinutes);
    const report = sanitizeReport(reports.buildReport({
      db: store, offsetMinutes: config.timezoneOffsetMinutes, range, includeBreakdown: true,
    }));
    const token = reportTokens.store(report, { kind: 'operator', userId: actor.id, start: range.start, end: range.end });
    return { ...report, previewToken: token, previewExpiresInSeconds: 900 };
  });

  router.get('/api/operator/reports.csv', (ctx) => {
    const actor = operator(ctx);
    const range = common.resolveRange(ctx.query, config.timezoneOffsetMinutes);
    const meta = { kind: 'operator', userId: actor.id, start: range.start, end: range.end };
    const preview = reportTokens.consume(ctx.query.get('preview'), meta);
    if (!preview) throw new ApiError(400, 'Preview this report before exporting it. The preview link expires after 15 minutes.');
    const csv = reports.buildReportCsv(preview);
    http.sendText(ctx.res, 200, csv, 'text/csv; charset=utf-8', {
      'Content-Disposition': `attachment; filename="skyworld-operator-${range.value.replace(/[^0-9A-Za-z-]+/g, '_')}.csv"`,
      'Cache-Control': 'no-store',
    });
    return undefined;
  });

  router.get('/api/operator/feedback', (ctx) => {
    operator(ctx);
    const status = common.str(ctx.query.get('status'), 20);
    const params = [];
    let where = '';
    if (status) { where = 'WHERE status = ?'; params.push(status); }
    const rows = store.all(`SELECT * FROM feedback ${where} ORDER BY created_at DESC LIMIT 100`, params);
    return {
      feedback: rows.map((row) => ({
        id: row.id, name: row.name, contact: row.contact, subject: row.subject, message: row.message,
        status: row.status, localDateTime: time.fmtLocal(row.created_at, config.timezoneOffsetMinutes),
      })),
      counts: Object.fromEntries(store.all('SELECT status, COUNT(*) AS count FROM feedback GROUP BY status').map((row) => [row.status, row.count])),
      notes: ['Operators can mark feedback as reviewed or resolved for monitoring. Deleting feedback is an administrator action.'],
    };
  });

  router.patch('/api/operator/feedback/:id', async (ctx) => {
    const actor = operator(ctx);
    const id = Number(ctx.params.id);
    const row = store.get('SELECT * FROM feedback WHERE id = ?', [id]);
    if (!row) throw new ApiError(404, 'Feedback not found.');
    const body = await ctx.body();
    const status = common.str(body.status, 20);
    if (!['reviewed', 'resolved'].includes(status)) throw new ApiError(400, 'Operators can mark feedback reviewed or resolved.', { field: 'status' });
    store.run('UPDATE feedback SET status = ? WHERE id = ?', [status, id]);
    store.logActivity({ actor, action: 'feedback.monitor', entityType: 'feedback', entityId: id, details: `${row.status} → ${status}`, ip: http.clientIp(ctx.req) });
    return { message: 'Feedback status updated.' };
  });

  router.get('/api/operator/logs', (ctx) => {
    const actor = operator(ctx);
    const limit = http.numberParam(ctx.query.get('limit'), 100, 1, 300);
    const rows = store.all(
      'SELECT * FROM activity_logs WHERE actor_id = ? ORDER BY id DESC LIMIT ?',
      [actor.id, limit]
    );
    return {
      logs: rows.map((row) => ({
        id: row.id, action: row.action, entityType: row.entity_type, entityId: row.entity_id,
        details: row.details, ip: row.ip, createdAt: row.created_at,
        localDateTime: time.fmtLocal(row.created_at, config.timezoneOffsetMinutes),
      })),
      notes: ['This view shows only actions performed by your operator account.'],
    };
  });
}

module.exports = { registerRoutes };
