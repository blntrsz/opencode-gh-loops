import { Context, Data, Effect } from "effect";
import { MemoryService } from "./memory-service.ts";
import type { MemoryRecord } from "./memory.ts";

export const defaultModel = "opencode/deepseek-v4.1-flash-free";
export type ReviewMode =
  | { readonly type: "native" }
  | { readonly type: "skill"; readonly id: string };
export interface ReviewRequest {
  readonly repository: string;
  readonly number: number;
  readonly branch: string;
  readonly model: string;
  readonly mode: ReviewMode;
  readonly memory: boolean;
}
export interface ReviewSnapshot {
  readonly base: string;
  readonly head: string;
}
export type ReviewTarget =
  | { readonly type: "skip"; readonly reason: string }
  | { readonly type: "review"; readonly snapshot: ReviewSnapshot };
export interface ReviewResult {
  readonly markdown: string;
  /** A record to store only when the reviewer produced reusable notes. */
  readonly memory?: MemoryRecord;
}
export class ReviewError extends Data.TaggedError("ReviewError")<{ readonly message: string }> {}
export const attempt = <A>(run: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (error) =>
      new ReviewError({ message: error instanceof Error ? error.message : String(error) }),
  });

export class GitHubService extends Context.Service<
  GitHubService,
  {
    readonly resolve: (request: ReviewRequest) => Effect.Effect<ReviewTarget, ReviewError>;
    readonly publish: (
      request: ReviewRequest,
      snapshot: ReviewSnapshot,
      result: ReviewResult,
    ) => Effect.Effect<string, ReviewError>;
  }
>()("review/GitHubService") {}

export class OpenCodeService extends Context.Service<
  OpenCodeService,
  {
    readonly review: (
      request: ReviewRequest,
      snapshot: ReviewSnapshot,
      previous: MemoryRecord | undefined,
    ) => Effect.Effect<ReviewResult, ReviewError>;
  }
>()("review/OpenCodeService") {}

export function parseRequest(input: Readonly<Record<string, string | undefined>>): ReviewRequest {
  const repository = input.repository ?? "";
  const branch = input.branch ?? "";
  const number = Number(input["pr-number"]);
  const model = input.model || defaultModel;
  const skill = input.skill || "";
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
    throw new Error("Invalid GitHub repository.");
  if (!/^[1-9]\d*$/.test(input["pr-number"] ?? "") || !Number.isSafeInteger(number))
    throw new Error("pr-number must be a positive integer.");
  if (
    !branch ||
    branch.length > 255 ||
    /[\s~^:?*[\\]/.test(branch) ||
    branch.split("").some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
    branch.startsWith("-") ||
    branch.startsWith("/") ||
    branch.endsWith("/") ||
    branch.includes("..") ||
    branch.includes("@{")
  )
    throw new Error("Invalid PR HEAD branch.");
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.:/#-]+$/.test(model))
    throw new Error("Invalid model reference.");
  if (skill && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill))
    throw new Error("skill must be an exact kebab-case ID.");
  if (input.prompt) throw new Error("Caller prompts are not supported.");
  if (!["", "true", "false"].includes(input.memory ?? ""))
    throw new Error("memory must be true or false.");
  return {
    repository,
    number,
    branch,
    model,
    mode: skill ? { type: "skill", id: skill } : { type: "native" },
    memory: input.memory === "true",
  };
}

export const review = (request: ReviewRequest) =>
  Effect.gen(function* () {
    const github = yield* GitHubService;
    const opencode = yield* OpenCodeService;
    const memory = yield* MemoryService;
    const target = yield* github.resolve(request);
    if (target.type === "skip") return { status: "skipped", detail: target.reason };
    const previous = yield* memory.read(request);
    const result = yield* opencode.review(request, target.snapshot, previous);
    const current = yield* github.resolve(request);
    if (
      current.type !== "review" ||
      current.snapshot.base !== target.snapshot.base ||
      current.snapshot.head !== target.snapshot.head
    ) {
      return yield* new ReviewError({
        message: "PR base or head changed during review. Refusing to publish.",
      });
    }
    const detail = yield* github.publish(request, target.snapshot, result);
    // Store memory only after the exact reviewed snapshot was published.
    if (result.memory) yield* memory.write(request, result.memory);
    return { status: "published", detail };
  });
