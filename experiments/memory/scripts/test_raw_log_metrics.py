"""Metric-boundary tests; no GPU, browser, or inference dependencies."""
import json
import tempfile
import unittest
from pathlib import Path

from raw_log_metrics import normalize, read_session, summarize, http_receipt


def event(at, typ, **fields):
    return normalize({'seq': at + 1, 't_ms': at, 'type': 'wire.event', 'data': {'type': typ, **fields}})


def observation(at, typ, **fields):
    return normalize({'seq': at + 1, 't_ms': at, 'type': typ, 'data': fields})


def command(at, typ, **fields):
    return observation(at, 'browser.command', type=typ, **fields)


def session(rows, backend='langgraph'):
    return {'path': '/tmp/metric-test', 'manifest': {'backend': backend, 'test': False},
            'rows': rows, 'attempts': [rows], 'warnings': [], 'snapshot': {}}


class MetricsTests(unittest.TestCase):
    def test_server_sse_timings_are_request_correlated(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)/'receipt.txt'
            p.write_text('data: {"choices":[{"finish_reason":"stop"}],"timings":{"prompt_ms":12,"predicted_ms":34}}\n\ndata: [DONE]\n')
            receipt = http_receipt(p)
            self.assertEqual(receipt['serverTimings'], {'prompt_ms': 12, 'predicted_ms': 34})
            self.assertTrue(receipt['sseDone'])
            self.assertEqual(receipt['finishReason'], 'stop')
            self.assertIsNone(http_receipt(Path(d)/'absent')['serverTimings'])

    def test_native_envelope_normalization(self):
        row = {'seq': 1, 't_ms': 0, 'type': 'wire.native.raw', 'data': {'raw': json.dumps(
            {'frame': {'t': 'event', 'payload': {'type': 'answer', 'text': 'ok'}}})}}
        self.assertEqual(normalize(row)['value'], {'type': 'answer', 'text': 'ok'})
        self.assertEqual(normalize(row)['kind'], 'event')

    def test_partial_tail_and_valid_unterminated_tail(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d); (p/'manifest.json').write_text('{"backend":"langgraph"}')
            raw = json.dumps({'seq': 1, 't_ms': 0, 'type': 'browser.command', 'data': {'type': 'submit_query'}})
            (p/'observations.jsonl').write_text(raw+'\n{"seq":')
            s = read_session(p)
            self.assertEqual(len(s['rows']), 1); self.assertEqual(len(s['warnings']), 1)
            self.assertEqual(s['snapshot']['bytes'], len((raw+'\n').encode()))
            (p/'observations.jsonl').write_text(raw)
            self.assertEqual(len(read_session(p)['rows']), 1)
            (p/'observations.jsonl').write_text(raw+'\nINVALID\n')
            with self.assertRaises(ValueError): read_session(p)

    def test_first_finding_excludes_preflight_and_duplicate_recovery(self):
        rows = [command(0, 'submit_query', query='q'), event(2, 'agent:return', agentId=1, result='probe'),
                event(10, 'research:start'), event(20, 'agent:produce', agentId=2, text='x'),
                event(30, 'agent:recovered', agentId=2, result='finding'),
                event(31, 'agent:return', agentId=2, result='finding'),
                event(40, 'research:done', timeMs=30, totalTokens=10, totalToolCalls=1),
                event(50, 'answer', text='answer'), event(51, 'complete')]
        s = summarize(session(rows), 1)
        self.assertEqual(s['timing']['firstFindingAfterResearchMs'], 20)
        self.assertEqual(s['timing']['firstGenerationAfterResearchMs'], 10)
        self.assertEqual(s['recoveredAgents'], 1)
        self.assertIsNone(s['timing']['preflightMs'])

    def test_usage_zero_is_not_missing_and_chunks_are_not_tokens(self):
        rows = [command(0, 'submit_query'), event(1, 'synthesize:start'),
                event(2, 'agent:spawn', agentId=3), observation(3, 'http.request', requestId='a', wireBytes=100),
                event(4, 'agent:reasoning_delta', agentId=3, text='long reasoning text'),
                event(5, 'agent:text_delta', agentId=3, text='answer'),
                observation(6, 'http.response', requestId='a', durationMs=3,
                    usage={'input_tokens': 20, 'output_tokens': 7, 'input_token_details': {'cache_read': 0}}),
                event(7, 'synthesize:done', agentId=3, tokenCount=7, timeMs=6),
                event(8, 'answer', text='answer'), event(9, 'complete')]
        s = summarize(session(rows), 1)
        self.assertEqual(s['http']['cachedPromptTokens']['total'], 0)
        self.assertEqual(s['generation']['synthesisTokensIncludingReasoning'], 7)
        self.assertIsNone(s['generation']['reasoningTokenCount'])
        self.assertEqual(s['generation']['reasoningChars'], len('long reasoning text'))
        self.assertIsNone(summarize(session([command(0, 'submit_query'), event(1, 'complete')]), 1)['http']['cachedPromptTokens']['total'])

    def test_native_prefill_mirrors_not_double_counted(self):
        trace = {'traceId': 7, 'type': 'branch:prefill', 'branchHandle': 1, 'role': 'toolResult', 'cells': 50}
        rows = [command(0, 'submit_query'), event(1, 'agent:trace', event=trace),
                event(2, 'agent:prefilled', cells=50, role='toolResult'), event(3, 'agent:trace', event=trace), event(4, 'complete')]
        s = summarize(session(rows, 'fieldnote'), 1)
        self.assertEqual(s['nativeState']['prefillCellsByRole'], {'toolResult': 50})
        self.assertIsNone(s['http']['requestBodyBytes'])

    def test_terminal_boundary_preserves_late_errors_but_not_work(self):
        rows = [command(0, 'submit_query'), command(1, 'pause'), event(2, 'run:paused'),
                event(3, 'agent:text_delta', agentId=1, text='still generating'), event(12, 'run:resumed'),
                event(15, 'run:aborted'), observation(16, 'http.failure', requestId='x', error='late'),
                observation(17, 'http.request', requestId='later', wireBytes=100)]
        s = summarize(session(rows), 1)
        self.assertEqual(s['controls']['acknowledgedHoldMs'], 10)
        self.assertEqual(s['controls']['holds'][0]['generationEvents'], 1)
        self.assertTrue(s['errors'][0]['afterTerminal'])
        self.assertEqual(s['http']['requestBodyBytes'], 0)
        self.assertEqual(s['selection']['status'], 'aborted')

    def test_browser_clock_reset_suppresses_latency(self):
        rows = [command(0, 'submit_query')]
        for at, payload in [(1, {'kind': 'paint-observation', 'type': 'research:start', 'at': 1000}),
                            (2, {'kind': 'prose-render', 'at': 50, 'prose': [{'chars': 20}]})]:
            rows.append(normalize({'seq': at+1, 't_ms': at, 'type': 'browser.observation', 'data': [payload]}))
        rows.append(event(3, 'complete'))
        s = summarize(session(rows), 1)
        self.assertTrue(s['browser']['clockResetDetected'])
        self.assertIsNone(s['browser']['firstProseAfterResearchPaintMs'])

    def test_ranking_mirrors_and_tool_errors(self):
        ranking = {'totalScored': 4, 'admittedTokens': 100, 'selectedPassageCount': 2}
        rows = [command(0, 'submit_query'), observation(1, 'retrieval.ranking', **ranking),
                event(2, 'agent:ranking', ranking=ranking), event(3, 'agent:tool_call', agentId=1, tool='search', callId='a'),
                event(7, 'agent:tool_result', agentId=1, tool='search', callId='a', result='{"error":"missing document"}'), event(8, 'complete')]
        s = summarize(session(rows), 1)
        self.assertEqual(s['retrieval']['operations'], 1)
        self.assertEqual(s['tools']['durations'][0]['durationMs'], 4)
        self.assertEqual(len(s['tools']['errorResults']), 1)


if __name__ == '__main__': unittest.main()
