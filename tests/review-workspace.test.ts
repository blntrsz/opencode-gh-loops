import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { processRun } from "../src/_agent/process.ts";
import { parseRequest } from "../src/review/review.ts";
import { withWorkspace } from "../src/review/review-workspace.ts";

vi.mock("../src/_agent/process.ts", async (original) => ({
  ...(await original<typeof import("../src/_agent/process.ts")>()),
  processRun: vi.fn(),
}));
afterEach(() => vi.resetAllMocks());
const snapshot = { base: "a".repeat(40), head: "b".repeat(40) };
const request = parseRequest({
  repository: "owner/repo",
  "pr-number": "1",
  branch: "feature",
  skill: "pr-review",
});

test("loads skill and references from base in deterministic order and removes failed workspaces", async () => {
  const temp = await mkdtemp(join(tmpdir(), "review-workspace-test-"));
  let workspaceRoot = "";
  const calls: string[][] = [];
  vi.mocked(processRun).mockImplementation(async (_command, args, options) => {
    calls.push([...args]);
    const operation = args[4];
    if (args.includes("fetch")) {
      expect(options.env.GIT_CONFIG_VALUE_0).toContain(
        Buffer.from("x-access-token:secret").toString("base64"),
      );
    } else {
      expect(options.env).not.toHaveProperty("GIT_CONFIG_VALUE_0");
    }
    if (operation === "rev-parse")
      return args.at(-1)?.startsWith(snapshot.base) ? snapshot.base : snapshot.head;
    if (args.includes("ls-tree"))
      return ".opencode/skills/pr-review/references/rules.md\n.opencode/skills/pr-review/SKILL.md\n";
    if (args.includes("show"))
      return args.at(-1)?.endsWith("SKILL.md")
        ? "Trusted review instructions"
        : "Trusted reference";
    return "";
  });
  try {
    await expect(
      withWorkspace(request, snapshot, "secret", temp, async (workspace) => {
        workspaceRoot = workspace.root;
        expect(workspace.skill?.content).toBe("Trusted review instructions");
        expect(Object.keys(workspace.skill?.references ?? {})).toEqual([
          "SKILL.md",
          "references/rules.md",
        ]);
        expect(await readdir(workspace.repository)).toEqual([]);
        throw new Error("worker failed");
      }),
    ).rejects.toThrow("worker failed");
    await expect(access(workspaceRoot)).rejects.toThrow();
    expect(calls.some((args) => args.includes("checkout"))).toBe(false);
    expect(
      calls
        .filter((args) => args.includes("show"))
        .every((args) => args.at(-1)?.startsWith(snapshot.base)),
    ).toBe(true);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("missing trusted skill fails before worker launch and cleans temporary files", async () => {
  const temp = await mkdtemp(join(tmpdir(), "review-missing-skill-test-"));
  vi.mocked(processRun).mockImplementation(async (_command, args) =>
    args.includes("rev-parse")
      ? args.at(-1)?.startsWith(snapshot.base)
        ? snapshot.base
        : snapshot.head
      : "",
  );
  const worker = vi.fn();
  try {
    await expect(withWorkspace(request, snapshot, "secret", temp, worker)).rejects.toThrow(
      "missing from the PR base",
    );
    expect(worker).not.toHaveBeenCalled();
    expect(await readdir(temp)).toEqual([]);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
