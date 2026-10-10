#!/usr/bin/env python3
import argparse,json,html,statistics
from pathlib import Path
ap=argparse.ArgumentParser();ap.add_argument('suite',type=Path);ap.add_argument('--html-only',action='store_true',help='Refresh interpretation without changing existing plots or needing plotting dependencies');a=ap.parse_args();root=a.suite.resolve()
runs=json.loads((root/'summary.json').read_text())['runs'];arms=['resident','http','shared-prefix'];labels=['Lloyal','HTTP + prefix-cache','HTTP + shared prefix'];colors=['#ff5637','#5366ec','#18a999']
reviews=json.loads((root/'quality-by-run.json').read_text())['runs'] if (root/'quality-by-run.json').exists() else {}
valid=[r for r in runs if 'extractionError' not in r and r.get('generation',{}).get('reasoningTokenCount') is not None and r.get('status',{}).get('driverComplete') and r.get('status',{}).get('synthesisCompleted')]
if not a.html_only:
 import matplotlib
 matplotlib.use('Agg')
 import matplotlib.pyplot as plt
 from matplotlib.patches import Patch
 import numpy as np
 plt.rcParams.update({'font.family':'DejaVu Sans','font.size':11,'axes.spines.top':False,'axes.spines.right':False})
 for metric,ylabel,file in [('reasoning','Synthesis reasoning tokens ↓','reasoning'),('time','Query → saved brief (seconds) ↓','elapsed')]:
  fig,ax=plt.subplots(figsize=(5.2,5.2),layout='constrained')
  seeds=sorted(set(r['seed'] for r in valid));x=np.arange(len(seeds));width=.24
  for i,arm in enumerate(arms):
   rs={r['seed']:r for r in valid if r['arm']==arm}
   vals=[(rs[s]['generation']['reasoningTokenCount'] if metric=='reasoning' else rs[s]['timing']['queryToCompleteMs']/1000) if s in rs else np.nan for s in seeds]
   bars=ax.bar(x+(i-1)*width,vals,width,color=colors[i],label=labels[i])
   captions=[]
   for j,s in enumerate(seeds):
    invalid=s in rs and reviews.get(rs[s]['run'],{}).get('substantiveInitialReport') is False
    if invalid:bars[j].set_hatch('///');bars[j].set_edgecolor('#18212e')
    captions.append('' if np.isnan(vals[j]) else f'{vals[j]:.0f}'+('†' if invalid else ''))
   ax.bar_label(bars,labels=captions,fontsize=9,padding=3)
   for j,s in enumerate(seeds):
    if s not in rs:ax.text(x[j]+(i-1)*width,.02,'failed',rotation=90,ha='center',va='bottom',transform=ax.get_xaxis_transform(),color=colors[i],fontsize=9)
  ax.set_xticks(x,[f'Run {i+1}' for i in range(len(seeds))]);ax.set_ylabel(ylabel);ax.set_ylim(bottom=0,top=max(v for r in valid for v in [(r['generation']['reasoningTokenCount'] if metric=='reasoning' else r['timing']['queryToCompleteMs']/1000)])*1.13)
  ax.legend(handles=[Patch(facecolor=c,label=l) for c,l in zip(colors,labels)],fontsize=9,loc='lower left',bbox_to_anchor=(0,1.01),frameon=False,borderaxespad=0);ax.grid(axis='y',alpha=.15);ax.set_axisbelow(True)
  fig.savefig(root/(file+'.png'),dpi=200);plt.close(fig)
rows=[]
for r in runs:
 if 'extractionError' in r:rows.append('<tr><td>'+html.escape(r['run'])+'</td><td colspan="7">'+html.escape(r['extractionError'])+'</td></tr>');continue
 t=r['timing'];gen=r['generation'];sc=r.get('synthesisCache');st=sc.get('serverTimings') if sc else None
 cache='—' if not st else f"{st.get('cache_n',0):,} / {st.get('cache_n',0)+st.get('prompt_n',0):,}"
 duration=lambda key:'—' if t.get(key) is None else f"{t[key]/1000:.1f}"
 status='completed' if r['status']['driverComplete'] else 'failed — no completed full journey'
 if reviews.get(r['run'],{}).get('substantiveInitialReport') is False:status='UI completed; tool-call-only output'
 rows.append(f"<tr><td>{html.escape(r['run'])}</td><td>{gen.get('reasoningTokenCount')}</td><td>{r['answerTokens'] if r['savedAnswerAvailable'] else '—'}</td><td>{r['answerWords'] if r['savedAnswerAvailable'] else '—'}</td><td>{duration('synthesisMs')}</td><td>{duration('queryToCompleteMs')}</td><td>{cache}</td><td>{status}</td></tr>")
quality='Quality review is pending.'
if (root/'quality-review.json').exists():quality=html.escape(json.dumps(json.loads((root/'quality-review.json').read_text()),indent=2))
page='''<!doctype html><meta charset="utf-8"><title>Fieldnote reasoning — CUDA</title><style>body{font:16px system-ui;max-width:1200px;margin:40px auto;color:#18212e;padding:0 24px}p{line-height:1.6}img{width:48%;max-width:540px}table{border-collapse:collapse;width:100%;font-size:13px}td,th{padding:10px;text-align:left;border-bottom:1px solid #ddd}pre{white-space:pre-wrap;background:#f4f6f8;padding:20px}a{color:#345dc3}</style><h1>Reasoning in the full Fieldnote workload</h1><p>Three arms on one NVIDIA L40S: Lloyal resident context, the existing LangGraph HTTP host with prefix-cache enabled, and the same host with a deliberately shared system/tool prefix. All run the Fieldnote UI journey, fresh preflight, four reviewed inquiries, PDF/image tools, Markdown corpus and reranker, synthesis, saved brief and follow-up.</p><p>Bars show completed full journeys; every planned attempt, including failures, remains in the table. Matched explicit sampling and pinned weights. Three repetitions of one synthetic task are exploratory. Different generated findings and prompt layouts prevent a causal claim about retained state. The shared-prefix arm changes instruction placement and keeps tool schemas with tool_choice=none. Reasoning text does not measure all internal computation.</p><img src="reasoning.png"><img src="elapsed.png"><table><thead><tr><th>Run</th><th>Reasoning tokens</th><th>Answer tokens</th><th>Words</th><th>Synthesis s</th><th>Full brief s</th><th>Synthesis prefix-cache / input</th><th>Acceptance checks</th></tr></thead><tbody>'''+''.join(rows)+'''</tbody></table><h2>Quality review</h2><pre>'''+quality+'''</pre><p><a href="summary.json">Raw-log-derived measurements</a> · <a href="suite.json">Frozen protocol and run order</a> · <a href="quality-rubric.json">Quality rubric</a></p>'''
if (root/'quality-by-run.json').exists():
 q=json.loads((root/'quality-by-run.json').read_text())
 qr=''.join(f"<tr><td>{html.escape(k)}</td><td>{v['score']}/{v['maximum']}</td><td>{html.escape(v.get('summary',''))}</td></tr>" for k,v in sorted(q['runs'].items()))
 start=page.index('<h2>Quality review</h2>');end=page.index('</pre>',start)+6
 page=page[:start]+'<h2>Quality review</h2><p>Anonymous answer packets scored before the token comparison was opened. The reviewer is the implementing assistant; this is not an independent review. Scores measure this fixture’s rubric coverage, not established quality equivalence.</p><table><tr><th>Run</th><th>Rubric</th><th>Assessment</th></tr>'+qr+'</table><p><a href="quality-review.json">Anonymous scores and quoted evidence</a> · <a href="quality-by-run.json">Mapping to runs</a></p>'+page[end:]
page=page.replace('<h2>Quality review</h2>','<p>† Hatched bar: UI completed but the saved initial output was only a tool-call block. It is not a successful report. Native runs use LLOYAL_DEV=1 with tracing. Elapsed time includes orchestration, tools, reranking, UI review and instrumentation; it is not an isolated GPU decoding measurement. Both model stacks ran sequentially.</p><h2>Quality review</h2>')
page=page.replace('<a href="summary.json">','<a href="controls.json">Control receipts</a> · <a href="summary.json">')
if (root/'findings.json').exists():
 findings=json.loads((root/'findings.json').read_text())
 page=page.replace('</h1>','</h1>'+''.join('<p>'+html.escape(t)+'</p>' for t in findings['paragraphs']),1)
page=page.replace('</h1>','</h1><p><a href="answers.html"><strong>Read the complete answers side by side →</strong></a> · All rounds, unchanged rubric evidence, original Markdown and separate follow-ups.</p>',1)
(root/'index.html').write_text(page)
