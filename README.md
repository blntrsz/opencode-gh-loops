# OpenCode PR review

A reusable composite GitHub Action that reviews an exact PR snapshot and upserts one bot-owned Markdown summary. The action sets up Bun 1.4.3, installs locked production dependencies with lifecycle scripts disabled, and runs `bun run ./src/review/index.ts`. There is no JavaScript compilation or build step. Consumers do not need a repository checkout.

## Use the action

Run trusted action code on a Linux x64 runner with Git. Grant `contents: read` and `pull-requests: write`. Pin the action to a reviewed commit in production.

```yaml
permissions:
  contents: read
  pull-requests: write

concurrency:
  group: opencode-review-${{ github.event.pull_request.number }}
  cancel-in-progress: false

steps:
  - uses: blntrsz/opencode-gh-loops@main
    with:
      pr-number: ${{ github.event.pull_request.number }}
      branch: ${{ github.event.pull_request.head.ref }}
```

Use your repository's published action location in place of the example. No consumer checkout is required. Never execute PR code in a job with this action's write token. The repository's [dogfood workflow](.github/workflows/pr-review.yml) uses `pull_request_target` with only a trusted base checkout and disables persisted credentials. It never checks out or executes PR HEAD.

## Inputs and outputs

`pr-number` and `branch` are required. The branch must equal the PR API's `head.ref`. The action resolves base and head SHAs itself. Draft, closed, and fork PRs are skipped.

`model` defaults to exactly `opencode/deepseek-v4.1-flash-free`. Overrides use OpenCode's `provider/model` syntax. No provider credentials are inherited, so only models available without credentials work in this version. Availability and rate limits depend on the provider. The latest live attempt in both modes reached the provider but returned HTTP 403. Successful live inference remains unverified. The cause of the 403 is not established.

The worker disables the SDK's bundled model snapshot and waits for the live catalog on its fresh home. A missing requested model fails before generation. It never substitutes another model. Execution failures reach the action as bounded diagnostics with the error type, sanitized message, and optional HTTP status. Response bodies are omitted.

Without `skill`, the SDK invokes the actual built-in `/review` command against the pinned `review-base` ref. With `skill: pr-review`, it reads `.opencode/skills/pr-review/SKILL.md` and the files under that directory from the PR's base commit, registers that exact ID, and explicitly attaches it to the session prompt. Missing or empty skills fail. References must be inside the selected skill directory and are available through `review-reference`. Skills that need writes, arbitrary execution, or external references are unsupported. There is no caller prompt input and no fallback from a missing skill to native review.

`token` defaults to `${{ github.token }}`. Use a GitHub App installation token. The publisher resolves its authenticated bot identity through GraphQL and only updates a marked comment from that bot. Human-owned marker copies are ignored. Personal access tokens are not supported. Serialize runs per PR as shown above. Retries re-list comments before another write. A token needs private repository read access when applicable.

`status` is `published` or `skipped`. `summary-url` is the comment URL or an empty string. Reviews are free-form Markdown, bounded to 50,000 characters. This action does not invent a structured verdict or post inline findings. It rechecks both SHAs before publication and refuses stale output. A commit can still arrive after the last API check, so the summary includes both reviewed SHAs.

## Runtime and security limits

The action installs production dependencies and runs TypeScript in `github.action_path`, which contains the selected action revision, not PR source. The token input is mapped only to the review step, not the dependency installation step.

The review process owns the GitHub token. It fetches Git objects into an action-owned temporary repository using a transient Git HTTP header. It never checks out PR source, runs PR repository installs, or initializes submodules. Global Git config and hooks are disabled.

The SDK runs TypeScript in a separate Bun process with a fresh home, config, cache, state, and temporary directory. Its environment contains no GitHub token, provider keys, `NODE_OPTIONS`, `BUN_OPTIONS`, or inherited OpenCode configuration. Project configuration loading is disabled. MCP, custom commands, external plugins, and instruction discovery from PR files are unavailable. The worker removes built-in tools and exposes fixed snapshot diff, file-list, file-read, trusted-reference, and review-failure tools. There is no shell tool, write tool, model subagent, or general filesystem tool. Git reads disable external diffs and text conversion. A missing reference or a call to the review-failure tool prevents publication.

This process separation is not an OS sandbox. The worker still has network access and runs as the runner user. Do not use a runner containing unrelated secrets or sensitive files. PR text can influence the model, and source is sent to the selected provider. Skill references are trusted only because they come from the base commit. Review output is untrusted text. Mention characters are neutralized before publication.

The worker copies its TypeScript source and pinned manifest from `src/_agent/` into `RUNNER_TEMP`. The same Bun executable installs SDK 2.0.25 and Effect 4.0.0-rc.112 from that manifest with lifecycle scripts disabled, then runs that source directly. The manifest names exact versions for its four direct dependencies, so no lockfile is committed; transitive dependencies resolve at install time and are not pinned. No second runtime download or compiler is needed. The temporary installation is removed after success, failure, timeout, or cancellation. The runner needs outbound access to GitHub, the package registry, OpenCode's model catalog, and the inference provider. Installation adds network overhead on each run.

The worker uses `@opencode/sdk/effect` and `@opencode/plugin/effect` directly. An Effect scope owns the SDK and one event-stream fiber. Subscription readiness precedes session admission. A shared first-failure signal interrupts pending admission or completion when a hook, execution, or event stream fails. Scope teardown interrupts the consumer before the SDK finalizes. Only Git process calls adapt Promises inside the worker. `Effect.runPromise` appears at executable and test boundaries.

## Source layout

```text
src/
  _agent/    # Agent execution, process isolation, protocol, and pinned SDK dependencies
  review/   # GitHub review action, policy, publication, and snapshot preparation
    index.ts
```

Underscore-prefixed directories hold internal vertical slices. Named action directories hold their entrypoints and action-specific logic. The root `action.yml` packages the review entrypoint as a composite action. `bun.lock` lives only at the repository root; bundled skill scripts such as `.opencode/pstack/skills/poteto-mode/scripts/bun.lock` are the only other permitted lockfiles.

## Develop and verify

```sh
bun install --frozen-lockfile --ignore-scripts
bun install --cwd src/_agent --ignore-scripts
bun run --bun check
bun run --bun test --run
bun run smoke:failures
bun run smoke:stdin
bun run smoke:generation
bun run smoke
bun run smoke:action
test -z "$(git ls-files -- dist)"
```

The worker smoke installs the shipped TypeScript package into a fresh directory and initializes the real SDK under Bun. It checks native command expansion, the session model, explicit skill-content hydration, restricted tool registration, and Git-backed snapshot reads. Native review stops at the prompt hook. Skill review uses `resume: false` to hydrate the attachment without generation. The smoke does not test inference or remote publication.

`smoke:action` copies only source and manifests into a path containing spaces, installs production dependencies, runs the exact action command, and checks missing-input errors. It also runs the isolated worker smoke from that installation. It verifies that no development dependencies or `dist` artifacts are required or produced.

No-inference smoke tests use `src/_agent/smoke-models.json` with remote catalog fetching disabled. `smoke:failures` also serves a local catalog to test production startup, missing-model rejection, and execution-failure events in both review modes without inference. It interrupts blocked admission and checks that SDK plugin resources finalize within a bounded lifetime.

`smoke:generation` runs both production review modes in fresh credentials-free Bun children against a local mock OpenAI-compatible provider and catalog. It checks the exact default model, provider-visible native command or selected skill instructions, a real Git-backed `review-diff` tool call, and literal final Markdown extraction. The fixture serves SSE responses and verifies the introduced multiplication-to-addition regression in the next model request. Requests and child lifetimes are bounded, and temporary homes are removed. This is deterministic mocked-provider generation, not live model inference or remote publication.

`GitHubService` and `OpenCodeService` are Effect v4 `Context.Service` contracts. Their `Layer.effect` implementations own GitHub reconciliation and isolated SDK execution. The review policy depends on these contracts, so tests and alternate implementations can replace either service without changing the policy. `/dist/` remains ignored and untracked; nothing builds or executes it.
