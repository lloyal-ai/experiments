#!/usr/bin/env bash
set -euo pipefail
cd /data/experiments-corpus-v4/experiments/adaptive-inference
export PATH=/data/fieldnote-production/runtime/node-v24.15.0-linux-x64/bin:$PATH
export LLOYAL_GPU=cuda LLOYAL_NO_FALLBACK=1 LLOYAL_DEV=1 N_BATCH=2048 MODEL_PATH=models/llm/Qwen3.5-4B-BF16.gguf
# No competing model load while the frozen development candidate is solving.
while kill -0 224984 2>/dev/null; do sleep 10; done
[ -f runs/aa-lcr-development-corpus-spans-v3/completed.json ] || { echo 'Inspect incomplete v3 batch before starting another GPU run'; exit 1; }
RUN_DIR=runs/corpus-preflight-discovery-v4 node --import tsx src/ability-preflight.ts
