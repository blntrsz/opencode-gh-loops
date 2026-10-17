# OpenCode PR review

A reusable Node 24 GitHub Action that reviews an exact PR snapshot and upserts one bot-owned Markdown summary. Consumers do not build the repository or install dependencies.

## Use the action

Run trusted action code on a Linux x64 runner with Git and unzip. Grant `contents: read` and `pull-requests: write`. Pin the action to a reviewed commit in production.

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

The bundled parent owns the GitHub token. It fetches Git objects into an action-owned temporary repository using a transient Git HTTP header. It never checks out source, runs repository installs, or initializes submodules. Global Git config and hooks are disabled.

The SDK runs in a separate Node 24 process with a fresh home, config, cache, state, and temporary directory. Its environment contains no GitHub token, provider keys, `NODE_OPTIONS`, or inherited OpenCode configuration. Project configuration loading is disabled. MCP, custom commands, external plugins, and instruction discovery from PR files are unavailable. The worker removes built-in tools and exposes fixed snapshot diff, file-list, file-read, trusted-reference, and review-failure tools. There is no shell tool, write tool, model subagent, or general filesystem tool. Git reads disable external diffs and text conversion. A missing reference or a call to the review-failure tool prevents publication.

This process separation is not an OS sandbox. The worker still has network access and runs as the runner user. Do not use a runner containing unrelated secrets or sensitive files. PR text can influence the model, and source is sent to the selected provider. Skill references are trusted only because they come from the base commit. Review output is untrusted text. Mention characters are neutralized before publication.

Worker dependencies are not bundled because the SDK uses native modules and dynamic imports. Each run downloads Bun 1.4.3 for Linux x64, verifies a pinned SHA-256, and installs the committed worker lockfile with lifecycle scripts disabled. Node 24 runs SDK 2.0.25 with Effect 4.0.0-rc.112. All runtime installation is confined to `RUNNER_TEMP` and removed after success, failure, timeout, or cancellation. No global installation occurs. The runner needs outbound access to GitHub, the package registry, OpenCode's model catalog, and the inference provider. Installation adds network overhead on each run.

## Develop and verify

```sh
bun install --frozen-lockfile
bun install --cwd worker --frozen-lockfile --ignore-scripts
bun run check
bun run test --run
bun run smoke:failures
bun run smoke:stdin
bun run smoke:generation
bun run build
bun run smoke
git diff --exit-code -- dist
```

Node 24 must be on `PATH` for the packaging smoke. `NODE_BINARY` can select an explicit Node 24 executable. The smoke installs the shipped worker package into a fresh directory and initializes the real SDK. It checks native command expansion, the session model, explicit skill-content hydration, restricted tool registration, and Git-backed snapshot reads. Native review stops at the prompt hook. Skill review uses `resume: false` to hydrate the attachment without generation. The smoke does not test inference or remote publication.

No-inference smoke tests use `worker/smoke-models.json` with remote catalog fetching disabled. `smoke:failures` also serves a local catalog to test production startup, missing-model rejection, and execution-failure events in both review modes without inference.

`smoke:generation` runs both production review modes in fresh credentials-free Node children against a local mock OpenAI-compatible provider and catalog. It checks the exact default model, provider-visible native command or selected skill instructions, a real Git-backed `review-diff` tool call, and literal final Markdown extraction. The fixture serves SSE responses and verifies the introduced multiplication-to-addition regression in the next model request. Requests and child lifetimes are bounded, and temporary homes are removed. This is deterministic mocked-provider generation, not live model inference or remote publication.

`GitHubService` and `OpenCodeService` are Effect v4 `Context.Service` contracts. Their `Layer.effect` implementations own GitHub reconciliation and isolated SDK execution. The review policy depends on these contracts, so tests and alternate implementations can replace either service without changing the policy. `dist/index.mjs` and `dist/worker` are release artifacts and must remain current.
