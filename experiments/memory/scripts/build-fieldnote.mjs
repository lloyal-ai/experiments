import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const bench = fileURLToPath(new URL('..', import.meta.url));
const app = resolve(bench, 'reference/fieldnote-app');
const run = (command, args, cwd = app) => {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
};
run(process.execPath, ['scripts/snapshot-fieldnote.mjs', '--verify', '--source-only'], bench);
// Fieldnote's own build, without injected code or transformed UI sources.
run('npm', ['run', 'build:web']);
run(resolve(app, 'node_modules/.bin/esbuild'), ['targets/web/serve.ts', '--bundle', '--platform=node', '--format=esm', '--packages=external', '--outfile=dist/targets/web/serve.mjs']);
run(process.execPath, ['scripts/snapshot-fieldnote.mjs', '--verify', '--source-only'], bench);
const files = [];
async function record(base, prefix = '') {
  for (const entry of (await readdir(resolve(app, base, prefix), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = join(prefix, entry.name);
    if (entry.isDirectory()) await record(base, name);
    else { const bytes = await readFile(resolve(app, base, name)); files.push({ path: join(base, name), size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }); }
  }
}
await record('dist-web'); await record('dist');
const snapshot = JSON.parse(await readFile(resolve(bench, 'reference/fieldnote-app.snapshot.json'), 'utf8'));
await writeFile(resolve(bench, 'reference/fieldnote-app.build.json'), JSON.stringify({ builtAt: new Date().toISOString(), sourceDigest: snapshot.sourceDigest, installedDependencyDigest: snapshot.installedDependencyDigest, node: process.version, files }, null, 2) + '\n');
console.log('Built and fingerprinted the unchanged Fieldnote frontend and native web host.');
