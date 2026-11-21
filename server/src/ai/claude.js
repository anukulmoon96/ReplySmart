import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { HttpError } from '../errors.js';
import { SYSTEM_PROMPT, buildContextBlock } from './prompt.js';
import { declined, defineProvider, incomplete } from './shared.js';

const LABEL = 'Claude';

/**
 * Reply suggestions from Claude. `client` can be injected for tests; otherwise
 * the SDK resolves credentials itself (ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN
 * or an `ant auth login` profile).
 */
export function createClaudeProvider({ model, effort, maxPromptMessages, client }) {
  let anthropic = client ?? null;

  function getClient() {
    if (!anthropic) {
      try {
        anthropic = new Anthropic({ timeout: 120_000, maxRetries: 1 });
      } catch (err) {
        throw new HttpError(502, `Claude isn't configured: ${err.message}`);
      }
    }
    return anthropic;
  }

  return defineProvider({ id: 'claude', label: LABEL, model, effort }, async (conversation, taskText, schema) => {
    const context = buildContextBlock(conversation, maxPromptMessages);
    let response;
    try {
      response = await getClient().beta.messages.parse({
        model,
        max_tokens: 16000,
        // If a safety classifier declines, the API re-runs the request on its recommended fallback model.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: SYSTEM_PROMPT,
        output_config: { effort, format: betaZodOutputFormat(schema) },
        messages: [
          {
            role: 'user',
            content: [
              // The transcript block is identical for every request about this conversation,
              // so regenerating or refining replies reads it from the prompt cache.
              { type: 'text', text: context.text, cache_control: { type: 'ephemeral' } },
              { type: 'text', text: taskText },
            ],
          },
        ],
      });
    } catch (err) {
      throw toHttpError(err);
    }

    if (response.stop_reason === 'refusal') {
      throw declined(LABEL, { category: response.stop_details?.category ?? null });
    }
    if (response.stop_reason === 'max_tokens' || !response.parsed_output) throw incomplete(LABEL);

    return {
      output: response.parsed_output,
      meta: {
        model: response.model,
        usedMessages: context.used,
        totalMessages: context.total,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        },
      },
    };
  });
}

function toHttpError(err) {
  if (err instanceof HttpError) return err;
  if (err instanceof Anthropic.AuthenticationError) {
    return new HttpError(502, 'Claude rejected the API credentials. Check ANTHROPIC_API_KEY in server/.env.');
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return new HttpError(502, "These API credentials don't have access to the configured Claude model.");
  }
  if (err instanceof Anthropic.NotFoundError) {
    return new HttpError(502, 'Claude model not found. Check CLAUDE_MODEL in server/.env.');
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new HttpError(429, 'Claude is rate limiting requests right now. Wait a moment and try again.');
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new HttpError(502, `Claude rejected the request: ${err.message}`);
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new HttpError(504, 'Claude took too long to respond. Please try again.');
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new HttpError(503, "Couldn't reach the Claude API. Check your internet connection.");
  }
  if (err instanceof Anthropic.APIError) {
    return new HttpError(502, `Claude API error (${err.status ?? 'unknown'}). Please try again.`);
  }
  return err;
}
