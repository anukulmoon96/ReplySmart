import { onlyDemo, relativeTime } from '../lib.js';
import { Logo, PlatformDot } from './icons.jsx';

function SidebarStatus({ ai }) {
  const demo = onlyDemo(ai);
  const current = ai.providers.find((p) => p.id === ai.defaultProvider) ?? ai.providers[0];
  const extra = ai.providers.length - 1;
  return (
    <div className="sidebar-foot" title={ai.providers.map((p) => `${p.label}${p.model ? ` · ${p.model}` : ''}`).join('\n')}>
      <span className={`status-dot ${demo ? 'demo' : 'live'}`} aria-hidden="true" />
      {demo ? 'No AI API key · web chats available' : `${current.label}${extra > 0 ? ` +${extra} more` : ''}`}
    </div>
  );
}

export default function Sidebar({ open, conversations, error, selectedId, health, onNew, onClose }) {
  return (
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <div className="sidebar-top">
        <span className="brand">
          <Logo /> ReplySmart
        </span>
        <button className="icon-btn sidebar-close" aria-label="Close conversations" onClick={onClose}>
          ×
        </button>
      </div>

      <button className="btn primary block" onClick={onNew}>
        <span aria-hidden="true">+</span> New conversation
      </button>

      <div className="sidebar-label">Recent</div>
      {error && <p className="notice error small">{error}</p>}
      {!error && conversations.length === 0 && (
        <p className="sidebar-empty">Conversations you import will show up here.</p>
      )}

      <nav className="convo-list" aria-label="Conversations">
        {conversations.map((c) => (
          <a
            key={c.id}
            href={`#/c/${c.id}`}
            className={`convo-item ${c.id === selectedId ? 'active' : ''}`}
            aria-current={c.id === selectedId ? 'page' : undefined}
          >
            <span className="convo-item-top">
              <PlatformDot platform={c.platform} />
              <span className="convo-item-title">{c.title}</span>
              <span className="convo-item-time">{relativeTime(c.updatedAt)}</span>
            </span>
            {c.lastMessage && (
              <span className="convo-item-preview">
                {c.lastMessage.sender === c.me ? 'You' : c.lastMessage.sender.split(' ')[0]}: {c.lastMessage.text}
              </span>
            )}
          </a>
        ))}
      </nav>

      {health?.ok && <SidebarStatus ai={health.ai} />}
    </aside>
  );
}
