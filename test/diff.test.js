import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { unifiedDiff } from '../src/tools/diff.js';

describe('unified diff', () => {
  it('reports additions and deletions', () => {
    const diff = unifiedDiff({ filePath: 'a.txt', before: 'one\ntwo\n', after: 'one\nthree\n' });

    assert.equal(diff.adds, 1);
    assert.equal(diff.dels, 1);
    assert.match(diff.text, /\+three/);
    assert.match(diff.text, /-two/);
  });

  it('returns an empty diff when content is unchanged', () => {
    assert.equal(unifiedDiff({ filePath: 'a.txt', before: 'same', after: 'same' }), '');
  });
});
