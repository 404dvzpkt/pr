'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(path.join(ROOT, '.env'));

function env(name, fallback = '') {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function numberEnv(name, fallback) {
  const parsed = Number(env(name, String(fallback)));
  return Number.isFinite(parsed) ? parsed : fallback;
}

const nodeEnv = env('NODE_ENV', 'development');
const port = numberEnv('PORT', 3000);
const timezoneOffsetMinutes = numberEnv('TIMEZONE_OFFSET_MINUTES', 480);
const sessionDays = Math.min(30, Math.max(1, numberEnv('SESSION_DAYS', 7)));

const config = {
  root: ROOT,
  nodeEnv,
  isProduction: nodeEnv === 'production',
  port,
  host: env('HOST', '0.0.0.0'),
  appOrigin: env('APP_ORIGIN', `http://localhost:${port}`).replace(/\/+$/, ''),
  publicDir: path.join(ROOT, 'public'),
  dataDir: path.join(ROOT, 'data'),
  dbPath: path.resolve(ROOT, env('DB_PATH', 'data/skyworld.db')),
  providersFile: path.resolve(ROOT, env('PROVIDERS_FILE', 'data/providers.json')),
  uploadsDir: path.resolve(ROOT, env('UPLOADS_DIR', 'data/uploads')),
  timezoneOffsetMinutes,
  timezoneLabel: 'F. Calderon St. Baguio City, Benguet',
  sessionDays,
  maxUploadBytes: 5 * 1024 * 1024,
  maxJsonBytes: 1024 * 1024,
  maxBackupBytes: 20 * 1024 * 1024,
  skipSeed: env('SKIP_SEED', '0') === '1',
  resetPepper: env('RESET_PEPPER') || crypto.randomBytes(32).toString('hex'),
  resetPepperIsEphemeral: !env('RESET_PEPPER'),
  smtp: {
    host: env('SMTP_HOST'),
    port: numberEnv('SMTP_PORT', 587),
    secure: env('SMTP_SECURE', 'false') === 'true',
    user: env('SMTP_USER'),
    pass: env('SMTP_PASS'),
    from: env('SMTP_FROM'),
    fromName: env('SMTP_FROM_NAME', 'SkyWorld Stall'),
    support: env('SMTP_SUPPORT', env('SUPPORT_EMAIL', '')),
  },
  sms: {
    provider: env('SMS_PROVIDER').toLowerCase(),
    semaphoreApiKey: env('SEMAPHORE_API_KEY'),
    semaphoreSender: env('SEMAPHORE_SENDER_NAME', 'SkyWorld'),
    twilioAccountSid: env('TWILIO_ACCOUNT_SID'),
    twilioAuthToken: env('TWILIO_AUTH_TOKEN'),
    twilioFrom: env('TWILIO_FROM'),
    webhookUrl: env('SMS_WEBHOOK_URL'),
    webhookToken: env('SMS_WEBHOOK_TOKEN'),
  },
  demoMode: true,
};

config.smtp.configured = Boolean(config.smtp.host && config.smtp.from);
config.sms.configured = Boolean(
  (config.sms.provider === 'semaphore' && config.sms.semaphoreApiKey) ||
  (config.sms.provider === 'twilio' && config.sms.twilioAccountSid && config.sms.twilioAuthToken && config.sms.twilioFrom) ||
  (config.sms.provider === 'webhook' && config.sms.webhookUrl)
);

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.uploadsDir, { recursive: true });

module.exports = config;
