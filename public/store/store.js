(function () {
  'use strict';

  var A = window.SkyApi;
  var U = window.SkyUI;
  var app = document.getElementById('app');
  var CART_KEY = 'skyworld-cart-v1';
  var LAST_KEY = 'skyworld-last-order-code';
  var CHECKOUT_KEY = 'skyworld-checkout-attempt';
  var DELIVERY_KEY = 'skyworld-delivery-details';
  var ORDERS_KEY = 'skyworld-my-orders-v1';
  var INBOX_KEY = 'skyworld-inbox-v1';

  var state = {
    meta: null,
    stalls: null,
    filters: { q: '', category: 'All' },
    cart: readCart(),
    lastCode: readValue(LAST_KEY),
    prefillCode: '',
    checkoutKey: null,
    thanks: null,
    thanksStallName: '',
    track: null,
    reviewed: {},
    lastRoute: '',
    stallTitle: '',
    productTitle: '',
    delivery: readDelivery(),
    myOrders: readMyOrders(),
    inbox: readInbox(),
    token: 0
  };

  function readValue(key) {
    try { return localStorage.getItem(key) || ''; } catch (_) { return ''; }
  }

  function readDelivery() {
    try {
      var parsed = JSON.parse(localStorage.getItem(DELIVERY_KEY) || 'null');
      if (!parsed || typeof parsed !== 'object') return {};
      return {
        name: String(parsed.name || ''),
        email: String(parsed.email || ''),
        phone: String(parsed.phone || ''),
        address: String(parsed.address || ''),
        city: String(parsed.city || ''),
        notes: String(parsed.notes || '')
      };
    } catch (_) { return {}; }
  }

  function saveDelivery(details) {
    state.delivery = {
      name: String(details.name || ''),
      email: String(details.email || ''),
      phone: String(details.phone || ''),
      address: String(details.address || ''),
      city: String(details.city || ''),
      notes: String(details.notes || '')
    };
    try { localStorage.setItem(DELIVERY_KEY, JSON.stringify(state.delivery)); } catch (_) {}
  }

  function readMyOrders() {
    try {
      var parsed = JSON.parse(localStorage.getItem(ORDERS_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) { return []; }
  }

  function saveMyOrders() {
    try { localStorage.setItem(ORDERS_KEY, JSON.stringify(state.myOrders.slice(0, 40))); } catch (_) {}
  }

  function rememberOrder(order, stallName) {
    if (!order || !order.code) return;
    state.myOrders = state.myOrders.filter(function (entry) { return entry.code !== order.code; });
    state.myOrders.unshift({
      code: order.code,
      email: order.customerEmail || order.email || '',
      phone: order.customerPhone || order.phone || '',
      status: order.status || 'pending',
      totalCents: order.totalCents || 0,
      stallName: stallName || order.stallName || '',
      placedAt: order.createdAt || new Date().toISOString(),
      items: (order.items || []).map(function (item) {
        return {
          productId: item.productId,
          name: item.name,
          image: item.image || '',
          qty: item.qty
        };
      })
    });
    saveMyOrders();
    pushInbox({
      title: 'Order placed',
      message: 'Your order ' + order.code + (stallName ? ' from ' + stallName : '') + ' was received.',
      href: '#track',
      code: order.code
    });
  }

  function readInbox() {
    try {
      var parsed = JSON.parse(localStorage.getItem(INBOX_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) { return []; }
  }

  function saveInbox() {
    try { localStorage.setItem(INBOX_KEY, JSON.stringify(state.inbox.slice(0, 50))); } catch (_) {}
  }

  function pushInbox(entry) {
    state.inbox.unshift({
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      title: entry.title || 'Notification',
      message: entry.message || '',
      href: entry.href || '#orders',
      code: entry.code || '',
      read: false,
      at: new Date().toISOString()
    });
    saveInbox();
  }

  function readCart() {
    var empty = { stallId: null, stallName: '', lines: [], voucher: '' };
    try {
      var parsed = JSON.parse(localStorage.getItem(CART_KEY) || 'null');
      if (!parsed || !Array.isArray(parsed.lines)) return empty;
      var lines = parsed.lines.filter(function (line) {
        return line && Number.isInteger(Number(line.productId)) && Number(line.qty) > 0;
      }).map(function (line) {
        return {
          productId: Number(line.productId),
          name: String(line.name || 'Item'),
          image: String(line.image || ''),
          color: String(line.color || ''),
          colorHex: String(line.colorHex || ''),
          size: String(line.size || ''),
          qty: Math.min(20, Math.max(1, Math.trunc(Number(line.qty)))),
          stock: Math.max(0, Number(line.stock) || 0),
          unitCents: Math.max(0, Number(line.unitCents) || 0)
        };
      });
      return {
        stallId: lines.length ? Number(parsed.stallId) || null : null,
        stallName: lines.length ? String(parsed.stallName || '') : '',
        lines: lines,
        voucher: String(parsed.voucher || '').toUpperCase()
      };
    } catch (_) {
      return empty;
    }
  }

  function saveCart() {
    try { localStorage.setItem(CART_KEY, JSON.stringify(state.cart)); } catch (_) {}
    updateCartBadge();
  }

  function cartCount() {
    return state.cart.lines.reduce(function (sum, line) { return sum + line.qty; }, 0);
  }

  function updateCartBadge() {
    var badge = document.getElementById('cartCount');
    if (!badge) return;
    var count = cartCount();
    badge.textContent = String(count);
    badge.hidden = count === 0;
    var link = badge.closest('.header-cart');
    if (link) link.setAttribute('aria-label', count ? 'Shopping cart, ' + count + ' item' + (count === 1 ? '' : 's') : 'Shopping cart, empty');
  }

  function lineKey(productId, color, size) {
    return productId + '|' + (color || '') + '|' + (size || '');
  }

  function esc(value) { return U.esc(value); }
  function attr(value) { return U.attr(value); }
  function icon(name, extra) { return U.icon(name, extra); }

  function stallLabel(status) {
    return U.statusBadge(status || 'unknown');
  }

  var PAYMENT_METHODS = [
    { label: 'Cash on Delivery', key: '', icon: 'truck' },
    { label: 'GCash', key: 'gcash', icon: 'credit-card' },
    { label: 'Maya', key: 'maya', icon: 'credit-card' },
    { label: 'Bank Transfer (BDO)', key: 'bdo', icon: 'credit-card' },
    { label: 'Bank Transfer (BPI)', key: 'bpi', icon: 'credit-card' }
  ];

  function paymentAccounts() {
    return (state.meta && state.meta.paymentAccounts) || {};
  }

  function paymentLinkFor(method) {
    var entry = PAYMENT_METHODS.find(function (item) { return item.label === method; });
    var links = state.meta && state.meta.paymentLinks ? state.meta.paymentLinks : {};
    var url = entry && entry.key ? (links[entry.key] || '') : '';
    if (!url && entry && entry.key === 'bdo') url = links.bank || 'https://www.bdo.com.ph/';
    if (!url && entry && entry.key === 'gcash') url = 'https://www.gcash.com/';
    if (!url && entry && entry.key === 'maya') url = 'https://www.maya.ph/';
    if (!url && entry && entry.key === 'bpi') url = 'https://www.bpi.com.ph/';
    return typeof url === 'string' && /^https:\/\//i.test(url) ? url : '';
  }

  function destinationDetails(method) {
    var accounts = paymentAccounts();
    var entry = PAYMENT_METHODS.find(function (item) { return item.label === method; });
    if (!entry || !entry.key) return '';
    if (entry.key === 'gcash' && accounts.gcash) return 'Send to GCash <strong>' + esc(accounts.gcash) + '</strong>.';
    if (entry.key === 'maya' && accounts.maya) return 'Send to Maya <strong>' + esc(accounts.maya) + '</strong>.';
    if (entry.key === 'bdo') {
      var parts = [];
      if (accounts.bdoName) parts.push('Account name: <strong>' + esc(accounts.bdoName) + '</strong>');
      if (accounts.bdo) parts.push('BDO account: <strong>' + esc(accounts.bdo) + '</strong>');
      return parts.join('. ') + (parts.length ? '.' : '');
    }
    if (entry.key === 'bpi') {
      var parts2 = [];
      if (accounts.bpiName) parts2.push('Account name: <strong>' + esc(accounts.bpiName) + '</strong>');
      if (accounts.bpi) parts2.push('BPI account: <strong>' + esc(accounts.bpi) + '</strong>');
      return parts2.join('. ') + (parts2.length ? '.' : '');
    }
    return '';
  }

  function paymentHintMarkup(method) {
    var link = paymentLinkFor(method);
    if (method === 'Cash on Delivery') {
      return '<div class="notice info mt-2">' + icon('truck', 'sm') + ' <strong>Cash on Delivery.</strong> Pay the rider when your order arrives. Orders stay unpaid until the stall confirms receipt.</div>';
    }
    var dest = destinationDetails(method);
    var destHtml = dest ? ' ' + dest : ' Destination account details are set by the market administrator.';
    var open = link
      ? ' <a class="btn ghost sm" href="' + attr(link) + '" target="_blank" rel="noopener noreferrer">Open official ' + esc(method) + ' site</a>'
      : '';
    return '<div class="notice info mt-2">' + icon('credit-card', 'sm') + ' <strong>' + esc(method) + '.</strong>'
      + destHtml
      + ' Use your <strong>order code</strong> as the payment reference. Payment stays <strong>Pending</strong> until an authorized staff member confirms it.'
      + open + '</div>';
  }

  function orderPaymentNotice(order) {
    var method = order.paymentMethod || 'Cash on Delivery';
    var link = paymentLinkFor(method);
    if (method === 'Cash on Delivery') {
      return '<div class="notice info mt-2">' + icon('truck', 'sm') + ' <strong>Cash on Delivery.</strong> Pay the rider when your order arrives.</div>';
    }
    if (link) {
      return '<div class="notice info mt-2">' + icon('credit-card', 'sm') + ' <strong>' + esc(method) + ' payment.</strong> Complete payment on the official page using <strong>' + esc(order.code) + '</strong> as the reference.'
        + '<div class="btn-row mt-2"><a class="btn secondary sm" href="' + attr(link) + '" target="_blank" rel="noopener noreferrer">' + icon('external') + 'Continue to ' + esc(method) + '</a></div></div>';
    }
    return '<div class="notice wa mt-2">' + icon('info', 'sm') + ' <strong>Online payment is not configured.</strong> The stall will contact you with payment instructions for this order.</div>';
  }

  function customerLabel(name) {
    var text = String(name || '');
    return /^SW-\d{4}-/i.test(text) ? 'Verified customer' : text || 'Customer';
  }

  function ratingLine(rating, count) {
    if (!rating) return '<span class="p-rating">' + icon('star', 'sm') + ' New arrival</span>';
    return '<span class="p-rating"><span class="star">★</span>' + Number(rating).toFixed(1)
      + (count ? ' <span class="muted">(' + Number(count) + ')</span>' : '') + '</span>';
  }

  function productCard(product) {
    var image = product.images && product.images[0] ? product.images[0] : '';
    var badges = '';
    if (product.discountPct > 0) badges += '<span class="badge er">−' + Number(product.discountPct) + '%</span>';
    if (product.featured) badges += '<span class="badge accent">Featured</span>';
    return '<a class="product-card" href="#product/' + Number(product.id) + '">'
      + '<div class="p-img"><img src="' + attr(image) + '" alt="' + attr(product.name) + '" loading="lazy">'
      + (badges ? '<div class="p-badges">' + badges + '</div>' : '')
      + (product.inStock ? '' : '<span class="p-oos">Out of stock</span>')
      + '</div>'
      + '<div class="p-body">'
      + '<span class="p-stall">' + esc(product.stallName || '') + '</span>'
      + '<h3>' + esc(product.name) + '</h3>'
      + '<div class="p-foot"><span class="price p-price">' + U.money(product.finalPriceCents)
      + (product.discountPct > 0 ? '<s>' + U.money(product.priceCents) + '</s>' : '') + '</span>'
      + ratingLine(product.rating, product.reviewCount) + '</div>'
      + '</div></a>';
  }

  function stallCard(stall) {
    var image = stall.coverImage || stall.profileImage || '';
    return '<a class="stall-card" href="#stall/' + Number(stall.id) + '">'
      + '<div class="stall-cover"><img src="' + attr(image) + '" alt="' + attr(stall.name) + ' stall cover" loading="lazy">'
      + '<div class="sc-top"><span class="chip">' + esc(stall.category || 'Stall') + '</span>' + stallLabel(stall.operatingStatus) + '</div>'
      + '<div class="sc-bottom"><span>' + (stall.location || '') + '</span></div>'
      + '</div>'
      + '<div class="stall-body"><h3>' + esc(stall.name) + '</h3>'
      + '<div class="rating-line">' + (stall.rating ? U.stars(stall.rating) + '<span>' + Number(stall.rating).toFixed(1) + ' (' + Number(stall.reviewCount || 0) + ')</span>' : '<span>No reviews yet</span>') + '</div>'
      + '<p>' + esc(stall.description || '') + '</p>'
      + '<div class="stall-meta"><span>' + icon('package', 'sm') + Number(stall.productCount || 0) + ' products</span>'
      + '<span>' + icon('map-pin', 'sm') + esc(String(stall.location || '').replace('SkyWorld Stall · ', '')) + '</span></div>'
      + '</div></a>';
  }

  function reviewCard(review, showProduct) {
    return '<article class="review-card">'
      + '<div class="review-top">' + U.stars(review.rating)
      + '<span class="review-product">' + esc(review.productName || '') + '</span></div>'
      + '<blockquote>“' + esc(review.comment) + '”</blockquote>'
      + (review.ownerReply ? '<div class="owner-reply"><strong>Reply from the stall</strong>' + esc(review.ownerReply) + '</div>' : '')
      + '<div class="review-by"><span>' + esc(customerLabel(review.customerName)) + '</span><span>' + esc(review.localDate || U.dateOnly(review.createdAt)) + '</span></div>'
      + (showProduct ? '' : '')
      + '</article>';
  }

  function emptyBag(title, text) {
    return '<div class="store-page narrow"><div class="card">' + U.emptyState({
      icon: 'cart', title: title || 'Your cart is empty',
      text: text || 'Pick a stall, find something you love, and it will wait for you here.',
      action: '<a class="btn" href="#stalls">' + icon('store') + 'Browse the stalls</a>'
    }) + '</div></div>';
  }

  function pageHead(kicker, title, text, actions) {
    return '<div class="page-head"><span class="eyebrow">' + esc(kicker) + '</span><h1>' + esc(title) + '</h1>'
      + (text ? '<p>' + esc(text) + '</p>' : '') + (actions || '') + '</div>';
  }

  function loadMeta() {
    if (state.meta) return Promise.resolve(state.meta);
    return A.get('/api/meta').then(function (data) {
      state.meta = data;
      return data;
    }).catch(function () { return null; });
  }

  function freeShippingLine(eligibleCents, thresholdCents) {
    var meta = state.meta || {};
    var threshold = Number(thresholdCents || meta.freeShippingThresholdCents || 200000);
    if (!threshold) return '';
    var remaining = threshold - eligibleCents;
    if (eligibleCents <= 0) {
      return '<div class="ship-progress"><div class="sp-text">Free delivery on orders over <strong>' + U.money(threshold) + '</strong>.</div>'
        + '<div class="sp-track"><span style="width:0%"></span></div></div>';
    }
    if (remaining <= 0) {
      return '<div class="ship-progress"><div class="sp-text">' + icon('truck', 'sm') + ' <strong>Free delivery unlocked.</strong></div>'
        + '<div class="sp-track"><span style="width:100%"></span></div></div>';
    }
    var pct = Math.min(100, Math.round((eligibleCents / threshold) * 100));
    return '<div class="ship-progress"><div class="sp-text">Add <strong>' + U.money(remaining) + '</strong> more for free delivery.</div>'
      + '<div class="sp-track"><span style="width:' + pct + '%"></span></div></div>';
  }

  function quotePayload() {
    return {
      stallId: state.cart.stallId,
      voucherCode: state.cart.voucher || '',
      items: state.cart.lines.map(function (line) {
        return { productId: line.productId, color: line.color, size: line.size, qty: line.qty };
      })
    };
  }

  function requestQuote() {
    if (!state.cart.lines.length) return Promise.resolve(null);
    return A.post('/api/store/quote', quotePayload()).then(function (data) { return data.quote; });
  }

  function routeParts() {
    var raw = location.hash.replace(/^#/, '') || 'home';
    var parts = raw.split('/');
    return { name: parts[0] || 'home', id: parts[1] || '' };
  }

  function setActiveNav(routeName) {
    var map = {
      home: '#home',
      stalls: '#stalls',
      stall: '#stalls',
      cart: '#cart',
      orders: '#orders',
      inbox: '#inbox',
      reviews: '#reviews',
      track: '#track',
      feedback: '#feedback'
    };
    var active = map[routeName] || '';
    U.$$('.header-links a, .store-mobile-nav a').forEach(function (link) {
      link.classList.toggle('on', link.getAttribute('href') === active);
      if (active && link.getAttribute('href') === active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  function fmtDate(iso) { return U.dateTime(iso); }

  function smsNotice(status, detail) {
    var tone = 'info';
    var label = 'SMS update';
    if (status === 'sent') { tone = 'ok'; }
    else if (status === 'failed') { tone = 'er'; }
    else { tone = 'wa'; }
    var text = detail || (status === 'sent'
      ? 'The confirmation text was accepted by the configured provider.'
      : 'No SMS was sent. Messages require a configured SMS provider on this server.');
    return '<div class="notice ' + tone + ' mt-2"><strong>' + label + ':</strong> ' + esc(text) + '</div>';
  }

  function orderTotals(order, options) {
    var opts = options || {};
    var rows = '<div class="sum-row"><span>Subtotal</span><span class="v">' + U.money(order.subtotalCents) + '</span></div>';
    if (Number(order.productDiscountCents) > 0) rows += '<div class="sum-row discount"><span>Product discounts</span><span class="v">−' + U.money(order.productDiscountCents) + '</span></div>';
    if (Number(order.voucherDiscountCents) > 0) rows += '<div class="sum-row discount"><span>Voucher' + (order.voucherCode ? ' (' + esc(order.voucherCode) + ')' : '') + '</span><span class="v">−' + U.money(order.voucherDiscountCents) + '</span></div>';
    rows += '<div class="sum-row"><span>Delivery</span><span class="v">' + (Number(order.shippingCents) === 0 ? 'Free' : U.money(order.shippingCents)) + '</span></div>';
    rows += '<div class="sum-row total"><span>Total</span><span class="v">' + U.money(order.totalCents) + '</span></div>';
    if (opts.paymentMethod) rows += '<div class="payment-note mt-1">' + icon('credit-card', 'sm') + ' ' + esc(order.paymentMethod || opts.paymentMethod) + '</div>';
    return rows;
  }

  function orderItems(order) {
    return '<div class="order-items">' + order.items.map(function (item) {
      var bits = [];
      if (item.color) bits.push(item.color);
      if (item.size) bits.push('Size ' + item.size);
      bits.push('×' + item.qty);
      return '<div class="order-item">'
        + '<img src="' + attr(item.image || '') + '" alt="" loading="lazy">'
        + '<div><div class="oi-name">' + esc(item.name) + '</div><div class="oi-var">' + esc(bits.join(' · ')) + '</div></div>'
        + '<span class="oi-price">' + U.money(item.lineTotalCents) + '</span></div>';
    }).join('') + '</div>';
  }

  /* ---------------- views ---------------- */

  function homeMarkup(stalls, featured, reviews) {
    var collage = [stalls[1] || stalls[0], stalls[4] || stalls[0], stalls[7] || stalls[0]].filter(Boolean);
    var categories = [];
    stalls.forEach(function (stall) {
      if (stall.category && categories.indexOf(stall.category) === -1) categories.push(stall.category);
    });
    var rated = stalls.filter(function (s) { return s.rating; });
    var average = rated.length ? rated.reduce(function (sum, s) { return sum + Number(s.rating); }, 0) / rated.length : 0;

    return '<div class="store-page">'
      + '<section class="store-hero">'
      + '<div class="hero-copy"><span class="eyebrow">' + esc((state.meta && state.meta.siteName) || 'SkyWorld Stall') + ' · Baguio</span>'
      + '<h1>Eleven stalls. <em>One warm corner</em> of the city.</h1>'
      + '<p>Wander small, independent shops for clothes, shoes, bags and the little things that make a place feel like home. Order online for delivery; the stall confirms timing with you.</p>'
      + '<form class="store-search" id="heroSearch" role="search">'
      + '<div class="search-field">' + icon('search') + '<input type="search" name="q" id="heroSearchInput" placeholder="Search stalls by name or category" aria-label="Search stalls"></div>'
      + '<button class="btn" type="submit">Search</button></form>'
      + '<div class="hero-actions"><a class="btn lg" href="#stalls">' + icon('store') + 'Browse all stalls</a>'
      + '<a class="btn ghost lg" href="#track">' + icon('package') + 'Track an order</a></div>'
      + '<div class="hero-meta"><span>' + icon('map-pin') + 'Level 1 &amp; 2, Baguio</span>'
      + '<span>' + icon('shield') + 'Guest checkout, no account needed</span>'
      + (average ? '<span>' + icon('star') + Number(average).toFixed(1) + ' average stall rating</span>' : '') + '</div>'
      + '</div>'
      + '<div class="hero-collage">'
      + (collage[0] ? '<div class="hero-photo one"><img src="' + attr(collage[0].coverImage) + '" alt="' + attr(collage[0].name) + '"></div>' : '')
      + (collage[1] ? '<div class="hero-photo two"><img src="' + attr(collage[1].coverImage) + '" alt="' + attr(collage[1].name) + '"></div>' : '')
      + (collage[2] ? '<div class="hero-photo three"><img src="' + attr(collage[2].coverImage) + '" alt="' + attr(collage[2].name) + '"></div>' : '')
      + '<div class="hero-stamp"><span class="star">★</span> ' + esc(average ? Number(average).toFixed(1) + ' from local reviews' : 'Loved by locals') + '</div>'
      + '<div class="hero-tag">' + icon('store') + '11 independent stalls</div>'
      + '</div></section>'

      + '<section class="store-section"><div class="section-head"><div><h2>Shop by mood</h2><p class="section-sub">Follow a category, or simply browse all ten stalls.</p></div></div>'
      + '<div class="category-strip">' + categories.map(function (category) {
        return '<button type="button" data-home-cat="' + attr(category) + '">' + esc(category) + '</button>';
      }).join('') + '</div>'
      + '<div class="stall-grid all">' + stalls.map(stallCard).join('') + '</div>'
      + '</section>'

      + '<section class="store-section"><div class="section-head"><div><h2>Made for your everyday</h2><p class="section-sub">Featured pieces from across the market. Prices are in Philippine pesos.</p></div>'
      + '<a class="btn ghost" href="#stalls">See every stall' + icon('chevron-right') + '</a></div>'
      + (featured.length ? '<div class="product-grid">' + featured.map(productCard).join('') + '</div>' : U.emptyState({ title: 'The shelves are being dressed', text: 'Featured items will appear here soon.' }))
      + '</section>'

      + '<section class="store-section"><div class="section-head"><div><h2>Notes from the market</h2><p class="section-sub">Demonstration reviews from seeded sample orders. Seeded reviewers are shown as verified customers.</p></div></div>'
      + (reviews.length ? '<div class="review-strip">' + reviews.map(function (review) { return reviewCard(review); }).join('') + '</div>' : U.emptyState({ title: 'No reviews yet', text: 'Be the first to review a delivered order.' }))
      + '</section>'

      + '<section class="store-section"><div class="section-head"><div><h2>How ordering works</h2><p class="section-sub">Each order is fulfilled by one stall, so your cart stays with one maker at a time.</p></div></div>'
      + '<div class="review-strip">'
      + '<article class="review-card"><span class="chip plain">Step 1</span><h3>Find your stall</h3><p class="small">Browse all ten stalls and pick colours and sizes. The photo follows your colour choice.</p></article>'
      + '<article class="review-card"><span class="chip plain">Step 2</span><h3>Check out as a guest</h3><p class="small">No account needed to buy. Keep your order code and the email you used to track it later.</p></article>'
      + '<article class="review-card"><span class="chip plain">Step 3</span><h3>Follow it home</h3><p class="small">Status moves from placed to delivered. SMS updates appear only when this server has a real SMS provider configured.</p></article>'
      + '</div></section>'
      + '</div>';
  }

  async function renderHome(token) {
    app.innerHTML = '<div class="loading-block"><span class="spinner"></span>Opening the market…</div>';
    var results = await Promise.all([
      A.get('/api/store/stalls'),
      A.get('/api/store/products?featured=1&limit=8'),
      A.get('/api/store/reviews?limit=6'),
      loadMeta()
    ]);
    if (token !== state.token) return;
    state.stalls = results[0].stalls || [];
    app.innerHTML = homeMarkup(state.stalls, results[1].products || [], results[2].reviews || []);
    var search = document.getElementById('heroSearch');
    if (search) {
      search.addEventListener('submit', function (event) {
        event.preventDefault();
        state.filters.q = document.getElementById('heroSearchInput').value.trim();
        state.filters.category = 'All';
        if (location.hash === '#stalls') render();
        else location.hash = '#stalls';
      });
    }
    U.$$('[data-home-cat]').forEach(function (button) {
      button.addEventListener('click', function () {
        state.filters.q = '';
        state.filters.category = button.dataset.homeCat;
        location.hash = '#stalls';
      });
    });
  }

  function filteredStalls(stalls) {
    var q = state.filters.q.toLowerCase();
    var category = state.filters.category;
    return stalls.filter(function (stall) {
      if (category && category !== 'All' && stall.category !== category) return false;
      if (!q) return true;
      var haystack = [stall.name, stall.category, stall.description, stall.location].join(' ').toLowerCase();
      return haystack.indexOf(q) !== -1;
    });
  }

  async function renderStalls(token) {
    app.innerHTML = '<div class="loading-block"><span class="spinner"></span>Gathering the stalls…</div>';
    var data = await A.get('/api/store/stalls');
    if (token !== state.token) return;
    state.stalls = data.stalls || [];
    var categories = [];
    state.stalls.forEach(function (stall) {
      if (stall.category && categories.indexOf(stall.category) === -1) categories.push(stall.category);
    });
    app.innerHTML = '<div class="store-page">'
      + pageHead('All stalls', 'Eleven independent finds', 'Every stall is run by its own owner. Browse the catalogue, then check out with one stall at a time.')
      + '<div class="filters-row"><div class="search-field">' + icon('search')
      + '<input type="search" id="stallSearch" placeholder="Search by name, category or location" aria-label="Search stalls" value="' + attr(state.filters.q) + '"></div>'
      + '<span class="result-count" id="stallCount"></span></div>'
      + '<div class="category-strip" id="stallCats">'
      + '<button type="button" data-cat="All" class="' + (state.filters.category === 'All' ? 'on' : '') + '">All stalls</button>'
      + categories.map(function (category) {
        return '<button type="button" data-cat="' + attr(category) + '" class="' + (state.filters.category === category ? 'on' : '') + '">' + esc(category) + '</button>';
      }).join('')
      + '</div><div id="stallResults"></div></div>';

    function draw() {
      var rows = filteredStalls(state.stalls);
      var count = document.getElementById('stallCount');
      if (count) count.textContent = rows.length + (rows.length === 1 ? ' stall' : ' stalls');
      var box = document.getElementById('stallResults');
      if (!box) return;
      if (!rows.length) {
        box.innerHTML = U.emptyState({
          icon: 'search', title: 'No stalls match that search',
          text: 'Try another name or category — all ten stalls are listed under “All stalls”.',
          action: '<button type="button" class="btn secondary" data-clear-filters>Clear filters</button>'
        });
        var clear = box.querySelector('[data-clear-filters]');
        if (clear) clear.addEventListener('click', function () {
          state.filters.q = '';
          state.filters.category = 'All';
          var input = document.getElementById('stallSearch');
          if (input) input.value = '';
          U.$$('#stallCats [data-cat]').forEach(function (chip) { chip.classList.toggle('on', chip.dataset.cat === 'All'); });
          draw();
        });
        return;
      }
      box.innerHTML = '<div class="stall-grid all">' + rows.map(stallCard).join('') + '</div>';
    }

    var search = document.getElementById('stallSearch');
    if (search) {
      var onSearch = U.debounce(function () {
        state.filters.q = search.value.trim();
        draw();
      }, 180);
      search.addEventListener('input', onSearch);
    }
    U.$$('#stallCats [data-cat]').forEach(function (button) {
      button.addEventListener('click', function () {
        state.filters.category = button.dataset.cat;
        U.$$('#stallCats [data-cat]').forEach(function (chip) { chip.classList.toggle('on', chip === button); });
        draw();
      });
    });
    draw();
  }

  async function renderStall(token, id) {
    app.innerHTML = '<div class="loading-block"><span class="spinner"></span>Opening the stall…</div>';
    var data;
    try {
      data = await A.get('/api/store/stalls/' + Number(id));
    } catch (error) {
      if (token !== state.token) return;
      app.innerHTML = '<div class="store-page">' + U.errorBlock(error) + '<p class="center mt-2"><a class="btn ghost" href="#stalls">Back to all stalls</a></p></div>';
      return;
    }
    if (token !== state.token) return;
    var stall = data.stall;
    var products = data.products || [];
    var reviews = data.reviews || [];
    var open = stall.operatingStatus === 'open';
    state.stallTitle = stall.name;
    app.innerHTML = '<div class="store-page">'
      + '<a class="back-link" href="#stalls">' + icon('arrow-left') + 'All stalls</a>'
      + '<section class="store-banner">'
      + '<img src="' + attr(stall.coverImage || '') + '" alt="' + attr(stall.name) + ' banner">'
      + '<div class="banner-inner"><div class="banner-crest"><img src="' + attr(stall.profileImage || stall.coverImage || '') + '" alt=""></div>'
      + '<div class="banner-copy"><div class="b-kicker"><span class="chip">' + esc(stall.category) + '</span>' + stallLabel(stall.operatingStatus) + '</div>'
      + '<h1>' + esc(stall.name) + '</h1><p>' + esc(stall.description) + '</p>'
      + '<div class="banner-facts"><span>' + icon('map-pin', 'sm') + esc(stall.location) + '</span>'
      + '<span>' + icon('package', 'sm') + products.length + ' products</span>'
      + (stall.rating ? '<span>' + U.stars(stall.rating) + ' ' + Number(stall.rating).toFixed(1) + ' (' + Number(stall.reviewCount || 0) + ')</span>' : '<span>No reviews yet</span>')
      + '</div></div></div></section>'
      + (open ? '' : '<div class="notice wa mb-3">This stall is currently ' + esc(String(stall.operatingStatus || '').replace(/_/g, ' ')) + '. You can browse the catalogue, but online orders are paused until it reopens.</div>')
      + '<div class="catalog-head"><h2>The collection</h2><span class="catalog-count">' + products.length + ' items</span></div>'
      + (products.length ? '<div class="product-grid">' + products.map(productCard).join('') + '</div>'
        : U.emptyState({ icon: 'package', title: 'Nothing on the shelves yet', text: 'This stall has not published any products yet.' }))
      + '<div class="stall-info-grid">'
      + '<section class="card"><div class="card-title"><h3>Customer reviews</h3><span class="catalog-count">' + reviews.length + ' shown</span></div>'
      + (reviews.length ? '<div class="reviews-list">' + reviews.map(function (review) { return reviewCard(review); }).join('') + '</div>'
        : U.emptyState({ icon: 'star', title: 'No published reviews yet', text: 'Reviews appear after a delivered order is reviewed.' }))
      + '</section>'
      + '<aside class="panel"><h3>Good to know</h3><div class="stack mt-2 small">'
      + '<div class="buy-extra">' + icon('map-pin') + '<span>' + esc(stall.location) + '</span></div>'
      + '<div class="buy-extra">' + icon('truck') + '<span>Delivery is arranged after checkout. Orders over ' + U.money((state.meta && state.meta.freeShippingThresholdCents) || 200000) + ' ship free.</span></div>'
      + '<div class="buy-extra">' + icon('credit-card') + '<span>Pay on delivery, by GCash, Maya or bank transfer — the stall confirms the details.</span></div>'
      + '<div class="buy-extra">' + icon('message') + '<span>Questions? Use <a href="#feedback">market feedback</a> and mention the stall name.</span></div>'
      + '</div><a class="btn secondary block mt-3" href="#stalls">' + icon('arrow-left') + 'Back to all stalls</a></aside>'
      + '</div></div>';
  }

  async function renderProduct(token, id) {
    app.innerHTML = '<div class="loading-block"><span class="spinner"></span>Checking the tag…</div>';
    var data;
    try {
      data = await A.get('/api/store/products/' + Number(id));
    } catch (error) {
      if (token !== state.token) return;
      app.innerHTML = '<div class="store-page">' + U.errorBlock(error) + '<p class="center mt-2"><a class="btn ghost" href="#stalls">Back to the market</a></p></div>';
      return;
    }
    if (token !== state.token) return;
    var product = data.product;
    var stall = data.stall;
    var reviews = data.reviews || [];
    state.productTitle = product.name;
    var images = (product.images || []).slice();
    (product.colors || []).forEach(function (color) { if (color.image && images.indexOf(color.image) === -1) images.push(color.image); });
    if (!images.length) images.push('');
    var colors = product.colors || [];
    var sizes = product.sizes || [];
    var selectedColor = colors.length ? colors[0] : null;
    var selectedSize = '';
    var selectedImage = selectedColor && selectedColor.image ? selectedColor.image : images[0];
    var qty = 1;
    var canBuy = product.inStock && stall.operatingStatus === 'open' && product.stock > 0;

    var relatedPromise = A.get('/api/store/stalls/' + Number(stall.id)).then(function (stallData) {
      return (stallData.products || []).filter(function (item) { return item.id !== product.id; }).slice(0, 4);
    }).catch(function () { return []; });

    app.innerHTML = '<div class="store-page">'
      + '<a class="back-link" href="#stall/' + Number(stall.id) + '">' + icon('arrow-left') + esc(stall.name) + '</a>'
      + '<div class="product-layout">'
      + '<div class="gallery"><div class="gallery-main"><img id="galleryMain" src="' + attr(selectedImage) + '" alt="' + attr(product.name) + '">'
      + (product.discountPct > 0 ? '<span class="badge er gallery-tag">−' + Number(product.discountPct) + '%</span>' : '')
      + (!canBuy ? '<span class="p-oos">' + (stall.operatingStatus !== 'open' ? 'Stall ' + esc(String(stall.operatingStatus).replace(/_/g, ' ')) : 'Out of stock') + '</span>' : '')
      + '</div><div class="gallery-thumbs" id="galleryThumbs">' + images.map(function (image, index) {
        return '<button type="button" data-img="' + attr(image) + '" aria-label="View image ' + (index + 1) + '" class="' + (image === selectedImage ? 'on' : '') + '"><img src="' + attr(image) + '" alt=""></button>';
      }).join('') + '</div></div>'
      + '<div class="buy-panel">'
      + '<div class="buy-stall">' + icon('store', 'sm') + ' <a href="#stall/' + Number(stall.id) + '">' + esc(stall.name) + '</a></div>'
      + '<h1>' + esc(product.name) + '</h1>'
      + '<div class="buy-rating">' + ratingLine(product.rating, product.reviewCount) + (reviews.length ? '<span class="muted tiny">' + reviews.length + ' published review' + (reviews.length === 1 ? '' : 's') + '</span>' : '<span class="muted tiny">No reviews yet</span>') + '</div>'
      + '<div class="buy-price"><span class="price">' + U.money(product.finalPriceCents) + '</span>'
      + (product.discountPct > 0 ? '<s class="muted">' + U.money(product.priceCents) + '</s><span class="save">Save ' + Number(product.discountPct) + '%</span>' : '')
      + '</div>'
      + '<p class="buy-desc">' + esc(product.description) + '</p>'
      + (stall.operatingStatus !== 'open' ? '<div class="notice wa">' + esc(stall.name) + ' is ' + esc(String(stall.operatingStatus).replace(/_/g, ' ')) + ', so online orders are paused.</div>' : '')
      + (colors.length ? '<div class="variant-group"><div class="variant-label"><span>Colour</span><span class="selected-value" id="colorValue">' + esc(selectedColor ? selectedColor.name : '') + '</span></div>'
        + '<div class="swatches" role="group" aria-label="Choose a colour">' + colors.map(function (color) {
          return '<button type="button" class="swatch ' + (selectedColor && color.name === selectedColor.name ? 'on' : '') + '" data-color="' + attr(color.name) + '" aria-label="' + attr(color.name) + '" aria-pressed="' + (selectedColor && color.name === selectedColor.name ? 'true' : 'false') + '"><span class="dot" style="background:' + attr(color.hex || '#B79A76') + '"></span></button>';
        }).join('') + '</div></div>' : '')
      + (sizes.length ? '<div class="variant-group"><div class="variant-label"><span>Size</span><span class="selected-value" id="sizeValue">Choose a size</span></div>'
        + '<div class="size-options" role="group" aria-label="Choose a size">' + sizes.map(function (size) {
          return '<button type="button" data-size="' + attr(size) + '" aria-pressed="false">' + esc(size) + '</button>';
        }).join('') + '</div></div>' : '')
      + '<div class="qty-row"><div class="qty-stepper"><button type="button" id="qtyMinus" aria-label="Decrease quantity" disabled>' + icon('minus') + '</button>'
      + '<input id="qtyValue" type="text" value="1" readonly aria-label="Quantity">'
      + '<button type="button" id="qtyPlus" aria-label="Increase quantity">' + icon('plus') + '</button></div>'
      + '<span class="stock-note ' + (product.stock <= 5 ? 'low' : '') + '">' + (product.stock <= 0 ? 'Out of stock' : product.stock <= 5 ? 'Only ' + product.stock + ' left' : 'In stock · ' + product.stock + ' available') + '</span></div>'
      + '<div class="buy-actions"><button type="button" class="btn lg" id="addToBag"' + (canBuy ? '' : ' disabled') + '>' + icon('cart') + (canBuy ? 'Add to cart' : 'Currently unavailable') + '</button>'
      + '<a class="btn ghost lg" href="#cart" id="viewBag"' + (cartCount() ? '' : ' hidden') + '>View cart</a></div>'
      + '<div class="err-text" id="variantHint" role="status"></div>'
      + '<div class="buy-extras">'
      + '<div class="buy-extra">' + icon('truck') + '<span>Delivery is arranged with the stall after checkout.</span></div>'
      + '<div class="buy-extra">' + icon('message') + '<span>Need to change something? Use order lookup with your code and email.</span></div>'
      + '<div class="buy-extra">' + icon('shield') + '<span>Colour, size and price are recorded exactly on your order.</span></div>'
      + '</div>'
      + '<div class="sku-line">SKU ' + esc(product.sku || '—') + ' · ' + esc(product.category) + '</div>'
      + '</div></div>'
      + '<section class="store-section mt-3"><div class="section-head"><div><h2>What customers say</h2><p class="section-sub">Published reviews for this product.</p></div></div>'
      + (reviews.length ? '<div class="review-strip">' + reviews.map(function (review) { return reviewCard(review); }).join('') + '</div>'
        : U.emptyState({ icon: 'star', title: 'No reviews yet', text: 'Reviews open after a delivered order.' }))
      + '</section>'
      + '<section class="store-section" id="relatedWrap"></section>'
      + '</div>';

    function paint() {
      var main = document.getElementById('galleryMain');
      if (main) main.src = selectedImage;
      var thumbs = document.getElementById('galleryThumbs');
      if (thumbs) U.$$('button', thumbs).forEach(function (button) { button.classList.toggle('on', button.dataset.img === selectedImage); });
      var colorValue = document.getElementById('colorValue');
      if (colorValue) colorValue.textContent = selectedColor ? selectedColor.name : '';
      U.$$('.swatch').forEach(function (button) {
        var on = Boolean(selectedColor && button.dataset.color === selectedColor.name);
        button.classList.toggle('on', on);
        button.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      var sizeValue = document.getElementById('sizeValue');
      if (sizeValue) sizeValue.textContent = selectedSize || 'Choose a size';
      U.$$('.size-options [data-size]').forEach(function (button) {
        var on = button.dataset.size === selectedSize;
        button.classList.toggle('on', on);
        button.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      var qtyValue = document.getElementById('qtyValue');
      if (qtyValue) qtyValue.value = String(qty);
      var minus = document.getElementById('qtyMinus');
      if (minus) minus.disabled = qty <= 1;
      var plus = document.getElementById('qtyPlus');
      if (plus) plus.disabled = qty >= Math.min(20, Math.max(1, product.stock));
    }

    U.$$('.swatch').forEach(function (button) {
      button.addEventListener('click', function () {
        selectedColor = colors.find(function (color) { return color.name === button.dataset.color; }) || selectedColor;
        selectedImage = selectedColor && selectedColor.image ? selectedColor.image : selectedImage;
        paint();
      });
    });
    U.$$('.size-options [data-size]').forEach(function (button) {
      button.addEventListener('click', function () {
        selectedSize = button.dataset.size;
        paint();
      });
    });
    U.$$('#galleryThumbs button').forEach(function (button) {
      button.addEventListener('click', function () {
        selectedImage = button.dataset.img;
        var matching = colors.find(function (color) { return color.image === selectedImage; });
        if (matching) selectedColor = matching;
        paint();
      });
    });
    var qtyMinus = document.getElementById('qtyMinus');
    var qtyPlus = document.getElementById('qtyPlus');
    if (qtyMinus) qtyMinus.addEventListener('click', function () { if (qty > 1) { qty -= 1; paint(); } });
    if (qtyPlus) qtyPlus.addEventListener('click', function () { if (qty < Math.min(20, product.stock)) { qty += 1; paint(); } });
    var add = document.getElementById('addToBag');
    if (add) {
      add.addEventListener('click', async function () {
        var hint = document.getElementById('variantHint');
        if (hint) hint.textContent = '';
        if (!canBuy) return;
        if (colors.length && !selectedColor) {
          if (hint) hint.textContent = 'Choose a colour to continue.';
          U.toast('Choose a colour to continue.', 'wa');
          return;
        }
        if (sizes.length && !selectedSize) {
          if (hint) hint.textContent = 'Choose a size to continue.';
          U.toast('Choose a size to continue.', 'wa');
          return;
        }
        var added = await addToCart(product, {
          color: selectedColor, size: selectedSize, qty: qty,
          image: selectedColor && selectedColor.image ? selectedColor.image : selectedImage
        });
        if (added) {
          var viewBag = document.getElementById('viewBag');
          if (viewBag) viewBag.hidden = false;
        }
      });
    }

    var related = await relatedPromise;
    if (token !== state.token) return;
    var relatedWrap = document.getElementById('relatedWrap');
    if (relatedWrap && related.length) {
      relatedWrap.innerHTML = '<div class="section-head"><div><h2>More from ' + esc(stall.name) + '</h2></div>'
        + '<a class="btn ghost" href="#stall/' + Number(stall.id) + '">Visit the stall' + icon('chevron-right') + '</a></div>'
        + '<div class="product-grid">' + related.map(productCard).join('') + '</div>';
    }
  }

  async function renderCart(token) {
    if (!state.cart.lines.length) {
      app.innerHTML = emptyBag();
      return;
    }
    var quote = null;
    var quoteError = null;
    try {
      quote = await requestQuote();
    } catch (error) {
      quoteError = error;
    }
    if (token !== state.token) return;
    var lines = state.cart.lines.map(function (line) {
      var qLine = quote && quote.lines.find(function (ql) {
        return Number(ql.productId) === line.productId && (ql.color || '') === line.color && (ql.size || '') === line.size;
      });
      return { cart: line, quote: qLine || null };
    });
    var stallName = (quote && quote.stall && quote.stall.name) || state.cart.stallName;
    var eligible = quote ? quote.subtotalCents - quote.productDiscountCents : 0;

    var summaryRows = '';
    if (quote) {
      summaryRows = '<div class="sum-row"><span>Subtotal</span><span class="v">' + U.money(quote.subtotalCents) + '</span></div>'
        + (quote.productDiscountCents > 0 ? '<div class="sum-row discount"><span>Product discounts</span><span class="v">−' + U.money(quote.productDiscountCents) + '</span></div>' : '')
        + (quote.voucherDiscountCents > 0 ? '<div class="sum-row discount"><span>Voucher</span><span class="v">−' + U.money(quote.voucherDiscountCents) + '</span></div>' : '')
        + '<div class="sum-row"><span>Delivery</span><span class="v">' + (quote.shippingCents === 0 ? 'Free' : U.money(quote.shippingCents)) + '</span></div>'
        + '<div class="sum-row total"><span>Total</span><span class="v">' + U.money(quote.totalCents) + '</span></div>';
    } else {
      summaryRows = '<div class="sum-row"><span>Items</span><span class="v">' + cartCount() + '</span></div>'
        + '<div class="sum-row total"><span>Total</span><span class="v">Calculated next</span></div>';
    }

    app.innerHTML = '<div class="store-page">'
      + '<a class="back-link" href="#stall/' + Number(state.cart.stallId) + '">' + icon('arrow-left') + 'Keep shopping at ' + esc(stallName) + '</a>'
      + pageHead('Your cart', 'A little collection from ' + stallName, 'One stall per order keeps delivery and updates simple. Your cart is saved on this device.')
      + '<div class="checkout-steps" aria-label="Checkout progress">'
      + '<span class="checkout-step on">Cart</span><span class="checkout-step-line"></span>'
      + '<span class="checkout-step">Details &amp; payment</span><span class="checkout-step-line"></span>'
      + '<span class="checkout-step">Confirmation</span></div>'
      + (quoteError ? '<div class="notice er mb-3"><strong>Your cart needs attention.</strong> ' + esc(quoteError.message) + '</div>' : '')
      + '<div class="cart-layout"><div><div class="cart-lines">'
      + lines.map(function (entry) {
        var line = entry.cart;
        var unit = entry.quote ? entry.quote.unitCents : line.unitCents;
        var bits = [];
        if (line.color) bits.push('<span><span class="color-dot" style="background:' + attr(line.colorHex || '#B79A76') + '"></span> ' + esc(line.color) + '</span>');
        if (line.size) bits.push('<span>Size ' + esc(line.size) + '</span>');
        return '<div class="cart-line" data-key="' + attr(lineKey(line.productId, line.color, line.size)) + '">'
          + '<div class="line-img"><img src="' + attr(line.image) + '" alt="' + attr(line.name) + '"></div>'
          + '<div><div class="line-title"><a href="#product/' + line.productId + '">' + esc(line.name) + '</a></div>'
          + '<div class="line-var">' + bits.join('') + '</div>'
          + '<div class="line-controls"><div class="qty-stepper sm">'
          + '<button type="button" data-dec aria-label="Decrease quantity of ' + attr(line.name) + '"' + (line.qty <= 1 ? ' disabled' : '') + '>' + icon('minus') + '</button>'
          + '<input type="text" value="' + line.qty + '" readonly aria-label="Quantity of ' + attr(line.name) + '">'
          + '<button type="button" data-inc aria-label="Increase quantity of ' + attr(line.name) + '"' + (line.qty >= Math.min(20, line.stock || 20) ? ' disabled' : '') + '>' + icon('plus') + '</button>'
          + '</div><button type="button" class="line-remove" data-remove>' + icon('trash', 'sm') + 'Remove</button></div></div>'
          + '<div class="line-price"><span class="price">' + U.money(unit * line.qty) + '</span><span class="unit">' + U.money(unit) + ' each</span></div>'
          + '</div>';
      }).join('')
      + '</div><p class="tiny muted mt-2">' + icon('info', 'sm') + ' Stock and prices are rechecked with the stall before payment.</p></div>'
      + '<aside class="side-card summary-card"><h3>Order summary</h3>'
      + summaryRows
      + '<div class="voucher-form"><input type="text" id="voucherInput" placeholder="Voucher code" aria-label="Voucher code" value="' + attr(state.cart.voucher) + '" maxlength="40">'
      + '<button type="button" class="btn secondary" id="voucherApply">Apply</button></div>'
      + (state.cart.voucher ? '<div class="voucher-chip"><span>' + icon('tag', 'sm') + ' ' + esc(state.cart.voucher) + (quote && quote.voucher ? ' applied' : ' set') + '</span><button type="button" id="voucherRemove">Remove</button></div>' : '')
      + (quote ? freeShippingLine(eligible, quote.freeShippingThresholdCents) : '')
      + (quoteError ? '<p class="tiny er mt-2">Fix the items above to see a complete total.</p>' : '')
      + '<div class="cart-foot">'
      + (quote ? '<a class="btn lg" href="#checkout">' + icon('lock') + 'Continue to checkout</a>'
        : '<button class="btn lg" type="button" disabled>' + icon('lock') + 'Checkout unavailable</button>')
      + '<a class="btn ghost" href="#stalls">Continue shopping</a>'
      + '<p class="payment-note">No card details are collected. Payment is arranged with the stall.</p></div>'
      + '</aside></div></div>';

    U.$$('.cart-line').forEach(function (row) {
      var key = row.dataset.key;
      function findLine() {
        return state.cart.lines.find(function (line) { return lineKey(line.productId, line.color, line.size) === key; });
      }
      var dec = row.querySelector('[data-dec]');
      var inc = row.querySelector('[data-inc]');
      var remove = row.querySelector('[data-remove]');
      if (dec) dec.addEventListener('click', function () {
        var line = findLine();
        if (!line || line.qty <= 1) return;
        line.qty -= 1;
        saveCart();
        render();
      });
      if (inc) inc.addEventListener('click', function () {
        var line = findLine();
        if (!line) return;
        var max = Math.min(20, Math.max(1, line.stock || 20));
        if (line.qty >= max) {
          U.toast('That is all the stock the stall has for this item.', 'wa');
          return;
        }
        line.qty += 1;
        saveCart();
        render();
      });
      if (remove) remove.addEventListener('click', function () {
        state.cart.lines = state.cart.lines.filter(function (line) { return lineKey(line.productId, line.color, line.size) !== key; });
        if (!state.cart.lines.length) { state.cart.stallId = null; state.cart.stallName = ''; state.cart.voucher = ''; }
        saveCart();
        U.toast('Removed from your cart.', 'ok');
        render();
      });
    });
    var voucherApply = document.getElementById('voucherApply');
    if (voucherApply) voucherApply.addEventListener('click', applyVoucher);
    var voucherInput = document.getElementById('voucherInput');
    if (voucherInput) voucherInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); applyVoucher(); }
    });
    var voucherRemove = document.getElementById('voucherRemove');
    if (voucherRemove) voucherRemove.addEventListener('click', function () {
      state.cart.voucher = '';
      saveCart();
      U.toast('Voucher removed.', 'ok');
      render();
    });

    function applyVoucher() {
      var input = document.getElementById('voucherInput');
      if (!input) return;
      var code = input.value.trim().toUpperCase();
      if (!code) {
        if (state.cart.voucher) {
          state.cart.voucher = '';
          saveCart();
          render();
          return;
        }
        U.toast('Enter a voucher code first.', 'wa');
        return;
      }
      var button = document.getElementById('voucherApply');
      U.setBusy(button, true, 'Checking…');
      var payload = quotePayload();
      payload.voucherCode = code;
      A.post('/api/store/quote', payload).then(function (result) {
        state.cart.voucher = code;
        saveCart();
        U.toast(result.quote.voucherDiscountCents > 0 ? 'Voucher applied.' : 'Voucher applied.', 'ok');
        render();
      }).catch(function (error) {
        U.setBusy(button, false);
        U.toast(error.message || 'That voucher could not be applied.', 'er');
        if (input) input.focus();
      });
    }
  }

  function cartSignature() {
    return JSON.stringify({
      stallId: state.cart.stallId,
      voucher: state.cart.voucher,
      lines: state.cart.lines.map(function (line) {
        return [line.productId, line.color, line.size, line.qty];
      })
    });
  }

  function checkoutKeyForCart() {
    var signature = cartSignature();
    try {
      var saved = JSON.parse(sessionStorage.getItem(CHECKOUT_KEY) || 'null');
      if (saved && saved.signature === signature && saved.key) return saved.key;
    } catch (_) {}
    var key = (window.crypto && typeof window.crypto.randomUUID === 'function')
      ? window.crypto.randomUUID()
      : 'checkout-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    try { sessionStorage.setItem(CHECKOUT_KEY, JSON.stringify({ signature: signature, key: key })); } catch (_) {}
    return key;
  }

  async function renderCheckout(token) {
    if (!state.cart.lines.length) {
      app.innerHTML = emptyBag('Nothing to check out', 'Your cart is empty. Add something from a stall first.');
      return;
    }
    await loadMeta();
    var quote;
    try {
      quote = await requestQuote();
    } catch (error) {
      if (token !== state.token) return;
      app.innerHTML = '<div class="store-page narrow">' + pageHead('Checkout', 'Let’s fix your cart first', 'The stall could not confirm this order yet.')
        + '<div class="card"><div class="notice er">' + esc(error.message) + '</div><div class="btn-row mt-3"><a class="btn" href="#cart">' + icon('arrow-left') + 'Back to your cart</a><a class="btn ghost" href="#stalls">Browse stalls</a></div></div></div>';
      return;
    }
    if (token !== state.token) return;
    var eligible = quote.subtotalCents - quote.productDiscountCents;
    var key = checkoutKeyForCart();

    app.innerHTML = '<div class="store-page">'
      + '<a class="back-link" href="#cart">' + icon('arrow-left') + 'Back to your cart</a>'
      + pageHead('Checkout', 'Where should it go?', 'You are checking out with ' + quote.stall.name + '. No account is needed — keep your order code to track it.')
      + '<div class="checkout-steps" aria-label="Checkout progress">'
      + '<span class="checkout-step done">Cart</span><span class="checkout-step-line"></span>'
      + '<span class="checkout-step on">Details &amp; payment</span><span class="checkout-step-line"></span>'
      + '<span class="checkout-step">Confirmation</span></div>'
      + '<form id="checkoutForm" novalidate><div class="checkout-layout"><div class="card">'
      + '<div class="form-section"><h3>' + icon('user') + 'Contact details</h3>'
      + (state.delivery && state.delivery.name ? '<p class="hint" style="margin-top:0">Saved details from your last order are filled in. Edit them if anything changed.</p>' : '')
      + '<div class="form-grid">'
      + '<div class="field"><label for="coName">Full name</label><input type="text" id="coName" name="name" autocomplete="name" required maxlength="80" value="' + attr(state.delivery.name || '') + '"></div>'
      + '<div class="field"><label for="coPhone">Mobile number</label><input type="tel" id="coPhone" name="phone" autocomplete="tel" placeholder="0917 123 4567" required value="' + attr(state.delivery.phone || '') + '"></div>'
      + '<div class="field span-2"><label for="coEmail">Email address</label><input type="email" id="coEmail" name="email" autocomplete="email" required placeholder="you@example.com" value="' + attr(state.delivery.email || '') + '">'
      + '<div class="hint">Your order lookup uses this email and your order code. Details are saved on this device for next time.</div></div></div></div>'
      + '<div class="form-section"><h3>' + icon('map-pin') + 'Delivery address</h3><div class="form-grid">'
      + '<div class="field span-2"><label for="coAddress">Street address</label><textarea id="coAddress" name="address" autocomplete="street-address" required maxlength="220" placeholder="House or unit, street, barangay">' + esc(state.delivery.address || '') + '</textarea></div>'
      + '<div class="field"><label for="coCity">City or municipality</label><input type="text" id="coCity" name="city" autocomplete="address-level2" required maxlength="80" value="' + attr(state.delivery.city || '') + '"></div>'
      + '<div class="field"><label for="coNotes">Notes for the stall <span class="muted">(optional)</span></label><input type="text" id="coNotes" name="notes" maxlength="500" placeholder="Landmark, gate code, delivery timing" value="' + attr(state.delivery.notes || '') + '"></div>'
      + '</div></div>'
      + '<div class="form-section"><h3>' + icon('credit-card') + 'Payment</h3><div class="pay-grid">'
      + PAYMENT_METHODS.map(function (method, index) {
        var ready = method.key && paymentLinkFor(method.label);
        return '<label class="pay-option"><input type="radio" name="paymentMethod" value="' + attr(method.label) + '"' + (index === 0 ? ' checked' : '') + '>'
          + icon(method.icon) + esc(method.label)
          + (ready ? '<span class="pay-ready" title="Payment page link configured">' + icon('check-circle', 'sm') + '</span>' : '')
          + '</label>';
      }).join('')
      + '</div><div id="paymentHint">' + paymentHintMarkup('Cash on Delivery') + '</div>'
      + '<label class="checkline mt-2"><input type="checkbox" name="ack" required> I understand the payment terms for this order.</label>'
      + '</div>'
      + '<div class="btn-row"><button class="btn ghost" type="button" id="backToBag">' + icon('arrow-left') + 'Back to cart</button></div>'
      + '</div>'
      + '<aside class="side-card summary-card"><h3>Your order</h3><span class="tiny muted">From ' + esc(quote.stall.name) + '</span>'
      + '<div class="order-mini">' + quote.lines.map(function (line) {
        var bits = [];
        if (line.color) bits.push(line.color);
        if (line.size) bits.push('Size ' + line.size);
        bits.push('×' + line.qty);
        return '<div class="order-mini-line"><img src="' + attr(line.image) + '" alt=""><div><div class="om-name">' + esc(line.name) + '</div><div class="om-var">' + esc(bits.join(' · ')) + '</div></div><span class="om-price">' + U.money(line.lineTotalCents) + '</span></div>';
      }).join('') + '</div>'
      + '<div class="sum-row"><span>Subtotal</span><span class="v">' + U.money(quote.subtotalCents) + '</span></div>'
      + (quote.productDiscountCents > 0 ? '<div class="sum-row discount"><span>Product discounts</span><span class="v">−' + U.money(quote.productDiscountCents) + '</span></div>' : '')
      + (quote.voucherDiscountCents > 0 ? '<div class="sum-row discount"><span>Voucher ' + esc(quote.voucher ? quote.voucher.code : '') + '</span><span class="v">−' + U.money(quote.voucherDiscountCents) + '</span></div>' : '')
      + '<div class="sum-row"><span>Delivery</span><span class="v">' + (quote.shippingCents === 0 ? 'Free' : U.money(quote.shippingCents)) + '</span></div>'
      + '<div class="sum-row total"><span>Total</span><span class="v">' + U.money(quote.totalCents) + '</span></div>'
      + freeShippingLine(eligible, quote.freeShippingThresholdCents)
      + '<div class="cart-foot"><button class="btn lg" type="submit" id="placeOrder">' + icon('lock') + 'Place order · ' + U.money(quote.totalCents) + '</button>'
      + '<a class="btn ghost" href="#cart">Edit cart &amp; voucher</a>'
      + '<p class="payment-note">Order requests are limited to prevent accidental duplicates.</p></div>'
      + '</aside></div></form></div>';

    document.getElementById('backToBag').addEventListener('click', function () { location.hash = '#cart'; });
    var form = document.getElementById('checkoutForm');
    U.$$('input[name="paymentMethod"]', form).forEach(function (radio) {
      radio.addEventListener('change', function () {
        var hint = document.getElementById('paymentHint');
        if (hint) hint.innerHTML = paymentHintMarkup(radio.value);
      });
    });
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      U.clearFormError(form);
      U.clearFieldErrors(form);
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      var button = document.getElementById('placeOrder');
      U.setBusy(button, true, 'Placing your order…');
      var values = U.formObject(form);
      var payload = {
        stallId: state.cart.stallId,
        idempotencyKey: key,
        voucherCode: state.cart.voucher || '',
        paymentMethod: values.paymentMethod,
        items: state.cart.lines.map(function (line) {
          return { productId: line.productId, color: line.color, size: line.size, qty: line.qty };
        }),
        customer: {
          name: values.name,
          email: values.email,
          phone: values.phone,
          address: values.address,
          city: values.city,
          notes: values.notes || ''
        }
      };
      try {
        var result = await A.post('/api/store/checkout', payload);
        state.thanks = result;
        state.thanksStallName = state.cart.stallName;
        state.lastCode = result.order.code;
        saveDelivery({
          name: values.name,
          email: values.email,
          phone: values.phone,
          address: values.address,
          city: values.city,
          notes: values.notes || ''
        });
        rememberOrder(result.order, state.cart.stallName);
        try {
          localStorage.setItem(LAST_KEY, state.lastCode);
          sessionStorage.removeItem(CHECKOUT_KEY);
        } catch (_) {}
        state.cart = { stallId: null, stallName: '', lines: [], voucher: '' };
        saveCart();
        state.reviewed = {};
        location.hash = '#thanks';
      } catch (error) {
        U.setBusy(button, false);
        U.applyApiError(form, error);
        U.toast(error.message || 'The order could not be placed.', 'er');
      }
    });
  }

  function thanksMarkup() {
    var result = state.thanks;
    if (!result) {
      return '<div class="store-page narrow"><div class="card success-card"><div class="check-orb">' + icon('check') + '</div>'
        + '<h1>Your order is with the stall</h1><p>Pull up the details with your order code' + (state.lastCode ? ' <strong>' + esc(state.lastCode) + '</strong>' : '') + ' and the email you used at checkout.</p>'
        + '<div class="btn-row mt-3 center" style="justify-content:center"><a class="btn" href="#track">' + icon('package') + 'Track this order</a><a class="btn ghost" href="#stalls">Keep browsing</a></div></div></div>';
    }
    var order = result.order;
    var method = order.paymentMethod || 'Cash on Delivery';
    var payLink = paymentLinkFor(method);
    var nextPayment = payLink
      ? 'Complete payment on the ' + esc(method) + ' page using order ' + esc(order.code) + ' as the reference.'
      : method === 'Cash on Delivery'
        ? 'Prepare cash for the rider when your order arrives.'
        : 'Wait for the stall to send ' + esc(method) + ' payment instructions.';
    return '<div class="store-page narrow">'
      + '<div class="confirmation-head"><div class="check-orb">' + icon('check') + '</div>'
      + '<h1>' + (result.duplicate ? 'This order was already recorded' : 'Order placed, ' + esc(String(order.customerName || '').split(/\s+/)[0] || 'friend')) + '</h1>'
      + '<p>' + (result.duplicate ? 'We matched your retry to the same order, so nothing was placed twice.' : 'The stall has received your order. Keep the code below — you can track it any time with your email.') + '</p></div>'
      + '<div class="confirm-grid"><div class="order-card">'
      + '<div class="order-card-head"><div><h2>Order ' + esc(order.code) + '</h2><span class="order-code">' + esc(fmtDate(order.createdAt)) + ' · ' + esc(state.thanksStallName || '') + '</span></div>'
      + U.statusBadge(order.status) + '</div>'
      + U.orderTimeline(order.status)
      + orderItems(order)
      + orderTotals(order, { paymentMethod: order.paymentMethod })
      + orderPaymentNotice(order)
      + '<div class="order-meta"><span>' + icon('truck', 'sm') + esc(order.address + ', ' + order.city) + '</span></div>'
      + '<div class="review-cta-row"><a class="btn" href="#track" id="thanksTrack">' + icon('package') + 'Track this order</a><a class="btn ghost" href="#stalls">Keep browsing</a></div>'
      + '</div>'
      + '<aside class="side-card"><h3>Order code</h3>'
      + '<p class="small">Tracking only needs your order code and the email you used at checkout.</p>'
      + '<button type="button" class="btn secondary block mt-3" id="copyCode">' + icon('clipboard') + 'Copy order code</button>'
      + '</aside></div></div>';
  }

  function renderThanks() {
    app.innerHTML = thanksMarkup();
    var track = document.getElementById('thanksTrack');
    if (track) track.addEventListener('click', function () { state.prefillCode = state.lastCode; });
    var copy = document.getElementById('copyCode');
    if (copy) copy.addEventListener('click', async function () {
      try {
        await navigator.clipboard.writeText(state.lastCode || '');
        U.toast('Order code copied.', 'ok');
      } catch (_) {
        U.toast('Could not copy automatically. Select the code in your confirmation.', 'wa');
      }
    });
  }

  function trackResultMarkup() {
    var data = state.track;
    if (!data) return '';
    var order = data.order;
    var stall = data.stall || {};
    var canReview = order.status === 'delivered';
    return '<div class="order-card">'
      + '<div class="order-card-head"><div><h2>Order ' + esc(order.code) + '</h2><span class="order-code">' + esc(fmtDate(order.createdAt)) + (stall.name ? ' · ' + esc(stall.name) : '') + '</span></div>'
      + '<div class="row">' + U.statusBadge(order.status) + U.sampleBadge(order.isSample) + '</div></div>'
      + U.orderTimeline(order.status)
      + '<div class="order-meta mt-2"><span>' + icon('user', 'sm') + esc(order.customerName) + '</span><span>' + icon('credit-card', 'sm') + esc(order.paymentMethod) + '</span><span>' + icon('map-pin', 'sm') + esc(order.address + ', ' + order.city) + '</span></div>'
      + orderItems(order)
      + orderTotals(order, { paymentMethod: order.paymentMethod })
      + orderPaymentNotice(order)
      + smsNotice(order.smsStatus, order.smsDetail)
      + (canReview ? '<div class="notice info mt-2">' + icon('star', 'sm') + ' Your order was delivered. You can review each item below.</div>'
        + '<div class="review-cta-row">' + order.items.map(function (item) {
          var done = state.reviewed[order.id + ':' + item.productId];
          return '<button type="button" class="btn sm ' + (done ? 'ghost' : 'secondary') + '" data-review-product="' + item.productId + '"' + (done ? ' disabled' : '') + '>'
            + icon(done ? 'check' : 'star') + esc(done ? 'Reviewed ' + item.name : 'Review ' + item.name) + '</button>';
        }).join('') + '</div>'
        : '<div class="notice mt-2">Reviews unlock after delivery. This order is currently ' + esc(U.titleCase(order.status)) + '.</div>')
      + '<div class="divider"></div>'
      + '<div class="row between"><button type="button" class="btn ghost sm" id="newLookup">' + icon('refresh') + 'Check another order</button>'
      + '<span class="tiny muted">Order code ' + esc(order.code) + '</span></div>'
      + '</div>';
  }

  function wireTrackReviews(container, data) {
    U.$$('[data-review-product]', container).forEach(function (button) {
      button.addEventListener('click', function () {
        openReviewModal(Number(button.dataset.reviewProduct), data, button);
      });
    });
    var newLookup = document.getElementById('newLookup');
    if (newLookup) newLookup.addEventListener('click', function () {
      state.track = null;
      render();
    });
  }

  function openReviewModal(productId, data, sourceButton) {
    var order = data.order;
    var item = order.items.find(function (entry) { return Number(entry.productId) === productId; });
    if (!item) return;
    var content = '<form id="reviewForm" class="review-form" novalidate>'
      + '<div class="notice info mb-2">Reviewing <strong>' + esc(item.name) + '</strong> from order ' + esc(order.code) + '.</div>'
      + '<div class="field"><span class="label">Your rating</span><div class="stars-input" role="radiogroup" aria-label="Rating from 1 to 5">'
      + [1, 2, 3, 4, 5].map(function (star) {
        return '<label><input type="radio" name="rating" value="' + star + '"' + (star === 5 ? ' checked' : '') + ' aria-label="' + star + ' star' + (star === 1 ? '' : 's') + '"><span class="star-glyph" data-star="' + star + '">★</span></label>';
      }).join('') + '</div></div>'
      + '<div class="field"><label for="reviewComment">Your review</label><textarea id="reviewComment" name="comment" maxlength="1000" required placeholder="What did you like? How did it fit?"></textarea>'
      + '<div class="hint">Reviews are checked by a moderation filter before appearing. Reviews with blocked words are held for the team.</div></div>'
      + '<div class="field"><label for="reviewPhoto">Product photo <span class="muted">(optional)</span></label>'
      + '<input type="file" id="reviewPhoto" name="photo" accept="image/*">'
      + '<div class="hint">Add a photo of your order if you want to show how it looked.</div></div>'
      + '<div class="err-text" data-field-error></div><div class="form-error notice er"></div></form>';
    var modal = U.openModal({
      title: 'Write a review',
      subtitle: 'Delivered orders only · moderated',
      content: content,
      actions: [
        { label: 'Cancel', className: 'ghost' },
        {
          label: 'Submit review', className: '', busyLabel: 'Sending…', close: false,
          onClick: async function ({ close, showError }) {
            var form = modal.overlay.querySelector('#reviewForm');
            U.clearFieldErrors(form);
            U.clearFormError(form);
            var rating = form.querySelector('input[name="rating"]:checked');
            var comment = form.querySelector('#reviewComment').value.trim();
            if (!rating || !comment) {
              if (!comment) U.showFieldError(form.querySelector('#reviewComment'), 'Write a short review before submitting.');
              else showError('Choose a rating.');
              return false;
            }
            try {
              var result = await A.post('/api/store/reviews', {
                orderCode: order.code,
                email: order.customerEmail,
                productId: productId,
                rating: Number(rating.value),
                comment: comment
              });
              state.reviewed[order.id + ':' + productId] = true;
              close();
              U.toast(result.message || 'Thank you. Your review was received.', 'ok');
              if (sourceButton) {
                sourceButton.disabled = true;
                sourceButton.className = 'btn sm ghost';
                sourceButton.innerHTML = icon('check') + 'Reviewed ' + esc(item.name);
              }
              return true;
            } catch (error) {
              showError(error.message || 'The review could not be submitted.');
              return false;
            }
          }
        }
      ]
    });
    var form = modal.overlay.querySelector('#reviewForm');
    function paintStars() {
      var checked = form.querySelector('input[name="rating"]:checked');
      var value = checked ? Number(checked.value) : 0;
      U.$$('.star-glyph', form).forEach(function (glyph) {
        glyph.classList.toggle('filled', Number(glyph.dataset.star) <= value);
      });
    }
    U.$$('input[name="rating"]', form).forEach(function (input) { input.addEventListener('change', paintStars); });
    paintStars();
  }

  async function renderTrack() {
    await loadMeta();
    var code = state.prefillCode || (state.track ? state.track.order.code : state.lastCode);
    app.innerHTML = '<div class="store-page">'
      + pageHead('Order lookup', 'Follow your order', 'Enter the order code and the email or mobile number you used at checkout.')
      + '<div class="track-layout"><aside class="side-card"><h3>Find an order</h3>'
      + '<form id="trackForm"><div class="field"><label for="trackCode">Order code</label><input type="text" id="trackCode" name="code" value="' + attr(code || '') + '" placeholder="SW-2026-00336" required autocomplete="off"></div>'
      + '<div class="field"><label for="trackEmail">Email used at checkout</label><input type="email" id="trackEmail" name="email" placeholder="you@example.com" autocomplete="email"><div class="hint">Use either email or mobile — not both.</div></div>'
      + '<div class="field"><label for="trackPhone">Mobile number <span class="muted">(alternative)</span></label><input type="tel" id="trackPhone" name="phone" placeholder="0917 123 4567" autocomplete="tel"></div>'
      + '<button class="btn block mt-2" type="submit" id="trackSubmit">' + icon('search') + 'Find my order</button></form>'
      + '<div class="notice info mt-3">For privacy, each order needs both the code and a matching contact detail.</div>'
      + '<div class="divider"></div><a class="text-link" href="#feedback">' + icon('message', 'sm') + 'Need help with an order?</a></aside>'
      + '<div class="track-result" id="trackResult">' + trackResultMarkup() + '</div></div></div>';

    var form = document.getElementById('trackForm');
    var resultBox = document.getElementById('trackResult');
    if (state.track) wireTrackReviews(resultBox, state.track);
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      U.clearFormError(form);
      U.clearFieldErrors(form);
      var values = U.formObject(form);
      if (!values.code || (!values.email && !values.phone)) {
        U.formError(form, 'Enter your order code and either the email or mobile number used at checkout.');
        return;
      }
      var button = document.getElementById('trackSubmit');
      U.setBusy(button, true, 'Looking…');
      try {
        var data = await A.post('/api/store/orders/lookup', { code: values.code, email: values.email, phone: values.phone });
        state.track = data;
        state.prefillCode = '';
        resultBox.innerHTML = trackResultMarkup();
        wireTrackReviews(resultBox, data);
        var card = resultBox.querySelector('.order-card');
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (error) {
        U.applyApiError(form, error);
      } finally {
        U.setBusy(button, false);
      }
    });
  }

  function renderFeedback() {
    app.innerHTML = '<div class="store-page">'
      + pageHead('Feedback', 'Tell us what you think', 'Questions about an order, a stall, or the website? Send a note to the market team.')
      + '<div class="feedback-layout"><aside class="feedback-aside"><span class="eyebrow">The market office</span><h2>We read every note.</h2>'
      + '<p>Feedback goes to the platform team, not directly to the stall owner. For order-specific questions, include your order code.</p>'
      + '<div class="fa-list"><span>' + icon('clock') + 'Replies are sent to the contact you provide.</span>'
      + '<span>' + icon('shield') + 'Never send passwords, one-time codes or card numbers.</span>'
      + '<span>' + icon('message') + 'For urgent delivery issues, contact the stall using the details on your order receipt.</span></div>'
      + '<div class="fa-deco">' + icon('message') + '</div></aside>'
      + '<div class="card"><form id="feedbackForm" novalidate><div class="form-grid">'
      + '<div class="field"><label for="fbName">Your name</label><input type="text" id="fbName" name="name" required maxlength="80" autocomplete="name"></div>'
      + '<div class="field"><label for="fbContact">Email or mobile</label><input type="text" id="fbContact" name="contact" required maxlength="120" autocomplete="email"></div>'
      + '<div class="field span-2"><label for="fbSubject">Subject</label><input type="text" id="fbSubject" name="subject" required maxlength="120" placeholder="For example: Delivery question about SW-2026-00336"></div>'
      + '<div class="field span-2"><label for="fbMessage">Message</label><textarea id="fbMessage" name="message" required maxlength="2000" placeholder="Tell us what happened and what would help."></textarea></div>'
      + '</div><div class="btn-row mt-2"><button type="submit" class="btn" id="feedbackSubmit">' + icon('message') + 'Send feedback</button>'
      + '<span class="tiny muted">Please do not include passwords or card details.</span></div></form></div></div></div>';

    var form = document.getElementById('feedbackForm');
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      U.clearFormError(form);
      U.clearFieldErrors(form);
      if (!form.checkValidity()) { form.reportValidity(); return; }
      var button = document.getElementById('feedbackSubmit');
      U.setBusy(button, true, 'Sending…');
      try {
        var values = U.formObject(form);
        await A.post('/api/store/feedback', values);
        app.innerHTML = '<div class="store-page narrow"><div class="card success-card"><div class="check-orb">' + icon('check') + '</div>'
          + '<h1>Message received</h1><p class="center">Thank you, ' + esc(String(values.name).split(/\s+/)[0]) + '. The market team has your note and will reply to the contact you provided.</p>'
          + '<div class="btn-row center mt-3" style="justify-content:center"><a class="btn" href="#stalls">Browse the stalls</a><a class="btn ghost" href="#home">Back to home</a></div></div></div>';
      } catch (error) {
        U.setBusy(button, false);
        U.applyApiError(form, error);
      }
    });
  }

  function renderNotFound() {
    app.innerHTML = '<div class="store-page narrow"><div class="card">' + U.emptyState({
      icon: 'search', title: 'That page is not on the floor plan',
      text: 'The link may be old, or the stall may have moved. Try the market directory.',
      action: '<a class="btn" href="#stalls">Browse the stalls</a>'
    }) + '</div></div>';
  }

  async function addToCart(product, opts) {
    var colorName = opts.color ? opts.color.name : '';
    var colorHex = opts.color ? opts.color.hex : '';
    if (state.cart.stallId && Number(state.cart.stallId) !== Number(product.stallId)) {
      var replace = await U.confirmDialog({
        title: 'Start a new cart?',
        message: 'Your cart already has items from ' + (state.cart.stallName || 'another stall') + '. Each order must come from a single stall.',
        detail: 'You can keep browsing this item, or replace the current cart with this stall’s items.',
        confirmLabel: 'Start new cart',
        cancelLabel: 'Keep current cart'
      });
      if (!replace) return false;
      state.cart = { stallId: product.stallId, stallName: product.stallName, lines: [], voucher: '' };
    }
    state.cart.stallId = product.stallId;
    state.cart.stallName = product.stallName;
    var key = lineKey(product.id, colorName, opts.size);
    var existing = state.cart.lines.find(function (line) { return lineKey(line.productId, line.color, line.size) === key; });
    var max = Math.min(20, Math.max(1, product.stock));
    if (existing) {
      existing.qty = Math.min(max, existing.qty + opts.qty);
      existing.unitCents = product.finalPriceCents;
      existing.stock = product.stock;
      existing.image = opts.image || existing.image;
      existing.colorHex = colorHex || existing.colorHex;
    } else {
      state.cart.lines.push({
        productId: product.id,
        name: product.name,
        image: opts.image || '',
        color: colorName,
        colorHex: colorHex,
        size: opts.size || '',
        qty: Math.min(max, opts.qty),
        stock: product.stock,
        unitCents: product.finalPriceCents
      });
    }
    saveCart();
    U.toast(product.name + ' added to your cart.', 'ok', 'Added to cart');
    return true;
  }

  async function renderMyOrders() {
    state.myOrders = readMyOrders();
    app.innerHTML = '<div class="store-page">'
      + pageHead('My orders', 'Orders placed on this device', 'Guest checkout keeps your recent order codes here so you can track or review them later.')
      + (state.myOrders.length
        ? '<div class="stack" style="gap:12px">' + state.myOrders.map(function (entry) {
            return '<article class="card" style="padding:16px">'
              + '<div class="btn-row" style="justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">'
              + '<div><strong>' + esc(entry.code) + '</strong>'
              + (entry.stallName ? '<div class="muted small">' + esc(entry.stallName) + '</div>' : '')
              + '<div class="muted small">' + esc(U.dateTime(entry.placedAt) || entry.placedAt || '') + '</div></div>'
              + '<div class="btn-row">' + U.statusBadge(entry.status || 'pending')
              + (entry.totalCents ? '<span class="muted">' + U.money(entry.totalCents) + '</span>' : '') + '</div></div>'
              + (entry.items && entry.items.length
                ? '<div class="order-mini mt-2">' + entry.items.map(function (item) {
                    return '<div class="order-mini-line"><img src="' + attr(item.image || '') + '" alt=""><div><div class="om-name">' + esc(item.name) + '</div><div class="om-var">×' + Number(item.qty || 1) + '</div></div></div>';
                  }).join('') + '</div>'
                : '')
              + '<div class="btn-row mt-2"><a class="btn sm" href="#track" data-track-code="' + attr(entry.code) + '">' + icon('package', 'sm') + 'Track</a>'
              + '<a class="btn ghost sm" href="#reviews">' + icon('star', 'sm') + 'Reviews</a></div>'
              + '</article>';
          }).join('') + '</div>'
        : emptyBag('No orders yet', 'Place an order from a stall. Your order codes will appear here on this device.'))
      + '</div>';
    U.$$('[data-track-code]').forEach(function (link) {
      link.addEventListener('click', function () {
        state.prefillCode = link.getAttribute('data-track-code') || '';
      });
    });
  }

  async function renderInbox() {
    state.inbox = readInbox();
    app.innerHTML = '<div class="store-page">'
      + pageHead('Inbox', 'Order notifications', 'Updates about orders you placed on this device appear here.')
      + (state.inbox.length
        ? '<div class="stack" style="gap:10px">' + state.inbox.map(function (item) {
            return '<a class="card" href="' + attr(item.href || '#orders') + '" style="display:block;padding:14px;text-decoration:none;color:inherit">'
              + '<div class="btn-row" style="justify-content:space-between"><strong>' + esc(item.title) + '</strong>'
              + '<span class="muted small">' + esc(U.dateTime(item.at) || '') + '</span></div>'
              + '<p class="small" style="margin:6px 0 0">' + esc(item.message) + '</p>'
              + (item.code ? '<span class="muted small">Order ' + esc(item.code) + '</span>' : '')
              + '</a>';
          }).join('') + '</div>'
          + '<div class="btn-row mt-3"><button type="button" class="btn ghost sm" id="clearInbox">Clear inbox</button></div>'
        : emptyBag('Inbox is empty', 'When you place an order, a confirmation notice is saved here.'))
      + '</div>';
    var clearBtn = document.getElementById('clearInbox');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        state.inbox = [];
        saveInbox();
        renderInbox();
      });
    }
  }

  async function renderMyReviews() {
    state.myOrders = readMyOrders();
    var deliveredish = state.myOrders;
    app.innerHTML = '<div class="store-page">'
      + pageHead('Reviews', 'Rate products you ordered', 'Open a delivered order, then leave a rating, comment, and optional photo for each item.')
      + (deliveredish.length
        ? '<div class="stack" style="gap:12px">' + deliveredish.map(function (entry) {
            return '<article class="card" style="padding:16px">'
              + '<div class="btn-row" style="justify-content:space-between;flex-wrap:wrap;gap:8px"><div><strong>' + esc(entry.code) + '</strong>'
              + (entry.stallName ? '<div class="muted small">' + esc(entry.stallName) + '</div>' : '') + '</div>'
              + U.statusBadge(entry.status || 'pending') + '</div>'
              + (entry.items && entry.items.length
                ? '<div class="stack mt-2" style="gap:10px">' + entry.items.map(function (item) {
                    return '<div class="btn-row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">'
                      + '<div class="order-mini-line" style="flex:1"><img src="' + attr(item.image || '') + '" alt=""><div><div class="om-name">' + esc(item.name) + '</div></div></div>'
                      + '<button type="button" class="btn sm" data-review-open data-code="' + attr(entry.code) + '" data-email="' + attr(entry.email || '') + '" data-product="' + attr(item.productId) + '" data-name="' + attr(item.name) + '">'
                      + icon('star', 'sm') + 'Leave review</button></div>';
                  }).join('') + '</div>'
                : '<p class="muted small mt-2">No line items stored for this order. Track it to review after delivery.</p>')
              + '</article>';
          }).join('') + '</div>'
        : emptyBag('Nothing to review yet', 'Orders you place on this device will show here with a Leave review button.'))
      + '<p class="muted small mt-3">Reviews are moderated before they appear on the public storefront. You can also review from Track order after an order is delivered.</p>'
      + '</div>';
    U.$$('[data-review-open]').forEach(function (button) {
      button.addEventListener('click', function () {
        openStandaloneReviewModal({
          code: button.getAttribute('data-code'),
          email: button.getAttribute('data-email'),
          productId: Number(button.getAttribute('data-product')),
          productName: button.getAttribute('data-name')
        }, button);
      });
    });
  }

  function openStandaloneReviewModal(opts, sourceButton) {
    var content = '<form id="reviewForm" class="review-form" novalidate>'
      + '<div class="notice info mb-2">Reviewing <strong>' + esc(opts.productName || 'this product') + '</strong> from order ' + esc(opts.code) + '.</div>'
      + '<div class="field"><span class="label">Your rating</span><div class="stars-input" role="radiogroup" aria-label="Rating from 1 to 5">'
      + [1, 2, 3, 4, 5].map(function (star) {
        return '<label><input type="radio" name="rating" value="' + star + '"' + (star === 5 ? ' checked' : '') + ' aria-label="' + star + ' star' + (star === 1 ? '' : 's') + '"><span class="star-glyph" data-star="' + star + '">★</span></label>';
      }).join('') + '</div></div>'
      + '<div class="field"><label for="reviewComment">Your review</label><textarea id="reviewComment" name="comment" maxlength="1000" required placeholder="What did you like? How did it fit?"></textarea>'
      + '<div class="hint">Reviews are checked by a moderation filter before appearing.</div></div>'
      + '<div class="field"><label for="reviewPhoto">Product photo <span class="muted">(optional)</span></label>'
      + '<input type="file" id="reviewPhoto" name="photo" accept="image/*">'
      + '<div class="hint">Add a photo of your order if you want to show how it looked.</div></div>'
      + '<div class="err-text" data-field-error></div><div class="form-error notice er"></div></form>';
    var modal = U.openModal({
      title: 'Write a review',
      subtitle: 'Delivered orders only · moderated',
      content: content,
      actions: [
        { label: 'Cancel', className: 'ghost' },
        {
          label: 'Submit review', className: '', busyLabel: 'Sending…', close: false,
          onClick: async function ({ close, showError }) {
            var form = modal.overlay.querySelector('#reviewForm');
            U.clearFieldErrors(form);
            U.clearFormError(form);
            var rating = form.querySelector('input[name="rating"]:checked');
            var comment = form.querySelector('#reviewComment').value.trim();
            if (!rating || !comment) {
              if (!comment) U.showFieldError(form.querySelector('#reviewComment'), 'Write a short review before submitting.');
              else showError('Choose a rating.');
              return false;
            }
            if (!opts.email) {
              showError('Open Track order with this order code first so we can verify your email, then try again.');
              return false;
            }
            try {
              var result = await A.post('/api/store/reviews', {
                orderCode: opts.code,
                email: opts.email,
                productId: opts.productId,
                rating: Number(rating.value),
                comment: comment
              });
              close();
              U.toast(result.message || 'Thank you. Your review was received.', 'ok');
              if (sourceButton) {
                sourceButton.disabled = true;
                sourceButton.className = 'btn sm ghost';
                sourceButton.innerHTML = icon('check') + 'Reviewed';
              }
              pushInbox({
                title: 'Review submitted',
                message: 'Your review for ' + (opts.productName || 'a product') + ' was received.',
                href: '#reviews',
                code: opts.code
              });
              return true;
            } catch (error) {
              showError(error.message || 'The review could not be submitted.');
              return false;
            }
          }
        }
      ]
    });
    var form = modal.overlay.querySelector('#reviewForm');
    function paintStars() {
      var checked = form.querySelector('input[name="rating"]:checked');
      var value = checked ? Number(checked.value) : 0;
      U.$$('.star-glyph', form).forEach(function (glyph) {
        glyph.classList.toggle('filled', Number(glyph.dataset.star) <= value);
      });
    }
    U.$$('input[name="rating"]', form).forEach(function (input) { input.addEventListener('change', paintStars); });
    paintStars();
  }

  async function render() {
    var token = ++state.token;
    var route = routeParts();
    setActiveNav(route.name);
    var routeKey = location.hash || '#home';
    if (state.lastRoute !== routeKey) {
      state.lastRoute = routeKey;
      window.scrollTo(0, 0);
    }
    try {
      if (route.name === 'home') await renderHome(token);
      else if (route.name === 'stalls') await renderStalls(token);
      else if (route.name === 'stall' && route.id) await renderStall(token, route.id);
      else if (route.name === 'product' && route.id) await renderProduct(token, route.id);
      else if (route.name === 'cart') await renderCart(token);
      else if (route.name === 'checkout') await renderCheckout(token);
      else if (route.name === 'thanks') renderThanks();
      else if (route.name === 'track') renderTrack();
      else if (route.name === 'feedback') renderFeedback();
      else if (route.name === 'orders') await renderMyOrders();
      else if (route.name === 'inbox') await renderInbox();
      else if (route.name === 'reviews') await renderMyReviews();
      else renderNotFound();
      setDocumentTitle(route);
    } catch (error) {
      if (token !== state.token) return;
      app.innerHTML = '<div class="store-page">' + U.errorBlock(error) + '<p class="center mt-2"><a class="btn ghost" href="#home">Back to the market</a></p></div>';
    }
  }

  function setDocumentTitle(route) {
    var titles = {
      home: 'Shop the stalls', stalls: 'All stalls', cart: 'Your cart', checkout: 'Checkout',
      thanks: 'Order placed', track: 'Track an order', feedback: 'Feedback',
      orders: 'My orders', inbox: 'Inbox', reviews: 'Reviews'
    };
    var title = titles[route.name] || '';
    if (route.name === 'stall') title = state.stallTitle;
    if (route.name === 'product') title = state.productTitle;
    if (route.name === 'thanks' && state.thanks) title = 'Order ' + state.thanks.order.code;
    document.title = title ? title + ' · SkyWorld Stall' : 'SkyWorld Stall';
  }

  window.addEventListener('hashchange', render);

  document.getElementById('year').textContent = new Date().getFullYear();
  updateCartBadge();
  loadMeta();
  render();
})();
