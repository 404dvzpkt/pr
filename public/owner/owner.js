(function () {
  'use strict';

  var U = window.SkyUI;
  var A = window.SkyApi;
  var C = window.SkyCharts;
  var $ = U.$;
  var $$ = U.$$;

  var CATEGORIES = ['Clothes', 'Shoes', 'Bags', 'Jackets', 'Accessories', 'Random'];
  var STATUS_FLOW = {
    pending: [['confirmed', 'Confirm order'], ['cancelled', 'Cancel order']],
    confirmed: [['shipped', 'Mark shipped'], ['cancelled', 'Cancel order']],
    shipped: [['delivered', 'Mark delivered'], ['cancelled', 'Cancel order']],
    delivered: [['refunded', 'Refund order']],
    cancelled: [],
    refunded: []
  };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var localDateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'
  });

  function field(form, name) { return form.elements.namedItem(name); }
  function localDateKey(iso) { return localDateFormatter.format(new Date(iso)); }
  function shiftDate(dateString, days) {
    var bits = dateString.split('-').map(Number);
    return new Date(Date.UTC(bits[0], bits[1] - 1, bits[2] + days)).toISOString().slice(0, 11);
  }
  function shortDate(dateString) {
    var bits = dateString.split('-');
    return MONTHS[Number(bits[1]) - 1] + ' ' + Number(bits[2]);
  }
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

  function productCell(product) {
    var image = product.images && product.images[0] ? product.images[0] : 'logo.png';
    return '<div class="product-cell"><img src="' + U.attr(image) + '" alt="">'
      + '<div><div class="pc-name">' + U.esc(product.name) + '</div>'
      + '<div class="pc-sub">' + U.esc(product.sku || 'SKU not set') + ' · ' + U.esc(product.category) + '</div></div></div>';
  }

  function priceText(product) {
    var finalCents = Math.round(product.priceCents * (100 - (product.discountPct || 0)) / 100);
    if (!product.discountPct) return U.money(product.priceCents);
    return U.money(finalCents) + ' <span class="muted small" style="text-decoration:line-through">' + U.money(product.priceCents) + '</span>';
  }

  function totalsBlock(order) {
    var rows = '<div class="tr"><span>Subtotal</span><span>' + U.money(order.subtotal_cents) + '</span></div>';
    if (order.product_discount_cents) rows += '<div class="tr"><span>Product discounts</span><span>' + negMoney(order.product_discount_cents) + '</span></div>';
    if (order.voucher_discount_cents) rows += '<div class="tr"><span>Voucher ' + U.esc(order.voucher_code || '') + '</span><span>' + negMoney(order.voucher_discount_cents) + '</span></div>';
    rows += '<div class="tr"><span>Shipping</span><span>' + U.money(order.shipping_cents) + '</span></div>';
    if (order.platform_fee_cents) rows += '<div class="tr"><span>Platform fee (remitted by the stall)</span><span>' + U.money(order.platform_fee_cents) + '</span></div>';
    rows += '<div class="tr grand"><span>Total charged to customer</span><span>' + U.money(order.total_cents) + '</span></div>';
    return '<div class="totals-block">' + rows + '</div>';
  }

  function orderItemsHtml(order) {
    return '<div class="owner-order-items">' + order.items.map(function (item) {
      var variant = [item.color, item.size ? 'Size ' + item.size : ''].filter(Boolean).join(' · ');
      return '<div class="owner-order-item"><img src="' + U.attr(item.image || '/shared/logo.svg') + '" alt="">'
        + '<div class="oi-main"><div class="oi-name">' + U.esc(item.name) + '</div>'
        + '<div class="oi-sub">' + U.esc(variant || 'Standard') + ' · Qty ' + item.qty + ' · ' + U.money(item.unitCents) + '</div></div>'
        + '<strong>' + U.money(item.lineTotalCents) + '</strong></div>';
    }).join('') + '</div>';
  }

  async function openOrderModal(orderId, after) {
    var data;
    try {
      data = await A.get('/api/owner/orders/' + orderId);
    } catch (error) {
      U.toast(error.message, 'er');
      return;
    }
    var order = data.order;
    var transitions = STATUS_FLOW[order.status] || [];
    var actions = transitions.map(function (entry) {
      var destructive = entry[0] === 'cancelled' || entry[0] === 'refunded';
      return {
        label: entry[1],
        className: destructive ? 'ghost' : 'primary',
        onClick: async function (modalApi) {
          var ok = await U.confirmDialog({
            title: entry[1] + '?',
            message: 'Order ' + order.code + ' will be marked ' + U.titleCase(entry[0]) + '.',
            detail: destructive
              ? '<p>Reserved stock is restored automatically and the order will no longer count as a completed sale.</p>'
              : entry[0] === 'delivered'
                ? '<p>The order will be counted as a completed sale in your sales history and reports.</p>'
                : '',
            confirmLabel: entry[1],
            danger: destructive
          });
          if (!ok) return false;
          try {
            var result = await A.post('/api/owner/orders/' + order.id + '/status', { status: entry[0] });
            U.toast(result.message, 'ok');
            modalApi.close();
            if (after) after();
          } catch (error) {
            U.toast(error.message, 'er');
            return false;
          }
        }
      };
    });
    actions.push({ label: 'Close', className: 'ghost' });
    U.openModal({
      title: 'Order ' + order.code,
      subtitle: U.dateTime(order.created_at) + ' · ' + (order.payment_method || 'Payment to arrange'),
      size: 'wide',
      content: '<div class="btn-row mb-2">' + U.statusBadge(order.status) + U.statusBadge(order.payment_status) + U.sampleBadge(order.is_sample)
        + '</div>'
        + U.orderTimeline(order.status)
        + '<div class="grid-2 even mt-2"><div><div class="form-section-title" style="margin-top:0">Customer</div>'
        + '<div class="dl"><dt>Name</dt><dd>' + U.esc(order.customer_name) + '</dd>'
        + '<dt>Email</dt><dd>' + U.esc(order.customer_email) + '</dd>'
        + '<dt>Phone</dt><dd>' + U.esc(order.customer_phone) + '</dd>'
        + '<dt>Delivery address</dt><dd>' + U.esc(order.address) + (order.city ? ', ' + U.esc(order.city) : '') + '</dd>'
        + (order.notes ? '<dt>Notes</dt><dd>' + U.esc(order.notes) + '</dd>' : '')
        + '</div></div><div><div class="form-section-title" style="margin-top:0">Payment</div>'
        + '<div class="dl"><dt>Method</dt><dd>' + U.esc(order.payment_method) + '</dd>'
        + '<dt>Payment status</dt><dd>' + U.titleCase(order.payment_status) + '</dd>'
        + '<dt>SMS update</dt><dd>' + (order.sms_status === 'not_configured' ? 'Not configured' : U.esc(U.titleCase(order.sms_status || 'Not sent'))) + '</dd>'
        + '<dt>Delivered at</dt><dd>' + (order.delivered_at ? U.dateTime(order.delivered_at) : 'Not yet delivered') + '</dd>'
        + '</div></div></div>'
        + '<div class="form-section-title">Items</div>' + orderItemsHtml(order) + totalsBlock(order),
      actions: actions
    });
  }

  /* ------------------------------ overview ------------------------------ */

  async function loadDailySeries() {
    var today = U.todayLocal();
    var from = shiftDate(today, -13);
    var payload = await A.get('/api/owner/sales' + A.query({ period: 'custom', from: from, to: today }));
    var byDate = {};
    payload.orders.forEach(function (order) {
      if (order.status !== 'delivered' && order.status !== 'refunded') return;
      var key = localDateKey(order.createdAt);
      if (!byDate[key]) byDate[key] = { value: 0, refund: 0 };
      if (order.status === 'delivered') byDate[key].value += order.totalCents;
      else byDate[key].refund += order.totalCents;
    });
    var points = [];
    for (var i = 0; i < 14; i += 1) {
      var date = shiftDate(from, i);
      var bucket = byDate[date] || { value: 0, refund: 0 };
      points.push({ date: shortDate(date), value: bucket.value, refund: bucket.refund });
    }
    return points;
  }

  async function overviewView(view, api) {
    var data = await A.get('/api/owner/overview');
    var series = [];
    try { series = await loadDailySeries(); } catch (_) { series = []; }
    var today = data.today;
    var month = data.month;
    var stall = data.stall;
    var firstName = (data.owner.name || 'there').split(' ')[0];
    var statusBadge = U.statusBadge(stall.operatingStatus, stall.operatingStatus === 'open' ? 'Open now' : U.titleCase(stall.operatingStatus));
    view.innerHTML = '<div class="view-head"><div><h2>Good to see you, ' + U.esc(firstName) + '</h2>'
      + '<p>' + U.esc(stall.name) + ' · ' + U.esc(stall.category) + ' · ' + U.esc(data.timezone) + '</p></div>'
      + '<div class="btn-row"><a class="btn secondary" href="#orders">' + U.icon('receipt') + 'Open orders</a>'
      + '<a class="btn" href="#products">' + U.icon('plus') + 'Add product</a></div></div>'
      + (stall.operatingStatus !== 'open'
        ? '<div class="info-banner">' + U.icon('alert') + '<div><strong>Your stall is ' + U.esc(U.titleCase(stall.operatingStatus)) + '.</strong> Customers can still browse, but checkout is paused. Change this in Online Store Management.</div></div>'
        : '')
      + '<div class="stat-grid">'
      + statCard('Completed today', U.money(today.completedSalesCents), today.deliveredCount + ' delivered · ' + today.orderCount + ' orders', 'trend', 'ok')
      + statCard('Completed this month', U.money(month.completedSalesCents), 'Owner net ' + U.money(month.ownerNetCents) + ' after fees', 'chart')
      + statCard('Awaiting fulfilment', String(data.pending.count), U.money(data.pending.valueCents) + ' in open orders', 'receipt', 'wa')
      + statCard('Stock alerts', String(data.stock.outOfStock), data.stock.lowStock + ' low-stock products · ' + data.stock.active + ' active', 'box', data.stock.outOfStock ? 'er' : '')
      + '</div>'
      + '<div class="grid-2 even mt-2">'
      + '<div class="card overview-chart"><div class="card-head"><h3>Completed sales · last 14 days</h3><a href="#sales">Sales history</a></div>'
      + C.lineChart(series, { valueKey: 'value', refundKey: 'refund', valueLabel: 'Delivered', refundLabel: 'Refunded', format: U.money, title: 'Completed sales for the last fourteen days' })
      + '<p class="hint">Only delivered orders count as completed sales. Refunded orders are shown separately.</p></div>'
      + '<div class="card"><div class="card-head"><h3>Recent orders</h3><a href="#orders">View all</a></div>'
      + (data.recentOrders.length ? '<div class="list-simple">' + data.recentOrders.map(function (order) {
        return '<div class="list-row"><div class="lr-main"><div class="lr-title"><a href="#orders">' + U.esc(order.code) + '</a> ' + U.statusBadge(order.status) + ' ' + U.sampleBadge(order.isSample) + '</div>'
          + '<div class="lr-sub">' + U.esc(order.customerName) + ' · ' + order.quantity + ' item(s) · ' + U.esc(order.localDateTime) + '</div></div>'
          + '<div class="lr-value">' + U.money(order.totalCents) + '</div></div>';
      }).join('') + '</div>' : U.emptyState({ icon: 'receipt', title: 'No orders yet', text: 'New storefront orders will appear here.' }))
      + '</div></div>'
      + '<div class="grid-2 even mt-2">'
      + '<div class="card"><div class="card-head"><h3>Customer reviews</h3><a href="#reviews">Moderate & reply</a></div>'
      + '<div class="btn-row mb-2">' + U.stars(data.reviews.average) + '<span class="muted small">' + (data.reviews.average === null ? 'No rating yet' : data.reviews.average + ' average') + '</span>'
      + '<span class="badge wa">' + data.reviews.unanswered + ' awaiting reply</span>' + (data.reviews.held ? '<span class="badge">' + data.reviews.held + ' held by filter</span>' : '') + '</div>'
      + (data.reviews.recent.length ? data.reviews.recent.map(function (review) {
        return '<div class="review-card"><div class="rc-head"><div class="rc-who">' + U.avatar(review.customerName, 'sm') + '<strong>' + U.esc(review.customerName) + '</strong></div>'
          + '<div class="rc-meta">' + U.stars(review.rating) + '</div></div>'
          + '<div class="rc-meta">' + U.esc(review.productName) + ' · ' + U.esc(review.localDate) + '</div>'
          + '<div class="rc-text">' + U.esc(review.comment) + '</div></div>';
      }).join('') : U.emptyState({ icon: 'star', title: 'No reviews yet', text: 'Delivered customers can leave a review from the storefront.' }))
      + '</div>'
      + '<div class="card"><div class="card-head"><h3>Top products · last 30 days</h3></div>'
      + (data.topProducts.length ? C.barList(data.topProducts.map(function (item) { return { name: item.name, value: item.revenueCents, units: item.units }; }), { format: U.money })
        : '<div class="chart-empty">No delivered sales in the last 30 days.</div>')
      + '</div></div>'
      + '<div class="card mt-2"><div class="card-head"><h3>Quick actions</h3></div><div class="btn-row">'
      + '<a class="btn secondary" href="#inventory">Adjust stock</a>'
      + '<a class="btn secondary" href="#storefront">Manage store status</a>'
      + '<a class="btn secondary" href="#reports">Preview a report</a>'
      + '<a class="btn ghost" href="/store/#stall/' + stall.id + '" target="_blank" rel="noopener">' + U.icon('external') + 'View public stall page</a>'
      + '</div></div>';
  }

  /* ------------------------------- orders ------------------------------- */

  async function ordersView(view) {
    var filters = { status: '', q: '' };
    view.innerHTML = viewHead('Orders', 'Every order placed with your stall, newest first.', '<button class="btn secondary" type="button" id="ordersRefresh">' + U.icon('refresh') + 'Refresh</button>')
      + '<div id="orderTabs" class="filter-tabs mb-2"></div>'
      + '<div class="toolbar"><div class="search-box">' + U.icon('search') + '<input type="search" id="orderSearch" placeholder="Search code, customer, or email" aria-label="Search orders" maxlength="80"></div>'
      + '<span class="grow"></span><span class="muted small" id="orderCount"></span></div>'
      + '<div id="orderBody">' + U.loading('Loading orders…') + '</div>';

    function paintTabs(counts) {
      var total = Object.keys(counts).reduce(function (sum, key) { return sum + counts[key]; }, 0);
      var statuses = ['', 'pending', 'confirmed', 'shipped', 'delivered', 'cancelled', 'refunded'];
      $('#orderTabs').innerHTML = statuses.map(function (status) {
        var label = status ? U.titleCase(status) : 'All orders';
        var count = status ? (counts[status] || 0) : total;
        return '<button type="button" data-order-status="' + status + '" class="' + (filters.status === status ? 'on' : '') + '">' + label + '<span class="count">' + count + '</span></button>';
      }).join('');
      $$('#orderTabs [data-order-status]').forEach(function (button) {
        button.addEventListener('click', function () {
          filters.status = button.dataset.orderStatus;
          load();
        });
      });
    }

    function paintRows(orders) {
      $('#orderCount').textContent = orders.length + ' order(s) shown';
      if (!orders.length) {
        $('#orderBody').innerHTML = '<div class="table-card">' + U.emptyState({ icon: 'receipt', title: 'No matching orders', text: 'Try a different status or search term.' }) + '</div>';
        return;
      }
      var table = '<div class="table-card"><div class="table-wrap"><table><thead><tr>'
        + '<th>Order</th><th>Customer</th><th>First item</th><th class="num">Qty</th><th class="num">Total</th><th>Payment</th><th>Status</th><th>Placed</th><th></th>'
        + '</tr></thead><tbody>' + orders.map(function (order) {
          return '<tr><td><span class="mono">' + U.esc(order.code) + '</span>' + (order.isSample ? '<div>' + U.sampleBadge(true) + '</div>' : '') + '</td>'
            + '<td><div class="cell-title">' + U.esc(order.customerName) + '</div></td>'
            + '<td><div class="cell-title">' + U.esc(order.firstItem || '—') + '</div><div class="cell-sub">' + U.esc(order.paymentMethod) + '</div></td>'
            + '<td class="num">' + order.quantity + '</td><td class="num">' + U.money(order.totalCents) + '</td>'
            + '<td>' + U.statusBadge(order.paymentStatus) + '</td><td>' + U.statusBadge(order.status) + '</td>'
            + '<td class="nowrap">' + U.esc(order.localDateTime) + '</td>'
            + '<td><button type="button" class="btn ghost sm" data-view-order="' + order.id + '">View</button></td></tr>';
        }).join('') + '</tbody></table></div></div>';
      $('#orderBody').innerHTML = table;
      $$('[data-view-order]').forEach(function (button) {
        button.addEventListener('click', function () { openOrderModal(Number(button.dataset.viewOrder), load); });
      });
    }

    async function load() {
      try {
        var payload = await A.get('/api/owner/orders' + A.query({ status: filters.status, q: filters.q, limit: 200 }));
        paintTabs(payload.counts || {});
        paintRows(payload.orders);
      } catch (error) {
        $('#orderBody').innerHTML = '<div class="table-card">' + U.errorBlock(error) + '</div>';
      }
    }

    var search = $('#orderSearch');
    search.value = filters.q;
    search.addEventListener('input', U.debounce(function () { filters.q = search.value.trim(); load(); }, 320));
    $('#ordersRefresh').addEventListener('click', load);
    await load();
  }

  /* ------------------------------ inventory ----------------------------- */

  async function adjustStockModal(product, after) {
    var modal = U.openModal({
      title: 'Adjust stock',
      subtitle: product.name,
      size: 'narrow',
      content: '<p class="muted small">Stock is checked again when a customer checks out. Updating stock here never changes existing orders.</p>'
        + '<div class="field"><label for="stockValue">Units available</label><input id="stockValue" type="number" min="0" max="100000" step="1" value="' + product.stock + '">'
        + '<div class="hint">Current stock: ' + product.stock + ' units.</div><div class="err-text" data-field-error></div></div>',
      actions: [
        {
          label: 'Save stock',
          className: 'primary',
          onClick: async function (api) {
            var input = $('#stockValue', modal.body);
            var stock = Number(input.value);
            if (!Number.isInteger(stock) || stock < 0 || stock > 100000) {
              U.showFieldError(input, 'Stock must be a whole number between 0 and 100,000.');
              return false;
            }
            try {
              var result = await A.post('/api/owner/products/' + product.id + '/stock', { stock: stock });
              U.toast(result.message, 'ok');
              api.close();
              if (after) after();
            } catch (error) {
              U.applyApiError(modal.body, error);
              return false;
            }
          }
        },
        { label: 'Cancel', className: 'ghost' }
      ]
    });
    return modal;
  }

  async function inventoryView(view) {
    var filters = { q: '', level: '' };
    view.innerHTML = viewHead('Inventory', 'Stock levels across your active catalogue.', '<a class="btn secondary" href="#products">' + U.icon('package') + 'Product management</a>')
      + '<div id="inventoryStats" class="stat-grid"></div>'
      + '<div class="toolbar mt-2"><div class="search-box">' + U.icon('search') + '<input type="search" id="inventorySearch" placeholder="Search product or SKU" aria-label="Search inventory" maxlength="80"></div>'
      + '<div class="filter-tabs" id="inventoryTabs">'
      + '<button type="button" data-level="" class="on">All</button><button type="button" data-level="low">Low stock</button><button type="button" data-level="out">Out of stock</button>'
      + '</div><span class="grow"></span><button class="btn ghost sm" type="button" id="inventoryRefresh">' + U.icon('refresh') + 'Refresh</button></div>'
      + '<div id="inventoryBody">' + U.loading('Loading inventory…') + '</div>';

    var all = [];

    function paint() {
      var active = all.filter(function (product) { return !product.archived; });
      var out = active.filter(function (product) { return product.stock === 0; });
      var low = active.filter(function (product) { return product.stock > 0 && product.stock <= 10; });
      var units = active.reduce(function (sum, product) { return sum + product.stock; }, 0);
      $('#inventoryStats').innerHTML = statCard('Active products', String(active.length), active.length ? 'In your public catalogue' : 'Add your first product', 'package')
        + statCard('Units on hand', U.number(units), 'Across every active product', 'box')
        + statCard('Low stock', String(low.length), '10 units or fewer', 'alert', low.length ? 'wa' : 'ok')
        + statCard('Out of stock', String(out.length), out.length ? 'Hidden from buying until restocked' : 'Everything is stocked', 'alert-circle', out.length ? 'er' : 'ok');
      var query = filters.q.toLowerCase();
      var rows = active.filter(function (product) {
        if (filters.level === 'low' && !(product.stock > 0 && product.stock <= 10)) return false;
        if (filters.level === 'out' && product.stock !== 0) return false;
        if (!query) return true;
        return (product.name + ' ' + (product.sku || '') + ' ' + product.category).toLowerCase().includes(query);
      });
      if (!rows.length) {
        $('#inventoryBody').innerHTML = '<div class="table-card">' + U.emptyState({ icon: 'box', title: 'No matching products', text: 'Adjust the filters or add a product to your catalogue.' }) + '</div>';
        return;
      }
      $('#inventoryBody').innerHTML = '<div class="table-card"><div class="table-wrap"><table><thead><tr>'
        + '<th>Product</th><th>Category</th><th class="num">Price</th><th class="num">Stock</th><th>Variants</th><th>Status</th><th></th>'
        + '</tr></thead><tbody>' + rows.map(function (product) {
          var tone = product.stock === 0 ? 'er' : product.stock <= 10 ? 'wa' : 'ok';
          var label = product.stock === 0 ? 'Out of stock' : product.stock <= 10 ? 'Low stock' : 'In stock';
          return '<tr class="' + (product.stock === 0 ? 'row-warn' : '') + '"><td>' + productCell(product) + '</td>'
            + '<td>' + U.esc(product.category) + '</td><td class="num">' + priceText(product) + '</td>'
            + '<td class="num"><strong>' + U.number(product.stock) + '</strong></td>'
            + '<td><span class="muted small">' + product.colors.length + ' colour(s) · ' + product.sizes.length + ' size(s)</span></td>'
            + '<td><span class="badge ' + tone + '">' + label + '</span></td>'
            + '<td><button type="button" class="btn ghost sm" data-adjust="' + product.id + '">Adjust</button></td></tr>';
        }).join('') + '</tbody></table></div></div>';
      $$('[data-adjust]').forEach(function (button) {
        button.addEventListener('click', function () {
          var product = all.find(function (entry) { return entry.id === Number(button.dataset.adjust); });
          if (product) adjustStockModal(product, load);
        });
      });
    }

    async function load() {
      try {
        var payload = await A.get('/api/owner/products');
        all = payload.products;
        paint();
      } catch (error) {
        $('#inventoryBody').innerHTML = '<div class="table-card">' + U.errorBlock(error) + '</div>';
      }
    }

    var search = $('#inventorySearch');
    search.addEventListener('input', U.debounce(function () { filters.q = search.value.trim(); paint(); }, 200));
    $$('#inventoryTabs [data-level]').forEach(function (button) {
      button.addEventListener('click', function () {
        filters.level = button.dataset.level;
        $$('#inventoryTabs [data-level]').forEach(function (entry) { entry.classList.toggle('on', entry === button); });
        paint();
      });
    });
    $('#inventoryRefresh').addEventListener('click', load);
    await load();
  }

  /* ------------------------------- products ----------------------------- */

  function uploadTile(kind, label, multiple) {
    return '<label class="upload-tile" title="' + U.attr(label) + '"><input type="file" accept="image/jpeg,image/png,image/webp" data-upload="' + kind + '"' + (multiple ? ' multiple' : '') + '>'
      + U.icon('upload') + '<span>' + U.esc(label) + '</span></label>';
  }

  async function uploadInto(file, tile) {
    if (!file) return null;
    if (tile) tile.classList.add('busy');
    try {
      var result = await A.upload(file);
      return result.url;
    } catch (error) {
      U.toast(error.message, 'er');
      return null;
    } finally {
      if (tile) tile.classList.remove('busy');
    }
  }

  function openProductModal(product, after) {
    var editing = Boolean(product);
    var draft = {
      images: product ? product.images.slice() : [],
      colors: product ? product.colors.map(function (color) { return { name: color.name, hex: color.hex || '#B79A76', image: color.image || '' }; }) : [],
      sizes: product ? product.sizes.slice() : []
    };
    var content = '<form id="productForm" novalidate>'
      + '<div class="form-grid">'
      + '<div class="field span-2"><label for="pName">Product name</label><input id="pName" name="name" type="text" maxlength="100" value="' + (product ? U.attr(product.name) : '') + '" placeholder="Linen overshirt"><div class="err-text" data-field-error></div></div>'
      + '<div class="field"><label for="pCategory">Category</label><select id="pCategory" name="category">'
      + CATEGORIES.map(function (category) {
        return '<option value="' + U.attr(category) + '"' + (product && product.category === category ? ' selected' : '') + '>' + U.esc(category) + '</option>';
      }).join('') + '</select><div class="err-text" data-field-error></div></div>'
      + '<div class="field"><label for="pSku">SKU <span class="muted">(optional)</span></label><input id="pSku" name="sku" type="text" maxlength="40" value="' + (product ? U.attr(product.sku) : '') + '"><div class="err-text" data-field-error></div></div>'
      + '<div class="field"><label for="pPrice">Price (₱)</label><input id="pPrice" name="price" type="text" inputmode="decimal" value="' + (product ? U.attr(U.fromCents(product.priceCents)) : '') + '" placeholder="149.50"><div class="err-text" data-field-error></div></div>'
      + '<div class="field"><label for="pDiscount">Discount % <span class="muted">(0–90)</span></label><input id="pDiscount" name="discountPct" type="number" min="0" max="90" step="1" value="' + (product ? product.discountPct : 0) + '"><div class="err-text" data-field-error></div></div>'
      + '<div class="field"><label for="pStock">Stock</label><input id="pStock" name="stock" type="number" min="0" max="100000" step="1" value="' + (product ? product.stock : 0) + '"><div class="err-text" data-field-error></div></div>'
      + '<div class="field" style="align-self:end"><label class="checkline" style="margin-top:0"><input type="checkbox" name="featured"' + (product && product.featured ? ' checked' : '') + '> Feature on the storefront</label></div>'
      + '<div class="field span-2"><label for="pDescription">Description</label><textarea id="pDescription" name="description" maxlength="2000" placeholder="Fabric, fit, and care notes.">' + (product ? U.esc(product.description) : '') + '</textarea><div class="err-text" data-field-error></div></div>'
      + '<div class="form-section-title">Product images</div>'
      + '<div class="field span-2"><div class="media-grid" data-images></div><div class="err-text" data-image-error></div>'
      + '<div class="hint">JPEG, PNG, or WebP up to 5 MB each. The first image is the catalogue cover, and colour images can use any of these uploads.</div></div>'
      + '<div class="form-section-title">Colours</div>'
      + '<div class="field span-2"><div data-colors></div><div class="hint">Each colour is saved with its own image and appears as a swatch on the product page.</div></div>'
      + '<div class="form-section-title">Sizes</div>'
      + '<div class="field span-2"><div class="chip-input" data-size-chips></div>'
      + '<div class="input-group mt-1" style="max-width:300px"><input type="text" data-size-input maxlength="20" placeholder="e.g. S, M, L or 38" aria-label="Add a size"><button type="button" class="btn ghost" data-add-size>Add</button></div>'
      + '<div class="hint">Leave sizes empty for one-size products.</div></div>'
      + '</div></form>';

    var modal = U.openModal({
      title: editing ? 'Edit product' : 'Add product',
      subtitle: editing ? product.name : 'Create a product for your public catalogue.',
      size: 'wide',
      content: content,
      actions: [
        {
          label: editing ? 'Save product' : 'Add product',
          className: 'primary',
          close: false,
          onClick: async function (api) {
            var form = $('#productForm', modal.body);
            U.clearFieldErrors(form);
            var nameInput = field(form, 'name');
            var name = nameInput.value.trim();
            if (name.length < 2) { U.showFieldError(nameInput, 'Enter a product name.'); return false; }
            var priceInput = field(form, 'price');
            var priceCents = U.toCents(priceInput.value);
            if (priceCents === null || priceCents < 1) { U.showFieldError(priceInput, 'Enter a valid price such as 149.50.'); return false; }
            var discount = Number(field(form, 'discountPct').value || 0);
            if (!Number.isInteger(discount) || discount < 0 || discount > 90) { U.showFieldError(field(form, 'discountPct'), 'Use a whole number from 0 to 90.'); return false; }
            var stock = Number(field(form, 'stock').value || 0);
            if (!Number.isInteger(stock) || stock < 0 || stock > 100000) { U.showFieldError(field(form, 'stock'), 'Use a whole number from 0 to 100,000.'); return false; }
            if (!draft.images.length) {
              $('#productForm [data-image-error]', modal.body).textContent = 'Upload at least one product image before saving.';
              return false;
            }
            if (draft.colors.length > 8) { U.toast('Add at most 8 colours.', 'wa'); return false; }
            var seen = {};
            for (var i = 0; i < draft.colors.length; i += 1) {
              var color = draft.colors[i];
              color.name = color.name.trim();
              if (!color.name) { U.toast('Every colour needs a name.', 'wa'); return false; }
              var key = color.name.toLowerCase();
              if (seen[key]) { U.toast('The colour “' + color.name + '” appears twice.', 'wa'); return false; }
              seen[key] = true;
              if (!color.image || draft.images.indexOf(color.image) === -1) color.image = draft.images[0];
            }
            var payload = {
              name: name,
              description: field(form, 'description').value.trim(),
              category: field(form, 'category').value,
              priceCents: priceCents,
              discountPct: discount,
              stock: stock,
              colors: draft.colors,
              sizes: draft.sizes,
              images: draft.images,
              sku: field(form, 'sku').value.trim(),
              featured: field(form, 'featured').checked
            };
            try {
              var result = editing
                ? await A.put('/api/owner/products/' + product.id, payload)
                : await A.post('/api/owner/products', payload);
              U.toast(result.message, 'ok');
              api.close();
              if (after) after();
            } catch (error) {
              if (error.field) U.applyApiError(form, error);
              else api.showError(error.message);
              return false;
            }
          }
        },
        { label: 'Cancel', className: 'ghost' }
      ]
    });

    var form = $('#productForm', modal.body);
    var imagesBox = $('[data-images]', form);
    var colorsBox = $('[data-colors]', form);
    var sizesBox = $('[data-size-chips]', form);
    var sizeInput = $('[data-size-input]', form);

    function paintImages() {
      imagesBox.innerHTML = draft.images.map(function (url, index) {
        return '<div class="image-tile"><img src="' + U.attr(url) + '" alt="Product image ' + (index + 1) + '">'
          + '<button type="button" class="tile-x" data-remove-image="' + index + '" aria-label="Remove image ' + (index + 1) + '">' + U.icon('x') + '</button></div>';
      }).join('') + (draft.images.length < 8 ? uploadTile('images', draft.images.length ? 'Add image' : 'Upload cover') : '');
      var input = $('[data-upload="images"]', imagesBox);
      if (input) input.addEventListener('change', async function () {
        var file = input.files && input.files[0];
        var url = await uploadInto(file, input.closest('.upload-tile'));
        if (url) {
          if (draft.images.indexOf(url) === -1) draft.images.push(url);
          if (draft.images.length === 1) draft.colors.forEach(function (color) { if (!color.image) color.image = url; });
          paintImages();
          paintColors();
        }
      });
      imagesBox.querySelectorAll('[data-remove-image]').forEach(function (button) {
        button.addEventListener('click', function () {
          var removed = draft.images.splice(Number(button.dataset.removeImage), 1)[0];
          draft.colors.forEach(function (color) { if (color.image === removed) color.image = draft.images[0] || ''; });
          paintImages();
          paintColors();
        });
      });
    }

    function paintColors() {
      colorsBox.innerHTML = '<div class="color-editor">' + draft.colors.map(function (color, index) {
        var options = draft.images.map(function (url, imageIndex) {
          return '<option value="' + U.attr(url) + '"' + (color.image === url ? ' selected' : '') + '>Image ' + (imageIndex + 1) + '</option>';
        }).join('');
        return '<div class="color-row"><input type="color" data-color-hex="' + index + '" value="' + U.attr(color.hex) + '" aria-label="Colour ' + (index + 1) + ' swatch">'
          + '<input type="text" data-color-name="' + index + '" value="' + U.attr(color.name) + '" maxlength="40" placeholder="Colour name" aria-label="Colour ' + (index + 1) + ' name">'
          + '<select data-color-image="' + index + '" aria-label="Colour ' + (index + 1) + ' image">' + (options || '<option value="">Upload an image first</option>') + '</select>'
          + '<button type="button" class="icon-btn" data-remove-color="' + index + '" aria-label="Remove colour ' + (index + 1) + '">' + U.icon('x') + '</button></div>';
      }).join('') + '</div>'
        + '<button type="button" class="btn ghost sm mt-1" data-add-color' + (draft.colors.length >= 8 ? ' disabled' : '') + '>' + U.icon('plus') + 'Add colour</button>';
      colorsBox.querySelectorAll('[data-color-name]').forEach(function (input) {
        input.addEventListener('input', function () { draft.colors[Number(input.dataset.colorName)].name = input.value; });
      });
      colorsBox.querySelectorAll('[data-color-hex]').forEach(function (input) {
        input.addEventListener('input', function () { draft.colors[Number(input.dataset.colorHex)].hex = input.value; });
      });
      colorsBox.querySelectorAll('[data-color-image]').forEach(function (select) {
        select.addEventListener('change', function () { draft.colors[Number(select.dataset.colorImage)].image = select.value; });
      });
      colorsBox.querySelectorAll('[data-remove-color]').forEach(function (button) {
        button.addEventListener('click', function () { draft.colors.splice(Number(button.dataset.removeColor), 1); paintColors(); });
      });
      var add = $('[data-add-color]', colorsBox);
      add.addEventListener('click', function () {
        if (draft.colors.length >= 8) return;
        draft.colors.push({ name: '', hex: '#B79A76', image: draft.images[0] || '' });
        paintColors();
      });
    }

    function paintSizes() {
      sizesBox.innerHTML = draft.sizes.map(function (size, index) {
        return '<span class="size-chip">' + U.esc(size) + '<button type="button" data-remove-size="' + index + '" aria-label="Remove size ' + U.attr(size) + '">' + U.icon('x', 'sm') + '</button></span>';
      }).join('');
      sizesBox.querySelectorAll('[data-remove-size]').forEach(function (button) {
        button.addEventListener('click', function () { draft.sizes.splice(Number(button.dataset.removeSize), 1); paintSizes(); });
      });
    }

    function addSize() {
      var value = sizeInput.value.trim();
      if (!value) return;
      if (value.length > 20) { U.toast('Keep each size to 20 characters.', 'wa'); return; }
      if (draft.sizes.length >= 12) { U.toast('Add at most 12 sizes.', 'wa'); return; }
      if (draft.sizes.indexOf(value) === -1) draft.sizes.push(value);
      sizeInput.value = '';
      paintSizes();
    }

    $('[data-add-size]', form).addEventListener('click', addSize);
    sizeInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); addSize(); }
    });
    paintImages();
    paintColors();
    paintSizes();
  }

  async function productsView(view) {
    var state = { tab: 'active', q: '' };
    view.innerHTML = viewHead('Product management', 'Full control over names, prices, variants, images, and your public listing.',
      '<button class="btn" type="button" id="addProduct">' + U.icon('plus') + 'Add product</button>')
      + '<div class="toolbar"><div class="search-box">' + U.icon('search') + '<input type="search" id="productSearch" placeholder="Search name, SKU, or category" aria-label="Search products" maxlength="80"></div>'
      + '<div class="filter-tabs" id="productTabs">'
      + '<button type="button" data-product-tab="active" class="on">Active</button>'
      + '<button type="button" data-product-tab="archived">Archived</button>'
      + '<button type="button" data-product-tab="all">All</button>'
      + '</div><span class="grow"></span><span class="muted small" id="productCount"></span></div>'
      + '<div id="productBody">' + U.loading('Loading catalogue…') + '</div>';

    var all = [];

    function paint() {
      var query = state.q.toLowerCase();
      var rows = all.filter(function (product) {
        if (state.tab === 'active' && product.archived) return false;
        if (state.tab === 'archived' && !product.archived) return false;
        if (!query) return true;
        return (product.name + ' ' + (product.sku || '') + ' ' + product.category).toLowerCase().includes(query);
      });
      $('#productCount').textContent = rows.length + ' product(s)';
      if (!rows.length) {
        $('#productBody').innerHTML = '<div class="table-card">' + U.emptyState({
          icon: 'package',
          title: state.tab === 'archived' ? 'No archived products' : 'No products found',
          text: state.tab === 'archived' ? 'Archived products are kept for order history and can be restored here.' : 'Adjust your search or add a product to your catalogue.',
          action: '<button type="button" class="btn secondary" data-empty-add>' + U.icon('plus') + 'Add product</button>'
        }) + '</div>';
      } else {
        $('#productBody').innerHTML = '<div class="table-card"><div class="table-wrap"><table><thead><tr>'
          + '<th>Product</th><th>Category</th><th class="num">Price</th><th class="num">Stock</th><th>Variants</th><th>Flags</th><th></th></tr></thead><tbody>'
          + rows.map(function (product) {
            return '<tr><td>' + productCell(product) + '</td><td>' + U.esc(product.category) + '</td>'
              + '<td class="num">' + priceText(product) + '</td>'
              + '<td class="num"><strong>' + U.number(product.stock) + '</strong>' + (product.stock === 0 ? '<div class="muted small">out</div>' : '') + '</td>'
              + '<td><span class="muted small">' + product.colors.length + ' colours · ' + product.sizes.length + ' sizes · ' + product.images.length + ' photos</span></td>'
              + '<td><div class="tag-row">' + (product.featured ? '<span class="badge accent">Featured</span>' : '') + (product.archived ? '<span class="badge">Archived</span>' : '') + (product.discountPct ? '<span class="badge wa">' + product.discountPct + '% off</span>' : '') + '</div></td>'
              + '<td><div class="table-actions">'
              + '<button type="button" class="btn ghost sm" data-edit-product="' + product.id + '">' + U.icon('edit') + 'Edit</button>'
              + (product.archived
                ? '<button type="button" class="icon-btn" data-restore-product="' + product.id + '" aria-label="Restore ' + U.attr(product.name) + '" title="Restore">' + U.icon('restore') + '</button>'
                : '<button type="button" class="icon-btn" data-archive-product="' + product.id + '" aria-label="Archive ' + U.attr(product.name) + '" title="Archive">' + U.icon('archive') + '</button>')
              + '</div></td></tr>';
          }).join('') + '</tbody></table></div></div>';
      }
      var emptyAdd = $('[data-empty-add]');
      if (emptyAdd) emptyAdd.addEventListener('click', function () { openProductModal(null, load); });
      $$('[data-edit-product]').forEach(function (button) {
        button.addEventListener('click', function () {
          var product = all.find(function (entry) { return entry.id === Number(button.dataset.editProduct); });
          if (product) openProductModal(product, load);
        });
      });
      $$('[data-archive-product]').forEach(function (button) {
        button.addEventListener('click', async function () {
          var product = all.find(function (entry) { return entry.id === Number(button.dataset.archiveProduct); });
          if (!product) return;
          var ok = await U.confirmDialog({
            title: 'Archive product?',
            message: product.name + ' will disappear from your public storefront.',
            detail: '<p>Past orders keep their product names and prices. You can restore it from Archives at any time.</p>',
            confirmLabel: 'Archive product',
            danger: true
          });
          if (!ok) return;
          try {
            var result = await A.post('/api/owner/products/' + product.id + '/archive', {});
            U.toast(result.message, 'ok');
            load();
          } catch (error) { U.toast(error.message, 'er'); }
        });
      });
      $$('[data-restore-product]').forEach(function (button) {
        button.addEventListener('click', async function () {
          var product = all.find(function (entry) { return entry.id === Number(button.dataset.restoreProduct); });
          if (!product) return;
          try {
            var result = await A.post('/api/owner/products/' + product.id + '/restore', {});
            U.toast(result.message, 'ok');
            load();
          } catch (error) { U.toast(error.message, 'er'); }
        });
      });
    }

    async function load() {
      try {
        var payload = await A.get('/api/owner/products?includeArchived=1');
        all = payload.products;
        paint();
      } catch (error) {
        $('#productBody').innerHTML = '<div class="table-card">' + U.errorBlock(error) + '</div>';
      }
    }

    var search = $('#productSearch');
    search.addEventListener('input', U.debounce(function () { state.q = search.value.trim(); paint(); }, 200));
    $$('#productTabs [data-product-tab]').forEach(function (button) {
      button.addEventListener('click', function () {
        state.tab = button.dataset.productTab;
        $$('#productTabs [data-product-tab]').forEach(function (entry) { entry.classList.toggle('on', entry === button); });
        paint();
      });
    });
    $('#addProduct').addEventListener('click', function () { openProductModal(null, load); });
    await load();
  }

  /* -------------------------- online storefront ------------------------- */

  async function storefrontView(view, api) {
    var results = await Promise.all([
      A.get('/api/owner/stall'),
      A.get('/api/owner/products')
    ]);
    var stall = results[0].stall;
    var products = results[1].products;
    var status = stall.operatingStatus;
    var previewLink = '/store/#stall/' + stall.id;
    view.innerHTML = viewHead('Online store management', 'How customers see your stall on the SkyWorld storefront.',
      '<a class="btn secondary" href="/store/#stall/' + stall.id + '" target="_blank" rel="noopener">' + U.icon('external') + 'View storefront</a>')
      + '<div class="grid-2 even">'
      + '<div class="card"><div class="card-head"><h3>Public preview</h3>' + U.statusBadge(status, status === 'open' ? 'Open now' : U.titleCase(status)) + '</div>'
      + '<div class="store-preview"><div class="sp-cover">' + (stall.coverImage ? '<img src="' + U.attr(stall.coverImage) + '" alt="">' : '') + '</div>'
      + '<div class="sp-body">' + (stall.profileImage ? '<img class="sp-profile" src="' + U.attr(stall.profileImage) + '" alt="">' : '<span class="avatar md sp-profile">' + U.esc(stall.name.charAt(0)) + '</span>')
      + '<div class="sp-name">' + U.esc(stall.name) + '</div>'
      + '<div class="sp-sub">' + U.esc(stall.category) + ' · ' + U.esc(stall.location) + '</div>'
      + '<p class="sp-desc">' + U.esc(stall.description || 'No description yet.') + '</p>'
      + '<div class="btn-row mt-1"><span class="chip plain">' + products.length + ' products</span><span class="chip plain">' + stall.gallery.length + ' gallery photos</span>'
      + '<a class="btn ghost sm" href="' + previewLink + '" target="_blank" rel="noopener">Open page</a></div>'
      + '</div></div></div>'
      + '<div class="stack-gap">'
      + '<div class="card"><div class="card-head"><h3>Store status</h3></div>'
      + '<p class="small">Owners can set their stall to <strong>Open</strong> or <strong>Closed</strong>. Maintenance and Inactive are set by platform operators.</p>'
      + '<div class="status-choice mt-1" id="storeStatusChoice">'
      + '<label><input type="radio" name="storeStatus" value="open"' + (status === 'open' ? ' checked' : '') + '> Open for orders</label>'
      + '<label><input type="radio" name="storeStatus" value="closed"' + (status === 'closed' ? ' checked' : '') + '> Closed</label>'
      + '</div>'
      + ((status === 'under_maintenance' || status === 'inactive')
        ? '<div class="notice wa mt-2">This stall is currently <strong>' + U.esc(U.titleCase(status)) + '</strong>. Only platform staff can change that status. Contact support through the operator desk.</div>'
        : '')
      + '<div class="form-actions"><button type="button" class="btn" id="saveStoreStatus">' + U.icon('check') + 'Save store status</button></div></div>'
      + '</div></div>'
      + '<div class="grid-2 even mt-2">'
      + '<div class="card"><div class="card-head"><h3>Featured products</h3><span class="muted small">Shown on the storefront home</span></div>'
      + (products.length ? '<div class="featured-list">' + products.slice(0, 40).map(function (product) {
        return '<label class="featured-row"><input type="checkbox" data-feature="' + product.id + '"' + (product.featured ? ' checked' : '') + ' style="width:auto;accent-color:var(--accent)">'
          + '<img src="' + U.attr(product.images[0] || '/shared/logo.svg') + '" alt=""><span class="fr-main"><span class="fr-name">' + U.esc(product.name) + '</span>'
          + '<span class="fr-sub">' + U.esc(product.category) + ' · ' + U.money(product.priceCents) + ' · ' + product.stock + ' in stock</span></span></label>';
      }).join('') + '</div>' : U.emptyState({ icon: 'package', title: 'No products yet', text: 'Add products before selecting featured picks.', action: '<a class="btn secondary" href="#products">Add a product</a>' }))
      + '</div>'
      + '<div class="card"><div class="card-head"><h3>Gallery</h3><a href="#stall">Edit stall profile</a></div>'
      + (stall.gallery.length ? '<div class="media-grid">' + stall.gallery.map(function (url) {
        return '<div class="image-tile"><img src="' + U.attr(url) + '" alt="Stall gallery photo"></div>';
      }).join('') + '</div>' : U.emptyState({ icon: 'image', title: 'No gallery photos', text: 'Add photos so customers can see the stall before visiting.' }))
      + '</div></div>';

    $$('[data-feature]').forEach(function (checkbox) {
      checkbox.addEventListener('change', async function () {
        var productId = Number(checkbox.dataset.feature);
        var wanted = checkbox.checked;
        checkbox.disabled = true;
        try {
          await A.put('/api/owner/products/' + productId, { featured: wanted });
          U.toast(wanted ? 'Product featured on the storefront.' : 'Product removed from featured picks.', 'ok');
        } catch (error) {
          checkbox.checked = !wanted;
          U.toast(error.message, 'er');
        } finally {
          checkbox.disabled = false;
        }
      });
    });

    $('#saveStoreStatus').addEventListener('click', async function () {
      var selected = view.querySelector('input[name="storeStatus"]:checked');
      if (!selected) { U.toast('Choose Open or Closed.', 'wa'); return; }
      var wanted = selected.value;
      if (wanted === status) { U.toast('Your stall is already ' + wanted + '.', 'wa'); return; }
      if (wanted === 'closed') {
        var ok = await U.confirmDialog({
          title: 'Close your stall?',
          message: 'Customers will see your stall as closed and checkout will be paused.',
          detail: '<p>Your products, orders, and reports are unaffected. You can reopen at any time.</p>',
          confirmLabel: 'Close stall',
          danger: true
        });
        if (!ok) return;
      }
      try {
        var result = await A.put('/api/owner/stall', { operatingStatus: wanted });
        U.toast(result.message, 'ok');
        api.reload();
      } catch (error) { U.toast(error.message, 'er'); }
    });
  }

  /* ----------------------------- stall profile -------------------------- */

  async function stallProfileView(view, api) {
    var data = await A.get('/api/owner/stall');
    var stall = data.stall;
    var media = { cover: stall.coverImage, profile: stall.profileImage, gallery: stall.gallery.slice() };
    var lease = stall.lease || {};
    var platformRate = data.platformCommissionPct === undefined || data.platformCommissionPct === null ? 5 : data.platformCommissionPct;
    view.innerHTML = viewHead('Stall profile', 'Your public identity on the SkyWorld storefront.',
      '<a class="btn ghost" href="/store/#stall/' + stall.id + '" target="_blank" rel="noopener">' + U.icon('external') + 'Public page</a>')
      + '<div class="grid-2 even"><form class="form-card" id="stallForm" novalidate>'
      + '<div class="card-head"><h3>Stall details</h3>' + U.statusBadge(stall.operatingStatus) + '</div>'
      + '<div class="form-grid">'
      + '<div class="field span-2"><label for="stName">Stall name</label><input id="stName" name="name" type="text" maxlength="80" value="' + U.attr(stall.name) + '" required><div class="err-text" data-field-error></div></div>'
      + '<div class="field span-2"><label for="stDescription">Description</label><textarea id="stDescription" name="description" maxlength="600" placeholder="What makes your stall worth a visit?">' + U.esc(stall.description) + '</textarea><div class="hint">Up to 600 characters.</div><div class="err-text" data-field-error></div></div>'
      + '<div class="field"><label for="stLocation">Location inside the market</label><input id="stLocation" name="location" type="text" maxlength="120" value="' + U.attr(stall.location) + '"><div class="err-text" data-field-error></div></div>'
      + '<div class="field"><label for="stStatus">Operating status</label><select id="stStatus" name="operatingStatus">'
      + ['open', 'closed'].map(function (value) { return '<option value="' + value + '"' + (stall.operatingStatus === value ? ' selected' : '') + '>' + U.titleCase(value) + '</option>'; }).join('')
      + (stall.operatingStatus === 'under_maintenance' || stall.operatingStatus === 'inactive' ? '<option value="' + U.attr(stall.operatingStatus) + '" selected>' + U.titleCase(stall.operatingStatus) + ' (set by staff)</option>' : '')
      + '</select><div class="hint">Owners control Open and Closed only.</div><div class="err-text" data-field-error></div></div>'
      + '<div class="field"><label for="stPhone">Contact phone</label><input id="stPhone" name="contactPhone" type="tel" maxlength="20" value="' + U.attr(stall.contactPhone) + '"><div class="err-text" data-field-error></div></div>'
      + '<div class="field"><label for="stEmail">Contact email</label><input id="stEmail" name="contactEmail" type="email" maxlength="120" value="' + U.attr(stall.contactEmail) + '"><div class="err-text" data-field-error></div></div>'
      + '</div>'
      + '<div class="form-section-title">Cover, profile, and gallery</div>'
      + '<div class="field span-2"><label>Cover image <span class="muted">(required)</span></label><div class="media-grid" data-cover></div><div class="err-text" data-cover-error></div></div>'
      + '<div class="field span-2"><label>Profile image</label><div class="media-grid" data-profile></div></div>'
      + '<div class="field span-2"><label>Gallery <span class="muted">(up to 8 photos)</span></label><div class="media-grid" data-gallery></div></div>'
      + '<div class="form-actions"><button class="btn primary" type="submit" id="saveStall">' + U.icon('check') + 'Save stall profile</button>'
      + '<a class="btn ghost" href="#storefront">Store settings</a></div>'
      + '<div class="form-note">Images are validated by type and size on the server before they are saved.</div>'
      + '</form>'
      + '<div class="stack-gap"><form class="card" id="leaseForm" novalidate><div class="card-head"><h3>Lease & commission</h3>' + U.sampleBadge(Boolean(lease.isSample), 'Sample lease') + '</div>'
      + '<div class="form-grid">'
      + '<div class="field"><label for="leaseStart">Lease start</label><input id="leaseStart" name="leaseStart" type="date" value="' + U.attr(lease.start || '') + '"><div class="err-text" data-field-error></div></div>'
      + '<div class="field"><label for="leaseEnd">Lease end</label><input id="leaseEnd" name="leaseEnd" type="date" value="' + U.attr(lease.end || '') + '"><div class="err-text" data-field-error></div></div>'
      + '<div class="field"><label for="leaseRent">Monthly rent (₱)</label><input id="leaseRent" name="leaseRent" type="text" inputmode="decimal" value="' + (lease.rentCents === null || lease.rentCents === undefined ? '' : U.attr(U.fromCents(lease.rentCents))) + '" placeholder="18000.00"><div class="err-text" data-field-error></div></div>'
      + '<div class="field"><label for="leaseArea">Floor area (sqm)</label><input id="leaseArea" name="leaseAreaSqm" type="number" min="0" max="1000" step="0.01" value="' + U.attr(lease.areaSqm || '') + '" placeholder="12.5"><div class="err-text" data-field-error></div></div>'
      + '<div class="field span-2"><label for="leaseCommission">Commission (%)</label><input id="leaseCommission" name="commissionPct" type="number" min="0" max="30" step="1" value="' + (stall.commissionPct === null || stall.commissionPct === undefined ? '' : U.attr(stall.commissionPct)) + '" placeholder="Platform rate (' + U.attr(platformRate) + '%)"><div class="hint">Leave blank to use the platform rate of ' + U.esc(String(platformRate)) + '%. Commission applies to delivered sales, excluding shipping.</div><div class="err-text" data-field-error></div></div>'
      + '<div class="field span-2"><label for="leaseNote">Lease notes</label><input id="leaseNote" name="leaseNote" type="text" maxlength="300" value="' + U.attr(lease.note || '') + '" placeholder="For example: renewal due, corner unit"><div class="err-text" data-field-error></div></div>'
      + '</div>'
      + '<div class="form-actions"><button class="btn secondary" type="submit" id="saveLease">' + U.icon('check') + 'Save lease & commission</button></div>'
      + '<p class="hint">Every change is recorded in your activity log.</p></form>'
      + '<div class="card"><div class="card-head"><h3>Public contact</h3></div>'
      + '<p class="small">Customers see the phone and email you publish here on your stall page and order updates.</p>'
      + '<div class="dl"><dt>Phone</dt><dd>' + U.esc(stall.contactPhone || 'Not set') + '</dd><dt>Email</dt><dd>' + U.esc(stall.contactEmail || 'Not set') + '</dd></div></div>'
      + '<div class="card"><div class="card-head"><h3>Stall identity</h3></div>'
      + '<div class="dl"><dt>Stall number</dt><dd>#' + stall.id + '</dd><dt>Category</dt><dd>' + U.esc(stall.category) + '</dd>'
      + '<dt>Occupancy</dt><dd>' + U.titleCase(stall.occupancy) + '</dd><dt>Opened</dt><dd>' + U.dateOnly(stall.createdAt) + '</dd></div></div>'
      + '</div></div>';

    function paintMedia() {
      $('[data-cover]', view).innerHTML = (media.cover ? '<div class="image-tile"><img src="' + U.attr(media.cover) + '" alt="Current cover"></div>' : '')
        + uploadTile('cover', media.cover ? 'Replace cover' : 'Upload cover');
      $('[data-profile]', view).innerHTML = (media.profile ? '<div class="image-tile"><img src="' + U.attr(media.profile) + '" alt="Current profile"></div>' : '')
        + uploadTile('profile', media.profile ? 'Replace profile' : 'Upload profile');
      $('[data-gallery]', view).innerHTML = media.gallery.map(function (url, index) {
        return '<div class="image-tile"><img src="' + U.attr(url) + '" alt="Gallery photo ' + (index + 1) + '">'
          + '<button type="button" class="tile-x" data-remove-gallery="' + index + '" aria-label="Remove gallery photo ' + (index + 1) + '">' + U.icon('x') + '</button></div>';
      }).join('') + (media.gallery.length < 8 ? uploadTile('gallery', 'Add photo') : '');
      $$('input[data-upload]', view).forEach(function (input) {
        input.addEventListener('change', async function () {
          var file = input.files && input.files[0];
          var url = await uploadInto(file, input.closest('.upload-tile'));
          if (!url) return;
          if (input.dataset.upload === 'cover') media.cover = url;
          else if (input.dataset.upload === 'profile') media.profile = url;
          else if (media.gallery.indexOf(url) === -1) media.gallery.push(url);
          paintMedia();
        });
      });
      $$('[data-remove-gallery]', view).forEach(function (button) {
        button.addEventListener('click', function () {
          media.gallery.splice(Number(button.dataset.removeGallery), 1);
          paintMedia();
        });
      });
    }
    paintMedia();

    $('#leaseForm', view).addEventListener('submit', async function (event) {
      event.preventDefault();
      var form = event.currentTarget;
      var button = $('#saveLease', view);
      U.clearFieldErrors(form);
      var start = field(form, 'leaseStart').value;
      var end = field(form, 'leaseEnd').value;
      var rentText = field(form, 'leaseRent').value.trim();
      var areaText = field(form, 'leaseAreaSqm').value.trim();
      var commissionText = field(form, 'commissionPct').value.trim();
      if (start && end && end < start) {
        U.showFieldError(field(form, 'leaseEnd'), 'The end date must be on or after the start date.');
        return;
      }
      var rentCents = null;
      if (rentText !== '') {
        rentCents = U.toCents(rentText);
        if (rentCents === null) { U.showFieldError(field(form, 'leaseRent'), 'Enter a valid rent such as 18000.00, or leave it blank.'); return; }
        if (rentCents > 100000000) { U.showFieldError(field(form, 'leaseRent'), 'Monthly rent must be ₱1,000,000.00 or less.'); return; }
      }
      if (areaText !== '') {
        var area = Number(areaText);
        if (!Number.isFinite(area) || area <= 0 || area > 1000) {
          U.showFieldError(field(form, 'leaseAreaSqm'), 'Enter a floor area between 0 and 1,000 sqm.');
          return;
        }
      }
      var commission = null;
      if (commissionText !== '') {
        commission = Number(commissionText);
        if (!Number.isInteger(commission) || commission < 0 || commission > 30) {
          U.showFieldError(field(form, 'commissionPct'), 'Enter a whole number between 0 and 30, or leave it blank.');
          return;
        }
      }
      var ok = await U.confirmDialog({
        title: 'Save lease and commission?',
        message: 'These terms are visible to you and platform staff only.',
        detail: '<p>Monthly rent: <strong>' + (rentCents === null ? 'Not set' : U.money(rentCents)) + '</strong></p>'
          + '<p>Commission: <strong>' + (commission === null ? 'Platform rate (' + U.esc(String(platformRate)) + '%)' : commission + '%') + '</strong></p>',
        confirmLabel: 'Save terms'
      });
      if (!ok) return;
      U.setBusy(button, true, 'Saving…');
      try {
        var result = await A.put('/api/owner/stall', {
          commissionPct: commission === null ? null : commission,
          leaseStart: start,
          leaseEnd: end,
          leaseRent: rentCents === null ? '' : rentText,
          leaseAreaSqm: areaText,
          leaseNote: field(form, 'leaseNote').value.trim()
        });
        U.toast(result.message, 'ok');
        api.reload();
      } catch (error) {
        U.applyApiError(form, error);
      } finally {
        U.setBusy(button, false);
      }
    });

    $('#stallForm').addEventListener('submit', async function (event) {
      event.preventDefault();
      var form = event.currentTarget;
      var button = $('#saveStall');
      U.clearFieldErrors(form);
      var name = field(form, 'name').value.trim();
      if (name.length < 2) { U.showFieldError(field(form, 'name'), 'Enter a stall name.'); return; }
      if (!media.cover) { $('[data-cover-error]', view).textContent = 'Upload a cover image before saving.'; return; }
      var nextStatus = field(form, 'operatingStatus').value;
      if (nextStatus !== stall.operatingStatus && nextStatus === 'closed') {
        var ok = await U.confirmDialog({
          title: 'Close your stall?',
          message: 'Customers will not be able to check out while your stall is closed.',
          confirmLabel: 'Close stall',
          danger: true
        });
        if (!ok) return;
      }
      U.setBusy(button, true, 'Saving…');
      try {
        var result = await A.put('/api/owner/stall', {
          name: name,
          description: field(form, 'description').value.trim(),
          location: field(form, 'location').value.trim(),
          contactPhone: field(form, 'contactPhone').value.trim(),
          contactEmail: field(form, 'contactEmail').value.trim(),
          operatingStatus: nextStatus,
          coverImage: media.cover,
          profileImage: media.profile || '',
          gallery: media.gallery
        });
        U.toast(result.message, 'ok');
        api.reload();
      } catch (error) {
        U.applyApiError(form, error);
      } finally {
        U.setBusy(button, false);
      }
    });
  }

  /* ------------------------------ sales history ------------------------- */

  async function salesView(view) {
    var filters = { status: '', q: '' };
    var range = newRangeState();
    view.innerHTML = viewHead('Sales history', 'Delivered sales, refunds, discounts, and fees for any period.',
      '<a class="btn secondary" href="#reports">' + U.icon('chart') + 'Report preview</a>')
      + '<div data-range></div>'
      + '<div class="toolbar"><select id="salesStatus" aria-label="Filter by order status">'
      + '<option value="">All statuses</option>'
      + ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled', 'refunded'].map(function (status) { return '<option value="' + status + '">' + U.titleCase(status) + '</option>'; }).join('')
      + '</select><div class="search-box">' + U.icon('search') + '<input type="search" id="salesSearch" placeholder="Search order or customer" aria-label="Search sales" maxlength="80"></div>'
      + '<span class="grow"></span><span class="muted small" id="salesRangeLabel"></span></div>'
      + '<div id="salesBody">' + U.loading('Loading sales…') + '</div>';

    function paintTotals(totals) {
      return statCard('Completed sales', U.money(totals.completedSalesCents), totals.deliveredCount + ' delivered order(s)', 'trend', 'ok')
        + statCard('Refunds', U.money(totals.refundsCents), totals.refundedCount + ' refunded order(s)', 'refresh', totals.refundsCents ? 'er' : '')
        + statCard('Net sales', U.money(totals.netSalesCents), U.money(totals.discountsCents) + ' discounts given', 'peso')
        + statCard('Owner net', U.money(totals.ownerNetCents), 'After ' + U.money(totals.platformFeesCents) + ' platform fees', 'chart');
    }

    async function load() {
      $('#salesBody').innerHTML = U.loading('Loading sales…');
      try {
        var query = Object.assign({ status: filters.status, q: filters.q }, rangeParams(range));
        var payload = await A.get('/api/owner/sales' + A.query(query));
        $('#salesRangeLabel').textContent = payload.range.startLocal + ' → ' + payload.range.endLocal;
        if (!payload.orders.length) {
          $('#salesBody').innerHTML = '<div class="stat-grid">' + paintTotals(payload.totals) + '</div>'
            + '<div class="table-card mt-2">' + U.emptyState({ icon: 'chart', title: 'No orders in this period', text: 'Try another period or clear the status filter. Only delivered orders count as completed sales.' }) + '</div>';
          return;
        }
        $('#salesBody').innerHTML = '<div class="stat-grid">' + paintTotals(payload.totals) + '</div>'
          + '<div class="table-card mt-2"><div class="table-wrap"><table><thead><tr>'
          + '<th>Order</th><th>Placed</th><th>Customer</th><th class="num">Qty</th><th class="num">Discount</th><th class="num">Shipping</th><th class="num">Total</th><th>Status</th><th></th>'
          + '</tr></thead><tbody>' + payload.orders.map(function (order) {
            return '<tr><td><span class="mono">' + U.esc(order.code) + '</span>' + (order.isSample ? '<div>' + U.sampleBadge(true) + '</div>' : '') + '</td>'
              + '<td class="nowrap">' + U.esc(order.localDateTime) + '</td><td>' + U.esc(order.customerName) + '</td>'
              + '<td class="num">' + order.quantity + '</td>'
              + '<td class="num">' + (order.discountCents ? negMoney(order.discountCents) : '—') + '</td>'
              + '<td class="num">' + U.money(order.shippingCents) + '</td><td class="num"><strong>' + U.money(order.totalCents) + '</strong></td>'
              + '<td>' + U.statusBadge(order.status) + '</td>'
              + '<td><button type="button" class="btn ghost sm" data-sale-order="' + order.id + '">View</button></td></tr>';
          }).join('') + '</tbody></table></div>'
          + '<div class="table-foot">' + (payload.capped ? 'Showing the latest ' + payload.maxRows + ' orders. Narrow the period for a complete list.' : payload.orders.length + ' order(s) · ' + payload.range.label) + '</div></div>';
        $$('[data-sale-order]').forEach(function (button) {
          button.addEventListener('click', function () { openOrderModal(Number(button.dataset.saleOrder), load); });
        });
      } catch (error) {
        $('#salesBody').innerHTML = '<div class="table-card">' + U.errorBlock(error) + '</div>';
      }
    }

    bindRange($('[data-range]', view), range, function () { load(); });
    var search = $('#salesSearch');
    search.addEventListener('input', U.debounce(function () { filters.q = search.value.trim(); load(); }, 320));
    $('#salesStatus').addEventListener('change', function (event) { filters.status = event.target.value; load(); });
    await load();
  }

  /* -------------------------------- reviews ----------------------------- */

  async function reviewsView(view) {
    var status = '';
    view.innerHTML = viewHead('Customer reviews', 'Only delivered customers can review. The platform filter holds suspicious text before publication.', '')
      + '<div id="reviewSummary" class="stat-grid"></div>'
      + '<div class="filter-tabs mt-2 mb-2" id="reviewTabs">'
      + '<button type="button" data-review-status="" class="on">Published & held</button>'
      + '<button type="button" data-review-status="published">Published</button>'
      + '<button type="button" data-review-status="flagged">Held by filter</button>'
      + '</div>'
      + '<div id="reviewBody">' + U.loading('Loading reviews…') + '</div>';

    async function load() {
      try {
        var payload = await A.get('/api/owner/reviews' + A.query({ status: status }));
        var summary = payload.summary;
        $('#reviewSummary').innerHTML = statCard('Published reviews', String(summary.total), 'Across all ratings', 'star')
          + statCard('Average rating', summary.average === null ? '—' : summary.average + ' / 5', 'From published reviews', 'trend', 'ok')
          + statCard('Awaiting reply', String(summary.unanswered), 'Reply to build customer trust', 'message', summary.unanswered ? 'wa' : '')
          + statCard('Held by filter', String(summary.held), 'Not visible to customers', 'shield', summary.held ? 'er' : '');
        if (!payload.reviews.length) {
          $('#reviewBody').innerHTML = '<div class="table-card">' + U.emptyState({ icon: 'star', title: 'No reviews here', text: 'Reviews appear after customers receive a delivered order.' }) + '</div>';
          return;
        }
        $('#reviewBody').innerHTML = '<div class="card">' + payload.reviews.map(function (review) {
          return '<div class="review-card"><div class="rc-head"><div class="rc-who">' + U.avatar(review.customerName, 'sm')
            + '<strong>' + U.esc(review.customerName) + '</strong><span class="muted small">bought ' + U.esc(review.productName) + '</span></div>'
            + '<div class="rc-meta">' + U.stars(review.rating) + ' ' + U.statusBadge(review.status, review.status === 'flagged' ? 'Held by filter' : 'Published') + '</div></div>'
            + '<div class="rc-meta">' + U.esc(review.localDateTime) + '</div>'
            + '<div class="rc-text">' + U.esc(review.comment) + '</div>'
            + (review.flagReason ? '<div class="notice wa mt-1">' + U.icon('shield') + ' ' + U.esc(review.flagReason) + '</div>' : '')
            + (review.ownerReply ? '<div class="review-reply"><strong>Your reply</strong><p>' + U.esc(review.ownerReply) + '</p><div class="rr-time">' + U.esc(review.ownerReplyAt ? U.dateTime(review.ownerReplyAt) : '') + '</div></div>' : '')
            + (review.status === 'published'
              ? '<div class="btn-row mt-2"><button type="button" class="btn ghost sm" data-reply="' + review.id + '">' + U.icon('message') + (review.ownerReply ? 'Edit reply' : 'Reply') + '</button></div>'
              : '<p class="hint mt-1">This review is held by the automatic filter and cannot be replied to until a platform moderator reviews it.</p>')
            + '</div>';
        }).join('') + '</div>';
        $$('[data-reply]').forEach(function (button) {
          button.addEventListener('click', function () {
            var review = payload.reviews.find(function (entry) { return entry.id === Number(button.dataset.reply); });
            if (!review) return;
            var modal = U.openModal({
              title: 'Reply to review',
              subtitle: review.customerName + ' · ' + review.productName,
              content: '<div class="field"><label for="replyText">Your public reply</label><textarea id="replyText" maxlength="600" placeholder="Thank the customer and address their feedback.">' + U.esc(review.ownerReply || '') + '</textarea>'
                + '<div class="hint">Up to 600 characters. Replies are public on the storefront.</div><div class="err-text" data-field-error></div></div>',
              actions: [
                {
                  label: 'Publish reply',
                  className: 'primary',
                  onClick: async function (api) {
                    var textarea = $('#replyText', modal.body);
                    var reply = textarea.value.trim();
                    if (reply.length < 2) { U.showFieldError(textarea, 'Write a reply before saving.'); return false; }
                    try {
                      var result = await A.post('/api/owner/reviews/' + review.id + '/reply', { reply: reply });
                      U.toast(result.message, 'ok');
                      api.close();
                      load();
                    } catch (error) {
                      U.applyApiError(modal.body, error);
                      return false;
                    }
                  }
                },
                { label: 'Cancel', className: 'ghost' }
              ]
            });
          });
        });
      } catch (error) {
        $('#reviewBody').innerHTML = '<div class="table-card">' + U.errorBlock(error) + '</div>';
      }
    }

    $$('#reviewTabs [data-review-status]').forEach(function (button) {
      button.addEventListener('click', function () {
        status = button.dataset.reviewStatus;
        $$('#reviewTabs [data-review-status]').forEach(function (entry) { entry.classList.toggle('on', entry === button); });
        load();
      });
    });
    await load();
  }

  /* -------------------------------- reports ----------------------------- */

  async function reportsView(view) {
    var range = newRangeState();
    var preview = null;
    view.innerHTML = viewHead('Audit Logs', 'Preview a period, then export exactly the records shown. Preview links expire after 15 minutes.', '')
      + '<div data-range></div>'
      + '<div class="report-actions mt-2"><button type="button" class="btn primary" id="previewReport">' + U.icon('eye') + 'Preview report</button>'
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
        + '<div class="rs"><span class="k">Refunds</span><span class="v">' + U.money(totals.refundsCents) + '</span></div>'
        + '<div class="rs"><span class="k">Net sales</span><span class="v">' + U.money(totals.netSalesCents) + '</span></div>'
        + '<div class="rs"><span class="k">Platform fees</span><span class="v">' + U.money(totals.platformFeesCents) + '</span></div>'
        + '<div class="rs"><span class="k">Owner net</span><span class="v">' + U.money(totals.ownerNetCents) + '</span></div>'
        + '<div class="rs"><span class="k">Units sold</span><span class="v">' + U.number(totals.unitsSold) + '</span></div>'
        + '</div>';
      var rows = report.records.slice(0, 150);
      var table = '<div class="table-card mt-2"><div class="table-wrap"><table class="report-records"><thead><tr>'
        + '<th>Date</th><th>Order</th><th>Customer</th><th>Items</th><th class="num">Qty</th><th class="num">Discount</th><th class="num">Shipping</th><th class="num">Total</th><th>Status</th><th>Sample</th>'
        + '</tr></thead><tbody>' + (rows.length ? rows.map(function (record) {
          return '<tr><td class="nowrap">' + U.esc(record.localDate) + '</td><td><span class="mono">' + U.esc(record.code) + '</span></td>'
            + '<td>' + U.esc(record.customerName) + '</td><td class="small">' + U.esc(record.itemSummary) + '</td>'
            + '<td class="num">' + record.quantity + '</td><td class="num">' + (record.discountCents ? negMoney(record.discountCents) : '—') + '</td>'
            + '<td class="num">' + U.money(record.shippingCents) + '</td><td class="num"><strong>' + U.money(record.totalCents) + '</strong></td>'
            + '<td>' + U.statusBadge(record.status) + '</td><td>' + (record.isSample ? 'Yes' : '—') + '</td></tr>';
        }).join('') : '<tr><td colspan="10"><div class="empty-state" style="padding:22px"><p>No records in this period.</p></div></td></tr>')
        + '</tbody></table></div>'
        + (report.records.length > rows.length ? '<div class="table-foot">Showing the first ' + rows.length + ' of ' + report.records.length + ' records in this preview. The CSV contains all records.</div>' : '')
        + '</div>'
        ;
      $('#reportBody').innerHTML = summary + table;
    }

    $('#previewReport').addEventListener('click', async function () {
      var button = $('#previewReport');
      U.setBusy(button, true, 'Building preview…');
      try {
        var query = rangeParams(range);
        var report = await A.get('/api/owner/reports' + A.query(query));
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
        var name = await A.download('/api/owner/reports.csv' + A.query(query), 'skyworld-owner-report.csv');
        U.toast('CSV downloaded: ' + name, 'ok');
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

  /* -------------------------------- suppliers --------------------------- */

  async function suppliersView(view) {
    view.innerHTML = viewHead('Suppliers', 'Track the people and businesses behind your stock.', '<button class="btn" type="button" id="addSupplier">' + U.icon('plus') + 'Add supplier</button>')
      + '<div id="supplierBody">' + U.loading('Loading suppliers…') + '</div>';

    var all = [];

    function openSupplierModal(supplier) {
      var editing = Boolean(supplier);
      var modal = U.openModal({
        title: editing ? 'Edit supplier' : 'Add supplier',
        subtitle: editing ? supplier.name : 'Keep contact details for restocking in one place.',
        content: '<form id="supplierForm" novalidate><div class="form-grid">'
          + '<div class="field span-2"><label for="supName">Supplier or business name</label><input id="supName" name="name" type="text" maxlength="100" value="' + (supplier ? U.attr(supplier.name) : '') + '" required><div class="err-text" data-field-error></div></div>'
          + '<div class="field"><label for="supContact">Contact person</label><input id="supContact" name="contactName" type="text" maxlength="80" value="' + (supplier ? U.attr(supplier.contactName) : '') + '"><div class="err-text" data-field-error></div></div>'
          + '<div class="field"><label for="supPhone">Phone</label><input id="supPhone" name="phone" type="tel" maxlength="20" value="' + (supplier ? U.attr(supplier.phone) : '') + '"><div class="err-text" data-field-error></div></div>'
          + '<div class="field"><label for="supEmail">Email</label><input id="supEmail" name="email" type="email" maxlength="120" value="' + (supplier ? U.attr(supplier.email) : '') + '"><div class="err-text" data-field-error></div></div>'
          + '<div class="field"><label for="supAddress">Address</label><input id="supAddress" name="address" type="text" maxlength="200" value="' + (supplier ? U.attr(supplier.address) : '') + '"><div class="err-text" data-field-error></div></div>'
          + '<div class="field span-2"><label for="supNotes">Notes</label><textarea id="supNotes" name="notes" maxlength="600" placeholder="Lead times, minimum order, payment terms.">' + (supplier ? U.esc(supplier.notes) : '') + '</textarea><div class="err-text" data-field-error></div></div>'
          + '</div></form>',
        actions: [
          {
            label: editing ? 'Save supplier' : 'Add supplier',
            className: 'primary',
            onClick: async function (api) {
              var form = $('#supplierForm', modal.body);
              U.clearFieldErrors(form);
              var name = field(form, 'name').value.trim();
              if (name.length < 2) { U.showFieldError(field(form, 'name'), 'Enter the supplier name.'); return false; }
              var payload = {
                name: name,
                contactName: field(form, 'contactName').value.trim(),
                phone: field(form, 'phone').value.trim(),
                email: field(form, 'email').value.trim(),
                address: field(form, 'address').value.trim(),
                notes: field(form, 'notes').value.trim()
              };
              try {
                var result = editing
                  ? await A.put('/api/owner/suppliers/' + supplier.id, payload)
                  : await A.post('/api/owner/suppliers', payload);
                U.toast(result.message, 'ok');
                api.close();
                load();
              } catch (error) {
                if (error.field) U.applyApiError(form, error);
                else api.showError(error.message);
                return false;
              }
            }
          },
          { label: 'Cancel', className: 'ghost' }
        ]
      });
    }

    function paint() {
      if (!all.length) {
        $('#supplierBody').innerHTML = '<div class="table-card">' + U.emptyState({ icon: 'truck', title: 'No suppliers yet', text: 'Add the businesses that supply your stall so restocking details stay organised.', action: '<button type="button" class="btn secondary" data-empty-supplier>Add supplier</button>' }) + '</div>';
        var emptyAdd = $('[data-empty-supplier]');
        if (emptyAdd) emptyAdd.addEventListener('click', function () { openSupplierModal(null); });
        return;
      }
      $('#supplierBody').innerHTML = '<div class="table-card"><div class="table-wrap"><table><thead><tr>'
        + '<th>Supplier</th><th>Contact</th><th>Phone</th><th>Email</th><th>Address</th><th>Notes</th><th></th></tr></thead><tbody>'
        + all.map(function (supplier) {
          return '<tr><td><div class="cell-title">' + U.esc(supplier.name) + '</div></td>'
            + '<td>' + U.esc(supplier.contactName || '—') + '</td><td>' + U.esc(supplier.phone || '—') + '</td>'
            + '<td class="small">' + U.esc(supplier.email || '—') + '</td><td class="small">' + U.esc(supplier.address || '—') + '</td>'
            + '<td class="small">' + U.esc(supplier.notes || '—') + '</td>'
            + '<td><div class="table-actions"><button type="button" class="btn ghost sm" data-edit-supplier="' + supplier.id + '">' + U.icon('edit') + 'Edit</button>'
            + '<button type="button" class="icon-btn" data-archive-supplier="' + supplier.id + '" aria-label="Archive ' + U.attr(supplier.name) + '" title="Archive">' + U.icon('archive') + '</button></div></td></tr>';
        }).join('') + '</tbody></table></div></div>';
      $$('[data-edit-supplier]').forEach(function (button) {
        button.addEventListener('click', function () {
          var supplier = all.find(function (entry) { return entry.id === Number(button.dataset.editSupplier); });
          if (supplier) openSupplierModal(supplier);
        });
      });
      $$('[data-archive-supplier]').forEach(function (button) {
        button.addEventListener('click', async function () {
          var supplier = all.find(function (entry) { return entry.id === Number(button.dataset.archiveSupplier); });
          if (!supplier) return;
          var ok = await U.confirmDialog({
            title: 'Archive supplier?',
            message: supplier.name + ' will be moved to Archives.',
            detail: '<p>You can restore the supplier later from Archives.</p>',
            confirmLabel: 'Archive supplier',
            danger: true
          });
          if (!ok) return;
          try {
            var result = await A.post('/api/owner/suppliers/' + supplier.id + '/archive', {});
            U.toast(result.message, 'ok');
            load();
          } catch (error) { U.toast(error.message, 'er'); }
        });
      });
    }

    async function load() {
      try {
        var payload = await A.get('/api/owner/suppliers');
        all = payload.suppliers;
        paint();
      } catch (error) {
        $('#supplierBody').innerHTML = '<div class="table-card">' + U.errorBlock(error) + '</div>';
      }
    }

    $('#addSupplier').addEventListener('click', function () { openSupplierModal(null); });
    await load();
  }

  /* -------------------------------- archives ---------------------------- */

  async function archivesView(view) {
    var data = await A.get('/api/owner/archives');
    view.innerHTML = viewHead('Archives', 'Nothing is deleted. Products, orders, and suppliers stay available for audit and order history.', '')
      + '<div class="archive-group mt-2"><div class="section-title"><h3>Archived products <span class="muted small">(' + data.products.length + ')</span></h3></div>'
      + (data.products.length ? '<div class="table-card"><div class="table-wrap"><table><thead><tr><th>Product</th><th>Category</th><th class="num">Price</th><th class="num">Stock</th><th>Archived</th><th></th></tr></thead><tbody>'
        + data.products.map(function (product) {
          return '<tr><td>' + productCell(product) + '</td><td>' + U.esc(product.category) + '</td><td class="num">' + U.money(product.priceCents) + '</td>'
            + '<td class="num">' + product.stock + '</td><td class="small">' + U.dateTime(product.updatedAt) + '</td>'
            + '<td><button type="button" class="btn ghost sm" data-restore-archive="' + product.id + '">' + U.icon('restore') + 'Restore</button></td></tr>';
        }).join('') + '</tbody></table></div></div>' : U.emptyState({ icon: 'archive', title: 'No archived products', text: 'Products you archive will appear here.' }))
      + '</div>'
      + '<div class="archive-group"><div class="section-title"><h3>Cancelled and refunded orders <span class="muted small">(' + data.orders.length + ')</span></h3></div>'
      + (data.orders.length ? '<div class="table-card"><div class="table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th class="num">Total</th><th>Status</th><th>Placed</th><th>Data</th><th></th></tr></thead><tbody>'
        + data.orders.map(function (order) {
          return '<tr><td><span class="mono">' + U.esc(order.code) + '</span></td><td>' + U.esc(order.customerName) + '</td>'
            + '<td class="num">' + U.money(order.totalCents) + '</td><td>' + U.statusBadge(order.status) + '</td>'
            + '<td class="nowrap">' + U.esc(order.localDateTime) + '</td><td>' + (order.isSample ? U.sampleBadge(true) : '<span class="muted small">Live</span>') + '</td>'
            + '<td><button type="button" class="btn ghost sm" data-archive-order="' + order.id + '">View</button></td></tr>';
        }).join('') + '</tbody></table></div></div>' : U.emptyState({ icon: 'receipt', title: 'No cancelled or refunded orders', text: 'Orders cancelled or refunded by you or a platform moderator appear here.' }))
      + '</div>'
      + '<div class="archive-group"><div class="section-title"><h3>Archived suppliers <span class="muted small">(' + data.suppliers.length + ')</span></h3></div>'
      + (data.suppliers.length ? '<div class="archive-grid">' + data.suppliers.map(function (supplier) {
        return '<div class="archive-card"><div class="ac-title">' + U.esc(supplier.name) + '</div>'
          + '<div class="ac-sub">Archived ' + U.dateTime(supplier.updatedAt) + '</div>'
          + '<div class="ac-actions"><button type="button" class="btn ghost sm" data-restore-supplier="' + supplier.id + '">' + U.icon('restore') + 'Restore</button></div></div>';
      }).join('') + '</div>' : U.emptyState({ icon: 'truck', title: 'No archived suppliers', text: 'Suppliers you archive will appear here.' }))
      + '</div>'
      + '<div class="card mt-2"><div class="card-head"><h3>Retention notes</h3></div><ul class="small" style="padding-left:18px;color:var(--ink-soft)">'
      + data.notes.map(function (note) { return '<li style="margin-bottom:4px">' + U.esc(note) + '</li>'; }).join('') + '</ul></div>';

    $$('[data-restore-archive]').forEach(function (button) {
      button.addEventListener('click', async function () {
        try {
          var result = await A.post('/api/owner/products/' + button.dataset.restoreArchive + '/restore', {});
          U.toast(result.message, 'ok');
          archivesView(view);
        } catch (error) { U.toast(error.message, 'er'); }
      });
    });
    $$('[data-archive-order]').forEach(function (button) {
      button.addEventListener('click', function () { openOrderModal(Number(button.dataset.archiveOrder), function () { archivesView(view); }); });
    });
    $$('[data-restore-supplier]').forEach(function (button) {
      button.addEventListener('click', async function () {
        try {
          var result = await A.post('/api/owner/suppliers/' + button.dataset.restoreSupplier + '/restore', {});
          U.toast(result.message, 'ok');
          archivesView(view);
        } catch (error) { U.toast(error.message, 'er'); }
      });
    });
  }

  /* -------------------------------- shell ------------------------------- */

  var termsView = simpleSettingsView('Terms and Conditions',
    '<p>By using our online store, you agree to the following terms. Please read them carefully before placing an order.</p>'
    + '<ol style="padding-left:18px;margin:0">'
    + '<li style="margin-bottom:10px"><strong>Use of the Store</strong><br>By using our online store, you agree to provide accurate information and use the platform responsibly.</li>'
    + '<li style="margin-bottom:10px"><strong>Orders and Pricing</strong><br>All orders are subject to product availability and order confirmation. Prices, product descriptions, and order totals will be displayed before checkout.</li>'
    + '<li style="margin-bottom:10px"><strong>Payments</strong><br>Customers must follow the payment instructions provided for their selected payment method. An order will only be marked as paid after payment has been verified.</li>'
    + '<li style="margin-bottom:10px"><strong>Shipping and Delivery</strong><br>Orders will be processed according to the store\'s fulfilment policy. We aim to dispatch eligible confirmed orders within 24 hours, but actual delivery times may vary depending on location, courier availability, and other circumstances.</li>'
    + '<li style="margin-bottom:10px"><strong>Cancellations, Returns, and Refunds</strong><br>Order cancellations, returns, replacements, and refunds are subject to the store\'s published policies and applicable consumer protection laws.</li>'
    + '<li style="margin-bottom:10px"><strong>Product Reviews and Feedback</strong><br>Customers may submit honest ratings, comments, and product photos for eligible purchases. Reviews must not contain abusive, fraudulent, or unlawful content.</li>'
    + '<li style="margin-bottom:10px"><strong>Privacy and Data Protection</strong><br>Customer information will be handled according to the store\'s Privacy Policy and applicable data protection laws. Customers must keep their login credentials secure.</li>'
    + '<li style="margin-bottom:10px"><strong>Changes to These Terms</strong><br>We may update these terms when necessary. Any applicable changes will be published in this section.</li>'
    + '</ol>'
    + '<p class="muted" style="margin-top:12px">These terms apply to customers shopping at your stall on SkyWorld Stall. Lease, commission, and platform rules for stall owners are managed separately with market administration.</p>'
  );

  function notificationsView(view) {
    var items = [
      {
        type: 'order', unread: true, time: 'Today · 2:14 PM',
        title: 'New purchase — Cotton Crew Tee',
        body: 'Ana Marie Santos ordered Cotton Crew Tee (Oat, M) · Order SW-10482 · GCash · ₱1,495.00',
        meta: 'Buyer: Ana Marie Santos · +63 917 204 1183 · ana.santos@email.com · Baguio City'
      },
      {
        type: 'order', unread: true, time: 'Today · 11:02 AM',
        title: 'New purchase — Straight-Cut Denim Jeans',
        body: 'Jerome Dela Cruz ordered Straight-Cut Denim Jeans (Indigo, 32) · Order SW-10471 · Maya · ₱5,995.00',
        meta: 'Buyer: Jerome Dela Cruz · +63 918 556 9021 · jerome.dc@email.com · La Trinidad, Benguet'
      },
      {
        type: 'order', unread: false, time: 'Yesterday · 6:48 PM',
        title: 'New purchase — Puff-Sleeve Blouse',
        body: 'Krisha Mae Flores ordered Puff-Sleeve Blouse (Sage, S) · Order SW-10455 · Bank Transfer (BDO) · ₱3,297.50',
        meta: 'Buyer: Krisha Mae Flores · +63 927 441 8805 · krisha.flores@email.com · Baguio City'
      },
      {
        type: 'review', unread: false, time: 'Yesterday · 3:20 PM',
        title: 'New review on Floral Midi Dress',
        body: 'Mia Reyes left a 5-star review after delivery of Order SW-10390.',
        meta: 'Open Customer Reviews to reply'
      },
      {
        type: 'order', unread: false, time: 'Oct 21 · 9:15 AM',
        title: 'New purchase — Ribbed Tank Top',
        body: 'Carlo Mendoza ordered Ribbed Tank Top (Charcoal, L) × 2 · Order SW-10388 · GCash · ₱2,990.00',
        meta: 'Buyer: Carlo Mendoza · +63 916 778 2340 · carlo.m@email.com · Itogon, Benguet'
      },
      {
        type: 'account', unread: false, time: 'Oct 20 · 8:01 AM',
        title: 'Profile updated',
        body: 'Your stall contact mobile number was saved successfully.',
        meta: 'Account Settings'
      }
    ];
    view.innerHTML = viewHead('Notifications', 'Alerts when customers place orders at your shop, plus account activity', '')
      + '<div class="card"><div class="stack" style="gap:0">'
      + items.map(function (item) {
        var tone = item.type === 'order' ? 'ok' : item.type === 'review' ? 'wa' : '';
        return '<div class="list-row" style="' + (item.unread ? 'background:rgba(59,130,246,0.06);' : '') + '">'
          + '<div class="lr-main">'
          + '<div class="lr-title">' + (item.unread ? '<span class="badge ' + tone + '" style="margin-right:6px">New</span>' : '')
          + U.esc(item.title) + '</div>'
          + '<div class="lr-sub">' + U.esc(item.body) + '</div>'
          + '<div class="muted small mt-1">' + U.esc(item.meta) + '</div>'
          + '</div>'
          + '<div class="lr-side"><span class="muted small nowrap">' + U.esc(item.time) + '</span></div>'
          + '</div>';
      }).join('')
      + '</div></div>'
      + '<p class="hint mt-2">Order, review, and account alerts for your stall appear here. Update your name, email, or mobile under <strong>Account Settings</strong>.</p>';
  }

  function ownerReviewsSettingsView(view) {
    var reviews = [
      {
        name: 'Mia Reyes', product: 'Floral Midi Dress', rating: 5, date: 'Yesterday · 3:20 PM',
        comment: 'The fabric feels lovely and the colour is just like the photos. Packed neatly, too. Will order again.',
        image: '/shared/products/p6-sage.svg'
      },
      {
        name: 'Ana Marie Santos', product: 'Cotton Crew Tee', rating: 5, date: 'Oct 21 · 7:45 PM',
        comment: 'Arrived quickly in Baguio and the size guide was accurate. Soft cotton and true to colour.',
        image: null
      },
      {
        name: 'Jerome Dela Cruz', product: 'Straight-Cut Denim Jeans', rating: 4, date: 'Oct 20 · 1:12 PM',
        comment: 'Really happy with this. The quality is better than I expected for the price. Slightly long but easy to hem.',
        image: '/shared/products/p4-espresso.svg'
      },
      {
        name: 'Krisha Mae Flores', product: 'Puff-Sleeve Blouse', rating: 5, date: 'Oct 19 · 5:30 PM',
        comment: 'The seller answered my question right away. Item was exactly as described. Love the sage colour.',
        image: '/shared/products/p7-sage.svg'
      },
      {
        name: 'Carlo Mendoza', product: 'Ribbed Tank Top', rating: 4, date: 'Oct 18 · 10:08 AM',
        comment: 'Good value. There was a tiny crease from packing but it came out after a wash. Ordered two colours.',
        image: null
      },
      {
        name: 'Liza Villanueva', product: 'A-Line Midi Skirt', rating: 5, date: 'Oct 17 · 4:55 PM',
        comment: 'Love the warm colour. It is now my favourite piece in my wardrobe. Fits true to size.',
        image: '/shared/products/p9-terracotta.svg'
      }
    ];
    view.innerHTML = viewHead('Reviews', 'Ratings and comments from customers who bought from your stall', '')
      + '<div class="card">'
      + reviews.map(function (review) {
        return '<div class="review-card">'
          + '<div class="rc-head"><div class="rc-who">' + U.avatar(review.name, 'sm')
          + '<strong>' + U.esc(review.name) + '</strong>'
          + '<span class="muted small">bought ' + U.esc(review.product) + '</span></div>'
          + '<div class="rc-meta">' + U.stars(review.rating) + '</div></div>'
          + '<div class="rc-meta">' + U.esc(review.date) + '</div>'
          + '<div class="rc-text">' + U.esc(review.comment) + '</div>'
          + (review.image
            ? '<div class="mt-2" style="max-width:120px;border-radius:8px;overflow:hidden;border:1px solid var(--border, #e5e7eb)">'
              + '<img src="' + U.attr(review.image) + '" alt="Photo from ' + U.esc(review.name) + '" style="display:block;width:100%;height:auto">'
              + '</div>'
            : '')
          + '</div>';
      }).join('')
      + '</div>'
      + '<p class="hint mt-2">Published reviews are visible on the storefront. Reply to customers from <strong>Customer Reviews</strong>. Held items wait for platform moderation.</p>';
  }

  function auditTrailView(view) {
    var rows = [
      { when: 'Today · 2:14 PM', actor: 'You', action: 'Order received', detail: 'New order SW-10482 — Cotton Crew Tee (Oat, M) · Ana Marie Santos · GCash · ₱1,495.00' },
      { when: 'Today · 2:16 PM', actor: 'You', action: 'Order update', detail: 'Confirmed order SW-10482 (Cotton Crew Tee · Ana Marie Santos)' },
      { when: 'Today · 11:02 AM', actor: 'You', action: 'Order received', detail: 'New order SW-10471 — Straight-Cut Denim Jeans (Indigo, 32) · Jerome Dela Cruz · Maya · ₱5,995.00' },
      { when: 'Today · 11:05 AM', actor: 'You', action: 'Order update', detail: 'Marked SW-10471 as shipped (Straight-Cut Denim Jeans · Jerome Dela Cruz)' },
      { when: 'Yesterday · 6:48 PM', actor: 'You', action: 'Order received', detail: 'New order SW-10455 — Puff-Sleeve Blouse (Sage, S) · Krisha Mae Flores · Bank Transfer · ₱3,297.50' },
      { when: 'Yesterday · 6:50 PM', actor: 'You', action: 'Inventory change', detail: 'Updated stock for Puff-Sleeve Blouse (Sage) after order SW-10455' },
      { when: 'Yesterday · 3:22 PM', actor: 'You', action: 'Review activity', detail: 'Opened Customer Reviews after a new rating on Floral Midi Dress' },
      { when: 'Oct 21 · 9:15 AM', actor: 'You', action: 'Order received', detail: 'New order SW-10388 — Ribbed Tank Top (Charcoal, L) × 2 · Carlo Mendoza · GCash · ₱2,990.00' },
      { when: 'Oct 21 · 9:40 AM', actor: 'You', action: 'Account activity', detail: 'Saved stall contact mobile number under Account Settings' },
      { when: 'Oct 20 · 4:12 PM', actor: 'You', action: 'Store action', detail: 'Saved lease note and commission settings for the current term' },
      { when: 'Oct 20 · 8:01 AM', actor: 'You', action: 'Account activity', detail: 'Signed in to the owner workspace from Baguio (Asia/Manila)' },
      { when: 'Oct 19 · 2:35 PM', actor: 'You', action: 'Inventory change', detail: 'Published product draft: Ribbed Tank Top (Charcoal)' },
      { when: 'Oct 18 · 11:20 AM', actor: 'Operator', action: 'Store action', detail: 'Recorded evening floor walkthrough for your stall' },
      { when: 'Oct 17 · 9:05 AM', actor: 'You', action: 'Account activity', detail: 'Signed in to the owner workspace' }
    ];
    view.innerHTML = viewHead('Audit Trail', 'A detailed, chronological record of every event in this stall — account activity, inventory changes, orders and store actions — from the very first entry to the latest.', '')
      + '<div class="card"><div class="stack" style="gap:12px">'
      + '<p>A detailed, chronological record of every event in this stall — account activity, inventory changes, orders and store actions — from the very first entry to the latest.</p>'
      + '<ul style="padding-left:18px;margin:0">'
      + '<li style="margin-bottom:6px">Records are append-only and retained with the shared stall database.</li>'
      + '<li style="margin-bottom:6px">Platform administrators and operators can review the full trail when investigating issues.</li>'
      + '<li style="margin-bottom:6px">Your own recent activity is reflected in Overview and related module history where available.</li>'
      + '</ul>'
      + '</div></div>'
      + '<div class="card mt-2"><div class="card-head"><h3>Recent activity</h3></div>'
      + '<div class="stack" style="gap:0">'
      + rows.map(function (row) {
        return '<div class="list-row">'
          + '<div class="lr-main">'
          + '<div class="lr-title">' + U.esc(row.action) + ' · <span class="muted">' + U.esc(row.actor) + '</span></div>'
          + '<div class="lr-sub">' + U.esc(row.detail) + '</div>'
          + '</div>'
          + '<div class="lr-side"><span class="muted small nowrap">' + U.esc(row.when) + '</span></div>'
          + '</div>';
      }).join('')
      + '</div></div>'
      + '<p class="hint mt-2">Contact an operator or administrator if you need a formal activity report extracted from the audit trail.</p>';
  }

  var helpSupportView = simpleSettingsView('Help & Support',
    '<p>Welcome to Help &amp; Support! We\'re here to help you with your shopping experience and stall operations. Check the common questions below or contact our support team if you need further assistance.</p>'
    + '<p><strong>Frequently Asked Questions (FAQs)</strong></p>'
    + '<ul style="padding-left:18px;margin:0">'
    + '<li style="margin-bottom:10px"><strong>How do I place an order?</strong><br>Browse the products, add your selected items to your cart, proceed to checkout, enter your details, and complete the required payment steps.</li>'
    + '<li style="margin-bottom:10px"><strong>How can I check my order status?</strong><br>Use Track order on the public store with your order code and the email or mobile used at checkout. Stall owners can open <strong>Orders</strong> in this workspace for the full list.</li>'
    + '<li style="margin-bottom:10px"><strong>What if my payment has not been confirmed?</strong><br>Check your payment reference and order details. If the status remains pending, contact support and provide your order number and transaction reference. Never send your password or OTP.</li>'
    + '<li style="margin-bottom:10px"><strong>How can I leave feedback?</strong><br>Open your eligible delivered order, select the product, and click Leave Feedback to submit a rating, comment, and product photo.</li>'
    + '<li style="margin-bottom:10px"><strong>What if I have a problem with my account?</strong><br>Contact the support team for help with login, registration, or account-related concerns.</li>'
    + '</ul>'
    + '<p><strong>Contact Support</strong></p>'
    + '<ul style="padding-left:18px;margin:0">'
    + '<li style="margin-bottom:6px"><strong>Email:</strong> support@skyworld.ph</li>'
    + '<li style="margin-bottom:6px"><strong>Contact number:</strong> +63 917 000 0000</li>'
    + '<li style="margin-bottom:6px"><strong>Business hours:</strong> Monday–Saturday, 9:00 AM – 6:00 PM (Asia/Manila)</li>'
    + '<li style="margin-bottom:6px"><strong>Location:</strong> F. Calderon St. Baguio City, Benguet</li>'
    + '</ul>'
    + '<p style="margin-top:12px"><strong>Stall owner shortcuts</strong></p>'
    + '<ul style="padding-left:18px;margin:0">'
    + '<li style="margin-bottom:6px"><strong>Products &amp; stock:</strong> use Products and Inventory in this workspace</li>'
    + '<li style="margin-bottom:6px"><strong>Orders &amp; fulfilment:</strong> use Orders; mark status as you pack and deliver</li>'
    + '<li style="margin-bottom:6px"><strong>Reviews:</strong> reply under Customer Reviews; held items are handled by platform staff</li>'
    + '<li style="margin-bottom:6px"><strong>Stall profile &amp; lease:</strong> edit under Storefront / Stall settings</li>'
    + '<li style="margin-bottom:6px"><strong>Field issues:</strong> request help via the Operator portal</li>'
    + '</ul>'
  );
  
  var config = {
    role: 'owner',
    area: 'Stall workspace',
    areaIcon: 'store',
    defaultView: 'overview',
    nav: [
      {
        label: 'Daily work',
        items: [
          { id: 'overview', label: 'Overview', icon: 'home', subtitle: 'Today at your stall' },
          { id: 'orders', label: 'Orders', icon: 'receipt', subtitle: 'Fulfil and update orders' },
          { id: 'inventory', label: 'Inventory', icon: 'box', subtitle: 'Stock levels and alerts' },
          { id: 'products', label: 'Product Management', icon: 'package', subtitle: 'Catalogue and variants' },
          { id: 'storefront', label: 'Online Store Management', icon: 'store', subtitle: 'Store status and featured picks' }
        ]
      },
      {
        label: 'Customers & money',
        items: [
          { id: 'sales', label: 'Sales History', icon: 'trend', subtitle: 'Delivered sales and refunds' },
          { id: 'reviews', label: 'Customer Reviews', icon: 'star', subtitle: 'Reply and monitor reviews' },
          { id: 'reports', label: 'Audit Logs', icon: 'chart', subtitle: 'Preview and export CSV' },
          { id: 'suppliers', label: 'Suppliers', icon: 'truck', subtitle: 'Restocking contacts' }
        ]
      },
      {
        label: 'Stall admin',
        items: [
          { id: 'archives', label: 'Archives', icon: 'archive', subtitle: 'Retained records' },
          { id: 'stall', label: 'Stall Profile', icon: 'image', subtitle: 'Public identity and media' },
          { id: 'account', label: 'Account Settings', icon: 'user', subtitle: 'Profile and password', account: true }
        ]
      },
      {
        label: 'Settings',
        items: [
          { id: 'about', label: 'About', icon: 'info', subtitle: 'About this workspace' },
          { id: 'terms', label: 'Terms and Conditions', icon: 'clipboard', subtitle: 'Stall operating terms' },
          { id: 'notifications', label: 'Notifications', icon: 'bell', subtitle: 'Order and account alerts' },
          { id: 'reviews-settings', label: 'Reviews', icon: 'star', subtitle: 'Review guidelines' },
          { id: 'help-support', label: 'Help & Support', icon: 'message', subtitle: 'Get assistance' }
        ]
      }
    ],
    views: {
      overview: overviewView,
      orders: ordersView,
      inventory: inventoryView,
      products: productsView,
      storefront: storefrontView,
      sales: salesView,
      reviews: reviewsView,
      reports: reportsView,
      suppliers: suppliersView,
      archives: archivesView,
      stall: stallProfileView,
      account: function (view) { return window.SkyDash.accountView(view); },
      about: aboutView,
      terms: termsView,
      'terms-and-conditions': termsView,
      notifications: notificationsView,
      'reviews-settings': ownerReviewsSettingsView,
      'audit-trail': auditTrailView,
      audit: auditTrailView,
      'help-support': helpSupportView,
      help: helpSupportView
    }
  };


  function simpleSettingsView(title, bodyHtml) {
    return function (view) {
      view.innerHTML = viewHead(title, '', '')
        + '<div class="card"><div class="stack" style="gap:12px">' + bodyHtml + '</div></div>';
    };
  }

  async function aboutView(view) {
    var stallName = 'Your Stall';
    try {
      var me = window.SkyDash && window.SkyDash.state && window.SkyDash.state.me;
      if (me && me.stall && me.stall.name) stallName = me.stall.name;
      else {
        var data = await A.get('/api/owner/overview');
        if (data && data.stall && data.stall.name) stallName = data.stall.name;
      }
    } catch (_) {}
    view.innerHTML = viewHead('About', 'About this store', '')
      + '<div class="card"><div class="stack" style="gap:12px">'
      + '<p><strong>' + U.esc(stallName) + ' — Creative Studio | Brand Identity &amp; Web Design</strong></p>'
      + '<p><strong>About Our Store</strong></p>'
      + '<p>Welcome to our online store! Our goal is to provide customers with a convenient, secure, and enjoyable shopping experience. Through our online platform, customers can browse products, add items to their cart, place orders, choose available payment methods, and track their purchases with ease.</p>'
      + '<p>We are committed to providing quality products, reliable service, and a smooth shopping experience for everyone.</p>'
      + '<p><strong>Store details</strong></p>'
      + '<ul style="padding-left:18px;margin:0">'
      + '<li style="margin-bottom:6px"><strong>Store name:</strong> ' + U.esc(stallName) + '</li>'
      + '<li style="margin-bottom:6px"><strong>Location:</strong> F. Calderon St. Baguio City, Benguet</li>'
      + '<li style="margin-bottom:6px"><strong>Mission:</strong> Deliver quality goods from independent Baguio stalls with clear prices, honest stock, and reliable fulfilment.</li>'
      + '<li style="margin-bottom:6px"><strong>Vision:</strong> A trusted multi-stall marketplace where every owner can sell online and every customer can shop with confidence.</li>'
      + '<li style="margin-bottom:6px"><strong>Business hours:</strong> Monday–Saturday, 9:00 AM – 6:00 PM (Asia/Manila)</li>'
      + '<li style="margin-bottom:6px"><strong>Contact:</strong> Use Help &amp; Support in this workspace or the market administration desk.</li>'
      + '</ul>'
      + '<p>SkyWorld Stall is a multi-stall marketplace. Your stall shares one catalogue and order platform with the other stalls. Customers browse and check out from the public storefront; you fulfil orders and update stock from this desk.</p>'
      + '</div></div>';
  }


 

  window.SkyDash.boot(config);
})();
