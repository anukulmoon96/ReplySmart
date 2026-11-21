import { z } from 'zod';
import { HttpError } from '../errors.js';
import { buildRefineTask, buildSuggestTask } from './prompt.js';
import { RefineOutput, SuggestionsOutput } from './schemas.js';

/**
 * Build a provider from one function, `run(conversation, taskText, schema, schemaName)`,
 * that sends the shared prompt to a model and resolves to `{ output, meta }`, where
 * `output` has already been validated against `schema`.
 */
export function defineProvider(info, run) {
  return {
    info,

    async suggest({ conversation, options }) {
      const task = buildSuggestTask(conversation.me, options);
      const { output, meta } = await run(conversation, task, SuggestionsOutput, 'reply_suggestions');
      const suggestions = output.suggestions.filter((s) => s.text.trim()).slice(0, options.count);
      if (!suggestions.length) throw new HttpError(502, `${info.label} returned no suggestions. Please try again.`);
      return { analysis: output.analysis, suggestions, ...meta };
    },

    async refine({ conversation, text, instruction }) {
      const task = buildRefineTask(conversation.me, text, instruction);
      const { output, meta } = await run(conversation, task, RefineOutput, 'refined_reply');
      return { text: output.text.trim(), ...meta };
    },
  };
}

/** JSON Schema for OpenAI strict mode and Gemini's responseJsonSchema (no $schema, no $refs). */
export function toJsonSchema(schema) {
  const { $schema, ...jsonSchema } = z.toJSONSchema(schema, { target: 'draft-7', reused: 'inline', io: 'output' });
  return jsonSchema;
}

/** For models without a structured-output mode: describe the schema in the prompt instead. */
export function jsonInstructions(schema) {
  return `Respond with only a JSON object, no other text, that matches this JSON Schema:\n${JSON.stringify(toJsonSchema(schema))}`;
}

/**
 * Pull a JSON object out of model text: tolerates ```json fences and prose around it.
 * Returns undefined when there is no parseable object.
 */
export function extractJson(text) {
  if (typeof text !== 'string') return undefined;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = [text.trim(), fenced?.[1]?.trim()];
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) candidates.push(text.slice(start, end + 1));
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === 'object') return value;
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

/** Extract and validate model JSON against a zod schema. Returns null when it doesn't fit. */
export function parseModelJson(text, schema) {
  const result = schema.safeParse(extractJson(text));
  return result.success ? result.data : null;
}

export function incomplete(label) {
  return new HttpError(502, `${label}'s response was incomplete. Please try again.`);
}

export function declined(label, details) {
  return new HttpError(422, `${label} declined to draft replies for this conversation.`, details);
}
