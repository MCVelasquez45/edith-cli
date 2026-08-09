import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GoogleCalendarConnector } from '../src/context/connectors/google-calendar.js';
import { AuthState } from '../src/auth/errors.js';
import { GOOGLE_SCOPE_REGISTRY } from '../src/auth/google-scopes.js';
import { ConnectorHealth } from '../src/context/models.js';

describe('google calendar connector', () => {
  it('reports unavailable until Google auth and Calendar scope are present', async () => {
    const connector = new GoogleCalendarConnector({
      authProvider: {
        status: async () => ({ status: AuthState.CONNECTED, account: 'person@example.com', scopes: ['openid'] })
      }
    });

    const health = await connector.health();

    assert.equal(health.health, ConnectorHealth.NOT_CONFIGURED);
    assert.match(health.detail, /lacks Calendar read-only scope/);
  });

  it('discovers calendars and normalizes events with provenance', async () => {
    const connector = new GoogleCalendarConnector({
      authProvider: fakeAuth(),
      fetchImpl: async (url) => {
        const value = String(url);
        if (value.includes('/calendarList')) return jsonResponse({
          items: [
            { id: 'primary', summary: 'Personal', primary: true, timeZone: 'America/Phoenix', accessRole: 'owner' }
          ]
        });
        if (value.includes('/events')) return jsonResponse({
          items: [
            {
              id: 'event-1',
              summary: 'Planning',
              status: 'confirmed',
              htmlLink: 'https://calendar.google.com/event?eid=abc',
              start: { dateTime: '2026-08-09T18:00:00-07:00' },
              end: { dateTime: '2026-08-09T18:30:00-07:00' },
              organizer: { email: 'person@example.com' },
              attendees: [{ self: true, responseStatus: 'accepted' }]
            }
          ]
        });
        throw new Error(`Unexpected URL: ${value}`);
      }
    });

    const calendars = await connector.getCalendars();
    const events = await connector.getEventsBetween({
      start: new Date('2026-08-09T00:00:00-07:00'),
      end: new Date('2026-08-10T00:00:00-07:00')
    });

    assert.equal(calendars.items[0].title, 'Personal');
    assert.equal(events[0].title, 'Planning');
    assert.equal(events[0].source, 'google-calendar');
    assert.equal(events[0].sourceAccount, 'personal');
    assert.equal(events[0].sourceContainer, 'Personal');
    assert.equal(events[0].metadata.responseStatus, 'accepted');
  });
});

function fakeAuth() {
  return {
    status: async () => ({
      status: AuthState.CONNECTED,
      account: 'person@example.com',
      scopes: GOOGLE_SCOPE_REGISTRY.calendar.scopes
    }),
    accessToken: async () => ({
      accessToken: 'access-token',
      account: 'person@example.com',
      profile: 'personal',
      scopes: GOOGLE_SCOPE_REGISTRY.calendar.scopes
    })
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
