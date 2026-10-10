#!/usr/bin/env python3
"""Create answer-only review packets, with the arm mapping kept in a separate file."""
from pathlib import Path
import argparse,json,secrets,hashlib
ap=argparse.ArgumentParser();ap.add_argument('suite',type=Path);a=ap.parse_args();root=a.suite.resolve();out=root/'review';out.mkdir(exist_ok=False)
items=[]
for p in root.glob('*/protocol.json'):
 run=p.parent;d=json.loads(p.read_text());arm=d['reasoning']['arm'];base=run/('fieldnote' if arm=='resident' else 'langgraph')
 if not (base/'answer.md').exists():continue
 items.append((run,base))
secrets.SystemRandom().shuffle(items);mapping={}
for i,(run,base) in enumerate(items):
 label=f'answer-{i+1:02}';text=(base/'answer.md').read_text();packet=out/(label+'.md');packet.write_text(text)
 events=[]
 for l in (base/'browser.jsonl').read_text().splitlines():
  row=json.loads(l);raw=row.get('raw');ev=raw.get('frame',{}).get('payload',{}) if isinstance(raw,dict) else {}
  if ev.get('type')=='answer' and isinstance(ev.get('text'),str):events.append(ev['text'])
 if len(events)>1:(out/(label+'-followup.md')).write_text(events[-1])
 mapping[label]={'run':run.name,'answerSha256':hashlib.sha256(text.encode()).hexdigest()}
(root/'review-mapping.json').write_text(json.dumps(mapping,indent=2)+'\n')
print(f'Created {len(mapping)} answer packets in {out}. Review before opening review-mapping.json or summary.json.')
