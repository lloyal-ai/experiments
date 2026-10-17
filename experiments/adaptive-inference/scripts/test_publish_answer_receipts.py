import importlib.util
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("publisher", pathlib.Path(__file__).with_name("publish-answer-receipts.py"))
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


class PublicationBoundary(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.run = pathlib.Path(self.temp.name) / "run"
        self.directory = self.run / "q1-r0"
        self.directory.mkdir(parents=True)
        self.item = {"questionId": "1", "repeat": 0}
        self.plan = {"recipeSha256": "recipe", "datasetRevision": "dataset", "label": "run", "planned": [self.item, {"questionId": "2", "repeat": 0}]}
        self.sub = {"attemptId": "q1-r0", "questionId": "1", "repeat": 0, "recipeSha256": "recipe", "datasetRevision": "dataset", "promptSha256": "prompt", "status": "completed", "answer": "PRIVATE_ANSWER", "failure": None, "secret": "PRIVATE_KEY"}
        self.metrics = {"id": "q1-r0", "status": "completed", "elapsedMs": 12, "generatedTokens": 4, "answer": "PRIVATE_ANSWER", "failure": "PRIVATE_DIAGNOSTIC", "input": {"inputTokens": 100, "text": "PRIVATE_SOURCE"}, "generatedByRole": {"worker": 4, "secret": "PRIVATE_KEY"}}
        (self.directory / "submission.json").write_text(json.dumps(self.sub))

    def tearDown(self):
        self.temp.cleanup()

    def receipt(self):
        return p.make_receipt(self.run, self.item, self.plan, {"git": "frozen-git"})

    def finish(self):
        (self.directory / "metrics.json").write_text(json.dumps(self.metrics))

    def test_unfinished_attempt_not_published(self):
        self.assertIsNone(self.receipt())

    def test_sensitive_content_is_not_published(self):
        self.finish()
        receipt = self.receipt()
        self.assertNotIn("PRIVATE_", json.dumps(receipt))
        self.assertEqual(receipt["solverGit"], "frozen-git")
        self.assertEqual(receipt["answerSha256"], p.sha(b"PRIVATE_ANSWER"))

    def test_grade_must_match_frozen_submission(self):
        self.finish()
        grade = self.directory / "grading"
        grade.mkdir()
        (grade / "manifest.json").write_text(json.dumps({"submissionSha256": "wrong"}))
        (grade / "grade.json").write_text(json.dumps({"verdict": "CORRECT", "apiCalls": 1}))
        with self.assertRaises(ValueError):
            self.receipt()

    def test_partial_or_interim_score_never_becomes_full_score(self):
        self.finish()
        receipt = self.receipt()
        receipt["grading"]["interim"] = [{"verdict": "CORRECT"}]
        state = p.progress([receipt], self.plan)
        self.assertIsNone(state["fullSetScorePercent"])
        self.assertEqual(state["interimGrading"]["correct"], 1)
        self.assertEqual(state["finalGrading"]["graded"], 0)

    def test_failed_attempt_remains_in_denominator(self):
        self.finish()
        receipt = self.receipt()
        receipt["status"] = "failed"
        receipt["grading"]["final"] = {"verdict": "INCORRECT"}
        state = p.progress([receipt], {**self.plan, "planned": [self.item]})
        self.assertEqual(state["fullSetScorePercent"], 0)
        self.assertEqual(state["solverFailures"], 1)

    def test_git_retry_is_idempotent_and_grade_update_commits_once(self):
        self.finish()
        harness = pathlib.Path(self.temp.name) / "checkout"
        scripts = harness / "scripts"
        scripts.mkdir(parents=True)
        executable = scripts / "publish-answer-receipts.py"
        shutil.copyfile(pathlib.Path(__file__).with_name("publish-answer-receipts.py"), executable)
        (self.run / "plan.json").write_text(json.dumps(self.plan))
        (self.run / "manifest.json").write_text(json.dumps({"git": "frozen-git"}))
        def git(*args):
            return subprocess.check_output(["git", "-C", str(harness), *args], stderr=subprocess.DEVNULL, text=True).strip()
        git("init", "-b", "fix/corpus-offset-ability")
        git("config", "user.name", "Publisher test")
        git("config", "user.email", "publisher-test@example.invalid")
        git("add", ".")
        git("commit", "-m", "fixture")
        (harness / "results").mkdir()
        def publish():
            return subprocess.run([sys.executable, str(executable), str(self.run)], capture_output=True, text=True)
        self.assertEqual(publish().returncode, 0)
        first = git("rev-parse", "HEAD")
        self.assertEqual(publish().returncode, 0)
        self.assertEqual(git("rev-parse", "HEAD"), first)
        grade = self.directory / "grading"
        grade.mkdir()
        (grade / "manifest.json").write_text(json.dumps({"submissionSha256": p.sha((self.directory / "submission.json").read_bytes())}))
        (grade / "grade.json").write_text(json.dumps({"verdict": "CORRECT", "apiCalls": 1}))
        self.assertEqual(publish().returncode, 0)
        second = git("rev-parse", "HEAD")
        self.assertNotEqual(second, first)
        self.assertEqual(publish().returncode, 0)
        self.assertEqual(git("rev-parse", "HEAD"), second)
        result = json.loads((harness / "results/run/q1-r0.json").read_text())
        self.assertEqual(result["solverGit"], "frozen-git")
        self.assertNotIn("PRIVATE_", json.dumps(result))

    def test_wrong_recipe_rejected(self):
        self.finish()
        self.plan["recipeSha256"] = "other"
        with self.assertRaises(ValueError):
            self.receipt()


if __name__ == "__main__":
    unittest.main()
