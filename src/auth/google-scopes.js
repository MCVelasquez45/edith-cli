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
  calendarPersonal: {
    label: 'calendar.personal',
    scopes: [
      'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
      'https://www.googleapis.com/auth/calendar.calendars.readonly',
      'https://www.googleapis.com/auth/calendar.events'
    ],
    access: 'Read calendars and create, update, delete, and respond to events',
    requestNow: false
  },
  gmail: {
    label: 'gmail.readonly',
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    access: 'Read-only Gmail messages and metadata',
    requestNow: false
  },
  gmailPersonal: {
    label: 'gmail.personal',
    scopes: [
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/gmail.send'
    ],
    access: 'Read/search mail, inspect threads, create drafts, send mail, archive, and manage labels/messages',
    requestNow: false
  },
  drive: {
    label: 'drive.readonly',
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    access: 'Read-only Google Drive files',
    requestNow: false
  },
  drivePersonal: {
    label: 'drive.personal',
    scopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/drive.file'
    ],
    access: 'Search/read Drive and create/update/manage files EDITH is authorized to manage',
    requestNow: false
  },
  docsPersonal: {
    label: 'docs.personal',
    scopes: ['https://www.googleapis.com/auth/documents'],
    access: 'Read, create, and update Google Docs documents',
    requestNow: false
  },
  tasks: {
    label: 'tasks.readonly',
    scopes: ['https://www.googleapis.com/auth/tasks.readonly'],
    access: 'Read-only Google Tasks',
    requestNow: false
  },
  tasksPersonal: {
    label: 'tasks.personal',
    scopes: ['https://www.googleapis.com/auth/tasks'],
    access: 'Read, create, update, complete, and delete Google Tasks',
    requestNow: false
  },
  contacts: {
    label: 'contacts.readonly',
    scopes: ['https://www.googleapis.com/auth/contacts.readonly'],
    access: 'Read-only Google Contacts',
    requestNow: false
  },
  contactsPersonal: {
    label: 'contacts.personal',
    scopes: ['https://www.googleapis.com/auth/contacts'],
    access: 'Search, read, create, and update Google contacts through People API',
    requestNow: false
  }
};

export const GOOGLE_SCOPE_BUNDLES = {
  personalWorkspace: ['identity', 'calendarPersonal', 'gmailPersonal', 'drivePersonal', 'docsPersonal', 'tasksPersonal', 'contactsPersonal'],
  calendarReadOnly: ['identity', 'calendar']
};

export function scopesFor(keys = ['identity']) {
  return keys.flatMap((key) => GOOGLE_SCOPE_REGISTRY[key]?.scopes ?? []);
}

export function scopeLabels(scopes = []) {
  return Object.values(GOOGLE_SCOPE_REGISTRY)
    .filter((entry) => entry.scopes.every((scope) => scopes.includes(scope)))
    .map((entry) => entry.label);
}
