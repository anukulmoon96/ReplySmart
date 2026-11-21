import { isPlausibleName, tidy } from './utils.js';

// Text copied out of the Slack or Teams apps puts the author and time on a
// header line, with the message body on the lines below it:
//
//   Slack:        Maya Chen  9:41 AM          (name then time)
//   Teams:        [10:02 AM] Laura Bennett    (time then name)
//   New Teams:    Laura Bennett               (name, then time on its own line)
//                 Yesterday 10:02 AM

const TIME = String.raw`\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp]\.?[Mm]\.?)?`;
const WEEKDAY = String.raw`(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*`;
const MONTH = String.raw`(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?`;
const DATE = String.raw`(?:Today|Yesterday|${WEEKDAY}|\d{1,4}[./-]\d{1,2}(?:[./-]\d{1,4})?|${MONTH}\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?|\d{1,2}\s+${MONTH}(?:\s+\d{4})?)`;
const STAMP = String.raw`(?:${DATE},?\s+(?:at\s+)?)?${TIME}`;
const NAME = String.raw`[^\s:[\]<>@#][^:[\]<>\n]{0,59}?`;

const BRACKET_HEADER = new RegExp(String.raw`^\[(${STAMP})\]\s+(${NAME})$`, 'i');
const TRAILING_HEADER = new RegExp(String.raw`^(${NAME})\s+(${STAMP})$`, 'i');
const STAMP_ONLY = new RegExp(String.raw`^\[?(${STAMP})\]?$`, 'i');
const NOISE = /^(edited|\(edited\)|view thread|\d+ repl(y|ies)\b.*|new messages?)$/i;

function matchSingleHeader(line) {
  // "Yesterday 4:15 PM" is a bare timestamp, not a person called "Yesterday".
  if (STAMP_ONLY.test(line)) return null;
  let m = BRACKET_HEADER.exec(line);
  if (m && isPlausibleName(m[2])) return { sender: m[2].trim(), stamp: m[1], style: 'bracket' };
  m = TRAILING_HEADER.exec(line);
  if (m && isPlausibleName(m[1])) return { sender: m[1].trim(), stamp: m[2], style: 'trailing' };
  return null;
}

function isPairHeader(lines, i) {
  const next = lines[i + 1]?.trim();
  return Boolean(next) && isPlausibleName(lines[i]) && STAMP_ONLY.test(next);
}

/** Returns `{ messages, style }`, or null when the text has no recognisable headers. */
export function parseHeaderText(text) {
  const lines = text.split('\n').map((l) => l.trim());
  const singleHeaders = lines.filter((l) => matchSingleHeader(l)).length;
  const pairHeaders = singleHeaders ? 0 : lines.filter((l, i) => l && isPairHeader(lines, i)).length;
  if (!singleHeaders && !pairHeaders) return null;

  const messages = [];
  const styles = {};
  let current = null;
  const start = (sender, stamp, style) => {
    current = { sender, stamp, lines: [] };
    messages.push(current);
    if (style) styles[style] = (styles[style] || 0) + 1;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) {
      if (current) current.lines.push('');
      continue;
    }
    const header = matchSingleHeader(line);
    if (header) {
      start(header.sender, header.stamp, header.style);
      continue;
    }
    if (pairHeaders && isPairHeader(lines, i)) {
      start(line, STAMP_ONLY.exec(lines[i + 1])[1], 'pair');
      i += 1;
      continue;
    }
    const stampOnly = STAMP_ONLY.exec(line);
    if (stampOnly && current) {
      // Slack shows only a time for follow-up messages from the same person.
      start(current.sender, stampOnly[1]);
      continue;
    }
    if (current && !NOISE.test(line)) current.lines.push(line.replace(/\s*\(edited\)$/i, ''));
  }

  const style = Object.entries(styles).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'pair';
  return {
    style,
    messages: messages.map((m) => ({ sender: m.sender, text: tidy(m.lines.join('\n')), timestamp: null, timeLabel: m.stamp })),
  };
}
