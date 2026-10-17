import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { installWorker } from "../src/_agent/runtime.ts";
import { cleanEnvironment, processRun } from "../src/_agent/process.ts";
import { decodeWorkerResult } from "../src/_agent/protocol.ts";

const root = await mkdtemp(join(tmpdir(), "review-package-smoke-"));
try {
  const home = join(root, "home");
  const repository = join(root, "snapshot");
  await mkdir(join(home, "tmp"), { recursive: true });
  await mkdir(repository);
  const env = cleanEnvironment(home);
  const git = (args: string[]) => processRun("git", args, { cwd: repository, env });
  await git(["init", "--quiet", "--template=", "--initial-branch=review-head"]);
  const blob = (
    await processRun("git", ["hash-object", "-w", "--stdin"], {
      cwd: repository,
      env,
      input: "snapshot fixture\n",
    })
  ).trim();
  await git(["update-index", "--add", "--cacheinfo", `100644,${blob},smoke.txt`]);
  await git([
    "-c",
    "user.name=Smoke",
    "-c",
    "user.email=smoke@example.invalid",
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "fixture",
  ]);
  const head = (await git(["rev-parse", "HEAD"])).trim();
  await git(["update-ref", "refs/heads/review-base", head]);
  const worker = await installWorker(process.cwd(), root, home);
  for (const mode of [{ type: "native" }, { type: "skill", id: "pr-review" }] as const) {
    const model = mode.type === "native" ? "opencode/deepseek-v4.1-flash-free" : "openai/gpt-5";
    const output = await processRun(process.execPath, [worker, "--smoke"], {
      cwd: repository,
      env,
      timeout: 60000,
      diagnostics: true,
      input: JSON.stringify({
        request: {
          repository: "test/repo",
          number: 1,
          branch: "feature",
          model,
          mode,
        },
        snapshot: { base: head, head },
        ...(mode.type === "skill"
          ? {
              skill: {
                id: "pr-review",
                content: "Review the PR. Use review-reference for references/rules.md.",
                references: { "references/rules.md": "Report concrete bugs." },
              },
            }
          : {}),
      }),
    });
    const result = JSON.parse(output);
    assert.equal(result.ok, true);
    assert.equal(result.smoke, true);
    assert.equal(result.mode, mode.type);
    assert.equal(result.model, model);
    assert.equal(result.tools.length, 5);
    console.log(`Bun TypeScript SDK no-inference smoke passed for ${mode.type}.`);
  }
  const failure = await processRun(process.execPath, [worker], {
    cwd: repository,
    env,
    timeout: 60000,
    input: JSON.stringify({
      request: {
        repository: "test/repo",
        number: 1,
        branch: "feature",
        model: "opencode/deepseek-v4.1-flash-free",
        mode: { type: "skill", id: "pr-review" },
      },
      snapshot: { base: head, head },
    }),
  });
  assert.throws(
    () => decodeWorkerResult(failure),
    /OpenCode WorkerError: Requested skill was not loaded\./,
  );
  console.log("Packaged failure envelope reaches the parent decoder without stderr forwarding.");
} finally {
  await rm(root, { recursive: true, force: true });
}
