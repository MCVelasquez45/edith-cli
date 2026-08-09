export const GoogleActionClass = {
  READ: 'READ',
  REVERSIBLE_WRITE: 'REVERSIBLE_WRITE',
  SENSITIVE_EXTERNAL_WRITE: 'SENSITIVE_EXTERNAL_WRITE',
  DESTRUCTIVE: 'DESTRUCTIVE'
};

export function classifyGoogleAction(operation) {
  const op = operation.toLowerCase();
  if (/^(get|list|search|read|inspect|find)\b/.test(op)) return GoogleActionClass.READ;
  if (/\b(create draft|create task|add label|create document)\b/.test(op)) return GoogleActionClass.REVERSIBLE_WRITE;
  if (/\b(send email|send mail|invite|share|update contact|modify event|update event|move event|reply)\b/.test(op)) return GoogleActionClass.SENSITIVE_EXTERNAL_WRITE;
  if (/\b(delete|trash|permanent|bulk|remove contact|delete event)\b/.test(op)) return GoogleActionClass.DESTRUCTIVE;
  if (/\b(create event|schedule|create file|rename|move file|update document|complete task|update task)\b/.test(op)) return GoogleActionClass.REVERSIBLE_WRITE;
  return GoogleActionClass.SENSITIVE_EXTERNAL_WRITE;
}

export function requiresExplicitConfirmation(actionClass) {
  return actionClass !== GoogleActionClass.READ;
}

export function requiresDestructiveConfirmation(actionClass) {
  return actionClass === GoogleActionClass.DESTRUCTIVE;
}
