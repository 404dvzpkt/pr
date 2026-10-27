'use strict';

const config = require('./config');

async function withTimeout(fn) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function sendSemaphore(to, message) {
  return withTimeout(async (signal) => {
    const response = await fetch('https://api.semaphore.co/api/v4/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apikey: config.sms.semaphoreApiKey,
        number: to,
        message,
        sendername: config.sms.semaphoreSender,
      }),
      signal,
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Semaphore responded ${response.status}.`);
    let id = '';
    try {
      const parsed = JSON.parse(body);
      id = Array.isArray(parsed) ? String(parsed[0]?.message_id || '') : String(parsed?.message_id || '');
    } catch (_) { /* response may be plain text */ }
    return { sent: true, provider: 'semaphore', messageId: id };
  });
}

async function sendTwilio(to, message) {
  return withTimeout(async (signal) => {
    const account = config.sms.twilioAccountSid;
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(account)}/Messages.json`;
    const auth = Buffer.from(`${account}:${config.sms.twilioAuthToken}`).toString('base64');
    const form = new URLSearchParams({
      To: to,
      From: config.sms.twilioFrom,
      Body: message,
    });
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
      signal,
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Twilio responded ${response.status}.`);
    let id = '';
    try { id = String(JSON.parse(body)?.sid || ''); } catch (_) { /* ignore */ }
    return { sent: true, provider: 'twilio', messageId: id };
  });
}

async function sendWebhook(to, message) {
  return withTimeout(async (signal) => {
    const response = await fetch(config.sms.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.sms.webhookToken ? { Authorization: `Bearer ${config.sms.webhookToken}` } : {}),
      },
      body: JSON.stringify({ to, message }),
      signal,
    });
    if (!response.ok) throw new Error(`SMS webhook responded ${response.status}.`);
    let id = '';
    try { id = String((await response.json())?.id || ''); } catch (_) { /* ignore */ }
    return { sent: true, provider: 'webhook', messageId: id };
  });
}

async function sendSms(to, message) {
  if (!config.sms.configured) {
    return { sent: false, reason: 'not_configured', error: 'No SMS provider is configured on the server.' };
  }
  try {
    if (config.sms.provider === 'semaphore') return await sendSemaphore(to, message);
    if (config.sms.provider === 'twilio') return await sendTwilio(to, message);
    if (config.sms.provider === 'webhook') return await sendWebhook(to, message);
    return { sent: false, reason: 'unknown_provider', error: 'Unsupported SMS_PROVIDER value.' };
  } catch (error) {
    return {
      sent: false,
      reason: 'provider_error',
      error: error.name === 'AbortError' ? 'SMS provider timed out.' : String(error.message || 'SMS delivery failed.'),
    };
  }
}

module.exports = { sendSms };
