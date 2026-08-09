export const GOOGLE_SCOPE_REGISTRY = {
  identity: {
    label: 'identity',
    scopes: ['openid', 'email', 'profile'],
    access: 'Read-only account identity',
    requestNow: true
  },
  calendar: {
    label: 'calendar.readonly',
    scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    access: 'Read-only Google Calendar events and calendars',
    requestNow: false
  },
  gmail: {
    label: 'gmail.readonly',
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    access: 'Read-only Gmail messages and metadata',
    requestNow: false
  },
  drive: {
    label: 'drive.readonly',
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    access: 'Read-only Google Drive files',
    requestNow: false
  },
  tasks: {
    label: 'tasks.readonly',
    scopes: ['https://www.googleapis.com/auth/tasks.readonly'],
    access: 'Read-only Google Tasks',
    requestNow: false
  },
  contacts: {
    label: 'contacts.readonly',
    scopes: ['https://www.googleapis.com/auth/contacts.readonly'],
    access: 'Read-only Google Contacts',
    requestNow: false
  }
};

export function scopesFor(keys = ['identity']) {
  return keys.flatMap((key) => GOOGLE_SCOPE_REGISTRY[key]?.scopes ?? []);
}

export function scopeLabels(scopes = []) {
  return Object.values(GOOGLE_SCOPE_REGISTRY)
    .filter((entry) => entry.scopes.every((scope) => scopes.includes(scope)))
    .map((entry) => entry.label);
}
