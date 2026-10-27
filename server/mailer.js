'use strict';

const net = require('node:net');
const tls = require('node:tls');
const crypto = require('node:crypto');
const config = require('./config');

function encodeHeader(value) {
  const text = String(value || '');
  if (/[^\x20-\x7E]/.test(text)) return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
  return text.replace(/[\r\n]/g, ' ');
}

function extractAddress(value) {
  const match = /<([^>]+)>/.exec(String(value));
  return (match ? match[1] : String(value)).trim();
}

function base64Lines(value) {
  return Buffer.from(value, 'utf8').toString('base64').replace(/.{1,76}/g, '$&\r\n').trimEnd();
}

class SmtpConnection {
  constructor(socket, host) {
    this.socket = socket;
    this.host = host;
    this.buffer = '';
    this.queue = [];
    this.waiters = [];
    this.closed = false;
    this.attach(socket);
  }

  attach(socket) {
    socket.setTimeout(15000);
    socket.on('data', (chunk) => this.onData(chunk));
    socket.on('error', (error) => this.fail(error));
    socket.on('timeout', () => this.fail(new Error('SMTP connection timed out.')));
    socket.on('close', () => {
      this.closed = true;
      while (this.waiters.length) {
        this.waiters.shift().reject(new Error('SMTP connection closed unexpectedly.'));
      }
    });
  }

  drain() {
    for (;;) {
      const lines = this.buffer.split('\r\n');
      if (lines.length < 2) return;
      const first = lines[0];
      if (/^\d{3}-/.test(first)) {
        const end = lines.findIndex((line, index) => index > 0 && /^\d{3} /.test(line));
        if (end === -1) return;
        const response = lines.slice(0, end + 1).join('\n');
        this.buffer = lines.slice(end + 1).join('\r\n');
        if (this.waiters.length) this.waiters.shift().resolve(response);
        else this.queue.push(response);
        continue;
      }
      if (/^\d{3} /.test(first)) {
        this.buffer = lines.slice(1).join('\r\n');
        if (this.waiters.length) this.waiters.shift().resolve(first);
        else this.queue.push(first);
        continue;
      }
      lines.shift();
      this.buffer = lines.join('\r\n');
    }
  }

  onData(chunk) {
    this.buffer += chunk.toString('utf8');
    this.drain();
  }

  fail(error) {
    if (this.closed) return;
    this.closed = true;
    try { this.socket.destroy(); } catch (_) { /* noop */ }
    while (this.waiters.length) this.waiters.shift().reject(error);
  }

  readResponse() {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    if (this.closed) return Promise.reject(new Error('SMTP connection closed.'));
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  async command(line) {
    this.socket.write(`${line}\r\n`);
    return this.readResponse();
  }

  async upgrade() {
    const raw = this.socket;
    raw.removeAllListeners('data');
    raw.removeAllListeners('error');
    raw.removeAllListeners('timeout');
    raw.removeAllListeners('close');
    const socket = tls.connect({
      socket: raw,
      servername: this.host,
      rejectUnauthorized: true,
    });
    await new Promise((resolve, reject) => {
      socket.once('secureConnect', resolve);
      socket.once('error', reject);
    });
    this.socket = socket;
    this.buffer = '';
    this.closed = false;
    this.attach(socket);
  }

  async quit() {
    try { await this.command('QUIT'); } catch (_) { /* noop */ }
    try { this.socket.end(); } catch (_) { /* noop */ }
  }
}

function expectCode(response, codes, label) {
  const code = Number(String(response).slice(0, 3));
  if (!codes.includes(code)) {
    throw new Error(`SMTP ${label} failed with response code ${code}.`);
  }
}

async function sendSmtp({ to, subject, html, text }) {
  if (!config.smtp.configured) return { sent: false, reason: 'not_configured' };
  const host = config.smtp.host;
  const port = config.smtp.port;
  const socket = config.smtp.secure
    ? tls.connect({ host, port, servername: host, rejectUnauthorized: true })
    : net.connect({ host, port });
  const connection = new SmtpConnection(socket, host);

  try {
    if (config.smtp.secure) {
      await new Promise((resolve, reject) => {
        socket.once('secureConnect', resolve);
        socket.once('error', reject);
      });
    }
    const greeting = await connection.readResponse();
    expectCode(greeting, [220], 'greeting');

    let ehlo = await connection.command(`EHLO ${host}`);
    expectCode(ehlo, [250], 'EHLO');

    const supportsStartTls = /STARTTLS/i.test(ehlo);
    if (!config.smtp.secure && supportsStartTls) {
      const startTls = await connection.command('STARTTLS');
      expectCode(startTls, [220], 'STARTTLS');
      await connection.upgrade();
      ehlo = await connection.command(`EHLO ${host}`);
      expectCode(ehlo, [250], 'EHLO after STARTTLS');
    }

    if (config.smtp.user) {
      const supportsPlain = /AUTH[^\n]*PLAIN/i.test(ehlo);
      const supportsLogin = /AUTH[^\n]*LOGIN/i.test(ehlo);
      if (supportsLogin || !supportsPlain) {
        const auth = await connection.command('AUTH LOGIN');
        expectCode(auth, [334], 'AUTH LOGIN');
        const user = await connection.command(Buffer.from(config.smtp.user).toString('base64'));
        expectCode(user, [334], 'AUTH username');
        const pass = await connection.command(Buffer.from(config.smtp.pass).toString('base64'));
        expectCode(pass, [235], 'AUTH password');
      } else {
        const payload = Buffer.from(`\u0000${config.smtp.user}\u0000${config.smtp.pass}`).toString('base64');
        const auth = await connection.command(`AUTH PLAIN ${payload}`);
        expectCode(auth, [235], 'AUTH PLAIN');
      }
    }

    const from = extractAddress(config.smtp.from);
    const fromHeader = config.smtp.fromName
      ? `"${encodeHeader(config.smtp.fromName)}" <${from}>`
      : `<${from}>`;
    const mailFrom = await connection.command(`MAIL FROM:<${from}>`);
    expectCode(mailFrom, [250], 'MAIL FROM');
    const rcptTo = await connection.command(`RCPT TO:<${extractAddress(to)}>`);
    expectCode(rcptTo, [250, 251], 'RCPT TO');
    const data = await connection.command('DATA');
    expectCode(data, [354], 'DATA');

    const boundary = `skyworld-${crypto.randomBytes(10).toString('hex')}`;
    const message = [
      `From: ${fromHeader}`,
      `To: <${extractAddress(to)}>`,
      `Subject: ${encodeHeader(subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${crypto.randomUUID()}@skyworld>`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      base64Lines(text || ''),
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      base64Lines(html || ''),
      '',
      `--${boundary}--`,
      '',
    ].join('\r\n');
    const dotStuffed = message.replace(/\r\n\./g, '\r\n..');
    const delivered = await connection.command(`${dotStuffed}\r\n.`);
    expectCode(delivered, [250], 'message delivery');
    await connection.quit();
    return { sent: true, provider: 'smtp' };
  } catch (error) {
    try { connection.socket.destroy(); } catch (_) { /* noop */ }
    return { sent: false, reason: 'provider_error', error: error.message };
  }
}

function sendPasswordResetEmail({ to, name, code, expiresMinutes = 15 }) {
  return sendVerificationEmail({ to, name, code, expiresMinutes, purpose: 'password reset' });
}

function sendVerificationEmail({ to, name, code, expiresMinutes = 10, purpose = 'verification' }) {
  const safeName = encodeHeader(name || 'there');
  const subject = `SkyWorld Stall ${purpose} code`;
  const text = [
    `Hi ${name || 'there'},`,
    '',
    `Use this code to complete your SkyWorld Stall ${purpose}: ${code}`,
    `The code expires in ${expiresMinutes} minutes and can only be used once.`,
    '',
    'If you did not request this, you can ignore this email. Do not share this code.',
    '',
    'SkyWorld Stall',
  ].join('\n');
  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;padding:28px;background:#FAF4E8;border-radius:16px;color:#3A2A1C">
      <h2 style="margin:0 0 8px;color:#6F5236">${encodeHeader(purpose).replace(/^./, (char) => char.toUpperCase())}</h2>
      <p>Hi ${safeName},</p>
      <p>Use the code below to complete your SkyWorld Stall ${purpose}. It expires in ${expiresMinutes} minutes and can only be used once.</p>
      <div style="font-size:32px;letter-spacing:10px;font-weight:800;background:#F2E7D5;border:1px solid #D1B89A;border-radius:12px;padding:16px;text-align:center;margin:20px 0;color:#3E2D1E">${code}</div>
      <p style="font-size:13px;color:#7A6650">If you did not request this, you can ignore this email. Never share this code with anyone.</p>
      <p style="font-size:13px;color:#7A6650">SkyWorld Stall</p>
    </div>`;
  return sendSmtp({ to, subject, html, text });
}

module.exports = { sendSmtp, sendPasswordResetEmail, sendVerificationEmail };
