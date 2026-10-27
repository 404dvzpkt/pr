'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(__dirname, '.tmp');
const DB_PATH = path.join(TMP_DIR, 'api-test.db');
const UPLOADS_DIR = path.join(TMP_DIR, 'uploads');
let BASE = '';

let passed = 0;
const failures = [];

function ok(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`ok ${passed} - ${label}`);
    return;
  }
  const message = `FAILED: ${label}${detail ? ` - ${detail}` : ''}`;
  failures.push(message);
  console.error(`not ok - ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function childEnv(extra = {}) {
  const providerKeys = [
    'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'SMTP_FROM_NAME', 'SMTP_SUPPORT', 'SUPPORT_EMAIL',
    'SMS_PROVIDER', 'SEMAPHORE_API_KEY', 'SEMAPHORE_SENDER_NAME', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM',
    'SMS_WEBHOOK_URL', 'SMS_WEBHOOK_TOKEN',
  ];
  const env = { ...process.env };
  for (const key of providerKeys) env[key] = '';
  return {
    ...env,
    NODE_ENV: 'test',
    DB_PATH,
    UPLOADS_DIR,
    PROVIDERS_FILE: path.join(TMP_DIR, 'providers.json'),
    RESET_PEPPER: 'test-pepper-for-ci',
    APP_ORIGIN: BASE,
    ...extra,
  };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
}

function runSeed() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', 'server/seed.js', '--reset'], {
      cwd: ROOT,
      env: childEnv({ SKIP_SEED: '1' }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`Seed failed with code ${code}\n${output}`));
    });
  });
}

function startServer(port) {
  const child = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', 'server/index.js'], {
    cwd: ROOT,
    env: childEnv({ PORT: String(port), HOST: '127.0.0.1', SKIP_SEED: '1' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  const capture = (chunk) => {
    logs.push(String(chunk));
    if (logs.length > 80) logs.shift();
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  return { child, logs };
}

async function waitForHealth(logs) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (logs.some((entry) => /Unhandled request error|EADDRINUSE|Cannot find module/.test(entry))) break;
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch (_) {
      // Server not listening yet.
    }
    await sleep(200);
  }
  throw new Error(`Test server did not start.\n${logs.join('')}`);
}

function stopServer(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    }, 3000);
    timer.unref();
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

class Client {
  constructor() { this.cookie = ''; this.csrf = ''; }

  async req(method, requestPath, body, options = {}) {
    const headers = {};
    if (this.cookie) headers.Cookie = this.cookie;
    if (this.csrf && !['GET', 'HEAD'].includes(method)) headers['X-CSRF-Token'] = this.csrf;
    let payload;
    if (options.raw) {
      headers['Content-Type'] = options.type || 'application/octet-stream';
      payload = body;
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(BASE + requestPath, { method, headers, body: payload, redirect: 'manual' });
    const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (cookies.length) this.cookie = cookies.map((entry) => entry.split(';')[0]).join('; ');
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, text, headers: res.headers };
  }

  get(requestPath) { return this.req('GET', requestPath); }

  startRegistration(payload) {
    return this.req('POST', '/api/auth/register/start', payload);
  }

  verifyRegistration(token, code) {
    return this.req('POST', '/api/auth/register/verify', { token, code });
  }

  async login(identifier, password) {
    const res = await this.req('POST', '/api/auth/login', { identifier, password });
    assert.equal(res.status, 200, `login ${identifier}: ${JSON.stringify(res.data)}`);
    this.csrf = res.data.csrf;
    return res.data;
  }
}

async function main() {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });

  const port = await freePort();
  BASE = `http://127.0.0.1:${port}`;
  await runSeed();
  const { child, logs } = startServer(port);

  try {
    await waitForHealth(logs);

    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n0QAAAAASUVORK5CYII=', 'base64');
    const admin = new Client();
    const operator = new Client();
    const owner = new Client();
    const guest = new Client();

    /* 1. Storefront and role portals */
    {
      const store = await guest.get('/store/');
      ok('storefront HTML loads', store.status === 200);
      ok('storefront has no portal sign-in link', !store.text.includes('/portal/') && !/Sign in/i.test(store.text));

      const meta = await guest.get('/api/meta');
      ok('meta loads', meta.status === 200);
      ok('ten predefined stalls', meta.data.stalls === 10, JSON.stringify(meta.data));
      ok('providers reported as not configured', meta.data.providers.email === false && meta.data.providers.sms === false);
      ok('test server exposes the development code fallback', meta.data.delivery.devFallback === true);
      ok('meta includes all payment link keys', ['gcash', 'maya', 'bank'].every((key) => key in meta.data.paymentLinks), JSON.stringify(meta.data.paymentLinks));
      ok('payment links default to the real provider sites',
        meta.data.paymentLinks.gcash === 'https://www.gcash.com/'
        && meta.data.paymentLinks.maya === 'https://www.maya.ph/'
        && meta.data.paymentLinks.bank === 'https://www.bdo.com.ph/',
        JSON.stringify(meta.data.paymentLinks));
      ok('meta brands the logo route', meta.data.logoUrl === '/api/brand/logo');

      for (const role of ['owner', 'admin', 'operator']) {
        const page = await guest.get(`/portal/${role}/`);
        ok(`${role} portal HTML loads`, page.status === 200, String(page.status));
        ok(`${role} portal locks its role`, page.text.includes(`data-portal-role="${role}"`), 'role marker missing');
        ok(`${role} portal has no staff invitation code field`, !/Staff invitation code/i.test(page.text));
      }
      const generalPortal = await guest.get('/portal/');
      ok('shared portal still loads for all roles',
        generalPortal.status === 200 && generalPortal.text.includes('id="authCard"') && !generalPortal.text.includes('data-portal-role'));
    }

    /* 2. Direct staff and owner registration (no email/SMS verification) */
    {
      const adminRegClient = new Client();
      const adminReg = await adminRegClient.startRegistration({
        role: 'admin', name: 'QA Admin', email: 'qa-admin@example.com', phone: '09171234001',
        password: 'QaAdmin@123', confirmPassword: 'QaAdmin@123',
      });
      ok('admin registration creates the account immediately',
        adminReg.status === 200 && adminReg.data.user && adminReg.data.user.role === 'admin', JSON.stringify(adminReg.data));
      ok('admin lands on the admin dashboard', adminReg.data.home === '/admin/');
      ok('admin is signed in after register', Boolean(adminReg.data.csrf), JSON.stringify(adminReg.data));

      const operatorRegClient = new Client();
      const operatorReg = await operatorRegClient.startRegistration({
        role: 'operator', name: 'QA Operator', email: 'qa-operator@example.com', phone: '09171234002',
        password: 'QaOperator@123', confirmPassword: 'QaOperator@123',
      });
      ok('operator registration creates the account immediately',
        operatorReg.status === 200 && operatorReg.data.user && operatorReg.data.user.role === 'operator', JSON.stringify(operatorReg.data));
      ok('operator lands on the operator dashboard', operatorReg.data.home === '/operator/');

      const duplicate = await new Client().startRegistration({
        role: 'admin', name: 'QA Duplicate', email: 'qa-admin@example.com', phone: '09171234004',
        password: 'QaAdmin@123', confirmPassword: 'QaAdmin@123',
      });
      ok('duplicate email is rejected', duplicate.status === 409 && duplicate.data.error.field === 'email', JSON.stringify(duplicate.data));

      const weak = await new Client().startRegistration({
        role: 'operator', name: 'QA Weak', email: 'qa-weak@example.com', phone: '09171234005',
        password: 'password', confirmPassword: 'password',
      });
      ok('weak password is rejected', weak.status === 400 && weak.data.error.field === 'password', JSON.stringify(weak.data));

      const stalls = await guest.get('/api/store/stalls');
      const available = stalls.data.stalls.find((stall) => stall.occupancy === 'available');
      ok('at least one stall is available for registration', Boolean(available), JSON.stringify(stalls.data && stalls.data.stalls && stalls.data.stalls.map(s => s.occupancy)));
      const ownerRegClient = new Client();
      const ownerReg = await ownerRegClient.startRegistration({
        role: 'owner', stallId: available.id, name: 'QA Owner', email: 'qa-owner@example.com', phone: '09171234003',
        password: 'QaOwner@123', confirmPassword: 'QaOwner@123',
      });
      ok('owner registers against an available stall immediately',
        ownerReg.status === 200 && ownerReg.data.user && ownerReg.data.user.stallId === available.id, JSON.stringify(ownerReg.data));
      ok('owner lands on the owner dashboard', ownerReg.data.home === '/owner/');

      const secondOwner = await new Client().startRegistration({
        role: 'owner', stallId: available.id, name: 'QA Second Owner', email: 'qa-owner2@example.com', phone: '09171234006',
        password: 'QaOwner@123', confirmPassword: 'QaOwner@123',
      });
      ok('a stall cannot be claimed twice', secondOwner.status === 409, JSON.stringify(secondOwner.data));
    }

    /* 3. Admin settings, payment links, logo and providers */
    {
      await admin.login('admin@skyworld.ph', 'Admin@123');
      const settings = await admin.get('/api/admin/settings');
      ok('admin settings load', settings.status === 200);
      ok('logo starts unset while payment links have working defaults',
        settings.data.settings.logoUrl === ''
        && settings.data.settings.paymentLinks.gcash === 'https://www.gcash.com/'
        && settings.data.settings.paymentLinks.maya === 'https://www.maya.ph/'
        && settings.data.settings.paymentLinks.bank === 'https://www.bdo.com.ph/',
        JSON.stringify(settings.data.settings.paymentLinks));
      ok('admin sees providers not configured', settings.data.providers.email.configured === false && settings.data.providers.sms.configured === false);

      const update = await admin.req('PUT', '/api/admin/settings', {
        paymentLinks: {
          gcash: 'https://www.gcash.com/',
          maya: 'https://www.maya.ph/',
          bank: 'https://www.bdo.com.ph/',
        },
      });
      ok('admin saves payment page links', update.status === 200, JSON.stringify(update.data));
      const afterLinks = await guest.get('/api/meta');
      ok('storefront meta exposes saved payment links',
        afterLinks.data.paymentLinks.gcash === 'https://www.gcash.com/'
        && afterLinks.data.paymentLinks.maya === 'https://www.maya.ph/'
        && afterLinks.data.paymentLinks.bank === 'https://www.bdo.com.ph/');

      const badLink = await admin.req('PUT', '/api/admin/settings', { paymentLinks: { gcash: 'http://insecure.example.com/pay' } });
      ok('non-https payment link is rejected', badLink.status === 400 && badLink.data.error.field === 'paymentGcash', JSON.stringify(badLink.data));

      const badLogo = await admin.req('PUT', '/api/admin/settings', { logoUrl: 'javascript:alert(1)' });
      ok('unsafe logo URL is rejected', badLogo.status === 400 && badLogo.data.error.field === 'logoUrl', JSON.stringify(badLogo.data));

      const upload = await admin.req('POST', '/api/uploads', png, { raw: true, type: 'image/png' });
      ok('admin uploads a PNG logo', upload.status === 200 && /^\/uploads\/[A-Za-z0-9._-]+\.png$/.test(upload.data.url), JSON.stringify(upload.data));

      const setLogo = await admin.req('PUT', '/api/admin/settings', { logoUrl: upload.data.url });
      ok('admin saves uploaded logo', setLogo.status === 200);
      const served = await fetch(`${BASE}/api/brand/logo`);
      const servedBuffer = Buffer.from(await served.arrayBuffer());
      ok('brand route serves uploaded bytes', served.status === 200 && servedBuffer.equals(png), `${served.status} ${servedBuffer.length}`);
      ok('brand route sets image content type', served.headers.get('content-type') === 'image/png');

      const resetLogo = await admin.req('PUT', '/api/admin/settings', { logoUrl: '' });
      ok('admin can reset to default logo', resetLogo.status === 200);
      const fallback = await fetch(`${BASE}/api/brand/logo`);
      const fallbackText = await fallback.text();
      ok('default logo is served after reset', fallback.status === 200 && fallbackText.includes('<svg'), fallbackText.slice(0, 40));

      const testEmail = await admin.req('POST', '/api/admin/providers/test', { channel: 'email' });
      ok('provider test reports missing SMTP instead of faking delivery', testEmail.status === 400 && /not configured/i.test(testEmail.data.error.message), JSON.stringify(testEmail.data));

      const deliveryPanel = await admin.get('/api/admin/delivery');
      ok('delivery panel starts unconfigured', deliveryPanel.status === 200 && deliveryPanel.data.email.configured === false && deliveryPanel.data.email.source === 'none', JSON.stringify(deliveryPanel.data));

      const saveProvider = await admin.req('PUT', '/api/admin/delivery', {
        email: {
          enabled: true, host: '127.0.0.1', port: 9, secure: false,
          user: 'qa@example.com', pass: 'qa-secret', from: 'qa@example.com', fromName: 'QA Mailer',
        },
      });
      ok('admin saves SMTP credentials from the dashboard',
        saveProvider.status === 200 && saveProvider.data.email.configured === true && saveProvider.data.email.source === 'settings',
        JSON.stringify(saveProvider.data));
      ok('saved SMTP password is never returned', !JSON.stringify(saveProvider.data).includes('qa-secret'));
      const configuredSettings = await admin.get('/api/admin/settings');
      ok('settings page reflects the saved provider',
        configuredSettings.data.providers.email.configured === true && configuredSettings.data.providers.email.source === 'settings');
      const configuredTest = await admin.req('POST', '/api/admin/providers/test', { channel: 'email' });
      ok('provider test attempts real delivery and reports failure honestly',
        configuredTest.status === 200 && configuredTest.data.sent === false, JSON.stringify(configuredTest.data));

      const clearProvider = await admin.req('PUT', '/api/admin/delivery', { email: { enabled: false } });
      ok('admin can remove saved provider settings', clearProvider.status === 200 && clearProvider.data.email.configured === false, JSON.stringify(clearProvider.data));

      const forgot = await guest.req('POST', '/api/auth/forgot-password', { contact: 'qa-admin@example.com' });
      ok('password recovery uses the development code fallback',
        forgot.status === 200 && forgot.data.demo === true && /^\d{6}$/.test(forgot.data.devCode), JSON.stringify(forgot.data));
      const reset = await guest.req('POST', '/api/auth/reset-password', {
        contact: 'qa-admin@example.com', code: forgot.data.devCode,
        password: 'QaAdmin@456', confirmPassword: 'QaAdmin@456',
      });
      ok('a reset code changes the password', reset.status === 200, JSON.stringify(reset.data));
      await new Client().login('qa-admin@example.com', 'QaAdmin@456');
      ok('the reset password can sign in', true);
    }

    /* 4. Owner lease and commission editing */
    {
      await owner.login('owner@skyworld.ph', 'Owner@123');
      const before = await owner.get('/api/owner/stall');
      ok('owner stall endpoint includes lease, commission and platform rate',
        before.data.stall.lease && before.data.platformCommissionPct !== undefined, JSON.stringify(before.data));
      const original = before.data.stall;

      const saved = await owner.req('PUT', '/api/owner/stall', {
        commissionPct: 6,
        leaseStart: '2026-01-15',
        leaseEnd: '2027-01-14',
        leaseRent: '18500.50',
        leaseAreaSqm: '12.75',
        leaseNote: 'QA lease terms',
      });
      ok('owner saves lease and commission', saved.status === 200, JSON.stringify(saved.data));
      ok('saved commission is returned', saved.data.stall.commissionPct === 6);
      ok('saved lease fields are returned', saved.data.stall.lease.start === '2026-01-15'
        && saved.data.stall.lease.end === '2027-01-14'
        && saved.data.stall.lease.rentCents === 1850050
        && saved.data.stall.lease.areaSqm === '12.75'
        && saved.data.stall.lease.note === 'QA lease terms', JSON.stringify(saved.data.stall.lease));
      ok('editing lease clears the sample label', saved.data.stall.lease.isSample === false);

      const reloaded = await owner.get('/api/owner/stall');
      ok('lease and commission persist across requests', reloaded.data.stall.commissionPct === 6 && reloaded.data.stall.lease.note === 'QA lease terms');

      const badCommission = await owner.req('PUT', '/api/owner/stall', { commissionPct: 31 });
      ok('commission above 30% is rejected', badCommission.status === 400 && badCommission.data.error.field === 'commissionPct', JSON.stringify(badCommission.data));

      const badRange = await owner.req('PUT', '/api/owner/stall', { leaseStart: '2027-02-01', leaseEnd: '2027-01-01' });
      ok('lease end before start is rejected', badRange.status === 400 && badRange.data.error.field === 'leaseEnd', JSON.stringify(badRange.data));

      const badStatus = await owner.req('PUT', '/api/owner/stall', { operatingStatus: 'under_maintenance' });
      ok('owners cannot set staff-only statuses', badStatus.status === 403, JSON.stringify(badStatus.data));

      const adminAccess = await owner.get('/api/admin/overview');
      ok('owner cannot read admin data', adminAccess.status === 403);

      const operatorAccess = await owner.get('/api/operator/leases');
      ok('owner cannot read operator data', operatorAccess.status === 403);

      const restore = await owner.req('PUT', '/api/owner/stall', {
        commissionPct: original.commissionPct,
        leaseStart: original.lease.start || '',
        leaseEnd: original.lease.end || '',
        leaseRent: original.lease.rentCents === null ? '' : (original.lease.rentCents / 100).toFixed(2),
        leaseAreaSqm: original.lease.areaSqm || '',
        leaseNote: original.lease.note || '',
      });
      ok('owner can restore previous terms', restore.status === 200, JSON.stringify(restore.data));
    }

    /* 5. Operator workspace endpoints */
    {
      await operator.login('operator@skyworld.ph', 'Operator@123');
      for (const requestPath of ['/api/operator/overview', '/api/operator/stalls', '/api/operator/issues',
        '/api/operator/tickets', '/api/operator/visits?month=2026-10', '/api/operator/leases',
        '/api/operator/reports?period=daily', '/api/operator/feedback', '/api/operator/logs?limit=20']) {
        const res = await operator.get(requestPath);
        ok(`operator endpoint ${requestPath}`, res.status === 200, `${res.status} ${JSON.stringify(res.data).slice(0, 180)}`);
      }
      const adminDenied = await operator.get('/api/admin/settings');
      ok('operator cannot read platform settings', adminDenied.status === 403);
      const ownerDenied = await operator.get('/api/owner/stall');
      ok('operator cannot open the owner workspace', ownerDenied.status === 403);
    }

    /* 6. Guest checkout with a linked payment method */
    {
      const stalls = await guest.get('/api/store/stalls');
      let chosen = null;
      for (const stall of stalls.data.stalls) {
        if (stall.operatingStatus !== 'open') continue;
        const detail = await guest.get(`/api/store/stalls/${stall.id}`);
        const product = detail.data.products.find((entry) => entry.stock > 0);
        if (product) { chosen = { stall, product }; break; }
      }
      ok('a sellable product exists', Boolean(chosen));
      const item = {
        productId: chosen.product.id,
        color: chosen.product.colors[0] ? chosen.product.colors[0].name : '',
        size: chosen.product.sizes[0] || '',
        qty: 1,
      };
      const quote = await guest.req('POST', '/api/store/quote', { stallId: chosen.stall.id, items: [item] });
      ok('checkout quote is calculated', quote.status === 200, JSON.stringify(quote.data));
      const q = quote.data.quote;
      ok('quote totals use integer cents', Number.isInteger(q.totalCents) && q.totalCents === q.subtotalCents - q.productDiscountCents - q.voucherDiscountCents + q.shippingCents);

      const checkout = await guest.req('POST', '/api/store/checkout', {
        stallId: chosen.stall.id,
        idempotencyKey: `qa-checkout-${Date.now()}`,
        paymentMethod: 'GCash',
        voucherCode: '',
        items: [item],
        customer: {
          name: 'QA Buyer', email: 'qa-buyer@example.com', phone: '09171234099',
          address: '123 QA Street', city: 'Baguio', notes: 'QA run',
        },
      });
      ok('guest checkout succeeds', checkout.status === 200, JSON.stringify(checkout.data));
      const placedOrder = checkout.data.order;
      ok('order keeps the selected payment method', placedOrder.paymentMethod === 'GCash');
      ok('SMS is reported as not sent when unconfigured', checkout.data.smsConfigured === false && checkout.data.smsSent === false && /no sms provider/i.test(checkout.data.smsMessage));
      ok('placed order is labelled as live data, not sample', placedOrder.isSample === false);

      const lookup = await guest.req('POST', '/api/store/orders/lookup', { code: placedOrder.code, email: 'qa-buyer@example.com' });
      ok('order lookup finds the new order', lookup.status === 200 && lookup.data.order.code === placedOrder.code);

      const missing = await guest.req('POST', '/api/store/orders/lookup', { code: placedOrder.code, email: 'wrong@example.com' });
      ok('order lookup rejects a wrong contact detail', missing.status === 404);
    }

    /* 7. Report preview and CSV equality */
    {
      const preview = await admin.get('/api/admin/reports?period=annual&value=2026');
      ok('admin report preview loads', preview.status === 200 && preview.data.previewToken, JSON.stringify(preview.data).slice(0, 200));
      const csv = await admin.get(`/api/admin/reports.csv?period=annual&value=2026&preview=${preview.data.previewToken}`);
      const csvText = csv.text;
      const netValue = (preview.data.totals.netSalesCents / 100).toFixed(2);
      ok('CSV export uses the preview snapshot', csv.status === 200 && csvText.includes('Completed sales (Delivered)') && csvText.includes(netValue), `${csv.status} net=${netValue}`);
      ok('CSV lists the preview order count', csvText.includes(`Orders included,${preview.data.totals.orderCount}`));
      const reused = await admin.get(`/api/admin/reports.csv?period=annual&value=2026&preview=${preview.data.previewToken}`);
      ok('preview token returns the same snapshot within its TTL', reused.status === 200 && reused.text === csvText, String(reused.status));
    }
  } finally {
    await stopServer(child);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        fs.rmSync(TMP_DIR, { recursive: true, force: true });
        break;
      } catch (_) {
        await sleep(200);
      }
    }
  }

  if (failures.length) {
    console.error(`\n${failures.length} check(s) failed, ${passed} passed.`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n${passed} checks passed.`);
}

main().catch((error) => {
  console.error('\nTest run failed:');
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
