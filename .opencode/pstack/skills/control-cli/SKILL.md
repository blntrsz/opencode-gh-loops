---
name: control-cli
description: Verify a CLI or TUI with shell commands, captured exit codes and output, and an available PTY driver when needed.
disable-model-invocation: true
---

Read `.opencode/pstack/runtime.md`. Read the project's `verify-*` skill or CLI documentation. Run the actual command in an isolated fixture/worktree with task-owned data paths. Capture stdout, stderr, exit status, and observable persisted effects. For an interactive TUI, discover an available PTY/terminal driver rather than assuming ordinary shell output proves interaction. If none exists, report interactive verification blocked. Use timeouts and clean up only processes/resources created by this check. Do not install remote control infrastructure without permission.
