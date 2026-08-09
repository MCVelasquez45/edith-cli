export function unifiedDiff({ filePath, before, after }) {
  if (before === after) return '';
  const a = before.split('\n');
  const b = after.split('\n');
  const max = Math.max(a.length, b.length);
  const lines = [`--- a/${filePath}`, `+++ b/${filePath}`, '@@'];
  let adds = 0;
  let dels = 0;
  for (let i = 0; i < max; i++) {
    if (a[i] === b[i]) {
      if (a[i] !== undefined) lines.push(` ${a[i]}`);
    } else {
      if (a[i] !== undefined) {
        lines.push(`-${a[i]}`);
        dels++;
      }
      if (b[i] !== undefined) {
        lines.push(`+${b[i]}`);
        adds++;
      }
    }
  }
  return { text: lines.join('\n'), adds, dels };
}
