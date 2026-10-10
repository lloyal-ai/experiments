import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { sleep } from './util.js';
import type { Config, Emit } from './types.js';

export async function assertPortFree(port:number) {
  await new Promise<void>((res,rej)=>{const probe=createServer();probe.once('error',rej);probe.listen(port,'127.0.0.1',()=>probe.close(()=>res()));});
}
export async function launchServer(config: Config, dir: string, emit: Emit, signal?:AbortSignal): Promise<ChildProcess> {
  signal?.throwIfAborted();
  await assertPortFree(config.port);
  const args = ['--model', config.model, '--mmproj', config.projector, '--host', '127.0.0.1', '--port', String(config.port), '--ctx-size', String(config.context), '--parallel', String(config.parallel), '--n-gpu-layers', config.cpuDiagnostic?'0':'99', '--jinja', '--kv-unified', '--cache-ram', '1024', '--cache-type-k', 'q4_0', '--cache-type-v', 'q4_0', '--metrics', '--slots', '--no-ui'];
  if(config.cpuDiagnostic)args.push('--device','none','--no-mmproj-offload','--no-op-offload','--fit','off');
  const log = createWriteStream(resolve(dir, 'llama-server.log'));
  const child = spawn(config.serverBinary, args, { stdio: ['ignore','pipe','pipe'] });
  const abort=()=>{void stopChild(child);};signal?.addEventListener('abort',abort,{once:true});
  child.stdout!.pipe(log); child.stderr!.pipe(log); child.once('close', () => log.end());
  let error: Error | undefined; child.once('error', e => { error = e; });
  emit('backend.start', { pid: child.pid, binary: config.serverBinary, args, revision: config.serverRevision });
  for (let i = 0; i < 240; i++) {
    signal?.throwIfAborted();
    if (error) throw error;
    if (child.exitCode !== null || child.signalCode) throw new Error(`llama-server exited (${child.exitCode ?? child.signalCode}); see ${dir}/llama-server.log`);
    try { const r = await fetch(`http://127.0.0.1:${config.port}/health`, { signal: AbortSignal.timeout(1000) }); if (r.ok) { signal?.removeEventListener('abort',abort);emit('backend.ready', { pid: child.pid }); return child; } } catch {}
    await sleep(500);
  }
  await stopChild(child); throw new Error('llama-server startup timed out');
}
export async function stopChild(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode) return;
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, 5000);
    child.once('exit', () => { clearTimeout(timer); resolve(); }); child.kill('SIGTERM');
  });
}
