"""Derive observations from raw journals. No inference runtime or saved summaries used."""
from __future__ import annotations

import hashlib
import json
import math
import re
from collections import Counter, defaultdict, deque
from pathlib import Path


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def parsed(value):
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (ValueError, TypeError):
            return value
    return value


def normalize(row):
    row = dict(row)
    row['kind'], row['value'] = 'observation', row.get('data', {})
    if row['type'] == 'wire.event':
        row['kind'] = 'event'
    elif row['type'] == 'browser.command':
        row['kind'] = 'command'
    elif row['type'] in ('wire.native.raw', 'wire.command.raw'):
        frame = json.loads(row['data']['raw']).get('frame', {})
        if frame.get('t') in ('event', 'command'):
            row['kind'], row['value'] = frame['t'], frame['payload']
    return row


def read_session(path):
    path = Path(path).resolve()
    raw = (path / 'observations.jsonl').read_bytes()
    rows, warnings, consumed = [], [], 0
    lines = raw.splitlines(keepends=True)
    for i, line in enumerate(lines):
        try:
            if line.strip():
                rows.append(normalize(json.loads(line)))
        except (ValueError, KeyError) as exc:
            if i == len(lines) - 1 and not line.endswith(b'\n'):
                warnings.append('Ignored incomplete final journal line; earlier malformed lines are fatal.')
                break
            raise ValueError(f'{path}/observations.jsonl line {i+1}: {exc}') from exc
        consumed += len(line)
    manifest = json.loads((path / 'manifest.json').read_text())
    attempts, current = [], None
    for row in rows:
        if row['kind'] == 'command' and row['value'].get('type') == 'submit_query':
            if current:
                attempts.append(current)
            current = []
        if current is not None:
            current.append(row)
    if current:
        attempts.append(current)
    return {'path': str(path), 'rows': rows, 'attempts': attempts, 'manifest': manifest,
            'warnings': warnings, 'snapshot': {'bytes': consumed, 'rows': len(rows),
                'sha256': hashlib.sha256(raw[:consumed]).hexdigest(),
                'lastSeq': rows[-1]['seq'] if rows else None}}


def event_rows(rows, name=None):
    return [r for r in rows if r['kind'] == 'event' and
            (name is None or r['value'].get('type') == name)]


def http_receipt(path):
    """Read stock-server accounting from the exact SSE file, not estimated wall time."""
    path = Path(path)
    if not path.exists():
        return {'available': False, 'serverTimings': None}
    raw = path.read_bytes()
    timings, done, finish, bad = None, False, None, 0
    for line in raw.decode('utf-8', errors='replace').splitlines():
        if not line.startswith('data:'):
            continue
        payload = line[5:].strip()
        if payload == '[DONE]':
            done = True
            continue
        try:
            item = json.loads(payload)
        except ValueError:
            bad += 1
            continue
        if isinstance(item.get('timings'), dict):
            timings = item['timings']
        for choice in item.get('choices', []):
            finish = choice.get('finish_reason') or finish
    return {'available': True, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
            'serverTimings': timings, 'sseDone': done, 'finishReason': finish, 'malformedDataLines': bad}


def first(rows, name):
    return next(iter(event_rows(rows, name)), None)


def brief_attempt(rows, index):
    terminal = next((r for r in event_rows(rows) if r['value'].get('type') in ('complete', 'run:aborted')), None)
    end = terminal['t_ms'] if terminal else rows[-1]['t_ms']
    answer = [r['value'].get('text') for r in event_rows(rows, 'answer') if r['t_ms'] <= end]
    query = first(rows, 'query')
    return {'attempt': index, 'startSeq': rows[0]['seq'], 'endSeq': terminal['seq'] if terminal else None,
            'startMs': rows[0]['t_ms'], 'endMs': end,
            'elapsedMs': end - rows[0]['t_ms'] if terminal else None,
            'observedMs': end - rows[0]['t_ms'],
            'status': ('aborted' if terminal['value']['type'] == 'run:aborted' else
                       'completed-with-answer' if answer and answer[-1] else 'completed-without-answer')
                      if terminal else 'incomplete',
            'docId': query['value'].get('docId') if query else None,
            'question': rows[0]['value'].get('query'),
            'mode': rows[0]['value'].get('mode'),
            'effort': query['value'].get('effort') if query else None,
            'followup': query['value'].get('warm') if query else None}


CONTROL_TYPES = {'pause', 'resume', 'cancel_agent', 'wrap_up', 'stop', 'new_run'}


def controls(rows, start, end):
    commands = [{'seq': r['seq'], 'atMs': r['t_ms'] - start, **r['value']}
                for r in rows if r['kind'] == 'command' and r['value'].get('type') in CONTROL_TYPES
                and r['t_ms'] <= end]
    held, intervals = None, []
    for r in event_rows(rows):
        if r['t_ms'] > end:
            break
        typ = r['value'].get('type')
        if typ == 'run:paused' and held is None:
            held = r
        if typ == 'run:resumed' and held is not None:
            intervals.append({'startMs': held['t_ms'], 'endMs': r['t_ms'],
                              'pauseSeq': held['seq'], 'resumeSeq': r['seq']})
            held = None
    if held:
        intervals.append({'startMs': held['t_ms'], 'endMs': end, 'pauseSeq': held['seq'], 'resumeSeq': None})
    for interval in intervals:
        during = [r for r in rows if interval['startMs'] < r['t_ms'] < interval['endMs']]
        interval['durationMs'] = interval['endMs'] - interval['startMs']
        interval['generationEvents'] = sum(r['kind'] == 'event' and r['value'].get('type') in
            ('agent:produce', 'agent:reasoning_delta', 'agent:text_delta', 'agent:report_delta') for r in during)
        interval['httpCompletions'] = sum(r['type'] == 'http.response' for r in during)
    return {'commands': commands, 'counts': dict(Counter(c['type'] for c in commands)),
            'holds': intervals, 'acknowledgedHoldMs': sum(i['durationMs'] for i in intervals)}


def summarize(session, index):
    if not 1 <= index <= len(session['attempts']):
        raise ValueError(f"{session['path']} has {len(session['attempts'])} attempts, not {index}")
    all_rows = session['attempts'][index - 1]
    info = brief_attempt(all_rows, index)
    start, end = info['startMs'], info['endMs']
    rows = [r for r in all_rows if r['t_ms'] <= end]
    events = event_rows(rows)
    warnings = list(session['warnings'])
    backend = session['manifest']['backend']
    native = backend == 'fieldnote'
    research = first(rows, 'research:start')
    research_done = first(rows, 'research:done')
    synth = first(rows, 'synthesize:start')
    synth_done = first(rows, 'synthesize:done')
    preflight = first(rows, 'preflight:done')
    plan = first(rows, 'plan')
    review = first(rows, 'ui:plan_review') or plan
    completion = first(rows, 'complete')
    rstart = research['t_ms'] if research else None
    rend = research_done['t_ms'] if research_done else end

    def phase(row, name):
        return row['value'].get(name) if row and number(row['value'].get(name)) else None

    gen_types = ('agent:produce', 'agent:reasoning_delta', 'agent:text_delta', 'agent:report_delta')
    inquiry_events = [r for r in events if rstart is not None and rstart <= r['t_ms'] <= rend]
    first_gen = next((r for r in inquiry_events if r['value'].get('type') in gen_types
                      and r['value'].get('text')), None)
    first_finding = next((r for r in inquiry_events if r['value'].get('type') in
                         ('agent:return', 'agent:recovered') and r['value'].get('result')), None)
    timing = {'preflightMs': phase(preflight, 'timeMs'), 'plannerMs': phase(plan, 'timeMs'),
              'reviewMs': rstart - review['t_ms'] if research and review else None,
              'researchMs': phase(research_done, 'timeMs'), 'synthesisMs': phase(synth_done, 'timeMs'),
              'researchToCompleteMs': completion['t_ms'] - rstart if completion and research else None,
              'firstGenerationAfterResearchMs': first_gen['t_ms'] - rstart if first_gen else None,
              'firstFindingAfterResearchMs': first_finding['t_ms'] - rstart if first_finding else None,
              'queryToCompleteMs': info['elapsedMs'] if completion else None,
              'preflightStatus': 'executed' if preflight else 'not executed in this attempt; possible coverage reuse'}

    # Native trace records are canonical; mirrored presentation prefills are not counted twice.
    traces, seen = [], set()
    for r in event_rows(rows, 'agent:trace'):
        ev = r['value']['event']
        key = ev.get('traceId', r['seq'])
        if key not in seen:
            traces.append({'seq': r['seq'], 'atMs': r['t_ms'] - start, **ev})
            seen.add(key)
    answer_events = event_rows(rows, 'answer')
    answer = (answer_events[-1]['value'].get('text') or '') if answer_events else ''
    visible = re.sub(r'\[([^\]]+)\]\([^)]*\)', r'\1', answer)
    visible = re.sub(r'[#*_`]', '', visible)
    syn_id = synth_done['value'].get('agentId') if synth_done else None
    if syn_id is None and synth:
        spawn = next((r for r in events if r['t_ms'] >= synth['t_ms'] and r['value'].get('type') == 'agent:spawn'), None)
        syn_id = spawn['value'].get('agentId') if spawn else None
    generation = {'preflightTokens': phase(preflight, 'tokens'),
                  'inquiryTokens': phase(research_done, 'totalTokens'),
                  'synthesisTokensIncludingReasoning': phase(synth_done, 'tokenCount'),
                  'answerChars': len(answer), 'visibleWordsApprox': len(visible.split()),
                  'reasoningChars': None, 'reasoningTokenCount': None,
                  'synthesisStream': [], 'wordCountMethod': 'Whitespace words after removing Markdown link destinations and formatting; includes headings and source labels.'}
    if native and syn_id is not None:
        raw_outputs = [t.get('rawOutput', '') for t in traces if t['type'] == 'agent:turn' and t.get('agentId') == syn_id]
        if raw_outputs and all('</think>' in t for t in raw_outputs):
            generation['reasoningChars'] = sum(len(t.split('</think>', 1)[0]) for t in raw_outputs)
    elif syn_id is not None:
        generation['reasoningChars'] = sum(len(r['value'].get('text', '')) for r in
            event_rows(rows, 'agent:reasoning_delta') if r['value'].get('agentId') == syn_id)
    cum = defaultdict(int)
    if synth:
        for r in events:
            v = r['value']
            if r['t_ms'] < synth['t_ms'] or v.get('agentId') != syn_id:
                continue
            channel = {'agent:produce': 'all emitted text (includes reasoning)',
                       'agent:reasoning_delta': 'reasoning', 'agent:text_delta': 'answer'}.get(v.get('type'))
            if channel and v.get('text'):
                cum[channel] += len(v['text'])
                generation['synthesisStream'].append({'atMs': r['t_ms'] - synth['t_ms'], 'channel': channel, 'chars': cum[channel]})

    # Match normal HTTP tool calls by callId. Native durations use canonical trace dispatch/result pairs.
    calls = event_rows(rows, 'agent:tool_call')
    results = event_rows(rows, 'agent:tool_result')
    tool_durations, unmatched = [], 0
    if native:
        dispatch = {t['traceId']: t for t in traces if t['type'] == 'tool:dispatch'}
        for t in traces:
            if t['type'] == 'tool:result' and number(t.get('durationMs')):
                parent = dispatch.get(t.get('parentTraceId'), {})
                tool_durations.append({'seq': t['seq'], 'tool': t.get('tool'), 'agentId': t.get('agentId'),
                    'callId': parent.get('callId'), 'durationMs': t['durationMs'], 'clock': 'native tool trace duration'})
    else:
        pending = defaultdict(deque)
        for r in events:
            v = r['value']; key = (v.get('agentId'), v.get('tool'), v.get('callId'))
            if v.get('type') == 'agent:tool_call':
                pending[key].append(r)
            elif v.get('type') == 'agent:tool_result':
                if pending[key]:
                    call = pending[key].popleft()
                    tool_durations.append({'seq': r['seq'], 'tool': v.get('tool'), 'agentId': v.get('agentId'),
                        'callId': v.get('callId'), 'durationMs': r['t_ms'] - call['t_ms'], 'clock': 'host call/result receipt interval'})
                else:
                    unmatched += 1
    tools = {'calls': len(calls), 'researchCallsReported': phase(research_done, 'totalToolCalls'),
             'byTool': dict(Counter(r['value']['tool'] for r in calls)),
             'researchByTool': dict(Counter(r['value']['tool'] for r in calls if research and rstart <= r['t_ms'] <= rend)),
             'results': len(results), 'durations': tool_durations, 'unmatchedResults': unmatched,
             'errorResults': [{'seq': r['seq'], 'tool': r['value'].get('tool'), 'result': parsed(r['value'].get('result'))}
                 for r in results if isinstance(parsed(r['value'].get('result')), dict) and parsed(r['value']['result']).get('error')]}
    rankings = []
    if native:
        rankings = [t for t in traces if t['type'] == 'rerank:end']
    else:
        rankings = [{'seq': r['seq'], 'atMs': r['t_ms'] - start, 'agentId': r['value'].get('agentId'),
                     'tool': r['value'].get('tool'), **r['value']['ranking']} for r in event_rows(rows, 'agent:ranking')]
    retrieval = {'rankings': rankings, 'operations': len(rankings),
                 'candidatesScored': sum(t.get('totalScored', 0) for t in rankings) if rankings else None,
                 'admittedTokens': sum(t.get('admittedTokens', 0) for t in rankings) if rankings else None,
                 'selectedPassages': sum(t.get('selectedPassageCount', 0) for t in rankings) if rankings else None,
                 'note': 'Rank score scales and query sets differ; scores are not cross-backend quality scores.'}

    requests = [r for r in rows if r['type'] == 'http.request']
    responses = {r['data']['requestId']: r for r in rows if r['type'] == 'http.response'}
    failures = {r['data']['requestId']: r for r in rows if r['type'] == 'http.failure'}
    request_records = []
    for req in requests:
        d = req['data']; resp = responses.get(d['requestId']); fail = failures.get(d['requestId'])
        terminal = resp or fail
        usage = resp['data'].get('usage', {}) if resp else {}
        request_records.append({'seq': req['seq'], **d, 'atMs': req['t_ms'] - start,
            'durationMs': terminal['data'].get('durationMs') if terminal else None,
            'status': 'completed' if resp else 'failed' if fail else 'unfinished', 'usage': usage,
            'error': fail['data'].get('error') if fail else None,
            'requestFile': str(Path(session['path']) / 'http' / (d['requestId'] + '.request.json')),
            'responseFile': str(Path(session['path']) / 'http' / (d['requestId'] + '.response.txt'))})
        request_records[-1]['rawReceipt'] = http_receipt(request_records[-1]['responseFile'])
    def usage_sum(keys):
        vals = []
        for r in request_records:
            v = r['usage']
            for key in keys:
                v = v.get(key) if isinstance(v, dict) else None
            if number(v):
                vals.append(v)
        return {'total': sum(vals) if vals else None, 'responsesReporting': len(vals)}
    http = {'available': not native, 'requests': request_records,
            'statuses': dict(Counter(r['status'] for r in request_records)),
            'requestBodyBytes': sum(r.get('wireBytes', 0) for r in request_records) if not native else None,
            'promptTokens': usage_sum(['input_tokens']), 'outputTokens': usage_sum(['output_tokens']),
            'cachedPromptTokens': usage_sum(['input_token_details', 'cache_read']),
            'rerankerRequests': [r['data'] for r in rows if r['type'] == 'reranker.request'],
            'rerankerResponses': [r['data'] for r in rows if r['type'] == 'reranker.response'],
            'note': 'Absent native HTTP counters are unavailable, not zero native work. Partial streams can lack usage. Native KV cells are a different measure.'}

    labels = {r['data']['pid']: r['data'].get('label', 'service') for r in session['rows']
              if r['type'] == 'backend.start' and 'pid' in r['data']}
    resources = defaultdict(list)
    for r in rows:
        if r['type'] == 'resource.sample':
            for p in r['data'].get('processes', []):
                resources[str(p['pid'])].append({'atMs': r['t_ms'] - start, **p})
    process_records = [{'pid': int(pid), 'label': labels.get(int(pid), 'benchmark host'), 'samples': vals,
                        'peakRssBytes': max(v['rssBytes'] for v in vals), 'peakPsCpuPct': max(v['cpuPct'] for v in vals)}
                       for pid, vals in resources.items()]
    host_resources = [{'atMs': r['t_ms'] - start, **r['value']} for r in event_rows(rows, 'host:resources')]

    prefills = [t for t in traces if t['type'] == 'branch:prefill']
    branches = [t for t in traces if t['type'] in ('branch:create', 'branch:prune')]
    pressure = [{'seq': r['seq'], 'atMs': r['t_ms'] - start, 'cellsUsed': r['value'].get('cellsUsed'),
                 'nCtx': r['value'].get('nCtx')} for r in event_rows(rows, 'agent:tick')]
    epistemics = [{'seq': r['seq'], 'atMs': r['t_ms'] - start, 'agentId': r['value'].get('agentId'),
                   'entropy': r['value'].get('entropy'), 'surprisal': r['value'].get('surprisal')}
                  for r in event_rows(rows, 'agent:produce') if number(r['value'].get('entropy'))]
    native_state = {'available': native, 'prefills': prefills, 'branches': branches, 'context': pressure,
                    'epistemics': epistemics, 'synthesisPerplexity': phase(synth_done, 'ppl'),
                    'prefillCellsByRole': dict(Counter()),
                    'note': 'Recorded trace prefills only, not a complete native compute-work counter. Branch events are not a physical-memory census.'}
    for t in prefills:
        key = t.get('role', 'unknown')
        native_state['prefillCellsByRole'][key] = native_state['prefillCellsByRole'].get(key, 0) + t.get('cells', 0)

    receipts = [r['data'] for r in rows if r['type'] == 'evidence.receipt']
    image_submissions = [r for r in receipts if r.get('kind') == 'image' and r.get('status') == 'submitted']
    image_prefills = [{'seq': t['seq'], 'attachments': t['attachments']} for t in prefills if t.get('attachments')]
    citations = re.findall(r'\[[^\]]+\]\(([^)]*)\)', answer)
    citation_types = Counter(u.split(':', 1)[0] if ':' in u else 'relative' for u in citations)
    media = {'originalAttachments': (first(rows, 'query') or {'value': {}})['value'].get('attachments', []),
             'selectedImageDigests': sorted({r['digest'] for r in receipts if r.get('kind') == 'image' and 'digest' in r}),
             'httpImageSubmissionCount': len(image_submissions) if not native else None,
             'httpUniqueSubmittedImages': len({r['digest'] for r in image_submissions}) if not native else None,
             'nativePrefillAttachmentEvents': image_prefills if native else None,
             'receipts': receipts, 'citationOccurrencesByScheme': dict(citation_types),
             'note': 'HTTP image submission is not confirmed prefill. Citation syntax/count is not grounding or link validation. Semantic quality remains a separate review.'}

    browser = []
    for r in rows:
        if r['type'] == 'browser.observation':
            browser.extend({'receiptSeq': r['seq'], **o} for o in (r['data'] if isinstance(r['data'], list) else [r['data']]))
    times = [o['at'] for o in browser if number(o.get('at'))]
    clock_reset = any(b < a for a, b in zip(times, times[1:]))
    bstart = next((o for o in browser if o.get('kind') == 'paint-observation' and o.get('type') == 'research:start'), None)
    prose = [o for o in browser if o.get('kind') == 'prose-render' and any(p.get('chars', 0) > 0 for p in o.get('prose', []))]
    first_prose = next((o for o in prose if bstart and o['at'] >= bstart['at']), None)
    browser_stats = {'observations': browser, 'clockResetDetected': clock_reset,
                     'firstProseAfterResearchPaintMs': first_prose['at'] - bstart['at'] if first_prose and not clock_reset else None,
                     'note': 'Browser performance clock only; not subtracted from host clock. Rendering is not proof of reading, correctness or complete citations.'}
    if clock_reset:
        warnings.append('Browser clock decreased; browser latency comparison suppressed.')
    error_records = [{'seq': r['seq'], 'atMs': r['t_ms'] - start, 'type': r['type'], 'data': r['value'],
                      'afterTerminal': r['t_ms'] > end} for r in all_rows if r['type'] in ('http.failure', 'journey.failure')
                     or (r['kind'] == 'event' and r['value'].get('type') in ('agent:failed', 'ui:error'))]
    recovery_ids = {r['value']['agentId'] for r in event_rows(rows, 'agent:recovered')}
    inventory = []
    for i, attempt in enumerate(session['attempts'], 1):
        brief = brief_attempt(attempt, i)
        brief['controls'] = controls(attempt, brief['startMs'], brief['endMs'])
        brief['selected'] = i == index
        inventory.append(brief)
    return {'backend': backend, 'label': 'Lloyal' if native else 'LangGraph + llama-server',
            'session': session['path'], 'rawJournal': str(Path(session['path']) / 'observations.jsonl'),
            'snapshot': session['snapshot'], 'manifest': session['manifest'], 'selection': info,
            'attemptInventory': inventory, 'timing': timing, 'generation': generation,
            'tools': tools, 'retrieval': retrieval, 'http': http,
            'resources': {'processes': process_records, 'nativeHostSamples': host_resources,
                          'note': 'ps %CPU is a process statistic, not instantaneous GPU utilization. RSS is not unique physical or GPU memory; never sum it into a laptop total. No energy measurement.'},
            'nativeState': native_state, 'media': media, 'browser': browser_stats,
            'controls': controls(rows, start, end), 'errors': error_records,
            'recoveredAgents': len(recovery_ids), 'warnings': warnings,
            'phaseReceipts': {name: {'seq': r['seq'], 'atMs': r['t_ms'] - start} for name in
                ('preflight:start', 'preflight:done', 'plan:start', 'plan', 'ui:plan_review', 'research:start',
                 'research:done', 'synthesize:start', 'synthesize:done', 'answer', 'complete') if (r := first(rows, name))},
            'answer': answer}
