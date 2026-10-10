#!/usr/bin/env python3
import argparse,json,html,statistics
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
ap=argparse.ArgumentParser();ap.add_argument('suite',type=Path);a=ap.parse_args();root=a.suite.resolve()
runs=json.loads((root/'summary.json').read_text())['runs'];arms=['resident','http','shared-prefix'];labels=['Lloyal','HTTP + prefix-cache','HTTP + shared prefix'];colors=['#ff5637','#5366ec','#18a999']
valid=[r for r in runs if 'extractionError' not in r and r.get('generation',{}).get('reasoningTokenCount') is not None]
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':11,'axes.spines.top':False,'axes.spines.right':False})
for metric,ylabel,file in [('reasoning','Synthesis reasoning tokens ↓','reasoning'),('time','Query → saved brief (seconds) ↓','elapsed')]:
 fig,ax=plt.subplots(figsize=(5.2,5.2),layout='constrained')
 seeds=sorted(set(r['seed'] for r in valid));x=np.arange(len(seeds));width=.24
 for i,arm in enumerate(arms):
  rs={r['seed']:r for r in valid if r['arm']==arm}
  vals=[(rs[s]['generation']['reasoningTokenCount'] if metric=='reasoning' else rs[s]['timing']['queryToCompleteMs']/1000) if s in rs else np.nan for s in seeds]
  bars=ax.bar(x+(i-1)*width,vals,width,color=colors[i],label=labels[i]);ax.bar_label(bars,fmt='%.0f',fontsize=9,padding=3)
 ax.set_xticks(x,[f'Run {i+1}' for i in range(len(seeds))]);ax.set_ylabel(ylabel);ax.set_ylim(bottom=0);ax.margins(y=.20);ax.legend(fontsize=9,loc='upper left');ax.grid(axis='y',alpha=.15);ax.set_axisbelow(True)
 fig.savefig(root/(file+'.png'),dpi=200);plt.close(fig)
rows=[]
for r in runs:
 if 'extractionError' in r:rows.append('<tr><td>'+html.escape(r['run'])+'</td><td colspan="7">'+html.escape(r['extractionError'])+'</td></tr>');continue
 t=r['timing'];gen=r['generation'];sc=r.get('synthesisCache');st=sc.get('serverTimings') if sc else None
 cache='—' if not st else f"{st.get('cache_n',0):,} / {st.get('cache_n',0)+st.get('prompt_n',0):,}"
 rows.append(f"<tr><td>{html.escape(r['run'])}</td><td>{gen.get('reasoningTokenCount')}</td><td>{r['answerTokens']}</td><td>{r['answerWords']}</td><td>{(t.get('synthesisMs') or 0)/1000:.1f}</td><td>{(t.get('queryToCompleteMs') or 0)/1000:.1f}</td><td>{cache}</td><td>{html.escape(str(r['status']))}</td></tr>")
quality='Quality review is pending.'
if (root/'quality-review.json').exists():quality=html.escape(json.dumps(json.loads((root/'quality-review.json').read_text()),indent=2))
page='''<!doctype html><meta charset="utf-8"><title>Fieldnote reasoning — CUDA</title><style>body{font:16px system-ui;max-width:1200px;margin:40px auto;color:#18212e;padding:0 24px}p{line-height:1.6}img{width:48%;max-width:540px}table{border-collapse:collapse;width:100%;font-size:13px}td,th{padding:10px;text-align:left;border-bottom:1px solid #ddd}pre{white-space:pre-wrap;background:#f4f6f8;padding:20px}a{color:#345dc3}</style><h1>Reasoning in the full Fieldnote workload</h1><p>Three arms on one NVIDIA L40S: Lloyal resident context, the existing LangGraph HTTP host with prefix-cache enabled, and the same host with a deliberately shared system/tool prefix. All run the Fieldnote UI journey, fresh preflight, four reviewed inquiries, PDF/image tools, Markdown corpus and reranker, synthesis, saved brief and follow-up.</p><p>Matched explicit sampling and pinned weights. Three repetitions of one synthetic task are exploratory. Different generated findings and prompt layouts prevent a causal claim about retained state. The shared-prefix arm changes instruction placement and keeps tool schemas with tool_choice=none. Reasoning text does not measure all internal computation.</p><img src="reasoning.png"><img src="elapsed.png"><table><thead><tr><th>Run</th><th>Reasoning tokens</th><th>Answer tokens</th><th>Words</th><th>Synthesis s</th><th>Full brief s</th><th>Synthesis prefix-cache / input</th><th>Acceptance checks</th></tr></thead><tbody>'''+''.join(rows)+'''</tbody></table><h2>Quality review</h2><pre>'''+quality+'''</pre><p><a href="summary.json">Raw-log-derived measurements</a> · <a href="suite.json">Frozen protocol and run order</a> · <a href="quality-rubric.json">Quality rubric</a></p>'''
(root/'index.html').write_text(page)
