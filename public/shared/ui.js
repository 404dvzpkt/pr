(function () {
  'use strict';

  function $(selector, root) { return (root || document).querySelector(selector); }
  function $$(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function attr(value) { return esc(value).replace(/\n/g, ' '); }

  function icon(name, extra) {
    return '<svg class="ic ' + (extra || '') + '" aria-hidden="true" focusable="false"><use href="/shared/icons.svg#i-' + name + '"></use></svg>';
  }

  function money(cents) {
    var value = Number(cents || 0) / 100;
    return '\u20B1' + value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function number(value) { return Number(value || 0).toLocaleString('en-PH'); }

  var dtf = new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit'
  });
  var df = new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric'
  });

  function dateTime(iso) {
    if (!iso) return '—';
    try { return dtf.format(new Date(iso)); } catch (_) { return '—'; }
  }
  function dateOnly(iso) {
    if (!iso) return '—';
    try {
      if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return df.format(new Date(iso + 'T00:00:00+08:00'));
      return df.format(new Date(iso));
    } catch (_) { return '—'; }
  }
  function timeOnly(iso) {
    if (!iso) return '—';
    try {
      return new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
    } catch (_) { return '—'; }
  }
  function todayLocal() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }
  function monthLocal() { return todayLocal().slice(0, 7); }
  function yearLocal() { return todayLocal().slice(0, 4); }

  function titleCase(value) {
    return String(value || '').replace(/_/g, ' ').replace(/\b\w/g, function (char) { return char.toUpperCase(); });
  }

  var STATUS_TONES = {
    pending: 'wa', confirmed: 'info', shipped: 'info', delivered: 'ok', cancelled: '', refunded: 'er',
    active: 'ok', deactivated: 'er', open: 'ok', closed: '', under_maintenance: 'wa', inactive: 'er',
    occupied: 'accent', available: 'ok', published: 'ok', flagged: 'wa', rejected: 'er',
    in_progress: 'wa', resolved: 'ok', reviewed: 'wa', new: 'info',
    unpaid: 'wa', paid: 'ok', urgent: 'er', high: 'wa', normal: 'info', low: '',
    admin: 'accent', operator: 'info', owner: '', pending_payment: 'wa', sent: 'ok', not_configured: 'wa', failed: 'er'
  };

  function statusBadge(status, label) {
    var tone = STATUS_TONES[String(status || '').toLowerCase()];
    if (tone === undefined) tone = '';
    return '<span class="badge ' + tone + '">' + esc(label || titleCase(status)) + '</span>';
  }

  function sampleBadge(isSample) { return ''; }

  function stars(rating) {
    var rounded = Math.round(Number(rating) || 0);
    var out = '<span class="stars" aria-label="' + attr(rating ? rating + ' out of 5 stars' : 'No rating yet') + '">';
    for (var i = 1; i <= 5; i += 1) out += '<span class="' + (i <= rounded ? '' : 'off') + '">\u2605</span>';
    return out + '</span>';
  }

  function themeButton(extraClass) {
    return '<button type="button" class="theme-toggle ' + (extraClass || '') + '" data-theme-toggle aria-label="Switch colour theme" title="Switch colour theme">'
      + '<svg class="ic ic-moon" aria-hidden="true"><use href="/shared/icons.svg#i-moon"></use></svg>'
      + '<svg class="ic ic-sun" aria-hidden="true"><use href="/shared/icons.svg#i-sun"></use></svg>'
      + '</button>';
  }

  function avatar(name, size) {
    var initials = String(name || '?').trim().split(/\s+/).slice(0, 2).map(function (part) { return part.charAt(0).toUpperCase(); }).join('') || '?';
    return '<span class="avatar ' + (size || 'md') + '" aria-hidden="true">' + esc(initials) + '</span>';
  }

  function toastHost() {
    var host = document.getElementById('toasts');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toasts';
      host.setAttribute('role', 'status');
      host.setAttribute('aria-live', 'polite');
      document.body.appendChild(host);
    }
    return host;
  }

  function toast(message, tone, title) {
    var host = toastHost();
    var node = document.createElement('div');
    node.className = 'toast ' + (tone || 'ok');
    var iconName = tone === 'er' ? 'alert-circle' : tone === 'wa' ? 'alert' : 'check-circle';
    node.innerHTML = '<span class="t-ic">' + icon(iconName) + '</span>'
      + '<span class="t-body">' + (title ? '<span class="t-title">' + esc(title) + '</span>' : '') + esc(message) + '</span>'
      + '<button type="button" aria-label="Dismiss">' + icon('x') + '</button>';
    host.appendChild(node);
    var timer = setTimeout(remove, tone === 'er' ? 7000 : 4500);
    function remove() {
      clearTimeout(timer);
      node.classList.add('leaving');
      setTimeout(function () { node.remove(); }, 260);
    }
    node.querySelector('button').addEventListener('click', remove);
  }

  var openOverlays = [];

  function openModal(config) {
    var overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', config.title || 'Dialog');
    var size = config.size || '';
    overlay.innerHTML = '<div class="modal ' + size + '">'
      + '<div class="modal-head"><div><h3>' + esc(config.title || '') + '</h3>'
      + (config.subtitle ? '<p>' + esc(config.subtitle) + '</p>' : '') + '</div>'
      + '<button type="button" class="modal-close" aria-label="Close">' + icon('x') + '</button></div>'
      + '<div class="modal-body"></div>'
      + (config.actions && config.actions.length ? '<div class="modal-foot"></div>' : '')
      + '</div>';
    var body = $('.modal-body', overlay);
    if (config.content instanceof Node) body.appendChild(config.content);
    else body.innerHTML = config.content || '';
    var previous = document.activeElement;
    var lastFocus = previous;

    function close() {
      if (!overlay.isConnected) return;
      overlay.remove();
      openOverlays = openOverlays.filter(function (entry) { return entry !== overlay; });
      document.body.classList.toggle('no-scroll', openOverlays.length > 0);
      if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (_) {} }
      if (typeof config.onClose === 'function') config.onClose();
    }

    overlay.addEventListener('mousedown', function (event) { if (event.target === overlay) close(); });
    $('.modal-close', overlay).addEventListener('click', close);

    function showError(message) {
      var box = $('.modal-error', overlay);
      if (!box) {
        box = document.createElement('div');
        box.className = 'modal-error';
        body.appendChild(box);
      }
      box.textContent = message;
      box.classList.add('show');
    }

    if (config.actions && config.actions.length) {
      var foot = $('.modal-foot', overlay);
      config.actions.forEach(function (action) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn ' + (action.className || 'secondary');
        button.innerHTML = (action.icon ? icon(action.icon) : '') + esc(action.label);
        button.addEventListener('click', async function () {
          if (!action.onClick) { close(); return; }
          var original = button.innerHTML;
          button.disabled = true;
          button.innerHTML = '<span class="spinner"></span>' + (action.busyLabel ? esc(action.busyLabel) : 'Working…');
          try {
            var result = await action.onClick({ close: close, showError: showError, overlay: overlay });
            if (result === false) {
              button.disabled = false;
              button.innerHTML = original;
              return;
            }
            if (action.close !== false) close();
          } catch (error) {
            showError(error && error.message ? error.message : 'Something went wrong.');
            button.disabled = false;
            button.innerHTML = original;
          }
        });
        foot.appendChild(button);
      });
    }

    document.body.appendChild(overlay);
    document.body.classList.add('no-scroll');
    openOverlays.push(overlay);
    setTimeout(function () {
      var focusTarget = $('[autofocus]', overlay) || $('input, select, textarea, button:not(.modal-close)', overlay);
      if (focusTarget) { try { focusTarget.focus(); } catch (_) {} }
    }, 30);

    overlay._close = close;
    overlay._showError = showError;
    return { overlay: overlay, close: close, showError: showError, body: body };
  }

  function confirmDialog(config) {
    return new Promise(function (resolve) {
      var result = false;
      var modal = openModal({
        title: config.title || 'Please confirm',
        subtitle: config.subtitle,
        size: config.wide ? 'wide' : 'narrow',
        content: '<p class="confirm-text">' + esc(config.message || '') + '</p>'
          + (config.detail ? '<div class="notice mt-2">' + config.detail + '</div>' : ''),
        actions: [
          { label: config.cancelLabel || 'Cancel', className: 'ghost', onClick: function () { resolve(false); } },
          {
            label: config.confirmLabel || 'Confirm',
            className: config.danger ? 'danger' : '',
            close: false,
            onClick: function ({ close }) { result = true; close(); }
          }
        ],
        onClose: function () { resolve(result); }
      });
      return modal;
    });
  }

  function formError(container, message) {
    var box = $('.form-error', container);
    if (!box) {
      box = document.createElement('div');
      box.className = 'form-error notice er';
      var form = container.tagName === 'FORM' ? container : $('form', container);
      if (form) form.prepend(box); else container.prepend(box);
    }
    box.textContent = message;
    box.style.display = 'block';
  }

  function clearFormError(container) {
    var box = $('.form-error', container);
    if (box) { box.textContent = ''; box.style.display = 'none'; }
  }

  function fieldWrapper(input) {
    return input.closest('.field') || input.parentElement;
  }

  function showFieldError(input, message) {
    if (!input) return;
    input.setAttribute('aria-invalid', 'true');
    var wrapper = fieldWrapper(input);
    if (!wrapper) return;
    var box = wrapper.querySelector('.err-text[data-field-error]');
    if (!box) {
      box = document.createElement('div');
      box.className = 'err-text';
      box.setAttribute('data-field-error', '');
      var pw = input.closest('.pw-wrap');
      (pw || input).insertAdjacentElement('afterend', box);
    }
    box.textContent = message;
  }

  function clearFieldErrors(container) {
    $$('[aria-invalid="true"]', container).forEach(function (input) { input.removeAttribute('aria-invalid'); });
    $$('[data-field-error]', container).forEach(function (box) { box.textContent = ''; });
  }

  function applyApiError(container, error) {
    clearFieldErrors(container);
    clearFormError(container);
    if (error && error.field) {
      var input = container.querySelector('[name="' + String(error.field).replace(/"/g, '\\"') + '"]');
      if (input) {
        showFieldError(input, error.message);
        try { input.focus(); } catch (_) {}
      } else {
        formError(container, error.message);
      }
    } else {
      formError(container, error && error.message ? error.message : 'Something went wrong. Please try again.');
    }
  }

  function setBusy(button, busy, label) {
    if (!button) return;
    if (busy) {
      button.dataset.originalHtml = button.innerHTML;
      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span>' + esc(label || 'Working…');
    } else {
      button.disabled = false;
      if (button.dataset.originalHtml) button.innerHTML = button.dataset.originalHtml;
    }
  }

  function formObject(form) {
    var data = {};
    new FormData(form).forEach(function (value, key) {
      if (data[key] !== undefined) {
        if (!Array.isArray(data[key])) data[key] = [data[key]];
        data[key].push(value);
      } else {
        data[key] = value;
      }
    });
    return data;
  }

  function passwordFieldHTML(options) {
    var opts = options || {};
    var id = opts.id || ('pw-' + Math.random().toString(36).slice(2, 8));
    return '<div class="field ' + (opts.span ? 'span-2' : '') + '">'
      + '<label for="' + attr(id) + '">' + esc(opts.label || 'Password') + '</label>'
      + '<div class="pw-wrap">'
      + '<input type="password" id="' + attr(id) + '" name="' + attr(opts.name || id) + '" autocomplete="' + attr(opts.autocomplete || 'new-password') + '"'
      + ' placeholder="' + attr(opts.placeholder || '8–20 characters') + '" ' + (opts.required ? 'required' : '') + '>'
      + '<button type="button" class="pw-eye" aria-label="Show password" aria-pressed="false" title="Show password">'
      + icon('eye') + '</button>'
      + '</div>'
      + (opts.hint ? '<div class="hint">' + esc(opts.hint) + '</div>' : '')
      + (opts.meter === false ? '' : '<div class="pw-meter" data-pw-meter>'
        + '<div class="pw-meter-head"><span>Password strength</span><span class="pw-strength weak" data-pw-strength>Weak</span></div>'
        + '<div class="pw-bars" aria-hidden="true"><span></span><span></span><span></span><span></span></div>'
        + '<ul class="pw-rules">'
        + '<li data-rule="length"><span class="dot">·</span>8–20 characters</li>'
        + '<li data-rule="allowed"><span class="dot">·</span>Letters, numbers, symbols</li>'
        + '<li data-rule="groups"><span class="dot">·</span>At least 3 character types</li>'
        + '</ul></div>')
      + '<div class="err-text" data-field-error></div>'
      + '</div>';
  }

  function passwordEvaluation(value) {
    var text = String(value || '');
    var allowed = /^[A-Za-z0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?~`]*$/.test(text);
    var groups = 0;
    if (/[A-Z]/.test(text)) groups += 1;
    if (/[a-z]/.test(text)) groups += 1;
    if (/[0-9]/.test(text)) groups += 1;
    if (/[^A-Za-z0-9]/.test(text)) groups += 1;
    var lengthOk = text.length >= 8 && text.length <= 20;
    var rules = { length: lengthOk, allowed: allowed, groups: groups >= 3 };
    var ok = rules.length && rules.allowed && rules.groups;
    var score = 0;
    if (lengthOk) score += 1;
    if (groups >= 3) score += 1;
    if (text.length >= 10) score += 1;
    if (groups === 4) score += 1;
    var strength = !ok ? 'weak' : (score >= 3 && groups === 4 && text.length >= 10) ? 'strong' : 'fair';
    return { ok: ok, rules: rules, groups: groups, score: score, strength: strength };
  }

  function bindPasswordMeters(root) {
    $$('[data-pw-meter]', root || document).forEach(function (meter) {
      if (meter.dataset.bound) return;
      meter.dataset.bound = '1';
      var field = meter.closest('.field');
      var input = $('input', field);
      if (!input) return;
      var label = $('[data-pw-strength]', meter);
      var bars = $$('.pw-bars span', meter);
      function update() {
        var evaluation = passwordEvaluation(input.value);
        var strength = evaluation.ok ? evaluation.strength : 'weak';
        label.className = 'pw-strength ' + strength;
        label.textContent = strength === 'strong' ? 'Strong' : strength === 'fair' ? 'Fair' : 'Weak';
        bars.forEach(function (bar, index) {
          bar.className = '';
          if (index < evaluation.score) bar.classList.add('on', strength);
        });
        meter.querySelector('[data-rule="length"]').classList.toggle('met', evaluation.rules.length);
        meter.querySelector('[data-rule="allowed"]').classList.toggle('met', evaluation.rules.allowed && input.value.length > 0);
        meter.querySelector('[data-rule="groups"]').classList.toggle('met', evaluation.rules.groups);
        $$('[data-rule]', meter).forEach(function (item) {
          var dot = $('.dot', item);
          if (dot) dot.textContent = item.classList.contains('met') ? '✓' : '·';
        });
      }
      input.addEventListener('input', update);
      update();
    });
  }

  function bindPasswordEyes(root) {
    $$('.pw-wrap', root || document).forEach(function (wrap) {
      if (wrap.dataset.eyeBound) return;
      wrap.dataset.eyeBound = '1';
      var input = $('input', wrap);
      var button = $('.pw-eye', wrap);
      if (!input || !button) return;
      button.addEventListener('click', function () {
        var show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
        button.setAttribute('title', show ? 'Hide password' : 'Show password');
        button.setAttribute('aria-pressed', show ? 'true' : 'false');
        button.innerHTML = icon(show ? 'eye-off' : 'eye');
        input.focus();
      });
    });
  }

  function initPasswords(root) {
    bindPasswordEyes(root);
    bindPasswordMeters(root);
  }

  function emptyState(options) {
    var opts = options || {};
    return '<div class="empty-state">'
      + '<div class="empty-ic">' + icon(opts.icon || 'package') + '</div>'
      + '<h3>' + esc(opts.title || 'Nothing here yet') + '</h3>'
      + '<p>' + esc(opts.text || '') + '</p>'
      + (opts.action || '') + '</div>';
  }

  function loading(label) {
    return '<div class="loading-block"><span class="spinner"></span>' + esc(label || 'Loading…') + '</div>';
  }

  function errorBlock(error, retryId) {
    return '<div class="empty-state"><div class="empty-ic">' + icon('alert') + '</div><h3>Could not load this section</h3>'
      + '<p>' + esc(error && error.message ? error.message : 'Please try again.') + '</p>'
      + (retryId ? '<button type="button" class="btn secondary" id="' + attr(retryId) + '">' + icon('refresh') + 'Try again</button>' : '')
      + '</div>';
  }

  function debounce(fn, wait) {
    var timer;
    return function () {
      var args = arguments;
      var context = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(context, args); }, wait || 300);
    };
  }

  function toCents(value) {
    var text = String(value === null || value === undefined ? '' : value).replace(/[\u20B1,\s]/g, '');
    if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(text)) return null;
    var parts = text.split('.');
    return Number(parts[0]) * 100 + Number((parts[1] || '').padEnd(2, '0'));
  }

  function fromCents(cents) {
    return (Number(cents || 0) / 100).toFixed(2);
  }

  function orderTimeline(status) {
    var steps = [
      { key: 'pending', label: 'Order placed' },
      { key: 'confirmed', label: 'Confirmed' },
      { key: 'shipped', label: 'Shipped' },
      { key: 'delivered', label: 'Delivered' }
    ];
    var index = steps.findIndex(function (step) { return step.key === status; });
    if (status === 'cancelled' || status === 'refunded') index = -1;
    var html = '<div class="timeline' + (index === -1 ? ' stopped' : '') + '">';
    steps.forEach(function (step, i) {
      var state = index === -1 ? 'off' : i < index ? 'done' : i === index ? 'current' : 'todo';
      html += '<div class="timeline-step ' + state + '"><span class="t-dot">' + (state === 'done' ? icon('check') : '') + '</span><span>' + step.label + '</span></div>';
    });
    html += '</div>';
    if (status === 'cancelled') html += '<div class="notice er mt-2">This order was cancelled. Any reserved stock has been returned.</div>';
    if (status === 'refunded') html += '<div class="notice er mt-2">This order was refunded. Stock has been returned and the refund is included in reports.</div>';
    return html;
  }

  function rangeControls(options) {
    var opts = options || {};
    var period = opts.period || 'monthly';
    var value = opts.value || '';
    return '<div class="period-bar">'
      + '<div class="segmented" data-period>'
      + ['daily', 'weekly', 'monthly', 'annual', 'custom'].map(function (entry) {
        return '<button type="button" data-period-option="' + entry + '" class="' + (entry === period ? 'on' : '') + '">' + titleCase(entry) + '</button>';
      }).join('')
      + '</div>'
      + '<div class="period-value" data-period-value>'
      + (period === 'custom'
        ? '<input type="date" name="from" value="' + attr(opts.from || '') + '" aria-label="Start date"><span class="muted">to</span><input type="date" name="to" value="' + attr(opts.to || '') + '" aria-label="End date">'
        : '<input type="' + (period === 'annual' ? 'number' : period === 'monthly' ? 'month' : period === 'weekly' ? 'week' : 'date') + '" name="periodValue" value="' + attr(value) + '" aria-label="Report date range">')
      + '</div>'
      + (opts.button ? '<button type="button" class="btn secondary" data-range-apply>' + (opts.buttonIcon ? icon(opts.buttonIcon) : '') + esc(opts.button || 'Apply') + '</button>' : '')
      + '</div>';
  }

  window.SkyUI = {
    $: $, $$: $$, esc: esc, attr: attr, icon: icon,
    money: money, number: number, dateTime: dateTime, dateOnly: dateOnly, timeOnly: timeOnly,
    todayLocal: todayLocal, monthLocal: monthLocal, yearLocal: yearLocal, titleCase: titleCase,
    statusBadge: statusBadge, sampleBadge: sampleBadge, stars: stars, avatar: avatar,
    themeButton: themeButton, toast: toast, openModal: openModal, confirmDialog: confirmDialog,
    formError: formError, clearFormError: clearFormError, showFieldError: showFieldError,
    clearFieldErrors: clearFieldErrors, applyApiError: applyApiError, setBusy: setBusy,
    formObject: formObject, passwordFieldHTML: passwordFieldHTML, passwordEvaluation: passwordEvaluation,
    initPasswords: initPasswords, emptyState: emptyState, loading: loading, errorBlock: errorBlock,
    debounce: debounce, toCents: toCents, fromCents: fromCents, orderTimeline: orderTimeline,
    rangeControls: rangeControls
  };
})();
