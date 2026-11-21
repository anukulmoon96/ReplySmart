import { Fragment, useEffect, useRef, useState } from 'react';
import { colorFor, dayLabel, timeText } from '../lib.js';

export default function ChatThread({ conversation, onAdd, onRemove }) {
  const { messages, me, participants } = conversation;
  const others = participants.filter((p) => p !== me);
  const senders = [...others, me];
  const [sender, setSender] = useState(others[0] ?? me);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef(null);

  useEffect(() => {
    if (!senders.includes(sender)) setSender(others[0] ?? me);
  }, [me, participants.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  async function submit(e) {
    e.preventDefault();
    if (!draft.trim() || saving) return;
    setSaving(true);
    const ok = await onAdd(sender, draft.trim());
    setSaving(false);
    if (ok) setDraft('');
  }

  return (
    <section className="card thread" aria-label="Conversation">
      <div className="card-head">
        <h2>Conversation</h2>
        <span className="muted small">
          {messages.length} message{messages.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="thread-body" ref={bodyRef}>
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const mine = m.sender === me;
          const day = dayLabel(m);
          const showDay = day && day !== dayLabel(prev);
          const showName = !mine && (prev?.sender !== m.sender || showDay);
          return (
            <Fragment key={m.id}>
              {showDay && <div className="day-sep">{day}</div>}
              <div className={`bubble-row ${mine ? 'mine' : ''}`}>
                <div className={`bubble ${mine ? 'mine' : ''}`}>
                  {showName && (
                    <div className="bubble-sender" style={{ color: colorFor(m.sender) }}>
                      {m.sender}
                    </div>
                  )}
                  <div className="bubble-text">{m.text}</div>
                  <div className="bubble-time">{timeText(m)}</div>
                </div>
                <button
                  className="icon-btn bubble-remove"
                  type="button"
                  title="Remove this message"
                  aria-label={`Remove message from ${m.sender}`}
                  onClick={() => onRemove(m.id)}
                >
                  ×
                </button>
              </div>
            </Fragment>
          );
        })}
      </div>

      <form className="composer" onSubmit={submit}>
        <select value={sender} onChange={(e) => setSender(e.target.value)} aria-label="Who sent it">
          {senders.map((p) => (
            <option key={p} value={p}>
              {p === me ? `${p} (you)` : p}
            </option>
          ))}
        </select>
        <textarea
          rows={1}
          value={draft}
          placeholder="Got a new message? Add it here"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) submit(e);
          }}
          aria-label="New message"
        />
        <button className="btn" type="submit" disabled={!draft.trim() || saving}>
          Add
        </button>
      </form>
    </section>
  );
}
