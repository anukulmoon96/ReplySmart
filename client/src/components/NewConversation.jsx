import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { PlatformBadge, PlatformDot, Spinner } from './icons.jsx';

const SOURCES = [
  ['auto', 'Auto-detect'],
  ['whatsapp', 'WhatsApp'],
  ['slack', 'Slack'],
  ['teams', 'Microsoft Teams'],
  ['generic', 'Other'],
];

const PLACEHOLDER = `Paste a conversation here, for example:

11/18/26, 9:31 AM - Priya: How about 7? I can book a table
11/18/26, 9:32 AM - Priya: Mind if my cousin joins us?

…or drop a WhatsApp .txt / Slack or Teams .json export onto this box.`;

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const NOT_IN_CHAT = 'Me';

export default function NewConversation({ onCreated }) {
  const [text, setText] = useState('');
  const [source, setSource] = useState('auto');
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [me, setMe] = useState('');
  const [samples, setSamples] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef(null);
  const preferredMe = useRef(null);

  useEffect(() => {
    api.samples().then(setSamples).catch(() => setSamples([]));
  }, []);

  // Live preview: parse (without saving) shortly after the user stops typing.
  useEffect(() => {
    if (!text.trim()) {
      setPreview(null);
      setPreviewError(null);
      setParsing(false);
      return undefined;
    }
    let cancelled = false;
    setParsing(true);
    const timer = setTimeout(async () => {
      try {
        const result = await api.parse(text, source);
        if (cancelled) return;
        setPreview(result);
        setPreviewError(null);
        setMe((current) => {
          const valid = (name) => name && (name === NOT_IN_CHAT || result.participants.includes(name));
          if (valid(preferredMe.current)) return preferredMe.current;
          return valid(current) ? current : result.suggestedMe;
        });
      } catch (err) {
        if (cancelled) return;
        setPreview(null);
        setPreviewError(err.message);
      } finally {
        if (!cancelled) setParsing(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [text, source]);

  async function loadFile(file) {
    if (!file) return;
    setError(null);
    if (/\.zip$/i.test(file.name)) {
      setError('WhatsApp exports come as a .zip. Unzip it and upload the .txt file inside.');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError('That file is over 5 MB. Export a shorter date range and try again.');
      return;
    }
    preferredMe.current = null;
    setText(await file.text());
  }

  function loadSample(sample) {
    preferredMe.current = sample.me;
    setSource('auto');
    setText(sample.text);
    setError(null);
  }

  function clear() {
    preferredMe.current = null;
    setText('');
    setError(null);
  }

  async function submit() {
    if (!preview || submitting || parsing) return;
    setSubmitting(true);
    setError(null);
    try {
      const conversation = await api.createConversation({ text, platform: source, me });
      onCreated(conversation);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <div className="page new-convo">
      <header className="page-head">
        <h1>What should you say next?</h1>
        <p>
          Paste a conversation from Slack, WhatsApp or Teams. ReplySmart works out what&apos;s waiting on you and drafts
          replies in your voice.
        </p>
      </header>

      <div className="import-grid">
        <section className="card import-card">
          <div
            className={`dropzone ${dragging ? 'dragging' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              loadFile(e.dataTransfer.files?.[0]);
            }}
          >
            <textarea
              className="paste-box"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={PLACEHOLDER}
              spellCheck={false}
              aria-label="Conversation text"
            />
            {dragging && <div className="drop-overlay">Drop the export file to import it</div>}
          </div>

          <div className="import-actions">
            <button className="btn" type="button" onClick={() => fileInput.current?.click()}>
              Upload export
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".txt,.json,text/plain,application/json"
              hidden
              onChange={(e) => {
                loadFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <label className="field-inline">
              Source
              <select value={source} onChange={(e) => setSource(e.target.value)}>
                {SOURCES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {text && (
              <button className="btn ghost" type="button" onClick={clear}>
                Clear
              </button>
            )}
          </div>

          {samples.length > 0 && (
            <div className="samples">
              <span>No chat handy? Try a sample:</span>
              {samples.map((sample) => (
                <button key={sample.id} type="button" className="chip" onClick={() => loadSample(sample)}>
                  <PlatformDot platform={sample.platform} /> {sample.title.split('·')[1]?.trim() ?? sample.title}
                </button>
              ))}
            </div>
          )}
        </section>

        <aside className="card preview-card" aria-live="polite">
          {!text.trim() && <HowToExport />}

          {text.trim() && previewError && (
            <div className="notice warn">
              <strong>Couldn&apos;t read that yet.</strong> {previewError}
            </div>
          )}

          {text.trim() && !preview && !previewError && <Spinner label="Reading the conversation…" />}

          {text.trim() && preview && (
            <>
              <div className="preview-head">
                <PlatformBadge platform={preview.platform} />
                <span className="muted">
                  {preview.messageCount} message{preview.messageCount === 1 ? '' : 's'} · {preview.participants.length}{' '}
                  {preview.participants.length === 1 ? 'person' : 'people'}
                </span>
                {parsing && <Spinner />}
              </div>

              <label className="field">
                <span className="field-label">You are</span>
                <select value={me} onChange={(e) => setMe(e.target.value)}>
                  {preview.participants.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                  <option value={NOT_IN_CHAT}>Someone not in this chat yet</option>
                </select>
                <span className="hint">Replies are written from this person&apos;s side.</span>
              </label>

              <div className="mini-thread">
                <span className="field-label">Latest messages</span>
                {preview.preview.map((m, i) => (
                  <div key={i} className={`mini-msg ${m.sender === me ? 'mine' : ''}`}>
                    <strong>{m.sender === me ? 'You' : m.sender}</strong>
                    <span>{m.text}</span>
                  </div>
                ))}
              </div>

              {preview.droppedMessages > 0 && (
                <p className="hint">
                  Large chat: only the latest {preview.messageCount.toLocaleString()} messages will be imported.
                </p>
              )}

              <button className="btn primary block lg" type="button" onClick={submit} disabled={submitting || parsing}>
                {submitting ? 'Importing…' : 'Suggest replies'}
              </button>
              <p className="hint center">
                or press <kbd>Ctrl</kbd> + <kbd>Enter</kbd>
              </p>
            </>
          )}

          {error && <div className="notice error">{error}</div>}
        </aside>
      </div>
    </div>
  );
}

function HowToExport() {
  return (
    <div className="howto">
      <h2>Getting a chat in</h2>
      <dl>
        <dt>
          <PlatformDot platform="whatsapp" /> WhatsApp
        </dt>
        <dd>
          Open the chat → ⋮ (or the contact name on iPhone) → <em>Export chat</em> → <em>Without media</em>. Unzip it and
          upload the .txt.
        </dd>
        <dt>
          <PlatformDot platform="slack" /> Slack
        </dt>
        <dd>Select the messages in Slack and copy-paste them, or upload a channel .json from a workspace export.</dd>
        <dt>
          <PlatformDot platform="teams" /> Teams
        </dt>
        <dd>Copy the messages from the chat and paste them, or upload messages .json from Graph or a data export.</dd>
        <dt>
          <PlatformDot platform="generic" /> Anything else
        </dt>
        <dd>
          Lines like <code>Name: message</code> work too.
        </dd>
      </dl>
    </div>
  );
}
