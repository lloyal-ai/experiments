#!/usr/bin/env bash
# Run only after all measured stacks have stopped. This server performs post-hoc tokenization, no generation.
set -euo pipefail
cd "$(dirname "$0")/../../memory"
output="$(realpath "${1:?Pass the completed suite directory}")"
source setup/environment.sh
if pgrep -f '[/]llama-server |[/]bin/serve.js' >/dev/null; then
  echo 'Stop the inference stacks before post-hoc tokenization.' >&2; exit 1
fi
model="$(node -e "const c=require('./bench.config.json'); console.log(require('path').resolve(c.model))")"
mkdir -p "$output/tokenizer"
instrumentation/llama-server-build/bin/llama-server --model "$model" --host 127.0.0.1 --port 8097 --ctx-size 4096 --parallel 1 --n-gpu-layers 99 --no-ui --fit off > "$output/tokenizer/server.log" 2>&1 &
pid=$!
trap 'kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true' EXIT
ready=0
for i in $(seq 1 120); do
  if curl -fsS http://127.0.0.1:8097/health >/dev/null 2>&1; then ready=1; break; fi
  kill -0 "$pid" || exit 1
  sleep 1
done
if [ "$ready" != 1 ]; then echo 'Tokenizer server failed to become ready' >&2; exit 1; fi
curl -fsS http://127.0.0.1:8097/props > "$output/tokenizer/props.json"
python3 ../reasoning/scripts/analyze.py "$output" --tokenizer-url http://127.0.0.1:8097
python3 ../reasoning/scripts/verify.py "$output"
