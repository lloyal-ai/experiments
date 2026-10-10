import { constants } from 'node:fs';
import { cp, lstat, mkdir, readFile, readdir, readlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const bench = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sourceArg = process.argv.slice(2).find(a => !a.startsWith('--'));
const source = sourceArg ? resolve(sourceArg) : undefined;
const target = resolve(bench, 'reference/fieldnote-app');
const manifestPath = resolve(bench, 'reference/fieldnote-app.snapshot.json');
const excluded = new Set(['.git', 'node_modules', 'dist', 'dist-web', 'out', 'release', 'reports', 'traces']);
const skip = rel => excluded.has(rel.split('/')[0]) || rel.split('/').some(s => s === '.DS_Store' || s.endsWith('.local'))
  || rel.endsWith('.gguf') || rel.endsWith('.log') || rel === 'harness.json'
  || /^trace-.*(?:\.jsonl|\.attachments)(?:\/|$)/.test(rel)
  || /^media\/(?:index\.json|blobs|\.tmp)(?:\/|$)/.test(rel);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function entries(root, prefix = '', filter = () => false) {
  const rows = [];
  for (const name of (await readdir(join(root, prefix))).sort()) {
    const rel = join(prefix, name);
    if (filter(rel)) continue;
    const path = join(root, rel), info = await lstat(path);
    if (info.isSymbolicLink()) rows.push({ path: rel, link: await readlink(path) });
    else if (info.isDirectory()) rows.push(...await entries(root, rel, filter));
    else if (info.isFile()) rows.push({ path: rel, bytes: info.size, sha256: hash(await readFile(path)) });
  }
  return rows;
}

if (process.argv.includes('--verify')) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const current = await entries(target, '', skip);
  if (JSON.stringify(current) !== JSON.stringify(manifest.files)) throw new Error('Fieldnote source snapshot changed');
  if (process.argv.includes('--source-only')) {
    console.log(JSON.stringify({ verified: true, files: current.length, sourceDigest: manifest.sourceDigest, dependencyCheck: 'not requested; historical installed-tree digest is platform-specific' }));
    process.exit(0);
  }
  const dependencies = await entries(join(target, 'node_modules'), '', rel => rel.split('/').some(s => ['.vite', '.vite-temp', '.cache'].includes(s)));
  if (hash(JSON.stringify(dependencies)) !== manifest.installedDependencyDigest) throw new Error('Fieldnote installed dependencies changed');
  console.log(JSON.stringify({ verified: true, files: current.length, installedFiles: dependencies.length, sourceDigest: manifest.sourceDigest, target }));
} else {
  if (!source) throw new Error('Provide the Fieldnote source directory explicitly. The published reference already contains the pinned snapshot.');
  try { await lstat(target); throw new Error(`Snapshot already exists at ${target}; use --verify. Replacement must be explicit.`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const files = await entries(source, '', skip);
  await mkdir(target, { recursive: true });
  await cp(source, target, { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE,
    filter: path => !skip(relative(source, path)) });
  // Freeze the installed package tree as well; no symlink to a changing developer checkout.
  await cp(join(source, 'node_modules'), join(target, 'node_modules'), {
    recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE,
    filter: path => !relative(join(source, 'node_modules'), path).split('/').some(s => ['.vite', '.vite-temp', '.cache'].includes(s)),
  });
  const copied = await entries(target, '', skip);
  if (JSON.stringify(copied) !== JSON.stringify(files)) throw new Error('Source changed during snapshot or copy was incomplete');
  const dependencies = await entries(join(target, 'node_modules'), '', rel => rel.split('/').some(s => ['.vite', '.vite-temp', '.cache'].includes(s)));
  const manifest = { source, target, capturedAt: new Date().toISOString(), sourceDigest: hash(JSON.stringify(files)),
    installedDependencyDigest: hash(JSON.stringify(dependencies)), files, dependencies,
    exclusions: { generated: ['dist', 'dist-web', 'out', 'release', 'traces', 'trace-*'],
      privateState: ['reports', 'media/blobs', 'media/index.json', 'media/.tmp', 'harness.json', '*.local'],
      modelWeights: 'Referenced from original models/ by explicit path and hashed in each run; not copied.',
      dependencyCaches: ['.vite', '.vite-temp', '.cache'], metadata: ['.git', '.DS_Store', '*.log'] },
    note: 'All application source, targets, prompts, config declarations, signed ability archives, tests and installed dependencies are copied unchanged. Runtime data lives outside this snapshot.' };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ target, sourceDigest: manifest.sourceDigest, files: files.length, installedFiles: dependencies.length }));
}
