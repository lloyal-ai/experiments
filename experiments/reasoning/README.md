# Fieldnote reasoning experiments

The benchmark runs the full Fieldnote Survey workload through its web UI: original PDF and site map uploads, Markdown corpus retrieval, reranking, fresh source preflight, planning and review, four concurrent inquiries, recovery when triggered, synthesis, a saved brief and a follow-up. It tests whether the exploratory synthesis-reasoning difference recurs on CUDA.

**Completed:** [NVIDIA L40S results, 10 October 2026](results/cuda-fieldnote-v1/README.md). In both substantive shared-prefix comparisons, Lloyal used fewer synthesis reasoning tokens (34.9% and 8.3% fewer) and scored higher on the frozen rubric (12 vs 8 and 15 vs 12 out of 18). The remaining shared-prefix output was only a tool-call block. Ordinary HTTP completed one report and exhausted its context in two attempts. [Read the complete answers side by side](results/cuda-fieldnote-v1/answers.html). All nine attempts, quality reviews and raw evidence are retained; these results do not establish a general advantage, a state-reuse mechanism or quality equivalence.

| Arm | Implementation |
|---|---|
| `resident` | Pinned Fieldnote and native abilities; resident context. Explicit sampling applied through the public `Branch.setSamplerParams` API at stage boundaries. |
| `http` | Existing idiomatic LangGraph JS host, same Fieldnote frontend, stock llama-server HTTP interface with prefix-cache enabled. |
| `shared-prefix` | The same HTTP workflow with a stable system/tool header. Full stage instructions and adjacent text/images enter in a user turn. Synthesis retains tool definitions with `tool_choice: none`. |

The shared-prefix arm uses natural request reuse, without hidden priming or padding. Its pilot recorded **1,788 synthesis prefix-cache tokens**. An earlier layout completed the workload but had zero synthesis hits; that pilot is retained. Shared-prefix placement changes model inputs, so this is a practical application control, not a pure cache on/off ablation. Synthesis instruction text is preserved, but the shared-prefix system message is different.

The [frozen protocol](protocol.json) specifies three repetitions per arm, randomized initial order with cyclic rotation, matched explicit sampling, unchanged workloads and retained failures. The [quality rubric](quality-rubric.json) covers factual correctness, evidence limits, the visual routing diagram and citations. Anonymous answer packets are scored separately from performance; the implementing assistant is not an independent reviewer.

## Run on the prepared CUDA host

First follow the [memory experiment setup](../memory/README.md) to install the pinned Fieldnote source, models, CUDA instrumentation and dependencies. Both experiments use that environment; the original Fieldnote app is retained.

From `experiments/memory`:

```sh
source setup/environment.sh
node ../reasoning/scripts/prepare-native.mjs
export PLAYWRIGHT_MODULE="$PWD/setup/browser/node_modules/playwright"
node ../reasoning/scripts/suite.mjs --output ../reasoning/runs/my-cuda-suite
```

Install Playwright 1.62.1 and its Chromium browser in `setup/browser` if absent, as described in the memory setup. Only one model stack runs at a time. The controller starts/stops backends, uses ordinary Fieldnote browser actions, records exact requests and native traces, and saves screenshots, answers and source identities. A fresh output directory is required. A failed run is recorded without silently replacing it.

For a single full-workload run:

```sh
node --import tsx ../reasoning/scripts/run.mjs \
  --arm shared-prefix --seed 4100 --output ../reasoning/runs/my-shared-prefix
```

Use `resident` or `http` for the other arms. Port 8100 serves the same Fieldnote UI during execution. Automated runs use one browser client; opening another active client would change the workload.

The generated native copy is `experiments/reasoning/work/fieldnote`. Its patch changes sampler settings and inquiry seed offsets only. It preserves the original orchestrator, abilities, prompts and budgets; `work/native-patch.json` records source hashes. Preflight inquiry seeds remain `2000+i`, as required by the pinned coverage API, on both implementations.

## Rebuild measurements and review

After the suite ends, use the same GGUF model in a standalone llama-server for `/tokenize` (no generation). Do this after the experiment stacks stop. Then:

```sh
python3 ../reasoning/scripts/blind-review.py ../reasoning/runs/my-cuda-suite
# Review answer-only packets before opening the mapping or performance results.
python3 ../reasoning/scripts/analyze.py ../reasoning/runs/my-cuda-suite \
  --tokenizer-url http://127.0.0.1:8097
python3 ../reasoning/scripts/verify.py ../reasoning/runs/my-cuda-suite
python3 ../reasoning/scripts/join-review.py ../reasoning/runs/my-cuda-suite
python3 ../reasoning/scripts/report.py ../reasoning/runs/my-cuda-suite
node ../reasoning/scripts/compare-answers.mjs ../reasoning/runs/my-cuda-suite
```

Save rubric assessments as `quality-review.json` before joining the mapping. The published review provides the expected format. On the prepared CUDA host, `bash ../reasoning/scripts/tokenize-and-analyze.sh /absolute/path/to/suite` starts and stops a standalone tokenizer server and runs analysis plus receipt verification, refusing to overlap existing model stacks. `report.py` requires Matplotlib and NumPy. To verify tokenizer counts afresh from an evidence archive, first move aside its `token-counts.json`; otherwise those saved post-hoc counts are reused. Primary reasoning metrics cover the initial brief; follow-up acceptance, quality and raw-log metrics are recorded separately.

Counting uses `add_special=false`, `parse_special=false`, retaining whitespace and removing explicit reasoning delimiters. Counts are post-hoc text tokens, not internal computation. Native recovery reasoning that cannot be reconstructed from the trace is marked unavailable. Completion, cache acceptance, and quality equivalence are separate judgments. The legacy `maxOutputTokens` setting in the memory package configuration does not cap this full Fieldnote settling path: there is no explicit synthesis output cap, and the resolved context limit and termination reason are retained. Numeric seed settings do not imply the same random-number stream across a continuing native agent and separate HTTP requests. Raw journals live under each suite run's `fieldnote/` or `langgraph/` directory; `summary.json` and `index.html` are derived artifacts.

The [9 October observations](observations-2026-10-09/README.md) remain historical evidence under different conditions. They are not pooled into the CUDA repetitions. A companion fixed-evidence causal diagnostic has not run; the current experiment preserves the full workload and its naturally differing generated findings.
