const DEFAULT_MARKER = '[REDACTED]';

const KV_KEYS = 'api[_-]?key|access[_-]?token|refresh[_-]?token|oauth[_-]?token|id[_-]?token|client[_-]?secret|password|credential|secret|token';

export function redactSecrets(value, { marker = DEFAULT_MARKER } = {}) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/(github_pat_)[A-Za-z0-9_]+/g, `$1${marker}`)
    .replace(/(gh[opsu]_)[A-Za-z0-9_]+/g, `$1${marker}`)
    .replace(/(glpat-)[A-Za-z0-9_-]+/g, `$1${marker}`)
    .replace(/1\/\/[A-Za-z0-9._~+/=-]+/g, marker)
    .replace(/(ya29\.)[A-Za-z0-9._~+/=-]+/g, `$1${marker}`)
    .replace(/(sk-)[A-Za-z0-9_-]+/g, `$1${marker}`)
    .replace(new RegExp(`("(?:${KV_KEYS})"\\s*:\\s*")[^"]+`, 'gi'), `$1${marker}`)
    .replace(new RegExp(`(${KV_KEYS})\\s*[:=]\\s*["']?[^"'\\s,;}]+`, 'gi'), `$1=${marker}`)
    .replace(/(authorization|cookie)\s*[:=]\s*[^\n]+/gi, `$1=${marker}`)
    .replace(/\b(EDITH|NVIDIA|OPENAI|ANTHROPIC|GOOGLE)_[A-Z0-9_]+\s*=\s*[^\s]+/g, `$1_${marker}`)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${marker}`);
}

export function redactDeep(value, options) {
  return JSON.parse(JSON.stringify(value, (_key, item) => {
    if (typeof item !== 'string') return item;
    return redactSecrets(item, options);
  }));
}
