(function () {
  'use strict';

  var U = window.SkyUI;
  var A = window.SkyApi;
  var $ = U.$;
  var $$ = U.$$;
  var state = { config: null, me: null, unread: 0, route: '', loading: false };

  function navItems(config) {
    var items = [];
    (config.nav || []).forEach(function (group) {
      (group.items || []).forEach(function (item) { items.push(item); });
    });
    return items;
  }

  function findItem(config, id) {
    return navItems(config).find(function (item) { return item.id === id; }) || navItems(config)[0];
  }

  function setSidebarOpen(open) {
    var side = $('#dashSide');
    var backdrop = $('#sideBackdrop');
    if (!side) return;
    side.classList.toggle('open', open);
    if (backdrop) backdrop.classList.toggle('show', open);
    var button = $('#dashMenu');
    if (button) button.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function closePops(except) {
    $$('.notif-pop, .user-pop').forEach(function (pop) {
      if (pop !== except) pop.hidden = true;
    });
  }

  function renderNav(config, activeId) {
    return (config.nav || []).map(function (group) {
      return '<div class="nav-group">'
        + (group.label ? '<div class="nav-label">' + U.esc(group.label) + '</div>' : '')
        + group.items.map(function (item) {
          return '<a class="dash-link ' + (item.id === activeId ? 'on' : '') + '" href="#' + U.attr(item.id) + '" data-route="' + U.attr(item.id) + '">'
            + U.icon(item.icon || 'chevron-right') + '<span>' + U.esc(item.label) + '</span>'
            + (item.badge ? '<span class="nav-badge">' + U.esc(item.badge) + '</span>' : '')
            + '</a>';
        }).join('')
        + '</div>';
    }).join('');
  }

  function buildShell(config, me) {
    var roleName = U.titleCase(me.user.role);
    var userSub = me.stall ? me.stall.name : roleName + ' account';
    var portalPath = me.user.role === 'admin' ? '/portal/admin/' : me.user.role === 'operator' ? '/portal/operator/' : '/portal/owner/';
    document.body.classList.add('role-' + me.user.role);
    document.body.dataset.role = me.user.role;
    document.body.innerHTML = [
      '<div class="side-backdrop" id="sideBackdrop"></div>',
      '<div class="dash">',
      '<aside class="dash-side" id="dashSide" aria-label="' + U.attr(config.area) + ' navigation">',
      '<div class="dash-side-head">',
      '<a class="dash-brand" href="' + U.attr(portalPath) + '" title="SkyWorld Stall portal">',
      '<img src="/api/brand/logo" alt="" width="36" height="36">',
      '<span><span class="db-name">SkyWorld</span><span class="db-sub">Stall · ' + U.esc(roleName) + '</span></span>',
      '</a>',
      '<span class="dash-area">' + U.icon(config.areaIcon || 'layers') + U.esc(config.area) + '</span>',
      '</div>',
      '<div class="dash-user">' + U.avatar(me.user.name, 'md') + '<div><div class="du-name">' + U.esc(me.user.name) + '</div>'
      + '<div class="du-role">' + U.esc(userSub) + '</div></div></div>',
      '<nav class="dash-nav" aria-label="Sections">' + renderNav(config, '') + '</nav>',
      '<div class="dash-side-foot">',
      '<a href="/store/">' + U.icon('store') + 'Browse the storefront</a>',
      '<a href="' + U.attr(portalPath) + '">' + U.icon('external') + 'Role portal</a>',
      '<button type="button" id="sideSignOut">' + U.icon('log-out') + 'Sign out</button>',
      '</div>',
      '</aside>',
      '<div class="dash-main">',
      '<header class="dash-top">',
      '<button type="button" class="icon-btn dash-menu" id="dashMenu" aria-label="Open navigation" aria-expanded="false">' + U.icon('menu') + '</button>',
      '<div class="dash-top-titles"><h1 id="dashTitle">' + U.esc(config.area) + '</h1><div class="page-sub" id="dashSub">' + U.esc(config.area) + ' · F. Calderon St. Baguio City, Benguet</div></div>',
      '<div class="dash-top-actions">',
      '<div class="notif-wrap"><button type="button" class="icon-btn" id="notifBtn" aria-label="Notifications" title="Notifications" aria-expanded="false">' + U.icon('bell') + '<span class="notif-dot" id="notifDot"></span></button>',
      '<div class="notif-pop" id="notifPop" hidden>',
      '<div class="pop-head"><strong>Notifications</strong><button type="button" id="markAllRead">Mark all read</button></div>',
      '<div class="notif-list" id="notifList"><div class="loading-block" style="padding:20px"><span class="spinner"></span></div></div>',
      '</div></div>',
      U.themeButton(),
      '<div class="user-wrap"><button type="button" class="btn ghost sm" id="userBtn" aria-label="Account menu" aria-expanded="false">'
      + U.avatar(me.user.name, 'sm') + '<span class="hide-mobile">' + U.esc(me.user.name.split(' ')[0]) + '</span>' + U.icon('chevron-down') + '</button>',
      '<div class="user-pop" id="userPop" hidden>',
      '<div class="up-head"><strong>' + U.esc(me.user.name) + '</strong><span>' + U.esc(me.user.email) + '</span></div>',
      navItems(config).filter(function (item) { return item.account; }).map(function (item) {
        return '<a href="#' + U.attr(item.id) + '">' + U.icon(item.icon || 'user') + U.esc(item.label) + '</a>';
      }).join(''),
      '<a href="/store/">' + U.icon('store') + 'Open storefront</a>',
      '<button type="button" id="userSignOut">' + U.icon('log-out') + 'Sign out</button>',
      '</div></div>',
      '</div></header>',
      '<main class="dash-view" id="dashView" tabindex="-1"></main>',
      '<footer class="dash-footer"><span>' + U.esc(config.area) + ' · SkyWorld Stall · Data in F. Calderon St. Baguio City, Benguet</span></footer>',
      '</div></div>'
    ].join('');
  }

  function wireShell() {
    $('#dashMenu').addEventListener('click', function () { setSidebarOpen(!$('#dashSide').classList.contains('open')); });
    $('#sideBackdrop').addEventListener('click', function () { setSidebarOpen(false); });
    $$('.dash-link').forEach(function (link) {
      link.addEventListener('click', function () { setSidebarOpen(false); });
    });
    $('#sideSignOut').addEventListener('click', signOut);
    $('#userSignOut').addEventListener('click', signOut);
    $('#notifBtn').addEventListener('click', function () {
      // Owner dashboard: navigate to Notifications sidebar page (order alerts)
      if (state.config && state.config.role === 'owner') {
        closePops(null);
        window.location.hash = 'notifications';
        setSidebarOpen(false);
        return;
      }
      var pop = $('#notifPop');
      var open = pop.hidden;
      closePops(pop);
      pop.hidden = !open;
      this.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) loadNotifications();
    });
    $('#userBtn').addEventListener('click', function () {
      var pop = $('#userPop');
      var open = pop.hidden;
      closePops(pop);
      pop.hidden = !open;
      this.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    $('#markAllRead').addEventListener('click', async function () {
      try {
        await A.post('/api/notifications/read-all', {});
        loadNotifications();
        U.toast('All notifications marked as read.', 'ok');
      } catch (error) { U.toast(error.message, 'er'); }
    });
    document.addEventListener('click', function (event) {
      if (!event.target.closest('.notif-wrap, .user-wrap')) closePops(null);
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { closePops(null); setSidebarOpen(false); }
    });
    window.addEventListener('hashchange', route);
  }

  async function signOut() {
    try { await A.logout(); } catch (_) {}
    window.location.href = '/portal/';
  }

  async function loadNotifications() {
    var list = $('#notifList');
    if (!list) return;
    try {
      var data = await A.get('/api/notifications?limit=25');
      state.unread = data.unread || 0;
      updateBadge();
      if (!data.notifications.length) {
        list.innerHTML = '<div class="empty-state" style="padding:24px 16px"><p>No notifications yet.</p></div>';
        return;
      }
      list.innerHTML = data.notifications.map(function (item) {
        return '<a class="notif-item ' + (item.isRead ? '' : 'unread') + '" href="' + U.attr(item.link || '#') + '" data-notif="' + item.id + '">'
          + '<div class="ni-title">' + U.esc(item.title) + '</div><div class="ni-msg">' + U.esc(item.message) + '</div>'
          + '<div class="ni-time">' + U.esc(item.localDateTime) + '</div></a>';
      }).join('');
      $$('[data-notif]', list).forEach(function (link) {
        link.addEventListener('click', function () {
          A.post('/api/notifications/' + link.dataset.notif + '/read', {}).catch(function () {});
        });
      });
    } catch (error) {
      list.innerHTML = '<div class="empty-state" style="padding:20px"><p>' + U.esc(error.message) + '</p></div>';
    }
  }

  function updateBadge() {
    var dot = $('#notifDot');
    if (dot) dot.classList.toggle('show', state.unread > 0);
    var button = $('#notifBtn');
    if (button) button.setAttribute('aria-label', state.unread ? 'Notifications, ' + state.unread + ' unread' : 'Notifications');
  }

  function setTopTitle(item) {
    var title = $('#dashTitle');
    var sub = $('#dashSub');
    if (title) title.textContent = item.label;
    if (sub) sub.textContent = (item.subtitle || state.config.area) + ' · F. Calderon St. Baguio City, Benguet';
    document.title = item.label + ' · SkyWorld ' + state.config.area;
  }

  function currentRouteId() {
    var hash = String(window.location.hash || '').replace(/^#\/?/, '').split('?')[0];
    return hash || state.config.defaultView || navItems(state.config)[0].id;
  }

  async function route() {
    var id = currentRouteId();
    var item = findItem(state.config, id);
    if (!item) {
      window.location.hash = '#' + (state.config.defaultView || navItems(state.config)[0].id);
      return;
    }
    if (state.route === item.id && state.routeRendered) return;
    $$('.overlay').forEach(function (overlay) { if (overlay._close) overlay._close(); });
    state.route = item.id;
    state.routeRendered = true;
    setTopTitle(item);
    $$('.dash-link').forEach(function (link) { link.classList.toggle('on', link.dataset.route === item.id); });
    var view = $('#dashView');
    if (!view) return;
    view.innerHTML = U.loading('Loading ' + item.label.toLowerCase() + '…');
    try {
      var renderer = state.config.views[item.id];
      if (!renderer) throw new Error('This section is not available yet.');
      await renderer(view, api);
      // Slow fade-in for sidebar section content
      Array.prototype.forEach.call(view.children, function (child, i) {
        child.style.animation = 'none';
        void child.offsetWidth;
        child.style.animation = 'fadeUp 0.7s var(--ease) ' + (i * 0.05) + 's both';
      });
      U.initPasswords(view);
      view.focus({ preventScroll: true });
    } catch (error) {
      if (error && (error.status === 401)) { window.location.href = '/portal/?next=' + encodeURIComponent('/' + state.config.role + '/'); return; }
      if (error && error.status === 403 && state.me && state.me.user && state.me.user.role !== state.config.role) {
        window.location.replace(state.me.home || '/portal/');
        return;
      }
      view.innerHTML = '<div class="view-head"><div><h2>' + U.esc(item.label) + '</h2></div></div>' + U.errorBlock(error);
      var retry = $('#retryView');
      if (retry) retry.addEventListener('click', function () { state.route = ''; route(); });
    }
  }

  function navigate(id) {
    if (('#' + id) === window.location.hash) { state.route = ''; route(); }
    else window.location.hash = '#' + id;
  }

  async function accountView(container) {
    var data = await A.get('/api/account');
    var user = data.user;
    var providerNote = SkyApi.state.providers && (SkyApi.state.providers.email || SkyApi.state.providers.sms)
      ? 'Password recovery codes are delivered only through the configured provider.'
      : 'Password recovery requires an email or SMS provider to be configured on this server. No reset codes are ever displayed in this interface.';
    container.innerHTML = '<div class="view-head"><div><h2>Account settings</h2><p>Manage your profile and password. Roles and stall assignments are controlled by the platform.</p></div></div>'
      + '<div class="grid-2 even">'
      + '<form class="form-card" id="profileForm" novalidate>'
      + '<div class="card-head"><h3>Your profile</h3>' + (user.role === 'owner' ? U.statusBadge('occupied', 'Stall owner') : U.statusBadge(user.role, U.titleCase(user.role))) + '</div>'
      + '<div class="form-grid">'
      + '<div class="field span-2"><label for="accName">Full name</label><input id="accName" name="name" type="text" value="' + U.attr(user.name) + '" autocomplete="name" required><div class="err-text" data-field-error></div></div>'
      + '<div class="field"><label for="accEmail">Email address</label><input id="accEmail" name="email" type="email" value="' + U.attr(user.email) + '" autocomplete="email" required><div class="err-text" data-field-error></div></div>'
      + '<div class="field"><label for="accPhone">Mobile number</label><input id="accPhone" name="phone" type="tel" value="' + U.attr(user.phone) + '" autocomplete="tel" required><div class="err-text" data-field-error></div></div>'
      + '<div class="field span-2"><label for="accCurrent">Current password <span class="muted small">(required to change your email)</span></label>'
      + '<div class="pw-wrap"><input id="accCurrent" name="currentPassword" type="password" autocomplete="current-password" placeholder="Your current password">'
      + '<button type="button" class="pw-eye" aria-label="Show password" title="Show password" aria-pressed="false">' + U.icon('eye') + '</button></div>'
      + '<div class="hint">Leave blank when you are not changing your email address.</div><div class="err-text" data-field-error></div></div>'
      + '<div class="field span-2" style="display:none"><input name="username" type="text" tabindex="-1" autocomplete="off"></div>'
      + '</div>'
      + '<div class="form-actions"><button class="btn" type="submit" id="saveProfile">' + U.icon('check') + 'Save profile</button></div>'
      + '<div class="form-note">' + U.esc(providerNote) + '</div>'
      + '</form>'
      + '<form class="form-card" id="passwordForm" novalidate>'
      + '<div class="card-head"><h3>Change password</h3></div>'
      + '<div class="field"><label for="curPassword">Current password</label><div class="pw-wrap"><input id="curPassword" name="currentPassword" type="password" autocomplete="current-password" required>'
      + '<button type="button" class="pw-eye" aria-label="Show password" title="Show password" aria-pressed="false">' + U.icon('eye') + '</button></div><div class="err-text" data-field-error></div></div>'
      + U.passwordFieldHTML({ id: 'newPassword', name: 'newPassword', label: 'New password', autocomplete: 'new-password', required: true })
      + U.passwordFieldHTML({ id: 'confirmPassword', name: 'confirmPassword', label: 'Confirm new password', autocomplete: 'new-password', required: true, meter: false })
      + '<div class="form-actions"><button class="btn" type="submit" id="savePassword">' + U.icon('lock') + 'Update password</button></div>'
      + '<div class="form-note">Updating your password signs out your other sessions.</div>'
      + '</form>'
      + '</div>';
    U.initPasswords(container);

    $('#profileForm').addEventListener('submit', async function (event) {
      event.preventDefault();
      var form = event.currentTarget;
      var button = $('#saveProfile');
      U.clearFieldErrors(form); U.clearFormError(form);
      U.setBusy(button, true, 'Saving…');
      try {
        var payload = {
          name: form.elements.namedItem('name').value.trim(),
          email: form.elements.namedItem('email').value.trim(),
          phone: form.elements.namedItem('phone').value.trim()
        };
        if (form.currentPassword.value) payload.currentPassword = form.currentPassword.value;
        var result = await A.put('/api/account', payload);
        SkyApi.state.user = result.user;
        form.currentPassword.value = '';
        U.toast(result.message, 'ok');
      } catch (error) {
        U.applyApiError(form, error);
      } finally {
        U.setBusy(button, false);
      }
    });

    $('#passwordForm').addEventListener('submit', async function (event) {
      event.preventDefault();
      var form = event.currentTarget;
      var button = $('#savePassword');
      U.clearFieldErrors(form); U.clearFormError(form);
      if (form.newPassword.value !== form.confirmPassword.value) {
        U.showFieldError(form.confirmPassword, 'The password confirmation does not match.');
        return;
      }
      U.setBusy(button, true, 'Updating…');
      try {
        var result = await A.post('/api/account/password', {
          currentPassword: form.currentPassword.value,
          newPassword: form.newPassword.value,
          confirmPassword: form.confirmPassword.value
        });
        form.reset();
        U.initPasswords(form);
        U.toast(result.message, 'ok');
      } catch (error) {
        U.applyApiError(form, error);
      } finally {
        U.setBusy(button, false);
      }
    });
  }

  var api = {
    navigate: navigate,
    reload: function () { state.route = ''; route(); },
    me: function () { return state.me; },
    setUnread: function (count) { state.unread = count; updateBadge(); },
    loadNotifications: loadNotifications
  };

  async function boot(config) {
    state.config = config;
    var me = await A.boot();
    state.me = me;
    if (!me.user) {
      var next = encodeURIComponent(window.location.pathname + window.location.hash);
      window.location.replace('/portal/?next=' + next + '&role=' + encodeURIComponent(config.role));
      return null;
    }
    if (me.user.role !== config.role) {
      window.location.replace(me.home || '/portal/');
      return null;
    }
    if (config.role === 'owner' && !me.user.stallId) {
      document.body.innerHTML = '<div class="page narrow" style="padding-top:12vh"><div class="card">'
        + '<h1>No stall linked</h1><p class="mt-1">This owner account is not yet linked to a stall. Contact the platform administrator.</p>'
        + '<div class="btn-row mt-2"><a class="btn" href="/portal/">Return to portal</a><a class="btn ghost" href="/store/">Browse store</a></div></div></div>';
      return null;
    }
    buildShell(config, me);
    wireShell();
    updateBadge();
    loadNotifications();
    await route();
    return api;
  }

  window.SkyDash = {
    boot: boot,
    accountView: accountView,
    icon: U.icon,
    confirm: U.confirmDialog,
    money: U.money,
    get state() { return state; }
  };
})();
