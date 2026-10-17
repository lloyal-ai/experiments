#!/usr/bin/env python3
"""Publish whitelisted receipts only; never import solver or judge code."""
import argparse
import fcntl
import hashlib
import json
import pathlib
import re
import subprocess


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    return json.loads(path.read_text())


def pick(value, keys):
    return {key: value[key] for key in keys if key in value}


def grade_receipt(directory, submission_hash, track):
    if not (directory / "grade.json").exists():
        return None
    manifest = read_json(directory / "manifest.json")
    grade = read_json(directory / "grade.json")
    if manifest["submissionSha256"] != submission_hash:
        raise ValueError("Grade refers to a different submission")
    if grade["verdict"] not in ("CORRECT", "INCORRECT"):
        raise ValueError("Invalid verdict")
    return {
        "track": track,
        "verdict": grade["verdict"],
        "apiCalls": grade["apiCalls"],
        "manifestSha256": sha((directory / "manifest.json").read_bytes()),
        "gradeSha256": sha((directory / "grade.json").read_bytes()),
    }


def make_receipt(run, item, plan, manifest):
    qid, repeat = str(item["questionId"]), item["repeat"]
    if not re.fullmatch(r"[0-9]+", qid) or not isinstance(repeat, int) or repeat < 0:
        raise ValueError("Invalid attempt identifier")
    attempt_id = f"q{qid}-r{repeat}"
    directory = run / attempt_id
    # metrics.json is emitted only after the frozen submission and teardown.
    if not all((directory / name).exists() for name in ("submission.json", "metrics.json")):
        return None
    raw = (directory / "submission.json").read_bytes()
    sub, metrics = json.loads(raw), read_json(directory / "metrics.json")
    for key, expected in (("attemptId", attempt_id), ("questionId", qid), ("repeat", repeat),
                          ("recipeSha256", plan["recipeSha256"]), ("datasetRevision", plan["datasetRevision"])):
        if sub[key] != expected:
            raise ValueError(f"Submission identity mismatch: {key}")
    if metrics["id"] != attempt_id or metrics["status"] != sub["status"]:
        raise ValueError("Metrics/submission mismatch")
    if sub["status"] not in ("completed", "failed"):
        raise ValueError("Unfinished submission")
    if sub["status"] == "completed" and (not sub["answer"] or sub["failure"] is not None):
        raise ValueError("Inconsistent completed submission")
    submission_hash = sha(raw)
    interim = []
    for snapshot in sorted(run.glob("interim-*")):
        grade = grade_receipt(snapshot / attempt_id, submission_hash, "interim")
        if grade:
            interim.append({"snapshot": snapshot.name, **grade})
    return {
        "run": run.name,
        "attemptId": attempt_id,
        "questionId": qid,
        "repeat": repeat,
        "status": sub["status"],
        "solverGit": manifest["git"],
        "recipeSha256": plan["recipeSha256"],
        "datasetRevision": plan["datasetRevision"],
        "promptSha256": sub["promptSha256"],
        "submissionSha256": submission_hash,
        "metricsSha256": sha((directory / "metrics.json").read_bytes()),
        "answerSha256": sha(sub["answer"].encode()) if sub["answer"] else None,
        "failureRecorded": sub["failure"] is not None,
        "metrics": pick(metrics, ("elapsedMs", "generatedTokens", "peakLiveCells", "peakGpuMiB", "remainingCells", "availableSequences")),
        "input": pick(metrics.get("input", {}), ("inputTokens", "prefillMs")),
        "generatedByRole": pick(metrics.get("generatedByRole", {}), ("controller", "worker", "verifier", "selector", "synthesis")),
        "reranker": pick(metrics.get("reranker", {}), ("queries", "documents", "documentTokens", "queryTokens", "elapsedMs", "failed", "templateTokens")),
        "grading": {"final": grade_receipt(directory / "grading", submission_hash, "final"), "interim": interim},
        "rawArtifacts": "Private backup: full submission, trace, source documents and judge request/response; not included in this receipt.",
    }


def progress(receipts, plan):
    final = [r["grading"]["final"] for r in receipts if r["grading"]["final"]]
    interim = [r["grading"]["interim"][-1] for r in receipts if r["grading"]["interim"]]
    complete = len(final) == len(plan["planned"])
    return {
        "run": plan["label"], "planned": len(plan["planned"]), "finished": len(receipts),
        "solverFailures": sum(r["status"] == "failed" for r in receipts),
        "generatedTokens": sum(r["metrics"].get("generatedTokens", 0) for r in receipts),
        "solverElapsedMs": sum(r["metrics"].get("elapsedMs", 0) for r in receipts),
        "finalGrading": {"graded": len(final), "correct": sum(g["verdict"] == "CORRECT" for g in final)},
        "interimGrading": {"graded": len(interim), "correct": sum(g["verdict"] == "CORRECT" for g in interim), "fullSetComparison": False},
        "fullSetScorePercent": 100 * sum(g["verdict"] == "CORRECT" for g in final) / len(final) if complete else None,
        "status": "final-grading-complete" if complete else "in-progress",
        "note": "Completed execution is not correctness. Interim grades are separate observations, never substituted for the final grading track. All planned cases remain in the final denominator.",
    }


def write_json(path, value):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("run", type=pathlib.Path)
    args = parser.parse_args()
    harness = pathlib.Path(__file__).resolve().parent.parent
    run = args.run.resolve()
    if not re.fullmatch(r"[a-zA-Z0-9_-]+", run.name):
        raise ValueError("Unsafe run label")
    git = lambda *a: subprocess.run(["git", "-C", str(harness), *a], check=True, capture_output=True, text=True).stdout.strip()
    if git("branch", "--show-current") != "fix/corpus-offset-ability":
        raise ValueError("Wrong publishing branch")
    lock = run / "receipt-publisher.lock"
    with lock.open("w") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        if git("diff", "--cached", "--name-only"):
            raise ValueError("Refusing to commit someone else's staged changes")
        plan, manifest = read_json(run / "plan.json"), read_json(run / "manifest.json")
        destination = harness / "results" / run.name
        destination.mkdir(exist_ok=True)
        receipts = [receipt for item in plan["planned"]
                    if (receipt := make_receipt(run, item, plan, manifest)) is not None]
        for receipt in receipts:
            target = destination / f"{receipt['attemptId']}.json"
            if target.exists() and read_json(target) == receipt:
                continue
            action = "Update grade for" if target.exists() else "Record completed answer"
            write_json(target, receipt)
            summary = destination / "progress.json"
            write_json(summary, progress(receipts, plan))
            git("add", "--", str(target), str(summary))
            git("commit", "-m", f"{action} {receipt['attemptId']} in {run.name}")
            print(json.dumps({"attempt": receipt["attemptId"], "commit": git("rev-parse", "HEAD"), "action": action}), flush=True)
        summary = destination / "progress.json"
        value = progress(receipts, plan)
        if not summary.exists() or read_json(summary) != value:
            write_json(summary, value)
            git("add", "--", str(summary))
            git("commit", "-m", f"Refresh progress for {run.name}")


if __name__ == "__main__":
    main()
