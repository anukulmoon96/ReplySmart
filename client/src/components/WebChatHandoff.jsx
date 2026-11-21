import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { copyText } from '../lib.js';

/**
 * Free web-chat mode: copy a ready-made prompt, open ChatGPT / Gemini / Claude.ai
 * in a new tab, and import the answer the user pastes back. The user drives the
 * chat site; ReplySmart never automates it.
 */
export default function WebChatHandoff({ chat, conversation, options, onImported }) {
  const [prompt, setPrompt] = useState(null);
  const [promptError, setPromptError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [opened, setOpened] = useState(false);
  const [answer, setAnswer] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState(null);

  // Fetch the prompt ahead of time: copying and opening a tab must happen
  // synchronously inside the click, or browsers block them.
  useEffect(() => {
    let cancelled = false;
    setPrompt(null);
    setPromptError(null);
    const timer = setTimeout(() => {
      api
        .webPrompt(conversation.id, { target: chat.id, ...options })
        .then((result) => !cancelled && setPrompt(result.prompt))
        .catch((err) => !cancelled && setPromptError(err.message));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [chat.id, conversation.id, conversation.me, conversation.messages.length, options.tone, options.length, options.instructions]);

  function flashCopied() {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function copyAndOpen() {
    if (!prompt) return;
    copyText(prompt).then((ok) => ok && flashCopied());
    window.open(chat.url, '_blank', 'noopener,noreferrer');
    setOpened(true);
  }

  async function pasteFromClipboard() {
    setError(null);
    try {
      setAnswer(await navigator.clipboard.readText());
    } catch {
      setError('Your browser blocked clipboard access. Click the box below and press Ctrl+V instead.');
    }
  }

  async function importAnswer() {
    if (!answer.trim() || importing) return;
    setImporting(true);
    setError(null);
    try {
      const set = await api.importSuggestions(conversation.id, { target: chat.id, text: answer, ...options });
      setAnswer('');
      setOpened(false);
      onImported(set);
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="webchat">
      <button className="btn primary block lg" type="button" onClick={copyAndOpen} disabled={!prompt}>
        {prompt ? `Copy prompt & open ${chat.label}` : 'Preparing prompt…'}
      </button>
      {promptError && <div className="notice error small">{promptError}</div>}

      <ol className="webchat-steps">
        <li className={opened ? 'done' : ''}>
          {copied ? 'Prompt copied. ' : ''}In {chat.label}, paste with <kbd>Ctrl</kbd>+<kbd>V</kbd> and send.
        </li>
        <li>
          Copy {chat.label}&apos;s answer. The copy button on its code block is easiest.
        </li>
        <li>Paste it here and turn it into suggestions.</li>
      </ol>

      <textarea
        className="webchat-answer"
        rows={opened ? 5 : 3}
        value={answer}
        placeholder={`Paste ${chat.label}'s answer here`}
        onChange={(e) => setAnswer(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            importAnswer();
          }
        }}
        aria-label={`${chat.label}'s answer`}
      />
      <div className="webchat-actions">
        <button className="btn" type="button" onClick={pasteFromClipboard}>
          Paste from clipboard
        </button>
        <button className="btn primary" type="button" onClick={importAnswer} disabled={!answer.trim() || importing}>
          {importing ? 'Reading answer…' : 'Turn into suggestions'}
        </button>
      </div>
      {error && <div className="notice error small">{error}</div>}

      {prompt && (
        <details className="webchat-prompt">
          <summary>See the prompt</summary>
          <pre>{prompt}</pre>
          <button
            className="btn small ghost"
            type="button"
            onClick={() => copyText(prompt).then((ok) => ok && flashCopied())}
          >
            {copied ? 'Copied ✓' : 'Copy prompt again'}
          </button>
        </details>
      )}

      <p className="hint">
        This shares the conversation with {chat.label} under your own account, and it may be used to train their models
        unless you&apos;ve turned that off in {chat.label}&apos;s settings.
      </p>
    </div>
  );
}
