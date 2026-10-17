import { Context, Effect, Layer } from "effect";
import { botIdentity, githubClient, listComments, ownedComment } from "./github-api.ts";
import { decodeRecord, encodeRecord, memoryMarker, type MemoryRecord } from "./memory.ts";
import type { ReviewError, ReviewRequest } from "./review.ts";

/**
 * Transport for per-pull-request review memory. Only reads and writes live
 * here; key derivation, reuse decisions, and record assembly stay in the
 * caller, so changing the backend cannot change what memory means.
 *
 * Both operations are total: memory is an optimization, so a transport failure
 * must never fail a review that could otherwise be published.
 */
export class MemoryService extends Context.Service<
  MemoryService,
  {
    readonly read: (request: ReviewRequest) => Effect.Effect<MemoryRecord | undefined, ReviewError>;
    readonly write: (
      request: ReviewRequest,
      record: MemoryRecord,
    ) => Effect.Effect<void, ReviewError>;
  }
>()("review/MemoryService") {}

/** Memory off: a review runs exactly as it did before this feature existed. */
export const disabledMemory = Layer.succeed(
  MemoryService,
  MemoryService.of({
    read: () => Effect.succeed(undefined),
    write: () => Effect.void,
  }),
);

const soft = <A>(run: (signal: AbortSignal) => Promise<A>, fallback: (message: string) => A) =>
  Effect.tryPromise({
    try: run,
    catch: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  }).pipe(Effect.catch((message: string) => Effect.sync(() => fallback(message))));

/**
 * Memory stored in a second, bot-owned comment updated in place. This needs no
 * permission beyond the pull-request write access the summary already uses.
 */
export function commentMemoryLayer(
  token: string,
  log: (message: string) => void = () => {},
  api = "https://api.github.com",
  requestFetch: typeof fetch = fetch,
) {
  const stored = async (request: ReviewRequest, signal: AbortSignal) => {
    const client = githubClient(token, api, requestFetch);
    const identity = await botIdentity(client, signal);
    const existing = ownedComment(
      await listComments(client, request.repository, request.number, signal),
      memoryMarker,
      identity,
      "newest",
    );
    return { client, existing };
  };
  return Layer.succeed(
    MemoryService,
    MemoryService.of({
      read: (request) =>
        soft(
          async (signal) => {
            const { existing } = await stored(request, signal);
            const record = decodeRecord(existing?.body);
            if (existing && !record)
              log("Ignoring unreadable stored review memory and starting fresh.");
            return record;
          },
          (message) => {
            log(`Review memory was not read: ${message}`);
            return undefined;
          },
        ),
      write: (request, record) =>
        soft(
          async (signal) => {
            const body = encodeRecord(record);
            for (let tries = 0; tries < 3; tries++) {
              try {
                const { client, existing } = await stored(request, signal);
                const route = `/repos/${request.repository}/issues/${request.number}/comments`;
                if (existing)
                  await client.call(
                    `/repos/${request.repository}/issues/comments/${existing.id}`,
                    "PATCH",
                    { body },
                    signal,
                  );
                else await client.call(route, "POST", { body }, signal);
                return;
              } catch (error) {
                if (tries === 2) throw error;
                await new Promise((done) => setTimeout(done, 250 * (tries + 1)));
              }
            }
          },
          (message) => log(`Review memory was not saved: ${message}`),
        ),
    }),
  );
}
