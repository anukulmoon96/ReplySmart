import { HttpError } from '../errors.js';
import { createClaudeProvider } from './claude.js';
import { createDemoProvider } from './demo.js';
import { createGeminiProvider } from './gemini.js';
import { createOpenAiProvider } from './openai.js';
import { WEB_CHATS } from './webChat.js';

/** API providers, in the order "auto" picks a default from. */
export const API_PROVIDERS = ['claude', 'openai', 'gemini', 'compatible'];

/** A set of ready providers plus the default one. */
export function createAiRegistry(providers, preferredId) {
  const byId = new Map(providers.map((p) => [p.info.id, p]));
  const defaultId = byId.has(preferredId) ? preferredId : providers[0].info.id;
  return {
    defaultId,
    providers: () => providers.map((p) => p.info),
    webChats: () => Object.values(WEB_CHATS),
    has: (id) => byId.has(id),
    /** The provider for `id`, or the default when `id` is empty. */
    get(id) {
      const provider = byId.get(id || defaultId);
      if (!provider) {
        throw new HttpError(400, `The "${id}" AI provider isn't set up. Add its API key to server/.env and restart.`);
      }
      return provider;
    },
  };
}

export function createAiRegistryFromConfig(config) {
  const { maxPromptMessages } = config;
  const factories = {
    claude: () => createClaudeProvider({ ...config.claude, maxPromptMessages }),
    openai: () =>
      createOpenAiProvider({ id: 'openai', label: 'ChatGPT (OpenAI)', keyHint: 'OPENAI_API_KEY', ...config.openai, maxPromptMessages }),
    gemini: () => createGeminiProvider({ ...config.gemini, maxPromptMessages }),
    compatible: () =>
      createOpenAiProvider({
        id: 'compatible',
        label: config.compatible.name,
        keyHint: 'OPENAI_COMPATIBLE_API_KEY',
        compatible: true,
        ...config.compatible,
        maxPromptMessages,
      }),
  };

  const providers = API_PROVIDERS.filter((id) => config[id].enabled).map((id) => factories[id]());
  if (!providers.length || config.defaultProvider === 'demo') providers.push(createDemoProvider());
  return createAiRegistry(providers, config.defaultProvider);
}
