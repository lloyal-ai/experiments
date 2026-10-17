# Adaptive inference: AA-LCR

Evaluate whether fixed model weights can answer long-context questions better through inference-time planning, exploration, verification and selection. The solver composes Lloyal's public SDK, agent pools, orchestration callbacks and corpus ability. Qwen3.5-4B owns reasoning and final answers; a separate Qwen3-Reranker-0.6B ranks passages when requested.

**Current state, 18 October 2026 (AEDT):** two complete ten-question development evaluations are recorded below. The first full 100-question AA-LCR v1.1 pass, V7 repeat 0, is running on an NVIDIA L40S. A full-set score is not available yet. [Live progress](results/aa-lcr-full-corpus-offset-v7-r0/progress.json) distinguishes completed answers from graded answers; [per-answer receipts](results/aa-lcr-full-corpus-offset-v7-r0/) are committed and pushed as they finish.

| Included | Location |
| --- | --- |
| Adaptive solver and public orchestration composition | [solver.ts](src/solver.ts), [composition.ts](src/composition.ts) |
| Typed decisions, source evidence and output contracts | [decisions.ts](src/decisions.ts), [evidence-spans.ts](src/evidence-spans.ts), [final-output.ts](src/final-output.ts) |
| Prompt templates and generated-token/context budgets | [prompts/](prompts/), [budgets.ts](src/budgets.ts) |
| Complete ordered input preparation and isolated grading | [aa-lcr.ts](src/aa-lcr.ts), [grade-aa-lcr.ts](src/grade-aa-lcr.ts), [aggregation.ts](src/aggregation.ts) |
| Frozen case selections, repeats, seeds and timeout | [plans/](plans/) |
| GPU preflights, development scores and measured costs | [results/](results/) |
| Corpus fix provenance and packed benchmark build | [vendor/corpus-offset-build.json](vendor/corpus-offset-build.json) |
| Fixes, corresponding PRs and next-release adoption guidance | [Release handoff](RELEASE-HANDOFF.md) |

Commands run from **`experiments/adaptive-inference`**. Dependencies and results are independent of the memory and Fieldnote reasoning experiments. AA-LCR is the implemented benchmark; DeepPlanning is next, with no result claimed here.

## Results and interpretation

| Candidate | Evaluation | Correct | Solver time | Generated tokens | Records |
| --- | --- | --- | --- | --- | --- |
| V3 — source ranges | Complete declared development set, 10 questions | 5/10, including one solver failure | 57.22 min | 118,208 | [Score](results/corpus-spans-v3-development.json), [performance](results/corpus-spans-v3-performance.json) |
| V5 — evidence checks and final-output capture | Same complete development set | 6/10, zero solver failures | 91.83 min | 246,687 | [Score](results/evidence-checks-v5-development.json), [performance](results/evidence-checks-v5-performance.json) |
| V6 — output normalization | Stopped before grading after three completed attempts because of the corpus read defect | Unscored; incomplete | Not a complete-run measurement | Not a complete-run measurement | [Preserved partial-run receipt](results/evidence-output-v6-incomplete.json) |
| V7 — corrected corpus reads | All 100 questions, fresh repeat 0 | Pending | Live receipts | Live receipts | [Declared plan](plans/full-corpus-offset-v7-r0.json), [progress](results/aa-lcr-full-corpus-offset-v7-r0/progress.json) |

V5 corrected two development answers and regressed on one. Every prior attempt is retained; rows are complete candidates, not the best answer from each version. V2 was stopped as an incomplete development run; V4 passed its GPU gate but did not run a scored batch. Neither has a comparable score.

The external reference is **63% for Qwen3.5-4B Reasoning on AA-LCR v1.1**, captured from Artificial Analysis on 17 October 2026: [source receipt](references/aa-qwen3.5-4b-2026-10-17.json), [published model page](https://artificialanalysis.ai/models/qwen3-5-4b). It is not a locally measured control. The small development sets and separately requested interim grades do not establish a gain over that full-set reference. The adaptive system also uses an auxiliary reranker and additional inference work; final reporting must include those costs and the different execution configuration.

Development-exposed IDs are **1, 6, 69, 80, 86, 94, 100, 4, 12, 96**. They informed generic harness and prompt changes and remain in the full denominator; this is not an untouched holdout. Repeat 0 is the first of declared repeats 0, 1 and 2. Inspect its complete score and cost before launching later repeats; a single pass is not the three-repeat mean. Failures count, and no answer is replaced or selected using grader feedback.

## How the solver works

Every question starts with fresh inference state and **all supplied documents, byte-preserved and in their original order**, in the initial context. The prepared solver input excludes the reference-answer column. The corpus tools expose only that question's numbered documents; no external web, other questions' answers or arbitrary filesystem reads are available to the model. The grader runs separately and reads the official criteria only after a submission is frozen. This is a tool/data boundary, not a claim of OS-level isolation.

The controller chooses `answer`, `discover`, `compose` or `verify`. Work can use parallel, chain, fanout, DAG or speculative alternatives, with the next decision informed by accepted findings. Independent discovery can run concurrently; work whose identity depends on discovery is chosen after the necessary findings exist. The public pool owns admission, batching and waits. [composition.ts](src/composition.ts) wraps the public factories to require accepted evidence before releasing dependent tasks; it is not a replacement scheduler.

Workers use the corpus ability's `grep`, `read_file` and BM25 plus reranked `search`, alongside finite arithmetic. Retrieval revisits the already-prefilled corpus. Source-address reports resolve document/line ranges to exact original passages. Invalid sources, unfinished or capped workers, and malformed outputs are rejected. Address validity establishes provenance, not whether a passage logically supports a claim.

Each work stage writes on a direct child of the trunk. Ordinary stages transfer accepted findings. Speculative stages retain alternative branches, select an accepted candidate with the same reasoning model, and adopt that live branch with `Branch.fastForward`. Siblings are cleaned up before the stage is adopted into the original trunk. No sibling KV states are merged. Fast-forward preserves parent identity; successful adoption does not claim KV-copy savings relative to fork-and-continue. [CUDA integration receipts](results/integration-2026-10-17.json) cover selection, two-level adoption, continuation and cancellation.

## Runtime and frozen configuration

Use Linux with Node.js **24+**, an NVIDIA CUDA GPU and Python 3 for preparation/publication utilities. `npm ci` restores SDK **5.1.0**, agents **7.1.0**, rig **6.1.0**, native binding **4.1.0** and Effection **4.2.0**. Harness inference uses public APIs and Effection scopes; it never imports the addon directly.

| Setting | Main reasoning model | Auxiliary reranker |
| --- | --- | --- |
| Model | Qwen3.5-4B | Qwen3-Reranker-0.6B |
| Weights / attention K,V | BF16 / F16,F16 | BF16 / F16,F16 |
| Context cells | 262,144 | 32,768 |
| Sequence slots / batch | 16 / 2,048 | 10 / 2,048 |
| Role | Decisions, workers, verification, selection, final answer | Passage relevance only |

The worker pool admits up to four agents. Sampling is temperature 1, top-p .95, top-k 20, min-p 0, repeat penalty 1, frequency penalty 0, presence penalty 1.5, last-N -1, with thinking enabled and recorded seeds. Search uses 256-token windows, 100 BM25 candidates, five returned hits and a 2,048-token admission budget. Ranking scores are relevance scores, not correctness judgments; there is no fixed zero-score cutoff in this candidate.

[budgets.ts](src/budgets.ts) permits 32,768 sampled tokens per turn and 196,608 across the whole attempt, starts exploration wind-down at 163,840, and reserves the remaining 32,768 for final synthesis. The limit includes all branches and recovery; pruning never refunds spent tokens. There are six controller rounds and at most 16 worker requests. Context soft/hard values are **remaining-cell reserves**, not a 32K input truncation: 49,152 / 24,576 for work and 12,288 / 4,096 for synthesis. The declared 19,700,519 ms timeout is a failure guard, not a target duration; a ten-minute no-sampled-token watchdog also runs.

V7 pins the **unsigned local benchmark build** `@lloyal-labs/corpus-ability@3.0.0-bench-offset.1`, built from [HDK #150](https://github.com/lloyal-ai/hdk/pull/150). It is not a published platform release. The [build receipt](vendor/corpus-offset-build.json) records source commit, tarball hash and the executable diff. Remaining production dependencies are unchanged.

The active run is frozen at solver commit [`32d1eee`](https://github.com/lloyal-ai/experiments/commit/32d1eee9535f0713cbcd0730437f30018b820100), recipe SHA-256 `6c7b031b6f7a992ab2630332d126cb6628b497e707b74f4fdd33aca3b7a599da`. Later receipt/documentation commits do not change that identity. New code, prompts, models or dependency settings require a separately identified run.

## Prepare a new CUDA setup

Fetch `fix/corpus-offset-ability` from this repository and run `npm ci` in this directory. The following prepares a **new** run; do not reinstall dependencies or launch another GPU job over the active frozen evaluation.

Pin dataset **AA-LCR v1.1**, revision `9a77ef56b717057ade24ceab4d273712a0b4f19e`. Place its original `AA-LCR_Dataset.csv`, `README.md` and `extracted_text/AA-LCR_extracted-text.zip` under `work/datasets/aa-lcr`, preserving that snapshot's layout. The CSV and README are needed for isolated grading. Extract the archive into a new `documents` directory and prepare it with:

```sh
python3 scripts/extract-aa-lcr.py \
  work/datasets/aa-lcr/extracted_text/AA-LCR_extracted-text.zip \
  work/datasets/aa-lcr/documents
npm run prepare:aa-lcr -- work/datasets/aa-lcr work/prepared/aa-lcr-v1.1-ready
```

The extractor handles unflagged UTF-8 and decomposed filenames without changing document bytes. Preparation preserves order, refuses existing outputs and missing or escaping paths, and emits only questions, complete documents, public metadata and integrity hashes. Keep the original CSV and judge credential outside the solver's tool surface.

Convert the original checkpoints with llama.cpp `convert_hf_to_gguf.py --outtype bf16`. The recorded converter revision is `1268edac579110aeb1407f7928f53193ed4e28d4`. These identities are required to reproduce the recorded configuration:

| Artifact | Original checkpoint revision | Expected GGUF SHA-256 |
| --- | --- | --- |
| `models/llm/Qwen3.5-4B-BF16.gguf` | `Qwen/Qwen3.5-4B` at `851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a` | `0acf2fed04e93fa6aa9a7f51ede61e0ce1dbbdc525dd81f333094bfd25d7d37e` |
| `models/reranker/Qwen3-Reranker-0.6B-BF16.gguf` | `Qwen/Qwen3-Reranker-0.6B` at `e61197ed45024b0ed8a2d74b80b4d909f1255473` | `da21fd092fa5130a96220a33e0682d7ccbf0c6622e3b1b35417b5d52c92d397a` |

See [model-receipt.py](scripts/model-receipt.py) for the provisioned layout and provenance collection, and [reranker conversion receipt](results/reranker-model-receipt.json). Provision `work/provision/model-receipt.json` and `work/provision/reranker-receipt.json`; the runtime verifies weight hashes and precision. The reranker path is pinned in [service-config.ts](src/service-config.ts); `MODEL_RECEIPT` can override the main receipt path. Model weights, installed dependencies, original datasets and private run artifacts are excluded from Git.

```sh
export LLOYAL_GPU=cuda LLOYAL_NO_FALLBACK=1 LLOYAL_DEV=1 N_BATCH=2048
export MODEL_PATH="$PWD/models/llm/Qwen3.5-4B-BF16.gguf"

# Run these sequentially, only when the GPU has no other evaluation running.
npm run smoke
npm run preflight -- work/prepared/aa-lcr-v1.1-ready
node --import tsx src/ability-preflight.ts
npm run integration
```

The mechanics smoke defaults to 32K context; **the AA-LCR runner does not**. Its configuration explicitly requests 262,144 cells and F16 K/V. CUDA is required, CPU fallback is forbidden, and the runtime refuses evaluation if its own PID has no GPU allocation. `PREFLIGHT_LOAD_ONLY=1` performs only the tokenizer census; `PREFLIGHT_PREFILL_ONLY=1` additionally prefills the longest input. These shortened gates do not replace the concurrent ability check.

The [V7 combined gate](results/corpus-offset-v7-preflight.json) passed with 122,307 input tokens, four accepted concurrent corpus workers, an exact offset read of lines 112–211, and an answer-only typed decision. It took 47.76 seconds, observed 26,699 MiB GPU usage / 18,787 MiB free, and released all cells and all 16 slots. These are integration measurements, not benchmark accuracy or a full-run throughput claim.

## Run, grade and inspect

Commit the solver and declared plan before running. The runner refuses a dirty tree or existing attempt outputs, resets state for each question and freezes submissions before grading. For a new complete pass using the current declared plan:

```sh
RUN_DIR=runs/my-v7-r0 node --import tsx src/run-aa-lcr.ts \
  plans/full-corpus-offset-v7-r0.json work/prepared/aa-lcr-v1.1-ready
```

The environment exports from the setup section still apply. The plan fixes every question, repeat 0 and seed policy; choose a new output directory. There is no selective retry or resume-by-overwrite command. Infrastructure interruptions retain their original receipts and require an explicit recovery record.

The isolated grader uses the pinned dataset's official v1.1 judging prompts with **GPT-5.6 Luna, medium reasoning**. It receives only the question, official answer criteria and frozen answer, not the document corpus. Supply an OpenAI credential in a private file with mode 0600. Run the connectivity fixtures once, then grade each submission to its own fresh directory:

```sh
node --import tsx src/judge-smoke.ts /absolute/private/key/file runs/new-judge-smoke
node --import tsx src/grade-aa-lcr.ts \
  runs/my-v7-r0/q1-r0/submission.json work/datasets/aa-lcr \
  /absolute/private/key/file runs/my-v7-r0/q1-r0/grading
# Repeat the grade command for every planned attempt, then:
node --import tsx src/aggregate-aa-lcr.ts runs/my-v7-r0
node --import tsx src/analyze-run.ts runs/my-v7-r0
```

Grading checks submission hashes, requires a completed structured verdict and records API failures separately, with at most three infrastructure attempts. Solver failures count as incorrect. Aggregation refuses missing, duplicate or unplanned grades and mixed recipes. The active Brev pipeline already performs solve-all → grade-all → aggregate → analyze; do not launch a duplicate pipeline. Its [deployment script](scripts/full-corpus-offset-v7-r0.sh) contains that machine's paths and is an operational record, not a portable bootstrap.

Private run directories contain the source copies, frozen answers, stage events, trace JSONL, GPU samples, per-role tokens, reranker costs and cleanup metrics. Per-attempt elapsed time and cumulative concurrent tool durations are different quantities. Reranker scoring-template token overhead and actual infrastructure billing rates are unavailable, not zero. The [V5-based projection](results/evidence-checks-v5-runtime-projection.json) of 12.19 hours per full pass is a planning estimate from a small development set, not a measured V7 duration.

## Verification and publication

```sh
npm test
npm run typecheck
python3 scripts/test_publish_answer_receipts.py
```

The V7 launch checks recorded **41 harness tests plus typecheck**, **15 upstream corpus tests/build**, and the real GPU gates above. The publisher has seven tests for content exclusion, submission/grade identity, incomplete attempts, denominators and idempotent commits. Scripted contract tests establish invariants; they are not model-quality measurements.

`python3 scripts/publish-answer-receipts.py RUN_DIRECTORY` waits for both a frozen submission and cleanup metrics, then commits one sanitized receipt per answer under `results/RUN_NAME/`. Later grades create separate updates. Receipts contain source/submission/recipe hashes, numeric costs and verdicts; raw answers, source documents, judge payloads, error text and credentials stay out of Git. `progress.json` keeps interim and final grading separate and reports no full-set percentage until all planned final verdicts exist.

A separate authenticated relay polls every 30 seconds and pushes those commits. It catches up after connectivity loss; the GPU solver does not depend on it. Raw artifacts are also backed up off Brev. See the [release handoff](RELEASE-HANDOFF.md) before carrying any fix into HDK, Glass or the research template; benchmark policy and upstream defects have different owners.
