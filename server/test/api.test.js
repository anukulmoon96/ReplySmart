import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { createDemoProvider } from '../src/ai/demo.js';
import { createAiRegistry } from '../src/ai/index.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const whatsapp = fs.readFileSync(path.join(here, '..', 'samples', 'whatsapp-weekend-plans.txt'), 'utf8');

let mongod;
let app;

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('replysmart-test'));
  const config = { ...loadConfig({}), clientDist: path.join(here, 'no-client-build') };
  app = createApp({ config, ai: createAiRegistry([createDemoProvider()]), dbKind: 'embedded' });
});

after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('meta endpoints', () => {
  test('health lists the AI providers and web chats', async () => {
    const res = await request(app).get('/api/health').expect(200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.db, 'embedded');
    assert.equal(res.body.ai.defaultProvider, 'demo');
    assert.deepEqual(res.body.ai.providers, [{ id: 'demo', label: 'Demo (no AI)', model: null }]);
    assert.deepEqual(
      res.body.ai.webChats.map((w) => [w.id, w.url]),
      [
        ['chatgpt-web', 'https://chatgpt.com/'],
        ['gemini-web', 'https://gemini.google.com/app'],
        ['claude-web', 'https://claude.ai/new'],
      ],
    );
  });

  test('samples include their text', async () => {
    const res = await request(app).get('/api/samples').expect(200);
    assert.equal(res.body.length, 3);
    assert.ok(res.body.every((s) => s.id && s.title && s.text.length > 100 && !('file' in s)));
  });

  test('parse previews without saving', async () => {
    const res = await request(app).post('/api/parse').send({ text: whatsapp }).expect(200);
    assert.equal(res.body.platform, 'whatsapp');
    assert.equal(res.body.messageCount, 7);
    assert.equal(res.body.suggestedMe, 'Rahul');
    assert.equal(res.body.preview.length, 4);
    const list = await request(app).get('/api/conversations').expect(200);
    assert.equal(list.body.length, 0);
  });

  test('parse validation errors', async () => {
    assert.equal((await request(app).post('/api/parse').send({ text: '' }).expect(400)).body.error, 'Paste a conversation first.');
    await request(app).post('/api/parse').send({ text: 'no senders here' }).expect(422);
    await request(app).post('/api/parse').send({ text: 'a: b', platform: 'myspace' }).expect(400);
    await request(app).post('/api/parse').set('Content-Type', 'application/json').send('{bad json').expect(400);
  });

  test('unknown API routes return JSON 404s', async () => {
    const res = await request(app).get('/api/nope').expect(404);
    assert.equal(res.body.error, 'Not found.');
  });
});

describe('conversation lifecycle', () => {
  test('import, suggest, refine, add messages, update and delete', async () => {
    const created = await request(app).post('/api/conversations').send({ text: whatsapp }).expect(201);
    const id = created.body.id;
    assert.equal(created.body.title, 'Priya, Rahul');
    assert.equal(created.body.me, 'Rahul');
    assert.equal(created.body.messages.length, 7);
    assert.equal(created.body.droppedMessages, 0);

    const list = await request(app).get('/api/conversations').expect(200);
    assert.equal(list.body[0].id, id);
    assert.equal(list.body[0].messageCount, 7);
    assert.equal(list.body[0].lastMessage.sender, 'Priya');

    const set = await request(app)
      .post(`/api/conversations/${id}/suggestions`)
      .send({ tone: 'casual', length: 'medium' })
      .expect(201);
    assert.equal(set.body.provider, 'demo');
    assert.equal(set.body.suggestions.length, 3);
    assert.ok(set.body.suggestions.every((s) => s.id && s.label && s.text));
    assert.equal(set.body.analysis.urgency, 'high'); // "confirm the booking by tonight"
    assert.deepEqual(set.body.options, { tone: 'casual', length: 'medium', instructions: '' });
    assert.equal(set.body.me, 'Rahul');

    const refined = await request(app)
      .post(`/api/conversations/${id}/refine`)
      .send({ text: "Hey Priya! I'm in. Let's do 7.", instruction: 'Make it more formal.' })
      .expect(200);
    assert.equal(refined.body.text, 'Hello Priya. I am in. Let us do 7.');

    const withReply = await request(app)
      .post(`/api/conversations/${id}/messages`)
      .send({ sender: 'Rahul', text: '7 works! Ananya is welcome 😊' })
      .expect(201);
    assert.equal(withReply.body.messages.length, 8);
    assert.equal(withReply.body.messages.at(-1).addedManually, true);

    const withNewPerson = await request(app)
      .post(`/api/conversations/${id}/messages`)
      .send({ sender: 'Ananya', text: 'Thanks for having me!' })
      .expect(201);
    assert.deepEqual(withNewPerson.body.participants, ['Priya', 'Rahul', 'Ananya']);

    const removed = await request(app)
      .delete(`/api/conversations/${id}/messages/${withNewPerson.body.messages.at(-1).id}`)
      .expect(200);
    assert.deepEqual(removed.body.participants, ['Priya', 'Rahul']);

    const patched = await request(app).patch(`/api/conversations/${id}`).send({ title: 'Saturday dinner', me: 'Priya' }).expect(200);
    assert.equal(patched.body.title, 'Saturday dinner');
    assert.equal(patched.body.me, 'Priya');
    await request(app).patch(`/api/conversations/${id}`).send({ me: '' }).expect(400);

    const full = await request(app).get(`/api/conversations/${id}`).expect(200);
    assert.equal(full.body.suggestionSets.length, 1);
    assert.equal(full.body.suggestionSets[0].id, set.body.id);

    await request(app).delete(`/api/conversations/${id}`).expect(204);
    await request(app).get(`/api/conversations/${id}`).expect(404);
    assert.equal(await mongoose.connection.collection('suggestionsets').countDocuments(), 0);
  });

  test('invalid ids and options are rejected cleanly', async () => {
    await request(app).get('/api/conversations/not-an-id').expect(404);
    await request(app).get(`/api/conversations/${new mongoose.Types.ObjectId()}`).expect(404);

    const { body } = await request(app).post('/api/conversations').send({ text: 'Ann: hi\nBob: hello' }).expect(201);
    const bad = await request(app).post(`/api/conversations/${body.id}/suggestions`).send({ tone: 'sarcastic' }).expect(400);
    assert.match(bad.body.error, /^tone:/);
    await request(app).post(`/api/conversations/${body.id}/suggestions`).send({ count: 9 }).expect(400);
    await request(app).post(`/api/conversations/${body.id}/messages`).send({ sender: 'Ann', text: '   ' }).expect(400);
    await request(app).delete(`/api/conversations/${body.id}/messages/${new mongoose.Types.ObjectId()}`).expect(404);
  });

  test('the chosen AI provider receives the conversation and options', async () => {
    const seen = [];
    const stub = {
      info: { id: 'claude', label: 'Claude', model: 'claude-opus-5-5' },
      async suggest(args) {
        seen.push(args);
        return {
          analysis: { summary: 's', pending: 'p', sentiment: 'neutral', urgency: 'low', keyPoints: [] },
          suggestions: [{ label: 'L', text: 'T', rationale: 'R' }],
          model: 'claude-opus-5-5',
          usedMessages: 2,
          totalMessages: 2,
          usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0 },
        };
      },
    };
    const registry = createAiRegistry([createDemoProvider(), stub], 'demo');
    const stubApp = createApp({ config: { ...loadConfig({}), clientDist: here }, ai: registry, dbKind: 'embedded' });
    const { body } = await request(stubApp).post('/api/conversations').send({ text: 'Ann: hi\nBob: hello', me: 'Ann' }).expect(201);
    const set = await request(stubApp)
      .post(`/api/conversations/${body.id}/suggestions`)
      .send({ provider: 'claude', tone: 'empathetic', instructions: '  keep it light  ', count: 1 })
      .expect(201);

    assert.equal(seen[0].conversation.me, 'Ann');
    assert.equal(seen[0].conversation.messages.length, 2);
    assert.deepEqual(seen[0].options, { provider: 'claude', tone: 'empathetic', length: 'short', instructions: 'keep it light', count: 1 });
    assert.equal(set.body.provider, 'claude');
    assert.equal(set.body.model, 'claude-opus-5-5');

    // Without a provider, the default (demo here) is used; an unknown one is a 400.
    const fallback = await request(stubApp).post(`/api/conversations/${body.id}/suggestions`).send({}).expect(201);
    assert.equal(fallback.body.provider, 'demo');
    const unknown = await request(stubApp).post(`/api/conversations/${body.id}/suggestions`).send({ provider: 'gemini' }).expect(400);
    assert.match(unknown.body.error, /"gemini" AI provider isn't set up/);
  });
});

describe('web chat handoff', () => {
  test('builds a prompt, imports the pasted answer, and refines with the default provider', async () => {
    const { body: convo } = await request(app).post('/api/conversations').send({ text: whatsapp }).expect(201);

    const prompt = await request(app)
      .post(`/api/conversations/${convo.id}/web-prompt`)
      .send({ target: 'gemini-web', tone: 'casual', count: 2 })
      .expect(200);
    assert.equal(prompt.body.url, 'https://gemini.google.com/app');
    assert.equal(prompt.body.label, 'Gemini');
    assert.match(prompt.body.prompt, /Write as: Rahul\nTone: casual/);
    assert.match(prompt.body.prompt, /with 2 items in "suggestions"/);
    await request(app).post(`/api/conversations/${convo.id}/web-prompt`).send({ target: 'bard' }).expect(400);

    const answer = '```json\n{"analysis":{"summary":"Dinner plans","pending":"Confirm 7pm and the cousin","sentiment":"positive","urgency":"high","keyPoints":["7pm?","Ananya joining?"]},"suggestions":[{"label":"All good","text":"7 works and Ananya is welcome!","rationale":"If both are fine"}]}\n```';
    const imported = await request(app)
      .post(`/api/conversations/${convo.id}/suggestions/import`)
      .send({ target: 'gemini-web', text: answer, tone: 'casual' })
      .expect(201);
    assert.equal(imported.body.provider, 'gemini-web');
    assert.equal(imported.body.model, null);
    assert.equal(imported.body.analysis.pending, 'Confirm 7pm and the cousin');
    assert.equal(imported.body.suggestions[0].text, '7 works and Ananya is welcome!');
    assert.equal(imported.body.totalMessages, 7);

    const plain = await request(app)
      .post(`/api/conversations/${convo.id}/suggestions/import`)
      .send({ target: 'chatgpt-web', text: 'Sounds good, see you at 7!' })
      .expect(201);
    assert.equal(plain.body.analysis, null);
    assert.equal(plain.body.suggestions[0].text, 'Sounds good, see you at 7!');

    await request(app).post(`/api/conversations/${convo.id}/suggestions/import`).send({ target: 'chatgpt-web', text: '' }).expect(400);

    // Web-chat sets have no API provider, so refining falls back to the default one.
    const refined = await request(app)
      .post(`/api/conversations/${convo.id}/refine`)
      .send({ text: 'Hey! 7 works.', instruction: 'Make it shorter.', provider: 'gemini-web' })
      .expect(200);
    assert.equal(refined.body.provider, 'demo');

    const full = await request(app).get(`/api/conversations/${convo.id}`).expect(200);
    assert.deepEqual(full.body.suggestionSets.map((s) => s.provider), ['chatgpt-web', 'gemini-web']);
  });
});
