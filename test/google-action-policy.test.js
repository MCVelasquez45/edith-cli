import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyGoogleAction, GoogleActionClass, requiresDestructiveConfirmation, requiresExplicitConfirmation } from '../src/auth/action-policy.js';

describe('google action confirmation policy', () => {
  it('allows reads without confirmation and requires confirmation for writes', () => {
    assert.equal(classifyGoogleAction('search email'), GoogleActionClass.READ);
    assert.equal(requiresExplicitConfirmation(GoogleActionClass.READ), false);

    assert.equal(classifyGoogleAction('create task'), GoogleActionClass.REVERSIBLE_WRITE);
    assert.equal(requiresExplicitConfirmation(GoogleActionClass.REVERSIBLE_WRITE), true);

    assert.equal(classifyGoogleAction('send email'), GoogleActionClass.SENSITIVE_EXTERNAL_WRITE);
    assert.equal(requiresExplicitConfirmation(GoogleActionClass.SENSITIVE_EXTERNAL_WRITE), true);

    assert.equal(classifyGoogleAction('delete event'), GoogleActionClass.DESTRUCTIVE);
    assert.equal(requiresDestructiveConfirmation(GoogleActionClass.DESTRUCTIVE), true);
  });
});
