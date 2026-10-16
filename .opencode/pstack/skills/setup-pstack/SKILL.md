---
name: setup-pstack
description: Configure pstack role models and reasoning budgets for OpenCode. Use for setup-pstack, configure pstack models, or pstack budget.
---

# Configure pstack for OpenCode

Read `.opencode/pstack/runtime.md`, then `.opencode/pstack/models.md`. This file is explicitly read by the workflows; no OpenCode JSON configuration change is needed.

1. Discover available models and variants with the OpenCode models tool. If the host owns cross-provider delegation, consult its live capability catalog too. Never write a model ID that is not confirmed available.
2. Show the existing role mapping. With no file, use `inherit-parent` for all roles and two inherited seats for arena runners, architect runners, and interrogate reviewers. A cross-judge pool selects one entry rather than spawning all entries.
3. Ask whether to keep inheritance or choose discovered models per role. Ask for a reasoning budget only when the selected model advertises variants. Explain that panel seats cost tokens even on the same model. Use `question` when available.
4. Resolve each explicit choice to an exact `provider/model` or `provider/model#variant`. The aliases `auto` and `inherit-parent` omit the subagent model. Do not manipulate model-name suffixes or invent fast/max variants. Confirm the complete mapping before writing it.
5. Update only the approved role lines in `.opencode/pstack/models.md`; retain unrelated settings. Record the budget as a comment. Verify every explicit ID and variant against discovery, then read the saved file back. Workflows read it next time they assign roles; no restart is required for model mapping changes.
6. Report the saved path. If the project lacks a way to drive the actual app, offer `@create-verification-skill` once. Do not generate it without the user's agreement.

Role labels are `feature, refactoring`, `bug-fix`, `perf-issue`, `hillclimb`, `judgment and prose`, `hardest tasks`, `how explorer`, `how explainer`, `why investigators`, `why synthesizer`, `reflect tooling`, `reflect judgment, divergent, synthesizer`, `arena runners`, `arena cross-judge pool`, `swarm workers`, `architect runners`, and `interrogate reviewers`.

Each role is one line, for example `how explorer: inherit-parent`. Panel lists use commas between model entries; commas in role labels are part of the label. Split a line at the first colon, not at a comma.
