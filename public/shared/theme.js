(function () {
  'use strict';

  var KEY = 'skyworld-theme';
  var root = document.documentElement;

  function read() {
    try {
      var saved = localStorage.getItem(KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch (_) {}
    try {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch (_) {
      return 'light';
    }
  }

  function apply(mode) {
    root.setAttribute('data-theme', mode);
    root.style.colorScheme = mode;
    document.querySelectorAll('[data-theme-toggle]').forEach(function (button) {
      button.setAttribute('aria-label', mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
      button.setAttribute('title', mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
      button.setAttribute('aria-pressed', mode === 'dark' ? 'true' : 'false');
    });
  }

  function set(mode, persist) {
    var next = mode === 'dark' ? 'dark' : 'light';
    if (persist !== false) {
      try { localStorage.setItem(KEY, next); } catch (_) {}
    }
    apply(next);
    try {
      window.dispatchEvent(new CustomEvent('sky:theme', { detail: { theme: next } }));
    } catch (_) {}
    return next;
  }

  function toggle() {
    return set(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark', true);
  }

  function bind() {
    document.addEventListener('click', function (event) {
      var button = event.target.closest('[data-theme-toggle]');
      if (!button) return;
      event.preventDefault();
      toggle();
    });
    apply(root.getAttribute('data-theme') || read());
  }

  apply(read());

  window.SkyTheme = {
    get: function () { return root.getAttribute('data-theme') || 'light'; },
    set: set,
    toggle: toggle,
    bind: bind
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
