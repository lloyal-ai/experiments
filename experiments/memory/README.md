# Memory: Fieldnote and agent capacity

Run the pinned Fieldnote web application against Lloyal or an idiomatic LangGraph JS host backed by llama-server. The capacity diagnostic uses HDK's public `withSpine`, `agentPool` and `parallel` APIs and ordinary LangGraph `StateGraph`/`Send` calls. Both paths generate real answers from the same fixtures; no mocked inference enters the measurements.

The [CUDA measurement record](results/cuda-agent-capacity-2026-10-10/README.md) contains the published 128-agent comparison, all 42 projected trial outcomes, prefix-cache receipts, source identities and Matplotlib chart code. At that width, the recorded Lloyal run used **56.6% less total model/worker GPU memory**, with **256/256 correct answers on both paths**. This is one completed trial per backend at 128 agents, under the recorded serving configuration. Recurrent-state cost is included in total GPU memory and plotted separately from attention allocation.

| Included | Location |
| --- | --- |
| Compatible LangGraph host and measurement code | `src/` |
| Pinned Fieldnote source and original dependency lock | `reference/fieldnote-app/` |
| Shared UI and instrumented native working copies | `work/fieldnote-app/`, `work/fieldnote-instrumented/` |
| Original PDF, images and Markdown corpus | `fixtures/generated/` |
| Protocols and full experiment history | `protocols/`, [memory record](docs/MEMORY.md) |
| Native instrumentation patches and base commits | `instrumentation/patches/` |
| Compact results and regenerable figures | `results/` |
| Import provenance and publication checks | `publication/` |

Commands below run from **`experiments/memory`**, not the repository root. These instructions prepare a new experiment; they do not reproduce the old machine's binary hashes automatically.

## Inspect existing results without a GPU

```sh
git clone https://github.com/lloyal-ai/experiments.git
cd experiments/experiments/memory
python3 -m venv .venv-plots
.venv-plots/bin/python -m pip install -r scripts/requirements-plots.txt
.venv-plots/bin/python results/cuda-agent-capacity-2026-10-10/plot.py
```

The plots are written beside `measurements.json`. Read the [measurement record](results/cuda-agent-capacity-2026-10-10/README.md) for the distinction between total GPU memory, allocated attention, recurrent state and useful concurrency. The engine's sequence ceiling and uncompleted HTTP widths prevent a physical maximum-agent ratio claim.

## Prepare the CUDA setup

The recorded Brev configuration used one NVIDIA L40S, Node.js **24.6.0**, CUDA **12.6.85**, compute capability **89**, and llama.cpp revision `d6d0ce8215a1c324e8de04b52f9dd65c5edc129f`. Use a VM with the NVIDIA driver, CUDA compiler, Git, CMake, Ninja, a C++ compiler, Python/venv and Node 24 installed. Jupyter is not required. The bootstrap does not provision a VM, alter firewall rules or install system packages.

1. Place the matching model files under `models/` or set their paths in `bench.config.json`. The same Fieldnote weights are used by both arms. Models are not bundled.

   | File | SHA-256 |
   | --- | --- |
   | `qwen3.5-4b.gguf` | `00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4` |
   | `qwen3.5-4b-mmproj.gguf` | `cd88edcf8d031894960bb0c9c5b9b7e1fea6ebee02b9f7ce925a00d12891f864` |
   | `qwen3-reranker-0.6b-q8.gguf` | `22c9979ce4fbcdc5acdc310c6641c32797eff1aa980b8f7a2db8a8ea23429a48` |

2. Prepare dependencies and the pinned instrumentation sources:

   ```sh
   bash scripts/bootstrap-linux.sh
   . setup/environment.sh
   node scripts/verify-models.mjs
   node scripts/build-memory-instrumentation.mjs
   npm run doctor
   npm run bench -- memory doctor
   ```

   The bootstrap installs the pinned Fieldnote packages, builds its web UI, checks that the published CUDA addon sees the GPU, then links the local instrumented addon into the native working copy. `prepare-instrumentation.mjs` fetches exact public commits and verifies patch hashes before applying them. Existing mismatched checkouts are refused. The native and HTTP builds use the same instrumented engine source.

   `setup/environment.sh` defaults to L40S architecture 89 and eight build jobs. Set `LLOYAL_BENCH_CUDA_ARCH` and `LLOYAL_BENCH_BUILD_JOBS` explicitly for different hardware before building. Record that as a new condition.

3. For the automated Fieldnote UI journey, install a browser separately:

   ```sh
   npm install --prefix setup/browser --save-exact playwright@1.62.1
   setup/browser/node_modules/.bin/playwright install chromium
   export PLAYWRIGHT_MODULE="$PWD/setup/browser/node_modules/playwright"
   ```

   Browser identity is recorded with each run. Install any Chromium system libraries required by your VM image before using the automated driver.

## Run a new experiment

Start with the small GPU canary:

```sh
npm run bench -- memory run --counts 2 --repeats 1 --rounds 1 \
  --output comparisons/cuda-canary
```

Then run the capacity diagnostic. Use a new output directory for a new protocol:

```sh
npm run bench -- memory capacity --http-default-layout \
  --output comparisons/my-cuda-capacity
npm run bench -- memory capacity --analyze --output comparisons/my-cuda-capacity
.venv-plots/bin/python scripts/report_cuda_capacity.py comparisons/my-cuda-capacity
```

The capacity command records calibration, all successes and failures, exact answers, requested/observed concurrency, engine allocations, GPU samples and prefix-cache receipts. The HTTP arm has prefix-cache enabled and separate KV streams per slot. The repaired transport deadline is 1,800 seconds per round; it is not an interactive latency target. `--resume` preserves completed outcomes and checks protocol/source identities.

The composed Fieldnote journey is a separate experiment with PDFs, vision, retrieval, reranking, preflight, planning, synthesis and follow-up:

```sh
npm run bench -- memory composed --browser-channel chromium \
  --output comparisons/my-fieldnote-workload
```

This drives the actual shared Fieldnote UI, both backends sequentially. The composed HTTP workload retains its recorded four-slot **unified** KV configuration; it differs from the capacity diagnostic's separate-stream layout. Quality is marked unreviewed until the outputs are evaluated. A completed journey does not establish equivalent answer quality.

For an unattended sequential suite, `bash scripts/run-cuda-suite.sh` creates timestamped result directories. Use a terminal multiplexer on the VM. Set `LLOYAL_BENCH_SUITE_ID` to a previous identifier only when deliberately resuming its unchanged protocol.

## Use Fieldnote interactively

```sh
./start.command fieldnote --instrumented --port 8100 --corpus fixtures/generated/corpus
# Ctrl-C and wait for shutdown before starting the other backend.
./start.command langgraph --instrumented --port 8100 --corpus fixtures/generated/corpus
```

For a remote VM, forward the port from your own machine:

```sh
ssh -N -L 8100:127.0.0.1:8100 YOUR_SSH_HOST
```

Open `http://127.0.0.1:8100`. The host binds to loopback; no public HTTP port is required. Only one model stack runs at a time. The main HTTP model and reranker belong to one stack. HTTP continuation is labelled **Transcript resent over HTTP**; warm KV is never inferred from saved messages.

## Verification without model inference

```sh
npm run fieldnote:verify
npm run typecheck
npm test
python3 -m unittest discover -s scripts -p 'test_raw_log_metrics.py' -v
```

The package tests use scripted responses for contract checks and a native Markdown parsing oracle; they do not create benchmark inference measurements. Fieldnote's installed dependency tree must be present for the oracle. `fieldnote:verify` checks the exact source snapshot; the historical installed-tree digest is platform-specific and retained as provenance. Use `node scripts/snapshot-fieldnote.mjs --verify` only to check that original installed-tree identity.

## Publishing another benchmark

Keep each result under `results/<name>/` with the frozen protocol, source/model/binary hashes, full attempt inventory, quality status, plotting code and limitations. Preserve original raw journals before deriving summaries. Large evidence bundles can be published separately as versioned release assets with SHA-256 manifests, then linked from the result.

This initial repository contains compact published measurements and source provenance. **It does not include the full historical raw session archives**, compiled addons, model weights or installed packages. Existing chart values can be regenerated; independent raw-log reanalysis requires those archives. New runs write their full evidence to ignored `comparisons/` and `sessions/` directories.

The [local research record](docs/LOCAL-RESEARCH-RECORD.md), [implementation plan](IMPLEMENTATION-PLAN.md) and [workload audit](WORKLOAD-AUDIT.md) retain the development history, including invalid prototypes and corrected attempts. Historical absolute paths identify the original evidence; they are not setup requirements. Publication portability changes are listed in [publication/README.md](publication/README.md).
