import { GOOGLE_SCOPE_REGISTRY } from '../../auth/google-scopes.js';
import { contextItem, limitItems } from '../models.js';
import { GoogleApiConnector } from './google-base.js';

const API_ROOT = 'https://gmail.googleapis.com/gmail/v1/users/me';

export class GoogleGmailConnector extends GoogleApiConnector {
  constructor(options = {}) {
    super({
      id: `google-gmail:${options.profile ?? 'personal'}`,
      name: 'Gmail',
      sourceType: 'email',
      scopes: GOOGLE_SCOPE_REGISTRY.gmailPersonal.scopes,
      capabilities: ['messages.read', 'messages.search', 'threads.read', 'drafts.create', 'messages.send', 'messages.manage', 'labels.manage'],
      ...options
    });
  }

  async probe() {
    const { json } = await this.googleFetch(`${API_ROOT}/profile`);
    return `Gmail connected; messages total estimate: ${json.messagesTotal ?? 'unknown'}.`;
  }

  async recentMessages({ limit = 10, query = '' } = {}) {
    const url = new URL(`${API_ROOT}/messages`);
    url.searchParams.set('maxResults', String(Math.min(limit, 50)));
    if (query) url.searchParams.set('q', query);
    const { json } = await this.googleFetch(url);
    const messages = [];
    for (const item of (json.messages ?? []).slice(0, limit)) messages.push(await this.getMessageMetadata(item.id));
    return messages;
  }

  async unreadMessages({ limit = 10 } = {}) {
    return this.recentMessages({ limit, query: 'is:unread newer_than:30d' });
  }

  async searchMessages({ query, limit = 10 } = {}) {
    return this.recentMessages({ limit, query });
  }

  async getThread({ threadId }) {
    const { json, token } = await this.googleFetch(`${API_ROOT}/threads/${encodeURIComponent(threadId)}?format=metadata`);
    return {
      id: `gmail:${this.profile}:thread:${json.id}`,
      source: 'gmail',
      sourceAccount: this.profile,
      sourceContainer: 'Gmail',
      accountIdentity: token.account,
      externalId: json.id,
      messages: (json.messages ?? []).map((message) => normalizeMessage({ message, profile: this.profile, account: token.account }))
    };
  }

  async createDraft({ to, subject, body }) {
    const raw = encodeMessage({ to, subject, body });
    const { json } = await this.googleFetch(`${API_ROOT}/drafts`, { method: 'POST', body: { message: { raw } } });
    return { id: json.id, messageId: json.message?.id, source: 'gmail', sourceAccount: this.profile };
  }

  async sendDraft({ draftId }) {
    const { json } = await this.googleFetch(`${API_ROOT}/drafts/send`, { method: 'POST', body: { id: draftId } });
    return { id: json.id, threadId: json.threadId, source: 'gmail', sourceAccount: this.profile };
  }

  async getMessageMetadata(id) {
    const { json, token } = await this.googleFetch(`${API_ROOT}/messages/${encodeURIComponent(id)}?format=metadata`);
    return normalizeMessage({ message: json, profile: this.profile, account: token.account });
  }
}

function normalizeMessage({ message, profile, account }) {
  const headers = new Map((message.payload?.headers ?? []).map((header) => [header.name.toLowerCase(), header.value]));
  return contextItem('Message', {
    id: `gmail:${profile}:message:${message.id}`,
    source: 'gmail',
    sourceAccount: profile,
    sourceContainer: 'Gmail',
    externalId: message.id,
    title: headers.get('subject') || '(no subject)',
    summary: message.snippet || '',
    createdAt: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : null,
    updatedAt: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : null,
    status: message.labelIds?.includes('UNREAD') ? 'unread' : 'read',
    people: [headers.get('from'), headers.get('to')].filter(Boolean),
    labels: message.labelIds ?? [],
    metadata: { threadId: message.threadId, account }
  });
}

function encodeMessage({ to, subject, body }) {
  const message = [`To: ${to}`, `Subject: ${subject}`, 'Content-Type: text/plain; charset="UTF-8"', '', body].join('\r\n');
  return Buffer.from(message).toString('base64url');
}
