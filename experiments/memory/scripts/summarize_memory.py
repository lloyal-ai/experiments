"""Write a compact, auditable diagnostic result table from derived receipts."""
import json,statistics,argparse,html
from pathlib import Path
ap=argparse.ArgumentParser();ap.add_argument('experiment',type=Path);a=ap.parse_args()
p=a.experiment;data=json.loads((p/'summary.json').read_text());rows=data['rows'];out=[]
for n in sorted({r['count'] for r in rows}):
 for backend in ['lloyal','langgraph']:
  rs=[r for r in rows if r['count']==n and r['backend']==backend]
  good=[r for r in rs if r['valid']]
  def stats(k,scale=1):
   vs=[r[k]/scale for r in good if r.get(k) is not None]
   return {'median':statistics.median(vs),'min':min(vs),'max':max(vs)} if vs else None
  out.append({'agents':n,'backend':backend,'validTrials':len(good),'attempts':len(rs),'occupiedCells':stats('peakAttentionCells'),'contextMiB':stats('peakContextAllocatedBytes',2**20),'engineMiB':stats('peakEngineAllocatedBytes',2**20),'workSeconds':stats('workMs',1000)})
(p/'table.json').write_text(json.dumps(out,indent=2)+'\n')
protocol=json.loads((p/'protocol.json').read_text())
if len(set(protocol.get('contexts',[protocol['context']])))!=1:raise SystemExit('Use a separate analysis for multiple context budgets.')
body='''<meta charset="utf-8"><title>Agent memory diagnostic</title><style>body{font:16px/1.55 system-ui;max-width:1120px;margin:40px auto;padding:0 24px;color:#222;background:#fafafa}table{border-collapse:collapse;width:100%;background:white}td,th{padding:10px 12px;border-bottom:1px solid #ddd;text-align:right}th:nth-child(2),td:nth-child(2){text-align:left}img{width:49%;background:white}code{font-size:13px}</style><h1>Shared-state memory diagnostic</h1><p>Fresh-process repeats at each agent count; real model outputs checked against a frozen reference ledger. Both backends use the same weights, 32,768-cell context, 16-sequence ceiling and 512-token batching. HTTP prefix caching is enabled. These are text-only diagnostic results.</p>'''
if all(r['valid'] for r in rows):body+=f'<p><b>All {len(rows)} trials passed.</b></p>'
else:body+='<p>Failed trials remain in the underlying summary. Metrics below are successful-trial medians; inspect failures before interpreting the curves.</p>'
if any(r.get('environment',{}).get('systemPagingObserved') for r in rows):
 body+='<p>System paging occurred during collection. OS-footprint and timing deltas are exploratory under these conditions. Direct engine cell counts and allocator receipts remain the primary memory evidence; system-wide paging is not attributed to either backend.</p>'
body+='<img src="figures/occupied-attention.png"><img src="figures/workload-time.png"><table><thead><tr><th>Agents</th><th>Backend</th><th>Valid</th><th>Occupied cells</th><th>Context MiB</th><th>Engine MiB</th><th>Work seconds</th></tr></thead><tbody>'
for r in out:
 vals=[r['agents'],'Lloyal' if r['backend']=='lloyal' else 'LangGraph + HTTP',f"{r['validTrials']}/{r['attempts']}"]
 for key in ['occupiedCells','contextMiB','engineMiB','workSeconds']:
  v=r[key];vals.append('unavailable' if v is None else f"{v['median']:,.2f}")
 body+='<tr>'+''.join('<td>'+html.escape(str(v))+'</td>' for v in vals)+'</tr>'
body+='</tbody></table>'
eight={r['backend']:r for r in out if r['agents']==8 and r['occupiedCells']}
if len(eight)==2:
 ll=eight['lloyal']['occupiedCells']['median'];lg=eight['langgraph']['occupiedCells']['median']
 body+=f'<p>The census counts each occupied attention cell once, even when several branches reference it. At eight agents the medians are {ll:,.0f} and {lg:,.0f} cells ({100*(1-ll/lg):.1f}% lower for Lloyal). This is a storage-occupancy result.</p>'
 for name in ['lloyal','langgraph']:
  r=eight[name];body+=f"<p>{html.escape(name)}: reserved context {r['contextMiB']['median']:,.1f} MiB; observed model + context + compute buffers {r['engineMiB']['median']:,.1f} MiB.</p>"
body+='''<p>Reserved bytes, occupied cells and process footprint are different measures. The current Node binding leaves <code>n_outputs_max</code> at its engine default, while llama-server sizes it to serving concurrency. Consider that source-level configuration difference when interpreting compute allocation. No serving flags or SDK execution behavior were changed to remove that cost.</p><p>Work time includes shared-prefix preparation and generated results, and excludes model loading. KV starts empty in each primary trial; OS file and shader caches were not flushed. Separate cached-round controls preserve their cache receipts. The prior two-round diagnostic retained native worker branches until its outer scope exited and refused two second-round tasks at width eight. Those failed attempts are preserved separately and are not successful repetitions of this one-round protocol.</p><p>Composed Fieldnote UI validation, answer-quality review, cached-round controls and the capacity ladder are separate gates. This diagnostic does not prove a whole-application RAM reduction or an unbounded number of agents.</p><p><a href="summary.json">All trial metrics and gates</a> · <a href="protocol.json">Frozen controls and identities</a> · <a href="table.json">Numeric table with ranges</a> · <a href="figures/index.html">All figures</a></p>'''
(p/'findings.html').write_text(body)
print(p/'findings.html')
