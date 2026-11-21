import mongoose from 'mongoose';

export const PLATFORMS = ['whatsapp', 'slack', 'teams', 'generic'];

const messageSchema = new mongoose.Schema(
  {
    sender: { type: String, required: true, trim: true, maxlength: 120 },
    text: { type: String, required: true, maxlength: 20000 },
    timestamp: { type: Date, default: null },
    // Raw time text from copy-pasted chats that carry no full date (e.g. "10:32 AM").
    timeLabel: { type: String, default: null },
    addedManually: { type: Boolean, default: false },
  },
  { _id: true },
);

const conversationSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    platform: { type: String, enum: PLATFORMS, default: 'generic' },
    participants: { type: [String], default: [] },
    // The participant ReplySmart writes replies for.
    me: { type: String, default: null },
    messages: { type: [messageSchema], default: [] },
  },
  { timestamps: true },
);

conversationSchema.index({ updatedAt: -1 });

export const Conversation = mongoose.models.Conversation || mongoose.model('Conversation', conversationSchema);
