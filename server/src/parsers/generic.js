import { tidy } from './utils.js';

// "Name: message", optionally prefixed with a time: "[10:32] Alice: hi", "10:32 PM - Bob: hey".
const LINE =
  /^(?:\[([^\]]{1,40})\]\s*|(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp]\.?[Mm]\.?)?)\s+(?:[-–]\s+)?)?([^:[\]\n]{1,40}?):\s+(.*)$/;

function isSenderLike(name) {
  const trimmed = name.trim();
  return Boolean(trimmed) && !/[?!;,]/.test(trimmed) && !/^https?$/i.test(trimmed) && trimmed.split(/\s+/).length <= 5;
}

export function parseGeneric(text) {
  const messages = [];
  let current = null;
  for (const line of text.split('\n')) {
    const m = LINE.exec(line.trim());
    if (m && isSenderLike(m[3])) {
      current = { sender: m[3].trim(), text: m[4], timestamp: null, timeLabel: m[1] || m[2] || null };
      messages.push(current);
    } else if (current) {
      current.text += `\n${line}`;
    }
  }
  if (!messages.length) return null;
  return messages.map((m) => ({ ...m, text: tidy(m.text) }));
}
