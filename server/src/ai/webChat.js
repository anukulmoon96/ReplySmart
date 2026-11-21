// "Web chat" mode: ReplySmart builds a prompt, the user pastes it into a chat
// website they're signed in to (ChatGPT, Gemini, Claude.ai), then pastes the
// answer back. Nothing is automated on those sites: the user drives them.

import { z } from 'zod';
import { HttpError } from '../errors.js';
import { SYSTEM_PROMPT, buildContextBlock, buildSuggestTask } from './prompt.js';
import { extractJson } from './shared.js';

export const WEB_CHATS = {
  'chatgpt-web': { id: 'chatgpt-web', label: 'ChatGPT', url: 'https://chatgpt.com/' },
  'gemini-web': { id: 'gemini-web', label: 'Gemini', url: 'https://gemini.google.com/app' },
  'claude-web': { id: 'claude-web', label: 'Claude.ai', url: 'https://claude.ai/new' },
};

const ANSWER_SHAPE = `{
  "analysis": {
    "summary": "one or two sentences on where the conversation stands",
    "pending": "what they're waiting on from me, or \\"Nothing pending\\"",
    "sentiment": "positive | neutral | negative | mixed",
    "urgency": "low | medium | high",
    "keyPoints": ["open questions or requests the reply should cover"]
  },
  "suggestions": [
    { "label": "2-4 word name for the approach", "text": "the exact message I'd send", "rationale": "when to pick this one" }
  ]
}`;

export function buildWebPrompt(conversation, options, maxPromptMessages) {
  const context = buildContextBlock(conversation, maxPromptMessages);
  const prompt = [
    SYSTEM_PROMPT,
    '',
    context.text,
    '',
    buildSuggestTask(conversation.me, options),
    '',
    `Answer with only a JSON code block in exactly this shape, with ${options.count} items in "suggestions":`,
    '```json',
    ANSWER_SHAPE,
    '```',
  ].join('\n');
  return { prompt, usedMessages: context.used, totalMessages: context.total };
}

const SENTIMENTS = ['positive', 'neutral', 'negative', 'mixed'];
const URGENCIES = ['low', 'medium', 'high'];
const MAX_SUGGESTIONS = 5;

// Chat websites don't guarantee the format, so accept partial or slightly-off answers.
const LenientAnswer = z.object({
  analysis: z
    .object({
      summary: z.string().catch(''),
      pending: z.string().catch(''),
      sentiment: z.enum(SENTIMENTS).catch('neutral'),
      urgency: z.enum(URGENCIES).catch('medium'),
      keyPoints: z.array(z.string()).catch([]),
    })
    .nullable()
    .catch(null),
  suggestions: z
    .array(
      z
        .object({ label: z.string().catch(''), text: z.string(), rationale: z.string().catch('') })
        .nullable()
        .catch(null),
    )
    .catch([]),
});

const NUMBERED_ITEM = /^\s*(?:[-*]\s*)?(?:\*\*)?(?:(?:option|reply|suggestion)\s*)?(\d{1,2})[.):]\s*(?:\*\*)?\s*/i;

function cleanReply(text) {
  return text
    .replace(/\*\*/g, '')
    .trim()
    .replace(/^["“](.*)["”]$/s, '$1')
    .trim();
}

function splitNumbered(text) {
  const items = [];
  let current = null;
  for (const line of text.split('\n')) {
    const m = NUMBERED_ITEM.exec(line);
    if (m) {
      current = [line.slice(m[0].length)];
      items.push(current);
    } else if (current) {
      current.push(line);
    }
  }
  return items.map((lines) => cleanReply(lines.join('\n'))).filter(Boolean);
}

/**
 * Turn an answer pasted from a chat website into `{ analysis, suggestions }`.
 * Prefers the JSON we asked for; falls back to a numbered list, then to the
 * whole answer as a single reply.
 */
export function parseWebAnswer(text) {
  const answer = String(text ?? '').trim();
  if (!answer) throw new HttpError(400, 'Paste the answer from the chat first.');

  const json = extractJson(answer);
  if (json) {
    const parsed = LenientAnswer.parse(json);
    const suggestions = parsed.suggestions
      .filter((s) => s?.text?.trim())
      .slice(0, MAX_SUGGESTIONS)
      .map((s, i) => ({ label: s.label.trim() || `Option ${i + 1}`, text: s.text.trim(), rationale: s.rationale.trim() }));
    if (!suggestions.length) {
      throw new HttpError(422, "That answer has no replies in it. Copy the chat's whole answer and try again.");
    }
    return { analysis: parsed.analysis?.summary ? parsed.analysis : null, suggestions, format: 'json' };
  }

  const numbered = splitNumbered(answer);
  if (numbered.length) {
    return {
      analysis: null,
      suggestions: numbered.slice(0, MAX_SUGGESTIONS).map((t, i) => ({ label: `Option ${i + 1}`, text: t, rationale: '' })),
      format: 'list',
    };
  }
  return { analysis: null, suggestions: [{ label: 'Reply', text: cleanReply(answer).slice(0, 5000), rationale: '' }], format: 'text' };
}
