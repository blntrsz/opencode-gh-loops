---
name: create-skill
description: Author or edit OpenCode skills with valid frontmatter, scoped instructions, and verified references.
disable-model-invocation: true
---

Read `.opencode/pstack/runtime.md`.

1. Read the existing skill and its callers before changing it. Define the task trigger and observable completion criteria.
2. Put project skills at `.opencode/skills/<id>/SKILL.md` or personal skills at `.opencode/skills/<id>/SKILL.md`. Use a unique lowercase kebab-case ID. Include YAML `name` and `description`; use `disable-model-invocation: true` only for explicit invocation. Keep scripts and references next to the entrypoint.
3. Write ordered, checkable steps. Disclose branch-specific references behind clear pointers. Use only tools and capabilities actually available. Load `writing-for-agents` if available.
4. Check frontmatter, local links, script syntax, and path resolution. Exercise a representative task safely. State what was tested and what remains untested. Preserve unrelated user edits. Iterate on failures before reporting completion.
