import { GoogleWorkspaceAuthProvider } from '../../auth/google-oauth.js';
import { GOOGLE_SCOPE_REGISTRY } from '../../auth/google-scopes.js';
import { AuthState } from '../../auth/errors.js';
import { ConnectorHealth, contextItem, limitItems } from '../models.js';

const CALENDAR_READ_SCOPES = [
  GOOGLE_SCOPE_REGISTRY.calendar.scopes[0],
  ...GOOGLE_SCOPE_REGISTRY.calendarPersonal.scopes
];
const API_ROOT = 'https://www.googleapis.com/calendar/v3';

export class GoogleCalendarConnector {
  constructor({ profile = 'personal', authProvider = new GoogleWorkspaceAuthProvider({ profile }), fetchImpl = fetch, limit = 20 } = {}) {
    this.id = `google-calendar:${profile}`;
    this.name = 'Google Calendar';
    this.sourceType = 'calendar';
    this.profile = profile;
    this.authProvider = authProvider;
    this.fetch = fetchImpl;
    this.limit = limit;
    this.capabilities = ['calendars.read', 'events.read', 'events.create', 'events.update', 'events.delete', 'events.respond'];
    this.readOnly = false;
    this._status = null;
    this._calendars = null;
  }

  async health() {
    const auth = await this.authProvider.status();
    if (auth.status !== AuthState.CONNECTED) {
      return {
        id: this.id,
        name: this.name,
        sourceType: this.sourceType,
        accountIdentity: auth.account,
        profile: this.profile,
        health: auth.status === AuthState.NOT_CONFIGURED ? ConnectorHealth.NOT_CONFIGURED : ConnectorHealth.UNAVAILABLE,
        capabilities: this.capabilities,
        readOnly: this.readOnly,
        lastSync: null,
        detail: `Google profile ${this.profile}: ${auth.status}. ${auth.detail}`
      };
    }
    if (!hasAnyCalendarScope(auth.scopes)) {
      return {
        id: this.id,
        name: this.name,
        sourceType: this.sourceType,
        accountIdentity: auth.account,
        profile: this.profile,
        health: ConnectorHealth.NOT_CONFIGURED,
        capabilities: this.capabilities,
        readOnly: this.readOnly,
        lastSync: null,
        detail: `Google profile ${this.profile} is connected but lacks Calendar read-only scope. Run edith auth google --profile ${this.profile} --scope calendar.`
      };
    }
    try {
      const calendars = await this.getCalendars({ limit: 1 });
      this._status = {
        id: this.id,
        name: this.name,
        sourceType: this.sourceType,
        accountIdentity: auth.account,
        profile: this.profile,
        health: ConnectorHealth.CONNECTED,
        capabilities: this.capabilities,
        readOnly: this.readOnly,
        lastSync: new Date().toISOString(),
        detail: `Google Calendar connected; calendars discovered: ${calendars.totalCount ?? calendars.items.length}.`,
        calendarCount: calendars.totalCount ?? calendars.items.length
      };
      return this._status;
    } catch (error) {
      return {
        id: this.id,
        name: this.name,
        sourceType: this.sourceType,
        accountIdentity: auth.account,
        profile: this.profile,
        health: ConnectorHealth.ERROR,
        capabilities: this.capabilities,
        readOnly: true,
        lastSync: null,
        detail: error.message
      };
    }
  }

  async getCalendars({ limit = 250 } = {}) {
    const token = await this.authProvider.accessToken({ anyScope: CALENDAR_READ_SCOPES });
    const url = new URL(`${API_ROOT}/users/me/calendarList`);
    url.searchParams.set('maxResults', String(Math.min(limit, 250)));
    const data = await this.googleGet(url, token.accessToken);
    const items = (data.items ?? []).map((calendar) => ({
      id: calendar.id,
      title: calendar.summaryOverride || calendar.summary || calendar.id,
      summary: calendar.description || '',
      timezone: calendar.timeZone || null,
      primary: Boolean(calendar.primary),
      accessRole: calendar.accessRole,
      source: 'google-calendar',
      sourceAccount: token.profile,
      accountIdentity: token.account,
      sourceContainer: calendar.summaryOverride || calendar.summary || calendar.id,
      metadata: {
        colorId: calendar.colorId,
        selected: calendar.selected,
        hidden: calendar.hidden
      }
    }));
    this._calendars = items;
    return { items, totalCount: data.items?.length ?? items.length };
  }

  async getEventsBetween({ start, end, limit = this.limit } = {}) {
    const calendars = this._calendars ?? (await this.getCalendars()).items;
    const events = [];
    for (const calendar of calendars.filter((item) => item.accessRole !== 'freeBusyReader')) {
      const url = new URL(`${API_ROOT}/calendars/${encodeURIComponent(calendar.id)}/events`);
      url.searchParams.set('timeMin', start.toISOString());
      url.searchParams.set('timeMax', end.toISOString());
      url.searchParams.set('singleEvents', 'true');
      url.searchParams.set('orderBy', 'startTime');
      url.searchParams.set('showDeleted', 'true');
      url.searchParams.set('maxResults', String(Math.min(limit, 250)));
      const token = await this.authProvider.accessToken({ anyScope: CALENDAR_READ_SCOPES });
      const data = await this.googleGet(url, token.accessToken);
      for (const event of data.items ?? []) events.push(normalizeEvent({ event, calendar, profile: token.profile, account: token.account }));
    }
    return limitItems(events.sort((a, b) => compareDates(a.startAt, b.startAt)), limit);
  }

  async getEventsToday({ now = new Date(), timezone = Intl.DateTimeFormat().resolvedOptions().timeZone, limit = this.limit } = {}) {
    return this.getEventsBetween({ start: startOfDay(now, timezone), end: addDays(startOfDay(now, timezone), 1), limit });
  }

  async getEventsAfter(now = new Date(), options = {}) {
    const end = options.end ?? addDays(now, 1);
    const events = await this.getEventsBetween({ start: now, end, limit: options.limit ?? this.limit });
    return events.filter((event) => event.status !== 'cancelled' && event.startAt && new Date(event.startAt) >= now);
  }

  async getNextEvent(now = new Date()) {
    return (await this.getEventsAfter(now, { limit: 10 }))[0] ?? null;
  }

  async createEvent({ calendarId = 'primary', summary, start, end, description = '', attendees = [] }) {
    const token = await this.authProvider.accessToken({ requiredScopes: [GOOGLE_SCOPE_REGISTRY.calendarPersonal.scopes[2]] });
    const body = {
      summary,
      description,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
      ...(attendees.length ? { attendees: attendees.map((email) => ({ email })) } : {})
    };
    const data = await this.googleRequest(`${API_ROOT}/calendars/${encodeURIComponent(calendarId)}/events`, token.accessToken, { method: 'POST', body });
    const calendar = (this._calendars ?? (await this.getCalendars()).items).find((item) => item.id === calendarId) ?? { id: calendarId, title: calendarId };
    return normalizeEvent({ event: data, calendar, profile: token.profile, account: token.account });
  }

  async updateEvent({ calendarId = 'primary', eventId, patch }) {
    const token = await this.authProvider.accessToken({ requiredScopes: [GOOGLE_SCOPE_REGISTRY.calendarPersonal.scopes[2]] });
    const data = await this.googleRequest(`${API_ROOT}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, token.accessToken, { method: 'PATCH', body: patch });
    const calendar = (this._calendars ?? (await this.getCalendars()).items).find((item) => item.id === calendarId) ?? { id: calendarId, title: calendarId };
    return normalizeEvent({ event: data, calendar, profile: token.profile, account: token.account });
  }

  async deleteEvent({ calendarId = 'primary', eventId }) {
    const token = await this.authProvider.accessToken({ requiredScopes: [GOOGLE_SCOPE_REGISTRY.calendarPersonal.scopes[2]] });
    await this.googleRequest(`${API_ROOT}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, token.accessToken, { method: 'DELETE' });
    return { id: eventId, source: 'google-calendar', sourceAccount: token.profile, deleted: true };
  }

  async googleGet(url, accessToken) {
    return this.googleRequest(url, accessToken);
  }

  async googleRequest(url, accessToken, { method = 'GET', body = null } = {}) {
    const response = await this.fetch(url, {
      method,
      headers: { authorization: `Bearer ${accessToken}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : null
    });
    const text = await response.text();
    const json = text ? JSON.parse(text) : {};
    if (!response.ok) throw new Error(json.error?.message || json.error_description || 'Google Calendar API request failed.');
    return json;
  }
}

function hasAnyCalendarScope(scopes = []) {
  return CALENDAR_READ_SCOPES.some((scope) => scopes.includes(scope));
}

function normalizeEvent({ event, calendar, profile, account }) {
  const allDay = Boolean(event.start?.date);
  const startAt = event.start?.dateTime ?? event.start?.date ?? null;
  const endAt = event.end?.dateTime ?? event.end?.date ?? null;
  const self = event.attendees?.find((attendee) => attendee.self);
  return contextItem('Event', {
    id: `google-calendar:${profile}:${calendar.id}:${event.id}`,
    source: 'google-calendar',
    sourceAccount: profile,
    sourceContainer: calendar.title,
    externalId: event.id,
    title: event.summary || '(untitled event)',
    summary: event.description ? event.description.slice(0, 500) : '',
    url: event.htmlLink ?? null,
    createdAt: event.created ?? null,
    updatedAt: event.updated ?? null,
    startAt,
    endAt,
    status: event.status ?? null,
    people: event.organizer?.email ? [event.organizer.email] : [],
    metadata: {
      calendarId: calendar.id,
      calendarTimeZone: calendar.timezone,
      account,
      allDay,
      recurring: Boolean(event.recurringEventId),
      transparency: event.transparency,
      responseStatus: self?.responseStatus ?? null,
      eventType: event.eventType
    }
  });
}

function compareDates(a, b) {
  return new Date(a ?? 0) - new Date(b ?? 0);
}

function startOfDay(now, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now).reduce((out, part) => ({ ...out, [part.type]: part.value }), {});
  return new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00`);
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}
