export interface Comment {
  readonly id: number;
  readonly body: string;
  readonly user: { readonly id: number; readonly type: string };
  readonly html_url: string;
}

export interface GitHubClient {
  readonly call: <T>(
    path: string,
    method?: string,
    body?: unknown,
    signal?: AbortSignal,
  ) => Promise<T>;
}

export function githubClient(
  token: string,
  api = "https://api.github.com",
  requestFetch: typeof fetch = fetch,
): GitHubClient {
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
  return { call };
}

/** Resolve the authenticated bot, which must own every comment this action writes. */
export async function botIdentity(
  client: GitHubClient,
  signal: AbortSignal,
): Promise<{ readonly databaseId: number; readonly login: string }> {
  const viewer = await client.call<{
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
    throw new Error("Requires an authenticated GitHub App bot token.");
  return identity;
}

export async function listComments(
  client: GitHubClient,
  repository: string,
  number: number,
  signal: AbortSignal,
): Promise<readonly Comment[]> {
  const comments: Comment[] = [];
  for (let page = 1; ; page++) {
    const batch = await client.call<Comment[]>(
      `/repos/${repository}/issues/${number}/comments?per_page=100&page=${page}`,
      "GET",
      undefined,
      signal,
    );
    comments.push(...batch);
    if (batch.length < 100) break;
    if (page >= 100) throw new Error("Too many PR comments to safely reconcile.");
  }
  return comments;
}

/** Find the bot-owned comment carrying a marker, ignoring spoofed human copies. */
export function ownedComment(
  comments: readonly Comment[],
  marker: string,
  identity: { readonly databaseId: number },
  pick: "oldest" | "newest",
): Comment | undefined {
  const owned = comments.filter(
    (comment) =>
      comment.body.startsWith(marker) &&
      comment.user.type === "Bot" &&
      comment.user.id === identity.databaseId,
  );
  return owned.reduce<Comment | undefined>(
    (best, comment) =>
      !best || (pick === "oldest" ? comment.id < best.id : comment.id > best.id) ? comment : best,
    undefined,
  );
}
