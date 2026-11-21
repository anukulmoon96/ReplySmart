# ReplySmart

Paste a conversation from **Slack**, **WhatsApp** or **Microsoft Teams** and ReplySmart tells you what's waiting on you and drafts the next reply in your voice, using **Claude, ChatGPT, Gemini or a local model**. It's a MERN app: MongoDB, Express, React and Node.

- **Import any way you have it.** Paste copied text, or upload a WhatsApp `.txt` export, a Slack channel `.json` export, or Teams `.json` (Microsoft Graph or personal data export). The platform is detected automatically, and you get a live preview before saving.
- **Pick your AI per request.** Under **Write with** you can choose:
  - **AI APIs (automatic):** Claude, ChatGPT models via the OpenAI API, Gemini, or any OpenAI-compatible server. That last option covers Ollama, LM Studio, Groq and OpenRouter.
  - **Free web chats (you paste):** ChatGPT, Gemini or Claude.ai in your browser. One click copies a ready-made prompt and opens the site in a new tab. You paste it there, then paste the answer back, and it becomes suggestion cards. No API key needed.
- **Analysis first.** A summary, what's pending for you, mood, urgency and the open questions.
- **Genuinely different options.** For example: say yes, ask a question, buy time. You pick the tone (friendly, professional, casual, concise, empathetic, assertive), the length, and optional instructions like "decline politely".
- **Fast to use.** Press `1`–`3` to copy a suggestion. Refine any reply (shorter, more formal, warmer, or your own instruction), edit it inline, or use **Use as my reply** to copy it and add it to the thread. Add the other person's answer when it arrives and ask again.
- **History.** Conversations and every suggestion set (with which AI wrote it) are saved in MongoDB.

## Quick start

Requires Node.js 22.9+.

```bash
npm install
```

```bash
npm run dev
```

Open http://127.0.0.1:5173 and click one of the sample chats.

**No MongoDB install needed.** When `MONGODB_URI` is empty, the API starts an embedded MongoDB (via `mongodb-memory-server`) that persists to `server/.data/db`. The first run downloads the `mongod` binary, which is about 600 MB on Windows and takes a few minutes.

### Choosing an AI

Add keys to `server/.env` (the template is `server/.env.example`) and restart `npm run dev`. Every provider you add a key for shows up under **Write with**.

| Option | Cost | Setup |
|---|---|---|
| Web chat: ChatGPT / Gemini / Claude.ai websites | Free with your account | Nothing. Pick it under **Write with**. |
| Gemini API | Free tier available | `GEMINI_API_KEY` from https://aistudio.google.com/apikey |
| Ollama (local) | Free, and private (nothing leaves your machine) | Install Ollama, run `ollama pull llama3.2`, then set `OPENAI_COMPATIBLE_BASE_URL=http://localhost:11434/v1` and `OPENAI_COMPATIBLE_MODEL=llama3.2` |
| Groq / OpenRouter | Free tiers / free models | `OPENAI_COMPATIBLE_*` with their base URL, key and model |
| Claude API | Paid | `ANTHROPIC_API_KEY` |
| OpenAI API | Paid | `OPENAI_API_KEY` |

Privacy: the cloud options send the conversation to that company. On free tiers (Gemini API, the consumer chat websites), they may use it to improve their models unless you turn that off in their settings. Use Ollama if the chats are sensitive.

Why web chats are copy-paste and not automated: the ChatGPT and Gemini terms prohibit automated access to their consumer apps and scraping their output. Both sites also use bot detection, and their pages change often. So ReplySmart prepares the prompt and reads the answer, but you drive the chat site yourself.

## Configuration (`server/.env`)

| Variable | Default | Notes |
|---|---|---|
| `AI_PROVIDER` | `auto` | Default provider: `auto` (first configured, in the order below), `claude`, `openai`, `gemini`, `compatible`, `demo`. Signed in with `ant auth login`? Use `claude`. |
| `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `CLAUDE_EFFORT` | –, `claude-opus-5-5`, `low` | Claude. `low` effort keeps replies snappy. |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_REASONING_EFFORT` | –, `gpt-5.5`, – | OpenAI. Set the effort (e.g. `low`) only for reasoning models. |
| `GEMINI_API_KEY` (or `GOOGLE_API_KEY`), `GEMINI_MODEL` | –, `gemini-3.8-flash` | Gemini. |
| `OPENAI_COMPATIBLE_BASE_URL`, `_MODEL`, `_API_KEY`, `_NAME` | –, –, –, `Local model` | Any OpenAI-compatible server. Base URL and model are both required. |
| `MAX_PROMPT_MESSAGES` | `400` | Only the latest N messages are sent, and the UI says when older ones were left out. |
| `MONGODB_URI` | – | e.g. `mongodb://localhost:27017/replysmart` or an Atlas URI. Empty means embedded DB. |
| `API_PORT` | `5050` | The Vite dev server proxies `/api` here. |
| `HOST` | `127.0.0.1` | The API only listens locally. There's no login, so don't expose it publicly as is. |

With no keys at all, the built-in replies come from a template-based demo, and the UI labels them that way. The web-chat options always work.

## Production build

```bash
npm run build
```

```bash
npm start
```

`npm start` serves the API and the built React app from one Node process (port `API_PORT`, else `PORT`, else 5050).

## Tests

```bash
npm test
```

The suite runs against an in-memory MongoDB with fake AI clients, so it never calls a paid API. It covers:

- every chat format, including WhatsApp's DD/MM vs MM/DD date detection and iOS/Android variants
- the full REST lifecycle
- each provider's request shape and error mapping (Claude, OpenAI, OpenAI-compatible, Gemini)
- provider selection
- importing web-chat answers, whether they come back as JSON, a numbered list or plain text

## How it works

```
client/ (React + Vite)                 server/ (Express + Mongoose)
  NewConversation ── /api/parse ─────────▶ parsers/  whatsapp · slack · teams · headerText · generic
  ReplyAssistant ─┬ /suggestions ────────▶ ai/ registry ─▶ claude · openai (+ compatible) · gemini · demo
                  └ /web-prompt, /suggestions/import ─▶ ai/webChat.js   (you paste into the website)
                                          models/  Conversation · SuggestionSet ──▶ MongoDB
```

- **Parsing** ([server/src/parsers](server/src/parsers)). JSON is checked against the Slack and Teams export shapes. Text goes through the WhatsApp line format, then Slack/Teams copy-paste headers, then generic `Name: message` lines.
- **One prompt, many models** ([server/src/ai](server/src/ai)). All providers share the same system prompt, transcript format and zod output schema ([schemas.js](server/src/ai/schemas.js)). `defineProvider` in [shared.js](server/src/ai/shared.js) builds `suggest` and `refine` from a single "send prompt, get validated JSON" function per provider:
  - Claude: `messages.parse` with structured output, a prompt-cached transcript block, and server-side refusal fallback.
  - OpenAI: strict `json_schema` response format.
  - Gemini: `responseJsonSchema`.
  - OpenAI-compatible servers: the schema goes in the prompt, and the JSON is pulled out of the answer.

  Each system prompt treats the transcript as untrusted data, so instructions inside a chat aren't followed.
- **Web chats** ([server/src/ai/webChat.js](server/src/ai/webChat.js)). The prompt asks for a JSON code block. The importer accepts that, a numbered list, or plain text.

## API

| Method | Path | Body |
|---|---|---|
| `POST` | `/api/parse` | `{ text, platform? }`: preview only, nothing saved |
| `GET` / `POST` | `/api/conversations` | `{ text, platform?, me?, title? }` |
| `GET` / `PATCH` / `DELETE` | `/api/conversations/:id` | `{ title?, me?, platform? }` |
| `POST` | `/api/conversations/:id/messages` | `{ sender, text }` |
| `DELETE` | `/api/conversations/:id/messages/:messageId` | |
| `POST` | `/api/conversations/:id/suggestions` | `{ provider?, tone?, length?, instructions?, count? }` |
| `POST` | `/api/conversations/:id/refine` | `{ text, instruction, provider? }` |
| `POST` | `/api/conversations/:id/web-prompt` | `{ target: chatgpt-web \| gemini-web \| claude-web, tone?, length?, instructions?, count? }` |
| `POST` | `/api/conversations/:id/suggestions/import` | `{ target, text, tone?, length?, instructions? }` |
| `GET` | `/api/health`, `/api/samples` | |
