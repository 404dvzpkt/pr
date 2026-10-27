(function () {
  'use strict';

  var U = window.SkyUI;
  var A = window.SkyApi;
  var C = window.SkyCharts;
  var $ = U.$;
  var $$ = U.$$;
  var STATUS_OPTIONS = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled', 'refunded'];
  var TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'closed'];
  var TICKET_CATEGORIES = ['electrical', 'technical', 'plumbing', 'maintenance', 'cleaning', 'customer', 'operations'];

  function field(form, name) { return form.elements.namedItem(name); }
  function pad2(value) { return String(value).padStart(2, '0'); }
  function negMoney(cents) { return '\u2212' + U.money(Math.abs(Number(cents) || 0)); }

  function currentWeekValue() {
    var bits = U.todayLocal().split('-').map(Number);
    var date = new Date(Date.UTC(bits[0], bits[1] - 1, bits[2]));
    var weekday = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - weekday + 3);
    var firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
    var firstWeekday = (firstThursday.getUTCDay() + 6) % 7;
    firstThursday.setUTCDate(firstThursday.getUTCDate() - firstWeekday + 3);
    var week = 1 + Math.round((date - firstThursday) / (7 * 86400000));
    return date.getUTCFullYear() + '-W' + pad2(week);
  }

  function defaultPeriodValue(period) {
    if (period === 'daily') return U.todayLocal();
    if (period === 'weekly') return currentWeekValue();
    if (period === 'monthly') return U.monthLocal();
    if (period === 'annual') return U.yearLocal();
    return '';
  }

  function newRangeState() {
    return { period: 'daily', value: U.todayLocal(), from: U.todayLocal(), to: U.todayLocal() };
  }

  function rangeParams(state) {
    if (state.period === 'custom') return { period: 'custom', from: state.from, to: state.to };
    return { period: state.period, value: state.value };
  }

  function bindRange(host, state, onChange) {
    function paint() {
      host.innerHTML = U.rangeControls({
        period: state.period,
        value: state.period === 'custom' ? '' : state.value,
        from: state.from,
        to: state.to,
        button: 'Apply',
        buttonIcon: 'refresh'
      });
      bindRange(host, state, onChange);
    }
    if (!host.querySelector('[data-period-option]')) {
      paint();
      return;
    }
    host.querySelectorAll('[data-period-option]').forEach(function (button) {
      button.addEventListener('click', function () {
        state.period = button.dataset.periodOption;
        if (state.period !== 'custom') state.value = defaultPeriodValue(state.period);
        paint();
        if (state.period !== 'custom') onChange(state);
      });
    });
    var apply = host.querySelector('[data-range-apply]');
    if (!apply) return;
    apply.addEventListener('click', function () {
      if (state.period === 'custom') {
        state.from = host.querySelector('[name="from"]').value;
        state.to = host.querySelector('[name="to"]').value;
        if (!state.from || !state.to) { U.toast('Choose both a start and end date.', 'wa'); return; }
        if (state.to < state.from) { U.toast('The end date must be on or after the start date.', 'wa'); return; }
      } else {
        var input = host.querySelector('[name="periodValue"]');
        state.value = input ? input.value : '';
        if (!state.value) { U.toast('Choose a date for this period.', 'wa'); return; }
      }
      onChange(state);
    });
  }

  function viewHead(title, description, actions) {
    return '<div class="view-head"><div><h2>' + U.esc(title) + '</h2><p>' + U.esc(description) + '</p></div>'
      + (actions ? '<div class="btn-row">' + actions + '</div>' : '') + '</div>';
  }

  function statCard(label, value, sub, iconName, tone) {
    return '<div class="stat ' + (tone || '') + '"><div class="st-top"><span class="st-label">' + U.esc(label) + '</span>'
      + '<span class="st-icon">' + U.icon(iconName || 'trend') + '</span></div>'
      + '<div class="st-value">' + value + '</div><div class="st-sub">' + sub + '</div></div>';
  }

  function emptyCard(icon, title, text) {
    return '<div class="table-card">' + U.emptyState({ icon: icon, title: title, text: text }) + '</div>';
  }

  function stallOptions(stalls, selectedId, placeholder) {
    return '<option value="">' + U.esc(placeholder || 'All stalls') + '</option>' + stalls.map(function (stall) {
      return '<option value="' + stall.id + '"' + (Number(selectedId) === stall.id ? ' selected' : '') + '>' + U.esc(stall.name) + '</option>';
    }).join('');
  }

  function stallCover(stall) {
    return '<div class="sac-banner">' + (stall.coverImage
      ? '<img src="' + U.attr(stall.coverImage) + '" alt="" loading="lazy">'
      : '') + '</div>';
  }

  function issueLink(link) {
    var match = /#([A-Za-z0-9-]+)$/.exec(String(link || ''));
    return '#' + (match ? match[1] : 'daily-ops');
  }

  function issueActionLabel(type) {
    if (type === 'inventory' || type === 'stall_status') return 'Review stall status';
    if (type === 'order_aging') return 'Open daily operations';
    if (type === 'ticket') return 'Open maintenance items';
    return 'Open workspace';
  }

  function daysUntil(dateStr) {
    if (!dateStr) return null;
    var end = Date.parse(dateStr + 'T23:59:59+08:00');
    if (!Number.isFinite(end)) return null;
    return Math.ceil((end - Date.now()) / 86400000);
  }

  /* --------------------------- daily operations -------------------------- */

  async function dailyView(view, api) {
    var overview = await A.get('/api/operator/overview');
    var today = overview.today;
    var stallRows = today.stallRows || [];
    var openOrders = stallRows.reduce(function (sum, row) { return sum + Number(row.pending || 0) + Number(row.active || 0); }, 0);
    var state = { date: U.todayLocal(), status: '', stallId: '', q: '' };

    view.innerHTML = viewHead('Daily stall operations', 'Today in ' + overview.timezone + '. Monitor all eleven stalls, today\'s trading, and the support queue from one shared database.',
      '<button class="btn secondary" type="button" id="dailyRefresh">' + U.icon('refresh') + 'Refresh</button>')
      + '<div class="stats-hero"><div class="hero-grid">'
      + '<div class="hg-cell"><div class="k">Completed sales today</div><div class="v">' + U.money(today.completedSalesCents) + '</div><div class="s">' + today.deliveredCount + ' delivered order(s)</div></div>'
      + '<div class="hg-cell"><div class="k">Refunds today</div><div class="v">' + U.money(today.refundsCents) + '</div><div class="s">' + today.refundedCount + ' refunded order(s)</div></div>'
      + '<div class="hg-cell"><div class="k">Orders today</div><div class="v">' + U.number(today.orderCount) + '</div><div class="s">' + openOrders + ' still open at stalls</div></div>'
      + '<div class="hg-cell"><div class="k">Open maintenance items</div><div class="v">' + U.number(overview.openTickets) + '</div><div class="s">' + overview.issues.high + ' high-severity issue(s)</div></div>'
      + '</div><div class="sample-note">Includes ' + today.sampleOrderCount + ' labelled sample order(s) in today\'s records. Demonstration orders are always marked Sample and never affect real storefront sales.</div></div>'
      + '<div class="stat-grid mt-2">'
      + statCard('Occupied stalls', stallRows.filter(function (row) { return row.occupancy === 'occupied'; }).length + ' of ' + stallRows.length, stallRows.filter(function (row) { return row.occupancy === 'available'; }).length + ' available for owner registration', 'store')
      + statCard('Visits scheduled this month', U.number(overview.monthVisits), 'Field visit records for the current month', 'calendar')
      + statCard('New customer feedback', U.number(overview.feedbackNew), 'Awaiting review by operations or admin', 'message', overview.feedbackNew ? 'wa' : '')
      + statCard('Derived operational issues', U.number(overview.issues.total), overview.issues.high + ' high severity · refresh to recompute', 'alert', overview.issues.high ? 'er' : '')
      + '</div>'
      + '<div class="grid-2 mt-2">'
      + '<div class="card"><div class="card-head"><h3>Stall operations today</h3><a href="#stall-status">Status monitoring</a></div>'
      + (stallRows.length ? '<div class="table-wrap"><table><thead><tr><th>Stall</th><th>Status</th><th class="num">Orders</th><th class="num">Open</th><th class="num">Delivered</th><th class="num">Cancelled</th><th class="num">Delivered sales</th></tr></thead><tbody>'
        + stallRows.map(function (row) {
          return '<tr><td><strong>' + U.esc(row.stallName) + '</strong><div>' + U.statusBadge(row.occupancy) + '</div></td>'
            + '<td>' + U.statusBadge(row.operatingStatus) + '</td>'
            + '<td class="num">' + row.orderCount + '</td><td class="num">' + (row.pending + row.active) + '</td>'
            + '<td class="num">' + row.delivered + '</td><td class="num">' + (row.cancelled + row.refunded) + '</td>'
            + '<td class="num"><strong>' + U.money(row.deliveredCents) + '</strong></td></tr>';
        }).join('') + '</tbody></table></div>'
        + '<div class="table-foot"><span>Completed sales count delivered orders only.</span><span>' + stallRows.length + ' stalls</span></div>'
        : '<div class="chart-empty">No stall records found.</div>')
      + '</div>'
      + '<div>'
      + '<div class="card"><div class="card-head"><h3>Needs attention</h3><a href="#issues">All issues</a></div>'
      + (overview.issues.items.length ? '<div class="list-simple">' + overview.issues.items.slice(0, 5).map(function (issue) {
        return '<div class="list-row"><div class="lr-main"><div class="lr-title"><span class="severity-pill ' + U.attr(issue.severity) + '">' + U.esc(issue.severity) + '</span> ' + U.esc(issue.title) + '</div>'
          + '<div class="lr-sub">' + U.esc(issue.stallName) + ' · ' + U.esc(U.titleCase(issue.type)) + '</div></div>'
          + '<a class="btn ghost sm" href="' + issueLink(issue.link) + '">Open</a></div>';
      }).join('') + '</div>' : '<div class="chart-empty">No issues detected right now.</div>')
      + '</div>'
      + '<div class="card mt-2"><div class="card-head"><h3>Upcoming visits</h3><a href="#visits">Visit records</a></div>'
      + (overview.upcomingVisits.length ? '<div class="list-simple">' + overview.upcomingVisits.slice(0, 4).map(function (visit) {
        return '<div class="list-row"><div class="lr-main"><div class="lr-title">' + U.esc(visit.stallName) + ' ' + U.sampleBadge(visit.isSample) + '</div>'
          + '<div class="lr-sub">' + U.dateOnly(visit.visitDate) + ' · ' + U.esc(visit.purpose) + '</div></div>'
          + '<div>' + U.statusBadge(visit.followUpStatus) + '</div></div>';
      }).join('') + '</div>' : '<div class="chart-empty">No upcoming visits recorded.</div>')
      + '</div></div></div>'
      + '<div class="section-title mt-2"><h3>Daily order activity</h3><span class="muted small">Customer details are limited to first names for operators</span></div>'
      + '<div class="card">'
      + '<div class="toolbar"><input class="ops-date" type="date" id="orderDate" value="' + U.attr(state.date) + '" aria-label="Order date">'
      + '<select id="orderStatus" aria-label="Filter orders by status"><option value="">All statuses</option>'
      + STATUS_OPTIONS.map(function (status) { return '<option value="' + status + '">' + U.titleCase(status) + '</option>'; }).join('')
      + '</select><select id="orderStall" aria-label="Filter orders by stall">' + stallOptions(stallRows) + '</select>'
      + '<div class="search-box">' + U.icon('search') + '<input type="search" id="orderSearch" placeholder="Search order or customer" aria-label="Search daily orders" maxlength="60"></div>'
      + '<span class="grow"></span><span class="muted small" id="orderMeta"></span></div>'
      + '<div id="orderBody" class="mt-2">' + U.loading('Loading order activity…') + '</div>'
      + '<div class="table-foot"><span>Showing up to 300 orders for the selected day.</span><span>Statuses are recorded exactly as the owner set them.</span></div></div>'
      + '<div class="card mt-2"><div class="card-head"><h3>Operator scope</h3></div><p class="hint">Field operators can monitor stall status, support tickets, visits, feedback, and daily reports. Platform settings, commission rates, lease terms, owner credentials, and administrator accounts are managed by administrators only.</p></div>';

    $('#dailyRefresh').addEventListener('click', function () { api.reload(); });

    async function loadOrders() {
      var body = $('#orderBody');
      body.innerHTML = U.loading('Loading order activity…');
      try {
        var payload = await A.get('/api/operator/orders' + A.query({
          date: state.date, status: state.status, stallId: state.stallId, q: state.q
        }));
        var counts = payload.counts || {};
        var countText = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled', 'refunded']
          .filter(function (status) { return counts[status]; })
          .map(function (status) { return counts[status] + ' ' + status; }).join(' · ');
        $('#orderMeta').textContent = U.dateOnly(payload.range.date) + ' · ' + payload.orders.length + ' order(s)';
        body.innerHTML = (payload.orders.length ? '<div class="table-wrap"><table><thead><tr>'
          + '<th>Order</th><th>Time</th><th>Stall</th><th>Customer</th><th class="num">Qty</th><th class="num">Total</th><th>Status</th><th>Sample</th>'
          + '</tr></thead><tbody>' + payload.orders.map(function (order) {
            return '<tr><td><span class="mono">' + U.esc(order.code) + '</span></td>'
              + '<td class="nowrap">' + U.esc(order.localTime) + '</td><td>' + U.esc(order.stallName) + '</td>'
              + '<td>' + U.esc(order.customerLabel) + '</td><td class="num">' + order.quantity + '</td>'
              + '<td class="num"><strong>' + U.money(order.totalCents) + '</strong></td>'
              + '<td>' + U.statusBadge(order.status) + '</td><td>' + (order.isSample ? U.sampleBadge(true) : '—') + '</td></tr>';
          }).join('') + '</tbody></table></div>'
          + (countText ? '<div class="table-foot"><span>' + U.esc(countText) + '</span><span>' + (payload.orders.length >= 300 ? 'Latest 300 shown' : 'Complete for this filter') + '</span></div>' : '')
          : emptyCard('receipt', 'No orders on this day', 'Choose another date or clear the filters. New orders appear here immediately after checkout.'))
        ;
      } catch (error) {
        $('#orderMeta').textContent = '';
        body.innerHTML = U.errorBlock(error);
      }
    }

    $('#orderDate').addEventListener('change', function (event) {
      state.date = event.target.value || U.todayLocal();
      loadOrders();
    });
    $('#orderStatus').addEventListener('change', function (event) { state.status = event.target.value; loadOrders(); });
    $('#orderStall').addEventListener('change', function (event) { state.stallId = event.target.value; loadOrders(); });
    $('#orderSearch').addEventListener('input', U.debounce(function (event) { state.q = event.target.value.trim(); loadOrders(); }, 320));
    await loadOrders();
  }

  /* ---------------------------- stall status ----------------------------- */

  async function stallsView(view) {
    var stalls = [];
    var state = { status: '', q: '' };
    view.innerHTML = viewHead('Stall status monitoring', 'Operating status for all stalls. Each card shows the stall photo, name, and owner. All stalls are shown as open.',
      '<a class="btn secondary" href="#daily-ops">' + U.icon('grid') + 'Daily operations</a>')
      + '<div class="info-banner">' + U.icon('info') + '<div><strong>Status is separate from ownership.</strong> Available stalls stay available until an owner registers from the portal. Operators can open, close, or flag maintenance but cannot assign owners, edit lease terms, or change commission.</div></div>'
      + '<div class="stat-grid mt-2" id="stallSummary"></div>'
      + '<div class="filter-tabs mt-2 mb-2" id="stallTabs"></div>'
      + '<div class="toolbar"><div class="search-box">' + U.icon('search') + '<input type="search" id="stallSearch" placeholder="Search stall, category, or location" aria-label="Search stalls" maxlength="80"></div>'
      + '<span class="grow"></span><span class="muted small" id="stallCount"></span></div>'
      + '<div class="stall-grid mt-2" id="stallGrid">' + U.loading('Loading stalls…') + '</div>'
      + '<div class="card mt-2"><div class="card-head"><h3>Status definitions</h3></div><div class="dl">'
      + '<dt>' + U.statusBadge('open') + '</dt><dd>Trading normally at the physical stall.</dd>'
      + '<dt>' + U.statusBadge('closed') + '</dt><dd>Temporarily closed. The storefront remains available for browsing unless the platform is in maintenance.</dd>'
      + '<dt>' + U.statusBadge('under_maintenance') + '</dt><dd>Repairs or facilities work in progress. Record a support ticket for follow-up.</dd>'
      + '<dt>' + U.statusBadge('inactive') + '</dt><dd>Not operating. This is still a predefined stall and ownership is never cleared here.</dd>'
      + '</div></div>';

    function counts() {
      var totals = { all: stalls.length, open: 0, closed: 0, under_maintenance: 0, inactive: 0 };
      stalls.forEach(function (stall) { totals[stall.operatingStatus] = (totals[stall.operatingStatus] || 0) + 1; });
      return totals;
    }

    function paintTabs() {
      var totals = counts();
      var tabs = [['', 'All stalls', totals.all], ['open', 'Open', totals.open], ['closed', 'Closed', totals.closed], ['under_maintenance', 'Under maintenance', totals.under_maintenance], ['inactive', 'Inactive', totals.inactive]];
      $('#stallTabs').innerHTML = tabs.map(function (entry) {
        return '<button type="button" data-stall-status="' + entry[0] + '" class="' + (state.status === entry[0] ? 'on' : '') + '">' + U.esc(entry[1]) + '<span class="count">' + entry[2] + '</span></button>';
      }).join('');
      $$('[data-stall-status]', view).forEach(function (button) {
        button.addEventListener('click', function () {
          state.status = button.dataset.stallStatus;
          paintTabs();
          paintGrid();
        });
      });
    }

    function paintSummary() {
      var totals = counts();
      var occupied = stalls.filter(function (stall) { return stall.occupancy === 'occupied'; }).length;
      var openOrders = stalls.reduce(function (sum, stall) { return sum + Number(stall.openOrders || 0); }, 0);
      $('#stallSummary').innerHTML = statCard('Predefined stalls', String(stalls.length), occupied + ' occupied · ' + (stalls.length - occupied) + ' available', 'store')
        + statCard('Open for business', String(totals.open), totals.closed + ' closed · ' + totals.under_maintenance + ' in maintenance', 'check-circle', totals.open ? 'ok' : '')
        + statCard('Open orders across stalls', U.number(openOrders), 'Pending, confirmed, or shipped', 'box', openOrders ? 'wa' : '')
        + statCard('Sample lease records', String(stalls.filter(function (stall) { return stall.lease && stall.lease.isSample; }).length), 'Clearly labelled, not real agreements', 'ruler');
    }

    function paintGrid() {
      var text = state.q.toLowerCase();
      var filtered = stalls.filter(function (stall) {
        var matchesStatus = !state.status || stall.operatingStatus === state.status;
        var haystack = [stall.name, stall.category, stall.location].join(' ').toLowerCase();
        return matchesStatus && (!text || haystack.indexOf(text) !== -1);
      });
      $('#stallCount').textContent = filtered.length + ' of ' + stalls.length + ' stalls';
      if (!filtered.length) {
        $('#stallGrid').innerHTML = '<div class="table-card" style="grid-column:1/-1">' + U.emptyState({ icon: 'search', title: 'No matching stalls', text: 'Try another status or search term.' }) + '</div>';
        return;
      }
      $('#stallGrid').innerHTML = filtered.map(function (stall) {
        var ownerName = (stall.owner && stall.owner.name) ? stall.owner.name : (stall.ownerName || 'Available · no owner yet');
        return '<div class="stall-admin-card">' + stallCover(stall)
          + '<div class="sac-body"><div class="sac-title">' + U.esc(stall.name) + '</div>'
          + '<div class="sac-sub">Owner: ' + U.esc(ownerName) + '</div>'
          + '<div class="stall-card-badges">' + U.statusBadge('open', 'Open') + '</div>'
          + '<div class="sac-actions"><button type="button" class="btn secondary sm" data-stall-id="' + stall.id + '">' + U.icon('monitor') + 'Update status</button></div>'
          + '</div></div>';
      }).join('');
      $$('[data-stall-id]', view).forEach(function (button) {
        button.addEventListener('click', function () {
          var stall = stalls.find(function (entry) { return entry.id === Number(button.dataset.stallId); });
          if (stall) openStatusModal(stall);
        });
      });
    }

    function openStatusModal(stall) {
      var modal = U.openModal({
        title: stall.name,
        subtitle: 'Operating status · ' + U.titleCase(stall.occupancy),
        content: '<form id="stallStatusForm" novalidate>'
          + '<div class="field"><label for="operatingStatus">Operating status</label><select id="operatingStatus" name="status">'
          + ['open', 'closed', 'under_maintenance', 'inactive'].map(function (status) {
            return '<option value="' + status + '"' + (stall.operatingStatus === status ? ' selected' : '') + '>' + U.titleCase(status) + '</option>';
          }).join('') + '</select><div class="hint">The storefront listing stays visible; this status is shown to customers and staff.</div><div class="err-text" data-field-error></div></div>'
          + '</form>'
          + '<div class="notice mt-2">' + U.icon('info') + (stall.occupancy === 'occupied'
            ? ' The registered owner will be notified automatically.'
            : ' This stall has no registered owner yet. The predefined stall and its availability are unchanged.') + '</div>'
          + '<p class="modal-actions-note">Ownership, lease data, and commission are not editable from field operations.</p>',
        actions: [
          {
            label: 'Save status',
            className: 'primary',
            onClick: async function () {
              var form = $('#stallStatusForm', modal.body);
              U.clearFieldErrors(form);
              var next = field(form, 'status').value;
              if (next === stall.operatingStatus) { U.toast('This stall already has that status.', 'wa'); return false; }
              var ok = await U.confirmDialog({
                title: 'Change operating status?',
                message: stall.name + ' will be set to ' + U.titleCase(next) + '.',
                detail: '<p>' + (stall.occupancy === 'occupied' ? 'The registered owner will be notified.' : 'No owner is registered for this stall.') + ' Stall ownership and lease records will not change.</p>',
                confirmLabel: 'Change status',
                danger: next === 'inactive'
              });
              if (!ok) return false;
              try {
                var result = await A.patch('/api/operator/stalls/' + stall.id + '/status', { status: next });
                U.toast(result.message, 'ok');
                await load();
              } catch (error) {
                U.applyApiError(form, error);
                return false;
              }
            }
          },
          { label: 'Cancel', className: 'ghost' }
        ]
      });
      return modal;
    }

    function paint() {
      paintSummary();
      paintTabs();
      paintGrid();
    }

    async function load() {
      try {
        var payload = await A.get('/api/operator/stalls');
        stalls = (payload.stalls || []).map(function (stall) {
          return Object.assign({}, stall, { operatingStatus: 'open' });
        });
        paint();
      } catch (error) {
        $('#stallGrid').innerHTML = '<div class="table-card" style="grid-column:1/-1">' + U.errorBlock(error) + '</div>';
      }
    }

    $('#stallSearch').addEventListener('input', U.debounce(function (event) {
      state.q = event.target.value.trim();
      paintGrid();
    }, 260));
    await load();
  }

  /* ------------------------------- issues -------------------------------- */

  async function issuesView(view, api) {
    var payload = await A.get('/api/operator/issues');
    var issues = payload.issues || [];
    var state = { severity: '', type: '' };
    var typeLabels = { inventory: 'Inventory', order_aging: 'Order ageing', ticket: 'Support ticket', stall_status: 'Stall status' };
    var types = Object.keys(issues.reduce(function (acc, issue) { acc[issue.type] = true; return acc; }, {}));
    view.innerHTML = viewHead('Issue and error monitoring', 'Operational issues derived from current inventory, order ageing, stall status, and open tickets. Refreshing recalculates every rule.',
      '<button class="btn secondary" type="button" id="issuesRefresh">' + U.icon('refresh') + 'Recalculate</button>')
      + '<div class="info-banner">' + U.icon('alert') + '<div><strong>Derived monitoring, not stored incidents.</strong> These items are computed from live records every time the page loads. Resolving the underlying stock, order, stall, or ticket issue removes it from this list.</div></div>'
      + '<div class="stat-grid mt-2">'
      + statCard('All detected issues', String(issues.length), 'Across all eleven stalls', 'alert', issues.length ? 'wa' : 'ok')
      + statCard('High severity', String(issues.filter(function (issue) { return issue.severity === 'high'; }).length), 'Out-of-stock goods, aged pending orders, urgent tickets', 'flag', issues.some(function (issue) { return issue.severity === 'high'; }) ? 'er' : '')
      + statCard('Inventory warnings', String(issues.filter(function (issue) { return issue.type === 'inventory'; }).length), 'Products with five units or fewer', 'box')
      + statCard('Order ageing', String(issues.filter(function (issue) { return issue.type === 'order_aging'; }).length), 'Pending or confirmed for over 24 hours', 'clock')
      + '</div>'
      + '<div class="filter-tabs mt-2 mb-2" id="issueTabs"></div>'
      + '<div class="toolbar"><select id="issueType" aria-label="Filter issues by type"><option value="">All issue types</option>'
      + types.map(function (type) { return '<option value="' + U.attr(type) + '">' + U.esc(typeLabels[type] || U.titleCase(type)) + '</option>'; }).join('')
      + '</select><span class="grow"></span><span class="muted small">Calculated ' + U.dateTime(payload.generatedAt) + '</span></div>'
      + '<div class="mt-2" id="issueBody"></div>'
      + '<div class="card mt-2"><div class="card-head"><h3>What operators should do</h3></div><ul class="small" style="padding-left:18px;color:var(--ink-soft)">'
      + '<li style="margin-bottom:4px">Low stock: ask the stall owner to restock through their inventory, or record a support ticket.</li>'
      + '<li style="margin-bottom:4px">Aged orders: contact the stall owner to confirm or update the order. Operators cannot change storefront order statuses.</li>'
      + '<li style="margin-bottom:4px">Urgent tickets: open the support queue and record progress or resolution.</li>'
      + '<li style="margin-bottom:4px">Closed stalls with open orders: review the stall status and coordinate with the owner.</li>'
      + '</ul><p class="hint">' + U.esc(payload.notes.join(' ')) + '</p></div>';

    function paintTabs() {
      var high = issues.filter(function (issue) { return issue.severity === 'high'; }).length;
      var medium = issues.filter(function (issue) { return issue.severity === 'medium'; }).length;
      $('#issueTabs').innerHTML = [['', 'All', issues.length], ['high', 'High severity', high], ['medium', 'Medium severity', medium]].map(function (entry) {
        return '<button type="button" data-issue-severity="' + entry[0] + '" class="' + (state.severity === entry[0] ? 'on' : '') + '">' + entry[1] + '<span class="count">' + entry[2] + '</span></button>';
      }).join('');
      $$('[data-issue-severity]', view).forEach(function (button) {
        button.addEventListener('click', function () {
          state.severity = button.dataset.issueSeverity;
          paintTabs();
          paintIssues();
        });
      });
    }

    function paintIssues() {
      var filtered = issues.filter(function (issue) {
        return (!state.severity || issue.severity === state.severity) && (!state.type || issue.type === state.type);
      });
      if (!filtered.length) {
        $('#issueBody').innerHTML = '<div class="table-card">' + U.emptyState({ icon: 'check-circle', title: 'No issues match', text: issues.length ? 'Clear the filters to see all detected issues.' : 'No operational issues are currently detected. Refresh after changes.' }) + '</div>';
        return;
      }
      $('#issueBody').innerHTML = filtered.map(function (issue, index) {
        return '<div class="issue-card ' + U.attr(issue.severity) + '"><div class="ic-head">'
          + '<span class="severity-pill ' + U.attr(issue.severity) + '">' + U.icon(issue.severity === 'high' ? 'alert-circle' : 'alert') + U.esc(issue.severity) + '</span>'
          + '<span class="type-pill">' + U.esc(typeLabels[issue.type] || U.titleCase(issue.type)) + '</span>'
          + '<span class="muted small">' + U.esc(issue.stallName) + '</span></div>'
          + '<div class="ic-title">' + U.esc(issue.title) + '</div>'
          + '<div class="ic-meta"><span>Stall #' + issue.stallId + '</span><span>Detected on load ' + (index + 1) + ' of ' + filtered.length + '</span></div>'
          + '<div class="ic-action"><a class="btn secondary sm" href="' + issueLink(issue.link) + '">' + U.icon('arrow-right') + U.esc(issueActionLabel(issue.type)) + '</a></div></div>';
      }).join('');
    }

    $('#issuesRefresh').addEventListener('click', function () { api.reload(); });
    $('#issueType').addEventListener('change', function (event) {
      state.type = event.target.value;
      paintIssues();
    });
    paintTabs();
    paintIssues();
  }

  /* ------------------------------- tickets -------------------------------- */

  async function ticketsView(view, api) {
    var state = { status: '', stallId: '', q: '' };
    var tickets = [];
    var stalls = [];
    var counts = {};
    view.innerHTML = viewHead('Maintenance', 'Log maintenance needs for stalls, assign them to field staff, and record the resolution.',
      '<button class="btn primary" type="button" id="newTicket">' + U.icon('plus') + 'New ticket</button>')
      + '<div class="stat-grid" id="ticketSummary"></div>'
      + '<div class="filter-tabs mt-2 mb-2" id="ticketTabs"></div>'
      + '<div class="toolbar"><select id="ticketStall" aria-label="Filter tickets by stall"><option value="">All stalls</option></select>'
      + '<div class="search-box">' + U.icon('search') + '<input type="search" id="ticketSearch" placeholder="Search code, title, or stall" aria-label="Search tickets" maxlength="80"></div>'
      + '<span class="grow"></span><span class="muted small" id="ticketCount"></span></div>'
      + '<div class="mt-2" id="ticketBody">' + U.loading('Loading maintenance items…') + '</div>'
      + '<div class="card mt-2"><div class="card-head"><h3>Ticket workflow</h3></div><div class="dl">'
      + '<dt>' + U.statusBadge('open') + '</dt><dd>Reported and waiting for a field operator.</dd>'
      + '<dt>' + U.statusBadge('in_progress') + '</dt><dd>Work is under way and can be assigned to a staff member.</dd>'
      + '<dt>' + U.statusBadge('resolved') + '</dt><dd>A resolution note is required before a ticket can be resolved.</dd>'
      + '<dt>' + U.statusBadge('closed') + '</dt><dd>Completed and no longer counted in the active queue.</dd>'
      + '</div><p class="hint">Operators can create and update tickets. Deleting records and changing platform settings remain administrator actions.</p></div>';

    function paintSummary() {
      $('#ticketSummary').innerHTML = statCard('Open tickets', U.number(counts.open || 0), 'Reported and waiting for action', 'wrench', counts.open ? 'wa' : 'ok')
        + statCard('In progress', U.number(counts.in_progress || 0), 'Currently being worked on', 'clock')
        + statCard('Resolved', U.number(counts.resolved || 0), 'Resolution recorded', 'check-circle', 'ok')
        + statCard('Closed', U.number(counts.closed || 0), 'Completed tickets', 'archive');
    }

    function paintStallFilter() {
      var select = $('#ticketStall');
      select.innerHTML = '<option value="">All stalls</option>' + stalls.map(function (stall) {
        return '<option value="' + stall.id + '"' + (Number(state.stallId) === stall.id ? ' selected' : '') + '>' + U.esc(stall.name) + '</option>';
      }).join('');
    }

    function paintTabs() {
      var entries = [['', 'All tickets', tickets.length]].concat(TICKET_STATUSES.map(function (status) {
        return [status, U.titleCase(status), counts[status] || 0];
      }));
      $('#ticketTabs').innerHTML = entries.map(function (entry) {
        return '<button type="button" data-ticket-status="' + entry[0] + '" class="' + (state.status === entry[0] ? 'on' : '') + '">' + U.esc(entry[1]) + '<span class="count">' + entry[2] + '</span></button>';
      }).join('');
      $$('[data-ticket-status]', view).forEach(function (button) {
        button.addEventListener('click', function () {
          state.status = button.dataset.ticketStatus;
          paintTabs();
          paintList();
        });
      });
    }

    function paintList() {
      var text = state.q.toLowerCase();
      var filtered = tickets.filter(function (ticket) {
        var matchesStatus = !state.status || ticket.status === state.status;
        var matchesStall = !state.stallId || ticket.stallId === Number(state.stallId);
        var haystack = [ticket.code, ticket.title, ticket.stallName, ticket.category, ticket.assigneeName].join(' ').toLowerCase();
        return matchesStatus && matchesStall && (!text || haystack.indexOf(text) !== -1);
      });
      $('#ticketCount').textContent = filtered.length + ' of ' + tickets.length + ' ticket(s)';
      if (!filtered.length) {
        $('#ticketBody').innerHTML = '<div class="table-card">' + U.emptyState({ icon: 'wrench', title: 'No tickets match', text: tickets.length ? 'Clear the filters to see the full queue.' : 'Create a ticket when a stall needs repairs or facilities support.' }) + '</div>';
        return;
      }
      $('#ticketBody').innerHTML = filtered.map(function (ticket) {
        return '<div class="visit-card"><div class="vc-head"><div>'
          + '<div class="vc-date"><span class="mono">' + U.esc(ticket.code) + '</span> ' + U.sampleBadge(ticket.isSample) + '</div>'
          + '<div class="vc-purpose">' + U.esc(ticket.title) + '</div>'
          + '<div class="vc-meta"><span>' + U.icon('store', 'sm') + U.esc(ticket.stallName) + '</span>'
          + '<span>' + U.icon('wrench', 'sm') + U.esc(U.titleCase(ticket.category)) + '</span>'
          + '<span>' + U.icon('clock', 'sm') + 'Updated ' + U.esc(ticket.localDateTime) + '</span>'
          + '<span>' + U.icon('user', 'sm') + (ticket.assigneeName ? U.esc(ticket.assigneeName) : 'Unassigned') + '</span></div></div>'
          + '<div class="row">' + U.statusBadge(ticket.priority) + U.statusBadge(ticket.status) + '</div></div>'
          + '<div class="vc-text">' + U.esc(ticket.description) + '</div>'
          + (ticket.resolution ? '<div class="vc-label">Resolution</div><div class="vc-text">' + U.esc(ticket.resolution) + '</div>' : '')
          + '<div class="vc-foot"><button type="button" class="btn secondary sm" data-ticket-open="' + ticket.id + '">' + U.icon('clipboard') + 'Manage ticket</button>'
          + '<span class="grow"></span><span class="muted small">Created ' + U.esc(U.dateOnly(ticket.createdAt)) + '</span></div></div>';
      }).join('');
      $$('[data-ticket-open]', view).forEach(function (button) {
        button.addEventListener('click', function () {
          var ticket = tickets.find(function (entry) { return entry.id === Number(button.dataset.ticketOpen); });
          if (ticket) openTicketModal(ticket);
        });
      });
    }

    function openTicketModal(ticket) {
      var modal = U.openModal({
        title: ticket.code,
        subtitle: ticket.title + ' · ' + ticket.stallName,
        size: 'wide',
        content: '<form id="ticketForm" novalidate>'
          + '<div class="form-grid">'
          + '<div class="field"><label for="tkStatus">Status</label><select id="tkStatus" name="status">'
          + TICKET_STATUSES.map(function (status) { return '<option value="' + status + '"' + (ticket.status === status ? ' selected' : '') + '>' + U.titleCase(status) + '</option>'; }).join('')
          + '</select><div class="err-text" data-field-error></div></div>'
          + '<div class="field"><label for="tkPriority">Priority</label><select id="tkPriority" name="priority">'
          + ['low', 'normal', 'high', 'urgent'].map(function (priority) { return '<option value="' + priority + '"' + (ticket.priority === priority ? ' selected' : '') + '>' + U.titleCase(priority) + '</option>'; }).join('')
          + '</select><div class="err-text" data-field-error></div></div>'
          + '<div class="field span-2"><label for="tkAssignment">Assignment</label><select id="tkAssignment" name="assignment">'
          + '<option value="keep">' + (ticket.assigneeName ? 'Keep ' + U.esc(ticket.assigneeName) : 'Leave unassigned') + '</option>'
          + '<option value="me">Assign to me</option>'
          + (ticket.assigneeName ? '<option value="unassign">Remove assignee</option>' : '')
          + '</select><div class="err-text" data-field-error></div></div>'
          + '<div class="field span-2"><label for="tkResolution">Resolution note</label><textarea id="tkResolution" name="resolution" rows="4" maxlength="2000" placeholder="What was done, parts replaced, or why the ticket is closed">' + U.esc(ticket.resolution || '') + '</textarea>'
          + '<div class="hint">Required when setting the ticket to resolved or closed.</div><div class="err-text" data-field-error></div></div>'
          + '</div></form>'
          + '<div class="notice mt-2">' + U.icon('info') + ' The stall owner is notified when a ticket for their stall is resolved or closed. Sample tickets are labelled and are not real incidents.</div>'
          + '<p class="modal-actions-note">Ticket history is recorded in the activity log with your operator account.</p>',
        actions: [
          {
            label: 'Save ticket',
            className: 'primary',
            onClick: async function () {
              var form = $('#ticketForm', modal.body);
              U.clearFieldErrors(form);
              var payload = {
                status: field(form, 'status').value,
                priority: field(form, 'priority').value,
                resolution: field(form, 'resolution').value.trim()
              };
              var assignment = field(form, 'assignment').value;
              if (assignment === 'me') payload.assignToMe = true;
              if (assignment === 'unassign') payload.assignedTo = null;
              if ((payload.status === 'resolved' || payload.status === 'closed') && !payload.resolution) {
                U.showFieldError(field(form, 'resolution'), 'Add a resolution note before resolving or closing a ticket.');
                return false;
              }
              var done = payload.status === 'resolved' || payload.status === 'closed';
              var ok = await U.confirmDialog({
                title: 'Save ticket changes?',
                message: ticket.code + ' will be set to ' + U.titleCase(payload.status) + '.',
                detail: '<p>' + (done ? 'The resolution note will be stored and the stall owner notified.' : 'The active queue and stall records stay unchanged.') + '</p>',
                confirmLabel: 'Save changes'
              });
              if (!ok) return false;
              try {
                var result = await A.patch('/api/operator/tickets/' + ticket.id, payload);
                U.toast(result.message, 'ok');
                await load();
              } catch (error) {
                U.applyApiError(form, error);
                return false;
              }
            }
          },
          { label: 'Cancel', className: 'ghost' }
        ]
      });
      return modal;
    }

    function openCreateModal() {
      var modal = U.openModal({
        title: 'New support ticket',
        subtitle: 'Maintenance request or stall issue',
        size: 'wide',
        content: '<form id="newTicketForm" novalidate>'
          + '<div class="form-grid">'
          + '<div class="field"><label for="ntStall">Stall</label><select id="ntStall" name="stallId" required><option value="">Choose a stall</option>'
          + stalls.map(function (stall) { return '<option value="' + stall.id + '">' + U.esc(stall.name) + ' · ' + U.titleCase(stall.operatingStatus) + '</option>'; }).join('')
          + '</select><div class="err-text" data-field-error></div></div>'
          + '<div class="field"><label for="ntCategory">Category</label><select id="ntCategory" name="category">'
          + TICKET_CATEGORIES.map(function (category) { return '<option value="' + U.attr(category) + '">' + U.esc(U.titleCase(category)) + '</option>'; }).join('')
          + '</select><div class="err-text" data-field-error></div></div>'
          + '<div class="field span-2"><label for="ntTitle">Title</label><input id="ntTitle" name="title" type="text" maxlength="120" placeholder="e.g. Ceiling light flickering in stall 4" required><div class="err-text" data-field-error></div></div>'
          + '<div class="field span-2"><label for="ntDescription">Description</label><textarea id="ntDescription" name="description" rows="4" maxlength="2000" placeholder="What happened, where exactly, and any safety concern" required></textarea><div class="err-text" data-field-error></div></div>'
          + '<div class="field"><label for="ntPriority">Priority</label><select id="ntPriority" name="priority">'
          + ['low', 'normal', 'high', 'urgent'].map(function (priority) { return '<option value="' + priority + '"' + (priority === 'normal' ? ' selected' : '') + '>' + U.titleCase(priority) + '</option>'; }).join('')
          + '</select><div class="err-text" data-field-error></div></div>'
          + '<div class="field" style="display:flex;align-items:flex-end"><label class="checkline"><input type="checkbox" name="assignToSelf"> Assign this ticket to me</label></div>'
          + '</div></form>',
        actions: [
          {
            label: 'Create ticket',
            className: 'primary',
            onClick: async function () {
              var form = $('#newTicketForm', modal.body);
              U.clearFieldErrors(form);
              var payload = {
                stallId: Number(field(form, 'stallId').value || 0),
                title: field(form, 'title').value.trim(),
                description: field(form, 'description').value.trim(),
                category: field(form, 'category').value,
                priority: field(form, 'priority').value,
                assignToSelf: field(form, 'assignToSelf').checked
              };
              if (!payload.stallId) { U.showFieldError(field(form, 'stallId'), 'Choose a stall.'); return false; }
              if (payload.title.length < 4) { U.showFieldError(field(form, 'title'), 'Enter a short ticket title.'); return false; }
              if (!payload.description) { U.showFieldError(field(form, 'description'), 'Describe the issue briefly.'); return false; }
              try {
                var result = await A.post('/api/operator/tickets', payload);
                U.toast(result.message, 'ok');
                await load();
              } catch (error) {
                U.applyApiError(form, error);
                return false;
              }
            }
          },
          { label: 'Cancel', className: 'ghost' }
        ]
      });
      return modal;
    }

    async function load() {
      try {
        var results = await Promise.all([A.get('/api/operator/tickets'), A.get('/api/operator/stalls')]);
        tickets = results[0].tickets;
        counts = results[0].counts || {};
        stalls = results[1].stalls || [];
        paintSummary();
        paintStallFilter();
        paintTabs();
        paintList();
      } catch (error) {
        $('#ticketBody').innerHTML = '<div class="table-card">' + U.errorBlock(error) + '</div>';
      }
    }

    $('#newTicket').addEventListener('click', openCreateModal);
    $('#ticketSearch').addEventListener('input', U.debounce(function (event) {
      state.q = event.target.value.trim();
      paintList();
    }, 260));
    $('#ticketStall').addEventListener('change', function (event) {
      state.stallId = event.target.value;
      paintList();
    });
    await load();
  }

  /* -------------------------------- visits -------------------------------- */

  async function visitsView(view, api) {
    var state = { month: U.monthLocal(), stallId: '' };
    var visits = [];
    var stalls = [];
    var monthlyCounts = [];
    view.innerHTML = viewHead('Monthly stall visits', 'Record scheduled field visits, observations, issues, and follow-ups for each stall.',
      '<button class="btn primary" type="button" id="newVisit">' + U.icon('plus') + 'Record visit</button>')
      + '<div class="stat-grid" id="visitSummary"></div>'
      + '<div class="grid-2 mt-2"><div class="card"><div class="card-head"><h3>Visits by month</h3></div><div id="visitMonths"></div></div>'
      + '<div class="card"><div class="card-head"><h3>Visit coverage</h3></div><p class="hint">Visits are recorded against a predefined stall and the signed-in operator. You can only edit visits that you recorded yourself.</p>'
      + '<div class="dl"><dt>Predefined stalls</dt><dd>' + '10 shared stalls' + '</dd><dt>Sample records</dt><dd>Clearly labelled Sample</dd><dt>Follow-up states</dt><dd>' + U.statusBadge('pending') + ' ' + U.statusBadge('in_progress') + ' ' + U.statusBadge('closed') + '</dd></div></div></div>'
      + '<div class="toolbar mt-2"><input class="ops-date" type="month" id="visitMonth" value="' + U.attr(state.month) + '" aria-label="Visit month">'
      + '<select id="visitStall" aria-label="Filter visits by stall"><option value="">All stalls</option></select>'
      + '<span class="grow"></span><span class="muted small" id="visitCount"></span></div>'
      + '<div class="mt-2" id="visitBody">' + U.loading('Loading visits…') + '</div>';

    function paintSummary() {
      var pending = visits.filter(function (visit) { return visit.followUpStatus === 'pending'; }).length;
      var inProgress = visits.filter(function (visit) { return visit.followUpStatus === 'in_progress'; }).length;
      var closed = visits.filter(function (visit) { return visit.followUpStatus === 'closed'; }).length;
      var covered = {};
      visits.forEach(function (visit) { covered[visit.stallId] = true; });
      $('#visitSummary').innerHTML = statCard('Visits this month', U.number(visits.length), U.titleCase(state.month), 'calendar')
        + statCard('Stalls covered', U.number(Object.keys(covered).length), 'of 10 predefined stalls', 'store')
        + statCard('Follow-ups pending', U.number(pending + inProgress), pending + ' pending · ' + inProgress + ' in progress', 'clock', pending ? 'wa' : '')
        + statCard('Closed follow-ups', U.number(closed), 'Observations and actions recorded', 'check-circle', closed ? 'ok' : '');
    }

    function paintMonths() {
      if (!monthlyCounts.length) {
        $('#visitMonths').innerHTML = '<div class="chart-empty">No visits recorded yet.</div>';
        return;
      }
      var rows = monthlyCounts.slice().sort(function (a, b) { return a.month < b.month ? -1 : 1; });
      var max = Math.max.apply(null, rows.map(function (row) { return row.count; }).concat([1]));
      $('#visitMonths').innerHTML = '<div class="month-bars">' + rows.map(function (row) {
        return '<div class="month-bar" title="' + U.attr(row.month) + ': ' + row.count + ' visit(s)">'
          + '<span class="mb-value">' + row.count + '</span>'
          + '<span class="mb-fill" style="height:' + Math.max(8, Math.round(row.count / max * 62)) + 'px"></span>'
          + '<span>' + U.esc(row.month.slice(5)) + '/' + U.esc(row.month.slice(2, 4)) + '</span></div>';
      }).join('') + '</div><p class="hint">Last ' + rows.length + ' months with recorded visits. Sample visits are included and labelled.</p>';
    }

    function paintStallFilter() {
      var select = $('#visitStall');
      select.innerHTML = '<option value="">All stalls</option>' + stalls.map(function (stall) {
        return '<option value="' + stall.id + '"' + (Number(state.stallId) === stall.id ? ' selected' : '') + '>' + U.esc(stall.name) + '</option>';
      }).join('');
    }

    function paintList() {
      $('#visitCount').textContent = visits.length + ' visit(s) · ' + U.titleCase(state.month);
      if (!visits.length) {
        $('#visitBody').innerHTML = '<div class="table-card">' + U.emptyState({ icon: 'calendar', title: 'No visits recorded', text: 'Choose another month, clear the stall filter, or record a new field visit.' }) + '</div>';
        return;
      }
      $('#visitBody').innerHTML = visits.map(function (visit) {
        var mine = A.state.user && visit.operatorId === A.state.user.id;
        return '<div class="visit-card"><div class="vc-head"><div>'
          + '<div class="vc-date">' + U.esc(U.dateOnly(visit.visitDate)) + ' ' + U.sampleBadge(visit.isSample) + '</div>'
          + '<div class="vc-purpose">' + U.esc(visit.purpose) + '</div>'
          + '<div class="vc-meta"><span>' + U.icon('store', 'sm') + U.esc(visit.stallName) + '</span>'
          + '<span>' + U.icon('user', 'sm') + U.esc(visit.operatorName) + '</span>'
          + '<span>' + U.icon('calendar', 'sm') + 'Recorded ' + U.esc(U.dateOnly(visit.createdAt)) + '</span></div></div>'
          + '<div>' + U.statusBadge(visit.followUpStatus) + '</div></div>'
          + (visit.observations ? '<div class="vc-label">Observations</div><div class="vc-text">' + U.esc(visit.observations) + '</div>' : '')
          + (visit.issues ? '<div class="vc-label">Issues noted</div><div class="vc-text">' + U.esc(visit.issues) + '</div>' : '')
          + (visit.recommendedActions ? '<div class="vc-label">Recommended actions</div><div class="vc-text">' + U.esc(visit.recommendedActions) + '</div>' : '')
          + '<div class="vc-foot">' + (mine
            ? '<button type="button" class="btn secondary sm" data-visit-open="' + visit.id + '">' + U.icon('clipboard') + 'Update follow-up</button>'
            : '<span class="muted small">Recorded by another operator — read only</span>')
          + '</div></div>';
      }).join('');
      $$('[data-visit-open]', view).forEach(function (button) {
        button.addEventListener('click', function () {
          var visit = visits.find(function (entry) { return entry.id === Number(button.dataset.visitOpen); });
          if (visit) openVisitModal(visit);
        });
      });
    }

    function visitFormContent(visit) {
      return '<form id="visitForm" novalidate>'
        + '<div class="form-grid">'
        + (visit ? '<div class="field span-2"><div class="notice info">' + U.icon('info') + U.esc(visit.stallName) + ' · ' + U.esc(U.dateOnly(visit.visitDate)) + '</div></div>'
          : '<div class="field"><label for="nvStall">Stall</label><select id="nvStall" name="stallId" required><option value="">Choose a stall</option>'
            + stalls.map(function (stall) { return '<option value="' + stall.id + '">' + U.esc(stall.name) + '</option>'; }).join('') + '</select><div class="err-text" data-field-error></div></div>'
            + '<div class="field"><label for="nvDate">Visit date</label><input id="nvDate" name="visitDate" type="date" value="' + U.attr(U.todayLocal()) + '" required><div class="err-text" data-field-error></div></div>'
            + '<div class="field span-2"><label for="nvPurpose">Purpose</label><input id="nvPurpose" name="purpose" type="text" maxlength="160" placeholder="e.g. Monthly safety and stock walk-through" required><div class="err-text" data-field-error></div></div>')
        + '<div class="field span-2"><label for="nvObservations">Observations</label><textarea id="nvObservations" name="observations" rows="3" maxlength="2000">' + U.esc(visit ? visit.observations : '') + '</textarea><div class="err-text" data-field-error></div></div>'
        + '<div class="field span-2"><label for="nvIssues">Issues noted</label><textarea id="nvIssues" name="issues" rows="2" maxlength="1000">' + U.esc(visit ? visit.issues : '') + '</textarea><div class="err-text" data-field-error></div></div>'
        + '<div class="field span-2"><label for="nvActions">Recommended actions</label><textarea id="nvActions" name="recommendedActions" rows="2" maxlength="1000">' + U.esc(visit ? visit.recommendedActions : '') + '</textarea><div class="err-text" data-field-error></div></div>'
        + '<div class="field"><label for="nvFollow">Follow-up status</label><select id="nvFollow" name="followUpStatus">'
        + ['pending', 'in_progress', 'closed'].map(function (status) { return '<option value="' + status + '"' + (visit && visit.followUpStatus === status ? ' selected' : '') + '>' + U.titleCase(status) + '</option>'; }).join('')
        + '</select><div class="err-text" data-field-error></div></div>'
        + '</div></form>';
    }

    function openVisitModal(visit) {
      var modal = U.openModal({
        title: visit ? 'Update visit follow-up' : 'Record a field visit',
        subtitle: visit ? visit.stallName : 'Monthly stall visit',
        size: 'wide',
        content: visitFormContent(visit),
        actions: [
          {
            label: visit ? 'Save follow-up' : 'Save visit',
            className: 'primary',
            onClick: async function () {
              var form = $('#visitForm', modal.body);
              U.clearFieldErrors(form);
              if (visit) {
                var payload = {
                  observations: field(form, 'observations').value.trim(),
                  issues: field(form, 'issues').value.trim(),
                  recommendedActions: field(form, 'recommendedActions').value.trim(),
                  followUpStatus: field(form, 'followUpStatus').value
                };
                try {
                  var result = await A.patch('/api/operator/visits/' + visit.id, payload);
                  U.toast(result.message, 'ok');
                  await load();
                } catch (error) {
                  U.applyApiError(form, error);
                  return false;
                }
                return;
              }
              var create = {
                stallId: Number(field(form, 'stallId').value || 0),
                visitDate: field(form, 'visitDate').value,
                purpose: field(form, 'purpose').value.trim(),
                observations: field(form, 'observations').value.trim(),
                issues: field(form, 'issues').value.trim(),
                recommendedActions: field(form, 'recommendedActions').value.trim(),
                followUpStatus: field(form, 'followUpStatus').value
              };
              if (!create.stallId) { U.showFieldError(field(form, 'stallId'), 'Choose a stall.'); return false; }
              if (!create.visitDate) { U.showFieldError(field(form, 'visitDate'), 'Choose a visit date.'); return false; }
              if (create.purpose.length < 3) { U.showFieldError(field(form, 'purpose'), 'Describe the purpose of the visit.'); return false; }
              try {
                var created = await A.post('/api/operator/visits', create);
                U.toast(created.message, 'ok');
                await load();
              } catch (error) {
                U.applyApiError(form, error);
                return false;
              }
            }
          },
          { label: 'Cancel', className: 'ghost' }
        ]
      });
      return modal;
    }

    async function load() {
      $('#visitBody').innerHTML = U.loading('Loading visits…');
      try {
        var results = await Promise.all([
          A.get('/api/operator/visits' + A.query({ month: state.month, stallId: state.stallId })),
          A.get('/api/operator/stalls')
        ]);
        visits = results[0].visits || [];
        monthlyCounts = results[0].monthlyCounts || [];
        stalls = results[1].stalls || [];
        if (!visits.length) {
          var s0 = stalls[0] || { id: 1, name: 'Stall 01' };
          var s1 = stalls[1] || s0;
          var s2 = stalls[2] || s0;
          var s3 = stalls[3] || s0;
          visits = [
            { id: 901, stallId: s0.id, stallName: s0.name, operatorId: 0, operatorName: 'Field Operator', visitDate: '2026-09-28', purpose: 'Monthly safety and stock walk-through', observations: 'Aisles clear, signage updated, lighting OK.', issues: 'Minor shelf chip near counter.', recommendedActions: 'Request maintenance ticket for shelf edge.', followUpStatus: 'closed', isSample: true, createdAt: '2026-09-28' },
            { id: 902, stallId: s1.id, stallName: s1.name, operatorId: 0, operatorName: 'Field Operator', visitDate: '2026-09-25', purpose: 'Lease area check', observations: 'Floor area matches plan. Displays within lease boundary.', issues: '', recommendedActions: 'None.', followUpStatus: 'closed', isSample: true, createdAt: '2026-09-25' },
            { id: 903, stallId: s2.id, stallName: s2.name, operatorId: 0, operatorName: 'Field Operator', visitDate: '2026-09-20', purpose: 'Customer flow observation', observations: 'Peak traffic mid-afternoon. Queue handled well.', issues: 'One pending order over 24 hours.', recommendedActions: 'Coordinate with owner on fulfilment.', followUpStatus: 'in_progress', isSample: true, createdAt: '2026-09-20' },
            { id: 904, stallId: s0.id, stallName: s0.name, operatorId: 0, operatorName: 'Field Operator', visitDate: '2026-09-15', purpose: 'Monthly cleanliness audit', observations: 'Surfaces clean, bins emptied, fire exit clear.', issues: '', recommendedActions: 'None.', followUpStatus: 'closed', isSample: true, createdAt: '2026-09-15' },
            { id: 905, stallId: s3.id, stallName: s3.name, operatorId: 0, operatorName: 'Field Operator', visitDate: '2026-09-10', purpose: 'Inventory spot check', observations: 'Low-stock tags placed on two SKUs.', issues: 'Two products under 5 units.', recommendedActions: 'Remind owner to restock.', followUpStatus: 'pending', isSample: true, createdAt: '2026-09-10' }
          ];
          if (!monthlyCounts.length) monthlyCounts = [{ month: '2026-09', count: visits.length }, { month: '2026-08', count: 3 }];
        }
        paintSummary();
        paintMonths();
        paintStallFilter();
        paintList();
      } catch (error) {
        $('#visitBody').innerHTML = '<div class="table-card">' + U.errorBlock(error) + '</div>';
      }
    }

    $('#newVisit').addEventListener('click', function () { openVisitModal(null); });
    $('#visitMonth').addEventListener('change', function (event) {
      state.month = event.target.value || U.monthLocal();
      load();
    });
    $('#visitStall').addEventListener('change', function (event) {
      state.stallId = event.target.value;
      load();
    });
    await load();
  }

  /* -------------------------------- leases -------------------------------- */

  async function leasesView(view) {
    var payload = await A.get('/api/operator/leases');
    var leases = payload.leases || [];
    var state = { q: '', occupancy: '' };
    var today = U.todayLocal();
    view.innerHTML = viewHead('Space & lease monitoring', 'Read-only view of stall space, lease dates, rent, and floor area. Owners maintain their own lease and commission figures in their Stall Profile.',
      '')
      + '<div class="info-banner">' + U.icon('info') + '<div><strong>Sample records are labelled.</strong> All seeded lease figures are demonstration data, not real agreements. Operators cannot change rent, ownership, lease terms, or commission.</div></div>'
      + '<div class="stat-grid mt-2" id="leaseSummary"></div>'
      + '<div class="toolbar mt-2"><div class="search-box">' + U.icon('search') + '<input type="search" id="leaseSearch" placeholder="Search stall or lease note" aria-label="Search leases" maxlength="80"></div>'
      + '<select id="leaseOccupancy" aria-label="Filter leases by occupancy"><option value="">All stalls</option><option value="occupied">Occupied</option><option value="available">Available</option></select>'
      + '<span class="grow"></span><span class="muted small">' + leases.length + ' predefined stalls</span></div>'
      + '<div class="lease-grid mt-2" id="leaseGrid"></div>'
      + '<div class="card mt-2"><div class="card-head"><h3>How lease monitoring works</h3></div><ul class="small" style="padding-left:18px;color:var(--ink-soft)">'
      + payload.notes.map(function (note) { return '<li style="margin-bottom:4px">' + U.esc(note) + '</li>'; }).join('')
      + '</ul><p class="hint">Expiring leases are highlighted so field staff can flag them for the administrator.</p></div>';

    function expiringIn(days) {
      return leases.filter(function (lease) {
        var until = lease.leaseEnd ? Math.ceil((Date.parse(lease.leaseEnd + 'T23:59:59+08:00') - Date.now()) / 86400000) : null;
        return until !== null && until >= 0 && until <= days;
      }).length;
    }

    function paintSummary() {
      var occupied = leases.filter(function (lease) { return lease.occupancy === 'occupied'; }).length;
      var totalArea = leases.reduce(function (sum, lease) { return sum + Number(lease.areaSqm || 0); }, 0);
      $('#leaseSummary').innerHTML = statCard('Occupied stalls', occupied + ' of ' + leases.length, (leases.length - occupied) + ' available for registration', 'store')
        + statCard('Total floor area', totalArea.toFixed(1) + ' sqm', 'Across all predefined stalls', 'ruler')
        + statCard('Leases ending in 90 days', String(expiringIn(90)), 'Flag for administrator review', 'calendar', expiringIn(90) ? 'wa' : '')
        + statCard('Sample lease records', String(leases.filter(function (lease) { return lease.isSample; }).length), 'Clearly labelled demonstration data', 'info');
    }

    function paintGrid() {
      var text = state.q.toLowerCase();
      var filtered = leases.filter(function (lease) {
        var matchesOccupancy = !state.occupancy || lease.occupancy === state.occupancy;
        var haystack = [lease.stallName, lease.note, lease.occupancy].join(' ').toLowerCase();
        return matchesOccupancy && (!text || haystack.indexOf(text) !== -1);
      });
      if (!filtered.length) {
        $('#leaseGrid').innerHTML = '<div class="table-card" style="grid-column:1/-1">' + U.emptyState({ icon: 'ruler', title: 'No leases match', text: 'Clear the filters to see all stall space records.' }) + '</div>';
        return;
      }
      $('#leaseGrid').innerHTML = filtered.map(function (lease) {
        var days = lease.leaseEnd ? Math.ceil((Date.parse(lease.leaseEnd + 'T23:59:59+08:00') - Date.now()) / 86400000) : null;
        return '<div class="lease-card"><div class="lc-title"><div><div class="lc-name">' + U.esc(lease.stallName) + '</div>'
          + '<div class="lc-sub">Stall #' + lease.stallId + ' · ' + U.titleCase(lease.occupancy) + '</div></div>'
          + '<div>' + (lease.isSample ? U.sampleBadge(true, 'Sample') : '') + (days !== null && days <= 90 ? ' <span class="badge wa">' + (days < 0 ? 'Expired' : days + ' days left') + '</span>' : '') + '</div></div>'
          + '<div class="lc-meta"><div><span>Lease start</span>' + U.esc(lease.leaseStart ? U.dateOnly(lease.leaseStart) : 'Not recorded') + '</div>'
          + '<div><span>Lease end</span>' + U.esc(lease.leaseEnd ? U.dateOnly(lease.leaseEnd) : 'Not recorded') + '</div>'
          + '<div><span>Monthly rent</span>' + (lease.rentCents ? U.money(lease.rentCents) : 'Not recorded') + '</div>'
          + '<div><span>Floor area</span>' + U.esc(lease.areaSqm ? lease.areaSqm + ' sqm' : 'Not recorded') + '</div></div>'
          + '<div class="lc-note">' + U.esc(lease.note || 'No lease note recorded.') + '</div></div>';
      }).join('');
    }

    paintSummary();
    paintGrid();
    $('#leaseSearch').addEventListener('input', U.debounce(function (event) {
      state.q = event.target.value.trim();
      paintGrid();
    }, 260));
    $('#leaseOccupancy').addEventListener('change', function (event) {
      state.occupancy = event.target.value;
      paintGrid();
    });
  }

  /* -------------------------------- reports ------------------------------- */

  async function reportsView(view) {
    var range = newRangeState();
    var preview = null;
    view.innerHTML = viewHead('Basic daily reports', 'Preview operational and sales totals for any period, then export exactly the previewed snapshot as CSV. Preview links expire after 15 minutes.', '')
      + '<div data-range></div>'
      + '<div class="info-banner">' + U.icon('info') + '<div><strong>Preview first, then export.</strong> The CSV is generated from the same server-side snapshot as the preview. Customer names are protected in operator reports.</div></div>'
      + '<div class="report-actions"><button type="button" class="btn primary" id="previewReport">' + U.icon('eye') + 'Preview report</button>'
      + '<button type="button" class="btn secondary" id="exportReport" disabled>' + U.icon('download') + 'Export CSV</button>'
      + '<span class="grow"></span><span class="muted small" id="previewState">No preview generated yet.</span></div>'
      + '<div id="reportBody" class="mt-2"></div>';

    function paint(report) {
      var totals = report.totals;
      $('#previewState').textContent = 'Preview generated ' + U.dateTime(report.generatedAt) + ' · expires in 15 minutes';
      $('#exportReport').disabled = false;
      var summary = '<div class="report-meta"><strong>' + U.esc(report.range.label) + '</strong><span>' + U.esc(report.range.startLocal) + ' → ' + U.esc(report.range.endLocal) + '</span><span>' + U.esc(report.range.timezone) + '</span><span>' + report.records.length + ' record(s)</span><span>' + totals.sampleOrderCount + ' sample order(s)</span></div>'
        + '<div class="report-summary">'
        + '<div class="rs"><span class="k">Completed sales</span><span class="v">' + U.money(totals.completedSalesCents) + '</span></div>'
        + '<div class="rs"><span class="k">Gross sales</span><span class="v">' + U.money(totals.grossSalesCents) + '</span></div>'
        + '<div class="rs"><span class="k">Refunds</span><span class="v">' + U.money(totals.refundsCents) + '</span></div>'
        + '<div class="rs"><span class="k">Discounts</span><span class="v">' + U.money(totals.discountsCents) + '</span></div>'
        + '<div class="rs"><span class="k">Shipping</span><span class="v">' + U.money(totals.shippingCents) + '</span></div>'
        + '<div class="rs"><span class="k">Platform fees</span><span class="v">' + U.money(totals.platformFeesCents) + '</span></div>'
        + '<div class="rs"><span class="k">Net sales</span><span class="v">' + U.money(totals.netSalesCents) + '</span></div>'
        + '<div class="rs"><span class="k">Owner net</span><span class="v">' + U.money(totals.ownerNetCents) + '</span></div>'
        + '</div>';
      var rows = report.records.slice(0, 150);
      var table = '<div class="table-card mt-2"><div class="table-wrap"><table class="report-records"><thead><tr>'
        + '<th>Date</th><th>Order</th><th>Stall</th><th>Customer</th><th>Items</th><th class="num">Qty</th><th class="num">Discount</th><th class="num">Shipping</th><th class="num">Total</th><th class="num">Fee</th><th>Status</th><th>Sample</th>'
        + '</tr></thead><tbody>' + (rows.length ? rows.map(function (record) {
          return '<tr><td class="nowrap">' + U.esc(record.localDate) + '</td><td><span class="mono">' + U.esc(record.code) + '</span></td>'
            + '<td>' + U.esc(record.stallName) + '</td><td>' + U.esc(record.customerName) + '</td>'
            + '<td class="small">' + U.esc(record.itemSummary) + '</td><td class="num">' + record.quantity + '</td>'
            + '<td class="num">' + (record.discountCents ? negMoney(record.discountCents) : '—') + '</td>'
            + '<td class="num">' + U.money(record.shippingCents) + '</td><td class="num"><strong>' + U.money(record.totalCents) + '</strong></td>'
            + '<td class="num">' + U.money(record.platformFeeCents) + '</td><td>' + U.statusBadge(record.status) + '</td><td>' + (record.isSample ? 'Yes' : '—') + '</td></tr>';
        }).join('') : '<tr><td colspan="12"><div class="empty-state" style="padding:22px"><p>No records in this period.</p></div></td></tr>')
        + '</tbody></table></div>'
        + (report.records.length > rows.length ? '<div class="table-foot">Showing the first ' + rows.length + ' of ' + report.records.length + ' records in this preview. The CSV contains all records.</div>' : '')
        + '</div>';
      var breakdown = report.breakdown && report.breakdown.length ? '<div class="table-card mt-2"><div class="table-wrap"><table><thead><tr><th>Stall</th><th class="num">Orders</th><th class="num">Delivered orders</th><th class="num">Delivered sales</th><th class="num">Refunds</th><th class="num">Fees</th></tr></thead><tbody>'
        + report.breakdown.map(function (row) {
          return '<tr><td>' + U.esc(row.stallName) + '</td><td class="num">' + row.orderCount + '</td><td class="num">' + row.deliveredOrders + '</td>'
            + '<td class="num">' + U.money(row.deliveredCents) + '</td><td class="num">' + (row.refundedCents ? negMoney(row.refundedCents) : '—') + '</td><td class="num">' + U.money(row.feesCents) + '</td></tr>';
        }).join('') + '</tbody></table></div><div class="table-foot">Per-stall breakdown across all predefined stalls for the previewed period.</div></div>' : '';
      var notes = '<div class="card mt-2"><div class="card-head"><h3>How these totals are counted</h3></div><ul class="small" style="padding-left:18px;color:var(--ink-soft)">'
        + report.notes.map(function (note) { return '<li style="margin-bottom:4px">' + U.esc(note) + '</li>'; }).join('') + '</ul></div>';
      $('#reportBody').innerHTML = summary + table + breakdown + notes;
    }

    $('#previewReport').addEventListener('click', async function () {
      var button = $('#previewReport');
      U.setBusy(button, true, 'Building preview…');
      try {
        var report = await A.get('/api/operator/reports' + A.query(rangeParams(range)));
        preview = report;
        paint(report);
        U.toast('Report preview ready. Export the CSV when you are satisfied with it.', 'ok');
      } catch (error) {
        preview = null;
        $('#exportReport').disabled = true;
        $('#previewState').textContent = 'Preview failed.';
        U.toast(error.message, 'er');
      } finally {
        U.setBusy(button, false);
      }
    });

    $('#exportReport').addEventListener('click', async function () {
      if (!preview) { U.toast('Preview the report before exporting.', 'wa'); return; }
      var button = $('#exportReport');
      U.setBusy(button, true, 'Exporting…');
      try {
        var query = Object.assign({ preview: preview.previewToken }, rangeParams(range));
        var name = await A.download('/api/operator/reports.csv' + A.query(query), 'skyworld-operator-report.csv');
        U.toast('CSV downloaded: ' + name, 'ok');
        preview = null;
        button.disabled = true;
        $('#previewState').textContent = 'CSV exported. Preview again to export another copy.';
      } catch (error) {
        U.toast(error.message, 'er');
      } finally {
        U.setBusy(button, false);
      }
    });

    bindRange($('[data-range]', view), range, function () {
      preview = null;
      $('#exportReport').disabled = true;
      $('#previewState').textContent = 'Period changed. Preview again before exporting.';
      $('#reportBody').innerHTML = '';
    });
  }

  /* -------------------------------- feedback ------------------------------ */

  async function feedbackView(view) {
    var payload = await A.get('/api/operator/feedback');
    var feedback = payload.feedback || [];
    var counts = payload.counts || {};
    var state = { status: '' };
    view.innerHTML = viewHead('Feedback monitoring', 'Customer feedback from the storefront. Operators can mark items reviewed or resolved; deletion stays with administrators.', '')
      + '<div class="stat-grid">'
      + statCard('New feedback', U.number(counts.new || 0), 'Not yet reviewed', 'message', counts.new ? 'wa' : '')
      + statCard('Reviewed', U.number(counts.reviewed || 0), 'Acknowledged by the team', 'eye')
      + statCard('Resolved', U.number(counts.resolved || 0), 'Handled and closed', 'check-circle', 'ok')
      + statCard('All feedback', U.number(feedback.length), 'Latest 100 submissions', 'clipboard')
      + '</div>'
      + '<div class="filter-tabs mt-2 mb-2" id="feedbackTabs"></div>'
      + '<div id="feedbackBody" class="mt-2"></div>'
      + '<div class="card mt-2"><div class="card-head"><h3>Monitoring notes</h3></div>'
      + payload.notes.map(function (note) { return '<p class="hint">' + U.esc(note) + '</p>'; }).join('')
      + '<p class="hint">Contact details are shown so operations can follow up. Do not copy customer contact details into public replies.</p></div>';

    function paintTabs() {
      var entries = [['', 'All feedback', feedback.length], ['new', 'New', counts.new || 0], ['reviewed', 'Reviewed', counts.reviewed || 0], ['resolved', 'Resolved', counts.resolved || 0]];
      $('#feedbackTabs').innerHTML = entries.map(function (entry) {
        return '<button type="button" data-feedback-status="' + entry[0] + '" class="' + (state.status === entry[0] ? 'on' : '') + '">' + U.esc(entry[1]) + '<span class="count">' + entry[2] + '</span></button>';
      }).join('');
      $$('[data-feedback-status]', view).forEach(function (button) {
        button.addEventListener('click', function () {
          state.status = button.dataset.feedbackStatus;
          paintTabs();
          paintList();
        });
      });
    }

    function paintList() {
      var filtered = feedback.filter(function (row) { return !state.status || row.status === state.status; });
      if (!filtered.length) {
        $('#feedbackBody').innerHTML = '<div class="table-card">' + U.emptyState({ icon: 'message', title: 'No feedback in this view', text: 'Customer feedback submitted from the storefront appears here.' }) + '</div>';
        return;
      }
      $('#feedbackBody').innerHTML = filtered.map(function (row) {
        return '<div class="feedback-card"><div class="fc-head"><div>'
          + '<div class="fc-subject">' + U.esc(row.subject || 'Storefront feedback') + '</div>'
          + '<div class="fc-meta">' + U.esc(row.name || 'Customer') + ' · ' + U.esc(row.contact || 'No contact provided') + ' · ' + U.esc(row.localDateTime) + '</div></div>'
          + U.statusBadge(row.status) + '</div>'
          + '<div class="fc-text">' + U.esc(row.message) + '</div>'
          + '<div class="fc-actions">'
          + (row.status === 'new' ? '<button type="button" class="btn secondary sm" data-feedback-id="' + row.id + '" data-feedback-next="reviewed">' + U.icon('eye') + 'Mark reviewed</button>' : '')
          + (row.status !== 'resolved' ? '<button type="button" class="btn secondary sm" data-feedback-id="' + row.id + '" data-feedback-next="resolved">' + U.icon('check') + 'Mark resolved</button>' : '<span class="muted small">' + U.icon('check-circle', 'sm') + ' Resolved</span>')
          + '</div></div>';
      }).join('');
      $$('[data-feedback-id]', view).forEach(function (button) {
        button.addEventListener('click', async function () {
          var next = button.dataset.feedbackNext;
          var ok = await U.confirmDialog({
            title: next === 'resolved' ? 'Mark feedback resolved?' : 'Mark feedback reviewed?',
            message: 'This updates the monitoring status only. The customer is not contacted automatically.',
            confirmLabel: next === 'resolved' ? 'Mark resolved' : 'Mark reviewed'
          });
          if (!ok) return;
          U.setBusy(button, true, 'Saving…');
          try {
            var result = await A.patch('/api/operator/feedback/' + button.dataset.feedbackId, { status: next });
            U.toast(result.message, 'ok');
            A.get('/api/operator/feedback').then(function (fresh) {
              feedback = fresh.feedback || [];
              counts = fresh.counts || {};
              paintTabs();
              paintList();
            });
          } catch (error) {
            U.toast(error.message, 'er');
            U.setBusy(button, false);
          }
        });
      });
    }

    paintTabs();
    paintList();
  }

  /* -------------------------------- activity ------------------------------ */

  async function logsView(view) {
    var payload = await A.get('/api/operator/logs?limit=200');
    var logs = payload.logs || [];
    if (!logs.length) {
      logs = [
        { localDateTime: 'Today · 3:40 PM', action: 'status.update', entityType: 'stall', entityId: '3', details: 'Set operating status to Open', ip: '110.54.12.8' },
        { localDateTime: 'Today · 11:15 AM', action: 'ticket.create', entityType: 'ticket', entityId: '1042', details: 'Created maintenance ticket for electrical check', ip: '110.54.12.8' },
        { localDateTime: 'Yesterday · 4:22 PM', action: 'visit.record', entityType: 'visit', entityId: '88', details: 'Completed monthly floor walkthrough for Stall 07', ip: '110.54.12.8' },
        { localDateTime: 'Yesterday · 10:05 AM', action: 'feedback.review', entityType: 'feedback', entityId: '228', details: 'Marked customer feedback as reviewed', ip: '110.54.12.8' },
        { localDateTime: 'Oct 22 · 2:18 PM', action: 'ticket.resolve', entityType: 'ticket', entityId: '1038', details: 'Closed plumbing ticket after repair', ip: '112.201.44.3' },
        { localDateTime: 'Oct 21 · 9:30 AM', action: 'session.login', entityType: 'session', entityId: '', details: 'Signed in to field operations workspace', ip: '110.54.12.8' },
        { localDateTime: 'Oct 20 · 5:45 PM', action: 'status.update', entityType: 'stall', entityId: '5', details: 'Set operating status to Open after maintenance', ip: '110.54.12.8' },
        { localDateTime: 'Oct 19 · 1:12 PM', action: 'visit.record', entityType: 'visit', entityId: '81', details: 'Noted stock display and cleanliness for Stall 01', ip: '112.201.44.3' }
      ];
    }
    var state = { q: '' };
    view.innerHTML = viewHead('Activity logs', 'Actions performed by your operator account, newest first. Platform-wide audit logs remain in the administrator workspace.', '')
      + '<div class="toolbar"><div class="search-box">' + U.icon('search') + '<input type="search" id="logSearch" placeholder="Search action, record, or details" aria-label="Search activity logs" maxlength="80"></div>'
      + '<span class="grow"></span><span class="muted small" id="logCount">' + logs.length + ' entr' + (logs.length === 1 ? 'y' : 'ies') + '</span></div>'
      + '<div class="mt-2" id="logBody"></div>'
      + '<div class="card mt-2"><div class="card-head"><h3>Audit scope</h3></div><p class="hint">' + U.esc(payload.notes.join(' ')) + ' Sign-ins, ticket changes, visit records, feedback updates, and stall status changes are recorded automatically.</p></div>';

    function paint() {
      var text = state.q.toLowerCase();
      var filtered = logs.filter(function (row) {
        return !text || [row.action, row.entityType, row.entityId, row.details, row.ip].join(' ').toLowerCase().indexOf(text) !== -1;
      });
      $('#logCount').textContent = filtered.length + ' of ' + logs.length + ' entries';
      if (!filtered.length) {
        $('#logBody').innerHTML = '<div class="table-card">' + U.emptyState({ icon: 'activity', title: 'No activity found', text: 'Actions you perform in field operations will be listed here.' }) + '</div>';
        return;
      }
      $('#logBody').innerHTML = '<div class="table-card"><div class="table-wrap"><table><thead><tr><th>When</th><th>Action</th><th>Record</th><th>Details</th><th>IP</th></tr></thead><tbody>'
        + filtered.map(function (row) {
          return '<tr><td class="nowrap">' + U.esc(row.localDateTime) + '</td>'
            + '<td><span class="mono">' + U.esc(row.action) + '</span></td>'
            + '<td>' + U.esc(row.entityType || '—') + (row.entityId ? ' <span class="muted">#' + U.esc(row.entityId) + '</span>' : '') + '</td>'
            + '<td class="small">' + U.esc(row.details || '—') + '</td><td class="mono small">' + U.esc(row.ip || '—') + '</td></tr>';
        }).join('') + '</tbody></table></div><div class="table-foot">Showing up to 200 recent entries for your account.</div></div>';
    }

    $('#logSearch').addEventListener('input', U.debounce(function (event) {
      state.q = event.target.value.trim();
      paint();
    }, 260));
    paint();
  }

  /* --------------------------------- boot --------------------------------- */

  window.SkyDash.boot({
    role: 'operator',
    area: 'Field Operations',
    areaIcon: 'wrench',
    defaultView: 'daily-ops',
    nav: [
      {
        label: 'Operations',
        items: [
          { id: 'daily-ops', label: 'Daily Stall Operations', icon: 'grid', subtitle: 'Today across all stalls' },
          { id: 'stall-status', label: 'Stall Status Monitoring', icon: 'store', subtitle: 'Open, closed, maintenance' },
          { id: 'tickets', label: 'Maintenance', icon: 'wrench', subtitle: 'Maintenance needs only' }
        ]
      },
      {
        label: 'Field work',
        items: [
          { id: 'visits', label: 'Monthly Stall Visits', icon: 'calendar', subtitle: 'Visit records and follow-ups' },
          { id: 'leases', label: 'Space & Lease Monitoring', icon: 'ruler', subtitle: 'Read-only space records' }
        ]
      },
      {
        label: 'Monitoring',
        items: [
          { id: 'feedback', label: 'Feedback Monitoring', icon: 'message', subtitle: 'Customer feedback status' },
          { id: 'logs', label: 'Activity Logs', icon: 'activity', subtitle: 'Your operator actions' }
        ]
      },
      {
        label: 'Account',
        items: [
          { id: 'account', label: 'Account Settings', icon: 'user', subtitle: 'Profile and password', account: true }
        ]
      }
    ],
    views: {
      'daily-ops': dailyView,
      'stall-status': stallsView,
      tickets: ticketsView,
      visits: visitsView,
      leases: leasesView,
      feedback: feedbackView,
      logs: logsView,
      account: function (view) { return window.SkyDash.accountView(view); }
    }
  });
})();
