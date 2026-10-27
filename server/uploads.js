'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');
const { ApiError } = require('./errors');

const ALLOWED = {
  'image/jpeg': { ext: '.jpg', magic: (buffer) => buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
  'image/png': { ext: '.png', magic: (buffer) => buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/webp': {
    ext: '.webp',
    magic: (buffer) => buffer.length > 12
      && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
      && buffer.subarray(8, 12).toString('ascii') === 'WEBP',
  },
};

function normalizeType(value) {
  return String(value || '').split(';')[0].trim().toLowerCase();
}

function validateImage(buffer, declaredType) {
  const type = normalizeType(declaredType);
  const allowed = ALLOWED[type];
  if (!allowed) throw new ApiError(415, 'Upload a JPEG, PNG, or WebP image.');
  if (!buffer || buffer.length < 12) throw new ApiError(400, 'The image file is empty or unreadable.');
  if (buffer.length > config.maxUploadBytes) throw new ApiError(413, 'Images must be 5 MB or smaller.');
  if (!allowed.magic(buffer)) throw new ApiError(400, 'The file content does not match the declared image type.');
  return { ext: allowed.ext, type };
}

function saveImage(buffer, declaredType) {
  const { ext } = validateImage(buffer, declaredType);
  const name = `${Date.now().toString(36)}-${crypto.randomBytes(12).toString('hex')}${ext}`;
  const target = path.join(config.uploadsDir, name);
  fs.writeFileSync(target, buffer, { mode: 0o600 });
  return { url: `/uploads/${name}`, fileName: name, bytes: buffer.length };
}

module.exports = { validateImage, saveImage, normalizeType };
