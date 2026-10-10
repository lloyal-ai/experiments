#!/usr/bin/env python3
"""Compare original and repeated synthesis from raw journals, preserving text receipts."""
import argparse
import hashlib
import json
import re
import urllib.request
from pathlib import Path
from raw_log_metrics import read_session, summarize, event_rows


def extract(path, attempt, repeat, tokenizer_url=None):
    session = read_session(path)
    summary = summarize(session, attempt)
    rows = session['attempts'][attempt - 1]
    starts = event_rows(rows, 'synthesize:start')
    dones = event_rows(rows, 'synthesize:done')
    if not starts or not dones:
        raise ValueError(f'{path} attempt {attempt}: no complete synthesis')
    start, done = starts[0], dones[0]
    aid = done['value']['agentId']
    rows = [r for r in rows if start['t_ms'] <= r['t_ms'] <= done['t_ms']]
    native = summary['backend'] == 'fieldnote'
    if native:
        turns, seen = [], set()
        for row in event_rows(rows, 'agent:trace'):
            ev = row['value']['event']
            key = ev.get('traceId', row['seq'])
            if ev.get('type') == 'agent:turn' and ev.get('agentId') == aid and key not in seen:
                turns.append(ev['rawOutput']); seen.add(key)
        if not turns or any('</think>' not in t for t in turns):
            raise ValueError('Native reasoning boundary missing; cannot report zero reasoning')
        reasoning = ''.join(t.split('</think>', 1)[0] for t in turns)
    else:
        reasoning = ''.join(r['value'].get('text', '') for r in event_rows(rows, 'agent:reasoning_delta')
                            if r['value'].get('agentId') == aid)
    # Strip explicit delimiters only. Whitespace is retained; no paraphrase or normalization.
    reasoning_text = reasoning.replace('<think>', '')
    full_attempt = session['attempts'][attempt - 1]
    answers = event_rows(full_attempt, 'answer')
    answer = answers[-1]['value'].get('text', '') if answers else ''
    plans = [r for r in event_rows(full_attempt, 'plan') if r['t_ms'] < start['t_ms']]
    result = {'repeat': repeat, 'backend': summary['backend'], 'session': summary['session'],
              'attempt': attempt, 'snapshot': summary['snapshot'],
              'timing': summary['timing'],
              'generation': {k: v for k, v in summary['generation'].items() if k != 'synthesisStream'},
              'synthesisAgentId': aid, 'synthesisStartSeq': start['seq'], 'synthesisDoneSeq': done['seq'],
              'finalPlan': plans[-1]['value']['tasks'] if plans else [],
              'errors': summary['errors'], 'controls': summary['controls'],
              'reasoningTextCharsWithoutDelimiters': len(reasoning_text),
              'reasoningTextSha256': hashlib.sha256(reasoning_text.encode()).hexdigest(),
              'quality': 'Requires semantic review; token reductions are not quality-adjusted.'}
    if tokenizer_url:
        counts = {}
        for name, text in [('reasoning', reasoning_text), ('answer', answer)]:
            payload = json.dumps({'content': text, 'add_special': False, 'parse_special': False}).encode()
            req = urllib.request.Request(tokenizer_url.rstrip('/') + '/tokenize', payload,
                                         {'Content-Type': 'application/json'})
            with urllib.request.urlopen(req, timeout=60) as response:
                receipt = json.load(response)
            counts[name] = len(receipt['tokens'])
        result['retokenizedTextTokens'] = counts
        result['retokenizationMethod'] = 'Same loaded GGUF tokenizer; add_special=false, parse_special=false. Post-hoc text token counts, not separately recorded generation-token usage; boundaries and special tokens can differ.'
    return result, reasoning_text, answer


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--native-repeat', required=True)
    p.add_argument('--native-attempt', type=int, default=2)
    p.add_argument('--http-repeat', required=True)
    p.add_argument('--http-attempt', type=int, default=1)
    p.add_argument('--tokenizer-url')
    p.add_argument('--output', default='comparisons/deliberation-repeat-2026-10-09')
    args = p.parse_args()
    out = Path(args.output); out.mkdir(parents=True, exist_ok=True)
    selections = [('sessions/fieldnote-2026-10-08T11-17-51.047Z', 2, 'original'),
                  ('sessions/langgraph-2026-10-08T11-44-18.678Z', 1, 'original'),
                  (args.native_repeat, args.native_attempt, 'repeat'),
                  (args.http_repeat, args.http_attempt, 'repeat')]
    runs = []
    for path, attempt, repeat in selections:
        row, reasoning, answer = extract(path, attempt, repeat, args.tokenizer_url)
        stem = f'{repeat}-{row["backend"]}'
        for name, text in [('reasoning', reasoning), ('answer', answer)]:
            dest = out / f'{stem}-{name}.txt'; dest.write_text(text)
            row[f'{name}File'] = str(dest.resolve())
        runs.append(row)
    report = {'runs': runs, 'interpretation': [
        'One repeat per backend; descriptive evidence only, not a causal or statistically reliable result.',
        'Question, reviewed inquiry descriptions, fixture hashes, models and application versions are controlled. Generated coverage, ability assignments, evidence and synthesis inputs can vary.',
        'Native coverage is primed and reused; HTTP starts fresh, matching the original per-backend setup. Native setup duration and generated primer plan differ from original.',
        'Total generated tokens include reasoning and answer. Reasoning characters and post-hoc text tokens are separately labeled.',
        'Semantic correctness and source coverage must be considered before claiming a deliberation advantage.'
    ]}
    (out / 'deliberation-repeats.json').write_text(json.dumps(report, indent=2) + '\n')
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    fig, axes = plt.subplots(1, 3, figsize=(13, 4.8), layout='constrained')
    metrics = [('reasoningChars', 'Reasoning text (characters)'),
               ('synthesisTokensIncludingReasoning', 'Generated synthesis tokens\n(reasoning + answer)'),
               ('visibleWordsApprox', 'Visible answer (approx. words)')]
    colors = ['#087f8c', '#e07a36']
    for ax, (key, title) in zip(axes, metrics):
        for i, backend in enumerate(['fieldnote', 'langgraph']):
            vals = [r['generation'][key] for r in runs if r['backend'] == backend]
            bars = ax.bar([0 + i * .36, 1 + i * .36], vals, width=.33, color=colors[i],
                          label='Lloyal' if i == 0 else 'LangGraph + llama-server')
            ax.bar_label(bars, fmt='%.0f', padding=3, fontsize=9)
        ax.set_xticks([.18, 1.18], ['Original', 'Repeat']); ax.set_title(title, fontsize=11)
        ax.spines[['top', 'right']].set_visible(False); ax.margins(y=.18)
    axes[0].legend(loc='upper left', fontsize=8)
    fig.suptitle('Synthesis deliberation: original pair and one repeat', fontsize=14)
    fig.supxlabel('Same external task; generated evidence may differ. No causal or quality-adjusted conclusion.', fontsize=9)
    for ext in ['png', 'svg']:
        fig.savefig(out / f'deliberation-repeats.{ext}', dpi=180)
    for r in runs:
        print(r['repeat'], r['backend'], json.dumps(r['generation']), r.get('retokenizedTextTokens'))

if __name__ == '__main__':
    main()
