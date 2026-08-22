import { DataClass, isPublicOnly } from './request-analysis.js';
import { redactSecrets } from '../security/redact.js';

export const DEFAULT_PROCESSING_MODE = 'local-first';

export function egressDecision({ dataClasses = [], processor, mode = DEFAULT_PROCESSING_MODE } = {}) {
  if (!processor) return { allowed: false, reason: 'no eligible processor', sanitized: false };
  const location = processor?.location ?? 'LOCAL';
  if (dataClasses.includes(DataClass.SECRET)) return { allowed: false, reason: 'SECRET data cannot leave the machine', sanitized: false };
  if (location === 'LOCAL') return { allowed: true, reason: 'local processor', sanitized: false };
  if (!isPublicOnly(dataClasses)) return { allowed: false, reason: 'external processing requires PUBLIC-only input', sanitized: false };
  if (mode === 'local-first' && processor?.id !== 'nvidia:z-ai/glm-5.2') return { allowed: false, reason: 'local-first policy', sanitized: false };
  return { allowed: true, reason: 'PUBLIC-only input permitted by policy', sanitized: true };
}

export function sanitizeExternalPayload(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const redacted = redactSecrets(text, { marker: '<REDACTED>' });
  return typeof value === 'string' ? redacted : JSON.parse(redacted);
}
