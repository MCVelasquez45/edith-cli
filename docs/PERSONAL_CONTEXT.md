# Personal Context

The Personal Context Engine aggregates external information through read/write-aware connectors and normalizes it before EDITH reasons over it.

## Sources

- Google Calendar
- Gmail
- Google Drive
- Google Docs
- Google Tasks
- Google Contacts
- GitHub
- GitLab

## Normalized Objects

EDITH normalizes context into domain concepts such as:

- Event
- Message
- Task
- Project
- Repository
- Issue
- Pull request
- Merge request
- Notification

Every item retains source provenance.

## Briefing Engine

The on-demand briefing engine anchors to trusted local time and includes only useful sections. Possible sections include:

- Next up
- Remaining today
- Earlier today
- Suggested priorities
- Overdue
- Messages needing attention
- Reviews/development
- Changed since last brief

Calendar events ending does not prove they were missed. EDITH avoids unsupported claims.

## Cross-Source Context

EDITH can correlate bounded context, such as checking Gmail for messages related to a calendar event. It should retrieve narrowly and synthesize locally.

## Privacy

Personal context should remain local by default and should not be automatically sent to external agents or search providers.

