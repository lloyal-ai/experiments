#!/usr/bin/env bash
set -euo pipefail
cd /data/experiments-evidence-v6/experiments/adaptive-inference
export PATH=/data/fieldnote-production/runtime/node-v24.15.0-linux-x64/bin:$PATH
export LLOYAL_GPU=cuda LLOYAL_NO_FALLBACK=1 LLOYAL_DEV=1 N_BATCH=2048 MODEL_PATH=models/llm/Qwen3.5-4B-BF16.gguf
while kill -0 325940 2>/dev/null; do sleep 15; done
[ -f runs/aa-lcr-development-evidence-checks-v5/completed.json ] || { echo 'V5 did not complete; refusing to continue'; exit 1; }
export RUN_DIR=runs/corpus-preflight-output-v6
node --import tsx src/ability-preflight.ts
