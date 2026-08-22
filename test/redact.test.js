import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { redactSecrets, redactDeep } from '../src/security/redact.js';

describe('shared secret redaction', () => {
  it('redacts every known credential token family', () => {
    const samples = [
      'github_pat_11ABCDEF0123456789',
      'ghp_abc123DEF456',
      'gho_abc123DEF456',
      'ghs_abc123DEF456',
      'ghu_abc123DEF456',
      'glpat-AbC123-xyz_789',
      '1//0gFakeGoogleRefreshToken-abc',
      'ya29.a0FakeGoogleAccessToken-xyz',
      'sk-FakeOpenAiKey1234567890'
    ];
    for (const sample of samples) {
      const output = redactSecrets(`prefix ${sample} suffix`);
      assert.match(output, /\[REDACTED\]/, sample);
      assert.doesNotMatch(output, new RegExp(sample.slice(-8).replace(/[/.]/g, '\\$&')), sample);
    }
  });

  it('redacts key-value credential assignments in plain and JSON styles', () => {
    const plain = redactSecrets('api_key=fake-key password: hunter2 client_secret=csec9 oauth_token=otok8 credential=cred7');
    assert.doesNotMatch(plain, /fake-key|hunter2|csec9|otok8|cred7/);
    const json = redactSecrets('{"access_token":"opaque-value-1","refresh_token":"opaque-value-2"}');
    assert.doesNotMatch(json, /opaque-value/);
  });

  it('redacts authorization headers, env assignments, and bearer tokens', () => {
    const output = redactSecrets('Authorization: Bearer fake-token\nCookie: session=abc\nNVIDIA_API_KEY=nvapi-123');
    assert.doesNotMatch(output, /fake-token|session=abc|nvapi-123/);
  });

  it('supports a custom marker for surfaces that pin their format', () => {
    const output = redactSecrets('token ghp_abc123', { marker: '<REDACTED>' });
    assert.match(output, /<REDACTED>/);
    assert.doesNotMatch(output, /ghp_abc123/);
  });

  it('leaves ordinary text untouched', () => {
    const text = 'public research question about weather patterns';
    assert.equal(redactSecrets(text), text);
  });

  it('redacts strings nested inside objects with redactDeep', () => {
    const output = redactDeep({ note: 'uses ghp_abc123', nested: { auth: 'Bearer fake-token' }, count: 3 });
    assert.doesNotMatch(JSON.stringify(output), /ghp_abc123|fake-token/);
    assert.equal(output.count, 3);
  });
});
