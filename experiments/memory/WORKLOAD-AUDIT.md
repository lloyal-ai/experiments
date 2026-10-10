# Workload audit — comparison invalid until corrected

Reviewed 8 October 2026. This is the implementation contract for correcting the prototype, not a statement that parity has been achieved.

The current LangGraph implementation performs less work than Fieldnote. Its recorded timings cannot support a comparison of the architectures. Existing logs remain useful for transport, GPU startup, cache-counter and browser diagnostics. Preserve them; do not relabel them as matched benchmark runs after fixing the code.

## Boundary

Fieldnote is the baseline application/harness and remains unchanged. Its application behavior defines the workload. Build the corresponding application in idiomatic LangGraph JS with ordinary promises, graph nodes, message state, HTTP requests and cancellation. Do not implement Lloyal's scheduler, KV ownership or structured concurrency inside LangGraph. Differences in the cost or achievable behavior of those mechanisms are what the benchmark should expose.

The benchmark driver only supplies inputs and user actions, observes output, records evidence and manages mutually exclusive backend lifetimes. It does not supply missing research findings or hand either model answers, passages or figure crops chosen using the answer key.

The replacement uses Fieldnote's actual frontend, with a compatible LangGraph host speaking its WebSocket command/event contract and HTTP content contract. Start from the complete application source snapshot in `reference/fieldnote-app`, not a selection of UI components. Both hosts must use the same frontend build. Benchmark controls and measurements belong outside that interface. Preserve the native host and workflow as the baseline; the incumbent implements the application workload with LangGraph, not Lloyal's execution machinery.

The original custom viewer remains an archive of invalid prototype diagnostics. Its browser timings are **not** timings for Fieldnote. The full snapshot, installed dependencies and build outputs have separate SHA-256 manifests; `npm run fieldnote:verify` detects source or dependency changes. The source snapshot excludes secrets, private reports/uploads, generated output and model weights; model files remain explicit, fingerprinted run inputs. A successful frontend build and baseline invariant tests establish a reproducible starting point, not LangGraph parity.

Do not invent KV, entropy, surprisal, perplexity, fork-sharing or prefill events merely to fill the existing inspector. Unsupported measurements must remain unavailable. Fieldnote's existing `query.warm` is an application protocol flag for a follow-up, not proof of retained KV in an incumbent. Its literal "the context is still warm" placeholder must be resolved explicitly before presenting an incumbent session as a measured user journey; changing labels must be a reviewed, shared presentation change, never a claim of KV ownership.

## Source of truth

- Fieldnote [`research.ts`](/Users/zuhairnaqvi/dev/apps/casework/fieldnote/src/harness/research.ts): preflight, planning, inquiry construction, parallel/chain strategy, recovery and synthesis.
- Fieldnote [`brief.ts`](/Users/zuhairnaqvi/dev/apps/casework/fieldnote/src/harness/brief.ts): source participation, plan review and edits, controls, conversation commits and continuation.
- Fieldnote [`budgets.ts`](/Users/zuhairnaqvi/dev/apps/casework/fieldnote/src/harness/budgets.ts), [`prompts/`](/Users/zuhairnaqvi/dev/apps/casework/fieldnote/src/harness/prompts/README.md), [`library.ts`](/Users/zuhairnaqvi/dev/apps/casework/fieldnote/src/harness/library.ts).
- HDK [`coverage.ts`](/Users/zuhairnaqvi/dev/apps/lloyal-sdk/packages/rig/src/coverage.ts), [`participating.ts`](/Users/zuhairnaqvi/dev/apps/lloyal-sdk/packages/rig/src/participating.ts), [`spine-render.ts`](/Users/zuhairnaqvi/dev/apps/lloyal-sdk/packages/rig/src/spine-render.ts), [`tools/plan.ts`](/Users/zuhairnaqvi/dev/apps/lloyal-sdk/packages/rig/src/tools/plan.ts).
- HDK [`corpus ability`](/Users/zuhairnaqvi/dev/apps/lloyal-sdk/packages/abilities/corpus/src/index.ts), [`documents ability`](/Users/zuhairnaqvi/dev/apps/lloyal-sdk/packages/abilities/documents/src/index.ts), and their source, tool and skill files.
- HDK [`PDF ingress`](/Users/zuhairnaqvi/dev/apps/lloyal-sdk/packages/media/src/pdf.ts), [`document loading`](/Users/zuhairnaqvi/dev/apps/lloyal-sdk/packages/rig/src/resources/documents.ts), [`Markdown loading`](/Users/zuhairnaqvi/dev/apps/lloyal-sdk/packages/rig/src/resources/files.ts), [`passage fitting`](/Users/zuhairnaqvi/dev/apps/lloyal-sdk/packages/rig/src/resources/fit.ts).
- HDK [`citedReport`](/Users/zuhairnaqvi/dev/apps/lloyal-sdk/packages/rig/src/tools/output.ts) and [`citation weaving`](/Users/zuhairnaqvi/dev/apps/lloyal-sdk/packages/rig/src/tools/weave-sources.ts).

Source-tree behavior must also be checked against the installed packages and built Fieldnote entry actually used in a run. Record both application/prompt hashes and runtime package/build fingerprints.

## Application flow and current gaps

| Required work / behavior | Fieldnote behavior | Current incumbent | Required correction / acceptance evidence |
|---|---|---|---|
| Source participation | Enabled sources minus runtime exclusions and sources with empty contents; selected sources determine tools, catalog and probes. | One merged evidence inventory; no equivalent source boundary. | Separate Markdown corpus and attached documents. Snapshot participating sources for an ask; runtime choices reach subsequent asks. Test disabled/empty source exclusion. |
| Preflight | With at least two participating sources, run a probe per source. Gather actual tool evidence, produce coverage reports, join them for planning. | Omitted. | Actual model/tool probe nodes in parallel, with the same shallow investigation purpose, evidence floor and recovery. No prewritten coverage. Observe probes and their evidence before the plan. |
| Coverage reuse | Memoized per question, sorted participating-source names and attachment digests within the session. | Omitted. | Ordinary application cache with equivalent identity/invalidation; record cache hit/miss separately from KV reuse. |
| Planning | Coverage, source catalogs, conversation context, mode and task cap feed a structured clarify / passthrough / research decision. Tasks carry source routing hints. | Short inventory-only prompt returning tasks; no disposition or routing. | Preserve the full decision contract, parallel versus dependent task instructions and routing based on observed coverage. Equivalent prompt requirements and grammar/schema. |
| Plan review | Review round/revision; edits, add/delete/reorder, mode change, clarification and acceptance. | Description editing and acceptance only; automatic script overwrites objectives. | Test the selected journey's real user edits and stale-revision handling. Explicitly scope and separately test any deferred interaction; do not claim all Fieldnote UX. |
| Shared research inputs | Catalog, source tools, available files and reference material on a common spine; per-inquiry preamble includes role, sibling tasks and source discipline. | Much shorter generic prompt; simplified tools; no equivalent source discipline. | Same application information and research instructions in shared HTTP message prefixes plus inquiry-specific suffixes. Allow stock server prefix caching; do not emulate native forks. |
| Survey | Independent inquiries, each with access to the tool union; routing picks its preamble, not a tool lock. Native pool admits what fits. | StateGraph Send fan-out exists. | Keep idiomatic fan-out. Match task content and available evidence; report concurrency actually attained. Do not force native scheduling or manufacture identical call order. |
| Investigation | Sequential inquiries attend previous task/finding turns; synthesis uses committed findings when available. | Passes concatenated prior findings. | Preserve task/finding association and accumulated conversation meaning in graph message state. Supply all required findings over HTTP. Native KV reuse versus retransmission is measured, not erased. |
| Evidence floor | First report below the configured evidence floor is rejected once; nominal floor is two tool calls. | Prompt asks for tools but code accepts free prose immediately. | Enforce equivalent application reporting rule in ordinary node logic; test premature and corrected reports. |
| Inquiry output | Terminal `citedReport`, structured result and sources, detailed evidence. UI streams the report's findings. | Any free prose can finish an inquiry; explicit under-200-word instruction. | Implement structured cited reports and detailed findings; remove the asymmetric brevity instruction. Stream the report result, not arbitrary planning/reasoning text. |
| Budgets and recovery | Effort controls task count, turns, time, context headroom, exploration and recovery. Probe turn cap is firm. Close recovers eligible existing evidence. | Flat turn/output caps and a short generic recovery prompt. | Match application-level effort, deadlines, evidence retention and report expectations. Use HTTP token/context information where available; distinguish unavailable physical-KV controls from omitted policy. Record all limits and truncation. |
| Synthesis | One inquiry is its own answer; no findings means no invented answer; multiple findings produce an analytical grounded report with inline citations and limitations. | Generic concise synthesis; one-task and empty-output policies differ by path. | Preserve the branching behavior and substantive report requirements. Match prompt obligations and evidence detail, not exact wording or output length. |
| Continue a brief | Persisted conversation and attachment roots; real session state determines whether KV can be reused or must be rebuilt. | Retains messages, but research follow-up context is a simplified synthesis transcript; input handling differs. | Preserve the complete application conversation/evidence availability required by the journey. Label HTTP transcript resend explicitly; separately measure server-reported cached/evaluated tokens. |
| Hold / cancel / close / stop | Native run/pool ownership and cleanup; visible output and saved findings have defined outcomes. | Promise-based controls exist but have not passed a matched full-workload GPU journey. | Use normal framework/application mechanisms. Verify sibling survival, canceled-output exclusion, held UI, retained evidence, close-to-usable-report, resource release. Measure inference continuing behind a held UI when it does. |
| Saved brief / inspection | Library preserves findings, annexures, conversation roots and actual attachment representations. | Saves answer files and receipts; common UI has a subset of inspection. | Verify saved report, source/page links, exact model-image bytes and continued access after backend teardown. List unimplemented library/inspector UX explicitly. |

## Corpus and documents are distinct workloads

### Markdown corpus

Corpus loads `.md` and `.mdx`, including recursive directories or matching globs, respecting the corpus root's `.gitignore`. PDFs are not corpus inputs. Markdown is split into structural sections and fitted into windows using the reranker's tokenizer (default target 256 tokens; long-line behavior is explicit).

Tools are `grep`, `search`, and `read_file`:

- `grep` is exhaustive regex matching with file/line addresses, counts and bounded excerpts.
- `search` uses BM25 to narrow candidates only above its default 100-candidate cap, then a neural cross-encoder. It selects up to five ranked passages within a 2048-token budget, retaining line addresses and total-scored information.
- `read_file` returns exact requested lines and related sections. Duplicate suppression is based on evidence already in the calling agent's attended history, including its lineage, not merely calls attempted.
- The ability instruction requires reading matching material to verify context, following up on gaps, then reporting comprehensive evidence. A search snippet alone is not the complete research process.

The incumbent currently reads hand-authored fixture strings through `search_evidence` / `read_source`, performs lexical BM25 without the neural stage, and lacks range reading, related sections and attended-history behavior. This is an omission of workload, not evidence that LangGraph performs the equivalent work faster.

### PDF documents

The full PDF is uploaded to Fieldnote's **content plane**. This does not mean the model automatically receives every PDF page as an image or the entire extracted text in its prompt.

1. PDFium processes the actual bytes. Ingress retains the source, derives Markdown plus document metadata (sections, line/page mappings, page graphics facts, tables and figures), renders pages and derives figure crops under explicit bounds. Default rendering is 150 DPI, maximum side 2048, with pixel/cap limits. Default caps are 400 text pages, 200 rendered pages and 16 figure crops. Coverage is deterministic under the declared caps; timeout is a failure bound.
2. The documents ability advertises title, page count and topics from metadata. It indexes section text, fits/tokenizes it once per digest and caches indices within the session. Ordinary image roots are not documents.
3. `search_documents` performs scoped lexical-candidate selection and neural reranking, returning document identity, line ranges, page ranges and an `attachment://<id>/page/<page>` citation.
4. `read_document` reads exact lines or the whole sections touching a page. It returns only ranges not already represented in attended evidence; a section spanning pages stays whole.
5. `view_page` selects a page or a particular automatically derived figure. Eligibility and render availability are checked. A repeated view is still returned, with a note; a prior attempted view is not proof that the model received it.
6. Only selected image representations reach vision inference through tool-result admission. The UI distinguishes original PDF, extracted coverage and actual model-visible images.

The incumbent's fixed `pdf-page-1` text and `flow-diagram.png` shortcut must be removed from its runtime evidence path. They can remain fixture-generation inputs/answer-key assets, never research results handed to the incumbent. Both applications must ingest the same PDF bytes and support discovery → exact reading → requested page/figure viewing, with provenance and separate ingestion/retrieval/projection measurements. Do not substitute OCR for a visual question or give a hand-selected figure without the corresponding discovery/tool work.

### Ranking behavior must be read from the implementation

Both the current corpus and documents search tools explicitly use explore-mode admission: local-query relevance is not vetoed by original-question relevance. The incumbent's `BM25(tool query) + 0.25 * BM25(original question)` rule does not match them.

Web is different. `fetch_page` fetches HTML, extracts article content, structurally chunks it and reranks verbatim passages; exploit mode can score relevance against the original question as well. Search/fetch deduplication uses attended evidence, and the fetch cache is keyed by URL **and** query. PDF URLs are refused with an instruction to attach the PDF. Web is disabled in the current fixed local scenario, so web/content-exploit UX is not covered by that scenario. A future web scenario needs controlled source responses plus the real extraction/ranking workload, not invented output.

The same reranker model and a supported HTTP serving route should be investigated before choosing an alternative. The pinned stock server has a reranking endpoint and Qwen3 rank-pooling code, but compatibility with the installed GGUF, prompt formatting, scores, GPU residency and memory budget remains **unverified**. No silent BM25-only fallback. Native and incumbent model services must never be resident together; any additional incumbent reranker service belongs to its measured resource footprint and lifecycle.

## Output contract and quality gate

`citedReport` requires an object with `result: string` and `sources: {title: string, url: string}[]`. Missing `sources` is invalid. An empty list is allowed only when no URL sources exist; local Markdown evidence may use file/line references. Document reports must retain the page citation URLs the tools returned.

The result must preserve detailed findings, specific data, direct quotes where useful, what was checked and what was not found. The original tool explicitly says not to summarize away detail. The incumbent's 200-word section limit and generic concise-answer prompts must not set a cheaper target than the baseline.

Capture validates the schema, repairs a dangling tool-call fragment in prose, weaves exact bare source URLs into inline links without damaging existing links or longer URLs, deduplicates sources and appends the source list. Synthesis receives those cited findings and has its own grounding and inline-citation obligations. A source list alone is insufficient.

Schema compliance and citation weaving do **not** prove factual grounding. Before any performance comparison, independently review both outputs against the recorded evidence:

- Required substantive coverage, including contradictions and uncertainty; no advantage for omitting a hard part.
- Each material factual claim supported by the cited source; citations resolve to the actual file, page or URL.
- Quotes match the exact text read, rather than a truncated search snippet or an invented passage.
- Visual claims use the correct page/figure and agree with the actual submitted/admitted image.
- No fabricated quantities or unsupported extrapolation; missing evidence is stated.
- Inquiry findings retain comparable useful detail, and synthesis preserves that evidence without inventing absent findings.
- Canceled findings do not leak into the final answer; early close accurately reports partial coverage.
- Truncated, malformed, unsupported or materially incomplete output fails quality. It is not a fast success.

Use backend-blind review where practicable and preserve judgments/reasons beside the raw reports. Do not force identical wording or token counts. Performance at equivalent useful quality is the target. Existing regex checks are only smoke checks and do not satisfy this gate.

## Before more comparative runs

1. Correct source separation and real PDF processing/tools; verify equivalent evidence access from actual file bytes.
2. Implement source probes, coverage reuse, full planner contract and application prompts.
3. Implement detailed structured cited reports, evidence verification behavior, synthesis and recovery contracts.
4. Resolve and record model/sampling/thinking/output-budget settings, neural retrieval serving, prompt requirements and hardware/memory conditions. Engine-build differences remain a confounder until controlled or characterized.
5. Test the composed behavior with scripted model replies as tests only, then validate live runs for fidelity and output quality. Model tests are not benchmark measurements.
6. Collect matched browser journeys and uninterrupted controls, one backend at a time. Preserve losses, ties, failures and unavailable capabilities. Compare total user-visible time and stage costs; do not subtract required Fieldnote work only from one side.

Native branch sharing, deterministic lifetimes, physical KV visibility, inference quiescence, projection reuse and low-level trace detail are candidate architectural differences. Their value must be measured under the matched workload; none is a reason to omit application behavior from the incumbent or to reimplement Lloyal inside it.

HDK trace replay reconstructs state through prefill, with attachment roots where applicable. It is not a saved live-KV snapshot. Use trace to audit prompts, tools, admissions, findings and lifecycle. The prototype's `replay` command only reads a report and must not be presented as execution replay.
