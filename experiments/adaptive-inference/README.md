# Adaptive inference evaluation

Benchmark solvers composed from Lloyal's released SDK, agents and rig APIs. The objective is stronger task performance from fixed model weights through inference-time planning, exploration, verification and selection.

Implementation and GPU execution happen on Brev. This directory is independent of the earlier memory and reasoning experiments. The first checkpoint pins the current public runtime; runner and benchmark adapters follow in subsequent commits.

## Environment

- Node.js 24 or newer; `npm ci` restores exact package versions.
- NVIDIA CUDA GPU for native evaluations. CPU fallback must be disabled.
- Docker for isolated execution of generated programs.
- Model weights, downloaded benchmarks and run artifacts stay outside Git.

The lockfile pins SDK 5.1.0, agents 7.1.0, rig 6.1.0 and the transitive native binding 4.1.0. `Branch.fastForward` is available through the SDK. Harness code must use public APIs; no native addon access or replacement scheduling loop.

## Recovery

Fetch branch `feat/adaptive-inference-evals` in `lloyal-ai/experiments`, run `npm ci` in this directory, and supply the model path from the new machine. Each working checkpoint is committed and pushed. Runs will carry model, source, dependency and dataset identities so a restarted machine does not silently change an experiment.

## Evaluation boundaries

Only public problem statements, starter code and public examples reach solvers. Hidden tests grade frozen submissions in a separate phase. Development runs are labeled as such; a small pilot is not a benchmark score. The benchmark shortlist remains open, and adapters are chosen for executable feedback and demonstrated opportunity.
