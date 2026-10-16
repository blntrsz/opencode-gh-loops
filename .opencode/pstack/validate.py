#!/usr/bin/env python3
"""Check generated OpenCode definitions and local Markdown references."""
import re
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parent
errors = []
skills = list((ROOT / 'skills').glob('*/SKILL.md'))
for path in skills + list((ROOT / 'agents').glob('*.md')):
    text = path.read_text()
    try:
        frontmatter = yaml.safe_load(text.split('---', 2)[1])
        assert isinstance(frontmatter, dict) and frontmatter.get('description')
        if path.parent.name == 'agents':
            assert frontmatter.get('mode') == 'subagent'
    except (AssertionError, IndexError, yaml.YAMLError) as exc:
        errors.append(f'{path}: invalid frontmatter: {exc}')
    name = 'pstack-tdd' if path.parent.name == 'tdd' else path.parent.name
    link = ROOT.parent / 'skills' / name if path.parent.name != 'agents' else ROOT.parent / 'agents' / path.name
    expected = path if path.parent.name == 'agents' else path.parent
    if not link.is_symlink() or link.resolve() != expected.resolve() or Path(link.readlink()).is_absolute():
        errors.append(f'{path}: missing installation link {link}')

for path in (ROOT / 'skills').rglob('*'):
    if not path.is_file() or 'node_modules' in path.parts:
        continue
    if path.suffix not in {'.md', '.sh'}:
        continue
    text = path.read_text()
    for forbidden in (r'~/.config/opencode/', r'~/.cursor/', r'\$HOME/.cursor/', r'\.cursor/skills/', r'claude-opus-5-5', r'grok-4\.7', r'subagent_type:', r'run_in_background:', r'agent-transcripts/', r'git reset --hard'):
        if re.search(forbidden, text):
            errors.append(f'{path.relative_to(ROOT)}: leftover harness dependency {forbidden}')
    if path.suffix == '.md':
        for target in re.findall(r'\[[^\]]*\]\(([^)]+)\)', text):
            target = target.split('#', 1)[0]
            if not target or target == 'url' or ':' in target or target.startswith(('/', '~', '<')):
                continue
            if not (path.parent / target).exists():
                errors.append(f'{path.relative_to(ROOT)}: broken relative link {target}')

assert not errors, '\n'.join(errors)
print(f'Validated {len(skills)} skills, 2 subagents, installation links, local references, and absence of legacy harness dependencies.')
