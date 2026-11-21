import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { LENGTHS, TONES } from '../ai/prompt.js';
import { WEB_CHATS, buildWebPrompt, parseWebAnswer } from '../ai/webChat.js';
import { HttpError, validate } from '../errors.js';
import { Conversation, PLATFORMS } from '../models/Conversation.js';
import { SuggestionSet } from '../models/SuggestionSet.js';
import { parseConversation, uniqueSenders } from '../parsers/index.js';

const MAX_TEXT = 5_000_000;
const platformInput = z.enum(['auto', ...PLATFORMS]).default('auto');
const name = z.string().trim().min(1).max(120);

export const parseSchema = z.object({
  text: z.string().max(MAX_TEXT),
  platform: platformInput,
});

const createSchema = parseSchema.extend({
  title: z.string().trim().max(120).optional(),
  me: name.optional(),
});

const updateSchema = z.object({
  title: name.optional(),
  me: name.optional(),
  platform: z.enum(PLATFORMS).optional(),
});

const messageSchema = z.object({
  sender: name,
  text: z.string().trim().min(1).max(20000),
});

const replyOptions = {
  tone: z.enum(Object.keys(TONES)).default('friendly'),
  length: z.enum(Object.keys(LENGTHS)).default('short'),
  instructions: z.string().trim().max(500).default(''),
  count: z.number().int().min(1).max(5).default(3),
};
const providerId = z.string().trim().max(40).optional();
const webChatId = z.enum(Object.keys(WEB_CHATS));

const suggestSchema = z.object({ ...replyOptions, provider: providerId });

const refineSchema = z.object({
  text: z.string().trim().min(1).max(5000),
  instruction: z.string().trim().min(1).max(300),
  provider: providerId,
});

const webPromptSchema = z.object({ ...replyOptions, target: webChatId });

const importSchema = z.object({
  ...replyOptions,
  target: webChatId,
  text: z.string().max(100_000),
});

function defaultTitle(participants) {
  const shown = participants.slice(0, 3).join(', ');
  return participants.length > 3 ? `${shown} +${participants.length - 3}` : shown;
}

function truncate(text, max) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

async function findConversation(id) {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'Conversation not found.');
  const conversation = await Conversation.findById(id);
  if (!conversation) throw new HttpError(404, 'Conversation not found.');
  return conversation;
}

function touch(id) {
  return Conversation.updateOne({ _id: id }, { $set: { updatedAt: new Date() } }, { timestamps: false });
}

export function serializeConversation(c) {
  return {
    id: String(c._id),
    title: c.title,
    platform: c.platform,
    participants: c.participants,
    me: c.me,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    messages: c.messages.map((m) => ({
      id: String(m._id),
      sender: m.sender,
      text: m.text,
      timestamp: m.timestamp,
      timeLabel: m.timeLabel,
      addedManually: m.addedManually,
    })),
  };
}

function serializeSet(s) {
  return {
    id: String(s._id),
    me: s.me,
    options: s.options,
    analysis: s.analysis?.summary ? s.analysis : null,
    suggestions: s.suggestions.map((x) => ({ id: String(x._id), label: x.label, text: x.text, rationale: x.rationale })),
    provider: s.provider ?? s.mode,
    model: s.model,
    usedMessages: s.usedMessages,
    totalMessages: s.totalMessages,
    usage: s.usage,
    createdAt: s.createdAt,
  };
}

export function conversationsRouter({ ai, config }) {
  const router = Router();

  router.get('/', async (req, res) => {
    const items = await Conversation.aggregate([
      { $sort: { updatedAt: -1 } },
      {
        $project: {
          title: 1,
          platform: 1,
          participants: 1,
          me: 1,
          createdAt: 1,
          updatedAt: 1,
          messageCount: { $size: '$messages' },
          lastMessage: { $arrayElemAt: ['$messages', -1] },
        },
      },
    ]);
    res.json(
      items.map((i) => ({
        id: String(i._id),
        title: i.title,
        platform: i.platform,
        participants: i.participants,
        me: i.me,
        createdAt: i.createdAt,
        updatedAt: i.updatedAt,
        messageCount: i.messageCount,
        lastMessage: i.lastMessage ? { sender: i.lastMessage.sender, text: truncate(i.lastMessage.text, 140) } : null,
      })),
    );
  });

  router.post('/', async (req, res) => {
    const body = validate(createSchema, req.body);
    const parsed = parseConversation(body.text, { platform: body.platform });
    const conversation = await Conversation.create({
      title: body.title || defaultTitle(parsed.participants),
      platform: parsed.platform,
      participants: parsed.participants,
      me: body.me || parsed.suggestedMe,
      messages: parsed.messages,
    });
    res.status(201).json({ ...serializeConversation(conversation), droppedMessages: parsed.droppedMessages });
  });

  router.get('/:id', async (req, res) => {
    const conversation = await findConversation(req.params.id);
    const sets = await SuggestionSet.find({ conversation: conversation._id }).sort({ createdAt: -1 }).limit(20);
    res.json({ ...serializeConversation(conversation), suggestionSets: sets.map(serializeSet) });
  });

  router.patch('/:id', async (req, res) => {
    const body = validate(updateSchema, req.body);
    const conversation = await findConversation(req.params.id);
    Object.assign(conversation, body);
    await conversation.save();
    res.json(serializeConversation(conversation));
  });

  router.delete('/:id', async (req, res) => {
    const conversation = await findConversation(req.params.id);
    await SuggestionSet.deleteMany({ conversation: conversation._id });
    await conversation.deleteOne();
    res.status(204).end();
  });

  // Add a message - e.g. the reply the user just sent, or the other person's answer.
  router.post('/:id/messages', async (req, res) => {
    const body = validate(messageSchema, req.body);
    const conversation = await findConversation(req.params.id);
    conversation.messages.push({ sender: body.sender, text: body.text, timestamp: new Date(), addedManually: true });
    conversation.participants = uniqueSenders(conversation.messages);
    await conversation.save();
    res.status(201).json(serializeConversation(conversation));
  });

  router.delete('/:id/messages/:messageId', async (req, res) => {
    const conversation = await findConversation(req.params.id);
    const message = mongoose.isValidObjectId(req.params.messageId) && conversation.messages.id(req.params.messageId);
    if (!message) throw new HttpError(404, 'Message not found.');
    message.deleteOne();
    conversation.participants = uniqueSenders(conversation.messages);
    await conversation.save();
    res.json(serializeConversation(conversation));
  });

  async function findConversationWithMessages(id) {
    const conversation = await findConversation(id);
    if (!conversation.messages.length) throw new HttpError(400, 'This conversation has no messages yet.');
    return conversation;
  }

  router.post('/:id/suggestions', async (req, res) => {
    const options = validate(suggestSchema, req.body);
    const provider = ai.get(options.provider);
    const conversation = await findConversationWithMessages(req.params.id);

    const result = await provider.suggest({ conversation: conversation.toObject(), options });
    const set = await SuggestionSet.create({
      conversation: conversation._id,
      me: conversation.me,
      options: { tone: options.tone, length: options.length, instructions: options.instructions },
      analysis: result.analysis,
      suggestions: result.suggestions,
      provider: provider.info.id,
      model: result.model,
      usedMessages: result.usedMessages,
      totalMessages: result.totalMessages,
      usage: result.usage,
    });
    await touch(conversation._id);
    res.status(201).json(serializeSet(set));
  });

  // Refining uses the provider that wrote the reply when it's an API provider,
  // otherwise (web-chat or legacy sets) the default one.
  router.post('/:id/refine', async (req, res) => {
    const body = validate(refineSchema, req.body);
    const provider = ai.has(body.provider) ? ai.get(body.provider) : ai.get();
    const conversation = await findConversation(req.params.id);
    const result = await provider.refine({ conversation: conversation.toObject(), text: body.text, instruction: body.instruction });
    res.json({ text: result.text, provider: provider.info.id, model: result.model ?? null });
  });

  // Web chat, step 1: the prompt to paste into ChatGPT / Gemini / Claude.ai.
  router.post('/:id/web-prompt', async (req, res) => {
    const body = validate(webPromptSchema, req.body);
    const conversation = await findConversationWithMessages(req.params.id);
    const { prompt, usedMessages, totalMessages } = buildWebPrompt(conversation.toObject(), body, config.maxPromptMessages);
    const chat = WEB_CHATS[body.target];
    res.json({ target: chat.id, label: chat.label, url: chat.url, prompt, usedMessages, totalMessages });
  });

  // Web chat, step 2: turn the pasted answer into a suggestion set.
  router.post('/:id/suggestions/import', async (req, res) => {
    const body = validate(importSchema, req.body);
    const conversation = await findConversationWithMessages(req.params.id);
    const { analysis, suggestions } = parseWebAnswer(body.text);
    const total = conversation.messages.length;
    const set = await SuggestionSet.create({
      conversation: conversation._id,
      me: conversation.me,
      options: { tone: body.tone, length: body.length, instructions: body.instructions },
      analysis: analysis ?? undefined,
      suggestions,
      provider: body.target,
      model: null,
      usedMessages: Math.min(total, config.maxPromptMessages),
      totalMessages: total,
    });
    await touch(conversation._id);
    res.status(201).json(serializeSet(set));
  });

  return router;
}
