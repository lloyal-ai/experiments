"""Aggregate cache receipts without treating timed-out requests as zero cache hits."""
from pathlib import Path
import json
ROOT=Path(__file__).resolve().parents[1]
base=ROOT/'comparisons/cuda-capacity-default-2026-10-10'
repair=ROOT/'comparisons/cuda-timeout-repair-2026-10-10'
rows=[]
for root in [base,repair]:
 if not (root/'capacity-summary.json').exists():continue
 for trial in json.loads((root/'capacity-summary.json').read_text())['rows']:
  if trial['backend']!='langgraph' or trial['phase']=='calibration':continue
  d=root/trial['trial'];rounds=[]
  for round in range(2):
   receipts=[]
   for f in sorted(d.glob(f'round-{round}-*.response.json')):
    r=json.loads(f.read_text());u=r.get('usage');t=r.get('timings')
    if not u or not t:continue
    assert t['cache_n']==u['prompt_tokens_details']['cached_tokens'],str(f)
    assert t['cache_n']+t['prompt_n']==u['prompt_tokens'],str(f)
    request=json.loads(f.with_name(f.name.replace('.response.json','.request.json')).read_text())
    assert request['cache_prompt'] is True,str(f)
    receipts.append((u['prompt_tokens'],t['cache_n']))
   total=sum(x[0] for x in receipts);cached=sum(x[1] for x in receipts)
   rounds.append({'round':round,'responses':len(receipts),'requested':trial['count'],'inputTokensWithReceipts':total,'cachedTokensWithReceipts':cached,'cachedFractionOfObservedInput':cached/total if total else None,'completeReceipts':len(receipts)==trial['count']})
  rows.append({'source':root.name,'trial':trial['trial'],'rounds':rounds,'allocationFit':trial['allocationFit'],'capacityPass':trial['capacityPass']})
result={'meaning':'Server usage.prompt_tokens agrees with timings.cache_n + prompt_n on every retained successful response. Fractions cover only requests with receipts; missing or cancelled responses are not assigned zeros. Cached computation is distinct from simultaneous slot storage sharing.', 'rows':rows}
(base/'cache-receipts.json').write_text(json.dumps(result,indent=2)+'\n')
print('Cache receipts verified across',len(rows),'HTTP attempts')
