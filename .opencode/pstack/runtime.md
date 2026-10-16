# OpenCode runtime contract

Read this once per session before running a pstack workflow. This file takes precedence over harness assumptions in the imported playbooks. Host instructions, user scope, and OpenCode permissions always take precedence over pstack.

This installation is repository-local. Resolve `.opencode/` paths from the repository root, not a nested working directory. When dispatching delegates, pass absolute paths resolved from this checkout. Keep configuration changes in this repository; do not install or update global definitions.

## Tools and delegation

Use OpenCode's `subagent` tool with `agent`, `prompt`, `description`, optional `model`, and `background`. Use `agent: "poteto-agent"` for implementation delegates and `agent: "general"` for independent panels. Use `agent: "comment-sicko"` for comment review. Pass poteto-mode's absolute SKILL.md path to implementation delegates. A missing custom agent is an installation problem, not permission to silently skip its instructions.

There are no `Task`, `subagent_type`, `environment`, or `readonly` parameters. Express read-only scope in the brief and enforce it with agent permissions where possible. Read-only does not inherently remove MCP access. Preserve read-only MCP lookups and prohibit external mutations in reviewer briefs. Use `question` for structured user choices. Use available todo tools when provided, otherwise keep the checklist in a file.

Spawn independent work concurrently where supported. Background completion is delivered by notification; do not poll or sleep. If an available tool cannot select custom agents or models, disclose the limitation and run sequentially or use a supported host delegation tool. Nested delegation may be disabled. A leaf delegate performs its assignment directly and returns evidence instead of trying to spawn unavailable children.

## Models

Read `.opencode/pstack/models.md` before assigning roles. It is a plain Markdown data file explicitly read by pstack, not an OpenCode rule or automatically loaded configuration.

The default for every role is `inherit-parent`: omit `model`. `auto` means the same. Panels keep their number of seats even when every seat inherits; call this independent review, not multi-model review. Use a different model family only when confirmed available.

Discover model IDs using the OpenCode models tool. Use exact `provider/model` IDs and only advertised `#variant` values. Never construct Cursor slugs, append `-fast`, rewrite reasoning suffixes, or assume a model family exists. If configured selection is unavailable, report the fallback to parent inheritance. Change a configured model or reasoning budget only at the user's request. For T3-owned or cross-provider child tasks use its live capability catalog and delegation API when present, following host instructions.

## Isolation

OpenCode subagents are not cloud VMs and share the filesystem. Give concurrent writers separate git worktrees and branches, or disjoint output directories for disposable artifacts. A worktree isolates files, not ports, processes, credentials, or installed tools. Assign those resources explicitly. Never promise work will survive a shutdown. Use a host's supported isolated delegation API if available; native `subagent` has no environment flag. Do not reset or discard existing work to prepare a delegate.

## History

OpenCode does not use Cursor's transcript directory layout. Use supported session tools scoped to the current project/session or an explicitly supplied export. When T3 owns the conversation, use its thread-read tools for the exact current thread. Do not scan unrelated chats, read a global database directly, or guess export paths. With no supported history access, use a clearly labeled digest of the visible conversation, request the specific export when essential, and mark historical evidence unavailable. JSONL parsing recipes in imported workflows apply only after inspecting the actual export format. Never fabricate a transcript audit or pinned-chat status.

## Persistent work and PRs

OpenCode has no built-in Cursor `/loop`, Custom Mode, Projects cloud runtime, or Grok Bot routine service. Invoke skills with `@poteto-mode`, `@how`, etc. Slash-style names in imported prose denote skills, not guaranteed commands. To keep the style in a session, explicitly ask to continue it; there is no Option+Enter mode toggle. A long-running task can continue within the current run but cannot wake itself after it ends without an actual scheduler or host watcher.

For PR monitoring, prefer the host's watch tool when present and end the turn. Follow host PR linking and unwatch requirements. Otherwise take one status snapshot or use the bundled bounded watcher for an explicitly requested finite watch; do not claim persistent monitoring. Never install a recurring schedule without the user's request. Never silently create a different service to emulate Cursor automation.

## Optional controls

This port bundles `create-skill`, `deslop`, `control-ui`, and `control-cli` adapters. They use real available OpenCode tools or a project's existing harness; they do not install Cursor team-kit. Browser/terminal automation and external MCP integrations still require those tools to exist. Report unavailable live verification as blocked, not passed.

## Authorization

Workflow defaults do not grant extra authority. Stay within the user's requested task. Ask before irreversible changes or external actions outside its scope. Never reset unrelated changes, delete caches or worktrees, send messages, create PRs, merge, deploy, or install infrastructure merely because a playbook mentions it. Preserve legal/license headers.
