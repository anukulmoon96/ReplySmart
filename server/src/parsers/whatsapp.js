import { tidy } from './utils.js';

// Matches both export styles:
//   Android: 11/18/26, 9:02 AM - Priya: Hey!
//   iOS:     [18/11/2026, 09:02:13] Priya: Hey!
const LINE =
  /^\[?(\d{1,4})[./-](\d{1,2})[./-](\d{1,4}),?\s+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?(?:\s*([AaPp])\.?\s?[Mm]\.?)?\]?\s*(?:[-–~]\s*)?(.*)$/;

export function looksLikeWhatsApp(text) {
  const lines = text.split('\n').filter((l) => l.trim()).slice(0, 300);
  const hits = lines.filter((l) => {
    const m = LINE.exec(l);
    return m && m[8].includes(': ');
  }).length;
  return hits >= 2 || (hits === 1 && lines.length <= 3);
}

export function parseWhatsApp(text) {
  const raw = [];
  let current = null;

  for (const line of text.split('\n')) {
    const m = LINE.exec(line);
    if (m) {
      const rest = m[8];
      const sep = rest.indexOf(': ');
      const sender = sep > 0 ? rest.slice(0, sep).trim() : '';
      if (sender && sender.length <= 60 && !/["“”]/.test(sender)) {
        current = {
          parts: [m[1], m[2], m[3]],
          hour: Number(m[4]),
          minute: Number(m[5]),
          second: Number(m[6] || 0),
          ampm: m[7] || null,
          sender,
          text: rest.slice(sep + 2),
        };
        raw.push(current);
      } else {
        // System line ("Messages are end-to-end encrypted", "Alice added Bob") - skip it.
        current = null;
      }
      continue;
    }
    if (current) current.text += `\n${line}`;
  }

  const order = detectDateOrder(raw);
  return raw.map((r) => ({
    sender: r.sender,
    text: cleanText(r.text),
    timestamp: buildDate(r, order),
    timeLabel: null,
  }));
}

function cleanText(text) {
  return tidy(
    text
      .replace(/<Media omitted>/gi, '[media omitted]')
      .replace(/<This message was edited>/gi, '')
      .replace(/^(image|video|audio|sticker|GIF|document) omitted$/gim, '[$1 omitted]'),
  );
}

/** WhatsApp uses the phone's locale, so work out DD/MM vs MM/DD from the data itself. */
function detectDateOrder(raw) {
  if (raw.some((r) => r.parts[0].length === 4)) return 'ymd';
  if (raw.some((r) => Number(r.parts[0]) > 12)) return 'dmy';
  if (raw.some((r) => Number(r.parts[1]) > 12)) return 'mdy';
  // Ambiguous (all days <= 12): 12-hour clocks are mostly US-style exports.
  return raw.some((r) => r.ampm) ? 'mdy' : 'dmy';
}

function buildDate(r, order) {
  const [a, b, c] = r.parts.map(Number);
  let year;
  let month;
  let day;
  if (order === 'ymd') [year, month, day] = [a, b, c];
  else if (order === 'dmy') [day, month, year] = [a, b, c];
  else [month, day, year] = [a, b, c];
  if (year < 100) year += 2000;

  let hour = r.hour;
  if (r.ampm) {
    const pm = r.ampm.toLowerCase() === 'p';
    if (hour === 12) hour = pm ? 12 : 0;
    else if (pm) hour += 12;
  }
  const date = new Date(year, month - 1, day, hour, r.minute, r.second);
  return Number.isNaN(date.getTime()) ? null : date;
}
