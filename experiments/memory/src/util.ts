import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Config } from './types.js';
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const digest = (x: string | Buffer | Uint8Array) => 'sha256:' + createHash('sha256').update(x).digest('hex');
export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
export const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);
export async function jsonFile(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + '\n');
}
export async function loadConfig(): Promise<Config> {
  const c: Config = JSON.parse(await readFile(resolve(ROOT, 'bench.config.json'), 'utf8'));
  c.serverBinary = resolve(ROOT, c.serverBinary);
  c.fieldnoteRoot = resolve(ROOT, c.fieldnoteRoot);
  c.model = resolve(ROOT, c.model);
  c.projector = resolve(ROOT, c.projector);
  c.reranker = resolve(ROOT, c.reranker);
  return c;
}
export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}: timed out after ${ms}ms`)), ms); })]); }
  finally { clearTimeout(timer!); }
}
