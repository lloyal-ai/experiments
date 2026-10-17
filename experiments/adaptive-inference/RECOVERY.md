# Recovering the AA-LCR evaluation

This guide accompanies [PR #2](https://github.com/lloyal-ai/experiments/pull/2) and the [execution specification](https://linear.app/lloyal/document/benchmarks-aa-lcr-execution-specification-422517c4fec4). It covers a replacement operator or loss of the GPU host. Read the current run artifacts before acting; historical process IDs are hints, not proof of a live process.

## What survives and what does not

| Material | Durable location | Recovery use |
| --- | --- | --- |
| Solver, prompts, tests, declared plans, dependency lock and corrected ability tarball | This repository, `fix/corpus-offset-ability`; frozen solver commit below | Recreate the exact candidate |
| Per-answer source/submission/metrics hashes, costs and verdicts | [Public receipts](results/aa-lcr-full-corpus-offset-v7-r0/) | Verify recovered raw artifacts and identify published attempts |
| Full submissions, metrics, events, trace, run manifest/recipe/plan and judge receipts | Operator's private off-Brev backup | Preserve completed answers, grade them later, and account for work already spent |
| All 100 prepared solver inputs and main/reranker conversion receipts | Operator's private recovery snapshot; original public sources are revision-pinned | Recreate full ordered input without changing documents or conversion identity |
| Model weights | Re-download/reconvert from the pinned sources in the [README](README.md) | Rebuild the GPU environment; weights are intentionally not in Git/backups |
| Judge API credential | Separate private credential provision | Re-provision securely if the old host is lost; never obtain it from Git or run backups |
| In-flight GPU/KV state | Not checkpointed | An interrupted question restarts from its complete input; completed questions do not rerun |

**GitHub alone is not a backup of the answers.** Its receipts contain answer hashes, not answer text. The operator's local publisher now copies the raw run and verifies submission/metrics hashes, plus available grade/manifest hashes, before pushing a new receipt commit. It polls every 30 seconds while awake and connected. There remains a window between a host finishing work and the next successful backup; a completed but uncopied answer can be lost. The private operator handoff records exact local paths and the relay's process/session.

## Frozen identity

- Run: `aa-lcr-full-corpus-offset-v7-r0`, started `2026-10-17T12:39:09.514Z`.
- Solver Git: `32d1eee9535f0713cbcd0730437f30018b820100`.
- Recipe SHA-256: `6c7b031b6f7a992ab2630332d126cb6628b497e707b74f4fdd33aca3b7a599da`.
- Dataset revision: `9a77ef56b717057ade24ceab4d273712a0b4f19e` (AA-LCR v1.1).
- All 100 question IDs in numbered order, repeat 0, plan seed `20261017`; per-question/stage seeds are derived by the frozen harness.
- Main Qwen3.5-4B BF16, F16 K/V, 262,144 context / 16 slots / batch 2,048; worker capacity four. Auxiliary Qwen3-Reranker-0.6B BF16, F16 K/V, 32,768 context / ten slots / batch 2,048.
- Corpus build `3.0.0-bench-offset.1`; [source and tarball identities](vendor/corpus-offset-build.json).

Later publishing/documentation commits are not the solver revision. Do not substitute a newer package or prompt because it seems compatible. V6 is stopped, incomplete and unscored; never restart it or include its answers in V7. V3 and V5 are preserved development evaluations. The separately requested eight interim V7 grades are not the declared final grading track.

## If the host is merely disconnected

1. Check the existing solver and pipeline by their **full commands**, their start times, recent sampled-token/GPU receipts and current process GPU allocation. Never start a second model process while the original might still be running.
2. Reconnect the existing host/tunnel if possible. A dead SSH connection does not prove the evaluation died.
3. Check the publisher's `status.json` and full PID command. It retries connectivity failures and catches up completed answers. Its process lock prevents duplicate local publishers. Run it as a foreground process in a retained terminal session; detached `nohup` was reaped by this operator environment.
4. The existing pipeline already solves every question, then grades, aggregates and analyzes. If healthy, let it continue. Do not restart it merely to obtain a fresher status or a new prompt.

## If the host is lost

The runner intentionally has **no in-place resume flag**. It refuses existing manifests and attempt directories. Do not delete those guards, overwrite outputs, or run the original all-100 pipeline over a recovered directory. Recovery uses a separately recorded continuation segment and preserves the interrupted segment intact.

1. Preserve a read-only snapshot of the available private backup. Compare each `submission.json` and `metrics.json` file SHA-256 with its published receipt. Use `readSubmission` from [submission.ts](src/submission.ts) to check the submission's internal payload hash, and compare question/repeat, prompt, dataset and recipe identities. Where grades exist, verify their manifest binds the same submission file hash.
2. Classify attempts **before looking at correctness**. A durable frozen submission is authoritative, including a recorded solver failure; never rerun it to seek a better answer. A submission missing final metrics needs explicit incomplete-cost/cleanup accounting, not a silent retry. Attempts with no durable submission are interrupted or unstarted. If GitHub proves a submission existed but its raw payload was lost, record the loss; do not silently replace it and call the result the original pass.
3. Record an infrastructure recovery manifest outside the old run: interruption time/reason, old/new hardware, original planned denominator, retained attempt IDs/hashes, incomplete attempts and known wasted work, remaining IDs, and the planned recovery procedure. No score-based selection is allowed.
4. Clone/fetch the repository and create a **separate clean checkout at the frozen solver commit**. Restore the exact locked dependencies and packed corpus build with `npm ci`. Restore prepared inputs and conversion receipts, reacquire matching weights, and verify their hashes. Re-provision the judge credential privately. Keep current documentation/publication tools in a separate checkout if necessary; they postdate the frozen solver.
5. Verify CUDA with fallback disabled and the same configuration, then perform the existing preflight sequentially on the replacement GPU. Do not overlap it with any surviving evaluation process. Record replacement hardware/runtime identities; hardware differences must be disclosed.
6. Create a new plan file **outside the frozen checkout** by copying the original declared plan and replacing only its label and ordered `ids` with the genuinely remaining questions. Keep seed, repeat, dataset and timeout unchanged. Do not use correctness to decide membership. Run it into a fresh directory:

   ```sh
   export LLOYAL_GPU=cuda LLOYAL_NO_FALLBACK=1 LLOYAL_DEV=1 N_BATCH=2048
   export MODEL_PATH=/absolute/path/to/Qwen3.5-4B-BF16.gguf
   RUN_DIR=/absolute/new-continuation-run node --import tsx src/run-aa-lcr.ts \
     /absolute/recovery/remaining-plan.json /absolute/prepared-inputs
   ```

   The reranker and provenance files must occupy the layout described in the [README](README.md). Confirm the new segment's computed recipe hash equals the original before treating its outcomes as continuation of this candidate. Preserve the original partial attempt even when that question must restart.
7. Grade each durable answer exactly once on the final track, preserving existing matching final grades. A grade directory with only a partial API attempt needs an explicit recorded grading recovery; don't delete it to reuse the same path. Interim grades remain separate. Keep all API retry and duplicate-request costs.

## Joining recovered segments

There is **no implemented automatic cross-segment merger**. The next operator must construct and validate a separate aggregate view or add a tested recovery utility; do not relabel a subset as the full run.

The join must use the original 100-question plan and require exactly one authoritative submission for every `(questionId, repeat)`, including failures. Verify frozen solver and recipe identity, dataset revision, prompt hashes and seed policy across segments; verify grading is bound to those exact answers. A new aggregate view may reference each retained attempt directory without altering the original directories, and must carry a recovery manifest recording those source paths/hashes. Run the existing score aggregator only after these checks.

Keep each segment's trace and manifest separate. Do **not** concatenate native traces as though they were one process: trace IDs/time origins can restart. The existing `analyze-run.ts` expects a completed single-run trace, so recovered cost analysis needs per-segment accounting. Preserve abandoned generation, known interruption costs, extra model loads, downtime and missing measurements separately rather than inventing `completed.json` for a partial segment. Label the result an infrastructure-recovered pass, not an uninterrupted run.

These steps are a recovery protocol, not a claim that recovery has already been exercised. The current run is still uninterrupted. A new agent can rebuild the environment and continue the work from durable answers, but cannot resume a vanished model's token-by-token state.

## Completion

After all 100 final verdicts, verify denominator, failures, runtime, sampled tokens, reranker work and judging usage. Report the single-repeat result against AA's external 63% reference with the ten development-exposed cases and auxiliary model disclosed. Inspect the first full result before launching declared repeats 1 or 2. Push sanitized final artifacts to PR #2, update LLO-146 and the execution document, then stop the verified publisher and `finish-aa-lcr-gpu-evaluation` heartbeat. Full answers and credentials remain private.
