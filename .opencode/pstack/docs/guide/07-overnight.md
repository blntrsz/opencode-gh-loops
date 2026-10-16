# Long-running work

A long run needs a checkable finish condition, isolated writers, verification, and a decision log. `@poteto-mode` routes autonomous tasks to its playbook and `show-me-your-work` records decisions.

OpenCode cannot wake an ended session by itself. A persistent PR watcher or scheduler must come from a real host capability and be explicitly configured. Prefer the host's watch tool for PR monitoring. Without it, report a snapshot or perform an explicitly requested finite watch. Do not promise continued execution after shutdown.

Pause with a durable checkpoint that records intent, committed and uncommitted state, verification evidence, and the next action. Recover through the Session pickup playbook using supported session tools, an explicit export, or a branch and checkpoint. History access being unavailable is not evidence that earlier work never happened.

Benny and Grok Bot automations are excluded from this port. See [the runtime contract](../../runtime.md).
