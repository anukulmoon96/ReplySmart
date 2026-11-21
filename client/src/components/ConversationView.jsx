import { useEffect, useState } from 'react';
import { api } from '../api.js';
import ChatThread from './ChatThread.jsx';
import ReplyAssistant from './ReplyAssistant.jsx';
import { PlatformBadge, Spinner } from './icons.jsx';

export default function ConversationView({ id, ai, autoSuggest, onAutoSuggestDone, onChanged, onDeleted }) {
  const [conversation, setConversation] = useState(null);
  const [sets, setSets] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [actionError, setActionError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getConversation(id)
      .then((data) => {
        if (cancelled) return;
        const { suggestionSets, ...rest } = data;
        setConversation(rest);
        setSets(suggestionSets);
      })
      .catch((err) => !cancelled && setLoadError(err.message));
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function act(fn) {
    setActionError(null);
    try {
      const updated = await fn();
      if (updated) setConversation(updated);
      onChanged();
      return true;
    } catch (err) {
      setActionError(err.message);
      return false;
    }
  }

  const update = (patch) => act(() => api.updateConversation(id, patch));
  const addMessage = (sender, text) => act(() => api.addMessage(id, { sender, text }));
  const removeMessage = (messageId) => act(() => api.deleteMessage(id, messageId));

  async function remove() {
    if (!window.confirm('Delete this conversation and all of its suggestions?')) return;
    try {
      await api.deleteConversation(id);
      onDeleted();
    } catch (err) {
      setActionError(err.message);
    }
  }

  if (loadError) {
    return (
      <div className="page">
        <div className="notice error">{loadError}</div>
      </div>
    );
  }
  if (!conversation) {
    return (
      <div className="page center-fill">
        <Spinner label="Loading conversation…" />
      </div>
    );
  }

  const meOptions = conversation.participants.includes(conversation.me)
    ? conversation.participants
    : [...conversation.participants, conversation.me];

  return (
    <div className="page convo">
      <header className="convo-head">
        <div className="convo-title">
          <PlatformBadge platform={conversation.platform} />
          <EditableTitle value={conversation.title} onSave={(title) => update({ title })} />
        </div>
        <div className="convo-actions">
          <label className="field-inline">
            Replying as
            <select value={conversation.me} onChange={(e) => update({ me: e.target.value })}>
              {meOptions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <button className="btn ghost danger" type="button" onClick={remove}>
            Delete
          </button>
        </div>
      </header>

      {actionError && <div className="notice error">{actionError}</div>}

      <div className="convo-grid">
        <ChatThread conversation={conversation} onAdd={addMessage} onRemove={removeMessage} />
        <ReplyAssistant
          conversation={conversation}
          sets={sets}
          setSets={setSets}
          ai={ai}
          autoSuggest={autoSuggest}
          onAutoSuggestDone={onAutoSuggestDone}
          onUse={(text) => addMessage(conversation.me, text)}
          onChanged={onChanged}
        />
      </div>
    </div>
  );
}

function EditableTitle({ value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  function commit() {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== value) onSave(next);
    else setDraft(value);
  }

  if (!editing) {
    return (
      <h1 className="title-button">
        <button type="button" onClick={() => setEditing(true)} title="Rename">
          {value}
        </button>
      </h1>
    );
  }
  return (
    <input
      className="title-input"
      value={draft}
      autoFocus
      maxLength={120}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          setDraft(value);
          setEditing(false);
        }
      }}
      aria-label="Conversation title"
    />
  );
}
