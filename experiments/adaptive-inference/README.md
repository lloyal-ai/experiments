# Adaptive inference evaluation

Benchmark solvers composed from Lloyal's released SDK, agents and rig APIs. The objective is stronger task performance from fixed model weights through inference-time planning, exploration, verification and selection.

Implementation and GPU execution happen on Brev. This directory is independent of the earlier memory and reasoning experiments. The initial runner validates CUDA loading, agent execution and public fast-forward behavior. AA-LCR is the first benchmark target, followed by DeepPlanning.

## Environment

- Node.js 24 or newer; `npm ci` restores exact package versions.
- NVIDIA CUDA GPU for native evaluations. CPU fallback must be disabled.
- Model weights, downloaded benchmarks and run artifacts stay outside Git.

The lockfile pins SDK 5.1.0, agents 7.1.0, rig 6.1.0 and the transitive native binding 4.1.0. `Branch.fastForward` is available through the SDK. Harness code must use public APIs; no native addon access or replacement scheduling loop.

## Recovery

Fetch branch `fix/corpus-offset-ability` in `lloyal-ai/experiments`, run `npm ci` in this directory, and supply the model path from the new machine. Each working checkpoint is committed and pushed. Runs will carry model, source, dependency and dataset identities so a restarted machine does not silently change an experiment.

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

## Adaptive candidate

The controller reads the question and all documents, then chooses what work is useful.
It can answer, discover a decomposition, dispatch complementary work, request
verification, or compare alternative approaches. Decisions can change after findings
arrive. `composition.ts` uses the public orchestrator callback and supplied factories;
it does not introduce another scheduler. New answer-driven patterns can be added at
that callback seam.

Findings are accepted only when their cited quotations occur in the named input
documents. Missing evidence must be explicit. Failed, capped or malformed findings
cannot unblock dependencies. These checks establish provenance, not that a claim
follows logically from a quotation; model verification still matters.

Workers can revisit a numbered document or find a literal phrase in the supplied
corpus, and perform finite arithmetic. Every document is in the initial context;
these tools do not replace full-context input or access external sources.

A work stage runs on a direct child of the trunk. Ordinary stages transfer accepted
findings. Speculative stages retain the pool, select using the same model and evidence,
and adopt the selected live branch with `Branch.fastForward`. After sibling cleanup,
the stage commits to the original trunk. Both adoptions preserve parent identity;
they do not merge sibling KV states or save a copy relative to fork-and-continue.

`src/integration.ts` exercises real-model selection, two-level adoption, continuation
and cancellation on CUDA. An integration-discovered leaf requirement is reflected
in the scope order: retained siblings must be released before adopting their parent.

## Run and grade

A declared plan supplies IDs, repeats, seed, purpose and the resolved whole-attempt
operational timeout. The runner refuses a dirty Git tree and existing attempt
outputs. Each attempt owns clean inference state and freezes its answer before any
grading. Stop a batch on systemic runtime faults; do not silently replace poor answers.

    LLOYAL_GPU=cuda LLOYAL_NO_FALLBACK=1 LLOYAL_DEV=1 N_BATCH=2048 \
    MODEL_PATH=/absolute/model.gguf RUN_DIR=runs/new-run \
    node --import tsx src/run-aa-lcr.ts plans/development-v1.json PREPARED_DIRECTORY

Grade each frozen submission in a separate process using the earlier grading command,
with the attempt's `grading` directory as output. Then run:

    node --import tsx src/aggregate-aa-lcr.ts runs/new-run

Aggregation refuses missing, duplicate or unplanned grades and mixed recipes. Solver
failures remain in the denominator. Repeats are averaged, never selected by grader
outcome. Run directories include trace JSONL, stage decisions, frozen submissions,
per-attempt costs, periodic GPU allocation samples and cleanup receipts. Peak GPU and
live-cell metrics are observations, not a claim about unseen sub-sample transients.
Raw source documents and traces stay out of Git; publish summary receipts separately.

### Corpus composition (v2)

The signed `lloyal/corpus@3.0.0` ability supplies `grep`, `read_file`, and BM25 plus cross-encoder `search`; its own protocol and skills are rendered for workers. Each attempt materializes only its original complete documents under numbered filenames. This supplements the full ordered initial context. The final synthesis can revisit these same sources.

Qwen3-Reranker-0.6B uses the pinned original BF16 checkpoint, F16 K/V, 32,768 shared cells, ten sequence slots and batch 2048. The public `createReranker` provider is bound by the harness because the model-family binder does not expose per-service KV precision. No native access is used. Search uses the ability's 256-token windows, 100 BM25 candidates, top five hits and 2,048-token admission budget. Relevance scoring is not answer grading. Per-attempt receipts include ranking latency and document/query content tokens; scoring-template token overhead is unavailable and recorded as null.

`src/ability-preflight.ts` checks longest-input coexistence, real reranked search, four corpus workers, accepted evidence, fast-forwarded findings, GPU headroom and complete teardown. The red-first corpus isolation/accounting and singleton-discovery tests are part of `npm test`.

### Source ranges and decision repair (v3)

Workers cite `document`, `startLine`, and `endLine` from corpus `read_file`. The harness validates those addresses and copies exact original bytes into the accepted finding. It does not ask the model to retype long quotations or silently repair its prose. Logical support still needs model verification and benchmark judging; a valid address alone is not proof of the claim.

Invalid controller outputs receive their actual schema errors and bounded previous output on the next owned controller branch, within the same six rounds and generated-token allowance. They are never silently reinterpreted as a different topology. Native errors remain failures; no framework code is changed.


## Development results and current candidate

The complete predeclared ten-question v3 pilot scored **5/10** with the pinned official AA-LCR v1.1 grader, including one failed final output in the denominator. It used 57.22 solver-minutes and 118,208 generated tokens. The corpus reranker made 33 queries in 11.16 cumulative seconds; peak process allocation was 26,696 MiB. Every attempt released all inference cells and all 16 sequence slots. See [score receipt](results/corpus-spans-v3-development.json), [performance](results/corpus-spans-v3-performance.json), and [runtime projection](results/corpus-spans-v3-runtime-projection.json). This development subset is not comparable to a full-set leaderboard percentage.

V4 removed an unnecessary one-task restriction on discovery. Independent discovery tasks can now use the same public parallel orchestration as other work; identities that depend on discovery results are still selected after those findings exist. Its GPU preflight passed. The v4 scored plan was not run: the completed v3 failure review motivated the next combined candidate first.

V5 adds generic checks for exact metric/row labels, periods, populations, conditional percentages and scope. Final answer text uses the public `defineOutput` capture contract and `stripDanglingToolCall`, as the framework's report primitive does. A completed prose response no longer fails merely for lacking a JSON envelope; failed/capped outcomes, empty text and remaining protocol fragments are still rejected. Typed topology decisions and evidence-address validation remain strict. All 36 contract tests and typecheck pass. `plans/development-evidence-checks-v5.json` declares the same complete ten-case set and seed for evaluation; prior outcomes are retained unchanged.


### Evidence output normalization

The frozen V5 run exposed a harness boundary mismatch: a worker that completed with valid JSON line ranges without calling the terminal tool was checked against the post-capture quotation schema and rejected. V6 accepts either fully validated representation, resolving line ranges to the same exact source bytes before admission. It does not relax document, range, length, protocol, failed-worker or budget checks. A regression test first reproduced the rejection; all 38 tests and typecheck pass after the fix. V5 remains unchanged and will be reported as a complete candidate, including this defect. No V6 benchmark score exists yet.


A subsequent format audit found that all observed raw-range reports also exceeded V5's 1,600-character per-passage allowance; normalization alone would not have recovered them. V6 therefore permits a complete supporting section of up to 8,192 characters / 100 lines while retaining the same 38,400-character total evidence ceiling (the prior 24 × 1,600 maximum). No quote is silently cut. Both captured quotations and direct ranges enforce this ceiling. A second test reproduced a valid complete section being rejected first; the new total-limit regression prevents expanding aggregate admission. These are generic representation/budget changes, not answer-key corrections or retrospective score adjustments.

Validation after both fixes: all 40 tests and typecheck pass. No V6 model run has been launched.


The same frozen V5 trace also showed an answer decision rejected for putting `answer` in the irrelevant topology field. V6 makes topology/tasks conditional: final-answer decisions require only action and reason; executable work still requires a valid topology and tasks. The tool schema remains a flat object for tagged tool formats, with conditional requirements checked at the public output boundary. A red-first regression covers the simpler answer shape, and the queued GPU preflight now exercises an actual answer-only terminal call as well as four concurrent corpus workers. This is another harness-contract correction; no V5 outputs change.


Failure diagnostics now save rejected workers' unfinished `Agent.rawOutput` and public token counters in private run events. The V5 trace retained only `policy_exit` for a 32,768-token unfinished generation, preventing inspection of possible repetition. Raw diagnostic text is not fed back into the controller and is not included in public score receipts. Inference policy and acceptance are unchanged.


### Complete V5 pilot and full-set candidate

The unchanged V5 candidate scored **6/10**, with zero solver failures, on the same ten development questions: **91.83 solver minutes**, **246,687 generated tokens**, and **9,994 / 531 judge input/output tokens**. V3 was 5/10 in 57.22 minutes / 118,208 generated tokens. V5 corrected two answers and regressed on one; these are complete-candidate comparisons, not per-case best-of selections. This is not a comparable full-set score against AA's 63% reference.

The regression added an out-of-scope historical document to a requested outlook list. Earlier, the controller had identified the reference-matching list but its answer decision was rejected for an irrelevant topology field. Later work included a worker capped at 32,768 tokens; that output was rejected and synthesis still completed. V6 removes the mandatory execution fields from answer decisions and retains the controller's stopping reason in synthesis history as a proposed resolution to check, rather than dropping it at the break.

V6's public-API GPU check passed at the revision recorded in `results/evidence-output-v6-preflight.json`: 122,307 full input tokens, four accepted corpus workers, an answer-only terminal call, 26,703 MiB used / 18,783 MiB free, and zero live cells / all 16 slots after cleanup. The subsequent handoff change only retains the existing controller reason in the final prompt. No framework code or native access is involved.

The declared first full-set pass includes every one of the 100 v1.1 questions and explicitly discloses the ten development-exposed cases. It is one repeat, not the planned final three-repeat mean. V5's category-weighted planning projection is **12.19 solver hours per full pass**, with substantial uncertainty; the V6 changes may alter that cost. Full-set results are not available yet.


The corpus offset candidate (V7) changes only the corpus ability's default read window and its tool description. Omitting `endLine` now reads from `startLine` for up to 100 lines, clipped at EOF; attended-history subtraction uses the same window. Three regressions failed first, then all 15 upstream corpus tests and its build passed. The harness's 41 tests and typecheck also pass. Upstream review: https://github.com/lloyal-ai/hdk/pull/150.

V7 includes a locally built, explicitly unsigned benchmark package `3.0.0-bench-offset.1`, with HDK source commit and tarball hash in `vendor/corpus-offset-build.json`. Only `dist/tools/read-file.js` and its source map differ from the prior installed executable. The recipe includes provenance and the executable hash; this is not represented as a published platform release. Models, reranker settings, sampling, budgets and solver prompts remain unchanged from V6.

The short V6 full-set attempt is being stopped at its next completed-question boundary before any grading because the generic read defect was reproduced. Its outputs are retained as an incomplete unscored run; none will be reused or selected into V7. The new plan covers all 100 questions with one fresh answer each. V7 must pass a combined GPU preflight including the installed offset-read regression before launch. The prelaunch V5-based runtime projection remains approximately 12.19 solver-hours for a full pass, with substantial uncertainty.

### Corrected corpus ability GPU gate

The V7 GPU preflight passed with the pinned local corpus build: 122,307 input tokens,
four accepted concurrent workers, exact offset lines 112–211, and zero cells/all 16
sequence slots after cleanup. Total integration time was 47.76 seconds; GPU memory
was 26,699 MiB used / 18,787 MiB free. See
`results/corpus-offset-v7-preflight.json`. V6 stopped after three completed attempts
before grading; its next attempt has no submission or completed metrics. It remains
an unscored partial run, recorded in `results/evidence-output-v6-incomplete.json`.
V7 will execute the entire declared 100-question plan afresh.

### Per-answer result checkpoints

`scripts/publish-answer-receipts.py RUN_DIRECTORY` records one Git commit for each
finished attempt under `results/RUN_NAME/`. It waits for both the frozen submission
and cleanup metrics, records the original solver commit and artifact hashes, and
publishes only whitelisted numeric metrics and verdicts. Full answer text, source
documents, judge payloads, error text and credentials remain outside Git. Repeated
polls are idempotent; later grading creates a separate receipt-update commit.
`progress.json` distinguishes finished execution, interim grades, final grades and
an incomplete denominator. It cannot display a full-set percentage until every
planned attempt has a final verdict. Failed attempts remain in the denominator.

A separate local relay polls every 30 seconds and pushes these Brev commits using
existing local GitHub authentication. The solver and its frozen recipe do not
import this publisher. If the relay machine sleeps or loses connectivity, queued
results are committed and pushed when it returns; the Brev evaluation continues.
Run `python3 scripts/test_publish_answer_receipts.py` to check publication boundaries,
submission/grade identity, denominator handling and commit idempotency.
