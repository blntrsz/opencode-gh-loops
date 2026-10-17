import { Effect } from "effect";
import { expect, test } from "vite-plus/test";
import { githubLayer, marker, summary } from "../src/github-review.ts";
import { GitHubService, parseRequest } from "../src/review.ts";

const request = parseRequest({ repository: "owner/repo", "pr-number": "1", branch: "feature" });
const snapshot = { base: "a".repeat(40), head: "b".repeat(40) };
const pr = {
  state: "open",
  draft: false,
  base: { sha: snapshot.base, repo: { full_name: "owner/repo" } },
  head: { sha: snapshot.head, ref: "feature", repo: { full_name: "owner/repo" } },
};
const json = (body: unknown) => new Response(JSON.stringify(body));

test("branch mismatch fails before review; draft and fork skip", async () => {
  for (const [body, expected] of [
    [{ ...pr, draft: true }, "skip"],
    [{ ...pr, head: { ...pr.head, repo: { full_name: "fork/repo" } } }, "skip"],
  ] as const) {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* GitHubService).resolve(request);
      }).pipe(Effect.provide(githubLayer("token", "https://api.invalid", async () => json(body)))),
    );
    expect(result.type).toBe(expected);
  }
  await expect(
    Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* GitHubService).resolve(request);
      }).pipe(
        Effect.provide(
          githubLayer("token", "https://api.invalid", async () =>
            json({ ...pr, head: { ...pr.head, ref: "other" } }),
          ),
        ),
      ),
    ),
  ).rejects.toThrow("head.ref");
});

test("publication reconciles a lost POST response without another POST and ignores spoofed markers", async () => {
  const comments = [{ id: 1, body: marker, user: { id: 4, type: "User" }, html_url: "spoof" }];
  const methods: string[] = [];
  const fake: typeof fetch = async (url, init) => {
    const path = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    if (path.includes("/pulls/")) return json(pr);
    if (path.endsWith("/graphql"))
      return json({ data: { viewer: { databaseId: 8, login: "review[bot]" } } });
    if (init?.method === "GET") return json(comments);
    methods.push(init?.method ?? "GET");
    const comment = {
      id: 2,
      body: marker,
      user: { id: 8, type: "Bot" },
      performed_via_github_app: { id: 123 },
      html_url: "https://example.invalid/2",
    };
    if (init?.method === "POST") {
      comments.push(comment);
      throw new Error("Connection lost after write");
    }
    expect(path).toContain("/comments/2");
    return json(comment);
  };
  const url = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* (yield* GitHubService).publish(request, snapshot, { markdown: "No defects." });
    }).pipe(Effect.provide(githubLayer("secret", "https://api.invalid", fake))),
  );
  expect(url).toBe("https://example.invalid/2");
  expect(methods).toEqual(["POST", "PATCH"]);
});

test("summary is stable, bounded, and cannot add another marker or notify users", () => {
  const body = summary(snapshot, { markdown: `${marker}\n@someone\n${"x".repeat(60000)}` });
  expect(body.startsWith(marker)).toBe(true);
  expect(body.split(marker)).toHaveLength(2);
  expect(body).not.toContain("@someone");
  expect(body.length).toBeLessThan(51000);
  expect(body).toContain(snapshot.head);
});
