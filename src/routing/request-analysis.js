export const RequestCapability = Object.freeze({
  CONVERSATION: 'conversation',
  REASONING: 'reasoning',
  CODING: 'coding',
  REPOSITORY: 'repository',
  RESEARCH: 'research',
  CURRENT_INFORMATION: 'current_information',
  PERSONAL_CONTEXT: 'personal_context',
  CREATIVE: 'creative',
  LARGE_SYNTHESIS: 'large_synthesis',
  TOOL_USE: 'tool_use',
  AGENT_DELEGATION: 'agent_delegation'
});

export const DataClass = Object.freeze({
  PUBLIC: 'PUBLIC',
  LOCAL: 'LOCAL',
  PERSONAL: 'PERSONAL',
  SENSITIVE: 'SENSITIVE',
  SECRET: 'SECRET'
});

const words = (text, pattern) => pattern.test(text);

export function analyzeRequest(request = '') {
  const text = String(request).trim();
  const lower = text.toLowerCase();
  const capabilities = new Set([RequestCapability.CONVERSATION]);
  const signals = [];

  if (words(lower, /\b(code|coding|implement|fix|bug|debug|refactor|test|function|class)\b/)) capabilities.add(RequestCapability.CODING);
  if (words(lower, /\b(repository|repo|workspace|git|file|files|source code|branch|pull request|merge request)\b/)) capabilities.add(RequestCapability.REPOSITORY);
  if (words(lower, /\b(research|compare|comparison|analy[sz]e|synthesize|summari[sz]e|developments|important projects)\b/)) capabilities.add(RequestCapability.RESEARCH);
  if (words(lower, /\b(current|latest|today|now|recent|news|release|version|what's happening|what is happening)\b/)) capabilities.add(RequestCapability.CURRENT_INFORMATION);
  if (words(lower, /\b(calendar|meeting|email|gmail|drive|document|task|contact|personal)\b/)) capabilities.add(RequestCapability.PERSONAL_CONTEXT);
  if (words(lower, /\b(ask|delegate|codex|claude|opencode|specialist agent)\b/)) capabilities.add(RequestCapability.AGENT_DELEGATION);
  if (words(lower, /\b(search|fetch|look up|check|retrieve|what is the time)\b/)) capabilities.add(RequestCapability.TOOL_USE);
  if (words(lower, /\b(design|architecture|plan|trade[- ]?offs|deep dive|large|long context|five|ten)\b/)) capabilities.add(RequestCapability.LARGE_SYNTHESIS);
  if (words(lower, /\b(joke|story|poem|creative|brainstorm)\b/)) capabilities.add(RequestCapability.CREATIVE);

  if (capabilities.has(RequestCapability.CURRENT_INFORMATION)) signals.push('current-information language');
  if (capabilities.has(RequestCapability.RESEARCH)) signals.push('research/synthesis language');
  if (capabilities.has(RequestCapability.PERSONAL_CONTEXT)) signals.push('personal-context language');
  if (capabilities.has(RequestCapability.REPOSITORY)) signals.push('workspace/repository language');

  const complexity = text.length > 240 || capabilities.has(RequestCapability.RESEARCH) || capabilities.has(RequestCapability.LARGE_SYNTHESIS)
    ? 'high'
    : text.length > 80 || capabilities.has(RequestCapability.REASONING) ? 'medium' : 'low';

  return {
    request: text,
    capabilities: [...capabilities],
    confidence: signals.length >= 2 ? 'high' : signals.length ? 'medium' : 'high',
    complexity,
    needsLiveData: capabilities.has(RequestCapability.CURRENT_INFORMATION) || capabilities.has(RequestCapability.TOOL_USE),
    signals
  };
}

export function classifyData({ request = '', route = '', extraClasses = [] } = {}) {
  const text = `${request} ${route}`.toLowerCase();
  const classes = new Set(extraClasses);
  if (/\b(api key|apikey|token|password|credential|secret|authorization|cookie|oauth|private key|keychain|bearer)\b/.test(text)) classes.add(DataClass.SECRET);
  if (/\b(gmail|email|mail|calendar|meeting|drive|document|task|contact|personal|unread)\b/.test(text)) classes.add(DataClass.PERSONAL);
  if (/\b(private repo|private repository|private document|correspondence|sensitive|confidential)\b/.test(text)) classes.add(DataClass.SENSITIVE);
  if (/\b(repository|repo|workspace|local file|git diff|branch|source code|this project)\b/.test(text)) classes.add(DataClass.LOCAL);
  if (/\b(web|search|weather|public|news|documentation|docs|current|latest|research)\b/.test(text)) classes.add(DataClass.PUBLIC);
  if (!classes.size) classes.add(DataClass.LOCAL);
  return [...classes];
}

export function isPublicOnly(dataClasses = []) {
  return dataClasses.length > 0 && dataClasses.every((item) => item === DataClass.PUBLIC);
}
