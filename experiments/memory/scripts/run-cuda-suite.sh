#!/usr/bin/env bash
# Run on the provisioned Brev VM. Survives a laptop/SSH disconnect when launched
# with setsid/nohup. All model stages are sequential and retain their raw logs.
set -euo pipefail
cd "$(dirname "$0")/.."
. setup/environment.sh
suite_id="${LLOYAL_BENCH_SUITE_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
capacity_dir="comparisons/cuda-capacity-$suite_id"
composed_dir="comparisons/cuda-composed-$suite_id"
mkdir -p setup/cuda-suite
exec 9>setup/cuda-suite/supervisor.lock
flock -n 9 || { echo 'Another CUDA suite supervisor is already running'; exit 1; }
printf '%s\n' "$$" > setup/cuda-suite/supervisor.pid
stage() { python3 - "$1" <<'PY'
import json,sys,datetime,pathlib
p=pathlib.Path('setup/cuda-suite/status.json')
p.write_text(json.dumps({'stage':sys.argv[1], 'utc':datetime.datetime.now(datetime.timezone.utc).isoformat()},indent=2)+'\n')
PY
}
trap 'rc=$?; if [ "$rc" -ne 0 ]; then stage "failed (exit $rc); inspect supervisor.log"; fi' EXIT

if [[ -n "${1:-}" ]]; then
  stage "waiting for existing capacity controller $1"
  while kill -0 "$1" 2>/dev/null; do sleep 10; done
  # If the original SSH session vanished, terminate only model children whose
  # telemetry path identifies this experiment before resuming a fresh attempt.
  python3 - "$capacity_dir" <<'PY'
import pathlib,sys,os,signal,time
prefix=str(pathlib.Path(sys.argv[1]).resolve())+'/'
owned=[]
for proc in pathlib.Path('/proc').iterdir():
    if not proc.name.isdigit(): continue
    try:
        cmd=(proc/'cmdline').read_bytes()
        if b'/src/experiments/memory/' not in cmd and b'/instrumentation/llama-server-build/bin/llama-server' not in cmd: continue
        target=next((v.split(b'=',1)[1].decode() for v in (proc/'environ').read_bytes().split(b'\0') if v.startswith(b'LLAMA_BENCH_MEMORY_LOG=')), '')
        if target.startswith(prefix): owned.append(int(proc.name))
    except (OSError,UnicodeError): pass
for pid in owned:
    try: os.kill(pid,signal.SIGTERM)
    except ProcessLookupError: pass
deadline=time.monotonic()+10
while owned and time.monotonic()<deadline:
    owned=[pid for pid in owned if pathlib.Path(f'/proc/{pid}').exists()]
    if owned: time.sleep(.2)
for pid in owned:
    try: os.kill(pid,signal.SIGKILL)
    except ProcessLookupError: pass
PY
fi
stage 'capacity sweep and boundary repetitions'
# Resume verifies all inference-worker, fixture and binary hashes. The explicit
# amendment is limited to the retained capacity-analysis repair.
resume_args=()
if [[ -f "$capacity_dir/protocol.json" ]]; then resume_args+=(--resume); fi
node --import tsx src/cli.ts memory capacity "${resume_args[@]}" --http-default-layout --output "$capacity_dir"
stage 'capacity analysis'
node --import tsx src/cli.ts memory capacity --analyze --output "$capacity_dir" > setup/cuda-suite/capacity-analysis.log

stage 'composed Fieldnote UI journeys'
set +e
PLAYWRIGHT_MODULE="${PLAYWRIGHT_MODULE:-$PWD/setup/browser/node_modules/playwright}" \
  node --import tsx src/cli.ts memory composed --browser-channel chromium --output "$composed_dir" \
  > setup/cuda-suite/composed.log 2>&1
composed_rc=$?
set -e
printf '%s\n' "$composed_rc" > setup/cuda-suite/composed.exit-code
node --import tsx src/cli.ts memory analyze --experiment "$composed_dir" > setup/cuda-suite/composed-analysis.log

stage 'offline figures'
if [[ ! -x setup/report-env/bin/python ]]; then
  python3 -m venv setup/report-env
  setup/report-env/bin/pip install 'matplotlib>=3.10,<3.11' > setup/cuda-suite/report-dependencies.log 2>&1
fi
setup/report-env/bin/pip freeze > setup/cuda-suite/report-requirements.txt
MPLCONFIGDIR="$PWD/setup/mpl-cache" \
  setup/report-env/bin/python scripts/report_cuda_capacity.py "$capacity_dir"
if [[ "$composed_rc" -ne 0 ]]; then
  stage 'capacity finished; composed journey needs investigation'
else
  stage 'finished; composed answer quality remains unreviewed'
fi
