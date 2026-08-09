# Google Workspace Integration

EDITH uses local OAuth for Google Workspace. It is designed for local CLI use, not a hosted web application.

## Architecture

```text
Google Provider
  -> Profile
  -> OAuth flow
  -> macOS Keychain
  -> Connector
  -> Context Engine
  -> EDITH
```

## Profiles

The current implemented profile is `personal`. The architecture leaves room for future profiles such as `work`, with separate OAuth authorization, scopes, tokens, and policy.

## Token Storage

OAuth tokens are stored in macOS Keychain. Credential JSON belongs outside Git, typically:

```text
~/.config/edith/google-oauth-client.json
```

Never commit OAuth client secrets, access tokens, refresh tokens, authorization codes, or private Google data.

## Connectors

Implemented personal connectors include:

- Google Calendar
- Gmail
- Google Drive
- Google Docs
- Google Tasks
- Google Contacts

## Confirmation Policy

The personal profile can be authorized for writes, but authorization is not automatic approval. Sensitive, external, and destructive actions require explicit confirmation.

Examples:

- Reading calendar events: automatic
- Creating a draft: confirmation-gated when invoked as a user action
- Sending email: explicit confirmation required
- Deleting contacts/events/files: explicit confirmation required

## Commands

```bash
edith auth status
edith auth google --profile personal --scope calendar
edith auth google --profile personal --upgrade
edith context status
```

Do not connect organizational work accounts without the required admin approval and profile policy.

