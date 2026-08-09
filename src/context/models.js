export const ConnectorHealth = {
  CONNECTED: 'CONNECTED',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  UNAVAILABLE: 'UNAVAILABLE',
  ERROR: 'ERROR'
};

export function contextItem(type, fields) {
  return {
    type,
    id: fields.id,
    source: fields.source,
    sourceAccount: fields.sourceAccount ?? null,
    sourceContainer: fields.sourceContainer ?? null,
    externalId: fields.externalId ?? null,
    title: fields.title ?? '',
    summary: fields.summary ?? '',
    url: fields.url ?? null,
    createdAt: fields.createdAt ?? null,
    updatedAt: fields.updatedAt ?? null,
    startAt: fields.startAt ?? null,
    endAt: fields.endAt ?? null,
    dueAt: fields.dueAt ?? null,
    status: fields.status ?? null,
    people: fields.people ?? [],
    labels: fields.labels ?? [],
    metadata: fields.metadata ?? {}
  };
}

export function sourceLabel(item) {
  return [item.source, item.sourceAccount, item.sourceContainer].filter(Boolean).join(' / ');
}

export function limitItems(items, limit = 10) {
  return items.slice(0, limit);
}
