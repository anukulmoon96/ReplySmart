export const PLATFORM_LABELS = { whatsapp: 'WhatsApp', slack: 'Slack', teams: 'Teams', generic: 'Chat' };

const LEGACY_PROVIDER_LABELS = { claude: 'Claude', demo: 'Demo (no AI)' };

/** Display name for whoever wrote a suggestion set: an API provider or a web chat. */
export function providerLabel(id, ai) {
  const known = [...(ai?.providers ?? []), ...(ai?.webChats ?? [])].find((p) => p.id === id);
  return known?.label ?? LEGACY_PROVIDER_LABELS[id] ?? id;
}

export function onlyDemo(ai) {
  return Boolean(ai?.providers?.length) && ai.providers.every((p) => p.id === 'demo');
}

export function relativeTime(value) {
  const diff = (Date.now() - new Date(value).getTime()) / 1000;
  if (diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d`;
  return new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function timeText(message) {
  if (message.timestamp) {
    return new Date(message.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return message.timeLabel ?? '';
}

export function dayLabel(message) {
  if (!message?.timestamp) return null;
  return new Date(message.timestamp).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

const SENDER_HUES = [262, 200, 330, 160, 25, 290, 120, 0];

export function colorFor(name) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return `hsl(${SENDER_HUES[hash % SENDER_HUES.length]} 60% var(--sender-lightness))`;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

export function isTypingTarget(element) {
  return Boolean(element?.closest?.('input, textarea, select, [contenteditable="true"]'));
}
