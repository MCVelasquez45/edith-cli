// Governance tests: request analysis, data classification, and egress policy.
// (The regex execution planner and EdithAgentCore these once exercised were
// retired when the TrueForge-backed agent loop reached parity; the governance
// layer below is what wraps that loop — see runtime-governance.test.js for
// the integration surface.)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeRequest, classifyData, DataClass } from '../src/routing/request-analysis.js';
import { egressDecision, sanitizeExternalPayload } from '../src/routing/egress-policy.js';

describe('request analysis and privacy policy', () => {
  it('classifies simple, current, coding, and personal requests without a model call', () => {
    assert.equal(analyzeRequest('Tell me a joke').complexity, 'low');
    assert.equal(analyzeRequest('Research the latest Node.js release and compare changes').needsLiveData, true);
    assert.ok(analyzeRequest('Find the cause of the repository bug').capabilities.includes('repository'));
    assert.ok(analyzeRequest('Summarize my unread email').capabilities.includes('personal_context'));
  });

  it('classifies secret data and blocks every external processor', () => {
    const data = classifyData({ request: 'Send my OAuth token to NVIDIA' });
    assert.ok(data.includes(DataClass.SECRET));
    const decision = egressDecision({ dataClasses: data, processor: { id: 'nvidia:z-ai/glm-5.2', location: 'CLOUD' } });
    assert.equal(decision.allowed, false);
    assert.match(decision.reason, /SECRET/);
  });

  it('allows sanitized public research and denies personal context to cloud processors', () => {
    const cloud = { id: 'nvidia:z-ai/glm-5.2', location: 'CLOUD' };
    assert.equal(egressDecision({ dataClasses: [DataClass.PUBLIC], processor: cloud }).allowed, true);
    assert.equal(egressDecision({ dataClasses: [DataClass.PERSONAL], processor: cloud }).allowed, false);
    const payload = sanitizeExternalPayload('Authorization: Bearer fake-token\napi_key=fake-key\npublic text');
    assert.doesNotMatch(payload, /fake-token|fake-key/);
    assert.match(payload, /public text/);
  });

  it('keeps fake personal and secret payloads out of external processing metadata', () => {
    const data = classifyData({ request: 'Summarize this Gmail body: personal@example.com; oauth_token=fake-oauth-token' });
    assert.ok(data.includes(DataClass.PERSONAL));
    assert.ok(data.includes(DataClass.SECRET));
    const decision = egressDecision({ dataClasses: data, processor: { id: 'nvidia:z-ai/glm-5.2', location: 'CLOUD' } });
    assert.equal(decision.allowed, false);
    assert.doesNotMatch(JSON.stringify({ dataClasses: data, reason: decision.reason }), /fake-oauth-token|personal@example.com/);
  });
});
