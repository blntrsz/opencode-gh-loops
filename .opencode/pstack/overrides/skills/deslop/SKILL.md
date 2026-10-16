---
name: deslop
description: Review the scoped diff for generated-code noise and remove unnecessary scaffolding without changing behavior.
disable-model-invocation: true
---

Read `.opencode/pstack/runtime.md`. Inspect only the task's diff and surrounding contracts. Remove narrating comments, dead code, unsupported defensive branches, one-use scaffolding, and unrelated additions. Keep external boundary validation, necessary compatibility behavior, public contracts, and license notices. Do not erase pre-existing user work. Run the relevant checks and report the exact changes and evidence. Use `no-comments` for the independent comment review when requested by the parent workflow.
