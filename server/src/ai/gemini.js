import { ApiError, GoogleGenAI } from '@google/genai';
import { HttpError } from '../errors.js';
import { SYSTEM_PROMPT, buildContextBlock } from './prompt.js';
import { declined, defineProvider, incomplete, parseModelJson, toJsonSchema } from './shared.js';

const LABEL = 'Gemini';
const BLOCKED_FINISH_REASONS = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION']);

/** Google's Gemini API (free tier keys from https://aistudio.google.com/apikey work). */
export function createGeminiProvider({ apiKey, model, maxPromptMessages, client }) {
  let genai = client ?? null;
  const getClient = () => {
    genai ??= new GoogleGenAI({ apiKey, httpOptions: { timeout: 120_000 } });
    return genai;
  };

  return defineProvider({ id: 'gemini', label: LABEL, model }, async (conversation, taskText, schema) => {
    const context = buildContextBlock(conversation, maxPromptMessages);
    let response;
    try {
      response = await getClient().models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: context.text }, { text: taskText }] }],
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: 'application/json',
          responseJsonSchema: toJsonSchema(schema),
          maxOutputTokens: 16000,
        },
      });
    } catch (err) {
      throw toHttpError(err);
    }

    const blockReason = response.promptFeedback?.blockReason;
    const finishReason = response.candidates?.[0]?.finishReason;
    if (blockReason || BLOCKED_FINISH_REASONS.has(finishReason)) {
      throw declined(LABEL, { category: blockReason || finishReason });
    }
    if (finishReason === 'MAX_TOKENS') throw incomplete(LABEL);
    const output = parseModelJson(response.text, schema);
    if (!output) throw new HttpError(502, "Gemini didn't return replies in the expected format. Please try again.");

    const usage = response.usageMetadata ?? {};
    return {
      output,
      meta: {
        model: response.modelVersion || model,
        usedMessages: context.used,
        totalMessages: context.total,
        usage: {
          inputTokens: usage.promptTokenCount ?? null,
          outputTokens: usage.candidatesTokenCount ?? null,
          cacheReadTokens: usage.cachedContentTokenCount ?? 0,
        },
      },
    };
  });
}

function toHttpError(err) {
  if (err instanceof HttpError) return err;
  if (err instanceof ApiError) {
    if (err.status === 400 && /api key/i.test(err.message)) {
      return new HttpError(502, 'Gemini rejected the API key. Check GEMINI_API_KEY in server/.env.');
    }
    if (err.status === 401 || err.status === 403) {
      return new HttpError(502, "Gemini rejected the API key, or it doesn't have access to this model. Check GEMINI_API_KEY.");
    }
    if (err.status === 404) return new HttpError(502, 'Gemini model not found. Check GEMINI_MODEL in server/.env.');
    if (err.status === 429) {
      return new HttpError(429, 'Gemini is rate limiting requests (free-tier quotas are low). Wait a minute and try again.');
    }
    if (err.status === 400) return new HttpError(502, `Gemini rejected the request: ${err.message}`);
    return new HttpError(502, `Gemini API error (${err.status}). Please try again.`);
  }
  if (err?.name === 'AbortError' || /timed? ?out/i.test(err?.message ?? '')) {
    return new HttpError(504, 'Gemini took too long to respond. Please try again.');
  }
  if (err instanceof TypeError) {
    return new HttpError(503, "Couldn't reach Gemini. Check your internet connection.");
  }
  return err;
}
