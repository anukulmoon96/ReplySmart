import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { errorHandler, validate } from './errors.js';
import { parseConversation } from './parsers/index.js';
import { conversationsRouter, parseSchema } from './routes/conversations.js';

export function createApp({ config, ai, dbKind }) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    next();
  });
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      db: dbKind,
      ai: { defaultProvider: ai.defaultId, providers: ai.providers(), webChats: ai.webChats() },
    });
  });

  app.get('/api/samples', async (req, res) => {
    const list = JSON.parse(await fsp.readFile(path.join(config.samplesDir, 'index.json'), 'utf8'));
    const samples = await Promise.all(
      list.map(async ({ file, ...sample }) => ({
        ...sample,
        text: await fsp.readFile(path.join(config.samplesDir, file), 'utf8'),
      })),
    );
    res.json(samples);
  });

  // Parse without saving, for the live import preview.
  app.post('/api/parse', (req, res) => {
    const body = validate(parseSchema, req.body);
    const parsed = parseConversation(body.text, { platform: body.platform });
    res.json({
      platform: parsed.platform,
      participants: parsed.participants,
      suggestedMe: parsed.suggestedMe,
      messageCount: parsed.messages.length,
      droppedMessages: parsed.droppedMessages,
      preview: parsed.messages.slice(-4),
    });
  });

  app.use('/api/conversations', conversationsRouter({ ai, config }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  // Serve the built React app when it exists (npm run build).
  const indexHtml = path.join(config.clientDist, 'index.html');
  if (fs.existsSync(indexHtml)) {
    app.use(express.static(config.clientDist));
    app.get('/{*splat}', (req, res) => res.sendFile(indexHtml));
  }

  app.use(errorHandler);
  return app;
}
