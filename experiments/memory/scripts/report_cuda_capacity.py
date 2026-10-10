"""Offline CUDA capacity report; includes failed trials and separates fit from correctness."""
import argparse, html, json, statistics

def read_optional(path):
    return json.loads(path.read_text()) if path.exists() else None

def table(headers, rows):
    esc=lambda x:html.escape(str(x))
    return '<table><tr>'+''.join('<th>'+esc(x)+'</th>' for x in headers)+'</tr>'+''.join('<tr>'+''.join('<td>'+esc(x)+'</td>' for x in r)+'</tr>' for r in rows)+'</table>'

from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

COLORS = {'lloyal': '#FF5A36', 'langgraph': '#4361EE'}
LABELS = {'lloyal': 'Lloyal', 'langgraph': 'LangGraph + HTTP (prefix-cache enabled)'}

def allocation_series(rows, records, backend, metric):
    fit = [r for r in rows if r['records']==records and r['backend']==backend
           and r['allocationFit'] and r.get(metric) is not None]
    return [{
        'workers': n,
        'medianBytes': statistics.median(r[metric] for r in fit if r['count']==n),
        'minBytes': min(r[metric] for r in fit if r['count']==n),
        'maxBytes': max(r[metric] for r in fit if r['count']==n),
        'allExact': all(r['capacityPass'] for r in fit if r['count']==n),
        'trials': [f"{r['reportSource']}/{r['trial']}" for r in fit if r['count']==n],
    } for n in sorted({r['count'] for r in fit})]

def headline_evidence(rows):
    """A matched, all-correct comparison; component and NVML counters stay separate."""
    def point(records, workers, backend):
        selected = [r for r in rows if r['records']==records and r['count']==workers
                    and r['backend']==backend and r['allocationFit']]
        if not selected: return None
        metrics = ['peakAttentionAllocatedBytes', 'peakRecurrentAllocatedBytes',
                   'peakOwnedGpuProcessBytes', 'peakAttentionCells', 'peakSharedAttentionCells']
        return {'records': records, 'workers': workers, 'backend': backend,
                'trials': [f"{r['reportSource']}/{r['trial']}" for r in selected],
                'allExact': all(r['capacityPass'] for r in selected),
                'answers': [{'correct': r['validResults'], 'expected': r['gates']['expectedResults']} for r in selected],
                'sequences': selected[0]['sequences'],
                **{k: statistics.median(r[k] for r in selected) for k in metrics}}
    pair = {b: point(256,128,b) for b in ['lloyal','langgraph']}
    if not all(p and p['allExact'] for p in pair.values()): return None
    for p in pair.values():
        assert p['peakRecurrentAllocatedBytes']/p['sequences']==50.25*2**20
    a,b = pair['lloyal'],pair['langgraph']
    return {
        'matched128': pair,
        'attentionAllocationReductionPercent': 100*(1-a['peakAttentionAllocatedBytes']/b['peakAttentionAllocatedBytes']),
        'observedGpuMemoryReductionPercent': 100*(1-a['peakOwnedGpuProcessBytes']/b['peakOwnedGpuProcessBytes']),
        'commonRecurrentBytesPerSequence': 50.25*2**20,
        'nativeAdditionalRecurrentBytes': a['peakRecurrentAllocatedBytes']-b['peakRecurrentAllocatedBytes'],
        'prefixSensitivity64': {backend: {str(records):point(records,64,backend) for records in [256,768]} for backend in pair},
        'native254': point(256,254,'lloyal'),
        'http254AllocationFailures': [f"{r['reportSource']}/{r['trial']}" for r in rows if r['records']==256 and r['count']==254 and r['backend']=='langgraph' and r['category']=='gpu-allocation'],
        'interpretation': 'Direct measured components plus separate observed GPU totals. No recurrent-subtracted physical-memory estimate, capacity multiplier, or dollar saving is inferred.',
    }

def plot_components(rows, records, out):
    """Direct engine counters; never infer components by subtracting NVML peaks."""
    fig, ax = plt.subplots(figsize=(4.8,4.8))
    fig.subplots_adjust(left=.20, right=.97, bottom=.16, top=.82)
    series = []
    styles = [
        ('lloyal', 'peakAttentionAllocatedBytes', 'Lloyal · attention', COLORS['lloyal'], '-', 'o'),
        ('lloyal', 'peakRecurrentAllocatedBytes', 'Lloyal · recurrent', '#404752', (0, (5, 3)), 'o'),
        ('langgraph', 'peakAttentionAllocatedBytes', 'HTTP · attention', COLORS['langgraph'], '-', 's'),
        ('langgraph', 'peakRecurrentAllocatedBytes', 'HTTP · recurrent', '#9AA1AC', (0, (2, 3)), 's'),
    ]
    for backend, metric, label, color, linestyle, marker in styles:
        points = allocation_series(rows, records, backend, metric)
        xs = [x['workers'] for x in points]
        ys = [x['medianBytes']/2**30 for x in points]
        error = [[(x['medianBytes']-x['minBytes'])/2**30 for x in points],
                 [(x['maxBytes']-x['medianBytes'])/2**30 for x in points]]
        ax.errorbar(xs, ys, yerr=error, color=color, label=label, linestyle=linestyle,
                    marker=marker, markersize=4.5, linewidth=2.3, capsize=3,
                    zorder=4 if 'Attention' in metric else 2)
        bad = [x for x in points if not x['allExact']]
        ax.scatter([x['workers'] for x in bad], [x['medianBytes']/2**30 for x in bad],
                   facecolors='white', edgecolors=color, marker=marker, s=28, zorder=5)
        series.append({'backend': backend, 'metric': metric, 'points': points})
    ax.set_xlabel('Requested concurrent workers')
    ax.set_ylabel('Engine allocation (GiB)')
    ax.yaxis.set_label_coords(-.14,.5)
    ax.set_xlim(0,264); ax.set_ylim(bottom=0)
    ax.set_xticks([8,64,128,192,254]); ax.grid(axis='y', alpha=.18)
    ax.legend(frameon=False, fontsize=8, ncols=2, columnspacing=1.2,
              handlelength=2.4, loc='lower left', bbox_to_anchor=(-.03,1.025))
    name = f'components-p{records}.png'
    fig.savefig(out/name); plt.close(fig)
    return name, series

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('experiment', type=Path)
    args = ap.parse_args()
    p = args.experiment
    data = json.loads((p/'capacity-summary.json').read_text())
    calibration = json.loads((p/'calibration.json').read_text()) if (p/'calibration.json').exists() else {'conditions': {}}
    original_rows = data['rows']
    repair_dir = p.parent/'cuda-timeout-repair-2026-10-10'
    repair = read_optional(repair_dir/'capacity-summary.json') if (repair_dir/'collection-complete.json').exists() else None
    for r in original_rows: r['reportSource'] = p.name
    if repair and Path(repair['protocol'].get('parentExperiment','')).name != p.name: repair = None
    if repair:
        assert all(repair['protocol']['identity']['files'][k]['sha256']==data['protocol']['identity']['files'][k]['sha256'] for k in ['model','addon','server']), 'Repair binaries do not match parent'
        for r in repair['rows']: r['reportSource'] = repair_dir.name
        data['rows'] = original_rows + repair['rows']
    timeout_audit = read_optional(p/'timeout-investigation.json')
    censored = {r['trial'] for r in (timeout_audit or {}).get('affectedTrials', [])}
    for r in original_rows:
        if r['trial'] in censored: r['reportCategory'] = 'transport-censored (300 s headers)'
    rows = [r for r in data['rows'] if r['phase'] != 'calibration']
    final_review = read_optional(p/'final-review.json')
    composed_dir = p.parent/'cuda-composed-2026-10-10'
    quality = read_optional(composed_dir/'review/quality-comparison.json')
    composed = read_optional(composed_dir/'memory-summary.json')
    headline = headline_evidence(rows)
    if headline:
        (p/'why-lloyal.json').write_text(json.dumps(headline,indent=2)+'\n')

    out = p/'figures'; out.mkdir(exist_ok=True)
    plt.rcParams.update({'font.family':'DejaVu Sans', 'font.size':10, 'axes.spines.top':False, 'axes.spines.right':False, 'savefig.dpi':220})
    panels = {}
    components = []
    record_counts = sorted({r['records'] for r in rows})
    for records in record_counts:
        name, series = plot_components(rows, records, out)
        components.append({'records': records, 'series': series})
        prefix = calibration.get('conditions', {}).get(str(records), {}).get('nativeTokens')
        ledger = f'~{prefix/1000:.1f}k-token shared ledger' if prefix else f'{records}-record ledger'
        panels[('components', records)] = (name, f'{ledger}. Solid colored lines: allocated attention KV. Dashed gray lines: allocated recurrent state, nearly overlapping at 50.25 MiB per configured sequence. Native reserves two additional administrative sequences. HTTP means LangGraph + llama-server, prefix-cache enabled. Open markers indicate answer errors; all plotted trials completed both rounds at the requested concurrency. Allocation counters are not total physical VRAM.')
        for metric, ylabel, scale, filename in [
            ('peakOwnedGpuProcessBytes', 'Peak model / worker VRAM (GiB)', 2**30, 'vram'),
            ('peakRecurrentAllocatedBytes', 'Allocated recurrent state (GiB)', 2**30, 'recurrent'),
            ('peakAttentionCells', 'Occupied attention cells (millions)', 1e6, 'attention'),
        ]:
            fig, ax = plt.subplots(figsize=(4.8,4.8))
            fig.subplots_adjust(left=.20, right=.97, bottom=.16, top=.96)
            for backend in ['langgraph', 'lloyal']:
                fit = [r for r in rows if r['records']==records and r['backend']==backend and r['allocationFit'] and r.get(metric) is not None]
                xs = sorted({r['count'] for r in fit}); ys=[]; low=[]; high=[]
                for n in xs:
                    vals=[r[metric]/scale for r in fit if r['count']==n]
                    med=statistics.median(vals); ys.append(med); low.append(med-min(vals)); high.append(max(vals)-med)
                ax.errorbar(xs, ys, yerr=[low, high], label=LABELS[backend], color=COLORS[backend], marker='o' if backend=='lloyal' else 's', linewidth=2.4, capsize=3)
                # Open markers identify runs with incorrect answers, without erasing physical allocation evidence.
                bad=[r for r in fit if not r['capacityPass']]
                if bad: ax.scatter([r['count'] for r in bad], [r[metric]/scale for r in bad], facecolors='white', edgecolors=COLORS[backend], s=40, zorder=5)
            ax.set_xlabel('Requested concurrent workers'); ax.set_ylabel(ylabel)
            ax.yaxis.set_label_coords(-.14,.5)
            ax.set_xlim(0,264); ax.set_ylim(bottom=0); ax.set_xticks([8,64,128,192,254]); ax.grid(axis='y',alpha=.18)
            ax.legend(frameon=False,fontsize=8,loc='best')
            name=f'{filename}-p{records}.png';fig.savefig(out/name);plt.close(fig)
            panels[(filename, records)] = (name, f'{ledger}. Medians and observed ranges of completed allocation trials. Open markers indicate a failed exact-answer gate. Failed startup allocations are listed below, not plotted as low memory use.')
    (p/'memory-components.json').write_text(json.dumps({
        'measurement': 'Direct peak engine allocation counters, not NVML subtraction or occupied-cell byte estimates.',
        'aggregation': 'Median and observed range by ledger, backend and worker count. Calibration and incomplete trials excluded.',
        'components': components,
    }, indent=2)+'\n')
    numeric=[]
    for records in sorted({r['records'] for r in rows}):
        for backend in ['lloyal','langgraph']:
            rs=[r for r in rows if r['records']==records and r['backend']==backend]
            fit=[r['count'] for r in rs if r['allocationFit']]
            correct=[r['count'] for r in rs if r['capacityPass']]
            oom=[r['count'] for r in rs if r['category']=='gpu-allocation']
            numeric.append({'records':records,'backend':backend,'largestObservedAllocationFit':max(fit,default=None),'largestObservedAllCorrect':max(correct,default=None),'firstObservedGpuAllocationFailure':min(oom,default=None),'softwareCeilingCensored':254 in fit and backend=='lloyal','testCeilingCensored':254 in fit,'trials':len(rs),'boundIsPhysicalMaximum':False,'transportCensoredAttempts':sum(r['trial'] in censored and r['reportSource']==p.name for r in rs)})
    (p/'capacity-table.json').write_text(json.dumps(numeric,indent=2)+'\n')
    esc=lambda x: html.escape(str(x))
    doc='''<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Why Lloyal: shared context and agent capacity</title><style>body{font:16px/1.55 system-ui;max-width:1200px;margin:40px auto;padding:0 24px;color:#20222a;background:#fafafa}main,.execution{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}figure{margin:0}img{width:100%;background:white}figcaption,.note{font-size:13px;color:#555}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:8px;border-bottom:1px solid #ddd;text-align:right}th:first-child,td:first-child{text-align:left}code{font-size:13px}a{color:#3657ce}h1{font-size:38px;line-height:1.15;max-width:850px}h2{margin-top:42px}.cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;margin:28px 0}.card,.execution article{padding:22px;border:1px solid #ddd;border-radius:12px;background:#fff}.card strong{font-size:46px;line-height:1.1;color:#df4528;display:block}.card b{display:block;margin-top:8px}.card p{font-size:14px;margin-bottom:0}.execution h3{margin-top:0}.shared{border:2px solid #ff5a36;color:#9b301b;border-radius:6px;padding:12px;text-align:center}.private{border:1px solid #ccd0d8;border-radius:6px;padding:12px;margin-top:12px;text-align:center}.duplicated{border:2px solid #4361ee;color:#314aaa;border-radius:6px;padding:8px;margin-bottom:8px}.common{background:#f0f1f3;border-left:4px solid #69717e;padding:18px 22px;margin:24px 0}.common p{margin:8px 0}.arrow{text-align:center;color:#777;margin:6px 0}details{margin:24px 0}summary{cursor:pointer;font-weight:600}@media(max-width:700px){main,.execution,.cards{grid-template-columns:1fr}h1{font-size:30px}body{padding:0 16px}table{display:block;overflow-x:auto}}</style><h1>Shared context changes the cost of adding agents</h1><p>Lloyal lets concurrent agents share the attention state for their common context. In this workload, adding an agent reserves a private continuation instead of another full attention prefix. The result is a smaller memory footprint and a demonstrated increase in the workload width that fits on the same GPU.</p><p class="note">Qwen3.5-4B Q4_K_M · one NVIDIA L40S · public HDK agents API versus standard LangGraph + llama-server HTTP · prefix-cache enabled. Diagnostic agents perform real model-generated ledger lookups with short private continuations.</p>'''
    doc+='<p><b>'+('Final reviewed record · 10 October 2026. Exact physical capacity remains unmeasured.' if final_review else 'Collection finished; review all gates below.' if (p/'collection-complete.json').exists() else 'Partial collection. No final capacity claim.')+'</b></p>'
    if headline:
        a,b=headline['matched128']['lloyal'],headline['matched128']['langgraph']
        doc+=f'''<div class="cards"><article class="card"><strong>{headline['attentionAllocationReductionPercent']:.1f}% less</strong><b>Attention KV allocation<br>at {a['workers']} concurrent agents</b><p>~8.8k-token shared context. Lloyal: {a['peakAttentionAllocatedBytes']/2**30:.3f} GiB; LangGraph + HTTP (prefix-cache enabled): {b['peakAttentionAllocatedBytes']/2**30:.3f} GiB. Direct engine allocation counters.</p></article><article class="card"><strong>{headline['observedGpuMemoryReductionPercent']:.1f}% less</strong><b>Total GPU memory<br>at {a['workers']} concurrent agents</b><p>~8.8k-token shared context. Lloyal: {a['peakOwnedGpuProcessBytes']/2**30:.2f} GiB; LangGraph + HTTP (prefix-cache enabled): {b['peakOwnedGpuProcessBytes']/2**30:.2f} GiB. Measured process VRAM, with recurrent state included.</p></article></div>'''
        doc+='<p>These percentages describe the measured 128-agent point on the scaling curves below; the reduction varies with agent count and shared-context length. Both runs returned 256/256 exact answers across two rounds, with one completed trial per backend. These are diagnostic workers, not full Fieldnote sessions. <a href="why-lloyal.json">Headline calculations and source trials</a>.</p>'
    doc+='''<h2>Where the difference comes from</h2><div class="execution"><article><h3>Lloyal</h3><div class="shared">One shared attention prefix</div><div class="arrow">↓ shared by concurrent agents ↓</div><div class="private">Agent 1: private continuation + recurrent state</div><div class="private">Agent 2: private continuation + recurrent state</div><p class="note">Additional agents reference the shared prefix and add their own private state.</p></article><article><h3>LangGraph + llama-server</h3><div class="private"><div class="duplicated">Slot 1: attention prefix</div>Agent 1: private continuation + recurrent state</div><div class="private"><div class="duplicated">Slot 2: attention prefix</div>Agent 2: private continuation + recurrent state</div><p class="note">The tested server configuration uses separate KV streams per slot. Prefix caching reuses computation; the simultaneous slot storage remains separate.</p></article></div><p class="note">Schematic of the measured storage layouts. The comparison applies to this pinned server configuration; it does not establish an inherent limit of HTTP or LangGraph.</p>'''
    doc+='<div class="common"><b>Common model cost: 50.25 MiB of recurrent state per configured sequence</b><p>Both backends reserve the same amount per sequence. Lloyal uses two additional administrative sequences, so its recurrent allocation is 100.5 MiB higher at a matched worker count. Recurrent state contributes no positive saving here; it limits how much the attention advantage reduces total memory.</p><p>The report separates this measured component without removing it from the physical GPU totals. It makes no estimate of how these runs would perform on a different model.</p></div>'
    matched_workloads=''
    if final_review:
        wins=[]
        for records in [256,768]:
            for n in [64,128]:
                pair={b:[r for r in rows if r['records']==records and r['count']==n and r['backend']==b and r['allocationFit']] for b in ['lloyal','langgraph']}
                if not all(pair.values()): continue
                a,b=[statistics.median(r['peakOwnedGpuProcessBytes'] for r in pair[k])/2**30 for k in ['lloyal','langgraph']]
                wins.append([f'{records} records / {n} workers',f'{a:.2f}',f'{b:.2f}',f'{100*(1-a/b):.1f}%', 'All exact' if all(r['capacityPass'] for rs in pair.values() for r in rs) else 'Answer errors present'])
        matched_workloads='<h3>Matched completed workloads</h3>'+table(['Ledger / workers','Lloyal GiB','HTTP GiB','Lower Lloyal VRAM','Answer gate'],wins)
        matched_workloads+='<p>These are measured process-VRAM deltas at matched worker counts, with prefix-cache enabled. They do not establish a maximum agent-capacity multiplier. Each point contains two rounds; only the explicitly repeated counts have three trials.</p>'

    methods=''
    separate=not data['protocol'].get('httpKvUnified',True)
    methods+='<p>Both arms use q4_0 attention KV and 512-token batching. '+('Native reserves n+2 sequences, including its administrative branches; HTTP uses n fixed slots with separate KV streams, the server default for an explicit slot count.' if separate else 'Both arms reserve n+2 sequence slots; HTTP uses an explicitly unified KV buffer.')+' Native storage is budgeted for one shared prefix plus private continuations; HTTP storage allows one prefix per simultaneous request. HTTP prefix-cache is enabled and primed before two rounds. Context budgets, prefix-cache receipts, source and binary hashes are retained. The common sweep ends at 254 workers. Native then reaches the 256-sequence engine ceiling; HTTP may have additional sequence headroom. Success at the tested ceiling is a lower bound, not a measured physical maximum.</p>'
    methods+='<p>Prefix-cache reuse is verified in server receipts: the completed 64-worker short-ledger HTTP run reused 99.7% of second-round input tokens through the prefix cache (and 1.56% in its initial concurrent round). The 32-worker long-ledger run reused 99.9% through the prefix cache in round two. Reusing computation does not establish shared simultaneous slot storage. <a href="cache-receipts.json">Per-round prefix-cache receipts</a>.</p>'
    methods+='<p><b>Memory fit and correct work are separate gates.</b> A fit requires observed target concurrency, completion of both rounds, GPU allocations and context release. Useful capacity additionally requires every requested answer to match the frozen ledger exactly. A single trial or a nonmonotonic quality failure is not a capacity frontier. Timing remains exploratory.</p>'
    if timeout_audit:
        methods+='<h2>Timeout investigation</h2><p>All five original timeout cases stopped at Node fetch’s independent five-minute response-header limit. The intended deadline was 30 minutes. The client used nonstreaming completions, so it could wait through generation before receiving headers. These failures are transport-censored observations, not GPU exhaustion or a demonstrated 30-minute failure.</p><p>The repair uses the OpenAI SDK’s documented matching Undici fetch/Agent configuration, with header, body and SDK timeouts set to 30 minutes. Retries remain disabled. Model, prompts, graph, prefix-cache settings and context budgets are unchanged; request-byte equality is audited separately.</p>'
        methods+='<p>The pinned server also defaults to saving idle slots into its RAM prompt-state cache used for prefix reuse on each new task. The source loops over idle slots, and the wide-run logs show thousands of save attempts and evictions under the 1 GiB prefix-cache RAM budget. This is a configuration-specific contributor to investigate; no isolated policy-off timing control was run. The correction preserves this policy, and no latency difference is attributed solely to LangGraph or HTTP.</p>'
        if repair:
            rs=[]
            for r in repair['rows']:
                rs.append([f"{r['records']} records / {r['count']} workers",r['category'],f"{r['validResults']}/{r['gates']['expectedResults']}",', '.join(f"{x['workMs']/1000:.1f}s" for x in r['rounds'])])
            methods+=table(['Repair check','Result','Exact answers','Round durations'],rs)
        methods+='<p>Two representative failures were rerun, one for each prefix length. The other three remain censored, and the GPU frontier has not been re-bisected. <a href="timeout-investigation.json">Cause and original receipts</a> · <a href="../cuda-timeout-repair-2026-10-10/protocol.json">Repair protocol</a> · <a href="../cuda-timeout-repair-2026-10-10/request-equality.json">Request and configuration equality</a></p>'
    methods+='<h2>Token calibration</h2>'+table(['Ledger records','Native shared text tokens','HTTP common prefix','HTTP largest input','Conservative budget bound'],[[k,v['nativeTokens'],v['commonHttpPrefixTokens'],v['maxHttpTokens'],v['prefixBound']] for k,v in calibration.get('conditions',{}).items()])
    methods+='<p>The same ledger text is used on both paths. Chat-template framing differs; the conservative bound covers both. The charts report observed storage and GPU memory.</p>'
    def panel_group(kind):
        return '<main>'+''.join(f'<figure><img alt="{esc(kind)}: {records}-record ledger" src="figures/{panels[(kind,records)][0]}"><figcaption>{esc(panels[(kind,records)][1])}</figcaption></figure>' for records in record_counts)+'</main>'
    doc+='<h2>Attention sharing and recurrent-state cost</h2><p>Attention KV and recurrent state are measured separately below. Lloyal stores one shared attention prefix plus private continuations; this HTTP configuration reserves a prefix per slot. Both pay this model’s 50.25 MiB recurrent-state reservation per configured sequence. The recurrent lines therefore nearly overlap; native includes two administrative sequences.</p>'
    doc+=panel_group('components')
    slopes=[]
    for condition in components:
        for series in condition['series']:
            points={x['workers']:x for x in series['points']}
            if 64 in points and 128 in points:
                delta=(points[128]['medianBytes']-points[64]['medianBytes'])/(128-64)/2**20
                slopes.append([f"{condition['records']} records / 64 → 128 workers",LABELS[series['backend']], 'Attention KV' if 'Attention' in series['metric'] else 'Recurrent state',f'{delta:.2f} MiB'])
    if slopes:
        doc+='<h3>Measured incremental allocation</h3>'+table(['Interval','Backend','Component','Per additional worker'],slopes)
        doc+='<p>These are finite differences between the measured endpoints under the recorded context budgets, not a fitted universal scaling law. Attention allocation includes reserved continuation capacity and allocator rounding. <a href="memory-components.json">Component counters, aggregates and source trials</a>.</p>'
    if headline:
        checks=[]
        for backend,points in headline['prefixSensitivity64'].items():
            if not all(points.values()): continue
            short,long=points['256'],points['768']
            checks.append([LABELS[backend],f"{(long['peakAttentionAllocatedBytes']-short['peakAttentionAllocatedBytes'])/2**30:.3f} GiB",f"{(long['peakRecurrentAllocatedBytes']-short['peakRecurrentAllocatedBytes'])/2**20:.0f} MiB",f"{(long['peakOwnedGpuProcessBytes']-short['peakOwnedGpuProcessBytes'])/2**30:.2f} GiB"])
        if checks:
            doc+='<h3>Hold worker count fixed; increase shared context</h3><p>At 64 workers, the shared ledger grows from ~8.8k to ~26.8k tokens. Recurrent allocation stays unchanged on each backend. The additional attention allocation therefore exposes sensitivity to shared-context length without a change in the recurrent-state reservation.</p>'
            doc+=table(['Backend','Extra attention allocation','Extra recurrent allocation','Extra measured GPU memory'],checks)
            doc+='<p class="note">These are differences between recorded endpoints. Attention capacity follows the protocol’s context budgets and allocator rounding. The longer-ledger runs completed, with 124/128 exact answers for Lloyal and 125/128 for HTTP; this supports a memory observation, not quality-equivalent performance. Other runtime buffers can also grow, so the GPU-memory delta is not assigned entirely to attention.</p>'
    doc+='<h2>Total GPU memory</h2><p>Sampled process VRAM remains the practical memory-fit measure. It includes weights, attention, recurrent state, compute buffers and other runtime allocations. The component counters above are not stacked onto, or subtracted from, these independently sampled peaks.</p>'+panel_group('vram')
    doc+=matched_workloads
    if headline and headline['native254'] and headline['native254']['allExact']:
        wide=headline['native254']
        correct=wide['answers'][0]['correct'];expected=wide['answers'][0]['expected']
        doc+=f"<h2>What this buys: a wider workload on the same GPU</h2><p><b>254 concurrent diagnostic workers in {wide['peakOwnedGpuProcessBytes']/2**30:.1f} GiB.</b> Lloyal returned {correct}/{expected} exact answers in each of {len(wide['trials'])} trials on the short ledger. "
        if headline['http254AllocationFailures']:
            doc+=f"The tested HTTP configuration failed GPU allocation at the same width in {len(headline['http254AllocationFailures'])} trials on the same L40S. "
        doc+='This demonstrates a capacity advantage at the tested width. Lloyal reached the 256-sequence engine ceiling, including two administrative branches, while leaving VRAM headroom; its physical maximum remains unmeasured.</p>'
        doc+='<p><b>Cost reduction is a deployment opportunity, not a measured result.</b> The memory saving could allow a smaller GPU or more useful work per GPU. Establishing a dollar saving requires measuring cost per correctly completed workload, including throughput and latency. No maximum-capacity multiplier or billing reduction is inferred from these curves.</p>'
    doc+='<details><summary>Storage cross-check: occupied attention cells</summary><p>Unique occupied attention cells show the storage actually used by the shared prefix and private continuations, separately from reserved allocation capacity.</p>'+panel_group('attention')+'</details>'
    doc+='<details><summary>Setup, prefix-cache evidence, timeout corrections and calibration</summary>'+methods+'</details>'
    doc+='<h2>Observed bounds</h2><table><tr><th>Ledger / backend</th><th>Largest allocation fit</th><th>Largest all-correct run</th><th>First GPU allocation failure</th><th>Ceiling censored</th></tr>'
    for r in numeric:
        doc+='<tr>'+''.join(f'<td>{esc(v)}</td>' for v in [f"{r['records']} / {LABELS[r['backend']]}",r['largestObservedAllocationFit'],r['largestObservedAllCorrect'],r['firstObservedGpuAllocationFailure'],r['softwareCeilingCensored']])+'</tr>'
    doc+='</table><details><summary>Every attempt, including failed and corrected trials</summary><table><tr><th>Trial</th><th>Outcome</th><th>Active peak</th><th>Exact answers</th><th>VRAM GiB</th><th>Context cells</th></tr>'
    for r in sorted(data['rows'],key=lambda r:(r['records'],r['count'],r['backend'],r['phase'],r['reportSource'],r['trial'])):
        v=r.get('peakOwnedGpuProcessBytes'); values=[r['trial'],r.get('reportCategory',r['category'])+(' · timeout repair' if r['reportSource']!=p.name else ''),r['realizedActive'],f"{r['validResults']}/{r['gates']['expectedResults']}",(f'{v/2**30:.2f}'+(' (partial)' if not r['allocationFit'] else '')) if v else 'unavailable',r['context']]
        href=(('' if r['reportSource']==p.name else '../'+r['reportSource']+'/')+r['trial']+'/status.json')
        doc+='<tr><td><a href="'+esc(href)+'">'+esc(values[0])+'</a></td>'+''.join(f'<td>{esc(v)}</td>' for v in values[1:])+'</tr>'
    doc+='</table></details>'
    if quality and composed:
        doc+='<details><summary>Separate workload: composed Fieldnote UI and quality review</summary><p>Both four-inquiry journeys and follow-ups completed through the same Fieldnote web UI. This is one pair with fresh preflight, the original PDF and site-map PNG, corpus retrieval/reranking, document viewing and cited synthesis. The composed HTTP server uses its preserved unified 32k context / four-slot configuration; the capacity diagnostic above uses separate/default KV streams.</p>'
        doc+='<p><b>'+esc(quality['verdict'])+'</b></p><p>The review is retrospective and performed by the implementing assistant, not blind or independent. Performance at equivalent answer quality is not established. Original run manifests retain their initial unreviewed labels; the linked review files and derived summary record this later assessment.</p>'
        facts=quality['backends']['fieldnote']['groundTruth']
        doc+=table(['Coverage','Lloyal','LangGraph + HTTP'],[[k.replace('_',' ').capitalize(),quality['backends']['fieldnote']['firstAnswer'][k],quality['backends']['langgraph']['firstAnswer'][k]] for k in facts])
        stats=[]
        for name,b in composed['backends'].items():
            ev=b['stageEvents'];start=next(e['unixMs'] for e in ev if e['type']=='preflight:start');end=next(e['unixMs'] for e in ev if e['type']=='complete')
            phase=lambda name:next(e['timeMs']/1000 for e in ev if e['type']==name)
            stats.append([LABELS['lloyal' if name=='fieldnote' else 'langgraph'],f'{(end-start)/1000:.1f}',f"{phase('preflight:done'):.1f}",f"{phase('research:done'):.1f}",f"{phase('synthesize:done'):.1f}",f"{b['externalResources']['peakOwnedGpuProcessBytes']/2**30:.2f}",quality['backends'][name]['wordCountWhitespaceSplit']])
        doc+='<h3>Observed composed metrics</h3>'+table(['Backend','First answer s','Preflight s','Inquiry s','Synthesis s','Peak GPU GiB','Answer words'],stats)
        doc+='<p>First-answer time is the browser-observed preflight-start to completion interval, including planning and plan review. GPU samples cover the owned application/model/reranker processes after startup and exclude browser/helper descendants. This pair shows only a small GPU-memory difference and a faster HTTP journey; neither is presented as a quality-equivalent result. Timing is exploratory and observer overhead has not been repeatedly bounded at these widths.</p>'
        doc+='<p>Recorded synthesis system instructions are byte-identical (SHA256 <code>e0720d13f5455ecb1fcd380871ef22bcfd1a34aaf6c70c5d6f14bc52380618b9</code>). Generated findings/user messages differ. The same uploaded PDF/PNG bytes exist in both stores; the native document agent chose a figure crop while HTTP chose the full page.</p>'
        doc+='<details><summary>Citation and grounding review</summary><p>Lloyal uses file:line labels instead of the requested inline Markdown citations, several references point to headings, and its PDF link loses the attachment:// scheme. Its combined-option claim incorrectly says capital and operating burden double; additional winter-risk claims exceed the evidence. LangGraph uses more complete inline citations and a valid page-2 link, but retains an extra malformed Sources link and inquiry-level source-label mismatches. Both omit the grant qualification in synthesis. All three follow-up facts are correct in both outputs.</p></details>'
        doc+='<p><a href="../cuda-composed-2026-10-10/fieldnote/answer.md">Lloyal answer</a> · <a href="../cuda-composed-2026-10-10/langgraph/answer.md">LangGraph answer</a> · <a href="../cuda-composed-2026-10-10/review/quality-comparison.json">Full claim review</a> · <a href="../cuda-composed-2026-10-10/review/prompt-and-input-controls.json">Prompt/input receipts</a> · <a href="../cuda-composed-2026-10-10/memory-summary.json">Composed metrics</a></p></details>'
    doc+='<p>VRAM is sampled NVML process usage; attention and recurrent allocations are separate engine counters and must not be added to NVML usage. Recurrent state scales with the configured sequence ceiling even when attention cells are shared: this model reserves 50.25 MiB per configured sequence, or 12.56 GiB at 256 sequences. Sharing attention reduces one component of memory use; recurrent state, private continuations and compute buffers still grow. The measured process-VRAM delta includes all these components. Completed resident branches and client promises are excluded from the active-worker count. Native active-pool traces and HTTP processing-slot snapshots are different observability surfaces; neither alone establishes simultaneous GPU decoding.</p><p><a href="protocol.json">Protocol and identities</a> · <a href="calibration.json">Token calibration</a> · <a href="capacity-summary.json">All metrics and gates</a> · <a href="capacity-table.json">Bounds JSON</a></p>'
    if final_review:
        doc+='<p><a href="final-review.json">Final review and permitted claims</a> · <a href="../cuda-timeout-repair-2026-10-10/capacity-summary.json">Repair metrics</a></p>'
    (p/'report-data.json').write_text(json.dumps({'rows':data['rows'],'bounds':numeric,'finalReview':final_review},indent=2)+'\n')
    (p/'index.html').write_text(doc)
    print(p/'index.html')

if __name__=='__main__': main()
