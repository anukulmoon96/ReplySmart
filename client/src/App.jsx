import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import ConversationView from './components/ConversationView.jsx';
import NewConversation from './components/NewConversation.jsx';
import Sidebar from './components/Sidebar.jsx';
import { Logo } from './components/icons.jsx';
import { onlyDemo } from './lib.js';

function useHashRoute() {
  const read = () => window.location.hash.replace(/^#/, '') || '/';
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const navigate = useCallback((to) => {
    window.location.hash = to;
  }, []);
  return [route, navigate];
}

export default function App() {
  const [route, navigate] = useHashRoute();
  const [health, setHealth] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [listError, setListError] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [autoSuggestId, setAutoSuggestId] = useState(null);

  const refreshList = useCallback(async () => {
    try {
      setConversations(await api.listConversations());
      setListError(null);
    } catch (err) {
      setListError(err.message);
    }
  }, []);

  useEffect(() => {
    api
      .health()
      .then(setHealth)
      .catch(() => setHealth({ ok: false }));
    refreshList();
  }, [refreshList]);

  useEffect(() => setSidebarOpen(false), [route]);

  const selectedId = route.startsWith('/c/') ? route.slice(3) : null;

  return (
    <div className="app">
      <Sidebar
        open={sidebarOpen}
        conversations={conversations}
        error={listError}
        selectedId={selectedId}
        health={health}
        onNew={() => navigate('/')}
        onClose={() => setSidebarOpen(false)}
      />
      {sidebarOpen && <div className="scrim" onClick={() => setSidebarOpen(false)} />}

      <main className="main">
        <div className="topbar">
          <button className="icon-btn" aria-label="Open conversations" onClick={() => setSidebarOpen(true)}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <span className="brand small">
            <Logo size={22} /> ReplySmart
          </span>
        </div>

        {health && !health.ok && (
          <div className="banner error">Can&apos;t reach the ReplySmart server. Start it with npm run dev.</div>
        )}
        {onlyDemo(health?.ai) && (
          <div className="banner">
            <strong>No AI API key set.</strong> Built-in replies are templates. Add a Claude, OpenAI or Gemini key to{' '}
            <code>server/.env</code> and restart, or choose a free web chat (ChatGPT, Gemini) under <em>Write with</em>.
          </div>
        )}

        {selectedId ? (
          <ConversationView
            key={selectedId}
            id={selectedId}
            ai={health?.ai}
            autoSuggest={autoSuggestId === selectedId}
            onAutoSuggestDone={() => setAutoSuggestId(null)}
            onChanged={refreshList}
            onDeleted={() => {
              refreshList();
              navigate('/');
            }}
          />
        ) : (
          <NewConversation
            onCreated={(conversation) => {
              refreshList();
              setAutoSuggestId(conversation.id);
              navigate(`/c/${conversation.id}`);
            }}
          />
        )}
      </main>
    </div>
  );
}
