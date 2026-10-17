import * as core from "@actions/core";
import { fileURLToPath } from "node:url";
import { Effect, Layer } from "effect";
import { githubLayer } from "./github-review.ts";
import { opencodeLayer } from "./opencode-review.ts";
import { parseRequest, review } from "./review.ts";

async function run(signal: AbortSignal): Promise<void> {
  try {
    const request = parseRequest(
      Object.fromEntries(
        ["pr-number", "branch", "model", "skill", "prompt"]
          .map((name) => [name, core.getInput(name)])
          .concat([["repository", process.env.GITHUB_REPOSITORY ?? ""]]),
      ),
    );
    const token = core.getInput("token", { required: true });
    core.setSecret(token);
    const temp = process.env.RUNNER_TEMP;
    const action = fileURLToPath(new URL("../../", import.meta.url));
    if (!temp) throw new Error("RUNNER_TEMP must be set.");
    const layers = Layer.merge(githubLayer(token), opencodeLayer({ token, temp, action }));
    const result = await Effect.runPromise(
      review(request).pipe(Effect.provide(layers), Effect.timeout("15 minutes")),
      { signal },
    );
    core.setOutput("status", result.status);
    core.setOutput("summary-url", result.status === "published" ? result.detail : "");
    core.info(result.status === "published" ? "Published OpenCode review." : result.detail);
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

const controller = new AbortController();
const cancel = () => controller.abort();
process.once("SIGINT", cancel);
process.once("SIGTERM", cancel);
await run(controller.signal);
process.removeListener("SIGINT", cancel);
process.removeListener("SIGTERM", cancel);
