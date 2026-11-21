import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { copyText, isTypingTarget } from '../lib.js';

const QUICK_REFINES = [
  ['Shorter', 'Make it shorter.'],
  ['More formal', 'Make it more formal.'],
  ['Warmer', 'Make it warmer and friendlier.'],
];

export default function SuggestionCard({ index, suggestion, provider, conversationId, onUse, hotkey = false }) {
  const [text, setText] = useState(suggestion.text);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [refining, setRefining] = useState(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const [error, setError] = useState(null);
  const [used, setUsed] = useState(false);
  const textRef = useRef(text);
  textRef.current = text;

  async function copy() {
    const ok = await copyText(textRef.current);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  useEffect(() => {
    if (!hotkey) return undefined;
    const onKey = (e) => {
      if (e.key === String(index + 1) && !e.ctrlKey && !e.metaKey && !e.altKey && !isTypingTarget(e.target)) copy();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hotkey, index]);

  async function refine(instruction) {
    setRefining(instruction);
    setError(null);
    try {
      const result = await api.refine(conversationId, { text, instruction, provider });
      setText(result.text);
      setCustomOpen(false);
      setCustom('');
    } catch (err) {
      setError(err.message);
    } finally {
      setRefining(null);
    }
  }

  async function use() {
    await copy();
    if (await onUse(text)) setUsed(true);
  }

  return (
    <article className={`suggestion ${copied ? 'flash' : ''}`}>
      <header className="suggestion-head">
        <kbd className="suggestion-key">{index + 1}</kbd>
        <span className="suggestion-label">{suggestion.label}</span>
        {text !== suggestion.text && <span className="edited-tag">edited</span>}
      </header>

      {editing ? (
        <textarea
          className="suggestion-edit"
          value={text}
          autoFocus
          rows={Math.min(8, Math.max(3, Math.ceil(text.length / 48)))}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => setEditing(false)}
          aria-label="Edit reply"
        />
      ) : (
        <p className="suggestion-text" onDoubleClick={() => setEditing(true)}>
          {refining ? <span className="refining">Rewriting…</span> : text}
        </p>
      )}

      {suggestion.rationale && <p className="suggestion-why">{suggestion.rationale}</p>}

      <div className="suggestion-actions">
        <button className="btn small primary" type="button" onClick={copy}>
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
        <button className="btn small" type="button" onClick={use} disabled={used}>
          {used ? 'Added to thread' : 'Use as my reply'}
        </button>
        <button className="btn small ghost" type="button" onClick={() => setEditing((v) => !v)}>
          {editing ? 'Done' : 'Edit'}
        </button>
      </div>

      <div className="refine-row">
        <span className="refine-label">Refine</span>
        {QUICK_REFINES.map(([label, instruction]) => (
          <button
            key={label}
            type="button"
            className="chip small"
            disabled={Boolean(refining)}
            onClick={() => refine(instruction)}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className={`chip small ${customOpen ? 'selected' : ''}`}
          disabled={Boolean(refining)}
          onClick={() => setCustomOpen((v) => !v)}
        >
          Custom…
        </button>
      </div>

      {customOpen && (
        <form
          className="refine-custom"
          onSubmit={(e) => {
            e.preventDefault();
            if (custom.trim()) refine(custom.trim());
          }}
        >
          <input
            value={custom}
            autoFocus
            maxLength={300}
            placeholder={'e.g. "mention I\'m free after 5"'}
            onChange={(e) => setCustom(e.target.value)}
            aria-label="How should this reply change?"
          />
          <button className="btn small" type="submit" disabled={!custom.trim() || Boolean(refining)}>
            Apply
          </button>
        </form>
      )}

      {error && <p className="notice error small">{error}</p>}
    </article>
  );
}
