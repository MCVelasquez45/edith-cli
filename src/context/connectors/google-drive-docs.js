import { GOOGLE_SCOPE_REGISTRY } from '../../auth/google-scopes.js';
import { contextItem, limitItems } from '../models.js';
import { GoogleApiConnector } from './google-base.js';

const DRIVE_ROOT = 'https://www.googleapis.com/drive/v3';
const DOCS_ROOT = 'https://docs.googleapis.com/v1/documents';

export class GoogleDriveConnector extends GoogleApiConnector {
  constructor(options = {}) {
    super({
      id: `google-drive:${options.profile ?? 'personal'}`,
      name: 'Google Drive',
      sourceType: 'drive',
      scopes: GOOGLE_SCOPE_REGISTRY.drivePersonal.scopes,
      capabilities: ['files.read', 'files.search', 'files.create', 'files.update', 'files.manage.authorized'],
      ...options
    });
  }

  async probe() {
    const files = await this.searchFiles({ query: "trashed=false", limit: 1 });
    return `Google Drive connected; sample query returned ${files.length} file(s).`;
  }

  async searchFiles({ query = "trashed=false", limit = 10 } = {}) {
    const url = new URL(`${DRIVE_ROOT}/files`);
    url.searchParams.set('q', query);
    url.searchParams.set('pageSize', String(Math.min(limit, 50)));
    url.searchParams.set('fields', 'files(id,name,mimeType,modifiedTime,webViewLink,trashed,parents)');
    const { json, token } = await this.googleFetch(url);
    return limitItems((json.files ?? []).map((file) => normalizeFile({ file, profile: this.profile, account: token.account })), limit);
  }

  async createFileMetadata({ name, mimeType = 'text/plain' }) {
    const { json, token } = await this.googleFetch(`${DRIVE_ROOT}/files?fields=id,name,mimeType,webViewLink`, { method: 'POST', body: { name, mimeType } });
    return normalizeFile({ file: json, profile: this.profile, account: token.account });
  }

  async renameFile({ fileId, name }) {
    const { json, token } = await this.googleFetch(`${DRIVE_ROOT}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,webViewLink,modifiedTime`, { method: 'PATCH', body: { name } });
    return normalizeFile({ file: json, profile: this.profile, account: token.account });
  }

  async trashFile({ fileId }) {
    const { json, token } = await this.googleFetch(`${DRIVE_ROOT}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,trashed`, { method: 'PATCH', body: { trashed: true } });
    return normalizeFile({ file: json, profile: this.profile, account: token.account });
  }
}

export class GoogleDocsConnector extends GoogleApiConnector {
  constructor(options = {}) {
    super({
      id: `google-docs:${options.profile ?? 'personal'}`,
      name: 'Google Docs',
      sourceType: 'docs',
      scopes: GOOGLE_SCOPE_REGISTRY.docsPersonal.scopes,
      capabilities: ['documents.read', 'documents.create', 'documents.update'],
      ...options
    });
  }

  async probe() {
    return 'Google Docs scope available.';
  }

  async createDocument({ title }) {
    const { json, token } = await this.googleFetch(DOCS_ROOT, { method: 'POST', body: { title } });
    return normalizeDocument({ doc: json, profile: this.profile, account: token.account });
  }

  async getDocument({ documentId }) {
    const { json, token } = await this.googleFetch(`${DOCS_ROOT}/${encodeURIComponent(documentId)}`);
    return normalizeDocument({ doc: json, profile: this.profile, account: token.account });
  }

  async appendText({ documentId, text }) {
    const doc = await this.getDocument({ documentId });
    const endIndex = Math.max(1, (doc.metadata.bodyEndIndex ?? 1) - 1);
    const { json, token } = await this.googleFetch(`${DOCS_ROOT}/${encodeURIComponent(documentId)}:batchUpdate`, {
      method: 'POST',
      body: { requests: [{ insertText: { location: { index: endIndex }, text } }] }
    });
    return { id: documentId, source: 'google-docs', sourceAccount: this.profile, accountIdentity: token.account, replies: json.replies?.length ?? 0 };
  }
}

function normalizeFile({ file, profile, account }) {
  return contextItem('Project', {
    id: `google-drive:${profile}:file:${file.id}`,
    source: 'google-drive',
    sourceAccount: profile,
    sourceContainer: 'Drive',
    externalId: file.id,
    title: file.name,
    url: file.webViewLink ?? null,
    updatedAt: file.modifiedTime ?? null,
    status: file.trashed ? 'trashed' : 'active',
    metadata: { mimeType: file.mimeType, parents: file.parents ?? [], account }
  });
}

function normalizeDocument({ doc, profile, account }) {
  const bodyEndIndex = doc.body?.content?.at(-1)?.endIndex ?? null;
  return contextItem('Project', {
    id: `google-docs:${profile}:doc:${doc.documentId}`,
    source: 'google-docs',
    sourceAccount: profile,
    sourceContainer: 'Docs',
    externalId: doc.documentId,
    title: doc.title,
    metadata: { bodyEndIndex, account }
  });
}
