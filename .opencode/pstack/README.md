# pstack for OpenCode V2

An OpenCode adaptation of [pstack](https://github.com/cursor/plugins/tree/main/pstack), MIT licensed. Installed only in this repository's `.opencode/` directory. The pinned source revision is in `upstream.json`. No application source or global OpenCode settings are changed.

## Use

Start a new OpenCode session after installation so it discovers the added definitions. Invoke skills with:

```text
@poteto-mode <goal and checkable finish condition>
@setup-pstack
@poteto-help
```

The native `poteto-agent` and `comment-sicko` profiles are subagents, not primary modes. The comment reviewer denies edit and shell tools. Each workflow reads `runtime.md`; each role inherits the current model until configured in `models.md`. Same-model panels remain independent reviews, not multi-model reviews.

## Port decisions

- Project skills and agents are linked from `.opencode/{skills,agents}` into this directory with relative, checkout-portable links. Existing definitions are never replaced by the installer.
- Your existing `tdd` skill is preserved; the imported version is exposed as `@pstack-tdd`.
- Cursor Task calls become OpenCode subagent calls. Model choices use discovered provider/model IDs and variants instead of hardcoded Cursor slugs.
- The model mapping is explicitly read Markdown, not a Cursor always-applied rule. No global instruction injection is needed.
- Concurrent writers need separate worktrees. They do not receive a cloud VM. Native child delegation may be restricted.
- History uses project-scoped session tools or explicit exports, not Cursor JSONL directories or direct database access.
- Long tasks require an actual host watcher/scheduler for wakeups. No `/loop` or persistent Custom Mode is invented.
- Local `create-skill`, `deslop`, `control-ui`, and `control-cli` adapters replace Cursor built-ins/team-kit dependencies. Browser and PTY drivers remain optional external capabilities.
- Benny and `make-bot-ui` are not installed. Their Cursor automation services have no native OpenCode equivalent.
- Imported playbook autonomy never expands the user's authorization or overrides host permissions.

The imported guide is background material from upstream. `runtime.md`, this README, and the installed skill overrides own OpenCode-specific behavior.

## Regenerate

The reusable porter copies skills, scripts, references, agents, and the guide, transforms harness syntax, then applies curated files from `overrides/`:

The porter needs Python 3; the validator also needs PyYAML. The bundled tools use Bun, which is already installed here. The plan-checker tests use the current runtime instead of requiring a separate Node executable.

```sh
python3 .opencode/pstack/port.py /path/to/cursor-plugins/pstack
python3 .opencode/pstack/validate.py
```

Regeneration replaces generated files. Make local customizations in `overrides/` first. `models.md` is preserved. Inspect and pin the upstream revision before regenerating; updates are not automatic. Review newly introduced harness assumptions after every upstream update.

Bundled tool checks:

```sh
cd .opencode/pstack/skills/poteto-mode/scripts
bun install --frozen-lockfile
bun test orch watch-pr check-plan.test.ts
bun run typecheck
```
