#!/usr/bin/env bash
set -euo pipefail
cd /data/experiments-ability-v7/experiments/adaptive-inference
export PATH=/data/fieldnote-production/runtime/node-v24.15.0-linux-x64/bin:$PATH
export LLOYAL_GPU=cuda LLOYAL_NO_FALLBACK=1 LLOYAL_DEV=1 N_BATCH=2048 MODEL_PATH=models/llm/Qwen3.5-4B-BF16.gguf
while kill -0 467311 2>/dev/null; do sleep 15; done
[ -f runs/aa-lcr-full-evidence-output-v6-r0/halt-signal.json ] || { echo 'V6 did not reach its recorded stop boundary'; exit 1; }
export RUN_DIR=runs/corpus-preflight-offset-v7
node --import tsx src/ability-preflight.ts
