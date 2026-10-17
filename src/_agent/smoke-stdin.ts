import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { cleanEnvironment, processRun } from "./process.ts";

const root = await mkdtemp(join(tmpdir(), "review-stdin-smoke-"));
try {
  const home = join(root, "home");
  const repository = join(root, "snapshot");
  await mkdir(join(home, "tmp"), { recursive: true });
  await mkdir(repository);
  const env = cleanEnvironment(home);
  const git = (args: string[], input?: string) =>
    processRun("git", args, { cwd: repository, env, input });
  await git(["init", "--quiet", "--template=", "--initial-branch=review-head"]);
  const blob = (await git(["hash-object", "-w", "--stdin"], "snapshot fixture\n")).trim();
  await git(["update-index", "--add", "--cacheinfo", `100644,${blob},smoke.txt`]);
  await git([
    "-c",
    "user.name=Smoke",
    "-c",
    "user.email=smoke@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  ]);
  const head = (await git(["rev-parse", "HEAD"])).trim();
  await git(["update-ref", "refs/heads/review-base", head]);
  const input = Buffer.from(
    JSON.stringify({
      request: {
        repository: "test/repo",
        number: 1,
        branch: "feature",
        model: "openai/gpt-5",
        mode: { type: "skill", id: "pr-review" },
      },
      snapshot: { base: head, head },
      skill: {
        id: "pr-review",
        content: "Review € prices and 🐛 bugs exactly.",
        references: { "references/rules.md": "Report concrete bugs." },
      },
    }),
  );
  const child = spawn(process.execPath, [join(import.meta.dirname, "index.ts"), "--smoke"], {
    cwd: repository,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 60000,
  });
  const completed = once(child, "close");
  let output = "";
  let error = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk) => {
    error += chunk;
  });
  child.stdin.on("error", () => {});
  // Fill the pipe before splitting so the worker must start reading before the Unicode arrives.
  if (!child.stdin.write(" ".repeat(512 * 1024))) await once(child.stdin, "drain");
  let start = 0;
  for (const character of ["€", "🐛"]) {
    const split = input.indexOf(Buffer.from(character)) + 1;
    child.stdin.write(input.subarray(start, split));
    await setTimeout(200);
    start = split;
  }
  child.stdin.end(input.subarray(start));
  const [code] = await completed;
  assert.equal(code, 0, error);
  const result = JSON.parse(output);
  assert.equal(result.smoke, true);
  assert.equal(
    result.skills.data.find((skill: { id: string }) => skill.id === "pr-review")?.content,
    "Review € prices and 🐛 bugs exactly.",
  );
  console.log("Bun SDK no-inference split UTF-8 stdin regression passed.");
  await assert.rejects(
    processRun(process.execPath, [join(import.meta.dirname, "index.ts"), "--smoke"], {
      cwd: repository,
      env,
      diagnostics: true,
      timeout: 60000,
      input: "€".repeat(700000),
    }),
    /Worker input exceeds limit\./,
  );
  console.log("Worker stdin byte limit rejects oversized input before JSON parsing.");
} finally {
  await rm(root, { recursive: true, force: true });
}
