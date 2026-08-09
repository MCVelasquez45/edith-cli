import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveWorkspacePath, relativePath } from '../src/tools/path.js';

describe('workspace paths', () => {
  it('resolves paths inside the workspace', () => {
    const workspace = '/tmp/edith';

    assert.equal(resolveWorkspacePath(workspace, 'src/cli.js'), '/tmp/edith/src/cli.js');
    assert.equal(relativePath(workspace, '/tmp/edith/src/cli.js'), 'src/cli.js');
  });

  it('rejects paths that escape the workspace', () => {
    assert.throws(
      () => resolveWorkspacePath('/tmp/edith', '../secrets.txt'),
      /Path escapes workspace/
    );
  });
});
