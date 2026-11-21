/**
 * Strip the invisible direction marks and odd spaces that WhatsApp/Teams
 * exports sprinkle into text, and normalise line endings.
 */
export function normalizeText(input) {
  return String(input ?? '')
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[​-‏‪-‮⁦-⁩]/g, '')
    .replace(/[   ]/g, ' ');
}

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n <= 0x10ffff ? String.fromCodePoint(n) : match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

export function tidy(text) {
  return String(text ?? '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function htmlToText(html) {
  const text = String(html ?? '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li|h[1-6]|blockquote|tr)\s*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '');
  return tidy(decodeEntities(text));
}

export function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function byTimestamp(a, b) {
  return (a.timestamp?.getTime() ?? 0) - (b.timestamp?.getTime() ?? 0);
}

const NOT_NAME_WORDS = new Set([
  'a', 'about', 'after', 'am', 'an', 'and', 'are', 'around', 'at', 'be', 'before', 'by', 'call', 'can', 'for', 'from',
  'i', "i'll", "i'm", 'is', 'it', "it's", "let's", 'lets', 'meet', 'my', 'no', 'not', 'ok', 'okay', 'on', 'or', 'see',
  'so', 'the', 'till', 'to', 'until', 'was', 'we', 'will', 'with', 'yes', 'you',
]);

/**
 * Heuristic: could this line be a person's display name (as opposed to a
 * short message such as "see you at")? Used by the copy-paste parsers.
 */
export function isPlausibleName(value) {
  const name = value.trim();
  if (!name || name.length > 60) return false;
  if (/[:?!;,"“”<>[\]]/.test(name) || /^https?\b/i.test(name)) return false;
  const words = name.split(/\s+/);
  if (words.length > 5) return false;
  return !words.some((w) => NOT_NAME_WORDS.has(w.toLowerCase()));
}
