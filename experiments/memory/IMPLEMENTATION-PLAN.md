# Fieldnote benchmark implementation plan

8 October 2026. Planning document; no new benchmark results are established by this plan.

Build a second host for the actual Fieldnote application using standalone LangGraph JS and stock llama-server over HTTP. Exercise the same composed user experience through one Fieldnote frontend build. Find where Lloyal provides better responsiveness, resource use, continuity, inspection or output at comparable useful quality, and retain evidence of ties, losses and failures as well as wins.

**The incumbent is a conventional LangChain/LangGraph application built to deliver Fieldnote's product requirements. It is not a port of Lloyal's model execution semantics.** Use documented framework patterns and the implementation choices a competent team could maintain in an ordinary project. Product-specific code is expected; a replacement inference runtime designed to imitate Lloyal is not. This constraint governs every phase below, including anything described as “parity.”

The first target is one user on this 16 GB laptop. Concurrent inquiries belong to that user's workload. SGLang, multiple users and a new frontend are outside this implementation. The first measured sources are Markdown corpus, attached PDFs and images. Live web research and its exploit reranking are a subsequent journey, not something the local-source results can establish.

## Implementation status — 8 October 2026

The compatible host now exists in `src/host`, `src/application`, `src/graph`, `src/runtime` and `src/measurement`. A complete working Fieldnote copy in `work/fieldnote-app` builds the shared frontend; the original and frozen snapshot are unchanged. The obsolete LangGraph adapter/tests moved to `prototype/`, and the old comparison runner remains gated.

The implemented application includes local-source preflight, planning/clarification/revisioned edits, Survey/Investigate/direct/follow-up flows, cited reports, synthesis, controls, library persistence, real media ingress, adapted corpus/documents tools and stock HTTP neural reranking. See README for launch commands, actual limitations and evidence paths. Scripted contract tests are separate from real inference.

Real incumbent startup loaded the LLM/projector/reranker. The basic reranker canary passed. A corpus Survey produced cited findings but its synthesis looped and was stopped; it does not establish a successful journey or a comparative result. Browser/PDF/composed-control validation, sequential native/HTTP retrieval-quality checks and repeated quality-reviewed pairs remain required. Every new session is still comparison-ineligible.

Frozen baseline source identity: `f848a0c09f645de780850efa4fe09ce9da472d20857e7121df7de7d6087be352` (133 source/config/vendor/test files; 16,861 installed dependency entries). Frontend changes, portable extractions, notices and the incumbent execution dependency boundary are recorded under `reference/`. Each new GPU launch records content hashes and resolved service properties. All seven historical prototype records remain invalid architecture comparisons.

## Application boundary

| Layer | Lloyal path | Incumbent path |
|---|---|---|
| User interface | The same Fieldnote application build | The same Fieldnote application build |
| Browser contract | Fieldnote commands/events over WebSocket; HTTP content endpoints | Compatible commands/events and content endpoints |
| Application host | Original Fieldnote host and harness from the snapshot | New LangGraph application host |
| Orchestration | Existing Lloyal runtime | StateGraph, Send, graph state/checkpoints, ordinary promises and AbortController |
| Model services | Existing native LLM, projector and reranker | Stock HTTP llama-server for the LLM/projector and a separately managed HTTP reranker |
| Measurement | Shared external controller and passive observations | Shared external controller and passive observations |

The controller starts and stops one stack, records inputs/outputs and drives user actions. It does not perform preflight, choose passages, supply findings, synthesize reports or provide either backend a hidden service. The LangGraph path must not call the Lloyal engine, scheduler, branch operations or native reranker.

Use standard LangChain model and tool interfaces rather than making the hand-written prototype HTTP loop the default. Start with `ChatOpenAI` configured for the local Chat Completions endpoint, ordinary message objects, `bindTools`/structured output, and framework streaming callbacks; verify support against the pinned packages and stock server. LangChain documents custom endpoints, tools and structured output in its [model integration](https://docs.langchain.com/oss/javascript/integrations/chat/openai). Use documented [graph state and fan-out](https://docs.langchain.com/oss/javascript/langgraph/graph-api), [checkpoint persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence) and [interrupt/resume](https://docs.langchain.com/oss/javascript/langgraph/interrupts) where they fit the application. These are implementation references, not evidence that every team uses the same architecture or that graph checkpoints retain model KV.

| Product requirement | Conventional incumbent implementation | Do not transplant from Lloyal |
|---|---|---|
| Follow up on a brief | Message history/checkpoint plus another model request; backend-managed cache reuse when available | Trunks, live KV branches, application-owned prefix pins, synthetic fork handles |
| Concurrent inquiries | Ordinary graph fan-out, async tools and configured concurrency | Native tick scheduling, cell admission, branch ownership or matching native interleavings |
| Review, Hold and resume | Graph interrupts/checkpoints at suitable boundaries and ordinary request handling; measure the actual latency and residual work | A bespoke scheduler that freezes inference like the native pool |
| Cancel, Close and Stop | Supported cancellation signals, result/state validation and normal promise cleanup | Effection or a home-built structured-concurrency runtime added to match native guarantees |
| Context and effort limits | Application task/turn/time limits, request context limits and normal context-management facilities when needed | Global free-KV reserve accounting, native exploration thresholds, pruning policy or forced recovery scheduling |
| Rerank and cite evidence | A normal HTTP reranker integration, source tools and structured findings | Native scoring calls or an engine modification to reproduce SDK logits |
| Show Fieldnote's interface | A transport/presentation adapter over actual framework events and receipts | Fabricated native traces or execution organized solely to emit a native-looking timeline |

Do not require identical token histories, call counts, prompt serialization, batching, tool order or pause/resume internals. Preserve substantive instructions, available evidence, application stages and output obligations. Normal context management may incur extra calls or lose information; record its behavior and judge the resulting quality. Checkpoint replay, retries and resume costs remain part of the incumbent's measured behavior, including any work they repeat.

For each custom mechanism, ask whether it is needed to deliver the requested product through ordinary framework APIs or only to resemble Lloyal internally. The latter is excluded from the primary comparison. Any later specialized tuning is a separately labeled experiment, not silently substituted for the conventional implementation.

Use one real browser session per host. Replace the old native adapter's observer connection when testing through the actual browser: a second connection to a one-session host would create or queue another session. Prefer the existing `?server=` and `?content=` configuration to point the same frontend at the selected host directly. Configure the content plane's allowed origin. Do not translate real native events through the prototype's reduced event vocabulary before the frontend receives them.

The frozen snapshot remains pristine. If presentation changes are needed, make them as a small explicit patch in a complete working copy derived from it, and compile one resulting frontend for both hosts. Permitted changes are backend identification, truthful unavailable-data rendering, and identical passive measurement hooks. Keep the UI flow, reducers' existing behavior, controls, layouts and content rendering intact. Record the patch and frontend hash. Do not silently transform HTML or rewrite events to make the old frontend appear compatible.

There are concrete presentation issues to resolve: `src/ui/App.tsx` hardcodes “the context is still warm”; some protocol fields assume native perplexity or physical cells; viewed-media state can depend on native admission events. Use a neutral follow-up placeholder and explicit backend labels. Preserve native telemetry when present; render unknown information as unavailable. If HTTP evidence receipts need an additive event, distinguish submitted bytes from confirmed processing and native admission. Do not manufacture `agent:prefilled`, native forks, entropy or zero-valued metrics. The internal `query.warm` flag means a follow-up in this protocol; it must not become an HTTP KV claim.

## Ability reuse and adaptation

Treat abilities as product contracts implemented through each host's normal runtime. Do not import the HDK ability factories unchanged into LangChain or build a compatibility runtime to execute them. The inspected corpus/documents factories depend on Effection operations, injected services/configuration, ambient attachment contexts and HDK Tool/Source classes; individual tools can also depend on CallingAgent and native attachment admission. Preserve their application work while adapting those execution dependencies.

| Ability component | Incumbent implementation |
|---|---|
| Manifests, descriptions, input schemas, skill instructions and prompt/catalog requirements | Preserve the pinned baseline definitions. Reuse runtime-independent exports where available; otherwise extract the declarative definitions with provenance. Do not import an execution-heavy package barrel just to obtain metadata. |
| PDF ingestion, extraction, page/figure rendering and content-addressed media | Reuse the pinned standalone `@lloyal-labs/media` implementation. It has no Lloyal inference or orchestration dependency. Give it original uploaded bytes and include its actual preprocessing cost. |
| Pure chunk fitting, page selection, lexical candidate retrieval, formatting and address resolution | Reuse unchanged where practical. If an export is coupled to the HDK runtime, extract the helper and record its source/hash. Verify any necessary replacement against the pinned behavior. |
| Ability factories, service lookup, Tool/Source execution and ambient contexts | Implement ordinary async LangChain tools backed by application/session configuration and explicit content/reranker services. Do not carry over Effection, native dispatch flags or Lloyal's ownership machinery. |
| Neural reranking | Use the ordinary HTTP reranker route established in Phase 2; retain candidate preparation, ranking work and result limits. Include the service in stack residency and measurements. |
| Page/figure delivery | Resolve the real selected representation, then send image bytes through standard multimodal model messages to llama-server. The server loads the projector with `--mmproj`; LangChain does not load it. Preserve provenance and distinguish image submission from confirmed processing. |
| Evidence deduplication | Derive application-visible evidence from the relevant conversation/tool results and inherited findings. Do not import CallingAgent or recreate native attended-result/KV ownership semantics. |
| Runtime participation, enabling/disabling and ability configuration | Preserve the Fieldnote controls through normal host state and tool registration. Apply changes at the baseline's documented product boundary, including per-ask source snapshots; no web-process restart is required. |

For example, `view_page` must still locate the uploaded document, resolve the requested page or figure, derive the actual representation and expose its provenance. Its LangChain path emits a standard image-bearing model message instead of HDK's attachment-admission payload. Corpus search still performs actual corpus loading, candidate selection, neural reranking and budgeted result selection before returning a normal tool result. Neither adaptation may replace that work with fixture answers or controller-supplied evidence.

The authority is the installed ability/media versions in `reference/fieldnote-app`, not whichever version is currently checked out in `lloyal-sdk`. Record package version, original file, content hash, extraction location and intentional modifications for reused code. Reconcile the existing draft helpers against this record before integration. Preserve source attribution and applicable license notices.

Validate the boundary with focused behavior checks on real fixture inputs: schemas/catalogs, source participation, chunk/page addresses, candidate preparation and limits, selected image bytes, citation resolution and configuration transitions. Scoring differences follow Phase 2's retrieval-quality criteria. These checks do not demand identical internal traces or model-call order. Review the incumbent server's execution dependencies to ensure that reusable content code has not pulled in Lloyal's inference, scheduler or ability lifecycle. The frozen native baseline and shared frontend may retain their own required packages.

## What constitutes a fair result

**Implementation omissions block comparison.** Missing probes, lexical-only ranking, prepared PDF text, weaker reports, missing citations, discarded evidence or unimplemented controls are not speedups.

**Architectural differences are outcomes.** A tested idiomatic host may require transcript retransmission, continue an HTTP request behind a held UI, incur more vision work, or lack native state inspection. Record the achievable behavior, cost and missing capability. Do not add Lloyal-style structured concurrency to erase these differences, and do not leave ordinary cancellation or cleanup broken to create an advantage.

**Performance and quality travel together.** A fast unsupported answer, malformed report, canceled result leaking into synthesis, or a failed journey cannot be counted as a faster successful completion. Preserve its latency, failure and quality judgment in the results instead of deleting the run. A genuine unavailable capability can be reported separately without pretending that the corresponding successful UX was achieved.

## Phase 1 Freeze contracts and retire the prototype path

1. Keep source, installed-package, prompt, model and build fingerprints. Make drift checks part of preparing a measured run. Separate historical invalid-run classification from eligibility of future runs; replacing the unconditional gate with an unqualified enabled flag is insufficient.
2. Extract the contract inventory from `src/protocol.ts`, `src/ui/reduce.ts`, `targets/web/web-bridge.ts`, the installed binding/media contracts, and Fieldnote's scenario tests. Inventory every command, reply and persistent state transition used by the journeys.
3. Define dispositions for every command: implemented, legitimately unavailable on that host, or outside the measured journey. No ignored command may be reported as success. In particular cover clarification, plan revisions and edits, mode/source changes, new/open document, library operations, settings, Hold, resume, cancel, Close, Stop, quit and disconnect.
4. Retire the reduced viewer as the measured surface; retain it only for historical diagnostics. Replace the stale LangGraph/Evidence integration and its obsolete tests as coherent modules. Do not add placeholder methods merely to make old tests compile.
5. Establish a capability table for actual cache evidence, image admission evidence, token counts, resource measurements, trace detail and inspector fields. Missing data stays distinct from zero.

**Exit:** a complete command/event/content matrix, an explicit frontend patch policy, reproducible snapshot verification, and a compiling foundation for the replacement. The original 130-test suite remains separate from incumbent conformance tests.

## Phase 2 Prove model services and evidence access

Resolve the reranker before building performance conclusions on retrieval. The installed GGUF has a classification head and a stock rerank template. The SDK route examined reads yes/no language-model logits, whereas stock rank pooling uses the classification head; formatting also needs comparison. The same filename alone does not establish equivalent ranking.

Run the two implementations sequentially on frozen query/candidate sets drawn from the actual fixture, plus clear relevant/irrelevant controls. Capture exact prompts, tokenization, score meanings, candidate order, top-K selection, latency and model/build identity. Check whether scores are related by a valid monotonic transformation; do not assume one. Identical raw scores or rankings are not a prerequisite when the normal server route behaves differently; adequate evidence retrieval and downstream quality are. A two-passage canary establishes only basic function. Inspect retrieval quality and top-K disagreements on the actual task.

Prefer the installed reranker model served through stock `/rerank` with an ordinary HTTP client/tool integration. If it cannot achieve the required retrieval quality or cannot run alongside the incumbent LLM within the laptop budget, discuss the concrete finding before changing the comparison. Investigate standard supported configurations, not a custom replica of native yes/no scoring. Do not substitute BM25-only retrieval, use the Lloyal scorer inside LangGraph, patch the inference engine to imitate Lloyal, or silently change Fieldnote's baseline.

Use the same standalone media preprocessing implementation/version where possible: it is shared application work, not orchestration. Both hosts receive original file bytes through ingress. Verify PDF extraction, page/line maps, rendering and figure crops from those bytes. Do not upload precomputed extracted text or an answer-selected crop to either model.

Implement corpus and document tools against the pinned behavior and the ability reuse/adaptation boundary above:

- Markdown-only corpus loading, structural sections and reranker-tokenized fitting; compare the replacement Markdown parser on headings, nested sections, fences, long lines and line addresses.
- Lexical narrowing above the candidate cap, neural reranking, top-K/token-budget selection, exact reads, related sections and scoped duplicate suppression.
- Document catalogs, lazy indices by digest, search, whole-section page reads, selective page/figure viewing and resolvable citations.
- Duplicate suppression derived from evidence available in the agent's current message history and inherited findings, rather than every attempted call. Respect source/cohort guard behavior where the baseline uses it.
- Separate query-local ranking from web exploit ranking. The local corpus/documents path does not gain an original-question veto absent from Fieldnote.

Manage the incumbent's main server and reranker as one stack. Include both processes in its startup, residency and teardown measurements. Extend the model lease to every service port and ensure cleanup waits for child exit, including failed startup. Detect an already resident external Fieldnote/llama process where possible; port checks alone cannot detect the desktop application. If exclusive residency cannot be established, do not start another stack. Never kill unrelated processes.

Use Metal on both sides. Match weights, projector, quantization, declared context/memory constraints and application sampling requirements; record actual resolved settings, slot allocation, cache settings and any automatic fitting. Do not multiply the incumbent's context allocation unnoticed, retain asymmetric output caps, or disable supported stock caching. Start with ordinary server-managed caching and documented service configuration. Remove prototype application-level slot pinning from the primary path unless it is independently justified as conventional for this integration; do not build a prefix-residency manager to resemble native ownership. Reserve warm/cold terms for measured KV states; record process residency and transcript persistence separately.

**Exit:** real GPU service startup and sequential teardown, verified ingestion/tool results, documented reranker behavior and sufficient retrieval quality. Any unresolved scoring difference remains visible as a confounder rather than being declared equivalent.

## Phase 3 Implement the compatible host and application workflow

Keep transport, application state, graph orchestration and evidence services separate. Proposed ownership:

| Module area | Responsibility |
|---|---|
| `src/host/` | WebSocket session lifecycle, commands, HTTP ingress/content routes, event delivery and disconnect handling |
| `src/application/` | Brief identity, plan revisions, settings/participation, library records, committed conversation and attachments |
| `src/graph/` | Source probes, planning, inquiry/tool loop, survey fan-out, investigation chain, recovery and synthesis |
| `src/content/` and reranker client | Source loading, media derivation, retrieval and evidence receipts |
| `src/runtime/` | Main/reranker server lifecycle, request cancellation, process observations and cache counters |
| `src/measurement/` | Journey driver, raw records, browser acknowledgements, quality decisions and paired reports |

These are implementation boundaries, not a requirement to retain every existing prototype file or create a framework of factories. Reuse ordinary libraries and verified pure transformations. Keep Lloyal execution imports out of the LangGraph runtime.

Build the workflow in this order:

1. **Bootstrap and content.** Implement ready/session frames, config/ability state and library listing. Register the adapted abilities as ordinary LangChain tools using the reuse/adaptation mapping above. Implement `POST /v1/media/ingress`, manifest/config/source/representation reads and `HEAD /v1/content/<digest>` with correct descriptors and HTTP behavior. Invalid or missing roots fail before a new brief replaces an existing one.
2. **Source discovery and plan.** Freeze participating sources for each ask, probe when at least two participate, run real search/read tools, join coverage, and memoize by question/source names/roots. Render the complete pinned planning prompts. Support clarify, passthrough and research, task caps and routing hints; preserve planner temperature/thinking requirements. Implement review revisions, edits, reorder, add/delete, clarification and replanning.
3. **Inquiry graph.** Use Send for a Survey and a sequential graph path for Investigate. Pass the same substantive catalogs, ability instructions, user context and source-tool union. A source hint chooses a preamble, not a tool lock. Use ordinary message state and HTTP requests; let stock caching operate on the resulting prefixes. Preserve previous task/finding pairs in a chain without inventing native spines.
4. **Reports and settlement.** Implement the pinned `citedReport` schema, premature-report rejection, schema validation and source weaving. Remove the 200-word finding instruction and asymmetric generic brevity limits. Stream the report result into the real Fieldnote section using a documented protocol conversion from actual model output. A single inquiry is its answer; no findings produces no invented saved report; multiple findings use the full grounded synthesis obligations. Preserve Fieldnote's permitted free-text direct/passthrough paths.
5. **Budgets and controls.** Implement the user-facing effort, task/turn/time limits, evidence floors and recovery/report obligations through ordinary framework/application facilities. Do not port native KV thresholds or recovery scheduling. Hold has the required visible behavior through the normal available boundaries; measure response latency and whether in-flight inference continues. Cancel requests cancellation and excludes late results while preserving siblings; measure when work actually stops. Close recovers usable gathered evidence and settles it using normal model calls. Stop/new run/disconnect prevent stale results from mutating later documents through conventional state checks and cleanup, without a custom ownership runtime.
6. **Durability and continuation.** Save the cited brief, annexures, exchanges and attachment roots; refresh and search the library; reopen and inspect saved content. Use conventional message history/checkpoints for the conversation the user has established. Neither inflate requests with private inquiry transcripts that the product no longer needs nor substitute an artificially abbreviated conversation. Let ordinary stock server caching decide reuse. Runtime source/ability settings apply at their documented boundary without restarting the web process.

**Exit:** real Fieldnote can operate either host through its existing controls. There is no second hand-built brief UI and no hidden controller executing application stages.

## Phase 4 Prove composed behavior through the actual frontend

Use Fieldnote's existing invariant scenarios as the specification for independent host conformance tests. Fold incumbent events through the actual reducer and assert externally meaningful state: document identity, revision refusal, streaming section ownership, surviving siblings, preserved roots, no stale writes, citation resolution and correct saved exchanges. Do not require equal internal traces, event counts, inference branches or tool order.

Scripted model replies are for tests only. Label their artifacts as tests and exclude them from measurements. Test report rejection/repair, tool failures, an interrupted tool batch, cancellation during tools and streaming, close/recovery, disconnect, malformed attachments, empty findings, library reopen and settings under a live run. Then exercise browser controls, lightboxes, original PDFs, rendered model images, source ranking inspection and saved briefs in the built Fieldnote interface.

The first measured journey is the composition below, not a collection of isolated primitive benchmarks:

| Journey | User actions and application work | What it can expose |
|---|---|---|
| Survey with mixed evidence | Attach the actual PDF and image, enable corpus/documents, ask, observe source probes and planner, review/edit four objectives, run concurrent inquiries, inspect ranked sources and a live cited section, Hold, inspect evidence, cancel an active sibling, resume, Close, inspect saved brief and media, ask a follow-up. | Shared-prefix and vision work across branches; responsiveness while research/retrieval overlap; cancellation/recovery cost; available state inspection; continuity after settlement. |
| Uninterrupted Survey control | Same inputs and reviewed objectives; allow completion, inspect and follow up. | Total useful work and quality without control interventions, preventing an early-close result from being compared with a full report. |
| Direct PDF Ask | Ask about a diagram plus a textual fact; allow discovery/read/view tools; inspect source PDF versus submitted/admitted image; follow up. | Staged document processing, selective vision, provenance and continuation with minimal planning complexity. |
| Investigation extension | Dependent tasks accumulate findings, then synthesize and continue. | Growth of the transcript and repeated prefill versus retained inference state. Implement and test this path, then measure after the initial Survey/Ask results. |

Run the real planner on both paths. For the controlled Survey, apply the same predeclared research objectives through actual plan-review edits, retaining preflight and planning cost. The objectives contain questions, never findings or answer-key passages. Preserve original plans as artifacts; do not bypass clarification or silently replace a failed plan.

Trigger interventions from equivalent observable conditions: a useful cited finding is visible and the nominated sibling remains active. Keep exact predicates in the journey specification before measurements. An absent trigger is an unexercised control, not a successful control result; record it. Use the same declared deliberate Hold duration and report both total elapsed time and intentional user dwell separately.

Web search/fetch and its reranking visualization remain outside the first local-source performance claim. The host must not pretend an unsupported web setting or source works. Add a controlled-web journey later using frozen HTTP source responses while still doing real extraction, chunking and reranking.

**Exit:** protocol and UI conformance evidence plus one complete real-model pair for the selected journey. Judge its output and inspected evidence before collecting a repetition batch.

## Phase 5 Collect evidence of advantages and costs

Keep a raw timeline of input commands, backend events, HTTP requests/responses, source bytes and derivations, model/build identities, model usage/cache counters, browser observations and process lifecycle. Run IDs join these artifacts; correlation IDs must not alter model prompts. Passive browser instrumentation observes the same interface on both paths and must not provide a second state reducer or suppress native event volume.

Measure:

- Upload/ingestion, readiness, preflight, plan availability, first useful cited section, settlement and follow-up response times. Keep startup and interaction time separately; also retain the full end-to-end time.
- Hold acknowledgment and actual continuing work; cancellation acknowledgment and confirmed request/process cleanup; Close-to-usable-cited-answer; late events and sibling outcomes.
- Input/output tokens, HTTP transcript bytes, server-reported cached and evaluated prompt tokens, prefill/decode time, image processing where exposed, and retrieval candidate/ranking counts. No inference from “same session” to warm KV.
- The resident footprint of the whole chosen stack, memory pressure and swap observations. Identify the measurement source. Do not sum shared pages as unique physical memory or add GPU allocation to unified memory as if disjoint. If only process RSS is available, label it accordingly.
- Inspector capabilities: live activity, ranking evidence, model-input provenance, original-file access, diagnostic availability and retained inspection after teardown. Record unavailable native telemetry explicitly.

The initial report is exploratory: collect three alternating backend pairs per selected variant once the validation pair passes, retaining every attempt. Counterbalance backend order and keep power mode, background workloads, browser visibility, frontend storage/pace history and declared cache/reset policy controlled. Preserve failures and thermal/memory observations. Report individual runs and median/range; three pairs do not justify strong statistical claims. Use a later independent batch to confirm any promising advantage before publishing it.

Vary one workload factor at a time only after the composed journey works: inquiry count, shared input size, attachment presence, follow-up count or available memory. Treat these as explanatory experiments. Do not select only a favorable scale or tune one backend against an undisclosed answer key.

Native and stock inference builds differ. Record that fact and use focused inference calibration to assess whether a difference plausibly comes from the engine as well as orchestration. `llama-bench` is supplementary; it cannot establish frontend fidelity, HTTP cache effectiveness or application quality. Stack-level results remain useful, but causal claims about prefix caching or structured concurrency require the corresponding measurements and controlled follow-up tests.

## Quality and eligibility

Review anonymized outputs against the fixture and recorded evidence where practical. Check substantive coverage, contradictions, uncertainty, exact quotes, detailed inquiry findings, factual visual interpretation, citation/page resolution and preservation of supported detail in synthesis. An intentionally partial closed brief is judged against its declared partial scope and control contract; it is not treated as a complete report.

Each attempt receives a workload/conformance decision, a quality decision and a control-coverage decision with reasons. Preserve unknowns separately. A report can be eligible for total-answer comparison while lacking an unexercised cancellation measurement. A missing required research stage blocks the comparable-success claim entirely. A correctly implemented but unachievable native capability is a capability result, not a fabricated pass or a discarded failure.

Store reviewed findings beside the raw record. Candidate conclusions take the form “under this workload, both met this quality bar, and this stack had this measured cost/behavior.” Do not infer universal superiority from the pilot or relabel any historical prototype run.

Trace is an audit source, not free work. Keep comparable observation levels and quantify material trace overhead before attributing it to architecture. HDK replay reconstructs execution state through prefill; it does not restore live KV. Replaying recorded findings or tool/model outputs is never a new inference performance measurement.

## Execution order and completion criteria

1. Complete the contract/capability matrix and resolve the draft integration errors.
2. Validate the reranker and sequential GPU lifecycles, then prove real corpus/PDF evidence parity.
3. Implement the compatible host and full research/report pipeline together, using the actual frontend throughout development.
4. Complete controls, settings, library and continuation; pass composed contract/UI tests.
5. Run one real pair, audit input workload and output quality, then collect the small alternating batch and report all outcomes.

Batch code changes before asking for a normal-Terminal restart. A restart is for changed server code, never a requirement invented for runtime ability settings. If an early GPU scoring probe needs the unsandboxed environment, prepare one concrete diagnostic command rather than requesting repeated application restarts. Do not launch a CPU substitute or a second resident stack to bypass an environment problem.

Completion means: the same real Fieldnote frontend works against both hosts for the declared journeys; behavior and quality checks pass or genuine capability failures are explicitly evidenced; only one model stack is resident; every measured result is reproducible from recorded inputs/configuration and raw artifacts; and the report identifies any demonstrated Lloyal advantages, ties and losses without relying on omitted work. A compiling host, a functioning UI, or a successful model response alone does not meet that criterion.
