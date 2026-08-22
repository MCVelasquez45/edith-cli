import { DataClass, RequestCapability, analyzeRequest, classifyData } from './request-analysis.js';
import { APPROVED_CLOUD_MODEL_ID, APPROVED_CLOUD_PROCESSOR_ID, DEFAULT_PROCESSING_MODE, egressDecision } from './egress-policy.js';

export function createExecutionPlan({ request, route, router, agents, mode = DEFAULT_PROCESSING_MODE, explicitProcessor = null } = {}) {
  const classification = analyzeRequest(request);
  const dataClasses = classifyData({ request, route });
  const nvidia = router?.modelGroups?.find((group) => group.providerId === 'nvidia')?.models?.find((model) => model.id === APPROVED_CLOUD_MODEL_ID);
  const nvidiaProcessor = nvidia ? { id: APPROVED_CLOUD_PROCESSOR_ID, provider: 'nvidia', model: nvidia.id, location: 'CLOUD' } : null;
  const localProcessor = router?.current ? { id: `${router.current.providerId}:${router.current.model.id}`, provider: router.current.providerId, model: router.current.model.id, location: 'LOCAL' } : null;
  const steps = [];

  if (route?.startsWith('network:') || classification.needsLiveData) {
    steps.push({ capability: RequestCapability.TOOL_USE, tool: route?.includes('weather') ? 'weather' : 'web_search', inputClassification: DataClass.PUBLIC, outputClassification: DataClass.PUBLIC });
  }
  if (route?.startsWith('context:')) {
    steps.push({ capability: RequestCapability.PERSONAL_CONTEXT, tool: route.split(':')[1], inputClassification: DataClass.PERSONAL, outputClassification: DataClass.PERSONAL });
  }
  if (route?.startsWith('workspace:')) {
    steps.push({ capability: RequestCapability.REPOSITORY, tool: 'workspace', inputClassification: DataClass.LOCAL, outputClassification: DataClass.LOCAL });
  }

  const wantsResearch = classification.capabilities.includes(RequestCapability.RESEARCH);
  const selectedExternal = explicitProcessor === 'nvidia' || (wantsResearch && nvidiaProcessor && classification.complexity === 'high');
  const processor = selectedExternal ? nvidiaProcessor : localProcessor;
  const decision = egressDecision({ dataClasses, processor, mode });
  const externalEgress = nvidiaProcessor
    ? egressDecision({ dataClasses, processor: nvidiaProcessor, mode })
    : { allowed: false, reason: 'no cloud processor available', sanitized: false };
  const publicResearchEgress = egressDecision({ dataClasses: [DataClass.PUBLIC], processor: nvidiaProcessor, mode });
  const finalProcessor = dataClasses.some((item) => [DataClass.PERSONAL, DataClass.LOCAL, DataClass.SENSITIVE].includes(item)) ? localProcessor : processor;

  if (selectedExternal && publicResearchEgress.allowed) {
    steps.push({ capability: RequestCapability.LARGE_SYNTHESIS, processor: nvidiaProcessor.id, inputClassification: DataClass.PUBLIC, outputClassification: DataClass.PUBLIC, egress: publicResearchEgress });
  }
  return {
    request,
    classification,
    dataClasses,
    steps,
    finalProcessor: finalProcessor?.id ?? null,
    processor: processor?.id ?? null,
    egress: decision,
    externalEgress,
    publicResearchEgress,
    mode,
    independentSteps: steps.filter((step) => step.tool).length > 1
  };
}
