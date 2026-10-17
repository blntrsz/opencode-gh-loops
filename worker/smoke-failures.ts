import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { Plugin } from "@opencode/plugin/effect";
import { Agent } from "@opencode/sdk/effect";
import { Deferred, Effect, Fiber } from "effect";
import { Tool } from "@opencode/schema/tool";
import { cleanEnvironment, processRun } from "../src/review-process.ts";
import { runWorker } from "./review-worker.ts";
import { WorkerFailure } from "../src/worker-protocol.ts";

if (process.argv.includes("--isolated")) {
  const head = (
    await processRun("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(),
      env: process.env,
    })
  ).trim();
  for (const scenario of ["success", "empty", "first-reason", "missing-reference"] as const) {
    let exercised = false;
    const plugin = Plugin.define({
      id: `failure-regression-${scenario}`,
      effect: (context) =>
        context.session
          .hook("prompt", (event) =>
            Effect.gen(function* () {
              const tools = yield* context.tool.list();
              const toolContext = {
                sessionID: event.sessionID,
                messageID: event.messageID,
                agent: Agent.ID.make("reviewer"),
                id: Tool.CallID.make("failure-regression"),
                progress: () => Effect.void,
              };
              const unavailable = tools.find((tool) => tool.id === "review-unavailable");
              const reference = tools.find((tool) => tool.id === "review-reference");
              assert.ok(unavailable);
              assert.ok(reference);
              if (scenario === "missing-reference")
                assert.equal(
                  (yield* Effect.flip(
                    reference.execute({ path: "missing.md" }, toolContext),
                  )) instanceof Error,
                  true,
                );
              if (scenario === "first-reason")
                yield* unavailable.execute({ reason: "Execution is unavailable." }, toolContext);
              if (scenario !== "success") yield* unavailable.execute({ reason: "" }, toolContext);
              exercised = true;
            }).pipe(Effect.orDie, Effect.uninterruptible),
          )
          .pipe(Effect.asVoid),
    });
    const result = Effect.runPromise(
      runWorker(
        {
          request: {
            repository: "test/repo",
            number: 1,
            branch: "feature",
            model: "opencode/deepseek-v4.1-flash-free",
            mode: { type: "skill", id: "pr-review" },
          },
          snapshot: { base: head, head },
          skill: {
            id: "pr-review",
            content: "Review the PR.",
            references: { "references/rules.md": "Report concrete bugs." },
          },
        },
        true,
        [plugin],
      ),
    );
    if (scenario === "success") assert.equal((await result).smoke, true);
    else {
      const reason = {
        empty: "",
        "first-reason": "Execution is unavailable.",
        "missing-reference": "Trusted skill reference is missing. No fallback is allowed.",
      }[scenario];
      await assert.rejects(result, {
        message: `Review requires unsupported capabilities: ${reason}`,
      });
    }
    assert.equal(exercised, true);
    console.log(`SDK no-inference failure regression passed for ${scenario}.`);
  }
  await Effect.runPromise(
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      let finalized = false;
      const plugin = Plugin.define({
        id: "scope-cancellation-regression",
        effect: (context) =>
          Effect.gen(function* () {
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                finalized = true;
              }),
            );
            yield* context.session.hook("prompt", () =>
              Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
            );
          }),
      });
      const fiber = yield* runWorker(
        {
          request: {
            repository: "test/repo",
            number: 1,
            branch: "feature",
            model: "opencode/deepseek-v4.1-flash-free",
            mode: { type: "skill", id: "pr-review" },
          },
          snapshot: { base: head, head },
          skill: {
            id: "pr-review",
            content: "Review the PR.",
            references: { "references/rules.md": "Report concrete bugs." },
          },
        },
        true,
        [plugin],
      ).pipe(Effect.forkChild);
      yield* Deferred.await(entered);
      yield* Fiber.interrupt(fiber);
      assert.equal(
        finalized,
        true,
        "Worker cancellation must finalize SDK plugin resources before returning.",
      );
    }).pipe(Effect.timeout("15 seconds")),
  );
  console.log("Blocked admission cancellation finalizes SDK resources within a bounded lifetime.");
  const catalog = await readFile(new URL("./smoke-models.json", import.meta.url), "utf8");
  let catalogRequests = 0;
  let generationRequests = 0;
  const server = createServer((request, response) => {
    if (request.url === "/api.json") {
      catalogRequests++;
      response.setHeader("Content-Type", "application/json");
      response.end(catalog.replaceAll("http://127.0.0.1:1/no-inference", `${url}/inference`));
    } else {
      generationRequests++;
      response.writeHead(500).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  try {
    for (const mode of [{ type: "native" }, { type: "skill", id: "pr-review" }] as const) {
      let reachedContext = false;
      const plugin = Plugin.define({
        id: `catalog-regression-${mode.type}`,
        effect: (context) =>
          context.session
            .hook("context", () =>
              Effect.sync(() => {
                reachedContext = true;
                throw new Error("Synthetic execution failure before inference.");
              }),
            )
            .pipe(Effect.asVoid),
      });
      await assert.rejects(
        Effect.runPromise(
          runWorker(
            {
              request: {
                repository: "test/repo",
                number: 1,
                branch: "feature",
                model: "opencode/deepseek-v4.1-flash-free",
                mode,
              },
              snapshot: { base: head, head },
              ...(mode.type === "skill"
                ? { skill: { id: "pr-review", content: "Review the PR.", references: {} } }
                : {}),
            },
            false,
            [plugin],
            { url },
          ),
        ),
        (error: unknown) => {
          assert.ok(error instanceof WorkerFailure);
          assert.match(error.diagnostic.message, /Synthetic execution failure before inference/);
          assert.ok(error.diagnostic.type);
          return true;
        },
      );
      assert.equal(
        reachedContext,
        true,
        "Fresh live catalog must admit the exact default before generation.",
      );
      console.log(`Fresh catalog and execution failure event regression passed for ${mode.type}.`);
    }
    let promptReached = false;
    await assert.rejects(
      Effect.runPromise(
        runWorker(
          {
            request: {
              repository: "test/repo",
              number: 1,
              branch: "feature",
              model: "opencode/missing-review-model",
              mode: { type: "native" },
            },
            snapshot: { base: head, head },
          },
          false,
          [
            Plugin.define({
              id: "missing-model-regression",
              effect: (context) =>
                context.session
                  .hook("context", () =>
                    Effect.sync(() => {
                      promptReached = true;
                    }),
                  )
                  .pipe(Effect.asVoid),
            }),
          ],
          { url },
        ),
      ),
      /Requested model is unavailable in the active catalog: opencode\/missing-review-model/,
    );
    assert.equal(promptReached, false);
    assert.ok(catalogRequests > 0, "Production startup must fetch the supplied catalog.");
    assert.equal(generationRequests, 0);
    console.log("Missing requested model fails clearly before generation.");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
} else {
  const root = await mkdtemp(join(tmpdir(), "review-failure-smoke-"));
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
    await git(["update-ref", "refs/heads/review-base", "HEAD"]);
    const result = spawnSync(process.execPath, [import.meta.filename, "--isolated"], {
      cwd: repository,
      env,
      stdio: "inherit",
      timeout: 120000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
