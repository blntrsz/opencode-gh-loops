---
name: poteto-help
description: Explain this OpenCode edition of pstack and route a task to a skill or playbook.
disable-model-invocation: true
---

Read `.opencode/pstack/runtime.md`. Answer the help question without starting an implementation run. Read the target skill before recommending it.

- Start rigorous work with `@poteto-mode` followed by a goal and a checkable finish condition. It selects a playbook and reads principles as needed.
- Configure per-role models with `@setup-pstack`. Defaults inherit the current model; panels still have two seats. Configuration lives in `.opencode/pstack/models.md`.
- Understand code with `@how`, history with `@why`, and an explanation with `@teach`.
- Explore designs with `@architect` or `@arena`; review changes with `@interrogate`; partition independent work with `@swarm`.
- Verify behavior with `@create-verification-skill`, `@control-ui`, or `@control-cli`.
- Clean code with `@deslop` and `@no-comments`, and prose with `@unslop` or `@technical-writing`.
- Recover current context with `@recall`, resume one branch through poteto-mode's Session pickup playbook, or propose skill improvements with `@reflect`.

Skills live at `.opencode/skills/`; agents at `.opencode/agents/`. The port's README explains installation and limitations. This edition has no Cursor Custom Modes, cloud VM default, `/loop`, Benny automation, or Grok Bot UI. History requires supported session tools or an explicit export. Do not claim those features exist under renamed OpenCode commands.

Give one concrete prompt and link the installed file that owns the answer. Upstream links describe Cursor behavior and are provenance, not documentation for this port.
