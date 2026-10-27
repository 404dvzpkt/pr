'use strict';

/*
 * Deterministic, locally-stored product artwork.
 * Seeded products get a clean SVG illustration per colour, so every colour
 * variant has a real image and the store stays usable offline.
 */

const fs = require('node:fs');
const path = require('node:path');

function escapeXml(value) {
  return String(value ?? '').replace(/[<>&"']/g, (ch) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
  }[ch]));
}

function clamp(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function shade(hex, amount) {
  const clean = String(hex || '#B79A76').replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const target = amount < 0 ? 0 : 255;
  const ratio = Math.abs(amount);
  return `#${[r, g, b].map((channel) => clamp(channel + (target - channel) * ratio).toString(16).padStart(2, '0')).join('')}`;
}

function luminance(hex) {
  const clean = String(hex || '#000000').replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'color';
}

function shortName(value) {
  const text = String(value || '');
  return text.length > 28 ? `${text.slice(0, 27)}…` : text;
}

function bagShape(fill, stroke) {
  return `
    <path d="M218 252 C218 166 382 166 382 252" fill="none" stroke="${stroke}" stroke-width="18" stroke-linecap="round"/>
    <rect x="162" y="248" width="276" height="210" rx="30" fill="${fill}" stroke="${stroke}" stroke-width="4"/>
    <path d="M162 300 Q300 350 438 300" fill="none" stroke="${stroke}" stroke-width="3" opacity=".45"/>
    <rect x="270" y="270" width="60" height="26" rx="8" fill="${shade(fill, -0.18)}" opacity=".65"/>
    <circle cx="300" cy="283" r="5" fill="${shade(fill, -0.55)}"/>
  `;
}

function dressShape(fill, stroke) {
  return `
    <path d="M248 152 L280 138 Q300 154 320 138 L352 152 L338 210 L316 204 L318 248 L405 458 Q300 486 195 458 L282 248 L284 204 L262 210 Z"
      fill="${fill}" stroke="${stroke}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M278 150 Q300 178 322 150" fill="none" stroke="${stroke}" stroke-width="3" opacity=".45"/>
    <path d="M282 250 Q300 260 318 250" fill="none" stroke="${stroke}" stroke-width="3" opacity=".3"/>
    <path d="M255 384 Q300 400 345 384" fill="none" stroke="${stroke}" stroke-width="2" opacity=".25"/>
  `;
}

function pantsShape(fill, stroke) {
  return `
    <path d="M238 145 H362 L356 245 L344 456 Q308 462 296 456 L300 288 L300 456 Q288 462 252 456 L244 245 Z"
      fill="${fill}" stroke="${stroke}" stroke-width="4" stroke-linejoin="round"/>
    <rect x="234" y="142" width="132" height="24" rx="8" fill="${shade(fill, -0.2)}"/>
    <path d="M300 166 V288" stroke="${stroke}" stroke-width="2" opacity=".3"/>
  `;
}

function shirtShape(fill, stroke) {
  return `
    <path d="M238 166 L278 140 Q300 168 322 140 L362 166 L420 240 L372 272 L360 234 L360 450 Q300 470 240 450 L240 234 L228 272 L180 240 Z"
      fill="${fill}" stroke="${stroke}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M278 140 Q300 184 322 140" fill="none" stroke="${stroke}" stroke-width="3" opacity=".5"/>
    <path d="M240 382 Q300 396 360 382" fill="none" stroke="${stroke}" stroke-width="2" opacity=".25"/>
  `;
}

function tankShape(fill, stroke) {
  return `
    <path d="M262 146 Q276 164 300 164 Q324 164 338 146 L356 236 L344 450 Q300 462 256 450 L244 236 Z"
      fill="${fill}" stroke="${stroke}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M276 158 Q278 198 260 236 M324 158 Q322 198 340 236" fill="none" stroke="${stroke}" stroke-width="3" opacity=".4"/>
  `;
}

function jacketShape(fill, stroke) {
  return `
    <path d="M232 172 L278 140 Q300 160 322 140 L368 172 L430 248 L384 284 L366 240 L368 458 Q300 474 232 458 L234 240 L216 284 L170 248 Z"
      fill="${fill}" stroke="${stroke}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M300 178 V458" stroke="${stroke}" stroke-width="3"/>
    <path d="M278 140 L300 190 L322 140 L340 156 L300 220 L260 156 Z" fill="${shade(fill, -0.14)}" stroke="${stroke}" stroke-width="2"/>
    <path d="M240 360 H282 M318 360 H360" stroke="${stroke}" stroke-width="3" opacity=".35"/>
    <circle cx="300" cy="238" r="5" fill="${shade(fill, -0.5)}"/>
  `;
}

function shoeShape(fill, stroke) {
  return `
    <path d="M138 404 C170 352 236 336 300 344 L370 352 C424 358 468 386 474 420 L468 440 C398 460 226 460 148 442 Z"
      fill="${fill}" stroke="${stroke}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M150 438 Q300 458 466 438 M176 400 Q258 382 330 394" fill="none" stroke="${stroke}" stroke-width="3" opacity=".4"/>
    <path d="M260 354 L244 400 M292 358 L276 404 M324 365 L310 410" stroke="#FFF9EF" stroke-width="6" opacity=".8"/>
    <path d="M420 376 Q452 393 458 420" fill="none" stroke="${stroke}" stroke-width="3" opacity=".35"/>
    <rect x="144" y="430" width="330" height="14" rx="7" fill="#FFF9EF" opacity=".85"/>
  `;
}

function watchShape(fill, stroke) {
  return `
    <rect x="266" y="160" width="68" height="96" rx="20" fill="${shade(fill, -0.18)}" stroke="${stroke}" stroke-width="3"/>
    <rect x="266" y="344" width="68" height="96" rx="20" fill="${shade(fill, -0.18)}" stroke="${stroke}" stroke-width="3"/>
    <circle cx="300" cy="300" r="82" fill="${fill}" stroke="${stroke}" stroke-width="5"/>
    <circle cx="300" cy="300" r="66" fill="#FFF9EF" opacity=".9"/>
    <path d="M300 300 V252 M300 300 L336 318" stroke="${stroke}" stroke-width="4" stroke-linecap="round"/>
    <circle cx="300" cy="300" r="5" fill="${stroke}"/>
  `;
}

function sunglassesShape(fill, stroke) {
  return `
    <path d="M168 282 Q300 244 432 282" fill="none" stroke="${stroke}" stroke-width="12" stroke-linecap="round"/>
    <rect x="174" y="280" width="112" height="82" rx="34" fill="${fill}" stroke="${stroke}" stroke-width="4"/>
    <rect x="314" y="280" width="112" height="82" rx="34" fill="${fill}" stroke="${stroke}" stroke-width="4"/>
    <path d="M286 296 Q300 286 314 296" fill="none" stroke="${stroke}" stroke-width="5"/>
    <path d="M174 292 L146 270 M426 292 L454 270" stroke="${stroke}" stroke-width="7" stroke-linecap="round"/>
  `;
}

function jewelleryShape(fill, stroke) {
  return `
    <path d="M192 190 Q300 318 408 190" fill="none" stroke="${shade(fill, -0.3)}" stroke-width="6" stroke-linecap="round"/>
    <path d="M236 216 Q300 274 364 216" fill="none" stroke="${stroke}" stroke-width="2" opacity=".3"/>
    <path d="M300 290 L346 330 L300 410 L254 330 Z" fill="${fill}" stroke="${stroke}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M254 330 H346 M300 290 V410" stroke="${stroke}" stroke-width="2" opacity=".4"/>
  `;
}

function capShape(fill, stroke) {
  return `
    <path d="M190 330 Q190 210 300 206 Q410 210 410 330 Z" fill="${fill}" stroke="${stroke}" stroke-width="4"/>
    <path d="M190 330 Q300 356 442 356 Q468 356 470 374 Q470 390 440 390 Q300 390 180 354 Q164 346 190 330 Z"
      fill="${shade(fill, -0.16)}" stroke="${stroke}" stroke-width="3"/>
    <path d="M300 208 V330 M300 208 Q360 220 388 282" fill="none" stroke="${stroke}" stroke-width="2" opacity=".3"/>
  `;
}

function beltShape(fill, stroke) {
  return `
    <rect x="128" y="278" width="310" height="46" rx="14" fill="${fill}" stroke="${stroke}" stroke-width="4"/>
    <rect x="414" y="258" width="72" height="86" rx="14" fill="none" stroke="${shade(fill, -0.45)}" stroke-width="8"/>
    <path d="M446 258 V344" stroke="${shade(fill, -0.45)}" stroke-width="5"/>
    <circle cx="180" cy="301" r="7" fill="${shade(fill, -0.45)}"/>
    <circle cx="222" cy="301" r="7" fill="${shade(fill, -0.45)}"/>
  `;
}

function tumblerShape(fill, stroke) {
  return `
    <path d="M236 172 H364 L348 452 Q300 468 252 452 Z" fill="${fill}" stroke="${stroke}" stroke-width="4"/>
    <rect x="230" y="148" width="140" height="30" rx="12" fill="${shade(fill, -0.2)}" stroke="${stroke}" stroke-width="3"/>
    <path d="M340 182 Q394 218 382 282 Q374 320 348 328" fill="none" stroke="${stroke}" stroke-width="12" opacity=".35"/>
    <path d="M272 250 H328" stroke="#FFF9EF" stroke-width="12" opacity=".4" stroke-linecap="round"/>
  `;
}

function candleShape(fill, stroke) {
  return `
    <rect x="192" y="300" width="216" height="152" rx="18" fill="${fill}" stroke="${stroke}" stroke-width="4"/>
    <ellipse cx="300" cy="302" rx="108" ry="18" fill="${shade(fill, 0.18)}" stroke="${stroke}" stroke-width="3"/>
    <path d="M300 300 V262" stroke="${stroke}" stroke-width="5"/>
    <path d="M300 262 Q274 234 300 194 Q328 234 300 262 Z" fill="#E8A33D" stroke="${stroke}" stroke-width="3"/>
    <path d="M228 358 Q300 380 372 358" fill="none" stroke="${stroke}" stroke-width="2" opacity=".25"/>
  `;
}

function umbrellaShape(fill, stroke) {
  return `
    <path d="M168 298 Q180 174 300 168 Q420 174 432 298 Q378 270 342 298 Q320 270 300 272 Q280 270 258 298 Q222 270 168 298 Z"
      fill="${fill}" stroke="${stroke}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M300 170 V392 Q300 438 252 438 Q222 438 220 410" fill="none" stroke="${stroke}" stroke-width="8" stroke-linecap="round"/>
    <path d="M300 170 Q238 224 220 292 M300 170 Q362 224 380 292" fill="none" stroke="${stroke}" stroke-width="2" opacity=".3"/>
  `;
}

function giftShape(fill, stroke) {
  return `
    <rect x="174" y="290" width="252" height="172" rx="18" fill="${fill}" stroke="${stroke}" stroke-width="4"/>
    <rect x="156" y="244" width="288" height="62" rx="14" fill="${shade(fill, -0.15)}" stroke="${stroke}" stroke-width="4"/>
    <path d="M300 244 V462" stroke="${shade(fill, -0.45)}" stroke-width="18" opacity=".55"/>
    <path d="M300 246 Q232 226 226 186 Q286 182 300 246 Q314 182 374 186 Q368 226 300 246 Z" fill="${shade(fill, 0.28)}" stroke="${stroke}" stroke-width="3"/>
  `;
}

function shapeFor(category, name, fill, stroke) {
  const lower = String(name || '').toLowerCase();
  if (category === 'Bags') return bagShape(fill, stroke);
  if (category === 'Shoes') return shoeShape(fill, stroke);
  if (category === 'Jackets') return jacketShape(fill, stroke);
  if (category === 'Clothes') {
    if (lower.includes('dress')) return dressShape(fill, stroke);
    if (/(jeans|pants|shorts|jogger|skirt)/.test(lower)) return pantsShape(fill, stroke);
    if (/(tank|sando)/.test(lower)) return tankShape(fill, stroke);
    return shirtShape(fill, stroke);
  }
  if (category === 'Accessories') {
    if (lower.includes('watch')) return watchShape(fill, stroke);
    if (lower.includes('sunn') || lower.includes('glass')) return sunglassesShape(fill, stroke);
    if (lower.includes('belt')) return beltShape(fill, stroke);
    if (lower.includes('cap') || lower.includes('hat')) return capShape(fill, stroke);
    return jewelleryShape(fill, stroke);
  }
  if (lower.includes('tumbler') || lower.includes('bottle')) return tumblerShape(fill, stroke);
  if (lower.includes('candle')) return candleShape(fill, stroke);
  if (lower.includes('umbrella')) return umbrellaShape(fill, stroke);
  return giftShape(fill, stroke);
}

function productArtSvg({ name, category, colorName, hex, variantIndex = 0 }) {
  const fill = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#B79A76';
  const stroke = luminance(fill) > 0.62 ? '#4B3928' : shade(fill, -0.5);
  const bgA = ['#F5EBDC', '#F2E7D6', '#EFE1CD', '#F5EADB'][variantIndex % 4];
  const bgB = ['#E2CDB1', '#DDC6A8', '#D9C3A6', '#E5D2B6'][variantIndex % 4];
  const title = shortName(name);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600" role="img" aria-label="${escapeXml(name)} in ${escapeXml(colorName)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${bgA}"/><stop offset="1" stop-color="${bgB}"/>
    </linearGradient>
    <radialGradient id="halo" cx="50%" cy="45%" r="52%">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity=".72"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
    <filter id="soft" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#4B3928" flood-opacity=".18"/>
    </filter>
    <pattern id="lines" width="26" height="26" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="26" stroke="#7A6040" stroke-opacity=".055" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="600" height="600" fill="url(#bg)"/>
  <rect width="600" height="600" fill="url(#lines)"/>
  <circle cx="300" cy="305" r="228" fill="url(#halo)"/>
  <circle cx="524" cy="86" r="54" fill="#FFFFFF" fill-opacity=".24"/>
  <circle cx="72" cy="512" r="86" fill="#FFFFFF" fill-opacity=".16"/>
  <g opacity=".55" fill="none" stroke="#7A6040" stroke-width="1.2">
    <circle cx="518" cy="474" r="28"/><circle cx="518" cy="474" r="44"/>
  </g>
  <text x="46" y="64" font-family="Segoe UI, Arial, sans-serif" font-size="15" letter-spacing="4" font-weight="700" fill="#7A6040" opacity=".8">${escapeXml(String(category).toUpperCase())}</text>
  <g font-family="Segoe UI, Arial, sans-serif" fill="#5A4630">
    <text x="554" y="60" font-size="13" letter-spacing="2.4" text-anchor="end" font-weight="700" opacity=".65">SKYWORLD</text>
    <text x="554" y="78" font-size="9" letter-spacing="2" text-anchor="end" opacity=".45">SAMPLE CATALOG</text>
  </g>
  <ellipse cx="300" cy="474" rx="150" ry="24" fill="#4B3928" opacity=".12"/>
  <g filter="url(#soft)">
    ${shapeFor(category, name, fill, stroke)}
  </g>
  <g font-family="Georgia, serif" fill="#3E2D1E">
    <text x="46" y="516" font-size="25" font-weight="700">${escapeXml(title)}</text>
  </g>
  <g font-family="Segoe UI, Arial, sans-serif">
    <rect x="46" y="534" width="${Math.max(84, 58 + String(colorName).length * 7)}" height="30" rx="15" fill="#FFFFFF" fill-opacity=".62"/>
    <circle cx="64" cy="549" r="7" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>
    <text x="80" y="554" font-size="12" font-weight="700" fill="#5A4630">${escapeXml(colorName)}</text>
    <text x="554" y="552" font-size="11" letter-spacing="1.8" text-anchor="end" fill="#7A6040" opacity=".6">SKYWORLD MARKET</text>
  </g>
</svg>`;
}

function writeProductArt(publicDir, product) {
  const outDir = path.join(publicDir, 'shared', 'products');
  fs.mkdirSync(outDir, { recursive: true });
  const colors = Array.isArray(product.colors) ? product.colors : [];
  const files = [];
  const resolvedColors = colors.map((color, index) => {
    const name = String(color.name || `Colour ${index + 1}`);
    const hex = /^#[0-9a-fA-F]{6}$/.test(color.hex || '') ? color.hex : '#B79A76';
    const base = `p${product.id}-${slug(name)}`;
    let fileName = `${base}.svg`;
    let counter = 2;
    while (files.includes(fileName)) {
      fileName = `${base}-${counter}.svg`;
      counter += 1;
    }
    files.push(fileName);
    const svg = productArtSvg({
      name: product.name,
      category: product.category,
      colorName: name,
      hex,
      variantIndex: index,
    });
    fs.writeFileSync(path.join(outDir, fileName), svg, 'utf8');
    return {
      name,
      hex,
      image: `/shared/products/${fileName}`,
    };
  });
  return {
    colors: resolvedColors,
    images: resolvedColors.map((color) => color.image),
  };
}

module.exports = { productArtSvg, writeProductArt, slug, escapeXml };
