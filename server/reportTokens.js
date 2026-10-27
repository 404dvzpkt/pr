'use strict';

const crypto = require('node:crypto');

const TTL_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 200;
const tokens = new Map();

function cleanup() {
  const now = Date.now();
  for (const [key, value] of tokens) {
    if (value.expires < now) tokens.delete(key);
  }
}

function store(report, meta) {
  cleanup();
  if (tokens.size >= MAX_ENTRIES) {
    const oldest = [...tokens.entries()].sort((a, b) => a[1].created - b[1].created)[0];
    if (oldest) tokens.delete(oldest[0]);
  }
  const token = crypto.randomBytes(24).toString('hex');
  tokens.set(token, { report, meta, created: Date.now(), expires: Date.now() + TTL_MS });
  return token;
}

function consume(token, meta) {
  cleanup();
  const entry = tokens.get(String(token || ''));
  if (!entry) return null;
  if (JSON.stringify(entry.meta) !== JSON.stringify(meta)) return null;
  return entry.report;
}

module.exports = { store, consume, TTL_MS };
