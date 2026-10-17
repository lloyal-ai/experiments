# AA-LCR fixes and release handoff

This is the adoption record for changes discovered while building and running the adaptive AA-LCR harness. Status was checked on **18 October 2026 (AEDT)**. The benchmark implementation and its regression tests are in [experiments #2](https://github.com/lloyal-ai/experiments/pull/2). The independently actionable platform fix is [HDK #150](https://github.com/lloyal-ai/hdk/pull/150), currently an **open draft**, not a released package.

The active V7 run is frozen at [`32d1eee`](https://github.com/lloyal-ai/experiments/commit/32d1eee9535f0713cbcd0730437f30018b820100). Release work must not replace its installed ability, source, prompts, answers or recipe. A published dependency or subsequent improvement gets a new run identity. No full-set score improvement is attributed to these fixes yet.

## Platform fix ready for upstream review

### Corpus `read_file`: default the end from the requested offset

**Failure:** `read_file({startLine: 112})` without `endLine` returned an empty result with an inverted `112–100` range. The default end was absolute line 100. This occurred in five V5 development reads; it is a reproduced tool defect, not evidence that five benchmark answers would change.

**Change:** the omitted end now means up to 100 lines starting at the requested line, clipped at EOF. Attended-history subtraction uses that same span. The tool description states the default explicitly.

- Owner: HDK `packages/abilities/corpus`.
- PR: [hdk #150](https://github.com/lloyal-ai/hdk/pull/150); implementation [`ae79ebc`](https://github.com/lloyal-ai/hdk/commit/ae79ebc2c17166b68d9871301ade22372aff755e).
- Red-first coverage: offset 112→211, EOF clipping, and subtraction after an offset read. All three regressions failed before the patch; all 15 corpus tests and the TypeScript build passed after it.
- Runtime check: the [V7 CUDA gate](results/corpus-offset-v7-preflight.json) verified the installed ability's exact 112–211 bytes, reranking, four accepted concurrent workers and complete teardown.
- Benchmark build: unsigned `3.0.0-bench-offset.1`; [source/base/tarball receipt](vendor/corpus-offset-build.json). Only the compiled read-file behavior and its source map differ from the previous installed executable; no SDK, agents or native engine patch is part of this fix.

**Next release:** review and merge #150, build and publish/sign the corpus ability through the normal HDK release process, then refresh any template-vendored corpus archive and its integrity/lock metadata. `link-local` does not replace an explicitly vendored ability tarball. Run the three regressions against the **installed packaged ability**, not only its source checkout. Do not distribute the unsigned benchmark tarball as the platform release.

## Harness corrections for template review

All changes below are implemented in **[experiments #2](https://github.com/lloyal-ai/experiments/pull/2)**. There is **no separate HDK/template PR for these ports yet**. They use existing public APIs; a harness correction is not automatically a framework defect. Port the behavior and regression where the destination has the same boundary, rather than copying benchmark-specific schemas or limits wholesale.

| Problem and implemented correction | Source / regression evidence | Intended adoption |
| --- | --- | --- |
| Discovery was artificially restricted to one task. Allow independent discovery tasks to execute together; defer task identities that genuinely depend on discovery results. Dependency acceptance still gates downstream work. | [`90ad087`](https://github.com/lloyal-ai/experiments/commit/90ad087); [composition contracts](test/composition.test.ts), [GPU preflight](results/concurrent-discovery-preflight-2026-10-17.json). | Adaptive harness/template decision validation. No change to the HDK scheduler is needed. |
| Requiring the model to transcribe source quotations rejected useful findings. Accept document/start/end addresses and copy the original passage after validating the address. Return specific schema errors and bounded prior output to the next controller decision, within the same budget. | [`6772357`](https://github.com/lloyal-ai/experiments/commit/6772357); [evidence-spans.ts](src/evidence-spans.ts), [source/repair regressions](test/evidence-spans.test.ts). | Templates that collect source-grounded findings. Source provenance does not establish logical entailment; retain uncertainty and verification. |
| A completed worker could emit valid range JSON without calling the terminal hook; the receiving boundary only accepted the hook's captured quotation form. Normalize either fully validated representation into the same finding. | [`c3a77c7`](https://github.com/lloyal-ai/experiments/commit/c3a77c7); `findingOutputSchema` and direct-output/invalid-source regressions in [evidence-spans.test.ts](test/evidence-spans.test.ts). | Output adapters that have distinct tool-argument and captured-result forms. Do not admit failed, capped, unfinished or protocol-contaminated workers. |
| The old 1,600-character passage cap rejected complete supporting sections even after normalization. Permit up to 8,192 characters / 100 lines per range while preserving the existing 38,400-character total finding ceiling; render prompts from shared limits. | [`21c6e6b`](https://github.com/lloyal-ai/experiments/commit/21c6e6b), [`0fd653b`](https://github.com/lloyal-ai/experiments/commit/0fd653b); per-section and aggregate-limit regressions in [evidence-spans.test.ts](test/evidence-spans.test.ts). | A configurable harness evidence policy, **not** a universal HDK default. Preserve source integrity and total admission limits; do not silently truncate quotes. |
| A valid completed prose answer was rejected because the harness expected a JSON envelope after capture. Reuse `defineOutput` capture and public `stripDanglingToolCall`; validate the resulting answer text. | [`53c8db9`](https://github.com/lloyal-ai/experiments/commit/53c8db9); [final-output.ts](src/final-output.ts), [capture/prose/protocol regressions](test/final-output.test.ts). | Template final-output adapters. This follows the framework's existing report pattern; it is not a reason to weaken typed decision or worker evidence schemas. |
| Final-answer decisions were forced to supply irrelevant topology/tasks fields. Require only action/reason for `answer`; retain topology and dependency validation for executable work. Keep the tool parameter object flat for tagged tool formats. | [`9c00278`](https://github.com/lloyal-ai/experiments/commit/9c00278); [decision contract regression](test/composition.test.ts), answer-only real-model probe in [ability-preflight.ts](src/ability-preflight.ts). | Adaptive decision schemas. The boundary still rejects supplied execution fields on `answer`; see the remaining limitation below. |
| The controller's reason for stopping was dropped before final synthesis. Preserve it in history as a proposed resolution to check against the sources and the original question. Generic prompts also check exact rows/metrics, periods, populations, denominators and requested scope. | [`8a83dfc`](https://github.com/lloyal-ai/experiments/commit/8a83dfc), [`53c8db9`](https://github.com/lloyal-ai/experiments/commit/53c8db9); [solver.ts](src/solver.ts), [controller](prompts/controller.eta), [final synthesis](prompts/final.eta). | Template synthesis handoff and prompt review. This is recorded behavior, not proof of a score gain or permission to trust a controller conclusion without verification. |
| Rejected workers only left a failure label, obscuring whether the model was repeating or failing the output contract. Save public `Agent.rawOutput`, sampled-token counters and rejection reasons in private events. | [`1eed871`](https://github.com/lloyal-ai/experiments/commit/1eed871); [solver.ts](src/solver.ts). | Harness diagnostics. Raw rejected text is not fed back as evidence and is excluded from public receipts. |

The generic prompt and evidence-budget changes are evaluated as part of complete versioned candidates. V3's 5/10 and V5's 6/10 remain unchanged, including the regression and failed output; neither result is recomputed with newer acceptance rules.

## Composition and evaluation patterns worth carrying forward

These are implemented harness patterns, not claims of previously broken framework behavior. Their corresponding implementation PR is [experiments #2](https://github.com/lloyal-ai/experiments/pull/2).

| Pattern | Implementation / verification | Release guidance |
| --- | --- | --- |
| Transactional stage writes and retained speculative selection | [solver.ts](src/solver.ts), [integration.ts](src/integration.ts), [CUDA receipts](results/integration-2026-10-17.json). Release retained siblings before adopting their parent into the next tree level; verify stable handles and continuation. | Reuse public `withSpine`, `useAgentPool`, `waitUntilSettled` and `Branch.fastForward`. Respect branch ownership and scope order. No addon calls, scheduler fork or successful-adoption KV-copy-saving claim. |
| Account for all generated work, including discarded branches and recovery | [`4073693`](https://github.com/lloyal-ai/experiments/commit/4073693), [budgets.ts](src/budgets.ts), [budget contracts](test/budgets.test.ts). Final allowance is reserved, and pruning does not refund tokens. | Reuse the public policy seam. Benchmark caps are workload choices; don't make them global template defaults. |
| Explicit auxiliary-model precision and observed cost | [`3ec67ae`](https://github.com/lloyal-ai/experiments/commit/3ec67ae), [runtime.ts](src/runtime.ts), [service-config.ts](src/service-config.ts), [reranker accounting tests](test/corpus-ability.test.ts). Public `createReranker` receives F16 K/V explicitly. | Rig 6.1.0's family binder does not expose per-service KV tuning; direct public-provider composition already works. A convenience configuration change is optional future API work, not an existing fix PR. |
| Full-document isolation, immutable submissions and complete-denominator grading | [input tests](test/aa-lcr.test.ts), [corpus isolation](test/corpus-ability.test.ts), [grading](test/grading.test.ts), [aggregation](test/aggregation.test.ts). All supplied bytes and order preserved; keys excluded; grading bound to submission hashes. | Keep in evaluation tooling. Model tools only see the declared corpus; claims of stronger OS isolation would require additional implementation. |
| Per-answer publication without leaking raw content | [`fb7651e`](https://github.com/lloyal-ai/experiments/commit/fb7651e9fbeac9520758ee76612360b215f629cc), [publisher](scripts/publish-answer-receipts.py), [seven publisher tests](scripts/test_publish_answer_receipts.py). Wait for answer plus cleanup metrics; later grades get separate updates. | Reuse for benchmark operations. Publish whitelisted receipts; keep raw documents, answers, judge payloads and credentials in private backups. |

The V5 retrieval audit found one search whose best relevance score was negative. The candidate retains the best available passages rather than imposing a fixed zero cutoff. Search returned hits on all 57 audited V5 calls. This is an observed reason to preserve the current ranking behavior, **not** a newly implemented reranker fix or a claim that every retrieved passage was useful.

## Related upstream work already merged

[Research template PR #71](https://github.com/lloyal-ai/lloyal-ai/pull/71), merged 17 October 2026, changes flat and chain synthesis instructions so the organizing thesis cannot narrow the user's question. It requires coverage of all requested parts, keeps complicating evidence, combines repetition and states gaps. This is a related, independently existing template change, **not a port of the AA-LCR controller-handoff fix**. Check the next template release contains it; don't open a duplicate. A merged PR alone is not proof that every published template artifact already includes the change.

## Remaining limits and adoption checks

- `answer` decisions may omit topology/tasks, but supplying those fields is still rejected rather than ignored. Redundant execution fields can consume a controller round. The GPU probe proves the valid minimal shape works; it does not prove the model always chooses it. Any change to this behavior needs its own contract decision, regression and new run version.
- Schema-valid source addresses do not guarantee the right accounting row, time period, population or logical conclusion. Prompt checks and verifier stages help but are not deterministic proofs.
- V6 is incomplete and unscored. V7 uses the corrected ability and must finish before a full-set accuracy/cost statement is made. Review [live receipts](results/aa-lcr-full-corpus-offset-v7-r0/progress.json) rather than inferring correctness from completion counts.
- The public per-answer publisher records interim and final verdicts separately. Interim grades must not substitute for the declared final grading track or choose answers.

For the next HDK/template release:

1. Land and publish the corpus fix via **HDK #150**, then update the template's installed/vendored package identity and verify offset reads through that package.
2. Audit the destination template against the table above. Open a focused template PR for matching corrections, carrying the failing regressions and source links; no such port PR exists yet.
3. Keep benchmark-specific limits, corpus-only access, judge plumbing and case accounting in the evaluation harness unless the destination has a corresponding product requirement.
4. Validate template invariants and output/cancellation contracts, then run a separate CUDA check for concurrency, branch continuation and complete teardown. Do not overlap it with the active benchmark GPU process.
5. Record the released package/template versions and update this handoff with the actual port PRs. Preserve the V7 lockfile, packed ability, frozen submissions and raw traces as its historical evidence.
