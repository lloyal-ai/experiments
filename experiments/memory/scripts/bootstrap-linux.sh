#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/home/ubuntu/.local/bin:/usr/local/cuda/bin:$PATH"
export ELECTRON_SKIP_BINARY_DOWNLOAD=1
mkdir -p setup
node scripts/prepare-instrumentation.mjs
node --version
nvcc --version
for app in . reference/fieldnote-app work/fieldnote-app work/fieldnote-instrumented; do
  (cd "$app" && npm ci --ignore-scripts --no-audit --no-fund && npm rebuild esbuild sharp)
done
# The pinned source release changed platform package versions without updating
# its lock. Resolve that metadata only, then refuse unrelated dependency drift.
cp instrumentation/lloyal-node/package-lock.json setup/native-lock.before.json
(cd instrumentation/lloyal-node && npm install --package-lock-only --ignore-scripts --no-audit --no-fund)
node --input-type=commonjs <<'JS'
const fs=require('node:fs');
const before=JSON.parse(fs.readFileSync('setup/native-lock.before.json'));
const after=JSON.parse(fs.readFileSync('instrumentation/lloyal-node/package-lock.json'));
const changes=[];
for(const [path,entry] of Object.entries(before.packages)) {
  if(!path||/node_modules\/@lloyal-labs\/lloyal\.node-(?:darwin|linux|win32)-/.test(path))continue;
  const next=after.packages[path];
  if(!next||entry.version!==next.version||entry.integrity!==next.integrity)changes.push(path);
}
if(changes.length)throw new Error('Native build dependency drift: '+changes.join(', '));
fs.copyFileSync('instrumentation/lloyal-node/package-lock.json','setup/native-lock.resolved.json');
JS
(cd instrumentation/lloyal-node && npm ci --ignore-scripts --omit=optional --no-audit --no-fund)
node --input-type=commonjs <<'JS'
const {createRequire}=require('node:module');
const fs=require('node:fs');
const path=require('node:path');
const req=createRequire(path.resolve('work/fieldnote-instrumented/package.json'));
process.env.LLOYAL_GPU='cuda';process.env.LLOYAL_NO_FALLBACK='1';
delete process.env.LLOYAL_LOCAL;delete process.env.LLOYAL_BACKEND_DIR;
const binding=req('@lloyal-labs/lloyal.node').loadBinary('cuda');
const devices=binding.listDevices();
if(!devices.some(d=>d.type==='gpu'))throw new Error('Published CUDA package did not expose a GPU');
fs.writeFileSync('setup/published-cuda-check.json',JSON.stringify({devices,node:process.version,sharedObjects:process.report.getReport().sharedObjects},null,2));
console.log('Published CUDA package:',devices);
JS
python3 - <<'PY'
from pathlib import Path
import json
root=Path.cwd()
def link(source,target):
    if target.is_symlink(): target.unlink()
    elif target.exists():
        backup=target.with_name(target.name+'.published')
        if backup.exists(): raise RuntimeError(f'Previous package backup exists: {backup}')
        target.rename(backup)
    target.symlink_to(source, target_is_directory=True)
app=root/'work/fieldnote-instrumented'
binding=root/'instrumentation/lloyal-node'
link(binding,app/'node_modules/@lloyal-labs/lloyal.node')
for package in ['@lloyal-labs/sdk','@lloyal-labs/lloyal-agents','effection']:
    link(app/'node_modules'/package,binding/'node_modules'/package)
config=json.loads((root/'bench.config.json').read_text())
config.update({'fieldnoteRoot':'reference/fieldnote-app','serverBinary':'instrumentation/llama-server-build/bin/llama-server','serverRevision':'d6d0ce8215a1c324e8de04b52f9dd65c5edc129f'})
for key in ['model','projector','reranker']:
    config[key]=str((root/config[key]).resolve())
(root/'bench.config.json').write_text(json.dumps(config,indent=2)+'\n')
PY
cat > setup/environment.sh <<'SH'
export PATH="/home/ubuntu/.local/bin:/usr/local/cuda/bin:$PATH"
export LLOYAL_GPU=cuda
export LLOYAL_NO_FALLBACK=1
export LLOYAL_BENCH_CUDA_ARCH=89
export LLOYAL_BENCH_BUILD_JOBS=8
SH
node scripts/snapshot-fieldnote.mjs --verify --source-only
node scripts/build-fieldnote.mjs
node scripts/prepare-ui.mjs
for app in work/fieldnote-app work/fieldnote-instrumented; do
  (cd "$app" && node_modules/.bin/esbuild targets/web/serve.ts --bundle --platform=node --format=esm --packages=external --outfile=dist/targets/web/serve.mjs)
done
printf 'Dependencies and configuration ready; source setup/environment.sh before building or running.\n'
