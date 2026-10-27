'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const store = require('./db');
const auth = require('./auth');
const httpHelpers = require('./http');
const { ApiError } = require('./errors');
const apiAuth = require('./api/auth');
const apiCommon = require('./api/commonRoutes');
const apiStore = require('./api/store');
const apiOwner = require('./api/owner');
const apiAdmin = require('./api/admin');
const apiOperator = require('./api/operator');
const seed = require('./seed');

const router = new httpHelpers.Router();
apiAuth.registerRoutes(router);
apiCommon.registerRoutes(router);
apiStore.registerRoutes(router);
apiOwner.registerRoutes(router);
apiAdmin.registerRoutes(router);
apiOperator.registerRoutes(router);

const ROOT_REDIRECTS = {
  '/': '/portal/',
  '/portal': '/portal/',
  '/store': '/store/',
  '/owner': '/owner/',
  '/admin': '/admin/',
  '/operator': '/operator/',
};

const API_PREFIX = '/api/';
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function isMaintenanceMode() {
  return store.getSetting('maintenance_mode', '0') === '1';
}

function statFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() ? stat : null;
  } catch (_) {
    return null;
  }
}

function resolveStatic(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch (_) {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.includes('..')) return null;
  if (decoded.startsWith('/uploads/')) {
    const relative = decoded.slice('/uploads/'.length);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(relative)) return null;
    const full = path.join(config.uploadsDir, relative);
    if (!full.startsWith(config.uploadsDir)) return null;
    const stat = statFile(full);
    return stat ? { full, stat, cache: 'public, max-age=3600' } : null;
  }
  let relative = decoded.replace(/^\/+/, '');
  if (!relative || relative.endsWith('/')) relative += 'index.html';
  let full = path.resolve(config.publicDir, relative);
  if (!full.startsWith(config.publicDir + path.sep) && full !== path.join(config.publicDir, 'index.html')) return null;
  let stat = statFile(full);
  if (!stat && !path.extname(full)) {
    full = path.join(full, 'index.html');
    stat = statFile(full);
  }
  if (!stat) return null;
  const isHtml = full.endsWith('.html');
  return { full, stat, cache: isHtml ? 'no-store' : 'public, max-age=300' };
}

function serveStatic(req, res, pathname, method) {
  const resolved = resolveStatic(pathname);
  if (!resolved) return false;
  const ext = path.extname(resolved.full).toLowerCase();
  const type = httpHelpers.MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': resolved.cache,
    'Content-Length': resolved.stat.size,
    'X-Content-Type-Options': 'nosniff',
  });
  if (method === 'HEAD') {
    res.end();
    return true;
  }
  fs.createReadStream(resolved.full).pipe(res);
  return true;
}

function context(req, res, url, params) {
  let bodyPromise = null;
  return {
    req,
    res,
    params,
    query: url.searchParams,
    method: req.method,
    session: null,
    body(limit = config.maxJsonBytes) {
      if (!bodyPromise) bodyPromise = httpHelpers.readJsonBody(req, limit);
      return bodyPromise;
    },
  };
}

async function handle(req, res) {
  httpHelpers.securityHeaders(res);
  const method = String(req.method || 'GET').toUpperCase();
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch (_) {
    httpHelpers.sendJson(res, 400, { error: { message: 'Invalid request URL.' } });
    return;
  }
  const pathname = url.pathname;

  if (ROOT_REDIRECTS[pathname]) {
    httpHelpers.redirect(res, ROOT_REDIRECTS[pathname], 302);
    return;
  }

  if (UNSAFE_METHODS.has(method) && !httpHelpers.isSameOrigin(req)) {
    httpHelpers.sendJson(res, 403, { error: { message: 'This request came from an untrusted origin.', code: 'origin_rejected' } });
    return;
  }

  if (pathname.startsWith(API_PREFIX)) {
    const found = router.find(method, pathname);
    if (!found.route) {
      if (found.pathMatched) {
        httpHelpers.sendJson(res, 405, { error: { message: 'That method is not supported for this endpoint.', code: 'method_not_allowed' } });
      } else {
        httpHelpers.sendJson(res, 404, { error: { message: 'API endpoint not found.', code: 'not_found' } });
      }
      return;
    }
    const ctx = context(req, res, url, found.params);
    ctx.session = auth.readSession(req);
    if (UNSAFE_METHODS.has(method) && ctx.session && !auth.csrfValid(ctx)) {
      httpHelpers.sendJson(res, 403, { error: { message: 'Your session security token is missing or stale. Refresh the page and try again.', code: 'csrf_invalid' } });
      return;
    }
    if (isMaintenanceMode() && pathname.startsWith('/api/store/') && method === 'POST') {
      httpHelpers.sendJson(res, 503, { error: { message: 'SkyWorld Stall is in maintenance mode. Please try again soon.', code: 'maintenance' } });
      return;
    }
    try {
      const result = await found.route.handler(ctx);
      if (!res.writableEnded) {
        if (result === undefined) {
          httpHelpers.sendJson(res, 200, { ok: true });
        } else {
          httpHelpers.sendJson(res, 200, result);
        }
      }
    } catch (error) {
      if (res.writableEnded) {
        res.destroy();
        return;
      }
      if (error instanceof ApiError) {
        httpHelpers.sendJson(res, error.status, {
          error: {
            message: error.message,
            code: error.code || 'request_failed',
            ...(error.field ? { field: error.field } : {}),
            ...(error.details ? { details: error.details } : {}),
          },
        }, error.headers || {});
        return;
      }
      console.error(`[api] ${method} ${pathname} failed:`, error);
      httpHelpers.sendJson(res, 500, { error: { message: 'Something went wrong on the server. Please try again.', code: 'server_error' } });
    }
    return;
  }

  if (method !== 'GET' && method !== 'HEAD') {
    httpHelpers.sendText(res, 405, 'Method not allowed.');
    return;
  }
  if (serveStatic(req, res, pathname, method)) return;
  httpHelpers.sendText(res, 404, 'Not found. Visit /portal/ to enter SkyWorld Stall.');
}

let server;
function createServer() {
  return http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      console.error('[server] Unhandled request error:', error);
      if (!res.headersSent) {
        httpHelpers.sendJson(res, 500, { error: { message: 'Unexpected server error.' } });
      } else {
        res.destroy();
      }
    });
  });
}

function start() {
  if (!config.skipSeed) seed.ensureSeeded();
  server = createServer();
  server.listen(config.port, config.host, () => {
    console.log('');
    console.log(`SkyWorld Stall is running at ${config.appOrigin}`);
    console.log(`  Portal:   ${config.appOrigin}/portal/`);
    console.log(`    Owner portal:    ${config.appOrigin}/portal/owner/`);
    console.log(`    Admin portal:    ${config.appOrigin}/portal/admin/`);
    console.log(`    Operator portal: ${config.appOrigin}/portal/operator/`);
    console.log(`  Store:    ${config.appOrigin}/store/`);
    console.log(`  Owner:    ${config.appOrigin}/owner/`);
    console.log(`  Admin:    ${config.appOrigin}/admin/`);
    console.log(`  Operator: ${config.appOrigin}/operator/`);
    console.log(`  Timezone: ${config.timezoneLabel}`);
    console.log(`  Email provider: ${config.smtp.configured ? 'configured' : 'NOT configured'}`);
    console.log(`  SMS provider:   ${config.sms.configured ? 'configured' : 'NOT configured'}`);
    if (config.resetPepperIsEphemeral) {
      console.warn('  Warning: RESET_PEPPER is not set. Reset codes will stop working after a server restart.');
    }
    console.log('');
  });
  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 4000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) start();

module.exports = { createServer, start, router };
