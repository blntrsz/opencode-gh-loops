import { Effect, Layer } from "effect";
import { expect, test, vi } from "vite-plus/test";
import {
  GitHubService,
  OpenCodeService,
  parseRequest,
  review,
  type ReviewSnapshot,
} from "../src/review.ts";

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
  const layer = Layer.merge(
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
  expect(run).toHaveBeenCalledWith(request, snapshot);
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
  const layer = Layer.merge(
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
  );
  expect(await Effect.runPromise(review(parseRequest(input)).pipe(Effect.provide(layer)))).toEqual({
    status: "skipped",
    detail: "Fork PR",
  });
  expect(run).not.toHaveBeenCalled();
  expect(publish).not.toHaveBeenCalled();
});
