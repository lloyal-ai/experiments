"""Export a small, auditable README dataset. Reads logs; never starts inference."""
from pathlib import Path
import argparse
import hashlib
import json
import math
import sys

OUT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument('--evidence', type=Path, required=True)
parser.add_argument('--benchmark', type=Path, required=True)
args = parser.parse_args()
sys.path.insert(0, str(args.benchmark / 'scripts'))
from raw_log_metrics import read_session, event_rows, first

sha = lambda data: hashlib.sha256(data).hexdigest()
source = json.loads(args.evidence.read_text())
result = {
    'date': '2026-10-09',
    'status': 'Exploratory selected observations; not a causal or quality-equivalence result.',
    'sourceAuditSha256': sha(args.evidence.read_bytes()),
    'extractionCodeSha256': sha((args.benchmark/'scripts/raw_log_metrics.py').read_bytes()),
    'setup': {'machine': 'Apple M2 Pro, 16 GB', 'accelerator': 'Metal on both backends',
              'model': 'qwen3.5-4b.gguf', 'projector': 'qwen3.5-4b-mmproj.gguf',
              'reranker': 'qwen3-reranker-0.6b-q8.gguf', 'nativeDevTracing': True,
              'sharedFrontend': True, 'sameSynthesisSystemWithinPairs': True,
              'samplerParityEstablished': False},
    'plannedControl': {'name': 'LangGraph + HTTP + prefix caching + shared prefix',
                       'status': 'Not measured', 'values': None},
    'pairs': [],
}
result['setup']['fileSha256']={k:source['pairs'][0]['audit']['identity']['files'][k]['sha256'] for k in ['model','projector','reranker']}
for pair in source['pairs']:
    out = {'label': pair['label'], 'condition': {'A':'Original', 'B':'Repeat', 'C':'Revised'}[pair['label']],
           'comparison': f"comparisons/{pair['folder']}/comparison.json",
           'comparisonSha256': pair['comparisonSha256'], 'runs': []}
    for r in pair['runs']:
        session_dir = args.benchmark/'sessions'/Path(r['session']).name
        session = read_session(session_dir)
        rows = session['attempts'][r['attempt']-1]
        terminal = next(x for x in event_rows(rows) if x['value']['type'] in ('complete','run:aborted'))
        assert terminal['value']['type'] == 'complete'
        rows = [x for x in rows if x['t_ms'] <= terminal['t_ms']]
        start = first(rows, 'research:start')
        done = first(rows, 'research:done')
        finding = next(x for x in event_rows(rows) if start['t_ms'] <= x['t_ms'] <= done['t_ms']
                       and x['value']['type'] in ('agent:return','agent:recovered') and x['value'].get('result'))
        latency = finding['t_ms'] - start['t_ms']
        assert math.isclose(latency, r['timing']['firstFindingAfterResearchMs'], abs_tol=.001)
        synth_start, synth_done = first(rows,'synthesize:start'), first(rows,'synthesize:done')
        synth_ms = synth_done['value']['timeMs']
        assert math.isclose(synth_ms, r['timing']['synthesisMs'], abs_tol=.001)
        out['runs'].append({
            'backend': r['backend'], 'attempt': r['attempt'],
            'session': 'sessions/'+session_dir.name,
            'journalSha256': session['snapshot']['sha256'],
            'reasoningTokens': r['retokenizedTextTokens']['reasoning'],
            'answerTokens': r['retokenizedTextTokens']['answer'],
            'visibleWordsApprox': r['generation']['visibleWordsApprox'],
            'firstFindingSeconds': latency/1000, 'synthesisSeconds': synth_ms/1000,
            'researchSeconds': r['timing']['researchMs']/1000,
            'queryToSavedSeconds': r['timing']['queryToCompleteMs']/1000,
            'preflightSeconds': None if r['timing']['preflightMs'] is None else r['timing']['preflightMs']/1000,
            'receipts': {'researchStartSeq': start['seq'], 'researchStartMs': start['t_ms'],
                         'firstFindingSeq': finding['seq'], 'firstFindingMs': finding['t_ms'],
                         'firstFindingType': finding['value']['type'],
                         'firstFindingResultSha256': sha(finding['value']['result'].encode()),
                         'synthesisStartSeq': synth_start['seq'], 'synthesisDoneSeq': synth_done['seq'],
                         'reportedSynthesisMs': synth_ms},
        })
        del session, rows
    cache=pair['audit']['httpCache']
    out['httpCache']={k:cache[k] for k in ['cacheN','promptN','cacheFraction','requests','responsesWithTiming','allRequestsCachePromptTrue']}
    out['httpCache']['synthesisCachedTokens']=cache['synthesis']['rawReceipt']['serverTimings']['cache_n']
    assert out['httpCache']['synthesisCachedTokens']==0
    out['synthesisSystemSha256']=pair['audit']['systemPrompt']['sha256']
    native,http=out['runs']
    out['reductionsPct']={key:100*(1-native[key]/http[key]) for key in ['reasoningTokens','firstFindingSeconds','synthesisSeconds']}
    result['pairs'].append(out)
    print(out['label'], json.dumps(out['reductionsPct']))
holdpath=args.benchmark/'sessions/fieldnote-2026-10-08T10-14-37.954Z/control-observations.json'
result['separateHoldDiagnostic']={
    'source': str(holdpath.relative_to(args.benchmark)), 'sha256':sha(holdpath.read_bytes()),
    'observation':json.loads(holdpath.read_text()),
    'use': 'Feature-demonstration candidate only; not included in comparative README charts.'}
(OUT/'data.json').write_text(json.dumps(result,indent=2)+'\n')
print('First-finding and synthesis receipts verified against all six raw journals.')
