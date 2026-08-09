import path from 'node:path';

export function resolveWorkspacePath(workspace, requested = '.') {
  const root = path.resolve(workspace);
  const resolved = path.resolve(root, requested);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Path escapes workspace: ${requested}`);
  }
  return resolved;
}

export function relativePath(workspace, absolute) {
  return path.relative(path.resolve(workspace), absolute) || '.';
}
