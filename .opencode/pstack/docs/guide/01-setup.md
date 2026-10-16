# Set up pstack for OpenCode

The skills and agents are installed under `.opencode/`. Start a new session to discover them, then send:

```text
@poteto-mode <goal>. Done means <observable checks>.
```

Use `@setup-pstack` to select confirmed OpenCode models and variants per role. Defaults inherit the parent model, with two independent reviewer seats for panels. The mapping is in `.opencode/pstack/models.md` and is read directly by workflows.

For app verification, use `@create-verification-skill` to create a project-local `.opencode/skills/verify-<app>/` skill. It should launch, drive, and observe the real application before reporting a pass.

See [the OpenCode runtime contract](../../runtime.md) for capability limits and [the port README](../../README.md) for regeneration.
