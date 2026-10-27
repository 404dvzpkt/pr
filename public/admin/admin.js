(function () {
  'use strict';

  var U = window.SkyUI;
  var A = window.SkyApi;
  var C = window.SkyCharts;
  var $ = U.$;
  var $$ = U.$$;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function field(form, name) { return form.elements.namedItem(name); }
  function negMoney(cents) { return '\u2212' + U.money(Math.abs(Number(cents) || 0)); }
  function pad2(value) { return String(value).padStart(2, '0'); }

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
    return { period: 'monthly', value: U.monthLocal(), from: U.todayLocal(), to: U.todayLocal() };
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

  function personCell(name, email, sub) {
    return '<div class="owner-cell">' + U.avatar(name, 'sm') + '<div class="oc-main">'
      + '<div class="oc-name">' + U.esc(name) + '</div>'
      + '<div class="oc-sub">' + U.esc(sub || email || '') + '</div></div></div>';
  }

  function emptyCard(icon, title, text) {
    return '<div class="table-card">' + U.emptyState({ icon: icon, title: title, text: text }) + '</div>';
  }

  /* ------------------------------- overview ------------------------------ */

  async function overviewView(view, api) {
    var data = await A.get('/api/admin/overview');
    var today = data.today;
    var month = data.month;
    var year = data.year;
    var roleTotals = { admin: 0, operator: 0, owner: 0 };
    var activePeople = 0;
    data.users.byRole.forEach(function (row) {
      roleTotals[row.role] = (roleTotals[row.role] || 0) + row.count;
      if (row.status === 'active') activePeople += row.count;
    });
    var statusTotals = {};
    data.stalls.byStatus.forEach(function (row) {
      statusTotals[row.operating_status] = (statusTotals[row.operating_status] || 0) + row.count;
    });
    var attention = data.attention;
    view.innerHTML = viewHead('Platform overview', 'Live platform health for ' + data.timezone + '. ' + data.stalls.total + ' predefined stalls, one shared database.',
      '<button class="btn secondary" type="button" id="overviewRefresh">' + U.icon('refresh') + 'Refresh</button>')
      + '<div class="stats-hero"><div class="hero-grid">'
      + '<div class="hg-cell"><div class="k">Completed this month</div><div class="v">' + U.money(month.completedSalesCents) + '</div><div class="s">' + month.deliveredCount + ' delivered order(s)</div></div>'
      + '<div class="hg-cell"><div class="k">Refunds this month</div><div class="v">' + U.money(month.refundsCents) + '</div><div class="s">' + month.refundedCount + ' refunded order(s)</div></div>'
      + '<div class="hg-cell"><div class="k">Platform fees</div><div class="v">' + U.money(month.platformFeesCents) + '</div><div class="s">Owner net ' + U.money(month.ownerNetCents) + '</div></div>'
      + '<div class="hg-cell"><div class="k">Orders this month</div><div class="v">' + U.number(month.orderCount) + '</div><div class="s">' + month.sampleOrderCount + ' labelled Sample</div></div>'
      + '</div><div class="sample-note">Seeded demonstration orders are labelled Sample throughout the platform. They are never presented as real revenue.</div></div>'
      + '<div class="stat-grid mt-2">'
      + statCard('Completed today', U.money(today.completedSalesCents), today.deliveredCount + ' delivered · ' + today.orderCount + ' order(s)', 'trend', 'ok')
      + statCard('Stall occupancy', data.stalls.occupied + ' of ' + data.stalls.total, data.stalls.available + ' available for owner registration', 'store')
      + statCard('Active accounts', String(activePeople), roleTotals.owner + ' owner(s) · ' + roleTotals.admin + ' admin · ' + roleTotals.operator + ' operator', 'users')
      + statCard('Open support tickets', String(attention.openTickets), attention.flaggedReviews + ' held review(s) · ' + attention.newFeedback + ' new feedback', 'ticket', attention.openTickets ? 'wa' : '')
      + '</div>'
      + '<div class="section-title"><h3>Needs attention</h3><span class="muted small">Derived from current platform records</span></div>'
      + '<div class="attention-grid">'
      + '<a class="attention-card ' + (attention.lowStock ? 'wa' : '') + '" href="#stalls"><span class="ac-ic">' + U.icon('box') + '</span><div><div class="ac-value">' + attention.lowStock + '</div><div class="ac-label">Active products at 10 units or fewer</div></div></a>'
      + '<a class="attention-card ' + (attention.flaggedReviews ? 'er' : '') + '" href="#reviews"><span class="ac-ic">' + U.icon('star') + '</span><div><div class="ac-value">' + attention.flaggedReviews + '</div><div class="ac-label">Reviews held by the moderation filter</div></div></a>'
      + '<a class="attention-card ' + (attention.newFeedback ? 'wa' : '') + '" href="#feedback"><span class="ac-ic">' + U.icon('message') + '</span><div><div class="ac-value">' + attention.newFeedback + '</div><div class="ac-label">New customer feedback items</div></div></a>'
      + '<div class="attention-card"><span class="ac-ic">' + U.icon('wrench') + '</span><div><div class="ac-value">' + attention.openTickets + '</div><div class="ac-label">Open tickets handled by field operators</div></div></div>'
      + '</div>'
      + '<div class="grid-2 mt-2">'
      + '<div class="card"><div class="card-head"><h3>Top stalls by delivered sales</h3><a href="#analytics">Full analytics</a></div>'
      + (data.topStalls.length ? C.barList(data.topStalls.map(function (row) { return { name: row.name, value: row.grossCents, orders: row.deliveredOrders }; }), { format: U.money }) : '<div class="chart-empty">No delivered sales this month.</div>')
      + '<p class="hint">This month · completed sales only. ' + month.deliveredCount + ' delivered order(s) platform-wide.</p></div>'
      + '<div class="card"><div class="card-head"><h3>Recent orders</h3><a href="#transactions">Open ledger</a></div>'
      + (data.recentOrders.length ? '<div class="list-simple">' + data.recentOrders.map(function (order) {
        return '<div class="list-row"><div class="lr-main"><div class="lr-title">' + U.esc(order.code) + ' ' + U.statusBadge(order.status) + ' ' + U.sampleBadge(order.isSample) + '</div>'
          + '<div class="lr-sub">' + U.esc(order.stallName) + ' · ' + U.esc(order.customerName) + ' · ' + U.esc(order.localDateTime) + '</div></div>'
          + '<div class="lr-value">' + U.money(order.totalCents) + '</div></div>';
      }).join('') + '</div>' : '<div class="chart-empty">No orders yet.</div>')
      + '</div></div>'
      + '<div class="grid-2 even mt-2">'
      + '<div class="card"><div class="card-head"><h3>Recent activity</h3><a href="#logs">Audit trail</a></div>'
      + (data.recentLogs.length ? '<div class="list-simple">' + data.recentLogs.map(function (log) {
        return '<div class="list-row"><div class="lr-main"><div class="lr-title">' + U.esc(log.actorName) + ' ' + U.statusBadge(log.actorRole, U.titleCase(log.actorRole)) + '</div>'
          + '<div class="lr-sub">' + U.esc(log.action) + ' · ' + U.esc(log.details) + '</div></div>'
          + '<div class="lr-sub nowrap">' + U.esc(log.localDateTime) + '</div></div>';
      }).join('') + '</div>' : '<div class="chart-empty">No activity recorded yet.</div>')
      + '</div>'
      + '<div class="card"><div class="card-head"><h3>Year to date</h3><span class="badge">' + U.yearLocal() + '</span></div>'
      + '<div class="dl"><dt>Completed sales</dt><dd>' + U.money(year.completedSalesCents) + '</dd>'
      + '<dt>Refunds</dt><dd>' + U.money(year.refundsCents) + '</dd>'
      + '<dt>Platform fees</dt><dd>' + U.money(year.platformFeesCents) + '</dd>'
      + '<dt>Net after refunds</dt><dd><strong>' + U.money(year.netSalesCents) + '</strong></dd>'
      + '<dt>Orders</dt><dd>' + U.number(year.orderCount) + '</dd></div>'
      + '<div class="stat-divider"></div>'
      + '<div class="btn-row mt-2"><a class="btn secondary sm" href="#security">Security settings</a></div></div>'
      + '</div>'
      + '<div class="card mt-2"><div class="card-head"><h3>Quick actions</h3></div><div class="btn-row">'
      + '<a class="btn secondary" href="#stall-owners">Manage owner accounts</a>'
      + '<a class="btn secondary" href="#reports">Open audit logs</a>'
      + '<a class="btn secondary" href="#reviews">Moderate reviews</a>'
            + '</div></div>';
    $('#overviewRefresh').addEventListener('click', function () { api.reload(); });
  }

  /* ------------------------------ stall owners --------------------------- */

  async function ownersView(view) {
    var owners = [];
    var query = '';
    view.innerHTML = viewHead('Stall owner management', 'Review owner accounts and control sign-in access. Owner accounts are created by owners themselves from the shared registration portal.',
      '<a class="btn secondary" href="#stalls">' + U.icon('store') + 'Stall management</a>')
      + '<div class="info-banner">' + U.icon('shield') + '<div><strong>Ownership stays with the registered account.</strong> Administrators can deactivate or reactivate an owner, but cannot transfer a stall, reset an owner password, or sign in as the owner. Deactivation ends every active session immediately.</div></div>'
      + '<div class="stat-grid mt-2" id="ownerSummary"></div>'
      + '<div class="toolbar mt-2"><div class="search-box">' + U.icon('search') + '<input type="search" id="ownerSearch" placeholder="Search name, email, phone, or stall" aria-label="Search stall owners" maxlength="80"></div>'
      + '<span class="grow"></span><span class="muted small" id="ownerCount"></span></div>'
      + '<div id="ownerBody">' + U.loading('Loading owner accounts…') + '</div>';

    function paint() {
      var text = query.toLowerCase();
      var filtered = owners.filter(function (owner) {
        return !text || [owner.name, owner.email, owner.phone, owner.stallName || ''].join(' ').toLowerCase().indexOf(text) !== -1;
      });
      $('#ownerCount').textContent = filtered.length + ' of ' + owners.length + ' owner account(s)';
      if (!owners.length) {
        $('#ownerBody').innerHTML = '<div class="table-card">' + U.emptyState({ icon: 'users', title: 'No stall owners yet', text: 'Owners create their accounts from the shared portal by choosing an available stall. You will be notified when one registers.' })
          + '</div>';
        return;
      }
      if (!filtered.length) {
        $('#ownerBody').innerHTML = emptyCard('search', 'No matching owners', 'Try a different search term.');
        return;
      }
      $('#ownerBody').innerHTML = '<div class="table-card"><div class="table-wrap"><table><thead><tr>'
        + '<th>Owner</th><th>Phone</th><th>Stall</th><th>Status</th><th>Last sign-in</th><th>Registered</th><th></th>'
        + '</tr></thead><tbody>' + filtered.map(function (owner) {
          return '<tr><td>' + personCell(owner.name, owner.email) + '</td>'
            + '<td class="nowrap">' + U.esc(owner.phone) + '</td>'
            + '<td>' + (owner.stallName ? U.esc(owner.stallName) : '<span class="muted">No stall linked</span>') + '</td>'
            + '<td>' + U.statusBadge(owner.status) + '</td>'
            + '<td class="nowrap">' + (owner.lastLoginAt ? U.dateTime(owner.lastLoginAt) : '<span class="muted">Never</span>') + '</td>'
            + '<td class="nowrap">' + U.dateOnly(owner.createdAt) + '</td>'
            + '<td><div class="table-actions"><button type="button" class="btn ' + (owner.status === 'active' ? 'ghost' : 'secondary') + ' sm" data-owner="' + owner.id + '">'
            + U.icon(owner.status === 'active' ? 'lock' : 'check') + (owner.status === 'active' ? 'Deactivate' : 'Reactivate') + '</button></div></td></tr>';
        }).join('') + '</tbody></table></div>'
        + '<div class="table-foot"><span>Stall assignments never change from this page.</span><span>' + filtered.length + ' shown</span></div></div>';
      $$('[data-owner]', view).forEach(function (button) {
        button.addEventListener('click', function () {
          var owner = owners.find(function (entry) { return entry.id === Number(button.dataset.owner); });
          if (owner) toggleOwner(owner);
        });
      });
    }

    async function toggleOwner(owner) {
      var deactivate = owner.status === 'active';
      var next = deactivate ? 'deactivated' : 'active';
      var ok = await U.confirmDialog({
        title: deactivate ? 'Deactivate this owner account?' : 'Reactivate this owner account?',
        message: deactivate
          ? owner.name + ' will be signed out on every device and will not be able to sign in until reactivated.'
          : owner.name + ' will be able to sign in again. Their stall assignment was never changed.',
        detail: deactivate ? '<p>The stall remains linked to this owner and is not offered to other registrants. You can reactivate the account here later.</p>' : '',
        confirmLabel: deactivate ? 'Deactivate account' : 'Reactivate account',
        danger: deactivate
      });
      if (!ok) return;
      try {
        var result = await A.patch('/api/admin/owners/' + owner.id, { status: next });
        U.toast(result.message, 'ok');
        await load();
      } catch (error) {
        U.toast(error.message, 'er');
      }
    }

    async function load() {
      try {
        var data = await A.get('/api/admin/owners');
        owners = data.owners;
        var active = owners.filter(function (owner) { return owner.status === 'active'; }).length;
        var linked = owners.filter(function (owner) { return owner.stallId; }).length;
        $('#ownerSummary').innerHTML = statCard('Owner accounts', String(owners.length), linked + ' linked to a stall', 'users')
          + statCard('Active', String(active), 'Can sign in and manage their stall', 'check-circle', 'ok')
          + statCard('Deactivated', String(owners.length - active), 'Sessions revoked on deactivation', 'lock', owners.length - active ? 'er' : '')
          + statCard('Available stalls', String(Math.max(0, 10 - linked)), 'Remaining predefined stalls open for registration', 'store');
        paint();
      } catch (error) {
        $('#ownerBody').innerHTML = '<div class="table-card">' + U.errorBlock(error) + '</div>';
      }
    }

    $('#ownerSearch').addEventListener('input', U.debounce(function (event) {
      query = event.target.value.trim();
      paint();
    }, 250));
    await load();
  }

  /* -------------------------------- stalls ------------------------------- */

  async function stallsView(view) {
    var stalls = [];
    var query = '';
    var occupancy = '';
    var statusFilter = '';
    view.innerHTML = viewHead('Stall management', 'Eleven predefined stalls share one catalogue platform. Manage public stall settings, operating status, and commission overrides.',
      '<button class="btn secondary" type="button" id="stallsRefresh">' + U.icon('refresh') + 'Refresh</button>')
      + '<div class="info-banner">' + U.icon('info') + '<div><strong>Owner assignment is registration-controlled.</strong> A stall becomes Occupied only when its owner registers from the portal. This page never reassigns an owner or marks a stall occupied manually.</div></div>'
      + '<div class="stat-grid mt-2" id="stallSummary"></div>'
      + '<div class="toolbar mt-2"><div class="search-box">' + U.icon('search') + '<input type="search" id="stallSearch" placeholder="Search stall, category, owner, or location" aria-label="Search stalls" maxlength="80"></div>'
      + '<select id="stallOccupancy" aria-label="Filter by occupancy"><option value="">All occupancy</option><option value="occupied">Occupied</option><option value="available">Available</option></select>'
      + '<select id="stallStatus" aria-label="Filter by operating status"><option value="">All statuses</option><option value="open">Open</option><option value="closed">Closed</option><option value="under_maintenance">Under maintenance</option><option value="inactive">Inactive</option></select>'
      + '<span class="grow"></span><span class="muted small" id="stallCount"></span></div>'
      + '<div class="stall-grid" id="stallGrid">' + U.loading('Loading stalls…') + '</div>';

    function openStallModal(stall) {
      var modal = U.openModal({
        title: 'Manage ' + stall.name,
        subtitle: 'Stall ' + String(stall.id).padStart(2, '0') + ' · ' + stall.category,
        size: 'wide',
        content: '<form id="stallForm" novalidate><div class="form-grid">'
          + '<div class="field span-2"><label for="stallName">Stall name</label><input id="stallName" name="name" type="text" maxlength="80" value="' + U.attr(stall.name) + '" required><div class="err-text" data-field-error></div></div>'
          + '<div class="field span-2"><label for="stallDescription">Public description</label><textarea id="stallDescription" name="description" maxlength="600">' + U.esc(stall.description || '') + '</textarea><div class="err-text" data-field-error></div></div>'
          + '<div class="field"><label for="stallLocation">Location</label><input id="stallLocation" name="location" type="text" maxlength="120" value="' + U.attr(stall.location || '') + '"><div class="err-text" data-field-error></div></div>'
          + '<div class="field"><label for="stallEmail">Stall contact email</label><input id="stallEmail" name="contactEmail" type="email" maxlength="120" value="' + U.attr(stall.contactEmail || '') + '"><div class="err-text" data-field-error></div></div>'
          + '<div class="field"><label for="stallOperating">Operating status</label><select id="stallOperating" name="operatingStatus">'
          + ['open', 'closed', 'under_maintenance', 'inactive'].map(function (status) {
            return '<option value="' + status + '"' + (stall.operatingStatus === status ? ' selected' : '') + '>' + U.titleCase(status) + '</option>';
          }).join('') + '</select><div class="hint">Closed, under maintenance, and inactive stalls pause new checkout.</div><div class="err-text" data-field-error></div></div>'
          + '<div class="field"><label for="stallCommission">Commission override (%)</label><input id="stallCommission" name="commissionPct" type="number" min="0" max="30" step="0.01" value="' + (stall.commissionPct === null || stall.commissionPct === undefined ? '' : U.attr(stall.commissionPct)) + '" placeholder="Platform default">'
          + '<div class="hint">Leave blank to use the platform rate. Allowed range 0–30%.</div><div class="err-text" data-field-error></div></div>'
          + '</div>'
          + '<div class="notice mt-2">' + U.icon('info') + ' Owner, occupancy, and lease ownership are not edited here. ' + (stall.lease.isSample ? 'Lease values are seeded sample records.' : '') + '</div>'
          + (stall.owner ? '<div class="dl mt-2"><dt>Owner</dt><dd>' + U.esc(stall.owner.name) + ' · ' + U.esc(stall.owner.email) + '</dd><dt>Owner status</dt><dd>' + U.statusBadge(stall.owner.status) + '</dd></div>' : '')
          + '</form>',
        actions: [
          {
            label: 'Save stall settings',
            className: 'primary',
            onClick: async function (modalApi) {
              var form = $('#stallForm', modal.body);
              U.clearFieldErrors(form);
              var name = field(form, 'name').value.trim();
              if (name.length < 2) { U.showFieldError(field(form, 'name'), 'Enter a stall name.'); return false; }
              var commissionValue = field(form, 'commissionPct').value.trim();
              if (commissionValue !== '' && (!Number.isFinite(Number(commissionValue)) || Number(commissionValue) < 0 || Number(commissionValue) > 30)) {
                U.showFieldError(field(form, 'commissionPct'), 'Enter a commission between 0 and 30, or leave it blank.');
                return false;
              }
              var operatingStatus = field(form, 'operatingStatus').value;
              var ok = await U.confirmDialog({
                title: 'Save stall settings?',
                message: 'Changes to ' + name + ' take effect on the storefront immediately.',
                detail: '<p>Operating status: <strong>' + U.titleCase(operatingStatus) + '</strong></p>'
                  + '<p>Commission: <strong>' + (commissionValue === '' ? 'Platform default' : U.esc(commissionValue) + '%') + '</strong></p>'
                  + (stall.operatingStatus !== operatingStatus ? '<p>The owner will see this status change in their workspace and on the storefront.</p>' : ''),
                confirmLabel: 'Save changes'
              });
              if (!ok) return false;
              try {
                var result = await A.put('/api/admin/stalls/' + stall.id, {
                  name: name,
                  description: field(form, 'description').value.trim(),
                  location: field(form, 'location').value.trim(),
                  contactEmail: field(form, 'contactEmail').value.trim(),
                  operatingStatus: operatingStatus,
                  commissionPct: commissionValue === '' ? null : Number(commissionValue)
                });
                U.toast(result.message, 'ok');
                modalApi.close();
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
      var text = query.toLowerCase();
      var filtered = stalls.filter(function (stall) {
        if (occupancy && stall.occupancy !== occupancy) return false;
        if (statusFilter && stall.operatingStatus !== statusFilter) return false;
        if (!text) return true;
        return [stall.name, stall.category, stall.location, stall.owner ? stall.owner.name : '', stall.owner ? stall.owner.email : ''].join(' ').toLowerCase().indexOf(text) !== -1;
      });
      $('#stallCount').textContent = filtered.length + ' of ' + stalls.length + ' stall(s)';
      if (!filtered.length) {
        $('#stallGrid').innerHTML = '<div class="table-card" style="grid-column:1/-1">' + U.emptyState({ icon: 'store', title: 'No matching stalls', text: 'Try a different search or filter.' }) + '</div>';
        return;
      }
      $('#stallGrid').innerHTML = filtered.map(function (stall) {
        var commission = stall.commissionPct === null || stall.commissionPct === undefined ? 'Default' : stall.commissionPct + '%';
        return '<article class="stall-admin-card"><div class="sac-banner">'
          + '<img src="' + U.attr(stall.coverImage || 'logo.png') + '" alt="">'
          + '<span style="position:absolute;top:8px;right:8px">' + U.statusBadge(stall.occupancy) + '</span></div>'
          + '<div class="sac-body"><div class="sac-title">' + U.esc(stall.name) + '</div>'
          + '<div class="sac-sub">' + U.esc(stall.category) + ' · ' + U.esc(stall.location) + '</div>'
          + '<div class="stall-card-badges">' + U.statusBadge(stall.operatingStatus) + '<span class="badge">Fee ' + U.esc(commission) + '</span>' + U.sampleBadge(stall.lease.isSample) + '</div>'
          + '<div class="sac-owner">' + U.icon('user') + (stall.owner ? U.esc(stall.owner.name) + (stall.owner.status === 'deactivated' ? ' · deactivated' : '') : 'No registered owner') + '</div>'
          + '<div class="sac-meta"><div><span>Products</span><strong>' + stall.productCount + '</strong></div><div><span>Orders</span><strong>' + stall.orderCount + '</strong></div><div><span>Stall no.</span><strong>' + String(stall.id).padStart(2, '0') + '</strong></div></div>'
          + '<div class="sac-actions"><button type="button" class="btn secondary sm" data-manage-stall="' + stall.id + '">' + U.icon('edit') + 'Manage</button>'
          + '<a class="btn ghost sm" href="/store/#stall/' + stall.id + '" target="_blank" rel="noopener">' + U.icon('external') + 'View</a></div></div></article>';
      }).join('');
      $$('[data-manage-stall]', view).forEach(function (button) {
        button.addEventListener('click', function () {
          var stall = stalls.find(function (entry) { return entry.id === Number(button.dataset.manageStall); });
          if (stall) openStallModal(stall);
        });
      });
    }

    async function load() {
      try {
        var data = await A.get('/api/admin/stalls');
        stalls = data.stalls;
        var occupied = stalls.filter(function (stall) { return stall.occupancy === 'occupied'; }).length;
        var open = stalls.filter(function (stall) { return stall.operatingStatus === 'open'; }).length;
        var attention = stalls.filter(function (stall) { return ['closed', 'under_maintenance', 'inactive'].indexOf(stall.operatingStatus) !== -1; }).length;
        $('#stallSummary').innerHTML = statCard('Total stalls', String(stalls.length), 'Fixed platform catalogue', 'store')
          + statCard('Occupied', String(occupied), (stalls.length - occupied) + ' still available for registration', 'users', 'accent')
          + statCard('Open now', String(open), 'Accepting new storefront orders', 'check-circle', 'ok')
          + statCard('Paused', String(attention), 'Closed, under maintenance, or inactive', 'alert', attention ? 'wa' : '');
        paint();
      } catch (error) {
        $('#stallGrid').innerHTML = '<div class="table-card" style="grid-column:1/-1">' + U.errorBlock(error) + '</div>';
      }
    }

    $('#stallSearch').addEventListener('input', U.debounce(function (event) { query = event.target.value.trim(); paint(); }, 250));
    $('#stallOccupancy').addEventListener('change', function (event) { occupancy = event.target.value; paint(); });
    $('#stallStatus').addEventListener('change', function (event) { statusFilter = event.target.value; paint(); });
    $('#stallsRefresh').addEventListener('click', load);
    await load();
  }

  /* ------------------------------ staff & roles -------------------------- */

  async function usersView(view) {
    var users = [];
    var role = '';
    var query = '';
    view.innerHTML = viewHead('User and role management', 'Manage administrator and field operator accounts. Owner accounts and stall assignments are handled separately.',
      '<a class="btn secondary" href="#stall-owners">' + U.icon('users') + 'Stall owners</a>')
      + '<div class="info-banner">' + U.icon('shield') + '<div><strong>Least privilege by default.</strong> Operators cannot access platform settings, staff accounts, owner credentials, or commission controls. Role or status changes revoke that person\'s sessions immediately. At least one active administrator must always remain.</div></div>'
      + '<div class="stat-grid mt-2" id="userSummary"></div>'
      + '<div class="filter-tabs mt-2 mb-2" id="userTabs">'
      + '<button type="button" data-role="" class="on">All staff</button>'
      + '<button type="button" data-role="admin">Administrators</button>'
      + '<button type="button" data-role="operator">Operators</button>'
      + '</div>'
      + '<div class="toolbar"><div class="search-box">' + U.icon('search') + '<input type="search" id="userSearch" placeholder="Search name, email, or phone" aria-label="Search staff" maxlength="80"></div>'
      + '<span class="grow"></span><span class="muted small" id="userCount"></span></div>'
      + '<div id="userBody">' + U.loading('Loading staff accounts…') + '</div>';

    function openUserModal(target) {
      var self = A.state.user && A.state.user.id === target.id;
      var modal = U.openModal({
        title: target.name,
        subtitle: self ? 'Your account' : U.titleCase(target.role) + ' account',
        content: '<div class="dl"><dt>Email</dt><dd>' + U.esc(target.email) + '</dd>'
          + '<dt>Phone</dt><dd>' + U.esc(target.phone) + '</dd>'
          + '<dt>Created</dt><dd>' + U.dateOnly(target.createdAt) + '</dd>'
          + '<dt>Last sign-in</dt><dd>' + (target.lastLoginAt ? U.dateTime(target.lastLoginAt) : 'Never') + '</dd></div>'
          + '<div class="stat-divider"></div>'
          + (self
            ? '<div class="notice wa">' + U.icon('alert') + ' You cannot change your own role or deactivate your own account. Ask another administrator to make changes to your access.</div>'
            : '<form id="staffForm" novalidate><div class="form-grid">'
              + '<div class="field"><label for="staffRole">Role</label><select id="staffRole" name="role"><option value="admin"' + (target.role === 'admin' ? ' selected' : '') + '>Administrator</option><option value="operator"' + (target.role === 'operator' ? ' selected' : '') + '>Operator</option></select>'
              + '<div class="hint">Operators handle daily stall operations. Administrators control platform settings and accounts.</div><div class="err-text" data-field-error></div></div>'
              + '<div class="field"><label for="staffStatus">Account status</label><select id="staffStatus" name="status"><option value="active"' + (target.status === 'active' ? ' selected' : '') + '>Active</option><option value="deactivated"' + (target.status === 'deactivated' ? ' selected' : '') + '>Deactivated</option></select>'
              + '<div class="hint">Any change ends the account\'s current sessions.</div><div class="err-text" data-field-error></div></div>'
              + '</div></form>'
              + '<div class="notice mt-2">' + U.icon('lock') + ' Passwords are never visible to administrators. Staff use their own password and recovery flow.</div>')
          + '<p class="modal-actions-note">Owner accounts must be managed from Stall Owner Management so stall ownership is never disturbed.</p>',
        actions: self ? [{ label: 'Close', className: 'ghost' }] : [
          {
            label: 'Save account',
            className: 'primary',
            onClick: async function (modalApi) {
              var form = $('#staffForm', modal.body);
              U.clearFieldErrors(form);
              var nextRole = field(form, 'role').value;
              var nextStatus = field(form, 'status').value;
              if (nextRole === target.role && nextStatus === target.status) { U.toast('No changes were needed.', 'wa'); return false; }
              var ok = await U.confirmDialog({
                title: 'Update staff account?',
                message: target.name + ' will be set to ' + U.titleCase(nextRole) + ' / ' + U.titleCase(nextStatus) + '.',
                detail: '<p>This immediately revokes their active sessions. They will need to sign in again.</p>'
                  + (nextRole === 'admin' ? '<p>Administrators can change platform settings, fees, accounts, reports, and security.</p>' : '<p>Operators can manage daily stall operations and support tickets but cannot change platform settings or accounts.</p>'),
                confirmLabel: 'Save changes',
                danger: nextStatus === 'deactivated'
              });
              if (!ok) return false;
              try {
                var result = await A.patch('/api/admin/users/' + target.id, { role: nextRole, status: nextStatus });
                U.toast(result.message, 'ok');
                modalApi.close();
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
      var text = query.toLowerCase();
      var filtered = users.filter(function (user) {
        return !text || [user.name, user.email, user.phone, user.role].join(' ').toLowerCase().indexOf(text) !== -1;
      });
      $('#userCount').textContent = filtered.length + ' of ' + users.length + ' staff account(s)';
      if (!filtered.length) {
        $('#userBody').innerHTML = emptyCard('users', 'No staff accounts match', 'Try a different search term or role filter.');
        return;
      }
      $('#userBody').innerHTML = '<div class="table-card"><div class="table-wrap"><table><thead><tr>'
        + '<th>Person</th><th>Phone</th><th>Role</th><th>Status</th><th>Created</th><th>Last sign-in</th><th></th>'
        + '</tr></thead><tbody>' + filtered.map(function (user) {
          var isSelf = A.state.user && A.state.user.id === user.id;
          return '<tr><td>' + personCell(user.name, user.email, user.email) + (isSelf ? ' <span class="badge accent">You</span>' : '') + '</td>'
            + '<td class="nowrap">' + U.esc(user.phone) + '</td>'
            + '<td>' + U.statusBadge(user.role, U.titleCase(user.role)) + '</td>'
            + '<td>' + U.statusBadge(user.status) + '</td>'
            + '<td class="nowrap">' + U.dateOnly(user.createdAt) + '</td>'
            + '<td class="nowrap">' + (user.lastLoginAt ? U.dateTime(user.lastLoginAt) : '<span class="muted">Never</span>') + '</td>'
            + '<td><div class="table-actions"><button type="button" class="btn ghost sm" data-staff="' + user.id + '">' + U.icon('edit') + 'Manage</button></div></td></tr>';
        }).join('') + '</tbody></table></div>'
        + '<div class="table-foot"><span>Staff registration requires an email or SMS verification code before the account is created.</span><span>' + filtered.length + ' shown</span></div></div>';
      $$('[data-staff]', view).forEach(function (button) {
        button.addEventListener('click', function () {
          var target = users.find(function (entry) { return entry.id === Number(button.dataset.staff); });
          if (target) openUserModal(target);
        });
      });
    }

    async function load() {
      try {
        var data = await A.get('/api/admin/users' + A.query({ role: role }));
        users = data.users;
        var admins = users.filter(function (user) { return user.role === 'admin'; }).length;
        var operators = users.filter(function (user) { return user.role === 'operator'; }).length;
        var active = users.filter(function (user) { return user.status === 'active'; }).length;
        $('#userSummary').innerHTML = statCard('Administrators', String(admins), 'Full platform access', 'shield', 'accent')
          + statCard('Operators', String(operators), 'Field operations and support', 'clipboard')
          + statCard('Active staff', String(active), 'Can sign in now', 'check-circle', 'ok')
          + statCard('Deactivated', String(users.length - active), 'Sessions already revoked', 'lock', users.length - active ? 'er' : '');
        paint();
      } catch (error) {
        $('#userBody').innerHTML = '<div class="table-card">' + U.errorBlock(error) + '</div>';
      }
    }

    $$('#userTabs [data-role]').forEach(function (button) {
      button.addEventListener('click', function () {
        role = button.dataset.role;
        $$('#userTabs [data-role]').forEach(function (entry) { entry.classList.toggle('on', entry === button); });
        load();
      });
    });
    $('#userSearch').addEventListener('input', U.debounce(function (event) {
      query = event.target.value.trim();
      paint();
    }, 250));
    await load();
  }

  /* -------------------------------- analytics ---------------------------- */

  async function analyticsView(view) {
    var range = newRangeState();
    view.innerHTML = viewHead('Platform analytics', 'Completed sales, refunds, fees, stall performance, and product demand for any period.',
      '<a class="btn secondary" href="#reports">' + U.icon('clipboard') + 'Report preview &amp; CSV</a>')
      + '<div data-range></div>'
      + '<div id="analyticsBody">' + U.loading('Loading analytics…') + '</div>';

    async function load() {
      $('#analyticsBody').innerHTML = U.loading('Loading analytics…');
      try {
        var payload = await A.get('/api/admin/analytics' + A.query(rangeParams(range)));
        var totals = payload.totals;
        var breakdownRows = payload.breakdown || [];
        var totalDelivered = breakdownRows.reduce(function (sum, row) { return sum + row.deliveredCents; }, 0);
        var totalRefunds = breakdownRows.reduce(function (sum, row) { return sum + row.refundedCents; }, 0);
        var totalFees = breakdownRows.reduce(function (sum, row) { return sum + row.feesCents; }, 0);
        $('#analyticsBody').innerHTML = '<div class="report-meta"><strong>' + U.esc(payload.range.label) + '</strong><span>' + U.esc(payload.range.startLocal) + ' → ' + U.esc(payload.range.endLocal) + '</span><span>' + U.esc(payload.range.timezone) + '</span><span>' + totals.sampleOrderCount + ' sample order(s)</span></div>'
          + '<div class="stat-grid">'
          + statCard('Completed sales', U.money(totals.completedSalesCents), totals.deliveredCount + ' delivered order(s)', 'trend', 'ok')
          + statCard('Refunds', U.money(totals.refundsCents), totals.refundedCount + ' refunded order(s)', 'refresh', totals.refundsCents ? 'er' : '')
          + statCard('Net sales', U.money(totals.netSalesCents), U.money(totals.discountsCents) + ' discounts', 'peso')
          + statCard('Platform fees', U.money(totals.platformFeesCents), 'Owner net ' + U.money(totals.ownerNetCents), 'chart')
          + statCard('Average order', U.money(payload.averageOrderCents), 'Delivered orders only', 'receipt')
          + statCard('Units in counted orders', U.number(totals.unitsSold), 'Delivered plus refunded units', 'box')
          + '</div>'
          + '<div class="card mt-2"><div class="card-head"><h3>Daily delivered sales and refunds</h3><span class="badge">' + U.esc(payload.range.label) + '</span></div>'
          + C.lineChart(payload.dailySeries, { valueKey: 'deliveredCents', refundKey: 'refundedCents', valueLabel: 'Delivered', refundLabel: 'Refunded', format: U.money, height: 240, title: 'Daily delivered sales and refunds' })
          + '<p class="hint">Completed sales are recognised only when an order is marked Delivered. Refunds are shown separately and are not revenue.</p></div>'
          + '<div class="grid-2 mt-2">'
          + '<div class="card"><div class="card-head"><h3>Stall performance</h3><span class="muted small">' + totals.orderCount + ' order(s) in period</span></div>'
          + '<div class="table-wrap"><table><thead><tr><th>Stall</th><th>Status</th><th class="num">Orders</th><th class="num">Delivered</th><th class="num">Delivered sales</th><th class="num">Refunds</th><th class="num">Fees</th></tr></thead><tbody>'
          + (breakdownRows.length ? breakdownRows.map(function (row) {
            return '<tr><td><strong>' + U.esc(row.stallName) + '</strong></td><td>' + U.statusBadge(row.operatingStatus) + '</td>'
              + '<td class="num">' + row.orderCount + '</td><td class="num">' + row.deliveredOrders + '</td>'
              + '<td class="num">' + U.money(row.deliveredCents) + '</td><td class="num">' + (row.refundedCents ? negMoney(row.refundedCents) : '—') + '</td>'
              + '<td class="num">' + U.money(row.feesCents) + '</td></tr>';
          }).join('') + '<tr><td><strong>Platform total</strong></td><td></td><td class="num"><strong>' + totals.orderCount + '</strong></td><td class="num"><strong>' + totals.deliveredCount + '</strong></td>'
            + '<td class="num"><strong>' + U.money(totalDelivered) + '</strong></td><td class="num"><strong>' + (totalRefunds ? negMoney(totalRefunds) : '—') + '</strong></td><td class="num"><strong>' + U.money(totalFees) + '</strong></td></tr>' : '<tr><td colspan="7"><div class="empty-state" style="padding:20px"><p>No stalls found.</p></div></td></tr>')
          + '</tbody></table></div></div>'
          + '<div class="stack-gap"><div class="card"><div class="card-head"><h3>Top products</h3></div>'
          + (payload.topProducts.length ? C.barList(payload.topProducts.map(function (row) { return { name: row.name, value: row.revenueCents }; }), { format: U.money }) : '<div class="chart-empty">No delivered sales in this period.</div>')
          + '</div><div class="card"><div class="card-head"><h3>Categories</h3></div>'
          + (payload.categories.length ? C.barList(payload.categories.map(function (row) { return { name: row.category, value: row.revenueCents }; }), { format: U.money }) : '<div class="chart-empty">No delivered sales in this period.</div>')
          + '</div><div class="card"><div class="card-head"><h3>Reviews</h3></div><div class="dl"><dt>Published reviews</dt><dd>' + payload.ratings.count + '</dd>'
          + '<dt>Average rating</dt><dd>' + (payload.ratings.average === null ? 'No ratings yet' : payload.ratings.average + ' / 5') + '</dd></div>'
          + '<p class="hint">Held reviews are not counted until a moderator publishes them.</p></div></div></div>'
          ;
      } catch (error) {
        $('#analyticsBody').innerHTML = '<div class="table-card">' + U.errorBlock(error) + '</div>';
      }
    }

    bindRange($('[data-range]', view), range, load);
    await load();
  }

  /* -------------------------------- reports ------------------------------ */

  async function reportsView(view) {
    var range = newRangeState();
    var preview = null;
    view.innerHTML = viewHead('Audit Logs', 'Preview platform-wide sales, then export exactly the previewed snapshot as CSV. Preview links expire after 15 minutes.', '')
      + '<div data-range></div>'
      + '<div class="info-banner">' + U.icon('info') + '<div><strong>Preview first, then export.</strong> The CSV is built from the same snapshot as the preview, so its records and totals match what you see here. CSV export is enabled only after a preview.</div></div>'
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
        }).join('') + '</tbody></table></div><div class="table-foot">Per-stall breakdown across all eleven stalls for the previewed period.</div></div>' : '';
      $('#reportBody').innerHTML = summary + table + breakdown;
    }

    $('#previewReport').addEventListener('click', async function () {
      var button = $('#previewReport');
      U.setBusy(button, true, 'Building preview…');
      try {
        var report = await A.get('/api/admin/reports' + A.query(rangeParams(range)));
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
        var name = await A.download('/api/admin/reports.csv' + A.query(query), 'skyworld-platform-report.csv');
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

  /* ------------------------------ transactions --------------------------- */

  async function transactionsView(view) {
    var filters = { status: '', q: '' };
    var range = newRangeState();
    view.innerHTML = viewHead('Transactions', 'Platform-wide order ledger for any period, including pending and cancelled orders.', '<a class="btn secondary" href="#reports">' + U.icon('clipboard') + 'Period report</a>')
      + '<div data-range></div>'
      + '<div class="toolbar"><select id="txStatus" aria-label="Filter by order status"><option value="">All statuses</option>'
      + ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled', 'refunded'].map(function (status) { return '<option value="' + status + '">' + U.titleCase(status) + '</option>'; }).join('')
      + '</select><div class="search-box">' + U.icon('search') + '<input type="search" id="txSearch" placeholder="Search order, customer, or email" aria-label="Search transactions" maxlength="80"></div>'
      + '<span class="grow"></span><span class="muted small" id="txRangeLabel"></span></div>'
      + '<div id="txBody">' + U.loading('Loading transactions…') + '</div>';

    async function load() {
      $('#txBody').innerHTML = U.loading('Loading transactions…');
      try {
        var payload = await A.get('/api/admin/transactions' + A.query(Object.assign({ status: filters.status, q: filters.q }, rangeParams(range))));
        var totals = payload.totals;
        $('#txRangeLabel').textContent = payload.range.startLocal + ' → ' + payload.range.endLocal;
        $('#txBody').innerHTML = '<div class="stat-grid">'
          + statCard('Completed sales', U.money(totals.completedSalesCents), totals.deliveredCount + ' delivered', 'trend', 'ok')
          + statCard('Refunds', U.money(totals.refundsCents), totals.refundedCount + ' refunded', 'refresh', totals.refundsCents ? 'er' : '')
          + statCard('Platform fees', U.money(totals.platformFeesCents), 'Owner net ' + U.money(totals.ownerNetCents), 'peso')
          + statCard('Orders in period', U.number(totals.orderCount), totals.sampleOrderCount + ' labelled Sample', 'receipt')
          + '</div>'
          + (payload.orders.length ? '<div class="table-card mt-2"><div class="table-wrap"><table><thead><tr>'
            + '<th>Order</th><th>Placed</th><th>Stall</th><th>Customer</th><th class="num">Qty</th><th class="num">Shipping</th><th class="num">Total</th><th>Status</th>'
            + '</tr></thead><tbody>' + payload.orders.map(function (order) {
              return '<tr><td><span class="mono">' + U.esc(order.code) + '</span>' + (order.isSample ? '<div>' + U.sampleBadge(true) + '</div>' : '') + '</td>'
                + '<td class="nowrap">' + U.esc(order.localDateTime) + '</td><td>' + U.esc(order.stallName) + '</td><td>' + U.esc(order.customerName) + '</td>'
                + '<td class="num">' + order.quantity + '</td>'
                + '<td class="num">' + U.money(order.shippingCents) + '</td>'
                + '<td class="num"><strong>' + U.money(order.totalCents) + '</strong></td><td>' + U.statusBadge(order.status) + '</td></tr>';
            }).join('') + '</tbody></table></div>'
            + '<div class="table-foot"><span>' + (payload.capped ? 'Showing the latest ' + payload.maxRows + ' orders. Narrow the period for a complete list.' : payload.orders.length + ' order(s) · ' + payload.range.label) + '</span>'
            + '<span>Completed sales count Delivered orders only.</span></div></div>'
            : emptyCard('receipt', 'No orders in this period', 'Try another period or clear the status and search filters.'))
      } catch (error) {
        $('#txBody').innerHTML = '<div class="table-card">' + U.errorBlock(error) + '</div>';
      }
    }

    bindRange($('[data-range]', view), range, load);
    $('#txStatus').addEventListener('change', function (event) { filters.status = event.target.value; load(); });
    $('#txSearch').addEventListener('input', U.debounce(function (event) { filters.q = event.target.value.trim(); load(); }, 320));
    await load();
  }

  /* -------------------------------- settings ----------------------------- */

  async function settingsView(view) {
    var results = await Promise.all([A.get('/api/admin/settings'), A.get('/api/admin/delivery')]);
    var payload = results[0];
    var delivery = results[1];
    var initial = payload.settings;
    var logoUrl = initial.logoUrl || '';
    var emailSource = delivery.email.configured
      ? '<span class="provider-pill on">Configured · ' + U.esc(delivery.email.source === 'environment' ? 'Environment' : 'Admin settings') + '</span>'
      : '<span class="provider-pill off">Not configured</span>';
    var smsSource = delivery.sms.configured
      ? '<span class="provider-pill on">Configured · ' + U.esc(delivery.sms.source === 'environment' ? 'Environment' : 'Admin settings') + '</span>'
      : '<span class="provider-pill off">Not configured</span>';
    var outboxRows = (delivery.outbox || []).map(function (row) {
      return '<tr><td><span class="badge">' + U.esc(row.channel) + '</span></td><td>' + U.esc(row.recipient) + '</td><td>' + U.esc(row.purpose) + '</td><td><code>' + U.esc(row.code) + '</code></td><td class="small muted">' + U.esc(row.createdAt) + '</td></tr>';
    }).join('');
    view.innerHTML = viewHead('System settings', 'Storefront identity, logo, payment pages, availability, review moderation, and verification delivery.', '')
      + '<form id="settingsForm" novalidate>'
      + '<div class="grid-2 even">'
      + '<div class="form-card"><div class="card-head"><h3>Storefront identity</h3></div>'
      + '<div class="field"><label>Brand logo</label>'
      + '<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">'
      + '<img id="logoPreview" src="' + U.attr(logoUrl || '/shared/logo.svg') + '" alt="Current brand logo" style="width:64px;height:64px;object-fit:contain;border:1px solid var(--border);border-radius:12px;background:var(--surface-2);padding:6px">'
      + '<div><button type="button" class="btn secondary sm" id="logoPick">' + U.icon('upload') + 'Upload logo</button> '
      + '<button type="button" class="btn ghost sm" id="logoReset">Use default</button>'
      + '<input type="file" id="logoFile" accept="image/png,image/jpeg,image/webp" hidden>'
      + '<div class="hint">PNG, JPEG, or WebP up to 5 MB. A square image works best. The logo is saved with the form.</div></div></div>'
      + '<div class="err-text" data-field-error></div></div>'
      + '<div class="field mt-2"><label for="siteName">Site name</label><input id="siteName" name="siteName" type="text" maxlength="80" value="' + U.attr(initial.siteName) + '" required><div class="err-text" data-field-error></div></div>'
      + '<div class="field mt-2"><label for="supportEmail">Support email</label><input id="supportEmail" name="supportEmail" type="email" maxlength="120" value="' + U.attr(initial.supportEmail) + '" required><div class="hint">Shown to customers and used for platform contact links.</div><div class="err-text" data-field-error></div></div>'
      + '<div class="field mt-2"><label for="promoHint">Storefront promo hint</label><input id="promoHint" name="promoHint" type="text" maxlength="40" value="' + U.attr(initial.promoHint) + '"><div class="hint">Short badge text, for example a voucher code. Leave blank to hide it.</div><div class="err-text" data-field-error></div></div>'
      + '<div class="notice mt-2">' + U.icon('info') + ' Demo mode is enabled on this installation. Seeded demonstration records are labelled Sample and cannot be confused with live revenue.</div>'
      + '</div>'
      + '<div class="form-card"><div class="card-head"><h3>Availability &amp; moderation</h3></div>'
      + '<div class="switch-row"><input type="checkbox" id="maintenanceMode" name="maintenanceMode"' + (initial.maintenanceMode ? ' checked' : '') + '><div class="sr-main"><label class="sr-title" for="maintenanceMode">Maintenance mode</label><div class="sr-sub">Pauses the public storefront with a maintenance notice. Dashboards remain available for staff.</div></div></div>'
      + '<div class="switch-row"><input type="checkbox" id="reviewFilterEnabled" name="reviewFilterEnabled"' + (initial.reviewFilterEnabled ? ' checked' : '') + '><div class="sr-main"><label class="sr-title" for="reviewFilterEnabled">Automatic review filter</label><div class="sr-sub">Holds reviews that contain prohibited words or spam patterns for moderator approval.</div></div></div>'
      + '<div class="stat-divider"></div>'
      + '<div class="notice info">' + U.icon('mail') + ' Verification and recovery delivery is configured in the Delivery providers panel below. Test messages go only to the contact details on your administrator account.</div>'
      + '</div></div>'
      + '<div class="form-card mt-2"><div class="card-head"><h3>Prohibited words</h3><span class="badge">' + initial.prohibitedWords.length + ' word(s)</span></div>'
      + '<div class="field"><label for="prohibitedWords">One word or phrase per line</label><textarea id="prohibitedWords" name="prohibitedWords" rows="6" maxlength="6000">' + U.esc(initial.prohibitedWords.join('\n')) + '</textarea>'
      + '<div class="hint">Commas are also accepted. Keep at least one entry while the filter is enabled. Matching is enforced on the server before a review is saved.</div><div class="err-text" data-field-error></div></div>'
      + '</div>'
      + '<div class="form-card mt-2"><div class="card-head"><h3>Payment page links</h3><span class="badge">Storefront checkout</span></div>'
      + '<p class="hint">Paste the official page customers should open to pay. The checkout shows the link for the selected method, and the order confirmation repeats it with the order code. Leave a field blank to show an honest “not configured” note instead. Only https:// links are accepted.</p>'
      + '<div class="form-grid">'
      + '<div class="field"><label for="payGcash">GCash payment page URL</label><input id="payGcash" name="paymentGcash" type="url" maxlength="500" value="' + U.attr(initial.paymentLinks.gcash) + '" placeholder="https://"><div class="hint">For example a GCash payment link or merchant page.</div><div class="err-text" data-field-error></div></div>'
      + '<div class="field"><label for="payMaya">Maya payment page URL</label><input id="payMaya" name="paymentMaya" type="url" maxlength="500" value="' + U.attr(initial.paymentLinks.maya) + '" placeholder="https://"><div class="hint">The official Maya checkout or payment page.</div><div class="err-text" data-field-error></div></div>'
      + '<div class="field span-2"><label for="payBank">Bank transfer payment page URL</label><input id="payBank" name="paymentBank" type="url" maxlength="500" value="' + U.attr(initial.paymentLinks.bank) + '" placeholder="https://"><div class="hint">Your bank’s transfer page or a hosted payment page. Never put account passwords here.</div><div class="err-text" data-field-error></div></div>'
      + '</div>'
      + '<div class="notice mt-2">' + U.icon('shield') + ' Links are validated on the server and open in a new tab. SkyWorld does not process card details on this site.</div>'
      + '</div>'
      + '<div class="form-actions"><button type="submit" class="btn primary" id="saveSettings">' + U.icon('check') + 'Save platform settings</button>'
      + '<span class="muted small">' + U.esc(payload.timezone) + '</span></div>'
      + '</form>'
      + '<div class="form-card mt-2" id="deliveryCard"><div class="card-head"><h3>Delivery providers</h3><span class="badge">Verification codes</span></div>'
      + '<p class="hint">Email (SMTP) and SMS providers send registration verification and password reset codes. Credentials are stored on the server in <code>data/providers.json</code> and are never returned to this page. Changes apply immediately.</p>'
      + '<div class="grid-2 even">'
      + '<form class="delivery-form" id="emailProviderForm" novalidate>'
      + '<div class="delivery-form-head"><h4>' + U.icon('mail') + ' Email · SMTP</h4>' + emailSource + '</div>'
      + '<div class="form-grid">'
      + '<div class="field span-2"><label for="smtpHost">SMTP host</label><input id="smtpHost" name="host" type="text" value="' + U.attr(delivery.email.host || '') + '" placeholder="smtp.gmail.com" autocomplete="off"><div class="hint">Gmail: smtp.gmail.com. Outlook: smtp-mail.outlook.com.</div><div class="err-text" data-field-error></div></div>'
      + '<div class="field"><label for="smtpPort">Port</label><input id="smtpPort" name="port" type="number" min="1" max="65535" value="' + U.attr(delivery.email.port || 587) + '"><div class="err-text" data-field-error></div></div>'
      + '<div class="field"><label for="smtpSecure">Connection</label><label class="checkline"><input id="smtpSecure" name="secure" type="checkbox"' + (delivery.email.secure ? ' checked' : '') + '><span>Use implicit TLS (port 465)</span></label><div class="hint">Leave unticked for STARTTLS on port 587.</div></div>'
      + '<div class="field"><label for="smtpUser">SMTP username</label><input id="smtpUser" name="user" type="text" autocomplete="off" placeholder="' + U.attr(delivery.email.user ? 'Saved: ' + delivery.email.user + ' — leave blank to keep' : 'you@gmail.com') + '"><div class="err-text" data-field-error></div></div>'
      + '<div class="field"><label for="smtpPass">SMTP password / app password</label><input id="smtpPass" name="pass" type="password" autocomplete="new-password" placeholder="' + U.attr(delivery.email.hasPassword ? 'Saved — leave blank to keep' : 'Gmail App Password') + '"><div class="hint">Gmail requires a 16-character App Password, not your normal password.</div><div class="err-text" data-field-error></div></div>'
      + '<div class="field"><label for="smtpFrom">From email</label><input id="smtpFrom" name="from" type="email" value="' + U.attr(delivery.email.from || '') + '" placeholder="orders@yourdomain.com"><div class="err-text" data-field-error></div></div>'
      + '<div class="field"><label for="smtpFromName">From name</label><input id="smtpFromName" name="fromName" type="text" maxlength="80" value="' + U.attr(delivery.email.fromName || 'SkyWorld Stall') + '"><div class="err-text" data-field-error></div></div>'
      + '</div>'
      + '<div class="btn-row mt-2"><button class="btn primary sm" type="submit" id="saveEmailProvider">' + U.icon('check') + 'Save email provider</button>'
      + '<button class="btn ghost sm" type="button" data-test-provider="email"' + (delivery.email.configured ? '' : ' disabled') + '>Send test email</button>'
      + (delivery.email.source === 'settings' ? '<button class="btn ghost sm" type="button" data-clear-provider="email">Remove saved settings</button>' : '')
      + '</div>'
      + '<div class="small muted mt-1" data-provider-result="email"></div>'
      + '</form>'
      + '<form class="delivery-form" id="smsProviderForm" novalidate>'
      + '<div class="delivery-form-head"><h4>' + U.icon('phone') + ' SMS</h4>' + smsSource + '</div>'
      + '<div class="field"><label for="smsProvider">SMS provider</label><select id="smsProvider" name="provider">'
      + '<option value="semaphore"' + (delivery.sms.provider === 'semaphore' ? ' selected' : '') + '>Semaphore (Philippines)</option>'
      + '<option value="twilio"' + (delivery.sms.provider === 'twilio' ? ' selected' : '') + '>Twilio</option>'
      + '<option value="webhook"' + (delivery.sms.provider === 'webhook' ? ' selected' : '') + '>Custom HTTPS webhook</option>'
      + '</select><div class="err-text" data-field-error></div></div>'
      + '<div class="sms-group" data-sms-provider="semaphore"><div class="form-grid">'
      + '<div class="field span-2"><label for="semaphoreApiKey">Semaphore API key</label><input id="semaphoreApiKey" name="semaphoreApiKey" type="password" autocomplete="new-password" placeholder="' + U.attr(delivery.sms.hasApiKey && delivery.sms.provider === 'semaphore' ? 'Saved — leave blank to keep' : 'Your Semaphore API key') + '"></div>'
      + '<div class="field"><label for="semaphoreSender">Sender name</label><input id="semaphoreSender" name="semaphoreSender" type="text" maxlength="32" value="' + U.attr(delivery.sms.provider === 'semaphore' ? delivery.sms.sender : 'SkyWorld') + '"><div class="hint">Shown as the sender on the SMS.</div></div>'
      + '</div></div>'
      + '<div class="sms-group" data-sms-provider="twilio"><div class="form-grid">'
      + '<div class="field span-2"><label for="twilioAccountSid">Twilio Account SID</label><input id="twilioAccountSid" name="twilioAccountSid" type="text" autocomplete="off" placeholder="AC…"></div>'
      + '<div class="field"><label for="twilioAuthToken">Auth token</label><input id="twilioAuthToken" name="twilioAuthToken" type="password" autocomplete="new-password" placeholder="' + U.attr(delivery.sms.hasApiKey && delivery.sms.provider === 'twilio' ? 'Saved — leave blank to keep' : 'Auth token') + '"></div>'
      + '<div class="field"><label for="twilioFrom">Sender number</label><input id="twilioFrom" name="twilioFrom" type="text" placeholder="+15551234567" value="' + U.attr(delivery.sms.provider === 'twilio' ? delivery.sms.sender : '') + '"></div>'
      + '</div></div>'
      + '<div class="sms-group" data-sms-provider="webhook"><div class="form-grid">'
      + '<div class="field span-2"><label for="webhookUrl">Webhook URL</label><input id="webhookUrl" name="webhookUrl" type="url" placeholder="https://your-gateway.example.com/send"><div class="hint">Receives a JSON POST with <code>to</code> and <code>message</code>.</div></div>'
      + '<div class="field span-2"><label for="webhookToken">Webhook bearer token (optional)</label><input id="webhookToken" name="webhookToken" type="password" autocomplete="new-password" placeholder="' + U.attr(delivery.sms.hasWebhook ? 'Saved — leave blank to keep' : 'Optional token') + '"></div>'
      + '</div></div>'
      + '<div class="btn-row mt-2"><button class="btn primary sm" type="submit" id="saveSmsProvider">' + U.icon('check') + 'Save SMS provider</button>'
      + '<button class="btn ghost sm" type="button" data-test-provider="sms"' + (delivery.sms.configured ? '' : ' disabled') + '>Send test SMS</button>'
      + (delivery.sms.source === 'settings' ? '<button class="btn ghost sm" type="button" data-clear-provider="sms">Remove saved settings</button>' : '')
      + '</div>'
      + '<div class="small muted mt-1" data-provider-result="sms"></div>'
      + '</form>'
      + '</div>'
      + '<div class="delivery-hints">' + (delivery.hints || []).map(function (hint) { return '<p>' + U.icon('info') + U.esc(hint) + '</p>'; }).join('') + '</div>'
      + (outboxRows
        ? '<details class="mt-2 delivery-outbox"><summary>Recent development codes (' + (delivery.outbox || []).length + ')</summary>'
          + '<p class="hint">These codes were generated because no provider was configured in this development server. They are never recorded in production.</p>'
          + '<div class="table-wrap"><table class="table"><thead><tr><th>Channel</th><th>Recipient</th><th>Purpose</th><th>Code</th><th>Generated</th></tr></thead><tbody>' + outboxRows + '</tbody></table></div></details>'
        : '')
      + '<div id="providerTestResult" class="small muted mt-1"></div>'
      + '</div>';

    U.$$('[data-sms-provider]', view).forEach(function (group) {
      group.hidden = group.dataset.smsProvider !== U.$('#smsProvider', view).value;
    });
    U.$('#smsProvider', view).addEventListener('change', function (event) {
      U.$$('[data-sms-provider]', view).forEach(function (group) {
        group.hidden = group.dataset.smsProvider !== event.target.value;
      });
    });

    U.$('#emailProviderForm', view).addEventListener('submit', async function (event) {
      event.preventDefault();
      var form = event.currentTarget;
      U.clearFieldErrors(form); U.clearFormError(form);
      var button = U.$('#saveEmailProvider', view);
      U.setBusy(button, true, 'Saving…');
      try {
        var result = await A.put('/api/admin/delivery', {
          email: {
            enabled: true,
            host: form.elements.namedItem('host').value.trim(),
            port: Number(form.elements.namedItem('port').value),
            secure: form.elements.namedItem('secure').checked,
            user: form.elements.namedItem('user').value.trim(),
            pass: form.elements.namedItem('pass').value,
            from: form.elements.namedItem('from').value.trim(),
            fromName: form.elements.namedItem('fromName').value.trim()
          }
        });
        U.toast(result.message, 'ok');
        await settingsView(view);
      } catch (error) {
        U.applyApiError(form, error);
        U.setBusy(button, false);
      }
    });

    U.$('#smsProviderForm', view).addEventListener('submit', async function (event) {
      event.preventDefault();
      var form = event.currentTarget;
      U.clearFieldErrors(form); U.clearFormError(form);
      var button = U.$('#saveSmsProvider', view);
      U.setBusy(button, true, 'Saving…');
      try {
        var result = await A.put('/api/admin/delivery', {
          sms: {
            enabled: true,
            provider: form.elements.namedItem('provider').value,
            semaphoreApiKey: form.elements.namedItem('semaphoreApiKey').value,
            semaphoreSender: form.elements.namedItem('semaphoreSender').value.trim(),
            twilioAccountSid: form.elements.namedItem('twilioAccountSid').value.trim(),
            twilioAuthToken: form.elements.namedItem('twilioAuthToken').value,
            twilioFrom: form.elements.namedItem('twilioFrom').value.trim(),
            webhookUrl: form.elements.namedItem('webhookUrl').value.trim(),
            webhookToken: form.elements.namedItem('webhookToken').value
          }
        });
        U.toast(result.message, 'ok');
        await settingsView(view);
      } catch (error) {
        U.applyApiError(form, error);
        U.setBusy(button, false);
      }
    });

    U.$$('[data-clear-provider]', view).forEach(function (button) {
      button.addEventListener('click', async function () {
        var channel = button.dataset.clearProvider;
        var go = await U.confirmDialog({
          title: 'Remove saved ' + channel + ' settings?',
          message: 'Verification codes will stop being delivered through this provider unless server environment variables are configured.',
          confirmLabel: 'Remove saved settings',
          danger: true
        });
        if (!go) return;
        U.setBusy(button, true, 'Removing…');
        try {
          var payload = {};
          payload[channel] = { enabled: false };
          var result = await A.put('/api/admin/delivery', payload);
          U.toast(result.message, 'ok');
          await settingsView(view);
        } catch (error) {
          U.toast(error.message, 'er');
          U.setBusy(button, false);
        }
      });
    });

    function paintLogo() {
      var preview = $('#logoPreview');
      if (preview) preview.src = logoUrl || '/shared/logo.svg';
    }

    $('#logoPick').addEventListener('click', function () { $('#logoFile').click(); });
    $('#logoReset').addEventListener('click', function () {
      logoUrl = '';
      paintLogo();
      U.toast('Default logo selected. Save settings to apply it.', 'ok');
    });
    $('#logoFile').addEventListener('change', async function (event) {
      var file = event.target.files && event.target.files[0];
      if (!file) return;
      var button = $('#logoPick');
      U.setBusy(button, true, 'Uploading…');
      try {
        var uploaded = await A.upload(file);
        logoUrl = uploaded.url;
        paintLogo();
        U.toast('Logo uploaded. Save platform settings to publish it.', 'ok');
      } catch (error) {
        U.toast(error.message, 'er');
      } finally {
        U.setBusy(button, false);
        event.target.value = '';
      }
    });

    $('#settingsForm').addEventListener('submit', async function (event) {
      event.preventDefault();
      var form = event.currentTarget;
      var button = $('#saveSettings');
      U.clearFieldErrors(form); U.clearFormError(form);
      var maintenanceMode = field(form, 'maintenanceMode').checked;
      var reviewFilterEnabled = field(form, 'reviewFilterEnabled').checked;
      if (maintenanceMode && !initial.maintenanceMode) {
        var go = await U.confirmDialog({
          title: 'Enable maintenance mode?',
          message: 'The public storefront will show a maintenance notice until you turn it off.',
          detail: '<p>Staff dashboards, the admin area, and the field operator workspace stay available. Existing data is not changed.</p>',
          confirmLabel: 'Enable maintenance mode'
        });
        if (!go) return;
      }
      if (!reviewFilterEnabled && initial.reviewFilterEnabled) {
        var off = await U.confirmDialog({
          title: 'Turn off automatic review filtering?',
          message: 'New customer reviews will publish without bad-word or spam screening.',
          detail: '<p>Existing held reviews stay held until a moderator approves or rejects them. You can turn the filter back on at any time.</p>',
          confirmLabel: 'Disable filter',
          danger: true
        });
        if (!off) return;
      }
      var words = field(form, 'prohibitedWords').value.split(/[\n,]/).map(function (word) { return word.trim(); }).filter(Boolean);
      if (reviewFilterEnabled && !words.length) {
        U.showFieldError(field(form, 'prohibitedWords'), 'Keep at least one prohibited word, or turn the filter off.');
        return;
      }
      var paymentLinks = {
        gcash: field(form, 'paymentGcash').value.trim(),
        maya: field(form, 'paymentMaya').value.trim(),
        bank: field(form, 'paymentBank').value.trim()
      };
      var invalidLink = '';
      ['gcash', 'maya', 'bank'].forEach(function (key) {
        if (invalidLink || !paymentLinks[key]) return;
        try {
          var parsed = new URL(paymentLinks[key]);
          if (parsed.protocol !== 'https:' || parsed.username || parsed.password) invalidLink = key;
        } catch (_) {
          invalidLink = key;
        }
      });
      if (invalidLink) {
        var fieldName = invalidLink === 'gcash' ? 'paymentGcash' : invalidLink === 'maya' ? 'paymentMaya' : 'paymentBank';
        U.showFieldError(field(form, fieldName), 'Enter a valid https:// payment page URL, or leave it blank.');
        return;
      }
      U.setBusy(button, true, 'Saving…');
      try {
        var result = await A.put('/api/admin/settings', {
          siteName: field(form, 'siteName').value.trim(),
          supportEmail: field(form, 'supportEmail').value.trim(),
          promoHint: field(form, 'promoHint').value.trim(),
          maintenanceMode: maintenanceMode,
          reviewFilterEnabled: reviewFilterEnabled,
          prohibitedWords: words,
          logoUrl: logoUrl,
          paymentLinks: paymentLinks
        });
        U.toast(result.message, 'ok');
        U.$$('.dash-brand img').forEach(function (img) { img.src = '/api/brand/logo?v=' + Date.now(); });
        await settingsView(view);
      } catch (error) {
        U.applyApiError(form, error);
      } finally {
        U.setBusy(button, false);
      }
    });

    U.$$('[data-test-provider]', view).forEach(function (button) {
      button.addEventListener('click', async function () {
        var resultBox = U.$('#providerTestResult', view);
        U.setBusy(button, true, 'Sending…');
        if (resultBox) resultBox.textContent = '';
        try {
          var result = await A.post('/api/admin/providers/test', { channel: button.dataset.testProvider });
          U.toast(result.message, result.sent ? 'ok' : 'er');
          if (resultBox) resultBox.textContent = result.message;
        } catch (error) {
          U.toast(error.message, 'er');
          if (resultBox) resultBox.textContent = error.message;
        } finally {
          U.setBusy(button, false);
        }
      });
    });
  }

  /* --------------------------------- fees -------------------------------- */

  async function feesView(view, api) {
    var payload = await A.get('/api/admin/fees');
    view.innerHTML = viewHead('Commission and fee settings', 'Set the platform commission, shipping fee, and free-shipping threshold used at checkout.', '')
      + '<div class="grid-2 even"><form class="form-card" id="feesForm" novalidate>'
      + '<div class="card-head"><h3>Platform rates</h3><span class="badge">Applied to new orders</span></div>'
      + '<div class="field"><label for="feeCommission">Commission (%)</label><input id="feeCommission" name="commissionPct" type="number" min="0" max="30" step="0.01" value="' + U.attr(payload.commissionPct) + '" required>'
      + '<div class="hint">0–30%. Calculated on the discounted subtotal, excluding shipping.</div><div class="err-text" data-field-error></div></div>'
      + '<div class="field mt-2"><label for="feeShipping">Standard shipping fee (₱)</label><input id="feeShipping" name="shippingFee" type="text" inputmode="decimal" value="' + U.attr(U.fromCents(payload.shippingFeeCents)) + '" required>'
      + '<div class="hint">Enter pesos and centavos, for example 49.00.</div><div class="err-text" data-field-error></div></div>'
      + '<div class="field mt-2"><label for="feeThreshold">Free-shipping threshold (₱)</label><input id="feeThreshold" name="freeShippingThreshold" type="text" inputmode="decimal" value="' + U.attr(U.fromCents(payload.freeShippingThresholdCents)) + '" required>'
      + '<div class="hint">Must be at least the standard shipping fee.</div><div class="err-text" data-field-error></div></div>'
      + '<div class="form-actions"><button type="submit" class="btn primary" id="saveFees">' + U.icon('check') + 'Save rates</button></div>'
      + '</form>'
      + '<div class="card"><div class="card-head"><h3>Per-stall overrides</h3><a href="#stalls">Manage stalls</a></div>'
      + (payload.stallOverrides.length ? '<div class="table-wrap"><table><thead><tr><th>Stall</th><th class="num">Commission</th></tr></thead><tbody>'
        + payload.stallOverrides.map(function (row) { return '<tr><td>' + U.esc(row.name) + '</td><td class="num">' + row.commission_pct + '%</td></tr>'; }).join('')
        + '</tbody></table></div>' : '<div class="chart-empty">No stall overrides. Every stall uses the platform rate.</div>')
      + '<div class="stat-divider"></div><ul class="small" style="padding-left:18px;color:var(--ink-soft)">'
      + payload.notes.map(function (note) { return '<li style="margin-bottom:4px">' + U.esc(note) + '</li>'; }).join('') + '</ul>'
      + '<p class="hint">Set an override on a stall in Stall Management. Blank means the platform default.</p></div></div>';

    $('#feesForm').addEventListener('submit', async function (event) {
      event.preventDefault();
      var form = event.currentTarget;
      var button = $('#saveFees');
      U.clearFieldErrors(form); U.clearFormError(form);
      var commission = Number(field(form, 'commissionPct').value);
      if (!Number.isFinite(commission) || commission < 0 || commission > 30) {
        U.showFieldError(field(form, 'commissionPct'), 'Enter a commission between 0 and 30 percent.');
        return;
      }
      var shippingText = field(form, 'shippingFee').value.trim();
      var thresholdText = field(form, 'freeShippingThreshold').value.trim();
      var shipping = U.toCents(shippingText);
      var threshold = U.toCents(thresholdText);
      if (shipping === null) { U.showFieldError(field(form, 'shippingFee'), 'Enter a valid shipping fee such as 49.00.'); return; }
      if (threshold === null) { U.showFieldError(field(form, 'freeShippingThreshold'), 'Enter a valid threshold such as 2000.00.'); return; }
      if (threshold < shipping) { U.showFieldError(field(form, 'freeShippingThreshold'), 'The free-shipping threshold must be at least the shipping fee.'); return; }
      var ok = await U.confirmDialog({
        title: 'Save commission and fee settings?',
        message: 'New rates will apply to orders placed after saving.',
        detail: '<p>Commission: <strong>' + U.esc(String(commission)) + '%</strong></p><p>Shipping: <strong>' + U.money(shipping) + '</strong></p><p>Free shipping from: <strong>' + U.money(threshold) + '</strong></p>',
        confirmLabel: 'Save rates'
      });
      if (!ok) return;
      U.setBusy(button, true, 'Saving…');
      try {
        var result = await A.put('/api/admin/fees', { commissionPct: commission, shippingFee: shippingText, freeShippingThreshold: thresholdText });
        U.toast(result.message, 'ok');
        await feesView(view, api);
      } catch (error) {
        U.applyApiError(form, error);
      } finally {
        U.setBusy(button, false);
      }
    });
  }

  /* -------------------------------- reviews ------------------------------ */

  async function reviewsView(view) {
    var status = 'flagged';
    view.innerHTML = viewHead('Review moderation', 'Reviews held by the automatic filter must be approved before they are visible to customers.', '<a class="btn secondary" href="#settings">' + U.icon('sliders') + 'Filter settings</a>')
      + '<div class="info-banner">' + U.icon('shield') + '<div><strong>Moderation is enforced on the server.</strong> Flagged reviews are stored but never published automatically. Approving publishes the review and notifies the stall owner; rejecting hides it permanently.</div></div>'
      + '<div class="stat-grid mt-2" id="reviewSummary"></div>'
      + '<div class="filter-tabs mt-2 mb-2" id="reviewTabs">'
      + '<button type="button" data-review-filter="flagged" class="on">Held by filter</button>'
      + '<button type="button" data-review-filter="published">Published</button>'
      + '<button type="button" data-review-filter="rejected">Rejected</button>'
      + '<button type="button" data-review-filter="all">All reviews</button>'
      + '</div>'
      + '<div id="reviewBody">' + U.loading('Loading reviews…') + '</div>';

    async function moderate(review, action) {
      var approve = action === 'approve';
      var ok = await U.confirmDialog({
        title: approve ? 'Publish this review?' : 'Reject this review?',
        message: approve
          ? 'The review from ' + review.customerName + ' will become visible on the storefront.'
          : 'The review from ' + review.customerName + ' will stay hidden from customers.',
        detail: review.flagReason ? '<p>Filter reason: ' + U.esc(review.flagReason) + '</p>' : '<p>Rating ' + review.rating + ' / 5 for ' + U.esc(review.productName) + '.</p>',
        confirmLabel: approve ? 'Approve & publish' : 'Reject review',
        danger: !approve
      });
      if (!ok) return;
      try {
        var result = await A.patch('/api/admin/reviews/' + review.id, { action: action });
        U.toast(result.message, 'ok');
        await load();
      } catch (error) {
        U.toast(error.message, 'er');
      }
    }

    async function load() {
      $('#reviewBody').innerHTML = U.loading('Loading reviews…');
      try {
        var payload = await A.get('/api/admin/reviews' + A.query({ status: status }));
        var counts = payload.counts;
        $('#reviewSummary').innerHTML = statCard('Held by filter', String(counts.flagged), 'Awaiting a moderation decision', 'shield', counts.flagged ? 'wa' : '')
          + statCard('Published', String(counts.published), 'Visible on the storefront', 'star', 'ok')
          + statCard('Rejected', String(counts.rejected), 'Hidden from customers', 'x', counts.rejected ? 'er' : '')
          + statCard('Total reviews', String(counts.flagged + counts.published + counts.rejected), 'Across all stalls', 'message');
        if (!payload.reviews.length) {
          $('#reviewBody').innerHTML = emptyCard('star', 'No reviews in this queue', 'Reviews appear here after customers review delivered orders.');
          return;
        }
        $('#reviewBody').innerHTML = '<div class="card">' + payload.reviews.map(function (review) {
          return '<div class="review-card"><div class="rc-head"><div class="rc-who">' + U.avatar(review.customerName, 'sm')
            + '<strong>' + U.esc(review.customerName) + '</strong><span class="muted small">' + U.esc(review.productName) + ' · ' + U.esc(review.stallName) + '</span></div>'
            + '<div class="rc-meta">' + U.stars(review.rating) + ' ' + U.statusBadge(review.status, review.status === 'flagged' ? 'Held by filter' : U.titleCase(review.status)) + '</div></div>'
            + '<div class="rc-meta">' + U.esc(review.localDateTime) + '</div>'
            + '<div class="rc-text">' + U.esc(review.comment) + '</div>'
            + (review.flagReason ? '<div class="notice wa mt-1">' + U.icon('shield') + ' ' + U.esc(review.flagReason) + '</div>' : '')
            + (review.ownerReply ? '<div class="review-reply"><strong>Owner reply</strong><p>' + U.esc(review.ownerReply) + '</p></div>' : '')
            + (review.status === 'flagged' ? '<div class="btn-row mt-2"><button type="button" class="btn ok sm" data-review-action="approve" data-review-id="' + review.id + '">' + U.icon('check') + 'Approve &amp; publish</button>'
              + '<button type="button" class="btn ghost sm" data-review-action="reject" data-review-id="' + review.id + '">' + U.icon('x') + 'Reject</button></div>' : '')
            + '</div>';
        }).join('') + '</div>';
        $$('[data-review-action]', view).forEach(function (button) {
          button.addEventListener('click', function () {
            var review = payload.reviews.find(function (entry) { return entry.id === Number(button.dataset.reviewId); });
            if (review) moderate(review, button.dataset.reviewAction);
          });
        });
      } catch (error) {
        $('#reviewBody').innerHTML = '<div class="table-card">' + U.errorBlock(error) + '</div>';
      }
    }

    $$('#reviewTabs [data-review-filter]').forEach(function (button) {
      button.addEventListener('click', function () {
        status = button.dataset.reviewFilter;
        $$('#reviewTabs [data-review-filter]').forEach(function (entry) { entry.classList.toggle('on', entry === button); });
        load();
      });
    });
    await load();
  }

  /* -------------------------------- feedback ----------------------------- */

  async function feedbackView(view) {
    var status = '';
    view.innerHTML = viewHead('Feedback management', 'Customer feedback submitted from the storefront. Respond by triaging each item; operators can also mark items reviewed or resolved.', '')
      + '<div class="filter-tabs mb-2" id="feedbackTabs">'
      + '<button type="button" data-feedback-filter="" class="on">All feedback</button>'
      + '<button type="button" data-feedback-filter="new">New</button>'
      + '<button type="button" data-feedback-filter="reviewed">Reviewed</button>'
      + '<button type="button" data-feedback-filter="resolved">Resolved</button>'
      + '</div>'
      + '<div class="stat-grid" id="feedbackSummary"></div>'
      + '<div id="feedbackBody" class="mt-2">' + U.loading('Loading feedback…') + '</div>';

    async function updateStatus(item, next) {
      if (next === 'resolved') {
        var ok = await U.confirmDialog({
          title: 'Mark feedback resolved?',
          message: '“' + item.subject + '” from ' + item.name + ' will be marked resolved.',
          detail: '<p>This changes the feedback status for both administrators and field operators.</p>',
          confirmLabel: 'Mark resolved'
        });
        if (!ok) return;
      }
      try {
        var result = await A.patch('/api/admin/feedback/' + item.id, { status: next });
        U.toast(result.message, 'ok');
        await load();
      } catch (error) {
        U.toast(error.message, 'er');
      }
    }

    async function load() {
      $('#feedbackBody').innerHTML = U.loading('Loading feedback…');
      try {
        var payload = await A.get('/api/admin/feedback' + A.query({ status: status }));
        var counts = payload.counts;
        $('#feedbackSummary').innerHTML = statCard('New', String(counts.new), 'Not yet triaged', 'message', counts.new ? 'wa' : '')
          + statCard('Reviewed', String(counts.reviewed), 'Acknowledged by staff', 'check-circle', 'info')
          + statCard('Resolved', String(counts.resolved), 'Closed out', 'check-circle', 'ok')
          + statCard('Total', String(counts.new + counts.reviewed + counts.resolved), 'All customer feedback', 'clipboard');
        if (!payload.feedback.length) {
          $('#feedbackBody').innerHTML = emptyCard('message', 'No feedback here', 'Customer feedback from the storefront will appear in this queue.');
          return;
        }
        $('#feedbackBody').innerHTML = payload.feedback.map(function (item) {
          return '<article class="feedback-card"><div class="fc-head"><div><div class="fc-subject">' + U.esc(item.subject) + ' ' + U.sampleBadge(item.isSample) + '</div>'
            + '<div class="fc-meta">' + U.esc(item.name) + ' · ' + U.esc(item.contact) + ' · ' + U.esc(item.localDateTime) + '</div></div>'
            + '<div>' + U.statusBadge(item.status) + '</div></div>'
            + '<div class="fc-text">' + U.esc(item.message) + '</div>'
            + '<div class="fc-actions">'
            + (item.status !== 'reviewed' && item.status !== 'resolved' ? '<button type="button" class="btn secondary sm" data-feedback-id="' + item.id + '" data-feedback-next="reviewed">' + U.icon('eye') + 'Mark reviewed</button>' : '')
            + (item.status !== 'resolved' ? '<button type="button" class="btn ok sm" data-feedback-id="' + item.id + '" data-feedback-next="resolved">' + U.icon('check') + 'Mark resolved</button>' : '')
            + (item.status === 'resolved' ? '<span class="muted small">This item is closed. Deleting feedback is not available in the interface.</span>' : '')
            + '</div></article>';
        }).join('');
        $$('[data-feedback-next]', view).forEach(function (button) {
          button.addEventListener('click', function () {
            var item = payload.feedback.find(function (entry) { return entry.id === Number(button.dataset.feedbackId); });
            if (item) updateStatus(item, button.dataset.feedbackNext);
          });
        });
      } catch (error) {
        $('#feedbackBody').innerHTML = '<div class="table-card">' + U.errorBlock(error) + '</div>';
      }
    }

    $$('#feedbackTabs [data-feedback-filter]').forEach(function (button) {
      button.addEventListener('click', function () {
        status = button.dataset.feedbackFilter;
        $$('#feedbackTabs [data-feedback-filter]').forEach(function (entry) { entry.classList.toggle('on', entry === button); });
        load();
      });
    });
    await load();
  }

  /* -------------------------------- archives ----------------------------- */

  async function archivesView(view) {
    var data = await A.get('/api/admin/archives');
    view.innerHTML = viewHead('Archives', 'Archived products, cancelled or refunded orders, and deactivated accounts retained for audit and history.', '')
      + '<div class="info-banner">' + U.icon('archive') + '<div><strong>Archived records stay in the audit trail.</strong> Archived listings never count as active products. Cancelled and refunded orders remain in reports with their final status. Stall owners restore their own archived products from the owner workspace.</div></div>'
      + '<div class="stat-grid mt-2">'
      + statCard('Archived products', String(data.products.length), 'Retained, not listed publicly', 'archive')
      + statCard('Cancelled or refunded orders', String(data.orders.length), 'Retained for reporting and audit', 'receipt')
      + statCard('Deactivated accounts', String(data.users.length), 'Sessions revoked', 'lock')
      + statCard('Sample records', String(data.orders.filter(function (order) { return order.isSample; }).length), 'Labelled Sample in order lists', 'info')
      + '</div>'
      + '<div class="section-title"><h3>Archived products</h3><span class="muted small">' + data.products.length + ' record(s)</span></div>'
      + (data.products.length ? '<div class="table-card"><div class="table-wrap"><table><thead><tr><th>Product</th><th>Stall</th><th class="num">Price</th><th class="num">Stock</th><th>Last updated</th></tr></thead><tbody>'
        + data.products.map(function (product) {
          return '<tr><td>' + '<div class="product-cell"><img src="' + U.attr(product.images && product.images[0] ? product.images[0] : '/shared/logo.svg') + '" alt="">'
            + '<div><div class="pc-name">' + U.esc(product.name) + '</div><div class="pc-sub">' + U.esc(product.sku || 'No SKU') + ' · ' + U.esc(product.category) + '</div></div></div></td>'
            + '<td>' + U.esc(product.stallName) + '</td><td class="num">' + U.money(product.priceCents) + '</td><td class="num">' + product.stock + '</td>'
            + '<td class="nowrap">' + U.dateTime(product.updatedAt) + '</td></tr>';
        }).join('') + '</tbody></table></div></div>' : emptyCard('archive', 'No archived products', 'Products archived by stall owners will appear here.'))
      + '<div class="section-title"><h3>Cancelled and refunded orders</h3><span class="muted small">' + data.orders.length + ' record(s)</span></div>'
      + (data.orders.length ? '<div class="table-card"><div class="table-wrap"><table><thead><tr><th>Order</th><th>Placed</th><th>Stall</th><th>Customer</th><th class="num">Total</th><th>Status</th></tr></thead><tbody>'
        + data.orders.map(function (order) {
          return '<tr><td><span class="mono">' + U.esc(order.code) + '</span>' + (order.isSample ? '<div>' + U.sampleBadge(true) + '</div>' : '') + '</td>'
            + '<td class="nowrap">' + U.esc(order.localDateTime) + '</td><td>' + U.esc(order.stallName) + '</td><td>' + U.esc(order.customerName) + '</td>'
            + '<td class="num">' + U.money(order.totalCents) + '</td><td>' + U.statusBadge(order.status) + '</td></tr>';
        }).join('') + '</tbody></table></div></div>' : emptyCard('receipt', 'No cancelled or refunded orders', 'Orders that are cancelled or refunded will be retained here.'))
      + '<div class="section-title"><h3>Deactivated accounts</h3><span class="muted small">' + data.users.length + ' record(s)</span></div>'
      + (data.users.length ? '<div class="table-card"><div class="table-wrap"><table><thead><tr><th>Person</th><th>Role</th><th>Stall</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>'
        + data.users.map(function (user) {
          return '<tr><td>' + personCell(user.name, user.email) + '</td><td>' + U.statusBadge(user.role, U.titleCase(user.role)) + '</td>'
            + '<td>' + (user.stallName ? U.esc(user.stallName) : '—') + '</td><td>' + U.statusBadge(user.status) + '</td><td class="nowrap">' + U.dateOnly(user.createdAt) + '</td>'
            + '<td><div class="table-actions"><a class="btn ghost sm" href="' + (user.role === 'owner' ? '#stall-owners' : '#users') + '">' + U.icon('external') + 'Manage</a></div></td></tr>';
        }).join('') + '</tbody></table></div></div>' : emptyCard('users', 'No deactivated accounts', 'Deactivated owners and staff remain listed here for audit.'))
      + '<div class="card mt-2"><div class="card-head"><h3>Archive policy</h3></div><ul class="small" style="padding-left:18px;color:var(--ink-soft)">'
      + data.notes.map(function (note) { return '<li style="margin-bottom:4px">' + U.esc(note) + '</li>'; }).join('')
      + '<li style="margin-bottom:4px">Archived data is still included in backups and can be restored only from a full backup.</li></ul></div>';
  }

  /* -------------------------------- backup ------------------------------- */

  var BACKUP_TABLES = ['stalls', 'settings', 'users', 'vouchers', 'products', 'orders', 'order_items', 'reviews', 'notifications', 'suppliers', 'feedback', 'tickets', 'visits', 'activity_logs'];

  async function backupView(view) {
    var parsed = null;
    view.innerHTML = viewHead('Backup and restore', 'Download a complete JSON backup or replace the database from a validated backup file.', '')
      + '<div class="info-banner">' + U.icon('shield') + '<div><strong>Handle backups as sensitive data.</strong> A backup contains customer order details and hashed passwords. Store it securely, never share it, and delete copies you no longer need. Raw passwords and reset codes are never included.</div></div>'
      + '<div class="backup-grid mt-2">'
      + '<div class="backup-card"><h3>Download full backup</h3><p>Exports all ' + BACKUP_TABLES.length + ' platform tables as one JSON file. No account is signed out.</p>'
      + '<div class="btn-row mt-2"><button type="button" class="btn primary" id="downloadBackup">' + U.icon('download') + 'Download backup</button></div>'
      + '<div class="stat-divider"></div><div class="token-list">' + BACKUP_TABLES.map(function (table) { return '<span class="token">' + U.esc(table) + '</span>'; }).join('') + '</div>'
      + '<p class="hint">The download is logged in the activity trail.</p></div>'
      + '<div class="backup-card danger-zone"><h3>Restore from backup</h3><p>Replaces every current record with the contents of a valid SkyWorld backup. All sessions are revoked immediately after a successful restore.</p>'
      + '<div class="field mt-2"><label for="backupFile">Backup file (.json)</label><input id="backupFile" type="file" accept="application/json,.json"><div class="err-text" data-file-error></div></div>'
      + '<div id="backupSummary" class="mt-2"><p class="muted small">Choose a backup file to inspect it before restoring.</p></div>'
      + '<div class="field mt-2"><label for="restoreConfirm">Type RESTORE to confirm</label><input id="restoreConfirm" type="text" autocomplete="off" spellcheck="false" placeholder="RESTORE"><div class="hint">This action cannot be undone unless you already have another backup.</div></div>'
      + '<div class="btn-row mt-2"><button type="button" class="btn danger" id="restoreBackup" disabled>' + U.icon('database') + 'Restore database</button></div></div>'
      + '</div>'
      + '<div class="card mt-2"><div class="card-head"><h3>Restore validation</h3></div><ul class="small" style="padding-left:18px;color:var(--ink-soft)">'
      + '<li style="margin-bottom:4px">The file must identify itself as a SkyWorld backup with a supported version.</li>'
      + '<li style="margin-bottom:4px">All ' + BACKUP_TABLES.length + ' tables must be present and within the size limit.</li>'
      + '<li style="margin-bottom:4px">At least one active administrator must exist in the backup, or the restore is aborted.</li>'
      + '<li style="margin-bottom:4px">Server-side validation repeats every check; editing the file in the browser cannot bypass it.</li>'
      + '</ul></div>';

    var fileInput = $('#backupFile');
    var restoreInput = $('#restoreConfirm');
    var restoreButton = $('#restoreBackup');
    var summary = $('#backupSummary');

    function syncButton() {
      restoreButton.disabled = !parsed || restoreInput.value.trim() !== 'RESTORE';
    }

    function resetFile(message) {
      parsed = null;
      summary.innerHTML = '<p class="muted small">' + U.esc(message || 'Choose a backup file to inspect it before restoring.') + '</p>';
      restoreInput.value = '';
      syncButton();
    }

    function validateBackup(backup) {
      if (!backup || typeof backup !== 'object' || backup.format !== 'skyworld-backup' || backup.version !== 1) {
        throw new Error('That file is not a supported SkyWorld backup (format or version mismatch).');
      }
      if (!backup.tables || typeof backup.tables !== 'object') throw new Error('The backup has no table data.');
      var missing = BACKUP_TABLES.filter(function (table) { return !Array.isArray(backup.tables[table]); });
      if (missing.length) throw new Error('The backup is missing these tables: ' + missing.join(', ') + '.');
      if (!backup.tables.users.some(function (user) { return user.role === 'admin'; })) {
        throw new Error('The backup does not contain an administrator account.');
      }
      return true;
    }

    $('#downloadBackup').addEventListener('click', async function () {
      var button = $('#downloadBackup');
      U.setBusy(button, true, 'Preparing backup…');
      try {
        var name = await A.download('/api/admin/backup', 'skyworld-backup.json');
        U.toast('Backup downloaded: ' + name, 'ok');
      } catch (error) {
        U.toast(error.message, 'er');
      } finally {
        U.setBusy(button, false);
      }
    });

    fileInput.addEventListener('change', async function () {
      var file = fileInput.files && fileInput.files[0];
      parsed = null;
      syncButton();
      if (!file) { resetFile(); return; }
      if (file.size > 20 * 1024 * 1024) {
        U.showFieldError(fileInput, 'Choose a backup file smaller than 20 MB.');
        resetFile('The selected file is too large.');
        return;
      }
      U.clearFieldErrors(fileInput);
      summary.innerHTML = '<p class="muted small"><span class="spinner"></span>Reading backup…</p>';
      try {
        var text = await file.text();
        var backup = JSON.parse(text);
        validateBackup(backup);
        parsed = backup;
        var counts = BACKUP_TABLES.map(function (table) { return backup.tables[table].length; });
        var totalRows = counts.reduce(function (sum, count) { return sum + count; }, 0);
        summary.innerHTML = '<div class="notice ok">' + U.icon('check-circle') + ' Backup validated in the browser. The server will validate it again.</div>'
          + '<div class="backup-summary"><span><strong>' + U.esc(backup.format) + ' v' + U.esc(String(backup.version)) + '</strong>Format</span>'
          + '<span><strong>' + (backup.generatedAt ? U.dateTime(backup.generatedAt) : 'Unknown') + '</strong>Generated</span>'
          + '<span><strong>' + BACKUP_TABLES.length + '</strong>Tables</span>'
          + '<span><strong>' + U.number(totalRows) + '</strong>Rows</span>'
          + '<span><strong>' + U.number(backup.tables.users.length) + '</strong>Users</span>'
          + '<span><strong>' + U.number(backup.tables.orders.length) + '</strong>Orders</span>'
          + '<span><strong>' + U.number(backup.tables.products.length) + '</strong>Products</span>'
          + '<span><strong>' + U.number(backup.tables.stalls.length) + '</strong>Stalls</span></div>';
        syncButton();
      } catch (error) {
        resetFile('This file cannot be restored: ' + error.message);
        summary.innerHTML = '<div class="notice er">' + U.icon('alert') + ' ' + U.esc(error.message) + '</div>';
      }
    });

    restoreInput.addEventListener('input', syncButton);

    restoreButton.addEventListener('click', async function () {
      if (!parsed) { U.toast('Choose a valid backup file first.', 'wa'); return; }
      if (restoreInput.value.trim() !== 'RESTORE') { U.toast('Type RESTORE to confirm.', 'wa'); return; }
      var ok = await U.confirmDialog({
        title: 'Replace the current database?',
        message: 'Every current record will be replaced by the selected backup. This cannot be undone from the interface.',
        detail: '<p>All sessions will be revoked, including yours. Everyone must sign in again after the restore.</p>'
          + '<p>The backup was generated ' + U.esc(parsed.generatedAt ? U.dateTime(parsed.generatedAt) : 'at an unknown time') + '.</p>',
        confirmLabel: 'Restore database',
        danger: true
      });
      if (!ok) return;
      var button = restoreButton;
      U.setBusy(button, true, 'Restoring…');
      try {
        var result = await A.post('/api/admin/restore', { confirm: 'RESTORE', backup: parsed });
        U.toast(result.message, 'ok');
        parsed = null;
        syncButton();
        setTimeout(function () { window.location.href = '/portal/'; }, 1600);
      } catch (error) {
        U.toast(error.message, 'er');
        U.setBusy(button, false);
      }
    });
  }

  /* -------------------------------- activity ----------------------------- */

  async function logsView(view) {
    var filters = { role: '', q: '', limit: 200 };
    view.innerHTML = viewHead('Activity logs', 'The platform audit trail records sign-ins, administrative changes, catalogue updates, order transitions, and security actions.', '')
      + '<div class="toolbar"><select id="logRole" aria-label="Filter by actor role"><option value="">All roles</option><option value="admin">Administrators</option><option value="operator">Operators</option><option value="owner">Stall owners</option><option value="system">System</option></select>'
      + '<div class="search-box">' + U.icon('search') + '<input type="search" id="logSearch" placeholder="Search action, details, person, or entity" aria-label="Search activity logs" maxlength="80"></div>'
      + '<select id="logLimit" aria-label="Number of entries"><option value="100">Latest 100</option><option value="200" selected>Latest 200</option><option value="300">Latest 300</option></select>'
      + '<span class="grow"></span><span class="muted small" id="logCount"></span></div>'
      + '<div id="logSummary" class="stat-grid"></div>'
      + '<div id="logBody" class="mt-2">' + U.loading('Loading activity…') + '</div>';

    async function load() {
      $('#logBody').innerHTML = U.loading('Loading activity…');
      try {
        var payload = await A.get('/api/admin/logs' + A.query(filters));
        var logs = payload.logs;
        var admins = logs.filter(function (log) { return log.actorRole === 'admin'; }).length;
        var operators = logs.filter(function (log) { return log.actorRole === 'operator'; }).length;
        var owners = logs.filter(function (log) { return log.actorRole === 'owner'; }).length;
        $('#logCount').textContent = logs.length + ' most recent entr' + (logs.length === 1 ? 'y' : 'ies');
        $('#logSummary').innerHTML = statCard('Entries shown', String(logs.length), 'Most recent first', 'activity')
          + statCard('Administrator actions', String(admins), 'Settings, accounts, and moderation', 'shield', 'accent')
          + statCard('Operator actions', String(operators), 'Field operations and tickets', 'clipboard')
          + statCard('Owner actions', String(owners), 'Catalogue and order management', 'store');
        if (!logs.length) {
          $('#logBody').innerHTML = emptyCard('activity', 'No activity matches', 'Try another role, limit, or search term.');
          return;
        }
        $('#logBody').innerHTML = '<div class="table-card"><div class="table-wrap"><table><thead><tr>'
          + '<th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Details</th><th>IP</th><th>Data</th>'
          + '</tr></thead><tbody>' + logs.map(function (log) {
            return '<tr><td class="nowrap">' + U.esc(log.localDateTime) + '</td>'
              + '<td>' + U.esc(log.actorName || 'System') + '<div>' + U.statusBadge(log.actorRole, U.titleCase(log.actorRole)) + '</div></td>'
              + '<td><span class="code-inline">' + U.esc(log.action) + '</span></td>'
              + '<td>' + U.esc(log.entityType || '—') + (log.entityId ? '<div class="muted small">' + U.esc(log.entityId) + '</div>' : '') + '</td>'
              + '<td class="small">' + U.esc(log.details || '—') + '</td>'
              + '<td class="nowrap muted small">' + U.esc(log.ip || '—') + '</td>'
              + '<td>' + (log.isSample ? U.sampleBadge(true) : '<span class="muted small">Live</span>') + '</td></tr>';
          }).join('') + '</tbody></table></div>'
          + '<div class="table-foot"><span>Activity logs are append-only and retained with the database.</span><span>' + logs.length + ' shown</span></div></div>';
      } catch (error) {
        $('#logBody').innerHTML = '<div class="table-card">' + U.errorBlock(error) + '</div>';
      }
    }

    $('#logRole').addEventListener('change', function (event) { filters.role = event.target.value; load(); });
    $('#logLimit').addEventListener('change', function (event) { filters.limit = Number(event.target.value); load(); });
    $('#logSearch').addEventListener('input', U.debounce(function (event) { filters.q = event.target.value.trim(); load(); }, 320));
    await load();
  }

  /* -------------------------------- security ----------------------------- */

  async function securityView(view) {
    var payload = await A.get('/api/admin/security');
    var groups = [];
    var groupMap = {};
    payload.sessions.forEach(function (session) {
      if (!groupMap[session.userId]) {
        groupMap[session.userId] = { userId: session.userId, name: session.name, email: session.email, role: session.role, sessions: [] };
        groups.push(groupMap[session.userId]);
      }
      groupMap[session.userId].sessions.push(session);
    });
    groups.forEach(function (group) {
      group.sessions.sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); });
      group.lastSeen = group.sessions[0].createdAt;
      group.latestIp = group.sessions[0].ip;
      group.latestAgent = group.sessions[0].userAgent;
    });
    groups.sort(function (a, b) { return b.lastSeen.localeCompare(a.lastSeen); });
    var policy = payload.passwordPolicy;
    var isSelf = function (userId) { return payload.currentUserId === userId; };

    function openSessionsModal(group) {
      var canRevoke = !isSelf(group.userId);
      U.openModal({
        title: 'Active sessions · ' + group.name,
        subtitle: group.email + ' · ' + U.titleCase(group.role),
        size: 'wide',
        content: '<div class="table-wrap"><table><thead><tr><th>Signed in</th><th>Expires</th><th>IP</th><th>Device / browser</th></tr></thead><tbody>'
          + group.sessions.map(function (session) {
            return '<tr><td class="nowrap">' + U.dateTime(session.createdAt) + '</td><td class="nowrap">' + U.dateTime(session.expiresAt) + '</td>'
              + '<td class="nowrap">' + U.esc(session.ip) + '</td><td class="small">' + U.esc(session.userAgent || 'Unknown') + '</td></tr>';
          }).join('') + '</tbody></table></div>'
          + '<div class="notice mt-2">' + U.icon('lock') + ' Session tokens are never displayed. Revoking ends every active session for this account.</div>',
        actions: canRevoke ? [
          {
            label: 'Revoke all sessions',
            className: 'danger',
            onClick: async function (modalApi) {
              var ok = await U.confirmDialog({
                title: 'Revoke all sessions?',
                message: group.name + ' will be signed out on every device.',
                detail: '<p>They can sign in again with their own password. No password or account data is changed.</p>',
                confirmLabel: 'Revoke sessions',
                danger: true
              });
              if (!ok) return false;
              try {
                var result = await A.post('/api/admin/security/revoke', { userId: group.userId });
                U.toast(result.message, 'ok');
                modalApi.close();
                await securityView(view);
              } catch (error) {
                U.toast(error.message, 'er');
                return false;
              }
            }
          },
          { label: 'Close', className: 'ghost' }
        ] : [{ label: 'Close', className: 'ghost' }]
      });
    }

    async function revoke(group) {
      var ok = await U.confirmDialog({
        title: 'Sign out this account everywhere?',
        message: group.name + ' has ' + group.sessions.length + ' active session(s). All will end immediately.',
        detail: '<p>They can sign in again with their own credentials. This does not change their password or role.</p>',
        confirmLabel: 'Revoke sessions',
        danger: true
      });
      if (!ok) return;
      try {
        var result = await A.post('/api/admin/security/revoke', { userId: group.userId });
        U.toast(result.message, 'ok');
        await securityView(view);
      } catch (error) {
        U.toast(error.message, 'er');
      }
    }

    view.innerHTML = viewHead('Security settings', 'Session oversight, password policy, recovery activity, and provider status. Passwords and reset codes are never exposed.', '')
      + '<div class="stat-grid">'
      + statCard('Active sessions', String(payload.sessions.length), groups.length + ' account(s) signed in', 'lock', 'info')
      + statCard('Reset requests · 24h', String(payload.resetRequestsLast24h), 'Recovery requests recorded', 'key', payload.resetRequestsLast24h ? 'wa' : '')
      + '</div>'
      + '<div class="grid-2 mt-2">'
      + '<div class="card"><div class="card-head"><h3>Password &amp; recovery policy</h3><span class="badge">Server-enforced</span></div>'
      + '<dl class="policy-list"><dt>Length</dt><dd>' + policy.minLength + '–' + policy.maxLength + ' characters</dd>'
      + '<dt>Character types</dt><dd>At least ' + policy.groupsRequired + ' of 4</dd>'
      + '<dt>Allowed characters</dt><dd>Letters, numbers, symbols</dd>'
      + '<dt>Hashing</dt><dd>' + U.esc(policy.hashing) + '</dd>'
      + '<dt>Reset code lifetime</dt><dd>' + policy.resetCodeTtlMinutes + ' minutes</dd>'
      + '<dt>Delivery</dt><dd>Registered email or verified phone only</dd></dl>'
      + '<div class="stat-divider"></div><ul class="small" style="padding-left:18px;color:var(--ink-soft)">'
      + payload.notes.map(function (note) { return '<li style="margin-bottom:4px">' + U.esc(note) + '</li>'; }).join('') + '</ul></div>'
      + '<div class="card"><div class="card-head"><h3>Security posture</h3></div>'
      + '<div class="dl"><dt>Password hashes exposed</dt><dd>Never</dd><dt>Impersonation available</dt><dd>No</dd>'
      + '<dt>Reset code lifetime</dt><dd>' + policy.resetCodeTtlMinutes + ' minutes</dd></div></div></div>'
      + '<div class="section-title"><h3>Active sessions</h3><span class="muted small">' + groups.length + ' account(s) · ' + payload.sessions.length + ' session(s)</span></div>'
      + (groups.length ? '<div class="table-card"><div class="table-wrap"><table><thead><tr>'
        + '<th>Account</th><th>Role</th><th class="num">Sessions</th><th>Most recent sign-in</th><th>Latest IP</th><th>Latest device</th><th></th>'
        + '</tr></thead><tbody>' + groups.map(function (group) {
          return '<tr><td>' + personCell(group.name, group.email) + (isSelf(group.userId) ? ' <span class="badge accent">You</span>' : '') + '</td>'
            + '<td>' + U.statusBadge(group.role, U.titleCase(group.role)) + '</td><td class="num">' + group.sessions.length + '</td>'
            + '<td class="nowrap">' + U.dateTime(group.lastSeen) + '</td><td class="nowrap">' + U.esc(group.latestIp) + '</td>'
            + '<td><div class="session-agent" title="' + U.attr(group.latestAgent) + '">' + U.esc(group.latestAgent || 'Unknown') + '</div></td>'
            + '<td><div class="table-actions"><button type="button" class="btn ghost sm" data-session-details="' + group.userId + '">' + U.icon('eye') + 'Details</button>'
            + (isSelf(group.userId) ? '<span class="muted small">Current</span>' : '<button type="button" class="btn ghost sm" data-session-revoke="' + group.userId + '">' + U.icon('log-out') + 'Sign out all</button>')
            + '</div></td></tr>';
        }).join('') + '</tbody></table></div>'
        + '<div class="table-foot"><span>You cannot revoke your own sessions here. Use Sign out in the top bar to end your own session.</span><span>Sessions expire automatically.</span></div></div>'
        : emptyCard('lock', 'No active sessions', 'Active sessions will appear here after staff sign in.'))
      + '<div class="card mt-2"><div class="card-head"><h3>Security operations</h3></div><div class="btn-row">'
      + '<a class="btn secondary" href="#logs">Review activity logs</a>'
            + '<a class="btn ghost" href="#users">Manage staff accounts</a></div>'
      + '<p class="hint">Administrators cannot view owner or staff passwords, impersonate any account, or create recovery codes from this workspace.</p></div>';

    $$('[data-session-details]', view).forEach(function (button) {
      button.addEventListener('click', function () {
        var group = groups.find(function (entry) { return entry.userId === Number(button.dataset.sessionDetails); });
        if (group) openSessionsModal(group);
      });
    });
    $$('[data-session-revoke]', view).forEach(function (button) {
      button.addEventListener('click', function () {
        var group = groups.find(function (entry) { return entry.userId === Number(button.dataset.sessionRevoke); });
        if (group) revoke(group);
      });
    });
  }

  /* ------------------------------- settings pages ------------------------ */

  function simpleSettingsView(title, bodyHtml) {
    return function (view) {
      view.innerHTML = viewHead(title, '', '')
        + '<div class="card"><div class="stack" style="gap:12px">' + bodyHtml + '</div></div>';
    };
  }

  var aboutView = simpleSettingsView('About',
    '<p><strong>SkyWorld Stall — Platform Administration</strong></p>'
    + '<p>This workspace is for market administrators. Use it to oversee stalls, owner accounts, staff roles, sales analytics, review moderation, feedback, and security.</p>'
    + '<p>Location: <strong>F. Calderon St. Baguio City, Benguet</strong></p>'
    + '<p>Eleven predefined stalls share one catalogue and order platform. Owner accounts are created from the registration portal; this desk does not reassign stalls or impersonate owners.</p>'
  );

  var termsView = simpleSettingsView('Terms and Conditions',
    '<p>By using the Platform Administration workspace you agree to:</p>'
    + '<ul style="padding-left:18px;margin:0">'
    + '<li style="margin-bottom:6px">Keep account credentials confidential and never share administrator access.</li>'
    + '<li style="margin-bottom:6px">Use stall, owner, and staff tools only for legitimate market operations.</li>'
    + '<li style="margin-bottom:6px">Treat customer and owner data as confidential; do not export or share it outside authorised use.</li>'
    + '<li style="margin-bottom:6px">Follow market house rules when changing operating status, moderation decisions, or account access.</li>'
    + '</ul>'
    + '<p>The platform may update these terms. Continued use of this workspace means you accept the latest terms.</p>'
  );

  var notificationsView = simpleSettingsView('Notifications',
    '<p>Platform alerts (held reviews, new feedback, security events) appear in the relevant modules of this dashboard.</p>'
    + '<ul style="padding-left:18px;margin:0">'
    + '<li style="margin-bottom:6px"><strong>Reviews</strong> — held items wait in Review Moderation until approved or rejected.</li>'
    + '<li style="margin-bottom:6px"><strong>Feedback</strong> — new customer messages are listed under Feedback Management.</li>'
    + '<li style="margin-bottom:6px"><strong>Security</strong> — session and recovery activity is visible under Security Settings.</li>'
    + '</ul>'
    + '<p>Update your name, email, or password under <strong>Account Settings</strong>. Email and SMS delivery depend on server configuration.</p>'
  );

  var reviewsSettingsView = simpleSettingsView('Reviews',
    '<p>Customer reviews are filtered automatically. Items that match moderation rules are held until an administrator publishes or rejects them.</p>'
    + '<ul style="padding-left:18px;margin:0">'
    + '<li style="margin-bottom:6px">Open <strong>Review Moderation</strong> to process the held queue.</li>'
    + '<li style="margin-bottom:6px">Published reviews appear on the public storefront and in the owner workspace.</li>'
    + '<li style="margin-bottom:6px">Rejected reviews are not shown to customers.</li>'
    + '</ul>'
    + '<p>Use fair and consistent standards when moderating. Owners may reply only to published reviews from their own stall workspace.</p>'
  );

  var auditTrailView = simpleSettingsView('Audit Trail',
    '<p>Important platform actions are written to the activity log: sign-ins, role changes, stall updates, moderation decisions, and security actions.</p>'
    + '<ul style="padding-left:18px;margin:0">'
    + '<li style="margin-bottom:6px">Open <strong>Activity Logs</strong> for the full searchable trail.</li>'
    + '<li style="margin-bottom:6px">Logs are append-only and retained with the database.</li>'
    + '<li style="margin-bottom:6px">Filter by role (admin, operator, owner) or search by action and person.</li>'
    + '</ul>'
    + '<p>Contact market leadership if you need a formal report extracted from the audit trail.</p>'
  );

  var helpSupportView = simpleSettingsView('Help & Support',
    '<p>Need help with platform administration?</p>'
    + '<ul style="padding-left:18px;margin:0">'
    + '<li style="margin-bottom:6px"><strong>Location:</strong> F. Calderon St. Baguio City, Benguet</li>'
    + '<li style="margin-bottom:6px"><strong>Stalls &amp; owners:</strong> use Stall Management and Stall Owner Management</li>'
    + '<li style="margin-bottom:6px"><strong>Staff access:</strong> use User &amp; Role Management</li>'
    + '<li style="margin-bottom:6px"><strong>Security:</strong> use Security Settings for sessions and recovery policy</li>'
    + '<li style="margin-bottom:6px"><strong>Field issues:</strong> operators handle day-to-day maintenance from the Operator portal</li>'
    + '</ul>'
    + '<p>For technical outages or database concerns, escalate to the system operator responsible for this installation.</p>'
  );

  /* --------------------------------- boot -------------------------------- */

  window.SkyDash.boot({
    role: 'admin',
    area: 'Platform Administration',
    areaIcon: 'shield',
    defaultView: 'overview',
    nav: [
      {
        label: 'Platform',
        items: [
          { id: 'overview', label: 'Overview', icon: 'grid', subtitle: 'Platform health at a glance' },
          { id: 'stall-owners', label: 'Stall Owner Management', icon: 'users', subtitle: 'Owner accounts and access' },
          { id: 'stalls', label: 'Stall Management', icon: 'store', subtitle: 'Stall settings and commission' },
          { id: 'users', label: 'User & Role Management', icon: 'shield', subtitle: 'Admin and operator accounts' }
        ]
      },
      {
        label: 'Insights',
        items: [
          { id: 'analytics', label: 'Platform Analytics', icon: 'chart', subtitle: 'Sales, products, and stalls' },
          { id: 'reports', label: 'Audit Logs', icon: 'clipboard', subtitle: 'Preview and export CSV' },
          { id: 'transactions', label: 'Transactions', icon: 'receipt', subtitle: 'Platform-wide order ledger' }
        ]
      },
      {
        label: 'Operations',
        items: [
          { id: 'reviews', label: 'Review Moderation', icon: 'star', subtitle: 'Held review queue' },
          { id: 'feedback', label: 'Feedback Management', icon: 'message', subtitle: 'Customer feedback' },
          { id: 'archives', label: 'Archives', icon: 'archive', subtitle: 'Retained records' },
          { id: 'logs', label: 'Activity Logs', icon: 'activity', subtitle: 'Audit trail' },
          { id: 'security', label: 'Security Settings', icon: 'lock', subtitle: 'Sessions and policy' }
        ]
      },
      {
        label: 'Settings',
        items: [
          { id: 'about', label: 'About', icon: 'info', subtitle: 'About this workspace' },
          { id: 'terms', label: 'Terms and Conditions', icon: 'clipboard', subtitle: 'Platform terms' }
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
      overview: overviewView,
      'stall-owners': ownersView,
      stalls: stallsView,
      users: usersView,
      analytics: analyticsView,
      reports: reportsView,
      transactions: transactionsView,
      reviews: reviewsView,
      feedback: feedbackView,
      archives: archivesView,
      logs: logsView,
      security: securityView,
      about: aboutView,
      terms: termsView,
      notifications: notificationsView,
      'reviews-settings': reviewsSettingsView,
      'audit-trail': auditTrailView,
      'help-support': helpSupportView,
      account: function (view) { return window.SkyDash.accountView(view); }
    }
  });
})();
