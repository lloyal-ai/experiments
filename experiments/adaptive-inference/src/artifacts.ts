import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

export function digest(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}
export function writeJson(path: string, value: unknown, exclusive = false): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: exclusive ? 'wx' : 'w' });
}
