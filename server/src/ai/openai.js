import OpenAI from 'openai';
import { HttpError } from '../errors.js';
import { SYSTEM_PROMPT, buildContextBlock } from './prompt.js';
import { declined, defineProvider, incomplete, jsonInstructions, parseModelJson, toJsonSchema } from './shared.js';

/**
 * OpenAI's Chat Completions API. With `compatible: true` it targets any
 * OpenAI-compatible server (Ollama, LM Studio, Groq, OpenRouter...), which may
 * not support structured outputs, so the schema goes in the prompt instead.
 */
export function createOpenAiProvider({
  id,
  label,
  keyHint,
  apiKey,
  baseURL,
  model,
  reasoningEffort,
  compatible = false,
  maxPromptMessages,
  client,
}) {
  let openai = client ?? null;
  const getClient = () => {
    openai ??= new OpenAI({ apiKey, baseURL: baseURL || undefined, timeout: 120_000, maxRetries: 1 });
    return openai;
  };

  return defineProvider({ id, label, model }, async (conversation, taskText, schema, schemaName) => {
    const context = buildContextBlock(conversation, maxPromptMessages);
    // Transcript first: OpenAI caches identical prompt prefixes automatically.
    const userText = [context.text, taskText, compatible ? jsonInstructions(schema) : null].filter(Boolean).join('\n\n');
    const params = {
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userText },
      ],
    };
    if (compatible) {
      params.max_tokens = 4096;
    } else {
      params.max_completion_tokens = 16000;
      params.response_format = { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema: toJsonSchema(schema) } };
    }
    if (reasoningEffort) params.reasoning_effort = reasoningEffort;

    let completion;
    try {
      completion = await getClient().chat.completions.create(params);
    } catch (err) {
      throw toHttpError(err, { label, keyHint, compatible });
    }

    const choice = completion.choices?.[0];
    if (choice?.message?.refusal || choice?.finish_reason === 'content_filter') throw declined(label);
    if (choice?.finish_reason === 'length') throw incomplete(label);
    const output = parseModelJson(choice?.message?.content, schema);
    if (!output) throw new HttpError(502, `${label} didn't return replies in the expected format. Please try again.`);

    return {
      output,
      meta: {
        model: completion.model || model,
        usedMessages: context.used,
        totalMessages: context.total,
        usage: {
          inputTokens: completion.usage?.prompt_tokens ?? null,
          outputTokens: completion.usage?.completion_tokens ?? null,
          cacheReadTokens: completion.usage?.prompt_tokens_details?.cached_tokens ?? 0,
        },
      },
    };
  });
}

function toHttpError(err, { label, keyHint, compatible }) {
  if (err instanceof HttpError) return err;
  if (err instanceof OpenAI.AuthenticationError) {
    return new HttpError(502, `${label} rejected the API key. Check ${keyHint} in server/.env.`);
  }
  if (err instanceof OpenAI.PermissionDeniedError) {
    return new HttpError(502, `This ${label} API key doesn't have access to the configured model.`);
  }
  if (err instanceof OpenAI.NotFoundError) {
    return new HttpError(502, `${label} couldn't find the configured model. Check the model name in server/.env.`);
  }
  if (err instanceof OpenAI.RateLimitError) {
    return new HttpError(429, `${label} is rate limiting requests, or the account is out of quota. Wait a moment and try again.`);
  }
  if (err instanceof OpenAI.BadRequestError) {
    return new HttpError(502, `${label} rejected the request: ${err.message}`);
  }
  if (err instanceof OpenAI.APIConnectionTimeoutError) {
    return new HttpError(504, `${label} took too long to respond. Please try again.`);
  }
  if (err instanceof OpenAI.APIConnectionError) {
    return new HttpError(
      503,
      compatible
        ? `Couldn't reach ${label}. Is the server at OPENAI_COMPATIBLE_BASE_URL running?`
        : `Couldn't reach ${label}. Check your internet connection.`,
    );
  }
  if (err instanceof OpenAI.APIError) {
    return new HttpError(502, `${label} API error (${err.status ?? 'unknown'}). Please try again.`);
  }
  return err;
}
