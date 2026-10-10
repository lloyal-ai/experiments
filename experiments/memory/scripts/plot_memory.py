"""Offline figures from memory diagnostic receipts. Never starts an inference server."""
import argparse, json, statistics
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

COLORS={'lloyal':'#FF5A36','langgraph':'#4361EE'}
NAMES={'lloyal':'Lloyal','langgraph':'LangGraph + HTTP (prefix-cache enabled)'}

def main():
    ap=argparse.ArgumentParser();ap.add_argument('experiment',type=Path);args=ap.parse_args()
    rows=json.loads((args.experiment/'summary.json').read_text())['rows']
    out=args.experiment/'figures';out.mkdir(exist_ok=True)
    plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,'axes.spines.top':False,'axes.spines.right':False,'axes.labelsize':12,'figure.dpi':150,'savefig.dpi':220})
    rendered=set()
    def panel(metric,ylabel,name,scale=1,round_index=None):
        available=[r if round_index is None else next((s for s in r['rounds'] if s['round']==round_index),{}) for r in rows if r['valid']]
        if not any(r.get(metric) is not None for r in available):return
        rendered.add(name)
        fig,ax=plt.subplots(figsize=(4.8,4.8),layout='constrained')
        for backend in ['langgraph','lloyal']:
            xs=[];ys=[];lo=[];hi=[]
            for n in sorted({r['count'] for r in rows}):
                vals=[]
                for r in rows:
                    if r['backend']!=backend or r['count']!=n or not r['valid']:continue
                    source=r if round_index is None else next((s for s in r['rounds'] if s['round']==round_index),{})
                    if source.get(metric) is not None:vals.append(source[metric]/scale)
                if vals:
                    med=statistics.median(vals);xs.append(n);ys.append(med);lo.append(med-min(vals));hi.append(max(vals)-med)
                    ax.scatter([n]*len(vals),vals,color=COLORS[backend],alpha=.4,s=15,zorder=3)
            ax.errorbar(xs,ys,yerr=[lo,hi],color=COLORS[backend],label=NAMES[backend],marker='o' if backend=='lloyal' else 's',lw=2.3,ls='-' if backend=='lloyal' else '--',capsize=4,markersize=6)
        ax.set_xlabel('Requested concurrent agents');ax.set_ylabel(ylabel)
        ax.set_xticks(sorted({r['count'] for r in rows}));ax.set_ylim(bottom=0);ax.grid(axis='y',alpha=.18);ax.legend(fontsize=8,frameon=False,loc='best')
        fig.savefig(out/(name+'.png'));plt.close(fig)
    panel('peakAttentionCells','Peak occupied attention cells','occupied-attention')
    panel('peakContextAllocatedBytes','Reserved context memory (GiB)','reserved-context',2**30)
    panel('peakEngineAllocatedBytes','Model + context + compute (GiB)','engine-allocation',2**30)
    panel('workMs','Workload time, with preparation (s)','workload-time',1000)
    has_second=any(any(s['round']==1 for s in r.get('rounds',[])) for r in rows)
    if has_second:panel('workMs','Second-round workload time (s)','cached-round-time',1000,1)
    panel('peakProcessFootprintBytes','Main-model process footprint (GiB)','process-footprint',2**30)
    panel('peakOwnedGpuProcessBytes','Model / worker GPU memory (GiB)','gpu-process-memory',2**30)
    panel('peakHostPssSumBytes','Model + worker host PSS (GiB)','host-pss',2**30)
    manifest={'description':'Medians and min/max over valid trials. Failed trials remain in summary.json. Minimal text diagnostic, not whole Fieldnote memory. Fixed context/sequence capacity makes allocation flat by construction; occupied storage is a separate metric. Prefix-cache-enabled second-round time is shown separately.','allTrials':len(rows),'validTrials':sum(r['valid'] for r in rows),'figures':[p.name for p in sorted(out.glob('*.png'))]}
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    captions={'occupied-attention':'Physically occupied attention cells, counted once regardless of sequence references.','reserved-context':'Attention plus recurrent allocation. Equal context and sequence ceilings can reserve equal memory on both paths.','engine-allocation':'Owned engine buffers. Excludes application/browser overhead; minimal text diagnostic has no projector or reranker.','workload-time':'All requested rounds, including shared-prefix preparation. Model loading is outside this interval.','cached-round-time':'Subsequent requests after the first round; inspect prefix-cache receipts in the raw logs.','process-footprint':'macOS task_vm_info physical footprint of the main-model process; a separate accounting view from engine allocation.'}
    captions.update({'gpu-process-memory':'Sampled NVML memory attributed to the owned model/worker processes on Linux. Includes CUDA runtime overhead; separate from engine allocation and host memory.','host-pss':'Sampled Linux PSS summed for the model and worker processes. Proportional accounting for host RAM; excludes browser and is not GPU memory.'})
    captions={name:caption for name,caption in captions.items() if name in rendered}
    html='<meta charset="utf-8"><title>Memory diagnostic</title><style>body{font:16px system-ui;margin:40px;max-width:1150px;background:#fafafa;color:#222}main{display:grid;grid-template-columns:repeat(2,1fr);gap:28px}figure{margin:0}img{width:100%}figcaption{line-height:1.5}</style><h1>Agent-count memory diagnostic</h1><p>'+manifest['description']+'</p><p>'+str(manifest['validTrials'])+' / '+str(manifest['allTrials'])+' valid trials.</p><main>'
    html+=''.join(f'<figure><img src="{name}.png"><figcaption>{caption}</figcaption></figure>' for name,caption in captions.items())+'</main>'
    (out/'index.html').write_text(html)
    print(out)
if __name__=='__main__':main()
