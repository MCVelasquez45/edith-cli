export function buildProcessorRegistry({ router, agents = [] } = {}) {
  const processors = [];
  for (const group of router?.modelGroups ?? []) {
    for (const model of group.models ?? []) {
      const local = group.providerId !== 'nvidia';
      processors.push({
        id: `${group.providerId}:${model.id}`,
        provider: group.providerId,
        model: model.id,
        type: local ? 'MODEL' : 'MODEL',
        location: local ? 'LOCAL' : 'CLOUD',
        privacy: local ? 'HIGH' : 'EXTERNAL',
        contextCapability: model.contextLength ?? null,
        capabilities: model.capabilities ?? [],
        streaming: true,
        availability: model.state === 'remote' || model.state === 'loaded' || model.state === undefined ? 'AVAILABLE' : 'DISCOVERED'
      });
    }
  }
  for (const agent of agents) {
    processors.push({
      id: agent.id,
      provider: agent.id,
      type: 'SPECIALIST',
      location: 'EXTERNAL',
      privacy: 'EXTERNAL',
      capabilities: agent.capabilities ?? [],
      availability: agent.available ? 'AVAILABLE' : 'UNAVAILABLE',
      confirmationRequired: true
    });
  }
  return processors;
}

export function findProcessor(processors, id) {
  return processors.find((processor) => processor.id === id || processor.provider === id);
}
