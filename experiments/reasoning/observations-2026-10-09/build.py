"""Build standalone GitHub figures and copy from data.json. Requires matplotlib."""
from pathlib import Path
import json
import os
import hashlib

ROOT=Path(__file__).resolve().parent
os.environ.setdefault('MPLCONFIGDIR',str(ROOT/'.matplotlib'))
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
import numpy as np

D=json.loads((ROOT/'data.json').read_text())
P=D['pairs']
ASSETS=ROOT/'assets'; ASSETS.mkdir(exist_ok=True)
LL='#FF5A36'; LG='#4361EE'
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':12,'svg.fonttype':'path',
    'axes.edgecolor':'#222222','axes.labelcolor':'#111111','xtick.color':'#222222','ytick.color':'#222222',
    'axes.spines.top':False,'axes.spines.right':False,'axes.spines.left':True,
    'axes.linewidth':1.1,'figure.facecolor':'white','axes.facecolor':'white',
    'savefig.facecolor':'white','savefig.dpi':300})

def span(key):
    a=[p['reductionsPct'][key] for p in P]
    return f'{min(a):.1f}–{max(a):.1f}%'

def finish(fig,name,description):
    fig.savefig(ASSETS/(name+'.svg'),metadata={'Title':description,'Description':'Exploratory single-workload observations; shared-prefix HTTP control pending. See README.md and METHODS.md.'})
    fig.savefig(ASSETS/(name+'.png'),metadata={'Description':description})
    plt.close(fig)

def square_plot(key,ylabel,name,limit,ticks,decimals=0,reductions=False):
    fig,ax=plt.subplots(figsize=(5.4,5.4))
    fig.subplots_adjust(left=.17,right=.975,bottom=.145,top=.83 if reductions else .97)
    ax.set_axisbelow(True)
    ax.grid(axis='y',linestyle='--',linewidth=.7,alpha=.45,color='#b5b5b5')
    for j,(color,label) in enumerate([(LL,'Lloyal (KV)'),(LG,'LangGraph + HTTP + prefix caching')]):
        xs=np.arange(3)+(j-.5)*(.5 if reductions else .35)
        vals=[p['runs'][j][key] for p in P]
        ax.bar(xs,vals,width=.27 if reductions else .32,color=color,edgecolor='#222222',linewidth=.55,label=label,zorder=3)
        for x,v in zip(xs,vals):
            ax.text(x,v+limit*.018,f'{v:,.{decimals}f}',ha='center',va='bottom',fontsize=10,color='#111111')
    if reductions:
        for i,p in enumerate(P):
            n,h=[r[key] for r in p['runs']]
            x=i-.25
            ax.annotate(f'−{100*(1-n/h):.1f}%',xy=(x,n+limit*.053),
                xytext=(x,n+limit*.17),color=LL,fontsize=13.5,fontweight='bold',
                ha='center',va='bottom',arrowprops={'arrowstyle':'-|>','color':LL,'linewidth':1.2})
    ax.set_xlim(-.6,2.6)
    ax.set_ylim(0,limit)
    ax.set_xticks(range(3),['A','B','C'])
    ax.set_yticks(ticks,[f'{int(t):,}' for t in ticks])
    ax.set_xlabel('Comparison',fontsize=13,labelpad=9)
    ax.set_ylabel(ylabel,fontsize=13,labelpad=9)
    ax.tick_params(axis='both',labelsize=11,direction='out',length=4)
    if reductions:
        fig.legend(*ax.get_legend_handles_labels(),loc='upper left',bbox_to_anchor=(.155,.995),
            frameon=False,fontsize=9.2,handlelength=1.25,handletextpad=.6)
    else:
        ax.legend(loc='upper left',frameon=False,fontsize=9.2,handlelength=1.25,handletextpad=.6,borderaxespad=.5)
    finish(fig,name,ylabel+' in three selected comparisons')

square_plot('reasoningTokens','Synthesis reasoning tokens (↓ better)','thinking-fast-and-slow',8800,np.arange(0,9000,2000),reductions=True)
square_plot('answerTokens','Visible answer tokens','answer-length',2500,np.arange(0,2501,500))
square_plot('firstFindingSeconds','Time to first finding (s)','first-finding',290,np.arange(0,251,50),1)
square_plot('synthesisSeconds','Synthesis time (s; ↓ better)','synthesis-time',445,np.arange(0,401,100),1,reductions=True)

def finding_milestones():
    observations=json.loads((ROOT/'alternatives/observations.json').read_text())
    assert observations['baseDataSha256']==hashlib.sha256((ROOT/'data.json').read_bytes()).hexdigest()
    pair=next(p for p in observations['pairs'] if p['label']=='C')
    fig,ax=plt.subplots(figsize=(5.4,5.4))
    fig.subplots_adjust(left=.17,right=.975,bottom=.145,top=.83)
    ax.set_axisbelow(True)
    ax.grid(axis='y',linestyle='--',linewidth=.7,alpha=.45,color='#b5b5b5')
    times=[]
    for j,(color,label) in enumerate([(LL,'Lloyal (KV)'),(LG,'LangGraph + HTTP + prefix caching')]):
        values=[f['seconds'] for f in pair['runs'][j]['findings']]
        assert len(values)==4
        times.append(values)
        ax.plot([1,2,3,4],values,color=color,linewidth=2.4,linestyle='-' if j==0 else '--',
            marker='o' if j==0 else 's',markersize=6.5,markeredgecolor='white',markeredgewidth=.7,label=label,zorder=3)
        for x,v in enumerate(values,1):
            ax.annotate(f'{v:.1f}',(x,v),xytext=(-8 if j==1 and x==1 else 0,-18 if j==0 else 12),textcoords='offset points',
                ha='center',va='center',fontsize=10,color='#111111')
    midpoint=(times[0][1]+times[1][1])/2
    ax.annotate('',xy=(2,times[0][1]+9),xytext=(2,times[1][1]-9),
        arrowprops={'arrowstyle':'<->','color':LL,'linewidth':1.35})
    ax.text(2.12,midpoint,f'{times[1][1]-times[0][1]:.0f} s\nearlier',ha='left',va='center',
        fontsize=13,fontweight='bold',color=LL,bbox={'facecolor':'white','edgecolor':'none','pad':2})
    ax.set(xlim=(.65,4.35),ylim=(0,350),xlabel='Returned findings · comparison C',
        ylabel='Time to return findings (s; ↓ better)')
    ax.set_xticks([1,2,3,4]);ax.set_yticks([0,60,120,180,240,300])
    ax.xaxis.label.set_size(12);ax.yaxis.label.set_size(12)
    ax.tick_params(axis='both',labelsize=11,direction='out',length=4)
    fig.legend(*ax.get_legend_handles_labels(),loc='upper left',bbox_to_anchor=(.155,.995),
        frameon=False,fontsize=9.2,handlelength=1.25,handletextpad=.6)
    finish(fig,'time-to-findings-C','Time to each distinct agent finding in revised comparison C; lower is better')

finding_milestones()

def execution_diagram(native):
    color=LL if native else LG
    tint='#fff2ed' if native else '#eef0ff'
    fig,ax=plt.subplots(figsize=(5.4,5.4))
    fig.subplots_adjust(left=.015,right=.985,bottom=.015,top=.985)
    ax.set_xlim(0,1);ax.set_ylim(0,1);ax.set_axis_off()
    def frame(x,y,w,h,label):
        ax.add_patch(FancyBboxPatch((x,y),w,h,boxstyle='round,pad=0.01,rounding_size=0.012',
            facecolor='white',edgecolor=color,linewidth=1.6,zorder=0))
        ax.text(x+.025,y+h-.042,label,fontsize=12,weight='bold',color='#181818',va='center')
    def box(x,y,w,h,label,filled=False,fontsize=10):
        ax.add_patch(FancyBboxPatch((x,y),w,h,boxstyle='round,pad=0.008,rounding_size=0.01',
            facecolor=color if filled else tint,edgecolor=color,linewidth=1.2,zorder=2))
        ax.text(x+w/2,y+h/2,label,ha='center',va='center',fontsize=fontsize,
            color='white' if filled else '#181818',weight='bold' if filled else 'normal',zorder=3)
    def arrow(start,end,label=None,lpos=None):
        ax.add_patch(FancyArrowPatch(start,end,arrowstyle='-|>',mutation_scale=11,
            color='#444444',linewidth=1.2,shrinkA=2,shrinkB=3,zorder=1))
        if label:ax.text(*(lpos or ((start[0]+end[0])/2,(start[1]+end[1])/2)),label,
            fontsize=8.5,color='#444444',ha='center',va='center',bbox={'facecolor':'white','edgecolor':'none','pad':1},zorder=4)
    if native:
        frame(.05,.05,.90,.89,'Lloyal application + runtime')
        box(.15,.78,.70,.08,'Workflow and tools',filled=True,fontsize=11)
        box(.24,.57,.52,.10,'Shared attention prefix (KV)')
        arrow((.5,.78),(.5,.68),'direct state access',(.5,.725))
        box(.12,.34,.34,.11,'Agent 1\nprivate KV suffix')
        box(.54,.34,.34,.11,'Agent 2\nprivate KV suffix')
        arrow((.37,.57),(.29,.46),'fork',(.285,.515))
        arrow((.63,.57),(.71,.46),'fork',(.715,.515))
        box(.15,.105,.70,.105,'Embedded model execution',filled=True,fontsize=11)
        arrow((.29,.34),(.29,.22))
        arrow((.71,.34),(.71,.22))
        ax.text(.5,.265,'Runtime batches active branches',ha='center',va='center',fontsize=8.5,
            color='#444444',bbox={'facecolor':'white','edgecolor':'none','pad':1})
    else:
        frame(.05,.665,.90,.275,'LangGraph application')
        box(.15,.78,.70,.08,'Workflow and tools',filled=True,fontsize=11)
        box(.15,.685,.70,.06,'Messages and graph checkpoints')
        arrow((.5,.78),(.5,.751))
        frame(.05,.05,.90,.48,'llama-server')
        arrow((.38,.665),(.38,.535),'HTTP messages',(.31,.60))
        arrow((.76,.535),(.76,.665),'stream',(.81,.60))
        box(.15,.335,.70,.09,'Prefix cache (KV)')
        box(.15,.205,.70,.075,'Active request KV slots')
        box(.15,.085,.70,.075,'Model execution',filled=True,fontsize=11)
        arrow((.5,.335),(.5,.29),'reuse matching prefixes',(.5,.307))
        arrow((.5,.205),(.5,.169))
    finish(fig,'execution-lloyal' if native else 'execution-langgraph',
        'Lloyal embedded execution with shared KV branches' if native else 'LangGraph messages over HTTP to llama-server with prefix caching')

execution_diagram(True)
execution_diagram(False)

readme=f'''## Less deliberation in agent workflows

The comparison starts at **4B parameters**, with the model, vision projector and reranker running on **16 GB of unified memory**.

Fieldnote, one of the included templates, provides the workload: document and image understanding, neural reranking, parallel tool use and synthesis. Both implementations use the **same model files and infrastructure**. Lloyal exposes live attention branches to the application; the idiomatic LangGraph implementation sends messages to llama-server over HTTP, with **prefix caching enabled**.

<p align="center">
  <img src="assets/execution-lloyal.png" width="49%" alt="Lloyal application and embedded runtime with shared KV prefix and private agent suffixes" />
  <img src="assets/execution-langgraph.png" width="49%" alt="LangGraph messages and checkpoints connected over HTTP to llama-server with a KV prefix cache" />
</p>

Lloyal’s runtime lets agents fork shared attention and continue on independent branches. LangGraph retains messages and graph checkpoints in the application, while llama-server manages active inference state and reuses cached prefixes when they match. In the measured Survey workflow, native synthesis inherits the shared spine and receives inquiry findings as text.

Across three selected comparisons, Lloyal emitted **{span('reasoningTokens')} fewer synthesis reasoning tokens**. In the revised pair, it used **698 reasoning tokens versus 2,994**, while the completed outputs were similar in length at approximately **964 and 942 words**, respectively.

<p align="center">
  <img src="assets/thinking-fast-and-slow.png" width="49%" alt="Emitted synthesis reasoning tokens" />
  <img src="assets/time-to-findings-C.png" width="49%" alt="Time to each returned finding in comparison C; lower is better" />
</p>

Parallel inquiries also deliver findings progressively. In revised comparison C, the second finding arrived at **162.4 seconds versus 282.6 seconds**, about **two minutes earlier**. All four had arrived at **251.2 seconds versus 288.1 seconds**. The curve records each distinct agent’s first nonempty return, including recoveries, from the start of research; it measures host receipt, with quality assessed separately.

The HTTP backend reused **44–59% of prompt positions across the workload**, with zero cache hits during synthesis. A, B and C identify the original, repeat and revised comparisons.

*These exploratory results cover one workload on an M2 Pro (16 GB), using Qwen3.5-4B, its projector and the same reranker weights. Counts use the same GGUF tokenizer, and synthesis system instructions were byte-identical within pairs. Conditions evolved across comparisons, while differences in full inputs and effective sampling remain confounds. “Deliberation” refers to emitted reasoning text; its relationship to resident KV and equivalent answer quality remain open questions. [Methods and receipts](METHODS.md).*

The **LG + HTTP + prefix caching + shared prefix** control is the next arm. Its result bar will be added after actual synthesis reuse has been verified and all three arms rerun under one protocol.

<details>
<summary>Stage timings and measurement boundaries</summary>

The first research finding arrived **{span('firstFindingSeconds')} sooner** with Lloyal in the selected pairs, measured from the start of research. In the revised pair, it arrived at **142.5 seconds versus 173.6 seconds**, giving the user a returned finding about **31 seconds earlier**.

After the findings were collected, synthesis took **{span('synthesisSeconds')} less time**. That stage lasted **132.0 seconds versus 193.9 seconds** in the revised pair, reducing the final wait for the brief by about **a minute**.

<p align="center">
  <img src="assets/first-finding.png" width="49%" alt="Time from research start to the first returned finding" />
  <img src="assets/synthesis-time.png" width="49%" alt="Synthesis duration" />
</p>

*The left plot measures host receipt of the first nonempty inquiry return or recovery result, with the clock starting after preflight and plan review. Browser rendering and finding quality require separate measurements. Plans and evidence differed between runs, and overall research duration was mixed: Lloyal was slower in A and faster in B/C. [Exact event boundaries](METHODS.md#metric-definitions).*

*The right plot covers the synthesis stage and shows the latency associated with the reasoning observation. Interpreting the full workflow also requires the other stages: in C, total query-to-saved time was 523.3 versus 580.4 seconds, with native preflight taking longer. Causal attribution and equivalent output quality still require controlled evaluation. [Per-stage data](METHODS.md#all-recorded-values).*

The featured milestone curve shows the latest comparison C. A returned its first native finding sooner but its remaining findings later than HTTP; B returned all four native findings sooner. [All-pair return times](alternatives/README.md#findings-over-time).

</details>

### Related work

[Xing et al., **Beyond Speedup — Utilizing KV Cache for Sampling and Reasoning** (2026), §6.2](https://arxiv.org/html/2601.20326v1#S6.SS2), use pooled KV features and a learned difficulty estimator to switch reasoning modes. This comparison observes the reasoning generated by two execution architectures without adding a switching controller. Whether resident state reduces re-derivation remains a hypothesis to test.

[Methods, conditions and provenance](METHODS.md) · [Machine-readable measurements](data.json)
'''
(ROOT/'README.md').write_text(readme)

rows=[]
for p in P:
    for r in p['runs']:
        rows.append(f"| {p['label']} | {'Lloyal' if r['backend']=='fieldnote' else 'LG + HTTP + prefix caching'} | {r['reasoningTokens']:,} | {r['answerTokens']:,} | {r['visibleWordsApprox']} | {r['firstFindingSeconds']:.3f} | {r['synthesisSeconds']:.3f} | {r['researchSeconds']:.3f} | {r['queryToSavedSeconds']:.3f} |")
provenance=[]
for p in P:
    for r in p['runs']:
        q=r['receipts']
        provenance.append(f"| {p['label']} / {r['backend']} | `{r['session']}` | {r['attempt']} | {q['researchStartSeq']} → {q['firstFindingSeq']} | {q['synthesisStartSeq']} → {q['synthesisDoneSeq']} |")
methods='''# Methods and evidence for the README figures

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
'''+ '\n'.join(rows)+'''

## Cache evidence and next control

All recorded main-model HTTP requests specified `cache_prompt=true`; the server launched with `--cache-ram 1024` and logged an enabled prompt cache. Raw timing receipts recorded 58.3%, 44.2% and 58.9% cache reuse across A/B/C. Every synthesis request had `cache_n=0`. Input position totals include cached tokens; they are not all re-evaluation. Native prefill cells and HTTP usage tokens are not interchangeable compute counters, and no 14× compute claim is made.

The next series has three arms: Lloyal resident KV; LG + HTTP + prefix caching with the existing layout; and LG + HTTP + prefix caching with a deliberately shared prefix. The last arm must use ordinary messages and stock server features, preserve evidence/tool access, verify the actual rendered token prefix and report nontrivial reuse at synthesis. Full-workload timing must include any deliberate priming. Resolve effective sampling, randomize arm order, retain failures and rerun all arms under one protocol. Do not append a new run as a third bar within historical A/B/C. Separate fixed-findings diagnostics from composed-workload results.

## Raw evidence locations

Paths below are relative to the original `lloyal-bench` directory; raw journals are not included in this compact public-facing package. Each session contains `observations.jsonl`; HTTP sessions also contain exact request JSON and streamed response receipts. The event-sequence boundaries and SHA-256 fingerprints are in [data.json](data.json). Public distribution of this package is not publication of the raw journals; archive those separately before claiming a fully reproducible public benchmark release.

| Pair / backend | Session directory | Attempt | Research start → first finding seq | Synthesis start → done seq |
|---|---|---:|---|---|
'''+ '\n'.join(provenance)+'''

Source comparisons: `comparisons/composed-survey/comparison.json`, `comparisons/deliberation-repeat-2026-10-09/comparison.json`, and `comparisons/coverage-routing-2026-10-09/comparison.json`. Exact synthesis system SHA-256 values are in `data.json`. The exporter records the cumulative audit and journal-normalization code hashes, rechecks first-finding and synthesis event boundaries, and retains journal hashes.

## Related work

Zeyu Xing, Xing Li, Hui-Ling Zhen, Mingxuan Yuan and Sinno Jialin Pan (2026). **Beyond Speedup — Utilizing KV Cache for Sampling and Reasoning.** arXiv:2601.20326v1, especially [Section 6.2](https://arxiv.org/html/2601.20326v1#S6.SS2). Their learned KV-based difficulty estimator explicitly controls reasoning mode. These workflow observations do not use that controller and do not establish an alternative causal mechanism. The citation is prior-art context, not proof of the current interpretation or a novelty claim.

## Rebuilding and using the assets

The figures and README use the included `data.json` and `alternatives/observations.json`; no model server is required. With Python, matplotlib and NumPy installed, run `python build.py` in this directory. Five square plots and two execution diagrams (each 1620 × 1620 pixels, 300 dpi) are generated in `assets/`, with optional SVG versions. The featured pair contains reasoning bars and the time-to-findings curve, both with lower-is-better axes and measured gap annotations. Stage timing bars are available in a collapsed section, while answer length is stated in text. Titles, explanations and qualifications remain in README text. Copy this complete folder into a repository for working relative links, or adjust links when pasting the sections into the root README.

To re-extract from the original local evidence: `python collect.py --evidence /path/to/cumulative-evidence.json --benchmark /path/to/lloyal-bench`, then `python alternatives/build.py --evidence /path/to/cumulative-evidence.json --benchmark /path/to/lloyal-bench`, then `python build.py`. The original cumulative audit lives beside the earlier report source; it is an input dataset, not a PDF dependency. Raw logs and model weights are not bundled.
'''
(ROOT/'METHODS.md').write_text(methods)

ideas='''# Additional hooks and their evidence status

## Priority: memory and useful agent capacity

The central architecture story is many agents sharing one KV budget. A matched agent-count and unique-state sweep should lead the next benchmark; reasoning length is a secondary observed effect. Existing RSS and native cell accounting do not establish a memory saving. The recorded HTTP backend already uses unified KV and prefix caching. See [the memory evidence audit](MEMORY-EVIDENCE.md) for verified code paths, missing measurements and the proposed comparison.

## Ready as exploratory figures

1. **Less deliberation in agent workflows:** 76.7–89.3% fewer emitted synthesis reasoning tokens; full-length visible output in C. Introduce the configuration with “starts at 4B” without explaining the hardware choice, identify Fieldnote as the template used for measurement, and keep causal qualifications under the chart.
2. **Less waiting for the first finding:** 17.9–61.3% shorter interval after research starts, verified against raw host events. This is a distinct research responsiveness observation, not another plot of synthesis token counts. Do not call it time to a quality-scored answer.
3. **From findings to finished brief:** 31.9–70.5% shorter synthesis duration. A useful user-facing consequence, but related to the first observation rather than independent proof of an architectural mechanism.

## Strong next feature demonstration: “Pause means pause”

The separate native control observation records a 38.946-second acknowledged Hold with zero native produce, reasoning-delta or text-delta events. Cancellation in that run records no late output. Show this as a trace-backed feature demonstration or capture a real UI screencast; do not convert it into an energy saving or comparative speedup. The HTTP observation had a different plan, intervention point and 15.487-second Hold, and its old presentation duplicated reasoning events. A new matched control journey is needed before a comparison chart. Its local provenance is preserved in data.json.

## Hooks needing further evidence

- Warm-KV follow-up versus transcript resend: existing follow-ups used different retrieval/image paths, so they do not isolate a continuation benefit.
- Memory/energy: process RSS excludes or double-counts important mapped/Metal allocations; there is no validated physical-memory or energy delta.
- “14× less re-reading”: retired because native prefill cells and HTTP token accounting measure different things, and HTTP totals include cached positions.
- “Faster everywhere”: not supported; native research was slower in A and preflight was slower in C.

Current selection: reasoning bars with per-pair reduction labels, alongside the time-to-findings curve for revised pair C. Both use raw measurements and lower-is-better axes. Answer length stays in the caption; stage timing bars remain in the supporting section. Add a real Hold demonstration after matching and recording that journey. Peer presentation references are recorded in PEER-NOTES.md.
'''
(ROOT/'HOOKS.md').write_text(ideas)

html='''<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lloyal · README benchmark preview</title>
<style>
body{margin:0;background:white;color:#171717;font:16px/1.65 system-ui,sans-serif}
main{max-width:1000px;margin:auto;padding:40px 24px}h1{font-size:32px}h2{margin-top:42px}
.plots{display:flex;gap:12px;margin:24px 0}.plots img{width:calc(50% - 6px);height:auto;object-fit:contain}
small{display:block;color:#555;line-height:1.65}a{color:#4361ee}summary{cursor:pointer;font-weight:600}details{margin:24px 0}
</style>
<main>
<h1>Less deliberation in agent workflows</h1>
<p>The comparison starts at <b>4B parameters</b>, with the model, vision projector and reranker running on <b>16 GB of unified memory</b>.</p>
<p>Fieldnote, one of the included templates, provides the workload: document and image understanding, neural reranking, parallel tool use and synthesis. Both implementations use the <b>same model files and infrastructure</b>. Lloyal exposes live attention branches to the application; the idiomatic LangGraph implementation sends messages to llama-server over HTTP, with <b>prefix caching enabled</b>.</p>
<div class="plots"><img src="assets/execution-lloyal.png" alt="Lloyal application and embedded runtime"><img src="assets/execution-langgraph.png" alt="LangGraph over HTTP to llama-server with prefix caching"></div>
<p>Lloyal’s runtime lets agents fork shared attention and continue on independent branches. LangGraph retains messages and graph checkpoints in the application, while llama-server manages active inference state and reuses cached prefixes when they match. In the measured Survey workflow, native synthesis inherits the shared spine and receives inquiry findings as text.</p>
<p>Across three selected comparisons, Lloyal emitted <b>76.7–89.3% fewer synthesis reasoning tokens</b>. In the revised pair, it used <b>698 reasoning tokens versus 2,994</b>, while the completed outputs were similar in length at approximately <b>964 and 942 words</b>, respectively.</p>
<div class="plots"><img src="assets/thinking-fast-and-slow.png" alt="Synthesis reasoning tokens with percentage reductions"><img src="assets/time-to-findings-C.png" alt="Time to each returned finding in comparison C"></div>
<p>Parallel inquiries also deliver findings progressively. In revised comparison C, the second finding arrived at <b>162.4 seconds versus 282.6 seconds</b>, about <b>two minutes earlier</b>. All four had arrived at <b>251.2 seconds versus 288.1 seconds</b>. The curve records each distinct agent’s first nonempty return, including recoveries, from the start of research; it measures host receipt, with quality assessed separately.</p>
<p>The HTTP backend reused <b>44–59% of prompt positions across the workload</b>, with zero cache hits during synthesis. A, B and C identify the original, repeat and revised comparisons.</p>
<small>These exploratory results cover one workload on an M2 Pro (16 GB), using Qwen3.5-4B, its projector and the same reranker weights. Counts use the same GGUF tokenizer, and synthesis system instructions were byte-identical within pairs. Conditions evolved across comparisons, while differences in full inputs and effective sampling remain confounds. “Deliberation” refers to emitted reasoning text; its relationship to resident KV and equivalent answer quality remain open questions. <a href="METHODS.md">Methods and receipts.</a></small>
<p>The <b>LG + HTTP + prefix caching + shared prefix</b> control is the next arm. Its result bar will be added after actual synthesis reuse has been verified and all three arms rerun under one protocol.</p>
<details><summary>Stage timings and measurement boundaries</summary>
<p>The first research finding arrived <b>17.9–61.3% sooner</b> with Lloyal in the selected pairs, measured from the start of research. In the revised pair, it arrived at <b>142.5 seconds versus 173.6 seconds</b>, giving the user a returned finding about <b>31 seconds earlier</b>.</p>
<p>After the findings were collected, synthesis took <b>31.9–70.5% less time</b>. That stage lasted <b>132.0 seconds versus 193.9 seconds</b> in the revised pair, reducing the final wait for the brief by about <b>a minute</b>.</p>
<div class="plots"><img src="assets/first-finding.png" alt="First-finding latency"><img src="assets/synthesis-time.png" alt="Synthesis duration"></div>
<small>The left plot measures host receipt of a returned finding after research starts; browser rendering and finding quality require separate measurements. Preflight and review fall outside this interval, and overall research duration was mixed. The right plot covers synthesis, showing the latency associated with the reasoning observation. In C, total query-to-saved time was 523.3 versus 580.4 seconds, with native preflight taking longer. Causal attribution and equivalent output quality still require controlled evaluation.</small>
<p>The featured milestone curve shows the latest comparison C. A returned its first native finding sooner but its remaining findings later than HTTP; B returned all four native findings sooner. <a href="alternatives/README.md#findings-over-time">All-pair return times.</a></p>
</details>
<h2>Related work</h2>
<p><a href="https://arxiv.org/html/2601.20326v1#S6.SS2">Xing et al., Beyond Speedup (2026), §6.2</a> use pooled KV features and a learned difficulty estimator to switch reasoning modes. This comparison observes the reasoning generated by two execution architectures without adding a switching controller. Whether resident state reduces re-derivation remains a hypothesis to test.</p>
<p><a href="README.md">README copy</a> · <a href="METHODS.md">Methods and provenance</a> · <a href="data.json">Measurements</a> · <a href="alternatives/preview.html">Featured figures</a></p>
</main>'''
(ROOT/'preview.html').write_text(html)

featured='''<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lloyal · Featured benchmark figures</title>
<style>
body{margin:0;background:white;color:#171717;font:16px/1.65 system-ui,sans-serif}
main{max-width:1100px;margin:auto;padding:28px 24px}h1{font-size:30px;margin:0 0 8px}
.plots{display:flex;gap:24px;margin:22px 0}.plots figure{width:50%;margin:0}
.plots h2{font-size:19px;line-height:1.4;margin:0 0 6px;min-height:54px}
img{display:block;width:100%;height:auto}figcaption,small{color:#555;font-size:14px}
a{color:#4361ee}summary{cursor:pointer;font-weight:600}details{margin:24px 0}
.note{border-left:3px solid #ff5a36;padding-left:16px;color:#555;font-size:14px}
</style>
<main>
<h1>Less deliberation, earlier findings</h1>
<p>The comparison starts at <b>4B parameters</b> on the same model files and infrastructure. Both panels use raw measurements, with <b>lower values indicating less reasoning or less waiting</b>. The HTTP backend has prefix caching enabled.</p>
<div class="plots">
<figure><h2>76.7–89.3% fewer synthesis reasoning tokens</h2><img src="../assets/thinking-fast-and-slow.png" alt="Reasoning bars with Lloyal reductions labeled"><figcaption>Three selected comparisons. Revised pair C produced approximately <b>964 words with Lloyal and 942 with LangGraph</b>, using 698 versus 2,994 reasoning tokens. Counts use the same GGUF tokenizer; answer quality remains separately unverified.</figcaption></figure>
<figure><h2>The second finding arrives two minutes earlier</h2><img src="../assets/time-to-findings-C.png" alt="Time to return each finding in comparison C; Lloyal reaches all four milestones earlier"><figcaption>Revised pair C. The second finding arrived at <b>162.4 versus 282.6 seconds</b>; all four arrived at 251.2 versus 288.1 seconds. Each agent counts once, including recoveries. The clock begins at research start, after preflight and plan review.</figcaption></figure>
</div>
<p class="note">Exploratory selected runs across evolving conditions. Synthesis system instructions were byte-identical within each pair; full inputs differed and effective sampler parity is unverified. HTTP reused 44–59% of prompt positions across the workload, with zero synthesis cache hits. The shared-prefix synthesis control remains unmeasured. A’s findings arrived sooner initially but completed later; the full event table retains that mixed result.</p>
<details><summary>Supporting synthesis timing bars</summary>
<p>Synthesis took 31.9–70.5% less time across the selected pairs. This stage timing is related to the reasoning observation; total workflow time includes other stages.</p>
<img style="max-width:550px;margin:auto" src="../assets/synthesis-time.png" alt="Raw synthesis durations with per-pair reduction labels">
</details>
<p><a href="../preview.html">Full README preview</a> · <a href="../README.md">README copy</a> · <a href="../METHODS.md">Methods</a> · <a href="README.md#findings-over-time">All-pair return times</a> · <a href="../PEER-NOTES.md">Peer presentation references</a></p>
</main>'''
(ROOT/'alternatives/preview.html').write_text(featured)
print('Built five square plots, two execution diagrams and the revised featured-figure previews.')
