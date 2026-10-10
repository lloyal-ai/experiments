# Lloyal experiments

Source, protocols and measurement records for comparing Lloyal's execution model with conventional agent applications.

| Experiment | Status | Start here |
| --- | --- | --- |
| [Memory](experiments/memory/) | CUDA capacity measurements, Fieldnote workload comparison and runnable benchmark setup | [Setup and commands](experiments/memory/README.md) |
| [Reasoning](experiments/reasoning/) | Historical exploratory observations; dedicated causal experiment pending | [Existing evidence and open controls](experiments/reasoning/README.md) |

Each experiment owns its dependencies, fixtures, protocols and results. Run commands from that experiment's directory. Recorded results retain their original scope and limitations; setup portability changes do not constitute a new benchmark run.

The memory experiment includes the pinned Fieldnote application and its web UI, an idiomatic LangGraph JS host, and native/server instrumentation. Large runtime artifacts, model weights and raw session archives are excluded from Git. The records identify what is included and what still requires a separate evidence archive.
