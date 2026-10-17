import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { cleanEnvironment, processRun } from "../_agent/process.ts";
import type { ReviewRequest, ReviewSnapshot } from "./review.ts";

export interface TrustedSkill {
  readonly id: string;
  readonly content: string;
  readonly references: Readonly<Record<string, string>>;
}
export async function withWorkspace<A>(
  request: ReviewRequest,
  snapshot: ReviewSnapshot,
  token: string,
  temp: string,
  run: (workspace: {
    root: string;
    home: string;
    repository: string;
    skill?: TrustedSkill;
  }) => Promise<A>,
  signal?: AbortSignal,
): Promise<A> {
  const root = await mkdtemp(join(temp, "opencode-review-"));
  try {
    const home = join(root, "home");
    const repository = join(root, "snapshot");
    await Promise.all([mkdir(repository), mkdir(join(home, "tmp"), { recursive: true })]);
    const env = cleanEnvironment(home);
    const git = (args: string[], authenticated = false) =>
      processRun(
        "git",
        ["-c", "core.hooksPath=/dev/null", "-c", "protocol.file.allow=never", ...args],
        {
          cwd: repository,
          env: authenticated
            ? {
                ...env,
                GIT_CONFIG_COUNT: "1",
                GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
                GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
              }
            : env,
          signal,
        },
      );
    await git(["init", "--quiet", "--template=", "--initial-branch=review-head"]);
    await git(
      [
        "fetch",
        "--quiet",
        "--no-tags",
        "--no-recurse-submodules",
        `https://github.com/${request.repository}.git`,
        snapshot.base,
        snapshot.head,
      ],
      true,
    );
    for (const sha of [snapshot.base, snapshot.head]) {
      if ((await git(["rev-parse", "--verify", `${sha}^{commit}`])).trim() !== sha)
        throw new Error("Fetched commit does not match GitHub snapshot.");
    }
    await git(["update-ref", "refs/heads/review-head", snapshot.head]);
    await git(["update-ref", "refs/heads/review-base", snapshot.base]);
    let skill: TrustedSkill | undefined;
    if (request.mode.type === "skill") {
      const prefix = `.opencode/skills/${request.mode.id}/`;
      const files = (await git(["ls-tree", "-r", "--name-only", snapshot.base, "--", prefix]))
        .trim()
        .split("\n")
        .filter(Boolean)
        .sort();
      if (!files.includes(`${prefix}SKILL.md`))
        throw new Error(`Trusted skill '${request.mode.id}' is missing from the PR base.`);
      if (files.length > 100) throw new Error("Skill exceeds 100 files.");
      const references: Record<string, string> = {};
      let total = 0;
      for (const file of files) {
        const content = await git(["show", `${snapshot.base}:${file}`]);
        total += Buffer.byteLength(content);
        if (total > 1024 * 1024) throw new Error("Skill exceeds 1 MiB.");
        references[file.slice(prefix.length)] = content;
      }
      const content = references["SKILL.md"];
      if (!content?.trim()) throw new Error("Trusted skill is empty.");
      skill = { id: request.mode.id, content, references };
    }
    return await run({ root, home, repository, ...(skill ? { skill } : {}) });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
