(function () {
  'use strict';

  var state = { user: null, csrf: null, stall: null, home: '/portal/', providers: { email: false, sms: false } };
  var bootPromise = null;

  function ApiError(payload, status) {
    var error = payload && payload.error ? payload.error : {};
    var instance = new Error(error.message || 'The request could not be completed.');
    instance.name = 'ApiError';
    instance.status = status;
    instance.code = error.code || 'request_failed';
    instance.field = error.field || '';
    instance.details = error.details || null;
    return instance;
  }

  async function parseResponse(response) {
    var type = response.headers.get('content-type') || '';
    if (type.includes('application/json')) {
      try {
        return await response.json();
      } catch (_) {
        return {};
      }
    }
    var text = await response.text();
    return { error: { message: text || 'Unexpected response from the server.' } };
  }

  async function request(path, options) {
    var opts = options || {};
    var method = (opts.method || 'GET').toUpperCase();
    var headers = Object.assign({ Accept: 'application/json' }, opts.headers || {});
    if (method !== 'GET' && method !== 'HEAD' && state.csrf && !headers['X-CSRF-Token']) {
      headers['X-CSRF-Token'] = state.csrf;
    }
    var init = { method: method, headers: headers, credentials: 'same-origin' };
    if (opts.body !== undefined) {
      if (opts.raw) {
        init.body = opts.body;
      } else {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(opts.body);
      }
    }
    var response = await fetch(path, init);
    var payload = await parseResponse(response);
    if (!response.ok) {
      var error = ApiError(payload, response.status);
      if (response.status === 403 && error.code === 'csrf_invalid' && !opts._retried) {
        await boot(true);
        return request(path, Object.assign({}, opts, { _retried: true }));
      }
      if (response.status === 401 && state.user) {
        state.user = null;
        state.csrf = null;
        try { window.dispatchEvent(new CustomEvent('sky:unauthorized')); } catch (_) {}
      }
      throw error;
    }
    return payload;
  }

  function get(path) { return request(path); }
  function post(path, body, options) { return request(path, Object.assign({ method: 'POST', body: body }, options || {})); }
  function put(path, body) { return request(path, { method: 'PUT', body: body }); }
  function patch(path, body) { return request(path, { method: 'PATCH', body: body }); }
  function del(path) { return request(path, { method: 'DELETE' }); }

  async function boot(force) {
    if (bootPromise && !force) return bootPromise;
    bootPromise = (async function () {
      try {
        var me = await request('/api/auth/me', { _retried: true });
        state.user = me.user || null;
        state.csrf = me.csrf || null;
        state.stall = me.stall || null;
        state.home = me.home || '/portal/';
        state.providers = me.providers || state.providers;
        state.unreadNotifications = me.unreadNotifications || 0;
        return Object.assign({}, me, { user: state.user });
      } catch (error) {
        state.user = null;
        state.csrf = null;
        return { user: null, csrf: null, home: '/portal/', providers: state.providers };
      }
    })();
    return bootPromise;
  }

  async function login(payload) {
    var result = await post('/api/auth/login', payload);
    state.user = result.user;
    state.csrf = result.csrf;
    state.home = result.home || '/portal/';
    return result;
  }

  async function registerStart(payload) {
    var result = await post('/api/auth/register/start', payload);
    if (result.user) {
      state.user = result.user;
      state.csrf = result.csrf;
      state.home = result.home || '/portal/';
    }
    return result;
  }

  function registerResend(token) {
    return post('/api/auth/register/resend', { token: token });
  }

  async function registerVerify(token, code) {
    var result = await post('/api/auth/register/verify', { token: token, code: code });
    state.user = result.user;
    state.csrf = result.csrf;
    state.home = result.home || '/portal/';
    return result;
  }

  async function logout() {
    try { await post('/api/auth/logout', {}); } catch (_) {}
    state.user = null;
    state.csrf = null;
    state.stall = null;
  }

  async function upload(file) {
    if (!file) throw new Error('Choose an image to upload.');
    if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) {
      throw new Error('Choose a JPEG, PNG, or WebP image.');
    }
    if (file.size > 5 * 1024 * 1024) {
      throw new Error('Images must be 5 MB or smaller.');
    }
    return request('/api/uploads', {
      method: 'POST',
      raw: true,
      body: file,
      headers: { 'Content-Type': file.type }
    });
  }

  async function download(path, fallbackName) {
    var response = await fetch(path, { credentials: 'same-origin' });
    if (!response.ok) {
      var payload = await parseResponse(response);
      throw ApiError(payload, response.status);
    }
    var blob = await response.blob();
    var disposition = response.headers.get('content-disposition') || '';
    var match = /filename="([^"]+)"/i.exec(disposition);
    var name = match ? match[1] : (fallbackName || 'skyworld-download');
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    return name;
  }

  function query(params) {
    var search = new URLSearchParams();
    Object.keys(params || {}).forEach(function (key) {
      var value = params[key];
      if (value === undefined || value === null || value === '') return;
      search.set(key, value);
    });
    var text = search.toString();
    return text ? '?' + text : '';
  }

  window.SkyApi = {
    state: state,
    boot: boot,
    request: request,
    get: get,
    post: post,
    put: put,
    patch: patch,
    del: del,
    login: login,
    registerStart: registerStart,
    registerResend: registerResend,
    registerVerify: registerVerify,
    logout: logout,
    upload: upload,
    download: download,
    query: query,
    setSession: function (user, csrf, home) {
      state.user = user;
      state.csrf = csrf;
      if (home) state.home = home;
    }
  };
})();
