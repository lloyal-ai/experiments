#!/usr/bin/env python3
"""Check cross-arm controls from saved execution receipts, without granting quality equivalence."""
import argparse,json,hashlib
from pathlib import Path
ap=argparse.ArgumentParser();ap.add_argument('suite',type=Path);a=ap.parse_args();root=a.suite.resolve()
summary=json.loads((root/'summary.json').read_text());identities={};queries={};attachments={};instructions={};samplers={};plans={};hits={};errors=[];loaded={};http_controls={};contexts={}
for result in summary['runs']:
 name=result['run'];run=root/name
 if 'extractionError' in result:errors.append({'run':name,'error':result['extractionError']});continue
 arm=result['arm'];base=run/('fieldnote' if arm=='resident' else 'langgraph');protocol=json.loads((run/'protocol.json').read_text())
 identity=json.loads((base/'identity.json').read_text())
 identities[name]={k:identity['files'][k]['sha256'] for k in ['model','projector','reranker','server','lockfile','nativeAddon','nativeLlama']}
 queries[name]=hashlib.sha256(protocol['query'].encode()).hexdigest()
 attachments[name]=sorted(protocol['attachmentHashes'].values());instructions[name]=result.get('synthesisStageInstructionSha256')
 plans[name]=json.loads((base/'reviewed-plan.json').read_text())['tasks'] if (base/'reviewed-plan.json').exists() else None
 expected=protocol['reasoning'];seed=expected['seed'];sampling=expected['sampling']
 context_rows=[]
 for log in ([base/'fieldnote.memory.jsonl'] if arm=='resident' else [base/'llama-server.memory.jsonl',base/'reranker.memory.jsonl']):
  seen=set()
  for line in log.open():
   receipt=json.loads(line)
   if receipt.get('event')=='context.ready' and receipt['contextId'] not in seen:
    seen.add(receipt['contextId']);context_rows.append({k:receipt[k] for k in ['contextId','nCtx','nSeqMax','nCtxPerSequence','nBatch','nUbatch','attention']})
 contexts[name]=context_rows
 if arm=='resident':
  receipts=result.get('nativeSampling') or [];by_stage={r['stage']:r for r in receipts}
  samplers[name]=all(stage in by_stage for stage in ['preflight','planning','inquiry','synthesis']) and all(r['applied'] and r['params']['temperature']==(.3 if r['stage']=='planning' else sampling['temperature']) and all(r['params'][k]==sampling[k] for k in ['topK','topP','minP']) and r['params']['penalties']=={'repeat':1,'frequency':0,'presence':0,'lastN':64} for r in receipts)
  records=[json.loads(l) for l in (base/'native-loaded-identity.jsonl').read_text().splitlines()]
  files=[f for r in records for f in r['files']]
  loaded[name]={'addonMatches':any(Path(f['path']).name=='lloyal.node' and f['sha256']==identities[name]['nativeAddon'] for f in files),'llamaMatches':any(Path(f['path']).name.startswith('libllama.so') and f['sha256']==identities[name]['nativeLlama'] for f in files),'cudaBackendLoaded':any('libggml-cuda.so' in f['path'] for f in files)}
 else:
  reqs=[json.loads(l)['data'] for l in (base/'observations.jsonl').read_text().splitlines() if json.loads(l)['type']=='http.request']
  bodies=[json.loads((base/'http'/(r['requestId']+'.request.json')).read_text()) for r in reqs]
  expected_params={'top_k':sampling['topK'],'top_p':sampling['topP'],'min_p':sampling['minP'],'typical_p':1,'repeat_penalty':1,'frequency_penalty':0,'presence_penalty':0,'repeat_last_n':64,'samplers':['penalties','top_k','typ_p','top_p','min_p','temperature']}
  samplers[name]=bool(reqs) and all(b.get('temperature')==(.3 if r.get('stage')=='planning' else sampling['temperature']) and all(b.get(k)==v for k,v in expected_params.items()) and b.get('seed')==r.get('sampling',{}).get('seed') for r,b in zip(reqs,bodies))
  http_controls[name]={'requests':len(bodies),'allRequestsPrefixCacheEnabled':bool(bodies) and all(b.get('cache_prompt') is True for b in bodies),'sharedSynthesisToolChoiceNone':None if arm!='shared-prefix' else all(b.get('tool_choice')=='none' and bool(b.get('tools')) for r,b in zip(reqs,bodies) if r.get('stage')=='synthesis')}
 if arm=='shared-prefix':hits[name]=result['status']['sharedPrefixHit']
sets=lambda values:len({json.dumps(v,sort_keys=True) for v in values})
report={'identicalWeightsAndCandidateBinaries':sets(identities.values())==1,'identicalQuestion':sets(queries.values())==1,'identicalAttachmentBytes':sets(attachments.values())==1,'identicalSynthesisInstructionText':None not in instructions.values() and sets(instructions.values())==1,'explicitSamplingReceiptsPass':all(samplers.values()),'allSharedPrefixSynthesisHits':bool(hits) and all(hits.values()),'qualityEquivalenceEstablished':False,'scope':'Instruction text parity does not mean full prompts, roles, tool headers, multimodal ancestry or generated findings are identical. Configured artifact hashes are supplemented by each native-loaded-identity.jsonl.','identities':identities,'questions':queries,'attachments':attachments,'synthesisInstructions':instructions,'samplers':samplers,'sharedPrefixHits':hits,'reviewedPlans':plans,'extractionErrors':errors}
report.update({'nativeLoadedArtifactsMatch':bool(loaded) and all(all(r.values()) for r in loaded.values()),'allHTTPRequestsPrefixCacheEnabled':bool(http_controls) and all(r['allRequestsPrefixCacheEnabled'] for r in http_controls.values()),'identicalReviewedTasks':None not in plans.values() and sets(plans.values())==1,'nativeLoadedArtifacts':loaded,'httpRequestControls':http_controls})
report['identicalReviewedTaskSet']=None not in plans.values() and sets(sorted(p,key=lambda t:(t['ability'],t['description'])) for p in plans.values())==1
report['taskOrderCaveat']='Task sets and ordered task arrays are checked separately. Inquiry seeds follow task index; a different planner order changes seed-to-objective assignment. No post-hoc order repair or replacement run.'
kv=lambda c:{k:c['attention'][k] for k in ['typeK','typeV']}
report.update({'identicalMainModelKVFormat':sets(kv(next(c for c in cs if c['nCtx']==32768)) for cs in contexts.values())==1,'identicalRerankerKVFormat':sets(kv(next(c for c in cs if c['nCtx']==16384)) for cs in contexts.values())==1,'runtimeContextReceipts':contexts,'runtimeContextCaveat':'Full application configurations retained: native/HTTP batching and reranker KV formats differ. Same reranker weights do not establish identical numerical ranking. Main-model KV formats are checked separately.'})
if (root/'execution-source-reference.json').exists():
 reference=json.loads((root/'execution-source-reference.json').read_text());checks={}
 patch=json.loads((root/'suite.json').read_text())['nativePatch']
 for name in identities:
  folder=root/name/'execution-source'
  mismatches=[p for p,h in reference['files'].items() if hashlib.sha256((folder/p.removeprefix('experiments/memory/')).read_bytes()).hexdigest()!=h]
  native=hashlib.sha256((folder/'native-harness/research.ts').read_bytes()).hexdigest()==patch['patchedSha256'] and hashlib.sha256((folder/'native-harness/benchmark-sampling.ts').read_bytes()).hexdigest()==patch['helperSha256']
  checks[name]={'allMatch':not mismatches and native,'mismatches':mismatches,'nativePatchMatches':native}
 report['frozenExecutionSourceMatches']=bool(checks) and all(r['allMatch'] for r in checks.values())
 (root/'execution-source-checks.json').write_text(json.dumps({'revision':reference['revision'],'runs':checks},indent=2)+'\n')
(root/'controls.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if isinstance(v,(bool,type(None)))},indent=2))
