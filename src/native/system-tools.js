import os from 'node:os';
import process from 'node:process';

const ZONE_ALIASES = new Map([
  ['california', 'America/Los_Angeles'],
  ['ca', 'America/Los_Angeles'],
  ['los angeles', 'America/Los_Angeles'],
  ['san francisco', 'America/Los_Angeles'],
  ['new york', 'America/New_York'],
  ['ny', 'America/New_York'],
  ['nyc', 'America/New_York'],
  ['arizona', 'America/Phoenix'],
  ['phoenix', 'America/Phoenix'],
  ['utc', 'UTC']
]);

export class SystemTools {
  localTimezone() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  resolveTimezone(input = '') {
    const trimmed = input.trim();
    if (!trimmed) return this.localTimezone();
    if (isValidTimeZone(trimmed)) return trimmed;
    const normalized = trimmed.toLowerCase().replace(/\btime\b/g, '').trim();
    return ZONE_ALIASES.get(normalized) ?? this.localTimezone();
  }

  currentTime({ timezone = '' } = {}) {
    const resolved = this.resolveTimezone(timezone);
    const now = new Date();
    return {
      tool: 'current_time',
      title: `Checking local time${resolved ? ` (${resolved})` : ''}`,
      timezone: resolved,
      iso: now.toISOString(),
      output: new Intl.DateTimeFormat('en-US', {
        timeZone: resolved,
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short'
      }).format(now)
    };
  }

  currentDate({ timezone = '' } = {}) {
    const resolved = this.resolveTimezone(timezone);
    const now = new Date();
    return {
      tool: 'current_date',
      title: `Checking local date${resolved ? ` (${resolved})` : ''}`,
      timezone: resolved,
      iso: now.toISOString(),
      output: new Intl.DateTimeFormat('en-US', {
        timeZone: resolved,
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }).format(now)
    };
  }

  timezone() {
    const zone = this.localTimezone();
    return {
      tool: 'timezone',
      title: 'Checking local timezone',
      timezone: zone,
      output: zone
    };
  }

  systemInfo() {
    return {
      tool: 'system_info',
      title: 'Checking system information',
      output: [
        `platform: ${process.platform}`,
        `arch: ${process.arch}`,
        `release: ${os.release()}`,
        `hostname: ${os.hostname()}`,
        `node: ${process.version}`,
        `timezone: ${this.localTimezone()}`
      ].join('\n')
    };
  }
}

export function extractTimezoneRequest(text) {
  const lower = text.toLowerCase();
  for (const [alias, zone] of ZONE_ALIASES) {
    if (lower.includes(alias)) return zone;
  }
  const match = text.match(/\b([A-Za-z_]+\/[A-Za-z_]+)\b/);
  return match?.[1] ?? '';
}

function isValidTimeZone(value) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}
