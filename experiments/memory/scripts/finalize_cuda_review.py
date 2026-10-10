"""Finalize the reviewed record after the declared timeout checks have finished."""
from pathlib import Path
from datetime import datetime,timezone
import json,hashlib
ROOT=Path(__file__).resolve().parents[1]
p=ROOT/'comparisons/cuda-capacity-default-2026-10-10';repair=p.parent/'cuda-timeout-repair-2026-10-10';composed=p.parent/'cuda-composed-2026-10-10'
load=lambda p:json.loads(p.read_text())
assert (repair/'collection-complete.json').exists()
eq=load(repair/'request-equality.json');assert eq['status']=='verified'
quality=load(composed/'review/quality-comparison.json');assert quality['status']=='reviewed-with-differences'
a=load(p/'capacity-summary.json');b=load(repair/'capacity-summary.json')
assert len(b['rows'])==2
rows=a['rows']+b['rows'];pairs=[]
for new in b['rows']:
 old=next(r for r in a['rows'] if r['trial']==new['trial'])
 native=next(r for r in a['rows'] if r['backend']=='lloyal' and r['records']==new['records'] and r['count']==new['count'] and r['phase']=='sweep')
 pairs.append({'records':new['records'],'workers':new['count'],'originalHttpCategory':old['category'],'originalInterpretation':'transport-censored','repairedHttpCategory':new['category'],'repairedHttpCompletedGenerations':new['completedGenerations'],'expectedResults':new['gates']['expectedResults'],'repairedHttpCorrect':new['validResults'],'nativeCorrect':native['validResults'],'nativeVramGiB':native['peakOwnedGpuProcessBytes']/2**30,'httpVramGiB':new['peakOwnedGpuProcessBytes']/2**30,'vramReductionPercent':100*(1-native['peakOwnedGpuProcessBytes']/new['peakOwnedGpuProcessBytes']) if new['allocationFit'] else None,'bothAllocationFit':native['allocationFit'] and new['allocationFit'],'bothAllCorrect':native['capacityPass'] and new['capacityPass'],'repairedRoundSeconds':[r['workMs']/1000 for r in new['rounds']]})
ceiling=[r for r in a['rows'] if r['backend']=='lloyal' and r['records']==256 and r['count']==254]
assert len(ceiling)==3 and all(r['capacityPass'] and r['validResults']==508 for r in ceiling)
result={'status':'final-reviewed-bounded-record','finalizedAt':datetime.now(timezone.utc).isoformat(),'collectionFinished':True,'timeoutInvestigation':'root cause identified; two representative corrective checks completed','qualityReview':'completed; non-blind, retrospective, one composed pair','fullQualityEquivalentPerformanceEligible':False,'physicalMaximumCapacityProven':False,'nativeShortPrefix254':{'trials':3,'exactAnswersPerTrial':508,'expectedPerTrial':508,'peakVramGiB':[r['peakOwnedGpuProcessBytes']/2**30 for r in ceiling],'ceiling':'256 engine sequences including two administrative branches; not VRAM exhaustion'},'correctedComparisons':pairs,
 'permittedClaims':['Measured GPU-memory reductions at matched completed worker counts, with answer gates disclosed.','The short-ledger native workload completed 254 active workers and 508/508 exact answers in three trials.','HTTP prefix caching was enabled and reused computation, confirmed by server receipts.','All five original timeouts were censored by the independent five-minute client header limit.','The composed pair completed, and the retrospective quality review favors LangGraph\'s initial figure coverage and grounding in this sample.'],
 'claimsNotEstablished':['A physical maximum-capacity ratio or orders-of-magnitude more concurrent agents.','That LangGraph cannot fit counts above its largest completed observation.','Quality-equivalent composed speedups, universal backend quality differences, or a causal deliberation mechanism.','Memory independent of agent count: recurrent state is 50.25 MiB per configured sequence here.','Latency attributable solely to HTTP or framework overhead; server idle-slot cache behavior and instrumentation overhead contribute or remain unisolated.'],
 'remainingScientificLimits':['Three other original HTTP timeout widths were not rerun, and no corrected full-frontier bisection was performed.','Repaired widths have one trial each, two rounds per trial.','Long-ledger exact-answer errors occur on both paths; completion/allocation and quality are separate.','The composed pair uses different generated findings/tool choices and a different HTTP KV layout from the text diagnostic.','No blinded repeated quality study or repeated wide-run observer-overhead control.'],
 'evidence':['capacity-summary.json','timeout-investigation.json','cache-receipts.json','../cuda-timeout-repair-2026-10-10/capacity-summary.json','../cuda-timeout-repair-2026-10-10/request-equality.json','../cuda-composed-2026-10-10/review/quality-comparison.json','../cuda-composed-2026-10-10/review/prompt-and-input-controls.json'],
 'checks':{'localTestsPassed':37,'localTypecheck':'passed','linuxTransportRegression':'passed','rawParentTrialFiles':'retained unchanged','reviewAndCharts':'derived separately from raw receipts'}}
result['evidenceSha256']={f:hashlib.sha256((p/f).read_bytes()).hexdigest() for f in result['evidence']}
(p/'final-review.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(pairs,indent=2))
