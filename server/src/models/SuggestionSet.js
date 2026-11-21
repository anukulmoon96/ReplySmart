import mongoose from 'mongoose';

const suggestionSchema = new mongoose.Schema(
  {
    label: { type: String, required: true },
    text: { type: String, required: true },
    rationale: { type: String, default: '' },
  },
  { _id: true },
);

const suggestionSetSchema = new mongoose.Schema(
  {
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
    me: { type: String, required: true },
    options: {
      tone: String,
      length: String,
      instructions: String,
    },
    analysis: {
      summary: String,
      pending: String,
      sentiment: String,
      urgency: String,
      keyPoints: [String],
    },
    suggestions: { type: [suggestionSchema], default: [] },
    // Who wrote it: an API provider (claude, openai, gemini, compatible, demo)
    // or a web chat the user pasted from (chatgpt-web, gemini-web, claude-web).
    provider: { type: String },
    // Earlier name for `provider`, kept so older documents still read correctly.
    mode: { type: String },
    model: { type: String, default: null },
    usedMessages: Number,
    totalMessages: Number,
    usage: {
      inputTokens: Number,
      outputTokens: Number,
      cacheReadTokens: Number,
    },
  },
  { timestamps: true },
);

export const SuggestionSet = mongoose.models.SuggestionSet || mongoose.model('SuggestionSet', suggestionSetSchema);
