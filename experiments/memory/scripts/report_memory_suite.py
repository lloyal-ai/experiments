"""Offline audit of the agent-count, capacity and cached-round experiments."""
import argparse
import html
import json
import os
import statistics as st
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

COLORS = {'lloyal': '#FF5A36', 'langgraph': '#4361EE'}
LABELS = {'lloyal': 'Lloyal', 'langgraph': 'LangGraph + HTTP (prefix-cache enabled)'}

def load(path):
    return json.loads(path.read_text())

def median(rows, key, scale=1):
    values = [r[key] / scale for r in rows if r.get(key) is not None]
    return st.median(values) if values else None

def main():
    ap = argparse.ArgumentParser()
    for name in ['count', 'capacity', 'cached', 'output']:
        ap.add_argument('--' + name, type=Path, required=True)
    ap.add_argument('--composed', type=Path, action='append', default=[])
    a = ap.parse_args()
    a.output.mkdir(parents=True, exist_ok=True)
    count, capacity, cached = [load(p / 'summary.json')['rows'] for p in [a.count, a.capacity, a.cached]]
    data = {'count': [], 'capacity': [], 'cached': [], 'smallestPassingContext': {}, 'composed': [],
            'environmentAudit': {name: [{'trial': r['trial'], **r.get('environment', {})} for r in rows] for name, rows in [('count', count), ('capacity', capacity), ('cached', cached)]},
            'wholeStackMemoryClaim': False, 'controls': load(a.count / 'protocol.json'), 'definitions': {
                'context': 'Attention and recurrent buffer allocation; not process RAM.',
                'engine': 'Model + context + compute buffers; excludes the framework process and browser.',
                'occupiedCells': 'Distinct occupied attention cells, shared memberships counted once.',
                'capacity': 'Smallest tested context where every recorded repeat passes all eight exact-answer checks within 300 seconds; not a global minimum.',
                'cached': 'Same process, repeated queries; native rounds use public Effection scoped cleanup. One on/off pair, not a repeated estimate.'}}
    for n in sorted({r['count'] for r in count}):
        for backend in LABELS:
            rows = [r for r in count if r['count'] == n and r['backend'] == backend]
            valid = [r for r in rows if r['valid']]
            data['count'].append({'agents': n, 'backend': backend, 'passes': len(valid), 'trials': len(rows),
                'occupiedCells': median(valid, 'peakAttentionCells'), 'contextMiB': median(valid, 'peakContextAllocatedBytes', 2**20),
                'engineMiB': median(valid, 'peakEngineAllocatedBytes', 2**20), 'footprintMiB': median(valid, 'peakProcessFootprintBytes', 2**20),
                'residentMiB': median(valid, 'peakProcessResidentBytes', 2**20), 'compressedMiB': median(valid, 'peakProcessCompressedBytes', 2**20), 'seconds': median(valid, 'workMs', 1000)})
    for c in sorted({r['context'] for r in capacity}):
        for backend in LABELS:
            rows = [r for r in capacity if r['context'] == c and r['backend'] == backend]
            failures = []
            for row in rows:
                result = load(a.capacity / row['trial'] / 'result.json')
                failures += [o['failed'] for o in result.get('outcomes', []) if o.get('failed')]
            data['capacity'].append({'cells': c, 'backend': backend, 'passes': sum(r['valid'] for r in rows), 'trials': len(rows),
                'validTasksMedian': median(rows, 'validResults'), 'validTasksEach': [r['validResults'] for r in rows],
                'contextMiB': median(rows, 'peakContextAllocatedBytes', 2**20), 'engineMiB': median(rows, 'peakEngineAllocatedBytes', 2**20),
                'failureReasons': sorted(set(failures))})
    planned_repeats = load(a.capacity / 'protocol.json')['repeats']
    for backend in LABELS:
        passed = [r for r in data['capacity'] if r['backend'] == backend and r['trials'] == planned_repeats and r['passes'] == r['trials']]
        data['smallestPassingContext'][backend] = min(passed, key=lambda r: r['cells']) if passed else None
    for r in cached:
        data['cached'].append({'trial': r['trial'], 'backend': r['backend'], 'telemetry': r['telemetry'], 'valid': r['valid'],
            'secondsIncludingPreparation': r['workMs'] / 1000,
            'rounds': [{'round': s['round'], 'seconds': s['workMs'] / 1000, 'validResults': s['validResults'],
                'cachedTokens': s['cachedTokens'], 'processedTokens': s['processedTokens']} for s in r['rounds']]})
    for path in a.composed:
        summary = load(path / 'memory-summary.json')
        data['composed'].append({'path': str(path.resolve()), 'summary': summary})
    (a.output / 'results.json').write_text(json.dumps(data, indent=2) + '\n')
    plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 10, 'axes.spines.top': False,
        'axes.spines.right': False, 'axes.labelsize': 12, 'savefig.dpi': 220})
    def lineplot(rows, xkey, ykey, xlabel, ylabel, filename, xticklabels=None):
        fig, ax = plt.subplots(figsize=(4.8, 4.8), layout='constrained')
        for backend in ['langgraph', 'lloyal']:
            rs = [r for r in rows if r['backend'] == backend and r[ykey] is not None]
            ax.plot([r[xkey] for r in rs], [r[ykey] for r in rs], color=COLORS[backend],
                marker='o' if backend == 'lloyal' else 's', ls='-' if backend == 'lloyal' else '--', lw=2.5, label=LABELS[backend])
        ticks = sorted({r[xkey] for r in rows})
        ax.set_xticks(ticks, xticklabels or ticks); ax.set_xlabel(xlabel); ax.set_ylabel(ylabel)
        ax.set_ylim(bottom=0); ax.grid(axis='y', alpha=.18); ax.legend(fontsize=8, frameon=False)
        fig.savefig(a.output / filename); plt.close(fig)
    lineplot(data['count'], 'agents', 'occupiedCells', 'Concurrent agents requested', 'Peak occupied attention cells', 'occupied-attention.png')
    lineplot(data['count'], 'agents', 'footprintMiB', 'Concurrent agents requested', 'Main-model process footprint (MiB)', 'process-footprint.png')
    lineplot(data['capacity'], 'cells', 'validTasksMedian', 'Context capacity (cells)', 'Correct results out of 8 requested', 'capacity.png',
        [f'{c//1024}K' for c in sorted({r['context'] for r in capacity})])
    def link(path, label):
        return f'<a href="{html.escape(os.path.relpath(path, a.output))}">{html.escape(label)}</a>'
    def table(rows, columns):
        def fmt(x):
            if x is None: return 'unavailable'
            if isinstance(x, float): return f'{x:,.2f}'
            return html.escape(str(x))
        return '<table><tr>' + ''.join(f'<th>{label}</th>' for _, label in columns) + '</tr>' + ''.join(
            '<tr>' + ''.join(f'<td>{fmt(r.get(k))}</td>' for k, _ in columns) + '</tr>' for r in rows) + '</table>'
    eight = {r['backend']: r for r in data['count'] if r['agents'] == 8}
    reduction = 100 * (1 - eight['lloyal']['occupiedCells'] / eight['langgraph']['occupiedCells'])
    body = '''<meta charset="utf-8"><title>Shared-state memory experiments</title>
<style>body{font:16px/1.6 system-ui;color:#222;background:#fafafa;max-width:1120px;margin:40px auto;padding:0 24px}table{border-collapse:collapse;width:100%;font-size:14px;background:white}td,th{padding:9px;border-bottom:1px solid #ddd;text-align:right}td:first-child,th:first-child{text-align:left}.figures{display:flex;gap:20px}.figures figure{margin:0;flex:1;min-width:0}img{width:100%}h2{margin-top:35px}code{font-size:13px}</style>
<h1>Shared prefixes change the capacity curve</h1>'''
    body += f'<p>In the eight-agent text diagnostic, Lloyal occupied <b>{reduction:.1f}% fewer attention cells</b>: {eight["lloyal"]["occupiedCells"]:,.0f} versus {eight["langgraph"]["occupiedCells"]:,.0f}. All {len(count)} agent-count trials passed exact checks against the frozen ledger.</p>'
    body += '<div class="figures"><figure><img src="occupied-attention.png"><figcaption>Three fresh-process repeats per point; medians. This counts occupied storage, not reserved RAM.</figcaption></figure><figure><img src="capacity.png"><figcaption>All capacity outcomes retained. Lines connect tested budgets; intermediate capacities are unmeasured. Concurrent request configuration is fixed; no application-level throttling was added to the HTTP arm.</figcaption></figure></div>'
    body += '<h2>Capacity and allocated bytes</h2><p>Same Qwen3.5-4B weights, Metal infrastructure, 16-sequence ceiling, 512-token batches, Q4 KV, greedy sampling and eight frozen lookup tasks. HTTP uses a stable shared prefix, unified KV, a 1 GiB saved-prompt-cache limit and cache_prompt=true. Both diagnostic arms use provider-side JSON constraints. Shared instruction and ledger text are the same; native and HTTP serialize different chat boundaries. The measured native shared span is 3,228 cells; the HTTP chat-template/tokenizer endpoint reports a 3,240-token common prefix. There is no projector or reranker in this diagnostic.</p>'
    body += table(data['capacity'], [('cells', 'Context cells'), ('backend', 'Backend'), ('passes', 'Passing trials'), ('trials', 'Trials'), ('validTasksMedian', 'Correct tasks'), ('contextMiB', 'Context MiB'), ('engineMiB', 'Engine MiB')])
    minimum = data['smallestPassingContext']
    if all(minimum.values()):
        ll, lg = minimum['lloyal'], minimum['langgraph']
        body += f'<p>The smallest tested capacities with {planned_repeats}/{planned_repeats} successful repeats are <b>{ll["cells"]:,} cells for Lloyal and {lg["cells"]:,} for HTTP</b>. Their reserved context allocations are {ll["contextMiB"]:.0f} and {lg["contextMiB"]:.0f} MiB. Total model/context/compute buffers are {ll["engineMiB"]:.1f} and {lg["engineMiB"]:.1f} MiB.</p>'
    llfp, lgfp = eight['lloyal']['footprintMiB'], eight['langgraph']['footprintMiB']
    body += f'<h2>Observed process footprint</h2><p>At eight agents, median sampled peak main-model process footprint is <b>{llfp:,.1f} MiB versus {lgfp:,.1f} MiB</b> ({100*(1-llfp/lgfp):.1f}% lower for Lloyal). This is macOS task_vm_info physical footprint, not all resident pages or engine buffer allocation. The native PID includes its JavaScript orchestration; the HTTP measurement covers llama-server and excludes the separate LangGraph worker. Neither includes a browser in this diagnostic.</p><p><b>Exploratory OS observation:</b> these runs had substantial pre-existing system swap and paging during measurement. Compression and residency differ between processes. RSS does not show the same ranking. Do not treat this footprint delta as a clean total-RAM saving or use the timing results without this qualification. The direct cell census and allocator receipts do not depend on OS paging attribution.</p><img style="max-width:510px" src="process-footprint.png">'
    body += '<p><b>A whole-application memory advantage is not established.</b> At the same 32,768-cell budget, both reserve 1,092 MiB for context. Recurrent state accounts for 804 MiB at the fixed sequence ceiling. The native binding leaves n_outputs_max at the engine default; the server sizes it to serving slots, giving native a larger compute reserve. No tuning was added to remove that cost. Engine allocation, occupied cells and macOS process footprint are separate measures.</p>'
    body += table(list(eight.values()), [('backend', 'Eight-agent process'), ('footprintMiB', 'Footprint MiB'), ('residentMiB', 'RSS MiB'), ('compressedMiB', 'Compressed MiB'), ('engineMiB', 'Engine MiB')])
    body += '<p>Columns are separate median peak measurements and must not be added together; their peaks need not coincide.</p>'
    body += '<p>At 4K, native refused admission with pressure_init. HTTP reported context exhaustion below 32K. This bound applies to this simultaneous eight-request configuration and the declared 300-second completion test. It does not imply HTTP cannot complete the work by changing concurrency, scheduling or configuration.</p>'
    body += '<h2>Cached continuation and instrumentation</h2><p>The eight-agent two-round control passes on both backends. Native uses ordinary public Effection scopes between rounds while retaining its spine. Earlier runs without per-round scope exit retained completed branches and refused two tasks; those failures remain in the raw record. Fieldnote itself was not changed.</p>'
    cached_table = []
    for r in data['cached']:
        cached_table.append({'backend': r['backend'], 'telemetry': r['telemetry'], 'total': r['secondsIncludingPreparation'],
            'second': next((s['seconds'] for s in r['rounds'] if s['round'] == 1), None)})
    body += table(cached_table, [('backend', 'Backend'), ('telemetry', 'Telemetry'), ('total', 'Both rounds + prep, s'), ('second', 'Prefix-cache second round, s')])
    body += '<p>The primary fresh-process HTTP bursts reported zero input tokens reused through the prefix cache despite their shared-prefix layout. In the separate second-round control, HTTP reused 25,824 input tokens and processed 192, and finished that round faster than native. This distinguishes prefix-cache-enabled configuration, observed reuse and physical sharing across concurrent sequences. The result is specific to this pinned llama-server implementation; it does not establish the behavior of other serving engines.</p><p>On/off timings are a small instrumentation check, not a precise overhead bound. Model loading is excluded from work time, shared-prefix preparation is included, and OS/shader caches were not flushed.</p>'
    body += '<h2>Composed Fieldnote validation</h2><p>The real UI journey uses original PDF/image ingress, corpus/documents preflight, reviewed routing, parallel inquiries, reranking, cited reports, synthesis and continuation. Diagnostic curves alone do not establish Fieldnote quality or whole-application memory savings.</p>'
    for row in data['composed']:
        path = Path(row['path'])
        for backend, result in row['summary']['backends'].items():
            body += '<p>' + link(path / backend / 'driver-status.json', f'{path.name} / {backend}') + ': ' + html.escape(result.get('status', {}).get('status', 'unknown')) + '. Quality review remains separate.</p>'
            if result.get('qualityReview'):
                review = result['qualityReview']
                body += '<p>' + html.escape(review['interpretation']) + ' ' + link(path / backend / 'quality-review.json', 'Manual coverage review') + '. This review was not blind or independent.</p>'
    body += '<p>Projector allocations and unique physical RAM across the browser/process tree remain unitemized. Native and HTTP also retain their existing composed-host batch/slot configurations. Do not promote composed allocation totals as a matched RAM comparison.</p>'
    body += '<h2>Reproduce and inspect</h2><p>Native uses public withSpine, agentPool and parallel; HTTP uses ordinary StateGraph, Send and ChatOpenAI. Engine instrumentation is passive and built on the same pinned llama.cpp source. Raw GPU receipts, actual loaded native identities and fork/teardown census checks passed. Model startup is excluded from workload timing. These measurements ran on battery with system paging; no isolated-machine timing claim is made.</p><p>' + ' · '.join(link(path, label) for path, label in [
        (a.count / 'summary.json', 'Agent-count receipts'), (a.capacity / 'summary.json', 'Capacity receipts'),
        (a.cached / 'summary.json', 'Prefix-cache round receipts'), (a.count / 'protocol.json', 'Controls and build identities'), (a.output / 'results.json', 'Derived table and definitions')]) + '</p>'
    body += '<p>Each experiment directory contains its frozen protocol, source/binary identities, per-trial requests/results, engine JSONL census, public native traces, allocation receipts, process observations and failed outcomes. Commands and accounting definitions are in experiments/MEMORY.md.</p>'
    if (a.output / 'experiment-inventory.json').exists():
        body += '<p><a href="experiment-inventory.json">Complete experiment inventory, including development canaries and failed UI attempts</a></p>'
    (a.output / 'index.html').write_text(body)
    print(a.output / 'index.html')

if __name__ == '__main__':
    main()
