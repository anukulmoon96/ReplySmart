import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CLAUDE_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const PROVIDER_CHOICES = new Set(['auto', 'claude', 'openai', 'gemini', 'compatible', 'demo']);

export function loadConfig(env = process.env, argv = process.argv) {
  // In dev (`--dev`), PORT belongs to the Vite dev server, which proxies /api to API_PORT.
  // In production the API serves the built client, so it honours a host-provided PORT.
  const devMode = argv.includes('--dev');
  // AI_MODE is the variable's earlier name.
  const preferred = (env.AI_PROVIDER || env.AI_MODE || 'auto').toLowerCase();
  const claudeEffort = (env.CLAUDE_EFFORT || 'low').toLowerCase();
  const geminiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY || '';

  return {
    port: Number(env.API_PORT || (devMode ? '' : env.PORT)) || 5050,
    host: env.HOST || '127.0.0.1',
    mongoUri: env.MONGODB_URI || '',
    embeddedDbPath: env.EMBEDDED_DB_PATH || path.join(serverRoot, '.data', 'db'),
    maxPromptMessages: Number(env.MAX_PROMPT_MESSAGES) || 400,
    clientDist: path.resolve(serverRoot, '..', 'client', 'dist'),
    samplesDir: path.join(serverRoot, 'samples'),

    defaultProvider: PROVIDER_CHOICES.has(preferred) ? preferred : 'auto',
    claude: {
      // The SDK also finds `ant auth login` profiles on its own, so AI_PROVIDER=claude enables it without a key.
      enabled: Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_PROFILE) || preferred === 'claude',
      model: env.CLAUDE_MODEL || 'claude-opus-5-5',
      effort: CLAUDE_EFFORTS.has(claudeEffort) ? claudeEffort : 'low',
    },
    openai: {
      enabled: Boolean(env.OPENAI_API_KEY),
      apiKey: env.OPENAI_API_KEY || '',
      model: env.OPENAI_MODEL || 'gpt-5.5',
      reasoningEffort: env.OPENAI_REASONING_EFFORT || null,
    },
    gemini: {
      enabled: Boolean(geminiKey),
      apiKey: geminiKey,
      model: env.GEMINI_MODEL || 'gemini-3.8-flash',
    },
    // Any OpenAI-compatible server: Ollama, LM Studio, Groq, OpenRouter, Together, ...
    compatible: {
      enabled: Boolean(env.OPENAI_COMPATIBLE_BASE_URL && env.OPENAI_COMPATIBLE_MODEL),
      baseURL: env.OPENAI_COMPATIBLE_BASE_URL || '',
      apiKey: env.OPENAI_COMPATIBLE_API_KEY || 'not-needed',
      model: env.OPENAI_COMPATIBLE_MODEL || '',
      name: env.OPENAI_COMPATIBLE_NAME || 'Local model',
    },
  };
}
