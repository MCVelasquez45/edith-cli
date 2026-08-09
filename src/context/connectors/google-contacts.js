import { GOOGLE_SCOPE_REGISTRY } from '../../auth/google-scopes.js';
import { contextItem, limitItems } from '../models.js';
import { GoogleApiConnector } from './google-base.js';

const API_ROOT = 'https://people.googleapis.com/v1';

export class GoogleContactsConnector extends GoogleApiConnector {
  constructor(options = {}) {
    super({
      id: `google-contacts:${options.profile ?? 'personal'}`,
      name: 'Google Contacts',
      sourceType: 'contacts',
      scopes: GOOGLE_SCOPE_REGISTRY.contactsPersonal.scopes,
      capabilities: ['contacts.read', 'contacts.create', 'contacts.update'],
      ...options
    });
  }

  async probe() {
    const contacts = await this.searchContacts({ query: '', limit: 1 });
    return `Google Contacts connected; sample query returned ${contacts.length} contact(s).`;
  }

  async searchContacts({ query = '', limit = 10 } = {}) {
    const url = new URL(`${API_ROOT}/people/me/connections`);
    url.searchParams.set('pageSize', String(Math.min(limit, 100)));
    url.searchParams.set('personFields', 'names,emailAddresses,phoneNumbers,metadata');
    const { json, token } = await this.googleFetch(url);
    const contacts = (json.connections ?? []).map((person) => normalizeContact({ person, profile: this.profile, account: token.account }));
    const lower = query.toLowerCase();
    return limitItems(lower ? contacts.filter((contact) => `${contact.title} ${contact.people.join(' ')}`.toLowerCase().includes(lower)) : contacts, limit);
  }

  async createContact({ givenName, familyName = '', email = null }) {
    const body = {
      names: [{ givenName, familyName }],
      ...(email ? { emailAddresses: [{ value: email }] } : {})
    };
    const { json, token } = await this.googleFetch(`${API_ROOT}/people:createContact`, { method: 'POST', body });
    return normalizeContact({ person: json, profile: this.profile, account: token.account });
  }
}

function normalizeContact({ person, profile, account }) {
  const name = person.names?.[0]?.displayName ?? '(unnamed contact)';
  return contextItem('Project', {
    id: `google-contacts:${profile}:${person.resourceName}`,
    source: 'google-contacts',
    sourceAccount: profile,
    sourceContainer: 'Contacts',
    externalId: person.resourceName,
    title: name,
    people: person.emailAddresses?.map((email) => email.value) ?? [],
    metadata: { etag: person.etag, account }
  });
}
