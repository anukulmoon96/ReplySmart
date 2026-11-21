import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAiRegistryFromConfig } from '../src/ai/index.js';
import { loadConfig } from '../src/config.js';

const DEV = ['node', 'src/index.js', '--dev'];
const PROD = ['node', 'src/index.js'];

const providerIds = (env) => createAiRegistryFromConfig(loadConfig(env, PROD)).providers().map((p) => p.id);
const defaultId = (env) => createAiRegistryFromConfig(loadConfig(env, PROD)).defaultId;

test('in dev, PORT belongs to Vite, so the API ignores it', () => {
  assert.equal(loadConfig({ PORT: '5173' }, DEV).port, 5050);
  assert.equal(loadConfig({ PORT: '5173', API_PORT: '6000' }, DEV).port, 6000);
});

test('in production, the API honours a host-provided PORT', () => {
  assert.equal(loadConfig({ PORT: '8080' }, PROD).port, 8080);
  assert.equal(loadConfig({}, PROD).port, 5050);
});

test('providers are enabled by their keys; demo only when none are', () => {
  assert.deepEqual(providerIds({}), ['demo']);
  assert.deepEqual(providerIds({ GEMINI_API_KEY: 'g' }), ['gemini']);
  assert.deepEqual(providerIds({ GOOGLE_API_KEY: 'g' }), ['gemini']);
  assert.deepEqual(providerIds({ OPENAI_API_KEY: 'o', ANTHROPIC_API_KEY: 'a' }), ['claude', 'openai']);
  assert.deepEqual(providerIds({ OPENAI_COMPATIBLE_BASE_URL: 'http://localhost:11434/v1' }), ['demo'], 'needs a model too');
  assert.deepEqual(
    providerIds({ OPENAI_COMPATIBLE_BASE_URL: 'http://localhost:11434/v1', OPENAI_COMPATIBLE_MODEL: 'llama3.2' }),
    ['compatible'],
  );
});

test('default provider: AI_PROVIDER when available, else the first configured', () => {
  assert.equal(defaultId({ OPENAI_API_KEY: 'o', GEMINI_API_KEY: 'g' }), 'openai');
  assert.equal(defaultId({ OPENAI_API_KEY: 'o', GEMINI_API_KEY: 'g', AI_PROVIDER: 'gemini' }), 'gemini');
  assert.equal(defaultId({ GEMINI_API_KEY: 'g', AI_PROVIDER: 'openai' }), 'gemini', 'falls back when not configured');
  assert.equal(defaultId({ GEMINI_API_KEY: 'g', AI_PROVIDER: 'demo' }), 'demo');
  // AI_PROVIDER=claude enables Claude without a key (an `ant auth login` profile).
  assert.deepEqual(providerIds({ AI_PROVIDER: 'claude' }), ['claude']);
  // AI_MODE is the earlier name for AI_PROVIDER.
  assert.equal(defaultId({ ANTHROPIC_API_KEY: 'a', AI_MODE: 'demo' }), 'demo');
});

test('model defaults and labels', () => {
  const config = loadConfig(
    { OPENAI_COMPATIBLE_BASE_URL: 'http://x/v1', OPENAI_COMPATIBLE_MODEL: 'llama3.2', OPENAI_COMPATIBLE_NAME: 'Ollama' },
    PROD,
  );
  assert.equal(config.claude.model, 'claude-opus-5-5');
  assert.equal(config.claude.effort, 'low');
  assert.equal(config.openai.model, 'gpt-5.5');
  assert.equal(config.gemini.model, 'gemini-3.8-flash');
  assert.deepEqual(createAiRegistryFromConfig(config).providers(), [{ id: 'compatible', label: 'Ollama', model: 'llama3.2' }]);
  assert.equal(loadConfig({ CLAUDE_EFFORT: 'HIGH' }, PROD).claude.effort, 'high');
  assert.equal(loadConfig({ CLAUDE_EFFORT: 'extreme' }, PROD).claude.effort, 'low');
});
