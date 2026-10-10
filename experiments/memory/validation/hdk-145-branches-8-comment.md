Follow-up diagnostic: increasing model.llm.branches from 5 to 8 (context still 32,768) allowed the reviewed Survey to complete synthesis and save/reopen its brief. The pinned native entry, addon, libllama, model, projector, reranker and frontend hashes are unchanged. No SDK fix was applied.

The successful attempt had four concurrent inquiries (three normal returns and one recovered result), 22 tool calls and 5,814 reported research tokens. Synthesis produced 2,021 tokens in 97.1 seconds. These are diagnostic observations, not a controlled timing comparison: eight branches changes inquiry admission, and model-selected ability routing/results differed.

Trace order in the eight-branch session:

```text
18242 research:done
18243 synthesize:start
18267 agent:spawn       agent=196612 parent=196615
24575 synthesize:done   tokenCount=2021
24583 answer           chars=5717
24585 complete
24591 branch:prune      handle=196611 position=-1
24592 branch:prune      handle=131077 position=-1
24593 scope:close       research pool
```

There were no pool:spawnRefused events in this completed attempt. The final inquiry branch cleanup receipts still arrive after completion, consistent with the suspected lifetime boundary; more capacity is a workaround, not proof of a fix. A constrained regression remains pending.

The first eight-branch attempt was deliberately aborted after an incomplete UI plan edit and retained as a controller failure. The completed repeat used all four declared objectives. Its full output-quality gate still failed on missing corpus cost facts and malformed citation identities; those are separate from this sequence-allocation result.
