import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ApiError } from '@google/genai';
import OpenAI from 'openai';
import { createGeminiProvider } from '../src/ai/gemini.js';
import { createOpenAiProvider } from '../src/ai/openai.js';
import { extractJson } from '../src/ai/shared.js';
import { buildWebPrompt, parseWebAnswer } from '../src/ai/webChat.js';
import { HttpError } from '../src/errors.js';

const conversation = {
  platform: 'whatsapp',
  participants: ['Priya', 'Rahul'],
  me: 'Rahul',
  messages: [
    { sender: 'Priya', text: 'Still on for Saturday?', timestamp: null, timeLabel: '9:02 AM' },
    { sender: 'Priya', text: 'Need to confirm the booking by tonight', timestamp: null, timeLabel: '6:48 PM' },
  ],
};
const options = { tone: 'friendly', length: 'short', instructions: '', count: 2 };

const output = {
  analysis: { summary: 'Plans for Saturday.', pending: 'Confirm the booking', sentiment: 'positive', urgency: 'high', keyPoints: [] },
  suggestions: [
    { label: 'Confirm', text: 'Yes! 7 works.', rationale: 'If you can make it.' },
    { label: 'Ask', text: 'What time?', rationale: 'If unsure.' },
    { label: 'Extra', text: 'Third', rationale: '' },
  ],
};

function fakeOpenAi(result) {
  const calls = [];
  return {
    calls,
    chat: {
      completions: {
        create: async (params) => {
          calls.push(params);
          if (result instanceof Error) throw result;
          return result;
        },
      },
    },
  };
}

const completion = (content, extra = {}) => ({
  model: 'gpt-5.5-2026-04-23',
  choices: [{ finish_reason: 'stop', message: { role: 'assistant', content, refusal: null }, ...extra }],
  usage: { prompt_tokens: 800, completion_tokens: 120, prompt_tokens_details: { cached_tokens: 512 } },
});

const openaiProvider = (client, overrides = {}) =>
  createOpenAiProvider({
    id: 'openai',
    label: 'ChatGPT (OpenAI)',
    keyHint: 'OPENAI_API_KEY',
    model: 'gpt-5.5',
    maxPromptMessages: 400,
    client,
    ...overrides,
  });

describe('OpenAI provider', () => {
  test('uses strict JSON-schema structured output and returns validated replies', async () => {
    const client = fakeOpenAi(completion(JSON.stringify(output)));
    const result = await openaiProvider(client).suggest({ conversation, options });

    const [params] = client.calls;
    assert.equal(params.model, 'gpt-5.5');
    assert.equal(params.max_completion_tokens, 16000);
    assert.equal(params.reasoning_effort, undefined);
    assert.equal(params.response_format.type, 'json_schema');
    assert.equal(params.response_format.json_schema.strict, true);
    assert.equal(params.response_format.json_schema.schema.additionalProperties, false);
    assert.equal(params.response_format.json_schema.schema.$schema, undefined);
    assert.equal(params.messages[0].role, 'system');
    assert.match(params.messages[1].content, /^Platform: WhatsApp[\s\S]*<\/transcript>\n\nWrite as: Rahul/);

    assert.deepEqual(result.suggestions.map((s) => s.label), ['Confirm', 'Ask']);
    assert.equal(result.model, 'gpt-5.5-2026-04-23');
    assert.deepEqual(result.usage, { inputTokens: 800, outputTokens: 120, cacheReadTokens: 512 });
  });

  test('sends reasoning_effort only when configured', async () => {
    const client = fakeOpenAi(completion(JSON.stringify({ text: 'Shorter.' })));
    const result = await openaiProvider(client, { reasoningEffort: 'low' }).refine({ conversation, text: 'Long text', instruction: 'Shorter' });
    assert.equal(client.calls[0].reasoning_effort, 'low');
    assert.equal(result.text, 'Shorter.');
  });

  test('OpenAI-compatible servers get the schema in the prompt and fenced JSON is accepted', async () => {
    const client = fakeOpenAi(completion(`Sure! Here you go:\n\`\`\`json\n${JSON.stringify(output)}\n\`\`\``));
    const provider = openaiProvider(client, { id: 'compatible', label: 'Ollama', model: 'llama3.2', compatible: true });
    const result = await provider.suggest({ conversation, options });

    const [params] = client.calls;
    assert.equal(params.response_format, undefined);
    assert.equal(params.max_tokens, 4096);
    assert.match(params.messages[1].content, /Respond with only a JSON object[\s\S]*"suggestions"/);
    assert.equal(result.suggestions.length, 2);
    assert.equal(provider.info.label, 'Ollama');
  });

  test('refusals, truncation, bad JSON and SDK errors map to HTTP errors', async () => {
    const refusal = completion(null);
    refusal.choices[0].message.refusal = "I can't help with that.";
    await assert.rejects(openaiProvider(fakeOpenAi(refusal)).suggest({ conversation, options }), (e) => e.status === 422);
    await assert.rejects(
      openaiProvider(fakeOpenAi(completion('{"analysis":', { finish_reason: 'length' }))).suggest({ conversation, options }),
      (e) => e.status === 502 && /incomplete/.test(e.message),
    );
    await assert.rejects(
      openaiProvider(fakeOpenAi(completion('not json'))).suggest({ conversation, options }),
      (e) => e.status === 502 && /expected format/.test(e.message),
    );

    const auth = new OpenAI.AuthenticationError(401, { message: 'bad key' }, 'bad key', new Headers());
    await assert.rejects(openaiProvider(fakeOpenAi(auth)).suggest({ conversation, options }), (e) => {
      assert.equal(e.status, 502);
      assert.match(e.message, /OPENAI_API_KEY/);
      return true;
    });
    const offline = new OpenAI.APIConnectionError({ message: 'ECONNREFUSED' });
    const local = openaiProvider(fakeOpenAi(offline), { label: 'Ollama', compatible: true });
    await assert.rejects(local.suggest({ conversation, options }), (e) => e.status === 503 && /OPENAI_COMPATIBLE_BASE_URL/.test(e.message));
  });
});

function fakeGemini(result) {
  const calls = [];
  return {
    calls,
    models: {
      generateContent: async (params) => {
        calls.push(params);
        if (result instanceof Error) throw result;
        return result;
      },
    },
  };
}

const geminiResponse = (text, extra = {}) => ({
  text,
  modelVersion: 'gemini-3.8-flash-001',
  candidates: [{ finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 700, candidatesTokenCount: 90, cachedContentTokenCount: 0 },
  ...extra,
});

const geminiProvider = (client) => createGeminiProvider({ apiKey: 'k', model: 'gemini-3.8-flash', maxPromptMessages: 400, client });

describe('Gemini provider', () => {
  test('sends the system prompt, transcript and JSON schema in the right fields', async () => {
    const client = fakeGemini(geminiResponse(JSON.stringify(output)));
    const result = await geminiProvider(client).suggest({ conversation, options });

    const [params] = client.calls;
    assert.equal(params.model, 'gemini-3.8-flash');
    assert.match(params.config.systemInstruction, /^You are ReplySmart/);
    assert.equal(params.config.responseMimeType, 'application/json');
    assert.deepEqual(params.config.responseJsonSchema.required, ['analysis', 'suggestions']);
    const [contextPart, taskPart] = params.contents[0].parts;
    assert.match(contextPart.text, /<transcript>/);
    assert.match(taskPart.text, /Write as: Rahul/);

    assert.equal(result.suggestions.length, 2);
    assert.equal(result.model, 'gemini-3.8-flash-001');
    assert.deepEqual(result.usage, { inputTokens: 700, outputTokens: 90, cacheReadTokens: 0 });
  });

  test('blocked prompts, safety stops and API errors map to HTTP errors', async () => {
    await assert.rejects(
      geminiProvider(fakeGemini(geminiResponse(undefined, { promptFeedback: { blockReason: 'SAFETY' }, candidates: [] }))).suggest({
        conversation,
        options,
      }),
      (e) => e.status === 422 && e.details.category === 'SAFETY',
    );
    await assert.rejects(
      geminiProvider(fakeGemini(geminiResponse('', { candidates: [{ finishReason: 'MAX_TOKENS' }] }))).suggest({ conversation, options }),
      (e) => e.status === 502,
    );
    const quota = new ApiError({ message: 'Resource exhausted', status: 429 });
    await assert.rejects(geminiProvider(fakeGemini(quota)).suggest({ conversation, options }), (e) => e.status === 429);
    const badKey = new ApiError({ message: 'API key not valid. Please pass a valid API key.', status: 400 });
    await assert.rejects(
      geminiProvider(fakeGemini(badKey)).suggest({ conversation, options }),
      (e) => e.status === 502 && /GEMINI_API_KEY/.test(e.message),
    );
  });
});

describe('JSON extraction', () => {
  test('finds JSON in plain, fenced and chatty answers', () => {
    assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
    assert.deepEqual(extractJson('Here:\n```json\n{"a":2}\n```\nHope that helps!'), { a: 2 });
    assert.deepEqual(extractJson('Sure {"a":3} done'), { a: 3 });
    assert.equal(extractJson('no json here'), undefined);
    assert.equal(extractJson(null), undefined);
  });
});

describe('web chat handoff', () => {
  test('the prompt is self-contained and asks for a JSON code block', () => {
    const { prompt, usedMessages, totalMessages } = buildWebPrompt(conversation, { ...options, count: 3 }, 400);
    assert.match(prompt, /^You are ReplySmart/);
    assert.match(prompt, /<transcript>[\s\S]*Need to confirm the booking by tonight[\s\S]*<\/transcript>/);
    assert.match(prompt, /Write as: Rahul/);
    assert.match(prompt, /with 3 items in "suggestions"/);
    assert.match(prompt, /```json\n\{\n {2}"analysis"/);
    assert.deepEqual([usedMessages, totalMessages], [2, 2]);
  });

  test('imports the JSON answer, even with chatter and loose values', () => {
    const pasted = `Here are some options!\n\`\`\`json\n${JSON.stringify({
      analysis: { summary: 'Booking needs confirming', pending: 'Reply tonight', sentiment: 'excited', urgency: 'high' },
      suggestions: [{ label: 'Confirm', text: ' Yes, 7 works! ' }, { text: 'Can we do 8?' }, { label: 'Empty', text: '  ' }],
    })}\n\`\`\``;
    const result = parseWebAnswer(pasted);
    assert.equal(result.format, 'json');
    assert.equal(result.analysis.sentiment, 'neutral', 'unknown values fall back');
    assert.deepEqual(result.analysis.keyPoints, []);
    assert.deepEqual(result.suggestions, [
      { label: 'Confirm', text: 'Yes, 7 works!', rationale: '' },
      { label: 'Option 2', text: 'Can we do 8?', rationale: '' },
    ]);
  });

  test('falls back to a numbered list, then to the whole answer', () => {
    const list = parseWebAnswer('Here are a few:\n\n1. **"Yes, 7 works!"**\n2) Could we do 8 instead?\nIt is easier for me.\nOption 3: Let me check and get back to you.');
    assert.equal(list.format, 'list');
    assert.equal(list.analysis, null);
    assert.deepEqual(list.suggestions.map((s) => s.text), [
      'Yes, 7 works!',
      'Could we do 8 instead?\nIt is easier for me.',
      'Let me check and get back to you.',
    ]);

    const single = parseWebAnswer('"Sounds great, see you at 7!"');
    assert.deepEqual(single.suggestions, [{ label: 'Reply', text: 'Sounds great, see you at 7!', rationale: '' }]);
  });

  test('empty answers and JSON without replies are rejected', () => {
    assert.throws(() => parseWebAnswer('   '), (e) => e instanceof HttpError && e.status === 400);
    assert.throws(() => parseWebAnswer('{"suggestions": []}'), (e) => e instanceof HttpError && e.status === 422);
  });
});
