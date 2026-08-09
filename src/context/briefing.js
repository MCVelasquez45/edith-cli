import { ConnectorHealth, sourceLabel } from './models.js';

export class BriefingEngine {
  constructor({ queryEngine, systemTools }) {
    this.queryEngine = queryEngine;
    this.systemTools = systemTools;
    this.lastBrief = null;
  }

  async buildBrief({ updated = false, now = new Date() } = {}) {
    const snapshot = await this.queryEngine.snapshot({ now, limit: 8 });
    const sections = [];
    const dateLine = this.systemTools.currentDate().output;
    const timeLine = this.systemTools.currentTime().output;

    if (updated) sections.push(this.deltaSection(snapshot));
    if (snapshot.nextEvent) sections.push(section('NEXT UP', [formatEvent(snapshot.nextEvent, now)]));
    if (snapshot.remainingEvents.length) {
      sections.push(section('REMAINING TODAY', snapshot.remainingEvents.slice(0, 5).map((event) => formatEvent(event, now))));
    }
    if (snapshot.overdueTasks.length) sections.push(section('OVERDUE', snapshot.overdueTasks.slice(0, 5).map(formatItem)));
    if (snapshot.openTasks.length) sections.push(section('PRIORITIES', snapshot.openTasks.slice(0, 5).map((task) => `Suggested priority: ${formatItem(task)}`)));
    if (snapshot.unreadMessages.length) sections.push(section('MESSAGES NEEDING ATTENTION', snapshot.unreadMessages.slice(0, 5).map(formatItem)));
    const dev = [...snapshot.reviewRequests, ...snapshot.assignedIssues].slice(0, 8);
    if (dev.length) sections.push(section('REVIEWS / DEVELOPMENT', dev.map(formatItem)));

    const unavailable = snapshot.status.filter((row) => row.health !== ConnectorHealth.CONNECTED);
    if (unavailable.length) {
      sections.push(section('UNAVAILABLE SOURCES', unavailable.map((row) => `${row.name}: ${row.health} - ${row.detail}`)));
    }

    if (!sections.length) sections.push('No connected personal-context source returned actionable items.');
    this.lastBrief = briefFingerprint(snapshot);
    return [
      `Brief anchored to trusted local time: ${dateLine}, ${timeLine} (${snapshot.timezone}).`,
      '',
      ...sections.filter(Boolean)
    ].join('\n');
  }

  async buildEndOfDay({ now = new Date() } = {}) {
    const snapshot = await this.queryEngine.snapshot({ now, limit: 8 });
    const sections = [];
    if (snapshot.overdueTasks.length) sections.push(section('UNRESOLVED / OVERDUE', snapshot.overdueTasks.map(formatItem)));
    if (snapshot.openTasks.length) sections.push(section('POSSIBLE ROLLOVER', snapshot.openTasks.map((task) => `${formatItem(task)} — not moved; read-only phase.`)));
    const dev = [...snapshot.reviewRequests, ...snapshot.assignedIssues].slice(0, 8);
    if (dev.length) sections.push(section('REVIEWS / DEVELOPMENT STILL OPEN', dev.map(formatItem)));
    sections.push('COMPLETED\nConfirmed completions require a connected task or development source that marks items complete.');
    sections.push('UNKNOWN\nCalendar events that ended earlier today are not treated as missed or completed without evidence.');
    return [`End-of-day review anchored to ${this.systemTools.currentTime().output}.`, '', ...sections].join('\n');
  }

  deltaSection(snapshot) {
    if (!this.lastBrief) return 'CHANGED SINCE LAST BRIEF\nNo earlier brief is available in this EDITH session.';
    const current = briefFingerprint(snapshot);
    const added = current.filter((item) => !this.lastBrief.includes(item));
    if (!added.length) return 'CHANGED SINCE LAST BRIEF\nNo meaningful item changes detected since the last brief in this session.';
    return section('CHANGED SINCE LAST BRIEF', added.slice(0, 8));
  }
}

function section(title, lines) {
  return `${title}\n${lines.map((line) => `- ${line}`).join('\n')}`;
}

function formatEvent(event, now) {
  const start = new Date(event.startAt);
  const minutes = Math.round((start - now) / 60000);
  const relative = minutes >= 0 ? `in ${minutes} minute${minutes === 1 ? '' : 's'}` : 'earlier today';
  return `${timeOnly(start)} — ${event.title} (${relative}; source: ${sourceLabel(event)})`;
}

function formatItem(item) {
  const bits = [item.title || item.summary || item.id];
  if (item.status) bits.push(`status: ${item.status}`);
  if (item.dueAt) bits.push(`due: ${item.dueAt}`);
  bits.push(`source: ${sourceLabel(item)}`);
  if (item.url) bits.push(item.url);
  return bits.join('; ');
}

function timeOnly(date) {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(date);
}

function briefFingerprint(snapshot) {
  return [
    snapshot.nextEvent?.id,
    ...snapshot.remainingEvents.map((item) => item.id),
    ...snapshot.unreadMessages.map((item) => item.id),
    ...snapshot.openTasks.map((item) => item.id),
    ...snapshot.overdueTasks.map((item) => item.id),
    ...snapshot.assignedIssues.map((item) => item.id),
    ...snapshot.reviewRequests.map((item) => item.id)
  ].filter(Boolean);
}
