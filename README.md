# OpenCode GitHub Loops

Single-package Bun + Vite+ repository for publishing reusable GitHub Actions.
The action currently emits a greeting as a minimal, tested starter; loop behavior
is not implemented yet.

## Development

Use Node.js 24.11+ (24.x) and Bun 1.4.3. Vite+ is pinned locally to 1.3.0;
no global `vp` installation is required. Bun manages dependencies while Node.js
runs the Vite+ toolchain and the published action.

```sh
bun install --frozen-lockfile
bun run check
bun run test --run
bun run build
bun run dev
```

`bun run dev` watches and bundles the action with `vp pack --watch`. There is no
web app or dev server. For a future web app, `bunx vp dev` starts Vite's dev
server. `bunx vp run <task>` runs package scripts/tasks; built-ins such as
`bunx vp test` invoke the underlying tool directly. Avoid `bun test`, which
uses Bun's test runner rather than Vite+'s bundled Vitest.

Tool configuration lives in `vite.config.ts`. `vp pack` bundles the action and
its dependencies into `dist/index.mjs`, with no consumer-side install needed.
`dist/` is build output and is not tracked; run `bun run build` to regenerate it.
CI checks formatting, linting, types, tests, rebuilds the bundle, and verifies
the action's input/output contract.

## Use the action

After publishing this repository and creating a release tag, replace
`OWNER/REPOSITORY@v1` with your repository and released ref (prefer an immutable
commit SHA for production consumers):

```yaml
steps:
  - uses: OWNER/REPOSITORY@v1
    id: loops
    with:
      name: Octocat
  - run: echo "$GREETING"
    env:
      GREETING: ${{ steps.loops.outputs.greeting }}
```

This is a JavaScript action using GitHub's Node 24 runtime. Self-hosted runners
must support `node24` (runner v2.327.1 or newer). Add future actions in dedicated
subdirectories with their own `action.yml` and pack entry points, without
requiring a monorepo.

## Releasing

Implement the intended action behavior and update its metadata/tests first.
Run all checks and rebuild the bundle with `bun run build`. GitHub executes the
bundle from the selected ref, not TypeScript source, so the release ref must
contain a built `dist/`; force-add it (`git add -f dist`) on the release commit.
Publish a version tag and, if desired, move a major-version alias such as `v1`
to that release. No automatic publishing or tag movement is configured.
