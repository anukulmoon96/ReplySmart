import { z } from 'zod';

export const SuggestionsOutput = z.object({
  analysis: z.object({
    summary: z.string().describe('One or two sentences on what the conversation is about and where it stands now.'),
    pending: z
      .string()
      .describe('What the other side is waiting on from the user right now, or "Nothing pending" if nothing is.'),
    sentiment: z.enum(['positive', 'neutral', 'negative', 'mixed']).describe('The mood of the latest messages.'),
    urgency: z.enum(['low', 'medium', 'high']).describe('How soon the user should reply.'),
    keyPoints: z
      .array(z.string())
      .describe('Open questions, requests or facts the reply should account for, most important first. Short phrases.'),
  }),
  suggestions: z.array(
    z.object({
      label: z.string().describe('A 2-4 word name for the approach, e.g. "Confirm and add details".'),
      text: z.string().describe('The exact message the user would send.'),
      rationale: z.string().describe('One short sentence on when this option is the right choice.'),
    }),
  ),
});

export const RefineOutput = z.object({
  text: z.string().describe('The rewritten message, ready to send.'),
});
