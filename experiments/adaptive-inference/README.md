# Adaptive inference evaluation

Benchmark solvers composed from Lloyal's released SDK, agents and rig APIs. The objective is stronger task performance from fixed model weights through inference-time planning, exploration, verification and selection.

Implementation and GPU execution happen on Brev. This directory is independent of the earlier memory and reasoning experiments. The initial runner validates CUDA loading, agent execution and public fast-forward behavior. AA-LCR is the first benchmark target, followed by DeepPlanning.

## Environment

- Node.js 24 or newer; `npm ci` restores exact package versions.
- NVIDIA CUDA GPU for native evaluations. CPU fallback must be disabled.
- Model weights, downloaded benchmarks and run artifacts stay outside Git.

The lockfile pins SDK 5.1.0, agents 7.1.0, rig 6.1.0 and the transitive native binding 4.1.0. `Branch.fastForward` is available through the SDK. Harness code must use public APIs; no native addon access or replacement scheduling loop.

## Recovery

Fetch branch `feat/adaptive-inference-evals` in `lloyal-ai/experiments`, run `npm ci` in this directory, and supply the model path from the new machine. Each working checkpoint is committed and pushed. Runs will carry model, source, dependency and dataset identities so a restarted machine does not silently change an experiment.

## Evaluation boundaries

Only public questions and supplied documents reach the AA-LCR solver. Reference answers grade frozen submissions in a separate process. Development runs are labeled as such; a small pilot is not a full benchmark score. Published model scores are external references, not local measurements.

## Mechanics smoke

Run `MODEL_PATH=/path/to/model.gguf npm run smoke` to validate the installed public runtime on CUDA. This short check defaults to a 32K context and is not the AA-LCR configuration. AA-LCR targets BF16 weights, F16 attention KV and 262,144 context after capacity validation. No benchmark score is claimed by the smoke.

`npm test` checks harness contracts; `npm run typecheck` checks TypeScript. Neither substitutes for real-model evaluation.

## AA-LCR input and capacity validation

Pin dataset revision `9a77ef56b717057ade24ceab4d273712a0b4f19e` (v1.1). Extract its archive with `python3 scripts/extract-aa-lcr.py ARCHIVE DESTINATION`; the extractor handles unflagged UTF-8 and decomposed filenames without modifying document bytes. Then run `npm run prepare:aa-lcr -- DATASET_DIRECTORY NEW_OUTPUT_DIRECTORY`. Preparation refuses overwrites, missing sources and escaping paths. Its output contains only ordered documents, questions, public metadata and integrity hashes. Keep the original CSV and judge credentials outside the solver's tool surface.

Convert the official `Qwen/Qwen3.5-4B` checkpoint at revision `851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a` with llama.cpp's `convert_hf_to_gguf.py --outtype bf16`. `scripts/model-receipt.py` records source hashes, converter identity, package versions, GGUF metadata and tensor types for the provisioned directory layout.

Run `MODEL_PATH=/path/to/Qwen3.5-4B-BF16.gguf MODEL_RECEIPT=/path/to/model-receipt.json npm run preflight -- PREPARED_DIRECTORY`. This explicitly requests 262,144 context, 16 sequences and F16 K/V. `N_BATCH` selects 512, 1024 or 2048. `PREFLIGHT_LOAD_ONLY=1` stops after the tokenizer census; `PREFLIGHT_PREFILL_ONLY=1` also prefills the longest complete input. Otherwise four agents check readability of the shared documents. Capture native stderr alongside the JSON receipts to verify layer offloading. These checks are not benchmark scores or a baseline.

### Budget and judge validation

The generated-token policy extends the public AgentPolicy seam. Its accounting retains
spent work after branch pruning and includes forced recovery. Unit contracts exercise
per-turn and whole-attempt caps, strict verdict parsing, and immutable submissions.

The separate grader reads a private credential file (0600), uses the pinned dataset's
v1.1 prompts and GPT-5.6 Luna at medium reasoning, and sends only question, answer
criteria, and the frozen submission. It never sends the document corpus. JSON-schema
output constrains the verdict; incomplete/API failures remain grading failures, with
at most three recorded retries. The solver never imports this entry point.

Run the connectivity fixtures with:

    node --import tsx src/judge-smoke.ts /absolute/private/key/file runs/new-judge-smoke

Run grading with:

    node --import tsx src/grade-aa-lcr.ts runs/attempt/submission.json work/datasets/aa-lcr /absolute/private/key/file runs/new-grade

Preflight on L40S with the BF16 model, F16 KV, and 262144 cells measured the longest
122139-token input at 26.35 s (batch 512), 22.75 s (1024), and 19.80 s (2048).
Four concurrent readers at batch 1024 generated 2747 tokens in 37.30 s, with peak
GPU usage 19067 MiB; all 16 sequence slots and all cells were released. This verifies
concurrency and cleanup, not benchmark accuracy: two recovered readability reports
contained protocol fragments and require stricter semantic validation before scoring.
