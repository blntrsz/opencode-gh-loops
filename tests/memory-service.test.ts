import { Effect, Layer } from "effect";
import { expect, test } from "vite-plus/test";
import { buildRecord, encodeRecord, memoryMarker } from "../src/review/memory.ts";
import { commentMemoryLayer, MemoryService } from "../src/review/memory-service.ts";
import { parseRequest } from "../src/review/review.ts";

const request = parseRequest({
  repository: "owner/repo",
  "pr-number": "1",
  branch: "feature",
  memory: "true",
});
const json = (body: unknown) => new Response(JSON.stringify(body));
const href = (url: Parameters<typeof fetch>[0]) =>
  typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
const record = buildRecord({
  repository: "owner/repo",
  number: 1,
  config: { model: "opencode/x", mode: "native", skill: "", instructions: 1 },
  keys: {
    mergeBase: "1".repeat(40),
    head: "2".repeat(40),
    reviewKey: "",
    files: [
      {
        path: "src/a.ts",
        status: "modified",
        baseMode: "100644",
        baseBlob: "a".repeat(40),
        headMode: "100644",
        headBlob: "b".repeat(40),
      },
    ],
  },
  reviewed: { base: "1".repeat(40), head: "2".repeat(40) },
  notes: [{ paths: ["src/a.ts"], text: "one note" }],
});
if (!record) throw new Error("Expected a storable memory record fixture.");

function run<A, E>(layer: Layer.Layer<MemoryService>, effect: Effect.Effect<A, E, MemoryService>) {
  return Effect.runPromise(effect.pipe(Effect.provide(layer)));
}

function memorySource(fake: typeof fetch, log: (message: string) => void = () => {}) {
  return commentMemoryLayer("secret", log, "https://api.invalid", fake);
}

test("memory reads the newest bot-owned record and ignores spoofed copies", async () => {
  const comments = [
    { id: 1, body: "<!-- opencode-gh-loops:review:v1 -->", user: { id: 8, type: "Bot" } },
    { id: 2, body: memoryMarker, user: { id: 9, type: "User" } },
    { id: 3, body: memoryMarker, user: { id: 8, type: "Bot" } },
    { id: 4, body: encodeRecord({ ...record, notes: [] }), user: { id: 8, type: "Bot" } },
    { id: 5, body: encodeRecord(record), user: { id: 8, type: "Bot" } },
  ];
  const fake: typeof fetch = async (url) =>
    href(url).endsWith("/graphql")
      ? json({ data: { viewer: { databaseId: 8, login: "review[bot]" } } })
      : json(comments);
  const loaded = await run(
    memorySource(fake),
    Effect.gen(function* () {
      return yield* (yield* MemoryService).read(request);
    }),
  );
  expect(loaded).toEqual(record);

  const none = await run(
    memorySource(async (url) =>
      href(url).endsWith("/graphql")
        ? json({ data: { viewer: { databaseId: 8, login: "review[bot]" } } })
        : json([]),
    ),
    Effect.gen(function* () {
      return yield* (yield* MemoryService).read(request);
    }),
  );
  expect(none).toBeUndefined();
});

test("unreadable or unreachable memory is dropped instead of failing the review", async () => {
  const logs: string[] = [];
  const unreadable = await run(
    memorySource(
      async (url) =>
        href(url).endsWith("/graphql")
          ? json({ data: { viewer: { databaseId: 8, login: "review[bot]" } } })
          : json([{ id: 5, body: `${memoryMarker}\nnot json`, user: { id: 8, type: "Bot" } }]),
      (message) => logs.push(message),
    ),
    Effect.gen(function* () {
      return yield* (yield* MemoryService).read(request);
    }),
  );
  expect(unreadable).toBeUndefined();
  expect(logs.join("\n")).toContain("unreadable");

  const broken = await run(
    memorySource(
      async () => {
        throw new Error("network down");
      },
      (message) => logs.push(message),
    ),
    Effect.gen(function* () {
      return yield* (yield* MemoryService).read(request);
    }),
  );
  expect(broken).toBeUndefined();
  expect(logs.join("\n")).toContain("network down");
});

test("memory updates its own comment in place and creates one only when absent", async () => {
  const calls: string[] = [];
  const existing = { id: 42, body: encodeRecord(record), user: { id: 8, type: "Bot" } };
  const fake =
    (comments: unknown[]): typeof fetch =>
    async (url, init) => {
      const path = href(url);
      if (path.endsWith("/graphql"))
        return json({ data: { viewer: { databaseId: 8, login: "review[bot]" } } });
      if (init?.method === "GET") return json(comments);
      calls.push(`${init?.method} ${path.endsWith("/comments/42") ? "existing" : "new"}`);
      return json(existing);
    };

  await run(
    memorySource(fake([existing])),
    Effect.gen(function* () {
      yield* (yield* MemoryService).write(request, record);
    }),
  );
  expect(calls).toEqual(["PATCH existing"]);

  calls.length = 0;
  await run(
    memorySource(fake([])),
    Effect.gen(function* () {
      yield* (yield* MemoryService).write(request, record);
    }),
  );
  expect(calls).toEqual(["POST new"]);
});

test("a memory write that keeps failing is logged, never raised", async () => {
  const logs: string[] = [];
  let attempts = 0;
  await run(
    memorySource(
      async () => {
        attempts += 1;
        throw new Error("write refused");
      },
      (message) => logs.push(message),
    ),
    Effect.gen(function* () {
      yield* (yield* MemoryService).write(request, record);
    }),
  );
  expect(attempts).toBe(3);
  expect(logs.join("\n")).toContain("write refused");
  expect(logs.join("\n")).toContain("was not saved");
});
