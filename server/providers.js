'use strict';

const fs = require('node:fs');
const config = require('./config');

const FILE = config.providersFile;
const ENV_SMTP = { ...config.smtp };
const ENV_SMS = { ...config.sms };

function emailConfigured(smtp) {
  return Boolean(smtp && smtp.host && smtp.from);
}

function smsConfigured(sms) {
  if (!sms) return false;
  return Boolean(
    (sms.provider === 'semaphore' && sms.semaphoreApiKey) ||
    (sms.provider === 'twilio' && sms.twilioAccountSid && sms.twilioAuthToken && sms.twilioFrom) ||
    (sms.provider === 'webhook' && sms.webhookUrl)
  );
}

function readFile() {
  try {
    if (!fs.existsSync(FILE)) return {};
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

let saved = {};

function apply() {
  const email = saved.email && saved.email.enabled ? saved.email : null;
  const sms = saved.sms && saved.sms.enabled ? saved.sms : null;

  config.smtp = {
    ...ENV_SMTP,
    ...(email ? {
      host: email.host || ENV_SMTP.host,
      port: Number(email.port) || ENV_SMTP.port,
      secure: Boolean(email.secure),
      user: email.user || ENV_SMTP.user,
      pass: email.pass || ENV_SMTP.pass,
      from: email.from || ENV_SMTP.from,
      fromName: email.fromName || ENV_SMTP.fromName,
    } : {}),
  };
  config.smtp.configured = emailConfigured(config.smtp);
  config.smtp.source = email && config.smtp.configured ? 'settings' : (ENV_SMTP.configured ? 'environment' : 'none');

  config.sms = {
    ...ENV_SMS,
    ...(sms ? {
      provider: sms.provider || ENV_SMS.provider,
      semaphoreApiKey: sms.semaphoreApiKey || ENV_SMS.semaphoreApiKey,
      semaphoreSender: sms.semaphoreSender || ENV_SMS.semaphoreSender,
      twilioAccountSid: sms.twilioAccountSid || ENV_SMS.twilioAccountSid,
      twilioAuthToken: sms.twilioAuthToken || ENV_SMS.twilioAuthToken,
      twilioFrom: sms.twilioFrom || ENV_SMS.twilioFrom,
      webhookUrl: sms.webhookUrl || ENV_SMS.webhookUrl,
      webhookToken: sms.webhookToken || ENV_SMS.webhookToken,
    } : {}),
  };
  config.sms.configured = smsConfigured(config.sms);
  config.sms.source = sms && config.sms.configured ? 'settings' : (ENV_SMS.configured ? 'environment' : 'none');
}

function persist() {
  const payload = JSON.stringify(saved, null, 2);
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, payload, { mode: 0o600 });
  fs.renameSync(tmp, FILE);
  try { fs.chmodSync(FILE, 0o600); } catch (_) { /* Windows ignores POSIX modes */ }
}

function load() {
  saved = readFile();
  apply();
}

function maskEmail(value) {
  const text = String(value || '');
  const at = text.indexOf('@');
  if (at <= 0) return text ? '•••' : '';
  return `${text[0]}•••${text.slice(at)}`;
}

function maskPhone(value) {
  const text = String(value || '');
  return text.length > 4 ? `•••${text.slice(-4)}` : '•••';
}

function status() {
  return {
    email: {
      configured: config.smtp.configured,
      source: config.smtp.source || 'none',
      host: config.smtp.host || '',
      port: config.smtp.port || 587,
      secure: Boolean(config.smtp.secure),
      user: config.smtp.user ? maskEmail(config.smtp.user) : '',
      hasPassword: Boolean(config.smtp.pass),
      from: config.smtp.from || '',
      fromName: config.smtp.fromName || 'SkyWorld Stall',
    },
    sms: {
      configured: config.sms.configured,
      source: config.sms.source || 'none',
      provider: config.sms.provider || '',
      sender: config.sms.provider === 'semaphore' ? config.sms.semaphoreSender : config.sms.provider === 'twilio' ? config.sms.twilioFrom : '',
      hasApiKey: Boolean(config.sms.semaphoreApiKey || config.sms.twilioAuthToken || config.sms.webhookToken),
      hasWebhook: Boolean(config.sms.webhookUrl),
    },
    outbox: config.isProduction ? [] : recentOutbox(),
  };
}

function recentOutbox() {
  try {
    const store = require('./db');
    return store.all(
      'SELECT id, channel, recipient, purpose, code, reason, created_at FROM delivery_outbox ORDER BY id DESC LIMIT 8'
    ).map((row) => ({
      id: row.id,
      channel: row.channel,
      recipient: row.channel === 'email' ? maskEmail(row.recipient) : maskPhone(row.recipient),
      purpose: row.purpose,
      code: row.code,
      reason: row.reason,
      createdAt: row.created_at,
    }));
  } catch (_) {
    return [];
  }
}

function saveEmail(input) {
  const current = saved.email || {};
  const enable = input.enabled !== false;
  const host = String(input.host ?? current.host ?? '').trim();
  const from = String(input.from ?? current.from ?? '').trim();
  const port = Number(input.port ?? current.port ?? 587);
  const secure = input.secure === undefined ? Boolean(current.secure) : Boolean(input.secure);
  const user = typeof input.user === 'string' && input.user !== '' ? input.user.trim() : (current.user || '');
  const fromName = String(input.fromName ?? current.fromName ?? 'SkyWorld Stall').trim().slice(0, 80);
  const pass = typeof input.pass === 'string' && input.pass !== '' ? input.pass : (current.pass || '');
  if (enable) {
    if (!host) throw new Error('Enter the SMTP host, for example smtp.gmail.com.');
    if (!Number.isFinite(port) || port < 1 || port > 65535) throw new Error('Enter a valid SMTP port.');
    if (!from || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from)) throw new Error('Enter a valid sender email address.');
  }
  saved.email = { enabled: enable, host: enable ? host : '', port, secure, user, pass: enable ? pass : '', from: enable ? from : '', fromName };
}

function saveSms(input) {
  const current = saved.sms || {};
  const enable = input.enabled !== false;
  const provider = String(input.provider ?? current.provider ?? '').trim().toLowerCase();
  if (enable && !['semaphore', 'twilio', 'webhook'].includes(provider)) {
    throw new Error('Choose an SMS provider: Semaphore, Twilio, or webhook.');
  }
  const keep = (key) => (typeof input[key] === 'string' && input[key] !== '' ? input[key] : (current[key] || ''));
  const record = {
    enabled: enable,
    provider: enable ? provider : '',
    semaphoreApiKey: enable ? keep('semaphoreApiKey') : '',
    semaphoreSender: String(input.semaphoreSender ?? current.semaphoreSender ?? 'SkyWorld').trim().slice(0, 32),
    twilioAccountSid: enable ? keep('twilioAccountSid') : '',
    twilioAuthToken: enable ? keep('twilioAuthToken') : '',
    twilioFrom: String(input.twilioFrom ?? current.twilioFrom ?? '').trim(),
    webhookUrl: enable ? String(input.webhookUrl ?? current.webhookUrl ?? '').trim() : '',
    webhookToken: enable ? keep('webhookToken') : '',
  };
  if (enable) {
    if (provider === 'semaphore' && !record.semaphoreApiKey) throw new Error('Enter the Semaphore API key.');
    if (provider === 'twilio' && (!record.twilioAccountSid || !record.twilioAuthToken || !record.twilioFrom)) {
      throw new Error('Enter the Twilio Account SID, Auth Token, and sender number.');
    }
    if (provider === 'webhook' && !/^https:\/\//i.test(record.webhookUrl)) {
      throw new Error('Enter an https:// webhook URL for SMS delivery.');
    }
  }
  saved.sms = record;
}

function save(input) {
  if (input.email) saveEmail(input.email);
  if (input.sms) saveSms(input.sms);
  if (!saved.email || !saved.email.host) delete saved.email;
  if (!saved.sms || !saved.sms.provider) delete saved.sms;
  persist();
  apply();
  return status();
}

function clearEmail() {
  delete saved.email;
  persist();
  apply();
  return status();
}

function clearSms() {
  delete saved.sms;
  persist();
  apply();
  return status();
}

load();

module.exports = { load, save, clearEmail, clearSms, status, maskEmail, maskPhone };
