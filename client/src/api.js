export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Can't reach the ReplySmart server. Is it running?", 0);
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // A 5xx without our JSON error body comes from the dev proxy: the API itself is down.
    const fallback =
      res.status >= 502 && res.status <= 504 ? "Can't reach the ReplySmart server. Is it running?" : `Request failed (${res.status})`;
    throw new ApiError(data.error || fallback, res.status, data.details);
  }
  return data;
}

export const api = {
  health: () => request('/health'),
  samples: () => request('/samples'),
  parse: (text, platform) => request('/parse', { method: 'POST', body: { text, platform } }),
  listConversations: () => request('/conversations'),
  getConversation: (id) => request(`/conversations/${id}`),
  createConversation: (payload) => request('/conversations', { method: 'POST', body: payload }),
  updateConversation: (id, patch) => request(`/conversations/${id}`, { method: 'PATCH', body: patch }),
  deleteConversation: (id) => request(`/conversations/${id}`, { method: 'DELETE' }),
  addMessage: (id, message) => request(`/conversations/${id}/messages`, { method: 'POST', body: message }),
  deleteMessage: (id, messageId) => request(`/conversations/${id}/messages/${messageId}`, { method: 'DELETE' }),
  suggest: (id, options) => request(`/conversations/${id}/suggestions`, { method: 'POST', body: options }),
  refine: (id, payload) => request(`/conversations/${id}/refine`, { method: 'POST', body: payload }),
  webPrompt: (id, payload) => request(`/conversations/${id}/web-prompt`, { method: 'POST', body: payload }),
  importSuggestions: (id, payload) => request(`/conversations/${id}/suggestions/import`, { method: 'POST', body: payload }),
};
