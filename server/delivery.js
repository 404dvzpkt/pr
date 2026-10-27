'use strict';

const config = require('./config');
const store = require('./db');
const mailer = require('./mailer');
const sms = require('./sms');
const providers = require('./providers');

const PURPOSES = {
  signup: 'registration',
  reset: 'password reset',
  test: 'delivery test',
};

function label(purpose) {
  return PURPOSES[purpose] || purpose || 'verification';
}

function maskContact(channel, contact) {
  return channel === 'email' ? providers.maskEmail(contact) : providers.maskPhone(contact);
}

function recordOutbox({ channel, recipient, purpose, code, reason }) {
  if (config.isProduction) return;
  try {
    store.run(
      'INSERT INTO delivery_outbox(channel, recipient, purpose, code, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [channel, recipient, label(purpose), code, reason || 'not_configured', new Date().toISOString()]
    );
    store.run('DELETE FROM delivery_outbox WHERE created_at < ?', [new Date(Date.now() - 2 * 86400000).toISOString()]);
  } catch (_) { /* the outbox is a development aid; never block delivery */ }
}

async function sendCode({ channel, to, name, code, purpose, expiresMinutes = 10 }) {
  const purposeLabel = label(purpose);
  let result;
  if (channel === 'email') {
    if (!config.smtp.configured) {
      result = { sent: false, reason: 'not_configured', error: 'No email provider is configured.' };
    } else {
      result = await mailer.sendVerificationEmail({
        to,
        name,
        code,
        expiresMinutes,
        purpose: purposeLabel,
      });
    }
  } else if (channel === 'phone') {
    if (!config.sms.configured) {
      result = { sent: false, reason: 'not_configured', error: 'No SMS provider is configured.' };
    } else {
      result = await sms.sendSms(
        to,
        `SkyWorld Stall: your ${purposeLabel} code is ${code}. It expires in ${expiresMinutes} minutes. Do not share this code.`
      );
    }
  } else {
    result = { sent: false, reason: 'invalid_channel', error: 'Choose email or mobile number.' };
  }

  const demo = !result.sent && result.reason === 'not_configured' && !config.isProduction;
  if (demo) recordOutbox({ channel, recipient: to, purpose, code, reason: result.reason });
  return {
    sent: Boolean(result.sent),
    provider: result.provider || '',
    reason: result.reason || '',
    error: result.error || '',
    demo,
    channel,
    contact: maskContact(channel, to),
  };
}

function recentOutbox(limit = 12) {
  if (config.isProduction) return [];
  return store.all(
    'SELECT id, channel, recipient, purpose, code, reason, created_at FROM delivery_outbox ORDER BY id DESC LIMIT ?',
    [Math.min(50, Math.max(1, limit))]
  ).map((row) => ({
    id: row.id,
    channel: row.channel,
    recipient: maskContact(row.channel, row.recipient),
    purpose: row.purpose,
    code: row.code,
    reason: row.reason,
    createdAt: row.created_at,
  }));
}

module.exports = { sendCode, recentOutbox, maskContact };
