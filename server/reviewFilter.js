'use strict';

/*
 * Configurable comment moderation.
 * The filter normalises common bypass tricks (case, accents, leetspeak,
 * punctuation spacing and repeated characters) before matching. It is a
 * deterrent, not a guarantee: moderators still review flagged comments.
 */

const LEET = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b',
  '@': 'a', '$': 's', '!': 'i', '|': 'i',
};

function normalizeForMatch(value) {
  let text = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  text = text.replace(/[0134578@$!|]/g, (ch) => LEET[ch] || ch);
  text = text.replace(/(.)\1{2,}/g, '$1$1');
  text = text.replace(/[^a-z0-9]+/g, ' ').trim();
  return text;
}

function compact(value) {
  return normalizeForMatch(value).replace(/\s+/g, '');
}

function normalizeWordList(list) {
  if (!Array.isArray(list)) return [];
  const output = [];
  const seen = new Set();
  for (const item of list) {
    const phrase = String(item || '').trim().toLowerCase().slice(0, 60);
    if (!phrase) continue;
    const normalized = normalizeForMatch(phrase);
    if (!normalized || normalized.length < 3) continue;
    if (!seen.has(normalized)) {
      seen.add(normalized);
      output.push({ original: phrase, normalized, compact: compact(phrase) });
    }
  }
  return output;
}

function filterComment(comment, rawWords, settings = {}) {
  const text = String(comment || '');
  if (settings.enabled === false) {
    return { flagged: false, reason: '', categories: [] };
  }
  const categories = [];
  const details = [];
  const words = normalizeWordList(rawWords);

  const spaced = ` ${normalizeForMatch(text)} `;
  const squashed = compact(text);

  for (const word of words) {
    let hit = false;
    if (word.normalized.includes(' ')) {
      hit = spaced.includes(` ${word.normalized} `) || squashed.includes(word.compact);
    } else if (word.normalized.length >= 5) {
      hit = spaced.includes(` ${word.normalized} `) || squashed.includes(word.compact);
    } else {
      hit = spaced.includes(` ${word.normalized} `);
    }
    if (hit) {
      if (!categories.includes('prohibited-language')) categories.push('prohibited-language');
      details.push(word.original);
    }
  }

  const linkMatches = text.match(/https?:\/\/|www\./gi) || [];
  const repeated = /(.)\1{9,}/.test(text);
  const excessiveCaps = text.length > 24 && (text.replace(/[^A-Z]/g, '').length / text.length) > 0.75;
  if (linkMatches.length > 1 || repeated || excessiveCaps) {
    categories.push('spam-like');
  }
  if (text.length > 1000) categories.push('too-long');

  let reason = '';
  if (categories.includes('prohibited-language')) {
    reason = `Prohibited language: ${[...new Set(details)].slice(0, 4).join(', ')}`;
  } else if (categories.includes('spam-like')) {
    reason = 'Spam-like content (links, repeated characters, or excessive capitals).';
  } else if (categories.includes('too-long')) {
    reason = 'Comment is longer than the allowed length.';
  }

  return {
    flagged: categories.length > 0,
    reason,
    categories,
  };
}

module.exports = { filterComment, normalizeForMatch, normalizeWordList };
