import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { copyText, providerLabel, relativeTime } from '../lib.js';
import AnalysisCard from './AnalysisCard.jsx';
import SuggestionCard from './SuggestionCard.jsx';
import WebChatHandoff from './WebChatHandoff.jsx';

const TONES = [
  ['friendly', 'Friendly'],
  ['professional', 'Professional'],
  ['casual', 'Casual'],
  ['concise', 'Concise'],
  ['empathetic', 'Empathetic'],
  ['assertive', 'Assertive'],
];

const LENGTHS = [
  ['short', 'Short'],
  ['medium', 'Medium'],
  ['long', 'Long'],
];

const ENGINE_KEY = 'replysmart.engine';

function loadEngine() {
  try {
    return localStorage.getItem(ENGINE_KEY);
  } catch {
    return null;
  }
}

function saveEngine(id) {
  try {
    localStorage.setItem(ENGINE_KEY, id);
  } catch {
    // Storage unavailable (private mode): the choice just isn't remembered.
  }
}

function defaultTone(platform) {
  return platform === 'slack' || platform === 'teams' ? 'professional' : 'friendly';
}

export default function ReplyAssistant({ conversation, sets, setSets, ai, autoSuggest, onAutoSuggestDone, onUse, onChanged }) {
  const latest = sets[0];
  const providers = ai?.providers ?? [];
  const webChats = ai?.webChats ?? [];
  const [engineChoice, setEngineChoice] = useState(loadEngine);
  const [tone, setTone] = useState(latest?.options?.tone ?? defaultTone(conversation.platform));
  const [length, setLength] = useState(latest?.options?.length ?? 'short');
  const [instructions, setInstructions] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const autoRan = useRef(false);

  const engine =
    [...providers, ...webChats].find((e) => e.id === engineChoice) ??
    providers.find((p) => p.id === ai?.defaultProvider) ??
    providers[0];
  const webChat = webChats.find((w) => w.id === engine?.id) ?? null;
  const options = useMemo(() => ({ tone, length, instructions }), [tone, length, instructions]);

  const addSet = useCallback(
    (set) => {
      setSets((prev) => [set, ...prev]);
      onChanged();
    },
    [setSets, onChanged],
  );

  const generate = useCallback(async () => {
    if (!engine || webChat) return;
    setLoading(true);
    setError(null);
    try {
      addSet(await api.suggest(conversation.id, { provider: engine.id, ...options }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [conversation.id, engine, webChat, options, addSet]);

  // Right after an import, suggest replies straight away (API engines only:
  // a web chat needs the user to paste).
  useEffect(() => {
    if (autoSuggest && ai && !autoRan.current) {
      autoRan.current = true;
      onAutoSuggestDone();
      if (!webChat) generate();
    }
  }, [autoSuggest, ai, webChat, onAutoSuggestDone, generate]);

  // The latest set was written for a different "me" or an older version of the thread.
  const stale =
    latest &&
    !loading &&
    (latest.me !== conversation.me || (latest.totalMessages != null && latest.totalMessages !== conversation.messages.length));

  return (
    <section className="card assistant" aria-label="Reply assistant">
      <div className="card-head">
        <h2>Reply assistant</h2>
      </div>

      <div className="options">
        <label className="option-group">
          <span className="field-label">Write with</span>
          <select
            value={engine?.id ?? ''}
            onChange={(e) => {
              setEngineChoice(e.target.value);
              saveEngine(e.target.value);
              setError(null);
            }}
          >
            {providers.length > 0 && (
              <optgroup label="AI API (automatic)">
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                    {p.model ? ` · ${p.model}` : ''}
                  </option>
                ))}
              </optgroup>
            )}
            {webChats.length > 0 && (
              <optgroup label="Free web chat (you paste)">
                {webChats.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label} website
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>

        <div className="option-group" role="radiogroup" aria-label="Tone">
          <span className="field-label">Tone</span>
          <div className="chips">
            {TONES.map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={tone === value}
                className={`chip ${tone === value ? 'selected' : ''}`}
                onClick={() => setTone(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="option-group" role="radiogroup" aria-label="Length">
          <span className="field-label">Length</span>
          <div className="segmented">
            {LENGTHS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={length === value}
                className={length === value ? 'selected' : ''}
                onClick={() => setLength(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <label className="option-group">
          <span className="field-label">
            Anything specific? <span className="muted">(optional)</span>
          </span>
          <textarea
            rows={2}
            maxLength={500}
            value={instructions}
            placeholder='e.g. "say yes but push it to Friday" or "decline politely"'
            onChange={(e) => setInstructions(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                generate();
              }
            }}
          />
        </label>

        {webChat ? (
          <WebChatHandoff chat={webChat} conversation={conversation} options={options} onImported={addSet} />
        ) : (
          <button className="btn primary block lg" type="button" onClick={generate} disabled={loading || !engine}>
            {loading ? 'Reading the conversation…' : latest ? 'Suggest new replies' : 'Suggest replies'}
          </button>
        )}
      </div>

      {error && <div className="notice error">{error}</div>}

      {loading && <ResultsSkeleton />}

      {!loading && latest && (
        <div className="results">
          {stale && (
            <div className="notice info small">
              The conversation changed since these suggestions. Suggest new replies to catch up.
            </div>
          )}
          <AnalysisCard analysis={latest.analysis} />
          <div className="suggestions">
            {latest.suggestions.map((s, i) => (
              <SuggestionCard
                key={s.id}
                index={i}
                hotkey
                suggestion={s}
                provider={latest.provider}
                conversationId={conversation.id}
                onUse={onUse}
              />
            ))}
          </div>
          <p className="results-meta">
            From {providerLabel(latest.provider, ai)}
            {latest.model ? ` · ${latest.model}` : ''}
            {latest.usedMessages < latest.totalMessages &&
              ` · read the latest ${latest.usedMessages} of ${latest.totalMessages} messages`}
            {' · '}press <kbd>1</kbd>–<kbd>{latest.suggestions.length}</kbd> to copy
          </p>
        </div>
      )}

      {!loading && !latest && !error && !webChat && (
        <p className="empty-hint">Pick a tone and length, then ask for suggestions. You can refine any reply afterwards.</p>
      )}

      {sets.length > 1 && <History sets={sets.slice(1)} ai={ai} />}
    </section>
  );
}

function ResultsSkeleton() {
  return (
    <div className="results" aria-hidden="true">
      <div className="skeleton analysis-skeleton" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="skeleton suggestion-skeleton" style={{ animationDelay: `${i * 120}ms` }} />
      ))}
    </div>
  );
}

function History({ sets, ai }) {
  const [copiedId, setCopiedId] = useState(null);
  return (
    <details className="history">
      <summary>Earlier suggestions ({sets.length})</summary>
      {sets.map((set) => (
        <div key={set.id} className="history-set">
          <div className="history-meta">
            {relativeTime(set.createdAt)} ago · {providerLabel(set.provider, ai)} · {set.options?.tone} · {set.options?.length}
            {set.options?.instructions ? ` · "${set.options.instructions}"` : ''}
          </div>
          {set.suggestions.map((s) => (
            <div key={s.id} className="history-item">
              <span>{s.text}</span>
              <button
                type="button"
                className="btn small ghost"
                onClick={async () => {
                  await copyText(s.text);
                  setCopiedId(s.id);
                  setTimeout(() => setCopiedId(null), 1500);
                }}
              >
                {copiedId === s.id ? 'Copied' : 'Copy'}
              </button>
            </div>
          ))}
        </div>
      ))}
    </details>
  );
}
