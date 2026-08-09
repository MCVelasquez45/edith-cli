# Contributing

Thanks for taking interest in EDITH.

## Local Setup

```bash
git clone git@github.com:MCVelasquez45/edith-cli.git
cd edith-cli
npm ci
npm test
```

Optional:

```bash
npm link
edith doctor
```

## Branch Workflow

- Create a focused branch.
- Keep changes scoped.
- Do not mix behavior changes with large documentation-only changes unless required.
- Use clear commit messages.

## Pull Requests

PRs should include:

- what changed
- why it changed
- how it was tested
- security/privacy considerations for tool, auth, network, or context changes

## Testing

Run:

```bash
npm test
```

For local integrations, also run:

```bash
edith doctor
```

## Security Expectations

Never commit:

- OAuth client secrets
- access tokens
- refresh tokens
- API keys
- passwords
- private keys
- personal email/calendar/document content
- credential JSON files

Use placeholders in tests and examples.

## Documentation Expectations

Document implemented behavior only. If a command or integration is planned but not available, label it as future work.

