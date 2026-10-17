import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { cleanEnvironment, processRun } from "../src/_agent/process.ts";

const root = await mkdtemp(join(tmpdir(), "review source action "));
try {
  const action = join(root, "trusted action");
  const home = join(root, "home");
  await mkdir(action);
  await mkdir(join(home, "tmp"), { recursive: true });
  for (const file of ["package.json", "bun.lock"])
    await cp(join(import.meta.dirname, "..", file), join(action, file));
  await cp(join(import.meta.dirname, "..", "src"), join(action, "src"), {
    recursive: true,
    filter: (path) => basename(path) !== "node_modules",
  });
  await mkdir(join(action, "scripts"));
  await cp(
    join(import.meta.dirname, "smoke-worker.ts"),
    join(action, "scripts", "smoke-worker.ts"),
  );
  const options = {
    cwd: action,
    env: cleanEnvironment(home),
    timeout: 180000,
    diagnostics: true,
  };
  await assert.rejects(access(join(action, "node_modules")));
  await assert.rejects(access(join(action, "dist")));
  await processRun(
    process.execPath,
    ["install", "--production", "--frozen-lockfile", "--ignore-scripts"],
    options,
  );
  await assert.rejects(access(join(action, "node_modules", "vite-plus")));
  for (const [env, message] of [
    [
      { ...options.env, GITHUB_REPOSITORY: "fixture/action" },
      /pr-number must be a positive integer/,
    ],
    [
      {
        ...options.env,
        GITHUB_REPOSITORY: "fixture/action",
        "INPUT_PR-NUMBER": "1",
        INPUT_BRANCH: "feature",
      },
      /Input required and not supplied: token/,
    ],
  ] as const) {
    const result = spawnSync(process.execPath, ["run", "./src/review/index.ts"], {
      cwd: action,
      env,
      timeout: 30000,
      encoding: "utf8",
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stdout + result.stderr, message);
  }
  await processRun(process.execPath, ["run", "scripts/smoke-worker.ts"], options);
  await assert.rejects(access(join(action, "dist")));
  console.log(
    "Source-only production action and isolated Bun TypeScript worker passed without a build.",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
