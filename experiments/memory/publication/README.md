# Publication provenance

The initial import captures the existing `lloyal-bench` workspace on 10 October 2026. `import-manifest.json` records hashes of the original files before portability changes, with paths relative to the old workspace. No measurement values were changed. This publication did not rerun GPU benchmarks.

Publication changes:

- Place the runnable package under `experiments/memory`; reserve `experiments/reasoning` for the next experiment and preserve earlier reasoning observations there.
- Keep the pinned Fieldnote reference and both working-copy sources, original fixtures, package locks, ability archives, extracted content helpers and component notices.
- Exclude installed packages, model weights, generated builds, runtime libraries and historical raw session archives from Git.
- Replace executable developer-machine paths with experiment-relative config paths or explicit environment settings.
- Add exact-commit native-source preparation with patch-hash verification. Both native/server builds retain the same engine revision and measurement patches.
- Offer source-only verification separately from the original platform-specific installed-dependency digest.
- Make UI copying portable and preserve its existing presentation/observation patch.
- Make the CUDA suite use fresh timestamped output directories by default and the checkout's own path.
- Relocate the unchanged protocol files to `protocols/` and the experiment history to `docs/MEMORY.md`.
- Make the compact capacity chart generator write beside its measurements.

Fieldnote orchestration, graph/model calls, budgets, sampling defaults, memory instrumentation and fixture bytes are preserved. In particular, this publication does not fix the sampling confounds in the historical reasoning observations. Future experiments must freeze their own effective settings.

Historical manifests retain original paths and hashes to identify their source evidence. Those paths do not resolve in a fresh checkout. The compact CUDA result has no full raw archive attached yet; regenerate its charts from the bundled measurements, or run a new experiment to collect independent raw evidence.
