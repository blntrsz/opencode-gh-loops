# Customize pstack

Use `@automate-me` to propose a personal skill from visible conversation evidence or explicitly scoped history. Use `@reflect` to propose improvements after a session. Approve the proposed edits before changing shared skills.

Project skills live at `.opencode/skills/<id>/SKILL.md`; global skills live at `.opencode/skills/<id>/SKILL.md`. The bundled `create-skill` adapter checks frontmatter, paths, references, and a representative task. Use an installed `writing-for-agents` skill when available.

For this generated port, keep customizations in `.opencode/pstack/overrides/` before regenerating. Model preferences belong in `models.md`, which regeneration preserves. The pre-existing TDD skill remains available as `@tdd`; the upstream pstack variant is `@pstack-tdd`.

See [regeneration instructions](../../README.md).
