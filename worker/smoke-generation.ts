import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanEnvironment, processRun } from "../src/review-process.ts";
import { runWorker } from "./review-worker.ts";
import { Effect } from "effect";

const skillInstructions =
  "Review multiplication regressions. Preserve the exact marker skill-generation-€-🐛.";
const markdown =
  "## Review\n\n[P1] Restore multiplication in multiply.js. Replacing `a * b` with `a + b` changes multiply(3, 4) from 12 to 7.";

interface CompletionRequest {
  model: string;
  stream: boolean;
  messages: { role: string; content: unknown; tool_call_id?: string }[];
  tools: { type: string; function: { name: string } }[];
}

if (process.argv.includes("--isolated")) {
  const mode = process.argv.at(-1);
  assert.ok(mode === "native" || mode === "skill");
  const git = (args: string[]) => processRun("git", args, { cwd: process.cwd(), env: process.env });
  const base = (await git(["rev-parse", "review-base"])).trim();
  const head = (await git(["rev-parse", "HEAD"])).trim();
  assert.notEqual(base, head);
  const catalog = await readFile(new URL("./smoke-models.json", import.meta.url), "utf8");
  let catalogRequests = 0;
  let generationRequests = 0;
  let fixtureFailure: unknown;
  const server = createServer(async (request, response) => {
    try {
      if (request.url === "/api.json") {
        assert.equal(request.method, "GET");
        assert.ok(++catalogRequests <= 8, "Catalog request limit exceeded.");
        response.setHeader("Content-Type", "application/json");
        response.end(catalog.replaceAll("http://127.0.0.1:1/no-inference", `${url}/v1`));
        return;
      }
      assert.equal(request.url, "/v1/chat/completions");
      assert.equal(request.method, "POST");
      assert.ok(++generationRequests <= 2, "Generation request limit exceeded.");
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        assert.ok(bytes <= 1024 * 1024, "Fixture request byte limit exceeded.");
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as CompletionRequest;
      assert.equal(body.model, "deepseek-v4.1-flash-free");
      assert.ok(
        body.messages.some(
          (message) =>
            message.role === "system" &&
            typeof message.content === "string" &&
            message.content.includes("Provider ID: opencode\n- Model ID: deepseek-v4.1-flash-free"),
        ),
        "The model request must preserve the exact opencode provider and default model.",
      );
      assert.equal(body.stream, true);
      assert.deepEqual(body.tools.map((tool) => tool.function.name).sort(), [
        "review-diff",
        "review-file",
        "review-files",
        "review-reference",
        "review-unavailable",
      ]);
      if (mode === "skill")
        assert.ok(
          JSON.stringify(body.messages).includes(skillInstructions),
          "Selected skill instructions must reach the model.",
        );
      else
        assert.ok(
          JSON.stringify(body.messages).includes("You are a code reviewer."),
          "Native /review must reach the model.",
        );
      if (generationRequests === 1) {
        assert.equal(
          body.messages.some((message) => message.role === "tool"),
          false,
        );
      } else {
        const results = body.messages.filter((message) => message.role === "tool");
        assert.equal(results.length, 1);
        assert.equal(results[0]?.tool_call_id, "review-diff-call");
        const diff = JSON.stringify(results[0]?.content);
        assert.ok(diff.includes("diff --git a/multiply.js b/multiply.js"));
        assert.ok(diff.includes("-export const multiply = (a, b) => a * b;"));
        assert.ok(diff.includes("+export const multiply = (a, b) => a + b;"));
      }
      response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      const chunk = (delta: unknown, finish_reason: string | null) =>
        response.write(
          `data: ${JSON.stringify({
            id: "fixture-completion",
            object: "chat.completion.chunk",
            created: 1700000000,
            model: "deepseek-v4.1-flash-free",
            choices: [{ index: 0, delta, finish_reason }],
          })}\n\n`,
        );
      chunk({ role: "assistant", content: "" }, null);
      if (generationRequests === 1) {
        chunk(
          {
            tool_calls: [
              {
                index: 0,
                id: "review-diff-call",
                type: "function",
                function: { name: "review-diff", arguments: "{}" },
              },
            ],
          },
          null,
        );
        chunk({}, "tool_calls");
      } else {
        chunk({ content: markdown }, null);
        chunk({}, "stop");
      }
      response.end("data: [DONE]\n\n");
    } catch (error) {
      fixtureFailure ??= error;
      response.writeHead(400).end("Mock provider assertion failed.");
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  try {
    const result = await Effect.runPromise(
      runWorker(
        {
          request: {
            repository: "test/repo",
            number: 1,
            branch: "feature",
            model: "opencode/deepseek-v4.1-flash-free",
            mode: mode === "native" ? { type: "native" } : { type: "skill", id: "pr-review" },
          },
          snapshot: { base, head },
          ...(mode === "skill"
            ? { skill: { id: "pr-review", content: skillInstructions, references: {} } }
            : {}),
        },
        false,
        [],
        { url },
      ),
    );
    if (fixtureFailure) throw fixtureFailure;
    assert.deepEqual(result, { markdown });
    assert.ok(catalogRequests > 0, "Production startup must fetch the local catalog.");
    assert.equal(generationRequests, 2);
    console.log(
      `Mock-provider production generation, Git tool loop, and Markdown extraction passed for ${mode}. No live model inference.`,
    );
  } catch (error) {
    throw fixtureFailure ?? error;
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
} else {
  const root = await mkdtemp(join(tmpdir(), "review-generation-smoke-"));
  try {
    const repository = join(root, "snapshot");
    await mkdir(repository);
    const setupHome = join(root, "setup-home");
    await mkdir(join(setupHome, "tmp"), { recursive: true });
    const env = cleanEnvironment(setupHome);
    const git = (args: string[], input?: string) =>
      processRun("git", args, { cwd: repository, env, input });
    await git(["init", "--quiet", "--template=", "--initial-branch=review-head"]);
    for (const [name, source] of [
      ["base", "export const multiply = (a, b) => a * b;\n"],
      ["head", "export const multiply = (a, b) => a + b;\n"],
    ] as const) {
      const blob = (await git(["hash-object", "-w", "--stdin"], source)).trim();
      await git(["update-index", "--add", "--cacheinfo", `100644,${blob},multiply.js`]);
      await git([
        "-c",
        "user.name=Smoke",
        "-c",
        "user.email=smoke@example.invalid",
        "commit",
        "--quiet",
        "-m",
        name,
      ]);
      await git(["update-ref", `refs/heads/review-${name}`, "HEAD"]);
    }
    for (const mode of ["native", "skill"]) {
      const home = join(root, `${mode}-home`);
      await mkdir(join(home, "tmp"), { recursive: true });
      const result = spawnSync(process.execPath, [import.meta.filename, "--isolated", mode], {
        cwd: repository,
        env: cleanEnvironment(home),
        stdio: "inherit",
        timeout: 120000,
        killSignal: "SIGKILL",
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
