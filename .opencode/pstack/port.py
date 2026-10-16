#!/usr/bin/env python3
"""Generate the OpenCode edition from a pinned upstream checkout."""
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SOURCE = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.home() / '.cache/pstack-upstream/pstack'
ROLES = [
    'feature, refactoring', 'bug-fix', 'perf-issue', 'hillclimb',
    'judgment and prose', 'hardest tasks', 'how explorer', 'how explainer',
    'why investigators', 'why synthesizer', 'reflect tooling',
    'reflect judgment, divergent, synthesizer', 'arena runners',
    'arena cross-judge pool', 'swarm workers', 'architect runners',
    'interrogate reviewers',
]
PANEL_ROLES = {'arena runners', 'architect runners', 'interrogate reviewers'}


def transform(text):
    replacements = {
        '~/.cursor/rules/pstack-models.mdc': '~/.config/opencode/pstack/models.md',
        'pstack-models.mdc': 'models.md',
        '~/.cursor/skills/': '~/.config/opencode/skills/',
        '~/.cursor/plugins/': '~/.config/opencode/pstack/',
        '.cursor/skills/': '.opencode/skills/',
        '.cursor/worktrees/': '.opencode/worktrees/',
        'subagent_type: "poteto-agent"': 'agent: "poteto-agent"',
        'subagent_type: "comment-sicko"': 'agent: "comment-sicko"',
        'subagent_type: generalPurpose': 'agent: general',
        '`subagent_type`': '`agent`',
        '`generalPurpose`': '`general`',
        '`run_in_background: true`': '`background: true`',
        '`readonly: true`': 'a read-only brief (no edits or writes)',
        '`readonly: false`': 'normal tool access with a no-write brief',
        '`environment: "cloud"`': 'an isolated worktree',
        '`environment: "local"`': 'the local working directory',
        '`Task`': '`subagent`',
        'a Task subagent': 'an OpenCode subagent',
        'Pick each subagent\'s reasoning level and fast or standard speed for the job, per the Subagents section of the **poteto-mode** skill.': 'Use the configured role model and only advertised variants, per the OpenCode runtime contract.',
        'Pick each subagent\'s reasoning level and fast or standard speed for the job, per the Subagents section.': 'Use the configured role model and only advertised variants, per the OpenCode runtime contract.',
        'Task tool': 'subagent tool',
        'Task spawn': 'subagent launch',
        'Task schema': 'subagent schema',
        'Task response': 'subagent response',
        'Task `model`': 'subagent `model`',
        'AskQuestion': 'question',
        "Cursor's built-in `create-skill`": 'the bundled `create-skill`',
        "Cursor's built-in for authoring SKILL.md files": 'the bundled OpenCode authoring adapter',
        "Cursor's built-in babysit skill": 'another harness-specific babysit skill',
        "Cursor's built-in babysit": 'another harness-specific babysit',
        "Cursor's `/loop` command": 'the available event watcher or an explicitly configured scheduler',
        'Cursor cloud agent': 'isolated OpenCode delegate',
        'Cursor restart': 'OpenCode restart',
        'Cursor environment': 'OpenCode tool catalog',
        'Cursor exposes for enabled MCP servers': 'OpenCode exposes for enabled MCP servers',
        'from `cursor-team-kit`': 'through the bundled OpenCode control adapter',
        'the `cursor-team-kit` plugin': 'the bundled OpenCode adapters',
        'from the `cursor-team-kit` plugin': 'from the bundled OpenCode adapters',
        'cursor-team-kit': 'OpenCode control adapters',
        'claude-opus-5-5-xhigh': 'inherit-parent',
        'grok-4.7-xhigh-fast': 'inherit-parent',
        "the system prompt names the path": 'use only an explicitly provided session export',
    }
    for before, after in replacements.items():
        text = text.replace(before, after)
    text = re.sub(r"Families go by prefix:.*?error message\.",
                  'Use exact provider/model IDs and #variants discovered from OpenCode. If a model is unavailable, report it and inherit the parent model; never invent a replacement ID.', text)
    text = re.sub(r"Families go by prefix:.*?Never treat an alias entry as a rejected slug or apply either fallback to it\.",
                  'Use only discovered provider/model IDs and #variants. An unavailable model falls back to parent inheritance with a disclosure.', text)
    text = text.replace('If it rejects the default, use the closest valid slug of the same family from its error message.',
                        'If an explicit model is unavailable, inherit the parent and disclose the loss of model diversity.')
    # History is obtained through supported session tools/exports, not Cursor's filesystem layout.
    text = re.sub(r"Transcripts live at .*?Every line is one chat message\.",
                  'History comes from project-scoped OpenCode session tools or an explicit export. See [the history contract](../../runtime.md#history). Never scan a global database or unrelated projects.', text)
    text = re.sub(r"~/.cursor/projects/[^` ]*", '<unrelated-project-history>', text)
    text = re.sub(r"`agent-transcripts/` directory[^.\n]*", 'project-scoped session export (see `runtime.md`, History)', text)
    text = text.replace('under the active workspace\'s `agent-transcripts/` directory', 'in an explicitly supplied project-scoped OpenCode session export')
    text = text.replace('under `agent-transcripts/`', 'from explicit session exports')
    text = text.replace("Otherwise inspect the `mcps/` directory OpenCode exposes for enabled MCP servers.",
                        'Otherwise inspect the available MCP tools or run `opencode mcp list`; do not assume a filesystem MCP catalog.')
    text = text.replace('readonly strips MCP', 'read-only behavior is enforced by permissions, not a readonly flag; retain MCP reads')
    text = text.replace('readonly strips MCPs', 'retain MCP read permissions')
    text = text.replace('retain MCP readss', 'retain MCP reads')
    text = re.sub(r'Every spawn is `general` with .*?Investigators still shouldn\'t write anything\.',
                  'Every investigator uses `agent: general` with an explicit no-write brief. Preserve MCP read access. Do not pass a readonly parameter; OpenCode uses agent permissions.', text)
    text = text.replace('the cloud agent\'s status in the Cursor dashboard', 'the host-provided delegate status')
    text = text.replace('each on its own cloud VM', 'each in its own isolated worktree with separately assigned runtime resources')
    text = text.replace('Each live lane runs on its own cloud VM', 'Each live lane runs in its own worktree with separately assigned runtime resources')
    text = text.replace('nesting works to depth 3, and a nested spawn has the full subagent schema including `environment`',
                        'nested delegation is capability-dependent; when unavailable, the parent dispatches leaf assignments directly')
    text = re.sub(r'- After a OpenCode restart:.*',
                  '- After an OpenCode restart: verify which processes or delegates still exist. Re-read standing orders and durable state. Resume from stored briefs, PRs, and branches; never assume background work survived.', text)
    text = text.replace('When a worker must start from a non-default pushed branch, pass `cloud_base_branch`.',
                        'When a worker needs a non-default base, create its isolated worktree from that explicit ref and name the path and branch in the brief.')
    text = text.replace('Cloud agents cannot read the local store', 'Delegates in remote host-managed environments cannot read the local store')
    text = text.replace('Verbatim paste is for cloud spawns', 'Verbatim paste is for remote delegates')
    text = text.replace('the cloud default and the local exception list', 'the worktree isolation policy and local resource assignments')
    text = text.replace('Chain rebases run in cloud. A local rebase at this scale takes the laptop down.',
                        'Run chain rebases in a dedicated worktree. Check available resources before dispatching large rebase jobs.')
    text = text.replace('a cloud-agent URL', 'a host-provided delegate reference')
    text = text.replace('via the loop skill, with a long heartbeat fallback', 'with a real host watcher or an explicitly requested scheduler, if available')
    text = text.replace('`/loop 1h`', 'an explicitly requested hourly host scheduler (if available)')
    text = text.replace('`/loop`', 'the host watcher/scheduler (when available)')
    text = text.replace('/loop until', 'continue within this run until')
    text = text.replace('`<unrelated-project-history>`', 'unrelated project history')
    # Every entrypoint gets the same capability contract, including leaf skills invoked alone.
    if text.startswith('---\n'):
        end = text.index('\n---', 4) + 4
        text = text[:end] + '\n\nBefore following this workflow, read `~/.config/opencode/pstack/runtime.md`. It defines OpenCode tool, model, history, isolation, and permission behavior.\n' + text[end:]
    return text


def generate():
    if not (SOURCE / 'skills/poteto-mode/SKILL.md').is_file():
        raise SystemExit(f'Not a pstack source directory: {SOURCE}')
    for folder in ('skills', 'agents', 'docs/guide'):
        for source in (SOURCE / folder).rglob('*'):
            if not source.is_file() or 'make-bot-ui' in source.parts:
                continue
            dest = ROOT / source.relative_to(SOURCE)
            dest.parent.mkdir(parents=True, exist_ok=True)
            if source.suffix == '.md':
                text = transform(source.read_text())
                relative = str(source.relative_to(SOURCE))
                if relative == 'skills/poteto-mode/SKILL.md':
                    start = text.index('**Defaults for every')
                    end = text.index('You own every subagent', start)
                    text = text[:start] + '''**Role models.** Read `~/.config/opencode/pstack/models.md`. Every role defaults to parent inheritance; omit `model` for `auto` and `inherit-parent`. Explicit choices must be discovered OpenCode provider/model IDs with advertised #variants. Use `background: true` for independent work when supported. Give delegates file pointers, narrow scope, success criteria, and this skill's absolute path.

**Reasoning and speed.** Use only configured, advertised variants. Change model or budget only when the user asks. A role name does not authorize fabricated reasoning suffixes or fast variants. Same-model independent reviewers are valid but do not claim model diversity. See the runtime contract for host delegation and nested-agent limitations.

''' + text[end:]
                elif relative == 'skills/reflect/SKILL.md':
                    start = text.index('Before fanning out,')
                    end = text.index('## 2.', start)
                    text = text[:start] + '''Use supported session/thread tools scoped to this exact conversation, or an explicit session export. Inspect its format before parsing. If neither is available, pass a clearly labeled digest of the visible conversation. Do not scan other projects or assume a JSONL directory layout. See `~/.config/opencode/pstack/runtime.md`, History.

''' + text[end:]
                elif relative == 'skills/poteto-mode/playbooks/opening-a-pr.md':
                    text = re.sub(r'\*\*Worktree\.\*\*.*?\n\n',
                                  '**Worktree.** Use an isolated git worktree from the intended base. Give concurrent writers separate branches/worktrees. Preserve all existing tracked and untracked user work. Never reset a dirty branch or discard changes to prepare a delegate. Follow host workspace tools when available.\n\n', text, count=1)
                elif relative == 'skills/poteto-mode/playbooks/worktree-cleanup.md':
                    text = re.sub(r'6\. Simulators and other reclaimers\..*',
                                  '6. Other reclaimers. Inspect only caches or simulators relevant to this machine and the requested cleanup. OpenCode session databases and configuration are user data, never disposable cache. Ask before deleting any worktree, simulator, or cache. Never infer a worktree is unused from unavailable chat history.', text)
                elif relative == 'skills/poteto-mode/playbooks/orchestrate.md':
                    text = re.sub(r'- After an? OpenCode restart:.*',
                                  '- After an OpenCode restart: re-read durable state, check which delegates still exist, and recover from stored briefs, PRs, and branches. Do not assume background work survived.', text)
                dest.write_text(text)
            else:
                shutil.copy2(source, dest)
    shutil.copy2(SOURCE / 'LICENSE', ROOT / 'LICENSE')
    for override in (ROOT / 'overrides').rglob('*'):
        if override.is_file():
            dest = ROOT / override.relative_to(ROOT / 'overrides')
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(override, dest)
            if override.suffix == '.sh':
                dest.chmod(0o755)
    # Keep documentation and workflow paths scoped to this repository.
    for path in ROOT.rglob('*.md'):
        if 'node_modules' not in path.parts:
            path.write_text(path.read_text().replace('~/.config/opencode/', '.opencode/'))
    # Bun is the installed runtime; the plan checker is runtime-neutral JavaScript.
    checker_test = ROOT / 'skills/poteto-mode/scripts/check-plan.test.ts'
    checker_test.write_text(checker_test.read_text().replace('spawnSync("node",', 'spawnSync(process.execPath,'))
    for agent in (ROOT / 'agents').glob('*.md'):
        text = agent.read_text()
        text = text.replace('---\n', '---\nmode: subagent\n', 1)
        # Cursor display metadata is not OpenCode agent configuration.
        text = re.sub(r'^(?:name|icon|color):.*\n', '', text, flags=re.M)
        if agent.stem == 'comment-sicko':
            text = text.replace('mode: subagent\n', 'mode: subagent\npermissions:\n  - action: edit\n    resource: "*"\n    effect: deny\n  - action: shell\n    resource: "*"\n    effect: deny\n')
        agent.write_text(text)
    # Keep the lockfile in sync with the package name without resolving new dependencies.
    for name in ('package.json', 'bun.lock'):
        path = ROOT / 'skills/poteto-mode/scripts' / name
        path.write_text(path.read_text().replace('@cursor-skill/poteto-mode-tools', '@opencode-skill/poteto-mode-tools'))
    models = ROOT / 'models.md'
    if not models.exists():
        models.write_text('# pstack model configuration\n# budget: inherit\n' + '\n'.join(
            f'{role}: ' + ('inherit-parent, inherit-parent' if role in PANEL_ROLES else 'inherit-parent')
            for role in ROLES) + '\n')
    revision = subprocess.check_output(['git', '-C', str(SOURCE), 'rev-parse', 'HEAD'], text=True).strip()
    (ROOT / 'upstream.json').write_text(json.dumps({'repository': 'https://github.com/cursor/plugins', 'path': 'pstack', 'commit': revision, 'excluded': ['automations/benny', 'skills/make-bot-ui', 'Cursor plugin manifests']}, indent=2) + '\n')
    config = ROOT.parent
    for kind in ('skills', 'agents'):
        for item in (ROOT / kind).iterdir():
            # Preserve the user's existing TDD skill, which predates this installation.
            name = 'pstack-tdd' if kind == 'skills' and item.name == 'tdd' else item.name
            target = config / kind / name
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.is_symlink() and target.resolve() == item.resolve():
                continue
            if target.exists() or target.is_symlink():
                raise SystemExit(f'Refusing to replace existing definition: {target}')
            target.symlink_to(os.path.relpath(item, target.parent), target_is_directory=item.is_dir())
    print(f'Installed {len(list((ROOT / "skills").glob("*/SKILL.md")))} skills and 2 agents at {config}; upstream {revision}')


if __name__ == '__main__':
    generate()
