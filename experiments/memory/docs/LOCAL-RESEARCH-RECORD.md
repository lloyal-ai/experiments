# Fieldnote workload bench

This runs the actual Fieldnote web interface against either its pinned Lloyal host or a compatible standalone LangGraph JS host using stock llama-server HTTP. There is no LangGraph REST deployment or Python server.

The replacement host has completed a real GPU composed Survey, follow-up and library reopen. **One completed Survey observation per backend is available below; repeated, quality-equivalent comparison is still pending.** The seven historical prototype records remain invalid comparisons. A successful launch, passing contract test, or plausible answer does not establish workload or output-quality equivalence.

## Run it

From a normal Terminal on this Mac:

```sh
cd /Users/zuhairnaqvi/dev/apps/lloyal-bench
./start.command langgraph --port 8100 --corpus fixtures/generated/corpus
```

Wait for the printed `Fieldnote:` URL, then open it. Startup fingerprints the code/models, starts the HTTP reranker and multimodal LLM, and checks a relevant/irrelevant reranking canary. The model server loads the projector with `--mmproj`. Use the regular Ask, Survey, Investigate, attachment, source, library and run controls.

Stop with **Ctrl-C** and wait for the shell prompt before starting the other stack:

```sh
./start.command fieldnote --port 8100 --corpus fixtures/generated/corpus
```

Both serve `work/fieldnote-app/dist-web`. The native side launches the unchanged host in `reference/fieldnote-app`, behind a one-to-one WebSocket/content proxy. The LangGraph side implements the same application protocol. Only one browser session is allowed. The model lease, process check and port checks prevent two resident stacks. The incumbent LLM and reranker are two services belonging to **one** stack; Fieldnote must be stopped while they run. CPU fallback is rejected.

The default data root is isolated for each launch. To keep a library across restarts, add a backend-specific directory, for example `--data data/langgraph`. New launch logs still go into a fresh `sessions/` directory. Do not share a data root between stacks.

Ability participation, corpus file/directory/glob configuration, effort and mode are runtime settings. Editing host source requires restarting its Node process. Model/storage changes are launch settings. The current environment's command sandbox cannot verify external processes/initialize Metal reliably; the normal Terminal launcher is the supported route for GPU validation.

## What is implemented

- A complete local Fieldnote copy, shared frontend build, actual reducer, inspector and media viewers. The original project and pinned snapshot remain untouched.
- Preflight for multiple participating source protocols, source coverage, structured planning/clarification, revisioned edits, Survey `Send` fan-out, sequential Investigate with inherited findings, synthesis, and direct/follow-up answers.
- Ordinary LangChain tool promises, `AbortSignal`, LangGraph checkpoints/interrupts and application state. There is no replacement scheduler, app-controlled KV ownership or pinned server slot.
- Corpus tools for Markdown/MDX. Original PDF/image bytes go through the pinned standalone media ingress. Document search/read/page/figure tools use real derived content; the selected image is submitted in a normal multimodal HTTP message.
- Token-fitted passages, BM25 candidate narrowing above 100, neural HTTP reranking, top-five/token-budget selection, read-range suppression and pinned tool schemas/instructions. The stock reranker has a different scoring route from the SDK; equivalence is **not** assumed.
- Cited reports with schema validation and the evidence-first check, full findings passed to synthesis, and saved reports/annexures/exchanges. No small fixed output cap is imposed. Recovery retains the pinned evidence/citation requirements, but does not invent a native free-KV word allowance.
- Hold at asynchronous boundaries, resume, per-agent cancellation, Close recovery, Stop, source changes for the next ask, library reopen/search/delete and transport disconnect cleanup. In-flight HTTP may continue during Hold; this is recorded explicitly.

The shared UI labels HTTP continuation **“Transcript resent over HTTP”**. It does not claim warm KV. Images are labelled submitted, not confirmed prefills. Native KV/entropy/perplexity fields remain unavailable on HTTP; no fake native events are emitted. A single observer presents the HTTP reasoning field; the same text is not emitted again from LangChain's streamed additional fields. This does not change model requests.

Live web research and its exploit reranking are outside the first local-source journeys. Native cache ownership, tick-level suspension, physical context pressure, entropy and exact native trace/replay are architectural capabilities, not emulated features. Model reload through the UI is currently rejected with an explicit message.

## Reproduce and verify

```sh
npm --cache .cache/npm ci
npm run doctor
npm run portable:extract
npm run fieldnote:verify
npm run fieldnote:ui
node scripts/verify-incumbent.mjs
npm run typecheck
npm test
```

The 22 incumbent tests cover graph/session/media/transport contracts, HTTP tool and reasoning streams, control behavior, follow-ups, portable helper conformance, and diagnostic reporting. Scripted test replies never produce inference measurements. The Markdown oracle loads only the pinned parsing utility; it creates no model context. The unchanged original application has its own 130-test invariant suite, separate from these tests.

Planning and recovery bind only their intended tool with `tool_choice: "required"`. The pinned stock server accepts `auto`, `none` and `required`; it warns and falls back to `auto` for the named-tool object otherwise emitted by LangChain. The HTTP contract test verifies the actual serialized request. Ordinary inquiry calls still expose the complete available tool set.

`reference/frontend.patch` records the shared presentation/instrumentation changes. `reference/frontend-patch.json` records their hashes. `reference/portable/manifest.json` records declarative extraction; `reference/incumbent-boundary.json` records helper provenance and the dependency audit. Applicable copied notices are under `reference/licenses/`.

`bench.config.json` selects existing model/projector/reranker files and the pinned server binary. The current host uses its model/context/port settings; legacy prototype fields such as `maxOutputTokens` do not cap the replacement's output. Stock caching is enabled, with unified KV, four server slots and a 1 GiB prompt-cache budget for the main server. Automatic fitting is disabled so a nominal GPU/context configuration cannot silently become a different one. Actual startup logs and `/props` are retained.

Native sequence capacity is read from `model.llm.branches` in `work/fieldnote-app/harness.yml` on launch. It is currently **8**, increased from the original **5** for the user-requested diagnostic of [HDK #145](https://github.com/lloyal-ai/hdk/issues/145). Context remains 32,768 cells. Each new native session records `native-harness.source.yml`, `native-harness.resolved.json`, and a `backend.config` observation. The original app, frozen reference, and prior five-branch evidence remain unchanged. Restart the host after editing this initialization setting; it is separate from runtime ability participation.

## Plot existing raw logs

The offline Python script reads the journals and exact HTTP response receipts directly. It does not launch either model stack, use saved diagnostic summaries as measurements, or modify raw evidence.

One-time plotting environment setup:

```sh
cd /Users/zuhairnaqvi/dev/apps/lloyal-bench
python3 -m venv .venv-plots
.venv-plots/bin/python -m pip install -r scripts/requirements-plots.txt
```

Generate the completed composed-Survey comparison:

```sh
.venv-plots/bin/python scripts/compare_raw_logs.py \
  --native sessions/fieldnote-2026-10-08T11-17-51.047Z --native-attempt 2 \
  --http sessions/langgraph-2026-10-08T11-44-18.678Z --http-attempt 1 \
  --output comparisons/composed-survey
open comparisons/composed-survey/index.html
```

The report contains nine Matplotlib chart sheets, each as PNG and SVG: latency/responsiveness, generation/reasoning size, tools/retrieval, HTTP/cache accounting, process resources, controls/attempt history, native state/epistemics, evidence/citation syntax, and server prompt/decode accounting. `comparison.json` contains the derived data, raw event references, request paths, journal snapshot hashes, missing-data indicators and all-attempt inventory. `reproduce.txt` records the exact command.

Attempt selection is mandatory and one-based. Pass `--list-attempts` with the two session paths to inspect every attempt before choosing; failed and controller-aborted attempts remain in the report. Pass `--json-only` to derive data with standard-library Python without plotting dependencies. Outputs must be outside the raw session directories. Browser clock resets suppress browser latency calculations; a truncated final journal line is flagged, while malformed completed lines fail parsing.

The completed pair uses native attempt 2 with eight branches and HTTP attempt 1. Preflight reuse, different execution paths and output-quality failures still apply. Charts describe observations; they do not turn this pair into a quality-equivalent repeated benchmark. Missing counters remain unavailable, reasoning characters are not reasoning tokens, and per-request service times may overlap. Energy, total GPU memory and automatic semantic-quality scores were not captured.

Raw evidence for this pair:

- Native: `sessions/fieldnote-2026-10-08T11-17-51.047Z/observations.jsonl`, alongside `fieldnote.log` and the resolved native configuration.
- HTTP: `sessions/langgraph-2026-10-08T11-44-18.678Z/observations.jsonl`, alongside `http/*.request.json`, `http/*.response.txt`, `reranker-requests/`, `llama-server.log` and `reranker.log`.

Parser checks, without model inference:

```sh
.venv-plots/bin/python -m unittest discover -s scripts -p 'test_raw_log_metrics.py' -v
```

## Evidence and validation status

Each `sessions/<backend>-<timestamp>/` retains:

- `manifest.json`, `identity.json`: launch options, source/model/binary/frontend fingerprints, explicitly unreviewed status.
- `observations.jsonl`: raw application events, commands, HTTP observations, browser observations and resource samples.
- `http/`: exact serialized chat requests and raw streamed responses, including tool arguments, images and server-reported cache usage.
- `reranker-requests/`: actual tokenizer/reranker inputs and outputs.
- Service logs and resolved server properties; native sessions retain native frames unchanged.
- Default `data/`: application library, media and inspected representation bytes, unless `--data` specifies a persistent root.

CPU/RSS samples are per process. RSS is not unique physical memory or total GPU allocation; shared pages must not be summed and labelled laptop memory usage. Browser paint observations are not proof of human reading. The same passive DOM prose observer is present for both hosts.

The first real corpus Survey produced two cited findings and demonstrated server-reported prefix reuse on subsequent HTTP calls. Its synthesis entered a prolonged reasoning loop and was stopped through the UI; this is retained as an unsuccessful diagnostic, **not** a Lloyal performance win. That launch also predates the forced-tool compatibility fix above.

The next GPU session (`langgraph-2026-10-08T08-24-36.547Z`) completed the PDF Ask and follow-up, with correct visual facts and exact image-byte receipts. Both answers named pages but lacked clickable page citations; the original PDF's embedded viewer was blank in the in-app browser despite correct source bytes and headers. Its `J2-review.json` records these failures and the successful library reopen. These are diagnostic timings, not comparable successful results.

That session also exercised both source probes, planning, four concurrent inquiries, Hold, image inspection, cancellation and resume. A recovery call failed because this Qwen template rejects a system message appended after history. The attempt was stopped and retained with `J1-review.json`. The source now sends recovery guidance as an ordinary user follow-up. Reissuing that failed recovery through the updated LangChain client against the real GPU server returned a structured report; the canary is under `validation/recovery-canary-2026-10-08T09-45-16.485Z`, separate from benchmark records. Duplicate reasoning presentation was also fixed. Full UI reruns must load those changes.

The native counterpart (`fieldnote-2026-10-08T10-14-37.954Z`) completed the same PDF Ask and follow-up, including library reopen. Both paths correctly answered the main visual question but lacked clickable direct-Ask citations. Its retained conversation branch contains the previous question/answer; the original inquiry's tool/image branch was pruned. Native follow-up ran three tools and viewed a figure crop; HTTP follow-up resent the saved page image and used no tools. Those differences prevent attributing their single-run latency difference to KV alone. See both `J2-review.json` files.

The native early-close Survey exercised Hold, image inspection, cancellation, resume, recovery and synthesis. After native Hold acknowledgement there were no generation events during 38.9 seconds held; the earlier HTTP run completed an in-flight response during its 15.5-second Hold. Different plans and intervention points make this behavioral evidence, not a controlled latency or energy comparison. Both sessions retain `control-observations.json`. Native planning repeated an inquiry four times and its early-close final report failed full cost/figure coverage; `J1-review.json` records that result. A subsequent attempt missed the review countdown and was stopped; it is retained as a controller failure.

The next native attempt applied all four predeclared objectives through the actual plan editor and returned all four inquiry findings, including the cost and figure facts. Synthesis then failed with `useAgent: the agent was not seated (no_sequence)`. That run's five-branch configuration matches the original Fieldnote config. The trace shows the last two inquiry branches surviving until the enclosing scope unwinds after the error; the SDK pool wrapper appears to leave their resource lifetime open across settlement. See `validation/native-synthesis-failure.json` and `J1-uninterrupted-review.json`. The suspected defect is filed as [HDK #145](https://github.com/lloyal-ai/hdk/issues/145); the user requested a higher-branch rerun before any SDK fix. No SDK/native implementation has been changed.

The user-requested eight-branch diagnostic (`fieldnote-2026-10-08T11-17-51.047Z`, attempt 2) completed synthesis and saved a brief, which reopened through the library. Synthesis reported 2,021 tokens in 97.1 seconds; research reported 5,814 tokens and 22 tool calls, including one recovered inquiry. No sequence refusal occurred in that attempt. The final report correctly describes the visual routes and has a working PDF page citation, but misses corpus cost/installation facts. The cost inquiry received the generated document-research prompt and chose document tools; corpus tools were still available. Ability routing is a prompt hint, not a tool restriction, on both hosts. Capacity/audit citations contain an invalid attachment identifier. The preceding incomplete plan edit is retained as a controller-aborted attempt. Increasing branch capacity worked around the failure without fixing the SDK. See `validation/native-branches-8.json`.

The corrected HTTP session (`langgraph-2026-10-08T11-44-18.678Z`, attempt 1) completed fresh source preflight, real planning, four reviewed inquiries, neural reranking, visual PDF tools, two inquiry recoveries, synthesis and a saved report. All 34 main-model HTTP requests completed. A follow-up without reattaching sources took 50.9 seconds, used three HTTP requests and two tools, and correctly answered capacity, daily cost and the visual bypass question. The report and follow-up both reopened through the library. See that session's `J1-uninterrupted-review.json`.

Observed phases for the same question, four objective descriptions, original sources, main weights/projector/reranker and shared frontend:

| Observation | Lloyal, 8 branches | LangGraph + llama-server |
| --- | ---: | ---: |
| First inquiry finding returned after research start | 100.5 s | 129.1 s |
| Research | 343.6 s | 278.7 s |
| Synthesis | 97.1 s | 188.2 s |
| Research start through saved brief completion | 443.4 s | 466.8 s |
| Reported inquiry tokens | 5,814 | 5,900 |
| Reported synthesis tokens | 2,021 | 5,694 |
| Research tool calls | 22 | 26 |

These are single observations, not repeated estimates or an isolated KV experiment. First finding means a host receipt, not a judgment that the section passes quality review. HTTP research was faster in this pair; native synthesis and time through saved completion were shorter. Synthesis output lengths and inquiry/tool paths differ. Native reused preflight coverage while HTTP performed fresh preflight, so total query-to-completion is not presented as a controlled speed ratio. The native and stock engine builds also differ. Exact phase values, raw event references and limitations are in `validation/composed-phase-observations.json`. HTTP sent 2,736,897 main-model request-body bytes and reported 151,804 prompt tokens, including 88,477 cached prompt tokens; these counters demonstrate backend reuse, not application-owned resident KV.

Quality remains separate from completion: HTTP synthesis includes the required cost/installation facts but omits the visual routing explanation, contains unresolved corpus citations and infers equal winter risk without evidence. The follow-up gives the correct visual answer but lacks clickable citations. Native and HTTP therefore both fail parts of the full cited-report review.

The synthesis token counts above include reasoning, not just the visible report. The actual answer text is approximately 665 visible words for native and 732 for HTTP (link destinations and Markdown formatting excluded); their Markdown lengths are 5,717 and 5,525 characters respectively. The HTTP reasoning stream contains 16,968 characters, versus 3,185 characters before the native end-of-thinking marker. The recorded synthesis system prompts are byte-identical (9,238 characters), both include the same concise-brief question, and neither has a numeric word/output-token cap. The native settle budget is only `maxTurns: 10`; the HTTP request has no output-token limit. Their supplied inquiry findings differ. See `validation/synthesis-size-quality-review.json` for the exact request/trace references and quality comparison.

The separate control rerun did not pass. Attempt 3 was stopped after the controller edited library search instead of the plan; its evidence remains in `J1-controller-failure.json`. Attempt 4 correctly applied all four objectives, but all four inquiries hit their 240-second limits during initial requests, before any generated tokens or tool results were observed. The server logged prompt recomputation and image processing. It settled without an answer; Hold/cancel/Close predicates never occurred. The cause of the slowdown is not isolated, and this later cache/process state must not be treated as an independent repeat or architectural win. See `J1-controlled-review.json`. No timeout was extended and no failed attempt was discarded.

The user subsequently reported a power interruption. macOS records low-power sleep at 23:13:56 and hibernate wake at 23:18:57 Melbourne time, after attempt 4 ended around 23:10:41. Sleep did not overlap the timed-out attempt. Power conditions were not sampled throughout the runs, so their performance remains descriptive. The HTTP host survived and the saved report/follow-up reconnected. After reconnect the UI incorrectly shows Quick for the originally Standard report; use the recorded medium-effort query receipt. See the session's `power-interruption-review.json`.

Repeated measurements, the corrected paired control journey and broader retrieval-quality comparison remain pending. `validation/rerank-figure-observation.json` records one matching real query whose four candidate rankings agree; this is not general score or retrieval equivalence.

`validation/first-pair.json` pins the first PDF Ask/follow-up validation procedure and fixture hashes. Derive a diagnostic summary without modifying raw evidence:

```sh
node scripts/summarize-session.mjs sessions/SESSION_DIRECTORY --write
```

This writes `diagnostic-summary.json`. It preserves failures, absent token counters, control dwell and separate per-process RSS. It never promotes a run to comparison eligibility, and a returned agent report is not automatically a useful cited section. Browser observations remain on their own clock in the raw journal.

The [implementation plan](IMPLEMENTATION-PLAN.md) defines the quality gates and composed journeys. The [workload audit](WORKLOAD-AUDIT.md) explains why older runs are invalid. Historical `run`, `analyze`, `replay`, `runs/` and `web/` code is retained for diagnosis; it is not the new host's execution path. The old `run` command remains gated. `replay` does not restore live KV state.

## Memory measurements

[Memory measurement protocol and commands](experiments/MEMORY.md) covers the instrumented public-API diagnostic and actual Fieldnote UI runs.
