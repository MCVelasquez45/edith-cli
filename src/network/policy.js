import dns from 'node:dns/promises';
import net from 'node:net';

const BLOCKED_HOSTS = new Set(['localhost', 'localhost.localdomain']);
const CLOUD_METADATA_HOSTS = new Set(['169.254.169.254', 'metadata.google.internal']);

export async function assertPublicHttpUrl(rawUrl, { lookup = dns.lookup } = {}) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`Blocked URL protocol: ${url.protocol}`);
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host) || CLOUD_METADATA_HOSTS.has(host)) throw new Error(`Blocked unsafe host: ${url.hostname}`);
  if (isBlockedIp(host)) throw new Error(`Blocked unsafe IP address: ${url.hostname}`);
  const records = await lookup(host, { all: true }).catch((error) => {
    throw new Error(`Could not resolve host ${host}: ${error.message}`);
  });
  for (const record of records) {
    if (isBlockedIp(record.address)) throw new Error(`Blocked unsafe resolved address for ${url.hostname}: ${record.address}`);
  }
  return url;
}

export function isBlockedIp(value) {
  const family = net.isIP(value);
  if (family === 4) return isBlockedIpv4(value);
  if (family === 6) return isBlockedIpv6(value);
  return false;
}

function isBlockedIpv4(value) {
  const parts = value.split('.').map(Number);
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

function isBlockedIpv6(value) {
  const lower = value.toLowerCase();
  return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80:');
}
