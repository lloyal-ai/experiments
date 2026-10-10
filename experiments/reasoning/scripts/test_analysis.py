import unittest,tempfile,json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from analyze import sse,common,token_counter
class AnalysisTests(unittest.TestCase):
 def test_sse_counts_provider_reasoning_once_and_ignores_usage_chunks(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'response.txt'
   rows=[{'choices':[{'delta':{'reasoning_content':'One '}}]}, {'choices':[{'delta':{'reasoning_content':'thought.','content':'Answer'}}]}, {'choices':[],'timings':{'cache_n':1788,'prompt_n':1000}}]
   p.write_text(''.join('data: '+json.dumps(x)+'\n\n' for x in rows)+'data: [DONE]\n')
   r,a,raw=sse(p);self.assertEqual(r,'One thought.');self.assertEqual(a,'Answer');self.assertEqual(raw[-1]['timings']['cache_n'],1788)
 def test_missing_tokenizer_is_unavailable_not_zero(self):
  with tempfile.TemporaryDirectory() as d:
   counter=token_counter(None,Path(d)/'counts.json')
   self.assertIsNone(counter('actual text'));self.assertEqual(counter(''),0)
 def test_prefix_comparison_stops_at_first_divergence(self):
  self.assertEqual(common([1,2,3,4],[1,2,9,4]),2)
if __name__=='__main__':unittest.main()
