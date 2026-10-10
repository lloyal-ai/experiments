"""Verify repaired trials kept every inference request and server setting identical."""
from pathlib import Path
import json,hashlib
ROOT=Path(__file__).resolve().parents[1]
parent=ROOT/'comparisons/cuda-capacity-default-2026-10-10'
repair=ROOT/'comparisons/cuda-timeout-repair-2026-10-10'
assert (repair/'collection-complete.json').exists(), 'Await completed collection'
load=lambda p:json.loads(p.read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
protocol=load(repair/'protocol.json');checks=[]
for name in protocol['selectedTrials']:
 old,new=parent/name,repair/name
 paths=sorted(old.glob('*.request.json'))
 assert {p.name for p in paths}=={p.name for p in new.glob('*.request.json')},name
 mismatches=[p.name for p in paths if p.read_bytes()!=(new/p.name).read_bytes()]
 assert not mismatches,(name,mismatches)
 a,b=load(old/'server-launch.json'),load(new/'server-launch.json');assert a==b,name
 oj,nj=load(old/'job.json'),load(new/'job.json')
 changed=[k for k in oj.keys()|nj.keys() if oj.get(k)!=nj.get(k)]
 assert set(changed)=={'dir','matchHttpDeadline'},changed
 checks.append({'trial':name,'requestFilesCompared':len(paths),'requestBytesIdentical':True,'serverLaunchIdentical':True,'jobChangedFields':changed,
  'requestHashes':{p.name:sha(p) for p in paths},'transport':load(new/'transport.json')})
a=load(parent/'protocol.json')['identity'];b=protocol['identity']
assert all(a['files'][k]['sha256']==b['files'][k]['sha256'] for k in ['model','addon','server'])
for k in ['fixture.mjs','native.mjs','controller.mjs','capacity.mjs']:
 assert a['workload'][k]==b['workload'][k],k
out={'status':'verified','modelAddonServerHashesMatch':True,'fixtureNativeControllerCapacitySourcesMatch':True,'trials':checks,
 'meaning':'Exact HTTP request-body bytes include all messages, per-task seeds, schema, cache_prompt, sampling and chat-template arguments. Headers and transport deadlines are outside the body and intentionally changed.'}
(repair/'request-equality.json').write_text(json.dumps(out,indent=2)+'\n')
print('Verified request bytes, jobs, server launch, binaries and unchanged inference source for',len(checks),'trials')
