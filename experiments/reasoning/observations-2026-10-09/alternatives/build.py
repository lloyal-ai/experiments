"""Read existing receipts and render candidate figures; never starts inference.

python build.py --benchmark /path/to/lloyal-bench --evidence /path/to/cumulative-evidence.json
After extraction, `python build.py` rebuilds from the bundled observations.
"""
from pathlib import Path
import argparse
import hashlib
import json
import math
import os
import sys

ROOT = Path(__file__).resolve().parent
os.environ.setdefault('MPLCONFIGDIR', str(ROOT.parent / '.matplotlib'))
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.ticker import StrMethodFormatter

args = argparse.ArgumentParser()
args.add_argument('--benchmark', type=Path)
args.add_argument('--evidence', type=Path)
opt = args.parse_args()
assert bool(opt.benchmark) == bool(opt.evidence), 'Supply both source paths or neither.'
base = json.loads((ROOT.parent/'data.json').read_text())
sha = lambda data: hashlib.sha256(data).hexdigest()
if opt.benchmark:
    sys.path.insert(0, str(opt.benchmark/'scripts'))
    from raw_log_metrics import read_session, event_rows, first
    source = json.loads(opt.evidence.read_text())
    assert sha(opt.evidence.read_bytes()) == base['sourceAuditSha256']
    data = {'baseDataSha256': sha((ROOT.parent/'data.json').read_bytes()),
            'sourceAuditSha256': base['sourceAuditSha256'], 'pairs': []}
    for p, evidence in zip(base['pairs'], source['pairs']):
        assert p['label'] == evidence['label']
        pair = {'label': p['label'], 'runs': []}
        for r, raw in zip(p['runs'], evidence['runs']):
            assert r['backend'] == raw['backend']
            session = read_session(opt.benchmark/r['session'])
            assert session['snapshot']['sha256'] == r['journalSha256']
            rows = session['attempts'][r['attempt']-1]
            start, done = first(rows, 'research:start'), first(rows, 'research:done')
            findings, seen = [], set()
            for row in event_rows(rows):
                value = row['value']
                if not (start['t_ms'] <= row['t_ms'] <= done['t_ms']):
                    continue
                if value['type'] not in ('agent:return', 'agent:recovered') or not value.get('result'):
                    continue
                agent = value['agentId']
                if agent in seen:
                    continue
                seen.add(agent)
                findings.append({'seconds': (row['t_ms']-start['t_ms'])/1000,
                    'agentId': agent, 'seq': row['seq'], 'type': value['type'],
                    'resultSha256': sha(value['result'].encode())})
            assert len(findings) == 4
            assert math.isclose(findings[0]['seconds'], r['firstFindingSeconds'], abs_tol=1e-6)
            pair['runs'].append({**r, 'findings': findings,
                'researchDoneSeconds': (done['t_ms']-start['t_ms'])/1000,
                'inquiryGeneratedTokens': raw['generation']['inquiryTokens'],
                'synthesisGeneratedTokens': raw['generation']['synthesisTokensIncludingReasoning']})
        data['pairs'].append(pair)
    (ROOT/'observations.json').write_text(json.dumps(data, indent=2)+'\n')
else:
    data = json.loads((ROOT/'observations.json').read_text())
    assert data['baseDataSha256'] == sha((ROOT.parent/'data.json').read_bytes())

LL, LG = '#FF5A36', '#4361EE'
labels = ['Lloyal (KV)', 'LangGraph + HTTP + prefix caching']
plt.rcParams.update({'font.family':'DejaVu Sans', 'font.size':11,
    'svg.fonttype':'path', 'axes.spines.top':False, 'axes.spines.right':False,
    'axes.edgecolor':'#222222', 'axes.labelcolor':'#111111',
    'axes.linewidth':1.1, 'figure.facecolor':'white', 'savefig.facecolor':'white',
    'savefig.dpi':300})

def canvas():
    fig, ax = plt.subplots(figsize=(5.4, 5.4))
    fig.subplots_adjust(left=.17, right=.965, bottom=.15, top=.965)
    ax.set_axisbelow(True)
    ax.grid(linestyle='--', linewidth=.7, alpha=.45, color='#b5b5b5')
    ax.xaxis.set_major_formatter(StrMethodFormatter('{x:,.0f}'))
    ax.yaxis.set_major_formatter(StrMethodFormatter('{x:,.0f}'))
    return fig, ax

def save(fig, name):
    for suffix in ['png', 'svg']:
        fig.savefig(ROOT/(name+'.'+suffix))
    plt.close(fig)

fig, ax = canvas()
for p in data['pairs']:
    native, http = p['runs']
    ax.plot([native['answerTokens'], http['answerTokens']],
        [native['reasoningTokens'], http['reasoningTokens']],
        color='#b7b7b7', linewidth=1, zorder=1)
for j, color in enumerate([LL, LG]):
    for i, p in enumerate(data['pairs']):
        r = p['runs'][j]
        ax.scatter(r['answerTokens'], r['reasoningTokens'], s=95, color=color,
            edgecolor='#222222', linewidth=.6, zorder=3, label=labels[j] if i == 0 else None)
        ax.annotate(p['label'], (r['answerTokens'], r['reasoningTokens']),
            xytext=(7, 7), textcoords='offset points', fontsize=10)
ax.set(xlim=(0, 2200), ylim=(0, 8800), xlabel='Visible answer tokens',
       ylabel='Synthesis reasoning tokens')
ax.set_xticks([0, 500, 1000, 1500, 2000])
ax.set_yticks([0, 2000, 4000, 6000, 8000])
ax.legend(loc='upper left', fontsize=9, frameon=False, handletextpad=.5)
save(fig, 'reasoning-vs-answer')

fig, ax = canvas()
pair = next(p for p in data['pairs'] if p['label'] == 'C')
for j, color in enumerate([LL, LG]):
    r = pair['runs'][j]
    times = [0] + [e['seconds'] for e in r['findings']]
    ax.step(times, list(range(5)), where='post', color=color, linewidth=2.1, label=labels[j])
    ax.scatter(times[1:], [1, 2, 3, 4], s=37, color=color, edgecolor='white', linewidth=.6, zorder=3)
ax.set(xlim=(0, 310), ylim=(0, 4.6), xlabel='Time since research started (s)',
       ylabel='Distinct agents with a returned finding')
ax.set_xticks([0, 60, 120, 180, 240, 300])
ax.set_yticks([0, 1, 2, 3, 4])
ax.legend(loc='upper left', fontsize=9, frameon=False, handletextpad=.5)
save(fig, 'findings-over-time-C')

fig, ax = canvas()
ax.plot([0, 10000], [0, 10000], linestyle='--', color='#aaaaaa', linewidth=1, zorder=1)
for key, marker, color, label in [('inquiryGeneratedTokens', 'o', '#535865', 'Inquiry generation'),
                                 ('synthesisGeneratedTokens', 'D', LL, 'Synthesis generation')]:
    for i, p in enumerate(data['pairs']):
        native, http = p['runs']
        ax.scatter(http[key], native[key], marker=marker, color=color, s=80,
            edgecolor='#222222', linewidth=.55, zorder=3, label=label if i == 0 else None)
        ax.annotate(p['label'], (http[key], native[key]), xytext=(7, 6),
            textcoords='offset points', fontsize=10)
ax.set(xlim=(0, 10000), ylim=(0, 10000),
       xlabel='LangGraph + HTTP generated tokens', ylabel='Lloyal generated tokens')
ax.set_xticks([0, 2000, 4000, 6000, 8000, 10000])
ax.set_yticks([0, 2000, 4000, 6000, 8000, 10000])
ax.tick_params(axis='x', labelsize=9)
ax.set_aspect('equal', adjustable='box')
ax.legend(loc='upper left', fontsize=9, frameon=False)
save(fig, 'generation-by-stage')
print('Rendered three square candidate figures; findings verified for all six selected runs.')
