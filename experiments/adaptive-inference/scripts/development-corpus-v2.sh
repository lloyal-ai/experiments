#!/usr/bin/env bash
set -euo pipefail
cd /data/experiments/experiments/adaptive-inference
export PATH=/data/fieldnote-production/runtime/node-v24.15.0-linux-x64/bin:$PATH
export LLOYAL_GPU=cuda LLOYAL_NO_FALLBACK=1 LLOYAL_DEV=1 N_BATCH=2048
export MODEL_PATH=models/llm/Qwen3.5-4B-BF16.gguf RUN_DIR=runs/aa-lcr-development-corpus-v2
node --import tsx src/run-aa-lcr.ts plans/development-corpus-v2.json work/prepared/aa-lcr-v1.1-ready
while IFS= read -r attempt; do
 node --import tsx src/grade-aa-lcr.ts "$RUN_DIR/$attempt/submission.json" work/datasets/aa-lcr /data/experiments-secrets/openai-judge.key "$RUN_DIR/$attempt/grading"
done < <(node -e 'const p=require("./"+process.env.RUN_DIR+"/plan.json");for(const a of p.planned)console.log(`q${a.questionId}-r${a.repeat}`)')
node --import tsx src/aggregate-aa-lcr.ts "$RUN_DIR"
