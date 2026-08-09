export const AuthState = {
  CONNECTED: 'CONNECTED',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  DISCONNECTED: 'DISCONNECTED',
  ADMIN_APPROVAL_REQUIRED: 'ADMIN_APPROVAL_REQUIRED',
  ERROR: 'ERROR'
};

export class AuthError extends Error {
  constructor(message, { code = 'auth_error', status = AuthState.ERROR, details = {} } = {}) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function normalizeGoogleAuthError(error, context = {}) {
  const code = String(error?.code ?? error?.details?.error ?? error?.message ?? 'auth_error');
  const description = String(error?.details?.error_description ?? error?.message ?? '');
  const combined = `${code} ${description}`;
  if (/admin_policy_enforced|access_denied|restricted|blocked|unauthorized_client|org_internal/i.test(combined)) {
    return new AuthError(safeMessage(code, description), {
      code,
      status: AuthState.ADMIN_APPROVAL_REQUIRED,
      details: { ...context, error: code, errorDescription: description }
    });
  }
  if (/invalid_grant|revoked/i.test(combined)) {
    return new AuthError('Google authorization was revoked or expired. Reauthenticate with edith auth google.', {
      code: 'revoked_or_expired',
      status: AuthState.DISCONNECTED,
      details: { ...context, error: code }
    });
  }
  return new AuthError(safeMessage(code, description), {
    code,
    status: AuthState.ERROR,
    details: { ...context, error: code }
  });
}

function safeMessage(code, description) {
  const text = description || code || 'Google OAuth failed.';
  return text
    .replace(/(access_token|refresh_token|id_token|client_secret|code)=([^&\s]+)/gi, '$1=[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [REDACTED]');
}
