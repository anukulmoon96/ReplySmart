import { byTimestamp, decodeEntities } from './utils.js';

const SKIP_SUBTYPES = new Set([
  'bot_add', 'bot_remove', 'channel_archive', 'channel_join', 'channel_leave', 'channel_name', 'channel_purpose',
  'channel_topic', 'channel_unarchive', 'group_join', 'group_leave', 'group_name', 'group_purpose', 'group_topic',
  'joiner_notification_for_inviter', 'pinned_item', 'tombstone', 'unpinned_item',
]);

function messageList(data) {
  const list = Array.isArray(data) ? data : data?.messages;
  return Array.isArray(list) ? list.filter((m) => m && typeof m === 'object') : null;
}

/** A Slack export channel file: an array of `{ type, user, text, ts, ... }`. */
export function isSlackExport(data) {
  const list = messageList(data);
  return Boolean(list?.some((m) => 'ts' in m && ('text' in m || 'files' in m)));
}

export function parseSlackExport(data) {
  const list = messageList(data);
  const names = new Map();
  for (const m of list) {
    if (m.user && !names.has(m.user)) {
      const p = m.user_profile;
      const name = p?.display_name || p?.real_name || p?.name || m.user_name;
      if (name) names.set(m.user, name);
    }
  }
  if (Array.isArray(data?.users)) {
    for (const u of data.users) {
      if (u?.id && !names.has(u.id)) names.set(u.id, u.profile?.display_name || u.real_name || u.name || u.id);
    }
  }

  return list
    .filter((m) => (!m.type || m.type === 'message') && !SKIP_SUBTYPES.has(m.subtype))
    .map((m) => {
      let text = typeof m.text === 'string' ? cleanSlackText(m.text, names) : '';
      if (!text && Array.isArray(m.files) && m.files.length) {
        text = `[shared ${m.files.length === 1 ? 'a file' : `${m.files.length} files`}]`;
      }
      return {
        sender: names.get(m.user) || m.username || m.bot_profile?.name || m.user || 'Unknown',
        text,
        timestamp: m.ts ? new Date(parseFloat(m.ts) * 1000) : null,
        timeLabel: null,
      };
    })
    .sort(byTimestamp);
}

/** Turn Slack's mrkdwn markup (<@U123>, <#C1|general>, <url|label>) into readable text. */
export function cleanSlackText(text, names = new Map()) {
  return decodeEntities(
    text
      .replace(/<@([A-Z0-9]+)(?:\|([^>]+))?>/g, (_, id, label) => `@${label || names.get(id) || id}`)
      .replace(/<#[A-Z0-9]+\|([^>]*)>/g, '#$1')
      .replace(/<!(here|channel|everyone)(?:\|[^>]*)?>/g, '@$1')
      .replace(/<!subteam\^[A-Z0-9]+\|([^>]+)>/g, '$1')
      .replace(/<mailto:[^|>]+\|([^>]+)>/g, '$1')
      .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2 ($1)')
      .replace(/<(https?:[^>]+)>/g, '$1'),
  ).trim();
}
