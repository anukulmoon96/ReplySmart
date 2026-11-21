import { HttpError } from '../errors.js';
import { parseGeneric } from './generic.js';
import { parseHeaderText } from './headerText.js';
import { isSlackExport, parseSlackExport } from './slack.js';
import { isTeamsExport, parseTeamsExport } from './teams.js';
import { normalizeText } from './utils.js';
import { looksLikeWhatsApp, parseWhatsApp } from './whatsapp.js';

export const MAX_STORED_MESSAGES = 5000;

const NO_MESSAGES_HELP =
  "Couldn't find any messages in that text. Paste a WhatsApp export (.txt), a Slack or Teams export (.json), " +
  'text copied from Slack/Teams, or lines like "Name: message".';

/**
 * Parse pasted or uploaded chat text into `{ platform, messages, participants, suggestedMe }`.
 * `platform` may be "auto" or a platform name; a named platform only overrides the label,
 * since every parser is tried so slightly-off formats still import.
 */
export function parseConversation(input, { platform = 'auto' } = {}) {
  const text = normalizeText(input);
  if (!text.trim()) throw new HttpError(400, 'Paste a conversation first.');
  const requested = platform && platform !== 'auto' ? platform : null;

  const json = tryParseJson(text);
  if (json !== undefined) {
    if (requested === 'teams' && isTeamsExport(json)) return finalize('teams', parseTeamsExport(json));
    if (isSlackExport(json)) return finalize(requested || 'slack', parseSlackExport(json));
    if (isTeamsExport(json)) return finalize(requested || 'teams', parseTeamsExport(json));
    throw new HttpError(422, "That JSON doesn't look like a Slack or Microsoft Teams export.");
  }

  if (looksLikeWhatsApp(text)) {
    const messages = parseWhatsApp(text);
    if (messages.length) return finalize(requested || 'whatsapp', messages);
  }

  const headed = parseHeaderText(text);
  if (headed?.messages.some((m) => m.text)) {
    return finalize(requested || (headed.style === 'trailing' ? 'slack' : 'teams'), headed.messages);
  }

  const generic = parseGeneric(text);
  if (generic) return finalize(requested || 'generic', generic);

  throw new HttpError(422, NO_MESSAGES_HELP);
}

function tryParseJson(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function finalize(platform, rawMessages) {
  let messages = rawMessages
    .map((m) => ({ ...m, sender: String(m.sender).trim().slice(0, 120), text: String(m.text).trim().slice(0, 20000) }))
    .filter((m) => m.sender && m.text);
  if (!messages.length) throw new HttpError(422, NO_MESSAGES_HELP);

  const totalParsed = messages.length;
  if (messages.length > MAX_STORED_MESSAGES) messages = messages.slice(-MAX_STORED_MESSAGES);

  const participants = uniqueSenders(messages);
  return {
    platform,
    messages,
    participants,
    suggestedMe: guessMe(messages, participants),
    totalParsed,
    droppedMessages: totalParsed - messages.length,
  };
}

export function uniqueSenders(messages) {
  return [...new Set(messages.map((m) => m.sender))];
}

/**
 * Guess which participant is the user. In a 1:1 chat it's whoever didn't send
 * the last message (that's who needs to reply); with one sender, it's "Me".
 */
export function guessMe(messages, participants) {
  const self = participants.find((p) => /^(you|me|myself)$/i.test(p));
  if (self) return self;
  if (participants.length < 2) return 'Me';
  const lastSender = messages.at(-1).sender;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].sender !== lastSender) return messages[i].sender;
  }
  return participants.find((p) => p !== lastSender);
}
