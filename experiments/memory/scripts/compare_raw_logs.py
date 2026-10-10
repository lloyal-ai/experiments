#!/usr/bin/env python3
"""Offline raw-log comparison: JSON, HTML, PNG and SVG. Does not launch models.

Example:
  .venv-plots/bin/python scripts/compare_raw_logs.py \
    --native sessions/fieldnote-2026-10-08T11-17-51.047Z --native-attempt 2 \
    --http sessions/langgraph-2026-10-08T11-44-18.678Z --http-attempt 1 \
    --output comparisons/composed-survey
"""
from __future__ import annotations

import argparse
import html
import json
import os
import statistics
import sys
import textwrap
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from raw_log_metrics import read_session, summarize, brief_attempt, number

COLORS = ['#176b87', '#c66029']
SHORT = ['Lloyal', 'LangGraph + HTTP']
NOTES = [
    'Single selected observation per backend. No confidence intervals, quality equivalence or causal architecture claim.',
    'Select attempts explicitly; session inventories retain failures and controller-aborted attempts. Completion is not a quality pass.',
    'Native/HTTP engine builds, inquiry findings, tool paths and synthesis lengths differ. Check manifests and review files before comparing.',
    'Preflight may be reused; not executed is not a measured zero-duration preflight. Review dwell is included in query totals.',
    'Generated-token counts include reasoning. Reasoning token counts are not inferred from streaming chunk counts.',
    'HTTP prompt/cache counters and native trace KV cells measure different things. Absence is shown as unavailable.',
    'CPU is ps process %CPU. RSS is per-process residency, not unique physical memory or GPU allocation. No summed memory or energy claim.',
    'Browser performance timestamps stay on their own clock. Rendered prose does not establish correctness or human reading.',
    'Tool duration boundaries differ: native trace duration versus HTTP call/result receipt interval. Reranker query sets and score scales differ.',
    'Power/thermal state was not sampled throughout these runs. Read any power-interruption-review.json alongside timings.',
]


def wrapped(s, width=21):
    return '\n'.join(textwrap.wrap(str(s).replace('_', ' '), width))


def grouped(ax, labels, values, title, unit='', digits=1):
    """None is unavailable; zero remains an observed zero."""
    width = .35
    finite = [v for row in values for v in row if number(v)]
    maximum = max(finite, default=1) or 1
    for side, row in enumerate(values):
        for i, v in enumerate(row):
            x = i + (side - .5) * width
            if number(v):
                ax.bar(x, v, width, color=COLORS[side], label=SHORT[side] if i == 0 else None)
                ax.text(x, v + maximum * .022, f'{v:,.{digits}f}', ha='center', va='bottom', fontsize=8)
            else:
                ax.text(x, maximum * .035, 'N/A', ha='center', va='bottom', rotation=90, fontsize=8, color='#737b83')
    ax.set_xticks(range(len(labels)), [wrapped(s) for s in labels], fontsize=9)
    ax.set_xlim(-.65, len(labels)-.35)
    ax.set_ylim(0, maximum * 1.22)
    ax.set_ylabel(unit)
    ax.set_title(title, loc='left', fontsize=12, weight='bold')
    ax.grid(axis='y', alpha=.18)
    ax.set_axisbelow(True)


def empty(ax, message, title=''):
    ax.set_title(title, loc='left', fontsize=12, weight='bold')
    ax.text(.5, .5, textwrap.fill(message, 55), ha='center', va='center', transform=ax.transAxes, color='#646d78')
    ax.set_xticks([]); ax.set_yticks([])


def seconds(v):
    return v / 1000 if number(v) else None


def downsample(values, target=1600):
    return values[::max(1, len(values) // target)]


def charts(data, output):
    os.environ.setdefault('MPLCONFIGDIR', str(output / '.matplotlib'))
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.patches import Patch
    plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 10, 'axes.spines.top': False,
                         'axes.spines.right': False, 'figure.facecolor': '#fbfcfd', 'axes.facecolor': 'white',
                         'svg.fonttype': 'none', 'savefig.facecolor': '#fbfcfd'})
    runs = data['runs']; figures = []
    context = ' | '.join(f"{SHORT[i]}: attempt {r['selection']['attempt']}" for i, r in enumerate(runs))

    def figure(title, subtitle):
        fig, axes = plt.subplots(2, 2, figsize=(14, 9))
        fig.suptitle(title, x=.065, y=.98, ha='left', fontsize=20, weight='bold', color='#182b3a')
        fig.text(.065, .935, subtitle, fontsize=10, color='#546371')
        fig.text(.065, .022, context + '  •  Single observations; read the methodology and raw receipts.', fontsize=9, color='#546371')
        fig.legend(handles=[Patch(color=c, label=n) for c, n in zip(COLORS, SHORT)], loc='upper right',
                   bbox_to_anchor=(.96, .934), ncol=2, frameon=False, fontsize=9)
        fig.subplots_adjust(left=.085, right=.96, top=.865, bottom=.13, hspace=.52, wspace=.30)
        return fig, axes.ravel()

    def save(fig, name, title):
        fig.savefig(output / (name + '.png'), dpi=160)
        fig.savefig(output / (name + '.svg'))
        plt.close(fig)
        figures.append({'file': name, 'title': title})

    fig, ax = figure('01 / Latency and responsiveness', 'Host durations and browser render delays use separate clocks. N/A means absent, not zero.')
    keys = ['preflightMs', 'plannerMs', 'researchMs', 'synthesisMs']
    grouped(ax[0], ['Preflight', 'Planner', 'Research', 'Synthesis'], [[seconds(r['timing'][k]) for k in keys] for r in runs], 'Recorded stage durations', 'seconds')
    keys = ['firstGenerationAfterResearchMs', 'firstFindingAfterResearchMs']
    vals = [[seconds(r['timing'][k]) for k in keys] + [seconds(r['browser']['firstProseAfterResearchPaintMs'])] for r in runs]
    grouped(ax[1], ['First generation receipt', 'First finding returned', 'First browser prose render'], vals, 'After research starts', 'seconds')
    grouped(ax[2], ['Research → complete', 'Query → complete', 'Plan review interval'],
        [[seconds(r['timing'][k]) for k in ['researchToCompleteMs', 'queryToCompleteMs', 'reviewMs']] for r in runs],
        'Different preflight/review work affects query totals', 'seconds')
    ax[3].set_title('Selected attempt timeline', loc='left', fontsize=12, weight='bold')
    stage_colors = {'preflight': '#9badbc', 'research': '#527b98', 'synthesis': '#a36e8e'}
    for i, r in enumerate(runs):
        p = r['phaseReceipts']
        ax[3].hlines(i, 0, r['selection']['observedMs']/1000, color=COLORS[i], lw=2)
        for name in stage_colors:
            start_key, end_key = ('synthesize:start', 'synthesize:done') if name == 'synthesis' else (name+':start', name+':done')
            if start_key in p and end_key in p:
                a, b = p[start_key]['atMs']/1000, p[end_key]['atMs']/1000
                ax[3].barh(i, b-a, left=a, height=.33, color=stage_colors[name])
    ax[3].set_yticks([0, 1], SHORT); ax[3].set_ylim(-.6, 1.6); ax[3].set_xlabel('seconds since submit; gaps include planning/review')
    ax[3].legend(handles=[Patch(color=c, label=s) for s, c in stage_colors.items()], frameon=False, fontsize=8, loc='upper right')
    save(fig, '01-latency', 'Latency and responsiveness')

    fig, ax = figure('02 / Generation and synthesis size', 'Reasoning is included in token totals. Streaming chunks are not counted as tokens.')
    grouped(ax[0], ['Inquiry tokens', 'Synthesis tokens'], [[r['generation'][k] for k in ['inquiryTokens', 'synthesisTokensIncludingReasoning']] for r in runs], 'Reported generated tokens', 'tokens', 0)
    grouped(ax[1], ['Visible report'], [[r['generation']['visibleWordsApprox']] for r in runs], 'Approximate visible report size', 'words', 0)
    grouped(ax[2], ['Reasoning text'], [[r['generation']['reasoningChars']] for r in runs], 'Reasoning text length (not token count)', 'characters', 0)
    for i, r in enumerate(runs):
        channels = defaultdict(int); merged = []
        for x in r['generation']['synthesisStream']:
            channels[x['channel']] = x['chars']; merged.append((x['atMs']/1000, sum(channels.values())))
        points = downsample(merged)
        if points:
            ax[3].plot([p[0] for p in points], [p[1] for p in points], color=COLORS[i], label=SHORT[i])
    ax[3].set_title('Synthesis emitted text, including reasoning', loc='left', fontsize=12, weight='bold')
    ax[3].set_xlabel('seconds since synthesis start'); ax[3].set_ylabel('cumulative characters; native includes markers')
    ax[3].grid(alpha=.18)
    save(fig, '02-generation', 'Generation and synthesis size')

    fig, ax = figure('03 / Tool use and retrieval work', 'Actual tool paths and queries differ. Durations have backend-specific boundaries; no retrieval-quality score is inferred.')
    names = sorted(set().union(*(r['tools']['researchByTool'] for r in runs)))
    if names:
        grouped(ax[0], names, [[r['tools']['researchByTool'].get(k, 0) for k in names] for r in runs], 'Research tool calls by name', 'calls', 0)
        ax[0].set_xticks(range(len(names)), [wrapped(s, 11) for s in names])
        ax[0].tick_params(axis='x', labelsize=8)
    else:
        empty(ax[0], 'No research tool calls recorded.')
    for i, r in enumerate(runs):
        durations = sorted(t['durationMs']/1000 for t in r['tools']['durations'] if t['durationMs'] > 0)
        if durations:
            ax[1].step(durations, [(j+1)/len(durations) for j in range(len(durations))], where='post', color=COLORS[i])
    ax[1].set_xscale('log'); ax[1].set_ylim(0, 1.05); ax[1].set_xlabel('recorded tool operation duration (seconds, log scale)')
    ax[1].set_ylabel('fraction of observed operations'); ax[1].set_title('Tool duration distributions', loc='left', fontsize=12, weight='bold'); ax[1].grid(alpha=.18)
    grouped(ax[2], ['Ranking operations', 'Candidates scored', 'Passages selected'],
        [[r['retrieval'][k] for k in ['operations', 'candidatesScored', 'selectedPassages']] for r in runs], 'Retrieval counts across this attempt', 'count', 0)
    for i, r in enumerate(runs):
        xs = [x for x in r['retrieval']['rankings'] if number(x.get('durationMs')) and number(x.get('admittedTokens'))]
        ax[3].scatter([x['admittedTokens'] for x in xs], [x['durationMs']/1000 for x in xs], color=COLORS[i], alpha=.65, s=26)
    ax[3].set_title('Ranking operations: admitted text and duration', loc='left', fontsize=12, weight='bold')
    ax[3].set_xlabel('admitted tokens per ranking'); ax[3].set_ylabel('recorded duration (seconds)'); ax[3].grid(alpha=.18)
    save(fig, '03-tools-retrieval', 'Tool use and retrieval work')

    fig, ax = figure('04 / HTTP transport and backend cache reports', 'HTTP-only counters. Native has no equivalent HTTP boundary; its KV trace appears separately.')
    h = runs[1]['http']; statuses = h['statuses']
    ax[0].bar(['Completed', 'Failed', 'Unfinished'], [statuses.get(k, 0) for k in ['completed', 'failed', 'unfinished']], color=COLORS[1])
    for i, k in enumerate(['completed', 'failed', 'unfinished']):
        ax[0].text(i, statuses.get(k, 0)+.25, str(statuses.get(k, 0)), ha='center')
    ax[0].set_title('Main-model HTTP requests', loc='left', fontsize=12, weight='bold'); ax[0].set_ylabel('requests')
    prompt, cached, generated = (h[k]['total'] for k in ['promptTokens', 'cachedPromptTokens', 'outputTokens'])
    if number(prompt) and number(cached) and 0 <= cached <= prompt:
        ax[1].barh(['Prompt'], [cached], color='#98bdca', label='reported cached')
        ax[1].barh(['Prompt'], [prompt-cached], left=[cached], color=COLORS[1], label='prompt minus reported cached')
        if number(generated):
            ax[1].barh(['Generated'], [generated], color='#745a87')
        else:
            ax[1].text(0, 1, 'Generated: N/A')
        ax[1].set_xlabel('reported tokens across requests'); ax[1].legend(fontsize=8, frameon=False)
        ax[1].set_title('Reported token work', loc='left', fontsize=12, weight='bold')
    else:
        empty(ax[1], 'Prompt/cache usage unavailable or inconsistent.', 'Reported token work')
    reqs = h['requests']
    for status, marker in [('completed', 'o'), ('failed', 'x'), ('unfinished', '^')]:
        rr = [r for r in reqs if r['status'] == status and number(r['durationMs'])]
        ax[2].scatter([r['atMs']/1000 for r in rr], [r['durationMs']/1000 for r in rr], label=status, marker=marker,
                      color=COLORS[1] if status == 'completed' else '#973843', s=23)
    ax[2].set_title('Request latency timeline', loc='left', fontsize=12, weight='bold'); ax[2].set_xlabel('seconds since submit')
    ax[2].set_ylabel('request duration (seconds)'); ax[2].grid(alpha=.18)
    rank_bytes = sum(r.get('wireBytes', 0) for r in h['rerankerRequests'])
    vals = [(h['requestBodyBytes'] or 0)/1e6, rank_bytes/1e6]
    ax[3].bar(['Main model', 'Reranker + tokenize'], vals, color=COLORS[1])
    for i, v in enumerate(vals):
        ax[3].text(i, v+max(vals+[1])*.025, f'{v:,.3f} MB', ha='center')
    ax[3].set_ylim(0, max(vals+[.1])*1.22); ax[3].set_ylabel('decimal MB of serialized request bodies')
    ax[3].set_title('Bytes sent, including repeated context/images', loc='left', fontsize=12, weight='bold')
    save(fig, '04-http-cache', 'HTTP transport and cache reports')

    fig, ax = figure('05 / Resource observations', 'Separate processes, never summed. RSS is not GPU allocation; ps %CPU is not instantaneous GPU utilization.')
    for i, r in enumerate(runs):
        processes = r['resources']['processes']
        if not processes:
            empty(ax[i], 'No process samples recorded.'); empty(ax[i+2], 'No process samples recorded.'); continue
        palette = ['#263e5b', COLORS[i], '#94804a', '#7d628f']
        for j, p in enumerate(processes):
            pts = downsample(p['samples']); label = f"{p['label']} ({p['pid']})"
            ax[i].plot([x['atMs']/1000 for x in pts], [x['rssBytes']/2**30 for x in pts], color=palette[j % len(palette)], label=label)
            ax[i+2].plot([x['atMs']/1000 for x in pts], [x['cpuPct'] for x in pts], color=palette[j % len(palette)], label=label)
        ax[i].set_title(SHORT[i]+' · per-process RSS', loc='left', fontsize=12, weight='bold'); ax[i].set_ylabel('GiB'); ax[i].legend(fontsize=8, frameon=False)
        ax[i+2].set_title(SHORT[i]+' · per-process CPU', loc='left', fontsize=12, weight='bold'); ax[i+2].set_ylabel('ps %CPU')
        for a in (ax[i], ax[i+2]):
            a.set_xlabel('seconds since submit'); a.grid(alpha=.18)
    save(fig, '05-resources', 'Per-process resource observations')

    fig, ax = figure('06 / Controls, failures and attempt history', 'All attempts in the two session snapshots remain visible. An aborted controller attempt is not automatically a backend failure.')
    for i, r in enumerate(runs):
        inv = r['attemptInventory']; names = [f"#{a['attempt']}" + (' *' if a['selected'] else '') for a in inv]
        vals = [a['observedMs']/1000 for a in inv]
        ax[i].barh(names, vals, color=[COLORS[i] if a['selected'] else '#c9d2d9' for a in inv])
        for j, a in enumerate(inv):
            ax[i].text(vals[j]+4, j, a['status'].replace('completed-', ''), va='center', fontsize=8)
        ax[i].set_xlim(0, max(vals+[1])*1.52); ax[i].set_xlabel('observed elapsed seconds; * selected')
        ax[i].set_title(SHORT[i]+' · session attempts', loc='left', fontsize=12, weight='bold')
    cmds = ['pause', 'resume', 'cancel_agent', 'wrap_up', 'stop', 'new_run']
    grouped(ax[2], cmds, [[r['controls']['counts'].get(k, 0) for k in cmds] for r in runs], 'Controls in selected attempts', 'commands', 0)
    for i, r in enumerate(runs):
        inv = r['attemptInventory']
        ax[3].scatter([a['attempt'] + (i-.5)*.1 for a in inv], [a['controls']['acknowledgedHoldMs']/1000 for a in inv], color=COLORS[i], s=45)
    ax[3].set_title('Acknowledged Hold dwell across attempts', loc='left', fontsize=12, weight='bold')
    max_hold = max((a['controls']['acknowledgedHoldMs']/1000 for r in runs for a in r['attemptInventory']), default=0)
    ax[3].set_xlabel('attempt number within its session'); ax[3].set_ylabel('held seconds'); ax[3].set_ylim(-.05, max(1, max_hold*1.15)); ax[3].grid(alpha=.18)
    ax[3].set_xticks(range(1, max(len(r['attemptInventory']) for r in runs)+1))
    save(fig, '06-controls-attempts', 'Controls, failures and attempt history')

    fig, ax = figure('07 / Native state and token diagnostics', 'Lloyal-only observability. There is no inferred HTTP entropy, physical-context series or branch lifecycle.')
    n = runs[0]['nativeState']
    pts = [p for p in downsample(n['context']) if number(p['cellsUsed'])]
    if pts:
        ax[0].plot([p['atMs']/1000 for p in pts], [p['cellsUsed'] for p in pts], color=COLORS[0])
        if number(pts[0]['nCtx']):
            ax[0].axhline(pts[0]['nCtx'], ls='--', color='#9a6671', label='configured context cells'); ax[0].legend(fontsize=8, frameon=False)
    ax[0].set_title('Reported context occupancy', loc='left', fontsize=12, weight='bold'); ax[0].set_ylabel('cells'); ax[0].set_xlabel('seconds since submit')
    for kind, style in [('branch:create', '-'), ('branch:prune', '--')]:
        vals = [t for t in n['branches'] if t['type'] == kind]
        ax[1].step([t['atMs']/1000 for t in vals], list(range(1, len(vals)+1)), where='post', label=kind, ls=style)
    ax[1].set_title('Recorded lifecycle events (not live branch count)', loc='left', fontsize=12, weight='bold'); ax[1].set_ylabel('cumulative events'); ax[1].set_xlabel('seconds since submit'); ax[1].legend(fontsize=8, frameon=False)
    roles = n['prefillCellsByRole']
    ax[2].bar([wrapped(k, 16) for k in roles], list(roles.values()), color=COLORS[0]); ax[2].set_ylabel('sum of recorded prefill cells')
    ax[2].set_title('Trace-prefill roles; excludes uninstrumented work', loc='left', fontsize=12, weight='bold')
    for key, color in [('entropy', '#176b87'), ('surprisal', '#8861a3')]:
        buckets = defaultdict(list)
        for p in n['epistemics']:
            if number(p.get(key)):
                buckets[int(p['atMs']/1000)].append(p[key])
        ax[3].plot(sorted(buckets), [statistics.median(buckets[k]) for k in sorted(buckets)], color=color, label=key, lw=.9)
    ax[3].set_title('Token diagnostics · 1-second bin medians', loc='left', fontsize=12, weight='bold')
    ax[3].set_xlabel('seconds since submit'); ax[3].set_ylabel('recorded values'); ax[3].legend(fontsize=8, frameon=False)
    save(fig, '07-native-state', 'Native state and token diagnostics')

    fig, ax = figure('08 / Evidence, ranking scores and citations', 'Independent score scales. Image submission/prefill receipts and citation syntax do not establish answer quality.')
    for i, r in enumerate(runs):
        scores = [x['score'] for rank in r['retrieval']['rankings'] for x in rank.get('topResults', []) if number(x.get('score'))]
        if scores:
            ax[i].hist(scores, bins=min(18, max(3, len(scores)//3)), color=COLORS[i], alpha=.85)
        else:
            empty(ax[i], 'No ranking scores recorded.')
        ax[i].set_title(SHORT[i]+' · recorded top-result scores', loc='left', fontsize=12, weight='bold'); ax[i].set_xlabel('backend score (scales are not equivalent)'); ax[i].set_ylabel('score observations')
    schemes = sorted(set().union(*(r['media']['citationOccurrencesByScheme'] for r in runs)))
    grouped(ax[2], schemes, [[r['media']['citationOccurrencesByScheme'].get(k, 0) for k in schemes] for r in runs], 'Final answer citation occurrences', 'Markdown links, not verified claims', 0)
    m = runs[1]['media']; np = runs[0]['media']['nativePrefillAttachmentEvents'] or []
    lines = [f"Lloyal: {len(np)} trace-prefill event(s) with attachment metadata",
             f"HTTP: {m['httpImageSubmissionCount']} recorded image submissions",
             f"HTTP: {m['httpUniqueSubmittedImages']} distinct submitted image digests",
             '', 'Descriptors, hashes and per-query rankings are in comparison.json.',
             'These counters observe different boundaries; no image-work ratio.',
             '', 'Grounding, correctness and citation usability require report review.',
             'No automatic semantic-quality score is assigned.']
    ax[3].axis('off'); ax[3].text(0, .97, '\n\n'.join(lines), va='top', fontsize=10, transform=ax[3].transAxes)
    save(fig, '08-evidence', 'Evidence, ranking scores and citations')

    fig, ax = figure('09 / HTTP server prompt and decode accounting', 'Read from exact per-request SSE receipts. Service-time sums overlap across requests and are not wall time.')
    timed = [q for q in runs[1]['http']['requests'] if q['status'] == 'completed' and q.get('rawReceipt', {}).get('serverTimings')]
    if timed:
        fields = [[q['rawReceipt']['serverTimings'][k] for q in timed if number(q['rawReceipt']['serverTimings'].get(k))]
                  for k in ['prompt_ms', 'predicted_ms']]
        totals = [sum(v)/1000 if v else None for v in fields]
        maximum = max([v for v in totals if number(v)] + [1])
        for i, (v, color) in enumerate(zip(totals, ['#98bdca', COLORS[1]])):
            if number(v):
                ax[0].bar(i, v, color=color)
                ax[0].text(i, v+maximum*.025, f'{v:,.1f} s', ha='center')
            else:
                ax[0].text(i, maximum*.025, 'N/A', ha='center')
        ax[0].set_xticks([0, 1], [f'{name}\n{len(v)} receipts' for name, v in zip(['Prompt evaluation', 'Token generation'], fields)])
        ax[0].set_xlim(-.65, 1.65)
        ax[0].set_ylim(0, maximum*1.18); ax[0].set_ylabel('sum of per-request service seconds')
        ax[0].set_title(f'Server accounting · {len(timed)} reporting requests', loc='left', fontsize=12, weight='bold')
        for k, name, color in [('prompt_ms', 'prompt', '#176b87'), ('predicted_ms', 'generation', COLORS[1])]:
            rr = [q for q in timed if number(q['rawReceipt']['serverTimings'].get(k))]
            ax[1].scatter([q['atMs']/1000 for q in rr], [q['rawReceipt']['serverTimings'][k]/1000 for q in rr], color=color, label=name, s=22)
        ax[1].set_title('Request service-time breakdown', loc='left', fontsize=12, weight='bold')
        ax[1].set_xlabel('seconds since submit'); ax[1].set_ylabel('server-reported seconds'); ax[1].legend(frameon=False, fontsize=8)
        rr = [q['rawReceipt']['serverTimings'] for q in timed]
        rr = [t for t in rr if all(number(t.get(k)) for k in ['prompt_n', 'cache_n', 'predicted_per_second'])]
        ax[2].scatter([t['prompt_n']+t['cache_n'] for t in rr], [t['predicted_per_second'] for t in rr], color=COLORS[1], alpha=.7, s=26)
        ax[2].set_title('Reported generation rate per request', loc='left', fontsize=12, weight='bold')
        ax[2].set_xlabel('server prompt_n + cache_n'); ax[2].set_ylabel('server predicted tokens / second'); ax[2].grid(alpha=.18)
        ax[3].axis('off')
        sample = next((q for q in timed if q['atMs'] >= runs[1]['phaseReceipts'].get('synthesize:start', {}).get('atMs', float('inf'))), None)
        lines = ['Native has no equivalent server timing receipt.', 'Its stage/stream timings are on sheets 01–02.', 'Do not substitute stage duration for pure decode time.', 'Missing/failed SSE accounting is retained as unavailable.']
        if sample:
            t = sample['rawReceipt']['serverTimings']
            def duration(value):
                return f'{value/1000:.3f} s' if number(value) else 'N/A'
            lines = ['HTTP synthesis request:', f"Prompt evaluation: {duration(t.get('prompt_ms'))}", f"Token generation: {duration(t.get('predicted_ms'))}", f"HTTP request duration: {duration(sample['durationMs'])}", ''] + lines
        ax[3].text(0, .97, '\n\n'.join(lines), transform=ax[3].transAxes, va='top', fontsize=10)
    else:
        for a in ax: empty(a, 'No server timings found in the selected raw SSE receipts.')
    save(fig, '09-server-accounting', 'HTTP server prompt and decode accounting')
    return figures


def write_html(data, figures, output):
    esc = html.escape
    sections = '\n'.join(f'<section><h2>{esc(f["title"])}</h2><a href="{f["file"]}.svg">SVG</a> · <a href="{f["file"]}.png">PNG</a><img loading="lazy" src="{f["file"]}.png" alt="{esc(f["title"])}"></section>' for f in figures)
    source_html = []
    for r in data['runs']:
        path = Path(r['session'])
        files = ['observations.jsonl', 'manifest.json', 'identity.json'] + (['fieldnote.log'] if r['backend'] == 'fieldnote' else ['llama-server.log', 'reranker.log', 'http', 'reranker-requests'])
        review_files = sorted(path.glob('*review.json'))
        links = ''.join(f'<li><a href="{esc((path/f).as_uri())}">{esc(f)}</a></li>' for f in files if (path/f).exists())
        reviews = ''.join(f'<li><a href="{esc(p.as_uri())}">{esc(p.name)}</a></li>' for p in review_files)
        source_html.append(f'<h3>{esc(r["label"])} · attempt {r["selection"]["attempt"]}</h3><p><code>{esc(str(path))}</code></p><ul>{links}</ul><details><summary>Separate human/model-authored review notes</summary><ul>{reviews}</ul></details>')
    metrics = [('Research (s)', lambda r: seconds(r['timing']['researchMs'])),
               ('Synthesis (s)', lambda r: seconds(r['timing']['synthesisMs'])),
               ('Research → complete (s)', lambda r: seconds(r['timing']['researchToCompleteMs'])),
               ('Inquiry tokens', lambda r: r['generation']['inquiryTokens']),
               ('Synthesis tokens incl. reasoning', lambda r: r['generation']['synthesisTokensIncludingReasoning']),
               ('Visible report words (approx.)', lambda r: r['generation']['visibleWordsApprox']),
               ('Research tool calls', lambda r: r['tools']['researchCallsReported']),
               ('Tool-result errors (entire attempt)', lambda r: len(r['tools']['errorResults'])),
               ('Recovered agents (entire attempt)', lambda r: r['recoveredAgents'])]
    table = ''.join('<tr><th>'+esc(label)+'</th>'+''.join('<td>'+('N/A' if not number(v:=fn(r)) else f'{v:,.1f}')+'</td>' for r in data['runs'])+'</tr>' for label, fn in metrics)
    notes = ''.join('<li>'+esc(n)+'</li>' for n in data['methodology'])
    page = f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fieldnote raw-log comparison</title>
<style>body{{font:16px/1.55 system-ui,sans-serif;color:#182b3a;background:#f4f7f9;max-width:1200px;margin:40px auto;padding:0 24px}}h1{{font-size:38px;line-height:1.15}}h2{{margin:0 0 8px}}section,article{{background:white;border:1px solid #dce4e9;border-radius:12px;padding:24px;margin:24px 0}}img{{display:block;width:100%;height:auto;margin-top:15px}}a{{color:#176b87}}code{{overflow-wrap:anywhere;font-size:13px}}table{{border-collapse:collapse;width:100%}}th,td{{text-align:left;padding:9px;border-bottom:1px solid #e0e7eb}}td{{font-variant-numeric:tabular-nums}}summary{{cursor:pointer}}.muted{{color:#596e7d}}</style>
<h1>Fieldnote · raw-log comparison</h1><p class="muted">Generated offline from raw journals. No model inference, no hidden selection of successful attempts.</p>
<p><a href="comparison.json">Full derived JSON and provenance</a> · <a href="reproduce.txt">Reproduction command</a></p>
<article><h2>Selected observations</h2><table><tr><th>Metric</th><th>Lloyal</th><th>LangGraph + llama-server</th></tr>{table}</table></article>
<article><h2>Scope and interpretation</h2><ul>{notes}</ul><p>Unavailable: energy, comparable total GPU memory, HTTP entropy, repeated-run uncertainty, automated semantic-quality grading.</p></article>
{sections}<article><h2>Raw evidence</h2>{''.join(source_html)}</article></html>'''
    (output / 'index.html').write_text(page)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--native', type=Path, required=True)
    parser.add_argument('--http', type=Path, required=True)
    parser.add_argument('--native-attempt', type=int)
    parser.add_argument('--http-attempt', type=int)
    parser.add_argument('--output', type=Path, default=Path('comparisons/raw-log-comparison'))
    parser.add_argument('--list-attempts', action='store_true', help='Show all attempts; do not generate outputs.')
    parser.add_argument('--json-only', action='store_true', help='Derive metrics without requiring Matplotlib.')
    args = parser.parse_args()
    sessions = [read_session(args.native), read_session(args.http)]
    if args.list_attempts:
        for s in sessions:
            print(s['path'])
            print(json.dumps([brief_attempt(r, i) for i, r in enumerate(s['attempts'], 1)], indent=2))
        return
    if args.native_attempt is None or args.http_attempt is None:
        parser.error('Choose --native-attempt and --http-attempt explicitly (1-based); use --list-attempts first.')
    if [s['manifest']['backend'] for s in sessions] != ['fieldnote', 'langgraph']:
        parser.error('--native must be a fieldnote session and --http a langgraph session.')
    output = args.output.resolve()
    for s in sessions:
        if output == Path(s['path']) or Path(s['path']) in output.parents:
            parser.error('Output must be outside raw session directories.')
    output.mkdir(parents=True, exist_ok=True)
    runs = [summarize(s, index) for s, index in zip(sessions, [args.native_attempt, args.http_attempt])]
    if any(r['manifest'].get('test') for r in runs):
        parser.error('Test/mock sessions are not inference measurements.')
    data = {'version': 1, 'generatedAt': datetime.now(timezone.utc).isoformat(), 'comparisonEligible': False,
            'methodology': NOTES, 'runs': runs,
            'script': {'path': str(Path(__file__).resolve()), 'python': sys.version}}
    (output / 'comparison.json').write_text(json.dumps(data, indent=2, ensure_ascii=False, allow_nan=False)+'\n')
    import shlex
    command = shlex.join([sys.executable, str(Path(__file__).resolve()), '--native', runs[0]['session'],
        '--native-attempt', str(args.native_attempt), '--http', runs[1]['session'], '--http-attempt', str(args.http_attempt), '--output', str(output)])
    (output / 'reproduce.txt').write_text(command+'\n')
    figures = []
    if not args.json_only:
        try:
            figures = charts(data, output)
        except ModuleNotFoundError as exc:
            if exc.name != 'matplotlib':
                raise
            raise SystemExit('Metrics saved. Install plotting dependencies: python -m pip install -r scripts/requirements-plots.txt') from exc
        write_html(data, figures, output)
    print(json.dumps({'output': str(output), 'charts': len(figures), 'selected': [r['selection'] for r in runs]}, indent=2))


if __name__ == '__main__':
    main()
