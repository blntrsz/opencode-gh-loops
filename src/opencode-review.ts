import { Effect, Layer } from "effect";
import { OpenCodeService, ReviewError } from "./review.ts";
import { decodeWorkerResult } from "./worker-protocol.ts";
import { cleanEnvironment, processRun } from "./review-process.ts";
import { withWorkspace } from "./review-workspace.ts";
import { installWorker } from "./worker-runtime.ts";

export function opencodeLayer(options: { token: string; temp: string; action: string }) {
  return Layer.effect(
    OpenCodeService,
    Effect.sync(() =>
      OpenCodeService.of({
        review: (request, snapshot) =>
          Effect.tryPromise({
            try: (signal) =>
              withWorkspace(
                request,
                snapshot,
                options.token,
                options.temp,
                async (workspace) => {
                  const worker = await installWorker(
                    options.action,
                    workspace.root,
                    workspace.home,
                    signal,
                  );
                  const output = await processRun(process.execPath, [worker], {
                    cwd: workspace.repository,
                    env: cleanEnvironment(workspace.home),
                    input: JSON.stringify({ request, snapshot, skill: workspace.skill }),
                    signal,
                  });
                  return decodeWorkerResult(output);
                },
                signal,
              ),
            catch: (error) =>
              new ReviewError({ message: error instanceof Error ? error.message : String(error) }),
          }),
      }),
    ),
  );
}
