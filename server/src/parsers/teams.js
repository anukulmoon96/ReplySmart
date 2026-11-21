import { byTimestamp, htmlToText, tidy, toDate } from './utils.js';

// Microsoft Graph chatMessage: { from: { user: { displayName } }, body: { contentType, content }, createdDateTime }
function isGraphMessage(m) {
  return 'body' in m && ('from' in m || 'createdDateTime' in m);
}

// Teams / Skype personal data export: { displayName, content, originalarrivaltime, messagetype }
function isExportMessage(m) {
  return 'originalarrivaltime' in m && 'content' in m;
}

function isTeamsMessage(m) {
  return m && typeof m === 'object' && (isGraphMessage(m) || isExportMessage(m));
}

function messageList(data) {
  if (!data || typeof data !== 'object') return null;
  const candidates = Array.isArray(data) ? [data] : [data.value, data.messages, data.MessageList];
  if (Array.isArray(data.conversations)) {
    // A personal export holds every chat; use the longest one.
    const lists = data.conversations.map((c) => c?.MessageList).filter(Array.isArray);
    if (lists.length) candidates.push(lists.sort((a, b) => b.length - a.length)[0]);
  }
  return candidates.find((list) => Array.isArray(list) && list.some(isTeamsMessage)) ?? null;
}

export function isTeamsExport(data) {
  return messageList(data) !== null;
}

export function parseTeamsExport(data) {
  return messageList(data)
    .filter(isTeamsMessage)
    .filter((m) => !isSystemMessage(m))
    .map((m) => {
      if (isGraphMessage(m)) {
        const content = m.body?.content ?? '';
        return {
          sender: m.from?.user?.displayName || m.from?.application?.displayName || 'Unknown',
          text: m.body?.contentType === 'html' ? htmlToText(content) : tidy(content),
          timestamp: toDate(m.createdDateTime),
          timeLabel: null,
        };
      }
      return {
        sender: m.displayName || 'Unknown',
        text: htmlToText(m.content),
        timestamp: toDate(m.originalarrivaltime || m.composetime),
        timeLabel: null,
      };
    })
    .sort(byTimestamp);
}

function isSystemMessage(m) {
  if (isGraphMessage(m)) return Boolean(m.deletedDateTime) || (m.messageType && m.messageType !== 'message');
  return Boolean(m.messagetype) && !/^(RichText|Text)/i.test(m.messagetype);
}
