import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensure, type Operation } from 'effection';
import { createContext } from '@lloyal-labs/sdk/node';
import { initAgents, JsonlTraceWriter, NSeqMax, PoolDefaults, waitUntilSettled } from '@lloyal-labs/lloyal-agents';
export function digest(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}
export function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}
export function command(file: string, args: string[]): string {
  return execFileSync(file, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).trim();
}
export function* gpuRuntime(label: string): Operation<{
  ctx: Awaited<ReturnType<typeof createContext>>; out: string;
  trace: JsonlTraceWriter; manifest: Record<string, unknown>;
}> {
  if (process.env.LLOYAL_NO_FALLBACK !== '1' || process.env.LLOYAL_GPU !== 'cuda')
    throw new Error('Require LLOYAL_GPU=cuda and LLOYAL_NO_FALLBACK=1 before process startup');
  const modelPath = resolve(process.env.MODEL_PATH ?? 'models/llm/model.gguf');
  const out = resolve(process.env.RUN_DIR ?? `runs/${new Date().toISOString().replaceAll(':', '-')}-${label}`);
  mkdirSync(out, { recursive: true });
  const manifestFd = openSync(`${out}/manifest.json`, 'wx');
  closeSync(manifestFd);
  const packages = Object.fromEntries(['sdk', 'lloyal-agents', 'rig'].map(name => [
    name, JSON.parse(readFileSync(`node_modules/@lloyal-labs/${name}/package.json`, 'utf8')).version,
  ]));
  const options = {
    modelPath, nCtx: Number(process.env.N_CTX ?? 32768),
    nSeqMax: Number(process.env.N_SEQ_MAX ?? 16), nBatch: 512,
  };
  if (!Number.isInteger(options.nCtx) || options.nCtx < 4096 ||
      !Number.isInteger(options.nSeqMax) || options.nSeqMax < 4)
    throw new Error('Invalid context or sequence capacity');
  const manifest: Record<string, unknown> = {
    label, startedAt: new Date().toISOString(), modelPath,
    modelSha256: command('sha256sum', [modelPath]).split(' ')[0], packages, options,
    lockSha256: digest(readFileSync('package-lock.json')),
    git: command('git', ['rev-parse', 'HEAD']),
    dirty: command('git', ['status', '--porcelain']),
    node: process.version, gpuVariant: 'cuda', fallback: false,
    gpu: command('nvidia-smi', ['--query-gpu=name,uuid,driver_version,memory.total', '--format=csv,noheader']),
  };
  writeJson(`${out}/manifest.json`, manifest);
  const fd = openSync(`${out}/trace.jsonl`, 'wx');
  const trace = new JsonlTraceWriter(fd);
  yield* ensure(() => { trace.flush(); closeSync(fd); });
  const start = performance.now();
  const ctx = yield* waitUntilSettled(createContext(options, { gpuVariant: 'cuda' }));
  yield* ensure(() => ctx.dispose());
  const computeApps = command('nvidia-smi', ['--query-compute-apps=pid,used_memory', '--format=csv,noheader,nounits']);
  const allocation = computeApps.split('\n').map(line => line.split(',').map(Number))
    .find(([pid]) => pid === process.pid);
  if (!allocation || !(allocation[1] > 0)) throw new Error('No GPU allocation for this process; refusing evaluation');
  Object.assign(manifest, { loadMs: performance.now() - start, pid: process.pid, gpuMemoryMiB: allocation[1] });
  writeJson(`${out}/manifest.json`, manifest);
  yield* initAgents(ctx, { traceWriter: trace, disposeContext: false });
  yield* NSeqMax.set(options.nSeqMax);
  yield* PoolDefaults.set({ enableThinking: true, pruneOnReturn: true, trace: false });
  console.error(`CUDA verified: PID ${process.pid}, ${allocation[1]} MiB. Receipts: ${out}`);
  return { ctx, out, trace, manifest };
}
