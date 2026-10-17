import { Effect, Layer } from "effect";
import { OpenCodeService, attempt } from "./review.ts";
import { decodeWorkerResult } from "../_agent/protocol.ts";
import { cleanEnvironment, processRun } from "../_agent/process.ts";
import { buildRecord, memoryConfig, planMemory } from "./memory.ts";
import { withWorkspace } from "./review-workspace.ts";
import { installWorker } from "../_agent/runtime.ts";

export function opencodeLayer(options: { token: string; temp: string; action: string }) {
  return Layer.effect(
    OpenCodeService,
    Effect.sync(() =>
      OpenCodeService.of({
        review: (request, snapshot, previous) =>
          attempt((signal) =>
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
                const config = memoryConfig(request, workspace.skill);
                const plan = workspace.memory
                  ? planMemory(previous, request, config, workspace.memory)
                  : undefined;
                const output = await processRun(process.execPath, [worker], {
                  cwd: workspace.repository,
                  env: cleanEnvironment(workspace.home),
                  input: JSON.stringify({
                    request,
                    snapshot,
                    skill: workspace.skill,
                    ...(plan
                      ? {
                          memory: {
                            reason: plan.reason,
                            exact: plan.exact,
                            notes: plan.notes,
                            moved: plan.moved,
                          },
                        }
                      : {}),
                  }),
                  signal,
                });
                const result = decodeWorkerResult(output);
                // The parent owns the keys: the worker may only supply notes.
                // A reviewer that records nothing keeps the notes it reused.
                const notes = result.notes ?? plan?.notes;
                const record =
                  workspace.memory && notes
                    ? buildRecord({
                        repository: request.repository,
                        number: request.number,
                        config,
                        keys: workspace.memory,
                        reviewed: { base: snapshot.base, head: snapshot.head },
                        notes,
                      })
                    : undefined;
                return {
                  markdown: result.markdown,
                  ...(record && record.notes.length > 0 ? { memory: record } : {}),
                };
              },
              signal,
            ),
          ),
      }),
    ),
  );
}
