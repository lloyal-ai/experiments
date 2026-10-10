#!/usr/bin/env python3
"""Join already-scored anonymous answer packets to raw-log measurements."""
import argparse, hashlib, json
from pathlib import Path

ap=argparse.ArgumentParser();ap.add_argument('suite',type=Path);a=ap.parse_args();root=a.suite.resolve()
review=json.loads((root/'quality-review.json').read_text())
mapping=json.loads((root/'review-mapping.json').read_text())
summary=json.loads((root/'summary.json').read_text())
criteria=set(json.loads((root/'quality-rubric.json').read_text())['criteria'])
frozen=json.loads((root/'quality-review-blinded.json').read_text()) if (root/'quality-review-blinded.json').exists() else None
if frozen:
    assert set(frozen['answers'])==set(review['answers'])
    for label,assessment in frozen['answers'].items():
        assert all(review['answers'][label].get(k)==v for k,v in assessment.items()), 'Review changed after unmasking: '+label
scores={}
for label,assessment in review['answers'].items():
    assert label in mapping, f'Unknown review packet: {label}'
    assert set(assessment['criteria'])==criteria, f'Incomplete rubric: {label}'
    assert all(type(v['score']) is int and 0<=v['score']<=2 and v.get('evidence') for v in assessment['criteria'].values()), label
    assert hashlib.sha256((root/'review'/(label+'.md')).read_bytes()).hexdigest()==mapping[label]['answerSha256'], label
    scores[mapping[label]['run']]={'packet':label,'score':sum(v['score'] for v in assessment['criteria'].values()),'maximum':2*len(criteria),**assessment}
assert set(review['answers'])==set(mapping), 'Every completed answer must be reviewed'
joined={'method':review['method'],'reviewSha256':hashlib.sha256((root/'quality-review.json').read_bytes()).hexdigest(),'qualityEquivalenceEstablished':False,'runs':scores}
joined['preUnmaskingAssessmentUnchanged']=True if frozen else None
(root/'quality-by-run.json').write_text(json.dumps(joined,indent=2,ensure_ascii=False)+'\n')
for result in summary['runs']:
    if result['run'] in scores:
        result['quality']='rubric-reviewed; implementing assistant; not independent'
        result['qualityReview']={'packet':scores[result['run']]['packet'],'score':scores[result['run']]['score'],'maximum':2*len(criteria)}
(root/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
print('Joined completed-answer reviews; quality equivalence remains unestablished.')
