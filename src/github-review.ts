import { Effect, Layer } from "effect";
import {
  attempt,
  GitHubService,
  type ReviewRequest,
  type ReviewResult,
  type ReviewSnapshot,
  type ReviewTarget,
} from "./review.ts";

export const marker = "<!-- opencode-gh-loops:review:v1 -->";
export function summary(snapshot: ReviewSnapshot, result: ReviewResult): string {
  const text = result.markdown
    .replace(/<!--.*?-->/gs, "")
    .replace(/@/g, "@\u200b")
    .trim();
  if (!text) throw new Error("OpenCode returned an empty review.");
  return `${marker}\n## OpenCode review\n\nBase \`${snapshot.base}\` · Head \`${snapshot.head}\`\n\n${text.slice(0, 50000)}${text.length > 50000 ? "\n\n[Review truncated.]" : ""}`;
}

interface Pull {
  draft: boolean;
  state: string;
  base: { sha: string; repo: { full_name: string } };
  head: { sha: string; ref: string; repo: { full_name: string } | null };
}
interface Comment {
  id: number;
  body: string;
  user: { id: number; type: string };
  html_url: string;
}
export function githubLayer(
  token: string,
  api = "https://api.github.com",
  requestFetch: typeof fetch = fetch,
) {
  return Layer.effect(
    GitHubService,
    Effect.sync(() => {
      const call = async <T>(
        path: string,
        method = "GET",
        body?: unknown,
        signal?: AbortSignal,
      ): Promise<T> => {
        const response = await requestFetch(`${api}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
            : AbortSignal.timeout(30000),
        });
        if (!response.ok) throw new Error(`GitHub ${method} failed with HTTP ${response.status}.`);
        return (await response.json()) as T;
      };
      const resolve = async (
        request: ReviewRequest,
        signal: AbortSignal,
      ): Promise<ReviewTarget> => {
        const pr = await call<Pull>(
          `/repos/${request.repository}/pulls/${request.number}`,
          "GET",
          undefined,
          signal,
        );
        if (pr.draft || pr.state !== "open")
          return { type: "skip", reason: "PR is draft or closed." };
        if (
          !pr.head.repo ||
          pr.head.repo.full_name !== request.repository ||
          pr.base.repo.full_name !== request.repository
        )
          return { type: "skip", reason: "Fork PRs are not supported." };
        if (pr.head.ref !== request.branch)
          throw new Error("branch does not match GitHub PR head.ref.");
        if (![pr.base.sha, pr.head.sha].every((sha) => /^[a-f0-9]{40}$/.test(sha)))
          throw new Error("GitHub returned invalid snapshot SHAs.");
        return { type: "review", snapshot: { base: pr.base.sha, head: pr.head.sha } };
      };
      return GitHubService.of({
        resolve: (request) => attempt((signal) => resolve(request, signal)),
        publish: (request, snapshot, result) =>
          attempt(async (signal) => {
            const body = summary(snapshot, result);
            const route = `/repos/${request.repository}/issues/${request.number}/comments`;
            // Re-list before retrying a possibly successful POST to avoid duplicate summaries.
            for (let tries = 0; tries < 3; tries++) {
              try {
                const current = await resolve(request, signal);
                if (
                  current.type !== "review" ||
                  current.snapshot.base !== snapshot.base ||
                  current.snapshot.head !== snapshot.head
                )
                  throw new Error("PR snapshot changed before publication.");
                const viewer = await call<{
                  data?: { viewer?: { databaseId: number; login: string } };
                  errors?: unknown[];
                }>("/graphql", "POST", { query: "query { viewer { databaseId login } }" }, signal);
                const identity = viewer.data?.viewer;
                if (
                  viewer.errors?.length ||
                  !identity ||
                  !Number.isSafeInteger(identity.databaseId) ||
                  !identity.login.endsWith("[bot]")
                )
                  throw new Error("Publication requires an authenticated GitHub App bot token.");
                const comments: Comment[] = [];
                for (let page = 1; ; page++) {
                  const batch = await call<Comment[]>(
                    `${route}?per_page=100&page=${page}`,
                    "GET",
                    undefined,
                    signal,
                  );
                  comments.push(...batch);
                  if (batch.length < 100) break;
                  if (page >= 100) throw new Error("Too many PR comments to safely reconcile.");
                }
                const owned = comments.filter(
                  (comment) =>
                    comment.body.startsWith(marker) &&
                    comment.user.type === "Bot" &&
                    comment.user.id === identity.databaseId,
                );
                const existing = owned.sort((a, b) => a.id - b.id)[0];
                const saved = existing
                  ? await call<Comment>(
                      `/repos/${request.repository}/issues/comments/${existing.id}`,
                      "PATCH",
                      { body },
                      signal,
                    )
                  : await call<Comment>(route, "POST", { body }, signal);
                return saved.html_url;
              } catch (error) {
                if (tries === 2) throw error;
                await new Promise((done) => setTimeout(done, 250 * (tries + 1)));
              }
            }
            throw new Error("Publication retries exhausted.");
          }),
      });
    }),
  );
}
