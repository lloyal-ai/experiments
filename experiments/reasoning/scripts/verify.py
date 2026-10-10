#!/usr/bin/env python3
"""Check cross-arm controls from saved execution receipts, without granting quality equivalence."""
import argparse,json,hashlib
from pathlib import Path
ap=argparse.ArgumentParser();ap.add_argument('suite',type=Path);a=ap.parse_args();root=a.suite.resolve()
summary=json.loads((root/'summary.json').read_text());identities={};queries={};attachments={};instructions={};samplers={};plans={};hits={};errors=[]
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
 if arm=='resident':
  receipts=result.get('nativeSampling') or [];by_stage={r['stage']:r for r in receipts}
  samplers[name]=all(stage in by_stage for stage in ['preflight','planning','inquiry','synthesis']) and all(r['applied'] and r['params']['temperature']==(.3 if r['stage']=='planning' else sampling['temperature']) and all(r['params'][k]==sampling[k] for k in ['topK','topP','minP']) for r in receipts)
 else:
  reqs=[json.loads(l)['data'] for l in (base/'observations.jsonl').read_text().splitlines() if json.loads(l)['type']=='http.request']
  samplers[name]=bool(reqs) and all(r.get('sampling',{}).get('temperature')==(.3 if r.get('stage')=='planning' else sampling['temperature']) for r in reqs)
 if arm=='shared-prefix':hits[name]=result['status']['sharedPrefixHit']
sets=lambda values:len({json.dumps(v,sort_keys=True) for v in values})
report={'identicalWeightsAndCandidateBinaries':sets(identities.values())==1,'identicalQuestion':sets(queries.values())==1,'identicalAttachmentBytes':sets(attachments.values())==1,'identicalSynthesisInstructionText':None not in instructions.values() and sets(instructions.values())==1,'explicitSamplingReceiptsPass':all(samplers.values()),'allSharedPrefixSynthesisHits':bool(hits) and all(hits.values()),'qualityEquivalenceEstablished':False,'scope':'Instruction text parity does not mean full prompts, roles, tool headers, multimodal ancestry or generated findings are identical. Configured artifact hashes are supplemented by each native-loaded-identity.jsonl.','identities':identities,'questions':queries,'attachments':attachments,'synthesisInstructions':instructions,'samplers':samplers,'sharedPrefixHits':hits,'reviewedPlans':plans,'extractionErrors':errors}
(root/'controls.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if isinstance(v,(bool,type(None)))},indent=2))
