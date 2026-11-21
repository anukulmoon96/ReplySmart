import { createAiRegistryFromConfig } from './ai/index.js';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { connectDatabase } from './db.js';

const config = loadConfig();
const db = await connectDatabase(config);
const ai = createAiRegistryFromConfig(config);
const app = createApp({ config, ai, dbKind: db.kind });

const server = app.listen(config.port, config.host, () => {
  console.log(`ReplySmart API listening on http://${config.host}:${config.port}`);
  console.log(`Database: ${db.kind === 'embedded' ? `embedded MongoDB (${config.embeddedDbPath})` : 'MongoDB'}`);
  const providers = ai.providers();
  if (providers.every((p) => p.id === 'demo')) {
    console.log('AI: no API keys set - demo mode. Add a Claude, OpenAI or Gemini key to server/.env, or use the web-chat option.');
  } else {
    for (const p of providers) console.log(`AI: ${p.label}${p.model ? ` (${p.model})` : ''}${p.id === ai.defaultId ? ' [default]' : ''}`);
  }
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close();
  await db.stop().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
