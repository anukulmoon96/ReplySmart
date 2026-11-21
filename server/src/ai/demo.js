// Offline stand-in used when no Claude credentials are configured. It is template-based,
// not AI: the UI labels its output as demo output. It exists so the app can be tried
// and tested end to end without an API key.

const URGENT = /\b(asap|urgent|tonight|today|by noon|eod|end of day|deadline|right away|immediately)\b/i;
const POSITIVE = /\b(thanks|thank you|great|awesome|love|glad|happy|perfect|nice|congrats)\b|[🙌😊😀😁🎉❤️👍]/iu;
const NEGATIVE = /\b(sorry|unfortunately|upset|angry|disappointed|problem|issue|worried|frustrat\w*|annoy\w*|didn't reply)\b|[😞😠😡😢]/iu;

const GREETINGS = {
  professional: (n) => `Hi ${n},`,
  friendly: (n) => `Hey ${n}!`,
  casual: () => 'Hey,',
  concise: () => '',
  empathetic: (n) => `Hi ${n},`,
  assertive: (n) => `Hi ${n},`,
};

const MOVES = {
  pending: [
    {
      label: 'Answer and confirm',
      body: 'Thanks for following up. Yes, that works for me. [Add your answer here.]',
      rationale: 'Use this if you can give a clear yes right away.',
    },
    {
      label: 'Ask a clarifying question',
      body: 'Before I confirm, could you tell me a bit more about [detail]?',
      rationale: 'Use this if you need one more detail before committing.',
    },
    {
      label: 'Buy some time',
      body: "Good question. Let me check and I'll get back to you by [time].",
      rationale: "Use this if you can't answer yet but don't want to leave them waiting.",
    },
    {
      label: 'Politely decline',
      body: "Thanks for asking. Unfortunately I can't do [request] this time, but [alternative].",
      rationale: 'Use this if the answer is no and you want to offer an alternative.',
    },
    {
      label: 'Acknowledge',
      body: 'Got it, thanks for letting me know!',
      rationale: 'Use this if no decision is needed from you.',
    },
  ],
  followUp: [
    {
      label: 'Gentle nudge',
      body: 'Just checking in on this. Any thoughts when you get a chance?',
      rationale: "Use this if they haven't answered your last message.",
    },
    {
      label: 'Add a detail',
      body: 'One more thing I forgot to mention: [detail].',
      rationale: 'Use this to add something you left out.',
    },
    {
      label: 'Wrap up',
      body: "Sounds good. Talk soon!",
      rationale: 'Use this to close the conversation politely.',
    },
  ],
};

const LONG_TAIL = {
  professional: ' Happy to walk through it on a quick call if that is easier.',
  friendly: ' Let me know if anything changes!',
  casual: ' Lmk!',
  concise: '',
  empathetic: " And no pressure at all, I know things are busy.",
  assertive: ' Let me know by [time] so we can move forward.',
};

function firstName(name = '') {
  return name.split(/\s+/)[0] || 'there';
}

function sentences(text) {
  return text.split(/(?<=[.?!])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

export function createDemoProvider() {
  return {
    info: { id: 'demo', label: 'Demo (no AI)', model: null },

    async suggest({ conversation, options }) {
      const { me, messages } = conversation;
      let lastMine = -1;
      messages.forEach((m, i) => {
        if (m.sender === me) lastMine = i;
      });
      const pendingMessages = messages.slice(lastMine + 1).filter((m) => m.sender !== me);
      const lastOther = [...messages].reverse().find((m) => m.sender !== me);
      const pendingText = pendingMessages.map((m) => m.text).join('\n');
      const questions = sentences(pendingText).filter((s) => s.endsWith('?'));
      const moodText = pendingText || lastOther?.text || '';
      const positive = POSITIVE.test(moodText);
      const negative = NEGATIVE.test(moodText);

      const name = firstName(lastOther?.sender);
      const greeting = options.length === 'short' ? '' : (GREETINGS[options.tone] ?? GREETINGS.friendly)(name);
      const tail = options.length === 'long' ? (LONG_TAIL[options.tone] ?? '') : '';
      const moves = pendingMessages.length ? MOVES.pending : MOVES.followUp;

      const suggestions = moves.slice(0, options.count).map((move) => ({
        label: move.label,
        text: [greeting, move.body + tail].filter(Boolean).join(' '),
        rationale: move.rationale,
      }));

      return {
        analysis: {
          summary: `${messages.length} messages between ${conversation.participants.join(', ')}. ${
            lastOther ? `The latest from ${lastOther.sender}: "${truncate(lastOther.text, 90)}"` : ''
          }`.trim(),
          pending: pendingMessages.length
            ? `${pendingMessages.length} message${pendingMessages.length === 1 ? '' : 's'} from ${lastOther.sender} since your last reply${
                questions.length ? `, with ${questions.length} question${questions.length === 1 ? '' : 's'}` : ''
              }.`
            : 'Nothing pending',
          sentiment: positive && negative ? 'mixed' : positive ? 'positive' : negative ? 'negative' : 'neutral',
          urgency: URGENT.test(pendingText) ? 'high' : questions.length ? 'medium' : 'low',
          keyPoints: questions.slice(0, 4).map((q) => truncate(q, 120)),
        },
        suggestions,
        model: null,
        usedMessages: messages.length,
        totalMessages: messages.length,
        usage: null,
      };
    },

    async refine({ text, instruction }) {
      return { text: demoRefine(text, instruction), model: null };
    },
  };
}

function truncate(text, max) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

const CONTRACTIONS = [
  [/\bcan't\b/gi, 'cannot'],
  [/\bwon't\b/gi, 'will not'],
  [/\bI'll\b/g, 'I will'],
  [/\bI'm\b/g, 'I am'],
  [/\bdon't\b/gi, 'do not'],
  [/\blet's\b/gi, 'let us'],
  [/\bit's\b/gi, 'it is'],
  [/\bHey\b/g, 'Hello'],
];

function demoRefine(text, instruction) {
  const want = instruction.toLowerCase();
  if (/short|brief|concise/.test(want)) {
    const parts = sentences(text).filter((s) => !/^(hi|hey|hello)\b[^.!?]*[,!]$/i.test(s));
    return parts[0] ?? text;
  }
  if (/formal|professional|polite/.test(want)) {
    let result = text.replace(/\p{Extended_Pictographic}/gu, '').replace(/!+/g, '.');
    for (const [pattern, replacement] of CONTRACTIONS) {
      result = result.replace(pattern, (match) =>
        match[0] === match[0].toUpperCase() ? replacement[0].toUpperCase() + replacement.slice(1) : replacement,
      );
    }
    return result.replace(/\s{2,}/g, ' ').trim();
  }
  if (/warm|friend|casual|emoji/.test(want)) {
    return /\p{Extended_Pictographic}/u.test(text) ? text : `${text.trim()} 😊`;
  }
  return text;
}
