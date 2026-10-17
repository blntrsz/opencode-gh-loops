import { Effect, Layer } from "effect";
import {
  botIdentity,
  githubClient,
  listComments,
  ownedComment,
  type Comment,
} from "./github-api.ts";
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
export function githubLayer(
  token: string,
  api = "https://api.github.com",
  requestFetch: typeof fetch = fetch,
) {
  return Layer.effect(
    GitHubService,
    Effect.sync(() => {
      const client = githubClient(token, api, requestFetch);
      const resolve = async (
        request: ReviewRequest,
        signal: AbortSignal,
      ): Promise<ReviewTarget> => {
        const pr = await client.call<Pull>(
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
                const identity = await botIdentity(client, signal);
                const route = `/repos/${request.repository}/issues/${request.number}/comments`;
                const existing = ownedComment(
                  await listComments(client, request.repository, request.number, signal),
                  marker,
                  identity,
                  "oldest",
                );
                const saved = existing
                  ? await client.call<Comment>(
                      `/repos/${request.repository}/issues/comments/${existing.id}`,
                      "PATCH",
                      { body },
                      signal,
                    )
                  : await client.call<Comment>(route, "POST", { body }, signal);
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
