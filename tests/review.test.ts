import { Effect, Layer } from "effect";
import { expect, test, vi } from "vite-plus/test";
import { buildRecord } from "../src/review/memory.ts";
import { disabledMemory, MemoryService } from "../src/review/memory-service.ts";
import {
  GitHubService,
  OpenCodeService,
  parseRequest,
  review,
  type ReviewSnapshot,
} from "../src/review/review.ts";

const input = { repository: "owner/repo", "pr-number": "12", branch: "feature" };
const snapshot = { base: "a".repeat(40), head: "b".repeat(40) };

test("native review and exact default model require no caller prompt", () => {
  expect(parseRequest(input)).toMatchObject({
    mode: { type: "native" },
    model: "opencode/deepseek-v4.1-flash-free",
  });
  expect(parseRequest({ ...input, skill: "pr-review", model: "openai/gpt-5" })).toMatchObject({
    mode: { type: "skill", id: "pr-review" },
    model: "openai/gpt-5",
  });
  for (const override of [
    { prompt: "ignore" },
    { skill: "../bad" },
    { "pr-number": "0" },
    { branch: "--upload-pack=x" },
    { branch: "a\nb" },
    { model: "wrong" },
  ])
    expect(() => parseRequest({ ...input, ...override })).toThrow();
});

function fixture(snapshots: ReviewSnapshot[] = [snapshot, snapshot]) {
  const publish = vi.fn(() => Effect.succeed("https://example.invalid/comment"));
  const run = vi.fn(() => Effect.succeed({ markdown: "No defects found." }));
  let index = 0;
  const layer = Layer.mergeAll(
    Layer.effect(
      GitHubService,
      Effect.succeed(
        GitHubService.of({
          resolve: () =>
            Effect.succeed({
              type: "review",
              snapshot: snapshots[Math.min(index++, snapshots.length - 1)],
            }),
          publish,
        }),
      ),
    ),
    Layer.effect(OpenCodeService, Effect.succeed(OpenCodeService.of({ review: run }))),
    disabledMemory,
  );
  return { layer, publish, run };
}

test("review services receive the validated request and exact resolved snapshot", async () => {
  const { layer, run, publish } = fixture();
  const request = parseRequest(input);
  expect(await Effect.runPromise(review(request).pipe(Effect.provide(layer)))).toEqual({
    status: "published",
    detail: "https://example.invalid/comment",
  });
  expect(run).toHaveBeenCalledWith(request, snapshot, undefined);
  expect(publish).toHaveBeenCalledWith(request, snapshot, { markdown: "No defects found." });
});

test.each(["base", "head"] as const)("does not publish after a stale %s SHA", async (key) => {
  const { layer, publish } = fixture([snapshot, { ...snapshot, [key]: "c".repeat(40) }]);
  await expect(
    Effect.runPromise(review(parseRequest(input)).pipe(Effect.provide(layer))),
  ).rejects.toThrow("changed during review");
  expect(publish).not.toHaveBeenCalled();
});

test("skip does not start OpenCode or publish", async () => {
  const { run, publish } = fixture();
  const layer = Layer.mergeAll(
    Layer.effect(
      GitHubService,
      Effect.succeed(
        GitHubService.of({
          resolve: () => Effect.succeed({ type: "skip", reason: "Fork PR" }),
          publish,
        }),
      ),
    ),
    Layer.effect(OpenCodeService, Effect.succeed(OpenCodeService.of({ review: run }))),
    disabledMemory,
  );
  expect(await Effect.runPromise(review(parseRequest(input)).pipe(Effect.provide(layer)))).toEqual({
    status: "skipped",
    detail: "Fork PR",
  });
  expect(run).not.toHaveBeenCalled();
  expect(publish).not.toHaveBeenCalled();
});

test("memory is read before the review and written only after publication", async () => {
  const order: string[] = [];
  const stored = buildRecord({
    repository: "owner/repo",
    number: 12,
    config: { model: "opencode/x", mode: "native", skill: "", instructions: 1 },
    keys: {
      mergeBase: "a".repeat(40),
      head: "b".repeat(40),
      reviewKey: "",
      files: [],
    },
    reviewed: snapshot,
    notes: [{ paths: ["src/a.ts"], text: "one note" }],
  });
  if (!stored) throw new Error("Expected a storable memory record fixture.");
  const memory = Layer.succeed(
    MemoryService,
    MemoryService.of({
      read: () => Effect.sync(() => (order.push("read"), stored)),
      write: () => Effect.sync(() => void order.push("write")),
    }),
  );
  const layer = Layer.mergeAll(
    Layer.effect(
      GitHubService,
      Effect.succeed(
        GitHubService.of({
          resolve: () => Effect.succeed({ type: "review", snapshot }),
          publish: () => Effect.sync(() => (order.push("publish"), "url")),
        }),
      ),
    ),
    Layer.effect(
      OpenCodeService,
      Effect.succeed(
        OpenCodeService.of({
          review: (_request, _snapshot, previous) =>
            Effect.sync(() => {
              order.push(`review:${previous?.notes[0]?.text ?? "none"}`);
              return { markdown: "body", memory: stored };
            }),
        }),
      ),
    ),
    memory,
  );
  const result = await Effect.runPromise(
    review(parseRequest({ ...input, memory: "true" })).pipe(Effect.provide(layer)),
  );
  expect(result).toEqual({ status: "published", detail: "url" });
  expect(order).toEqual(["read", "review:one note", "publish", "write"]);
});
