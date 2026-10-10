# Methods and evidence for the README figures

Recorded 9 October 2026. This is a standalone presentation of existing observations. No new model run was performed to make these charts. The additional shared-prefix HTTP control has **no measurements** yet. These are three selected pairs across evolving conditions, not three interchangeable independent replicates.

## Scope

One single-user Fieldnote research workload combines original PDF/image ingestion, Markdown corpus retrieval, neural reranking, source preflight, planning, four concurrent inquiries, recovery, synthesis and a saved brief. Both paths use the same Fieldnote frontend; the HTTP host uses idiomatic LangGraph JS, ordinary async tools and stock llama-server. No Lloyal inference scheduler or native branch API is added to LangGraph.

Fieldnote supplies one representative composed template workload, so measured deltas remain specific to these observations.

Both model stacks ran sequentially on the same Apple M2 Pro system with 16 GB unified memory and Metal. Main model: `qwen3.5-4b.gguf`; projector: `qwen3.5-4b-mmproj.gguf`; reranker: `qwen3-reranker-0.6b-q8.gguf`. Their hashes matched across the selected runs. Matching files do not establish identical engine numerics. Native runs used `LLOYAL_DEV=1`; trace overhead is included. Main context: 32,768. HTTP had four slots and a 1 GiB prompt cache; native used eight branches following a lifecycle-capacity failure at five.

HTTP explicitly requested synthesis temperature 0.8. The installed native cold-root default was 0.5 and branches inherited parameters; effective native synthesis sampler state was not fully recorded. Sampling parity is **not established**. Neither path used an explicit numeric synthesis output cap in these runs. Identical synthesis system instructions do not mean identical findings, ancestry, full prompts or model inputs.

The measured Survey path forks native synthesis from the shared spine and supplies inquiry findings through `synthesize-flat`; it does not transfer every inquiry's private reasoning into synthesis. Do not describe this observation as proof that the model remembers all its research, avoids re-derivation or implements System 1 cognition.

## Reading the execution diagrams

The diagrams show state ownership and execution boundaries. Native branches share inherited KV prefix state while maintaining private suffixes; the embedded runtime batches active branches. The HTTP application retains messages and graph checkpoints, and the server manages its own prefix cache and active request state. Matching retained prefixes can be reused across requests. Both paths execute locally in this benchmark, on the same infrastructure. The diagrams are architectural explanations, not a measured causal account of reasoning length.

Two agents are drawn for legibility; the measured workflow used four inquiries. Arrows within the native tree denote forks and execution access, not a merge of sibling reasoning. In the selected Survey runs, findings are supplied as text to synthesis. Tool execution stays in the application on both paths. Server cache eviction, model weights, media/reranker services and detailed scheduling are omitted from the diagram; their controls and receipts remain in the benchmark record.

Implementation references within the original benchmark: `reference/fieldnote-app/src/harness/research.ts` (Survey orchestration and synthesis), `src/graph/workflow.ts` (LangGraph state, fan-out and synthesis), `src/graph/model.ts` (ChatOpenAI HTTP requests with cache_prompt=true), and `.cache/llama.cpp/tools/server/README.md` (prefix caching and slots).

## Conditions and selection

- **A / original:** selected native attempt 2 and HTTP attempt 1. Native reused coverage; HTTP executed preflight. These are not equal end-to-end workloads.
- **B / repeat:** native again reused coverage. Controller edits overwrote task descriptions without consistently updating ability tags, confounding source routing and coverage. HTTP had excluded starts and a clarification outcome before the selected completion. Retained observations are not an unbiased sampling distribution.
- **C / revised:** fresh preflight on both paths, revised synthesis wording and unchanged generated plans. The plans and resulting evidence differed. This is a changed condition, not a prompt-only ablation or an identical repeat of A/B.

Every pair ran native before HTTP; run order and thermal state were not controlled. All original comparison eligibility flags remain false. Quality equivalence and a causal mechanism have not been established. The figures show individual observations with no error bars or significance claim.

## Metric definitions

- **Reasoning / answer tokens:** text after generation, counted with the same loaded GGUF tokenizer (`add_special=false`, `parse_special=false`). The tokenizer boundary differs from backend total generation accounting by two native or three HTTP tokens. Reasoning text length is not a measurement of unobserved internal deliberation.
- **Visible words:** approximate whitespace words after removal of Markdown link destinations and formatting; headings and source labels are included. Similar length does not establish equal quality.
- **First finding:** host timestamp of the first `agent:return` or `agent:recovered` with a nonempty `result`, minus `research:start`, within the research phase. These endpoints were re-read from all six raw journals for this package. It excludes preflight and review and is not browser paint, the first streamed partial finding, or scored usefulness.
- **Synthesis duration:** `synthesize:done.timeMs`, checked against the raw selected-attempt event. This is the settling phase, not total session time or pure server decode time.
- **Relative reduction:** `100 × (1 − Lloyal / HTTP)` for each pair. Printed ranges describe the smallest and largest selected observations, not confidence intervals.
- **Time to returned findings:** research-relative host time of the first nonempty return or recovery for each distinct agent, sorted by arrival; duplicate recovery/return notifications count once. The featured curve uses revised pair C, the latest condition. Lines connect the four observed integer milestones, without a fitted or smoothed model. The arrow marks the difference at the second finding: 282.624 − 162.354 ≈ 120 seconds. Both cost axes start at zero, and lower values mean less reasoning or less elapsed time. All six timelines and hashes are in [the bundled observations](alternatives/observations.json), with [all-pair times](alternatives/README.md#findings-over-time). Findings may differ in content and quality across implementations.

## All recorded values

| Pair | Backend | Reasoning tokens | Answer tokens | Approx. words | First finding (s) | Synthesis (s) | Research (s) | Query → saved (s) |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| A | Lloyal | 718 | 1,301 | 665 | 100.541 | 97.068 | 343.605 | 512.494 |
| A | LG + HTTP + prefix caching | 4,532 | 1,159 | 732 | 129.099 | 188.162 | 278.667 | 606.927 |
| B | Lloyal | 792 | 1,610 | 707 | 84.618 | 110.077 | 258.157 | 428.988 |
| B | LG + HTTP + prefix caching | 7,379 | 1,324 | 809 | 218.927 | 372.789 | 330.662 | 861.851 |
| C | Lloyal | 698 | 1,855 | 964 | 142.460 | 132.017 | 251.245 | 523.298 |
| C | LG + HTTP + prefix caching | 2,994 | 1,811 | 942 | 173.579 | 193.877 | 288.091 | 580.406 |

## Cache evidence and next control

All recorded main-model HTTP requests specified `cache_prompt=true`; the server launched with `--cache-ram 1024` and logged an enabled prompt cache. Raw timing receipts recorded 58.3%, 44.2% and 58.9% cache reuse across A/B/C. Every synthesis request had `cache_n=0`. Input position totals include cached tokens; they are not all re-evaluation. Native prefill cells and HTTP usage tokens are not interchangeable compute counters, and no 14× compute claim is made.

The next series has three arms: Lloyal resident KV; LG + HTTP + prefix caching with the existing layout; and LG + HTTP + prefix caching with a deliberately shared prefix. The last arm must use ordinary messages and stock server features, preserve evidence/tool access, verify the actual rendered token prefix and report nontrivial reuse at synthesis. Full-workload timing must include any deliberate priming. Resolve effective sampling, randomize arm order, retain failures and rerun all arms under one protocol. Do not append a new run as a third bar within historical A/B/C. Separate fixed-findings diagnostics from composed-workload results.

## Raw evidence locations

Paths below are relative to the original `lloyal-bench` directory; raw journals are not included in this compact public-facing package. Each session contains `observations.jsonl`; HTTP sessions also contain exact request JSON and streamed response receipts. The event-sequence boundaries and SHA-256 fingerprints are in [data.json](data.json). Public distribution of this package is not publication of the raw journals; archive those separately before claiming a fully reproducible public benchmark release.

| Pair / backend | Session directory | Attempt | Research start → first finding seq | Synthesis start → done seq |
|---|---|---:|---|---|
| A / fieldnote | `sessions/fieldnote-2026-10-08T11-17-51.047Z` | 2 | 6918 → 10341 | 18243 → 24575 |
| A / langgraph | `sessions/langgraph-2026-10-08T11-44-18.678Z` | 1 | 2584 → 5311 | 7800 → 13763 |
| B / fieldnote | `sessions/fieldnote-2026-10-08T14-41-28.149Z` | 2 | 9724 → 12895 | 18807 → 26334 |
| B / langgraph | `sessions/langgraph-2026-10-08T15-19-50.896Z` | 1 | 2425 → 6053 | 8581 → 17785 |
| C / fieldnote | `sessions/fieldnote-2026-10-08T23-20-42.648Z` | 1 | 4876 → 10574 | 13620 → 21689 |
| C / langgraph | `sessions/langgraph-2026-10-08T23-31-57.527Z` | 1 | 2004 → 5364 | 7828 → 12976 |

Source comparisons: `comparisons/composed-survey/comparison.json`, `comparisons/deliberation-repeat-2026-10-09/comparison.json`, and `comparisons/coverage-routing-2026-10-09/comparison.json`. Exact synthesis system SHA-256 values are in `data.json`. The exporter records the cumulative audit and journal-normalization code hashes, rechecks first-finding and synthesis event boundaries, and retains journal hashes.

## Related work

Zeyu Xing, Xing Li, Hui-Ling Zhen, Mingxuan Yuan and Sinno Jialin Pan (2026). **Beyond Speedup — Utilizing KV Cache for Sampling and Reasoning.** arXiv:2601.20326v1, especially [Section 6.2](https://arxiv.org/html/2601.20326v1#S6.SS2). Their learned KV-based difficulty estimator explicitly controls reasoning mode. These workflow observations do not use that controller and do not establish an alternative causal mechanism. The citation is prior-art context, not proof of the current interpretation or a novelty claim.

## Rebuilding and using the assets

The figures and README use the included `data.json` and `alternatives/observations.json`; no model server is required. With Python, matplotlib and NumPy installed, run `python build.py` in this directory. Five square plots and two execution diagrams (each 1620 × 1620 pixels, 300 dpi) are generated in `assets/`, with optional SVG versions. The featured pair contains reasoning bars and the time-to-findings curve, both with lower-is-better axes and measured gap annotations. Stage timing bars are available in a collapsed section, while answer length is stated in text. Titles, explanations and qualifications remain in README text. Copy this complete folder into a repository for working relative links, or adjust links when pasting the sections into the root README.

To re-extract from the original local evidence: `python collect.py --evidence /path/to/cumulative-evidence.json --benchmark /path/to/lloyal-bench`, then `python alternatives/build.py --evidence /path/to/cumulative-evidence.json --benchmark /path/to/lloyal-bench`, then `python build.py`. The original cumulative audit lives beside the earlier report source; it is an input dataset, not a PDF dependency. Raw logs and model weights are not bundled.
