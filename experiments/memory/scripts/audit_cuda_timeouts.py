"""Classify recorded timeout causes without changing the original trial receipts."""
from pathlib import Path
import json, collections, hashlib
ROOT=Path(__file__).resolve().parents[1]
p=ROOT/'comparisons/cuda-capacity-default-2026-10-10'
rows=json.loads((p/'capacity-summary.json').read_text())['rows']
items=[]
for row in rows:
 if row['category']!='deadline':continue
 d=p/row['trial']; result=json.loads((d/'result.json').read_text()); job=json.loads((d/'job.json').read_text())
 failed=[o['failed'] for o in result['outcomes'] if o.get('failed')]
 items.append({'trial':row['trial'],'declaredTimeoutMs':job['timeoutMs'],'observedFailureMessages':dict(collections.Counter(failed)),
  'failureCause':'Node fetch response-header timeout at approximately 300 seconds' if failed and all('response headers' in x for x in failed) else 'requires review',
  'rounds':[{'round':r['round'],'durationMs':r['workMs'],'returned':sum(isinstance(o.get('result'),str) for o in r['outcomes']),'correct':sum(bool(o.get('valid')) for o in r['outcomes']),'headerTimeouts':sum('response headers' in (o.get('failed') or '') for o in r['outcomes'])} for r in result['rounds']],
  'capacityInterpretation':'Transport-censored. Neither a GPU allocation failure nor exhaustion of the declared 1800-second experiment deadline.',
  'resultSha256':hashlib.sha256((d/'result.json').read_bytes()).hexdigest(),
  'peakVramGiB':row['peakOwnedGpuProcessBytes']/2**30})
assert len(items)==5 and all(i['failureCause'].startswith('Node fetch') for i in items)
out={'reviewedOn':'2026-10-10','status':'root-cause-identified','affectedTrials':items,
 'rootCause':'AbortSignal.timeout(1800000) does not override the fetch implementation\'s independent 300000 ms response-header timer. Nonstreaming completions have no response headers until generation finishes. ChatOpenAI also lacked an explicit matching SDK timeout.',
 'fix':'Use matching undici fetch + Agent headersTimeout/bodyTimeout=1800000 and ChatOpenAI timeout=1800000; preserve maxRetries=0, payloads, fixtures, server/cache/model settings and ordinary LangGraph Send fan-out.',
 'regressionTest':'test/http-transport.test.ts: delayed headers exceed a short dispatcher timer, succeed with a matching longer timer, and still respect explicit AbortSignal cancellation. Passed locally and on Linux.',
 'rerunDirectory':'../cuda-timeout-repair-2026-10-10',
 'scope':'Two representative affected widths (128 at ~8.8k tokens; 64 at ~26.8k tokens), one new attempt each. Other original timeout cases remain censored; this is not a complete remeasurement of the capacity frontier.'}
server=ROOT/'instrumentation/lloyal-node/llama.cpp/tools/server/server-context.cpp'
settings=ROOT/'instrumentation/lloyal-node/llama.cpp/common/common.h'
out['serverLatencyEvidence']={
 'sourceRevision':'d6d0ce8215a1c324e8de04b52f9dd65c5edc129f',
 'source':'tools/server/server-context.cpp:2118-2133; common/common.h:600',
 'sourceSha256':hashlib.sha256(server.read_bytes()).hexdigest(),
 'default':'cache_idle_slots=true; after starting each task, visit every idle slot and call prompt_save; separate KV retains the idle slot contents.',
 'configuredRamPromptCacheMiB':1024,
 'observations':[{ 'trial':r['trial'], 'idleSlotSaveAttempts':(p/r['trial']/'server.log').read_text().count('saving idle slot to prompt cache'), 'cacheEvictionLogEntries':(p/r['trial']/'server.log').read_text().count('removing oldest entry')} for r in rows if r['backend']=='langgraph' and r['count'] in [64,128] and r['phase']=='sweep'],
 'interpretation':'Repeated idle-slot scans/serialization and cache eviction are a configuration-specific contributor consistent with the long second-round waits. No isolated no-cache-idle-slots timing control was run; do not attribute the full delay to this mechanism, HTTP transport, or LangGraph itself.',
 'availableServerOption':'--no-cache-idle-slots disables idle serialization, separately from request cache_prompt and RAM cache size; not used in these repaired trials.'
}
(p/'timeout-investigation.json').write_text(json.dumps(out,indent=2)+'\n')
print(len(items),'transport-censored trials; original logs unchanged')
