#!/usr/bin/env python3
"""Rebuild measurements from raw Fieldnote journals/SSE. No model generation or quality guessing."""
import argparse, json, sys, hashlib, re, urllib.request
from pathlib import Path
from collections import defaultdict
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT.parent/'memory/scripts'))
from raw_log_metrics import read_session,summarize,event_rows,http_receipt
sha=lambda b:hashlib.sha256(b).hexdigest()

def token_counter(url, cache_path):
 cache=json.loads(cache_path.read_text()) if cache_path.exists() else {}
 def count(text):
  if not text:return 0
  key=sha(text.encode())
  if key not in cache:
   if not url:return None
   req=urllib.request.Request(url.rstrip('/')+'/tokenize',data=json.dumps({'content':text,'add_special':False,'parse_special':False}).encode(),headers={'Content-Type':'application/json'})
   with urllib.request.urlopen(req,timeout=120) as r:cache[key]=len(json.load(r)['tokens'])
   cache_path.write_text(json.dumps(cache,indent=2)+'\n')
  return cache[key]
 return count

def sse(path):
 reasoning='';answer='';chunks=[]
 for line in path.read_text().splitlines():
  if not line.startswith('data: {'):continue
  obj=json.loads(line[6:]);chunks.append(obj)
  for c in obj.get('choices',[]):
   d=c.get('delta',{});reasoning+=d.get('reasoning_content') or '';answer+=d.get('content') or ''
 return reasoning,answer,chunks

def common(a,b):
 i=0
 for x,y in zip(a,b):
  if x!=y:break
  i+=1
 return i

def extract(run,count):
 protocol=json.loads((run/'protocol.json').read_text());arm=protocol['reasoning']['arm'];backend='fieldnote' if arm=='resident' else 'langgraph';base=run/backend
 session=read_session(base);rows=session['attempts'][0];summary=summarize(session,1)
 (run/'raw-log-metrics.json').write_text(json.dumps(summary,indent=2)+'\n')
 if len(session['attempts'])>1:(run/'followup-metrics.json').write_text(json.dumps(summarize(session,2),indent=2)+'\n')
 events=event_rows(rows); stages={}; phase='preflight'
 for r in events:
  e=r['value'];kind=e.get('type')
  if kind=='preflight:done':phase='planning'
  if kind=='research:start':phase='inquiry'
  if kind=='synthesize:start':phase='synthesis'
  if kind=='agent:spawn':stages[e['agentId']]=phase
 syn=next((e['value'] for e in events if e['value'].get('type')=='synthesize:done'),{})
 if 'agentId' in syn:stages[syn['agentId']]='synthesis'
 segments=defaultdict(list);synthesis_answer='';synthesis_system=None;synthesis_instruction=None;cache_receipts=[];native_missing=[]
 traces=[r['value']['event'] for r in event_rows(rows,'agent:trace')]
 # Trace IDs are unique within the one session; the journal is the source, not UI mirrors.
 traces=list({e['traceId']:e for e in traces}.values())
 if arm=='resident':
  for e in traces:
   stage=stages.get(e.get('agentId'))
   if e['type']=='prompt:format' and stage=='synthesis' and e.get('messages'):
    ms=json.loads(e['messages']);synthesis_system=next((m['content'] for m in ms if m['role']=='system'),None);synthesis_instruction=synthesis_system
   if e['type']!='agent:turn' or not stage:continue
   raw=e['rawOutput']
   if '</think>' in raw:
    reason,answer=raw.split('</think>',1);reason=reason.replace('<think>','')
   elif stage=='planning':reason='';answer=raw
   else:
    native_missing.append({'stage':stage,'agentId':e.get('agentId'),'turn':e.get('turn'),'chars':len(raw)})
    reason='';answer=raw
   segments[stage].append(reason)
   if stage=='synthesis':synthesis_answer+=answer
 else:
  prior=[]
  for row in rows:
   if row['type']!='http.request':continue
   e=row['data'];request_id=e['requestId'];stage=e.get('stage','unknown');path=base/'http'/request_id
   response=path.with_suffix('.response.txt')
   reason,answer,_=sse(response) if response.exists() else ('','',[])
   segments[stage].append(reason)
   receipt=http_receipt(response);cache_receipts.append({'requestId':request_id,'stage':stage,**receipt})
   token_path=path.with_suffix('.tokens.json');ids=json.loads(token_path.read_text())['tokens'] if token_path.exists() else []
   if stage=='synthesis':
    synthesis_answer+=answer
    request=json.loads(path.with_suffix('.request.json').read_text())
    synthesis_system=request['messages'][0]['content']
    synthesis_instruction=request['messages'][1]['content'][0]['text'].removeprefix('# Current stage instructions\n') if arm=='shared-prefix' else synthesis_system
    receipt.update({'renderedTextualPrefixTokens':max((common(ids,t) for t in prior),default=0),'renderedTextualTokens':len(ids)})
    cache_receipts[-1].update(receipt)
   prior.append(ids)
 answer=(base/'answer.md').read_text() if (base/'answer.md').exists() else ''
 stage_counts={stage:{'reasoningTokens':None if any((n:=count(t)) is None for t in texts) else sum(count(t) for t in texts),'reasoningChars':sum(map(len,texts)),'completedTurnsOrRequests':len(texts)} for stage,texts in segments.items()}
 for missing in native_missing:
  stage_counts.setdefault(missing['stage'],{})['reasoningTokens']=None
 native_recovery=[e for e in traces if e['type']=='pool:recoveryProduce']
 if native_recovery:
  for stage in set(stages.get(e.get('agentId'),'unknown') for e in native_recovery):
   stage_counts.setdefault(stage,{})['recoveryReasoningUnavailable']=True
   stage_counts[stage]['completedTurnReasoningTokens']=stage_counts[stage].get('reasoningTokens')
   stage_counts[stage]['reasoningTokens']=None
 syn_cache=next((r for r in cache_receipts if r['stage']=='synthesis'),None)
 checks={'driverComplete':json.loads((base/'driver-status.json').read_text())['status']=='complete','preflightExecuted':any(e['value']['type']=='preflight:done' for e in events),'synthesisCompleted':bool(syn),'sharedPrefixHit':None if arm!='shared-prefix' else bool(syn_cache and (syn_cache.get('serverTimings') or {}).get('cache_n',0)>0)}
 native_sampling=[json.loads(l) for l in (base/'native-sampling.jsonl').read_text().splitlines()] if (base/'native-sampling.jsonl').exists() else None
 total_input=sum((r.get('serverTimings') or {}).get('prompt_n',0)+(r.get('serverTimings') or {}).get('cache_n',0) for r in cache_receipts)
 total_cached=sum((r.get('serverTimings') or {}).get('cache_n',0) for r in cache_receipts)
 result={'run':run.name,'arm':arm,'seed':protocol['reasoning']['seed'],'status':checks,'quality':'unreviewed','comparisonEligible':False,'timing':summary['timing'],'generation':{k:v for k,v in summary['generation'].items() if k!='synthesisStream'},'reasoningByStage':stage_counts,'savedAnswerAvailable':(base/'answer.md').exists(),'streamedSynthesisAnswerTokens':count(synthesis_answer),'answerTokens':count(answer) if (base/'answer.md').exists() else None,'answerWords':len(re.sub(r'\[([^\]]+)\]\([^)]*\)',r'\1',answer).split()),'answerSha256':sha(answer.encode()),'synthesisSystemSha256':sha(synthesis_system.encode()) if isinstance(synthesis_system,str) else None,'synthesisStageInstructionSha256':sha(synthesis_instruction.encode()) if isinstance(synthesis_instruction,str) else None,'synthesisCache':syn_cache,'httpWorkloadCache':{'inputTokens':total_input,'cachedTokens':total_cached,'fraction':total_cached/total_input if total_input else None},'nativeSampling':native_sampling,'nativeTurnsWithoutReasoningDelimiter':native_missing,'nativeRecoveryReasoningCaveat':bool(native_recovery),'rawJournal':session['snapshot'],'sourceProtocolSha256':sha((run/'protocol.json').read_bytes())}
 result['generation']['reasoningTokenCount']=stage_counts.get('synthesis',{}).get('reasoningTokens')
 result['httpWorkloadCache']['available']=arm!='resident'
 if arm=='resident':result['httpWorkloadCache'].update(inputTokens=None,cachedTokens=None)
 result['scope']='Initial brief only; full-journey acceptance and separate quality review include follow-up.'
 result['tools']={k:summary['tools'][k] for k in ['calls','researchCallsReported','byTool','researchByTool','errorResults']}
 result['retrieval']={k:summary['retrieval'][k] for k in ['operations','candidatesScored','admittedTokens','selectedPassages','note']}
 result['recoveredAgents']=summary['recoveredAgents'];result['errors']=summary['errors']
 result['attempt']=summary['selection']
 reported=syn.get('tokenCount') if arm=='resident' else (syn_cache or {}).get('serverTimings',{}).get('predicted_n')
 reason_tokens=stage_counts.get('synthesis',{}).get('reasoningTokens')
 result['synthesisReportedGenerationTokens']=reported
 result['posthocBoundaryDelta']=reported-reason_tokens-result['answerTokens'] if all(isinstance(n,(int,float)) for n in [reported,reason_tokens,result['answerTokens']]) else None
 (run/'synthesis-text.json').write_text(json.dumps({'reasoning':'\n'.join(segments.get('synthesis',[])),'streamedAnswer':synthesis_answer,'savedAnswer':answer,'system':synthesis_system},indent=2,ensure_ascii=False)+'\n')
 (run/'metrics.json').write_text(json.dumps(result,indent=2)+'\n');return result

def main():
 ap=argparse.ArgumentParser();ap.add_argument('path',type=Path);ap.add_argument('--tokenizer-url');a=ap.parse_args();base=a.path.resolve()
 count=token_counter(a.tokenizer_url,base/'token-counts.json');runs=[base] if (base/'protocol.json').exists() else sorted(p for p in base.iterdir() if p.is_dir() and (p/'protocol.json').exists())
 results=[]
 for p in runs:
  try:results.append(extract(p,count))
  except Exception as e:results.append({'run':p.name,'extractionError':str(e)})
 (base/'summary.json').write_text(json.dumps({'analysisSourceSha256':sha(Path(__file__).read_bytes()),'tokenizer':{'url':a.tokenizer_url,'method':'Same GGUF /tokenize, add_special=false, parse_special=false; sum completed reasoning turns separately. Recovery reasoning unavailable on native traces is flagged, never treated as zero.'},'runs':results},indent=2)+'\n')
 print(json.dumps([{'run':r['run'],'status':r.get('status'),'reasoningTokens':r.get('generation',{}).get('reasoningTokenCount'),'error':r.get('extractionError')} for r in results],indent=2))
if __name__=='__main__':main()
