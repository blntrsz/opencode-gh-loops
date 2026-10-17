import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { cleanEnvironment, processRun } from "../src/_agent/process.ts";
import {
  buildRecord,
  decodeRecord,
  encodeRecord,
  hashSkill,
  memoryConfig,
  memoryLimit,
  memoryMarker,
  memorySchema,
  parseRawDiff,
  planMemory,
  validateRecord,
  type MemoryFile,
  type MemoryNote,
  type MemoryRecord,
} from "../src/review/memory.ts";
import { readMemoryKeys } from "../src/review/review-workspace.ts";
import { parseRequest } from "../src/review/review.ts";

const request = parseRequest({
  repository: "owner/repo",
  "pr-number": "7",
  branch: "feature",
  memory: "true",
});
const zeros = "0".repeat(40);
const blob = (seed: string) => seed.repeat(40).slice(0, 40);

const file = (path: string, overrides: Partial<MemoryFile> = {}): MemoryFile => ({
  path,
  status: "modified",
  baseMode: "100644",
  baseBlob: blob("a"),
  headMode: "100644",
  headBlob: blob("b"),
  ...overrides,
});

const note = (paths: string[], text: string): MemoryNote => ({ paths, text });

test("raw diff parsing reads the NUL framing and rejects anything unexpected", () => {
  const parsed = parseRawDiff(
    [
      `:100644 000000 ${blob("a")} ${zeros} D\0gone.txt\0`,
      `:100755 100755 ${blob("b")} ${blob("c")} M\0kept.txt\0`,
      `:000000 100644 ${zeros} ${blob("d")} A\0new.txt\0`,
      `:100644 120000 ${blob("e")} ${blob("f")} T\0link\0`,
    ].join(""),
  );
  expect(parsed.map((entry) => [entry.path, entry.status])).toEqual([
    ["gone.txt", "deleted"],
    ["kept.txt", "modified"],
    ["link", "typechanged"],
    ["new.txt", "added"],
  ]);
  expect(parseRawDiff("")).toEqual([]);
  for (const malformed of [
    ":100644 100644 short 422c2b7ab3b3c668038da977e4e93a5fc623169c M\0x\0",
    `:100644 100644 ${blob("a")} ${blob("b")} X\0x\0`,
    `:100644 100644 ${blob("a")} ${blob("b")} M\0x\0orphan`,
  ])
    expect(() => parseRawDiff(malformed)).toThrow();
});

async function repository(root: string, home: string) {
  const env = cleanEnvironment(home);
  const git = (args: string[]) => processRun("git", args, { cwd: root, env });
  await git(["init", "--quiet", "--template=", "--initial-branch=main"]);
  await git(["config", "user.name", "Test"]);
  await git(["config", "user.email", "test@example.invalid"]);
  const commit = async (message: string, path: string, contents: string, mode?: number) => {
    await writeFile(join(root, path), contents);
    if (mode !== undefined) await chmod(join(root, path), mode);
    await git(["add", "-A"]);
    await git(["commit", "--quiet", "-m", message]);
  };
  await commit("base", "f.txt", "a\nb\nc\n");
  await commit("base: executable helper", "g.txt", "x\ny\nz\n", 0o755);
  await commit("feature: change z", "g.txt", "x\ny\nz2\n");
  await git(["checkout", "--quiet", "-b", "side", "HEAD~1"]);
  await commit("base: append D", "f.txt", "a\nb\nc\nD\n");
  await git(["checkout", "--quiet", "main"]);
  return { git, commit };
}

test("the review key survives a rebase, a base merge, and the base advancing", async () => {
  const base = await mkdtemp(join(tmpdir(), "review-memory-keys-"));
  const root = join(base, "repo");
  const home = join(base, "home");
  try {
    await mkdir(root);
    await mkdir(home);
    const { git, commit } = await repository(root, home);
    const keys = async () => {
      const snapshot = {
        base: (await git(["rev-parse", "side"])).trim(),
        head: (await git(["rev-parse", "main"])).trim(),
      };
      const computed = await readMemoryKeys(git, snapshot);
      return {
        reviewKey: computed.reviewKey,
        mergeBase: computed.mergeBase,
        files: computed.files,
      };
    };
    const initial = await keys();
    expect(initial.files.map((entry) => entry.path)).toEqual(["g.txt"]);

    await git(["rebase", "--quiet", "side", "main"]);
    const rebased = await keys();
    expect(rebased.mergeBase).not.toBe(initial.mergeBase);
    expect(rebased.reviewKey).toBe(initial.reviewKey);

    await git(["checkout", "--quiet", "side"]);
    await commit("base: append E", "f.txt", "a\nb\nc\nD\nE\n");
    await git(["checkout", "--quiet", "main"]);
    await git(["merge", "--quiet", "--no-edit", "-m", "merge base in", "side"]);
    const merged = await keys();
    expect(merged.mergeBase).not.toBe(rebased.mergeBase);
    expect(merged.reviewKey).toBe(initial.reviewKey);

    await git(["checkout", "--quiet", "side"]);
    await commit("base: append G", "f.txt", "a\nb\nc\nD\nE\nG\n");
    await git(["checkout", "--quiet", "main"]);
    expect((await keys()).reviewKey).toBe(initial.reviewKey);

    await commit("feature: real edit", "g.txt", "x\ny\nz3\n");
    const edited = await keys();
    expect(edited.reviewKey).not.toBe(initial.reviewKey);
    expect(edited.files[0]?.headBlob).not.toBe(initial.files[0]?.headBlob);

    await chmod(join(root, "g.txt"), 0o644);
    await git(["add", "-A"]);
    await git(["commit", "--quiet", "-m", "feature: drop exec bit"]);
    const chmodOnly = await keys();
    expect(chmodOnly.reviewKey).not.toBe(edited.reviewKey);
    expect(chmodOnly.files[0]?.headBlob).toBe(edited.files[0]?.headBlob);
    expect(chmodOnly.files[0]?.headMode).not.toBe(edited.files[0]?.headMode);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

function built(input: Parameters<typeof buildRecord>[0]): MemoryRecord {
  const record = buildRecord(input);
  if (!record) throw new Error("Expected a storable memory record.");
  return record;
}

function record(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  const files = overrides.keys?.files ?? [file("src/a.ts"), file("src/b.ts", { status: "added" })];
  return built({
    repository: "owner/repo",
    number: 7,
    config: memoryConfig(request, undefined),
    keys: { mergeBase: blob("1"), head: blob("2"), reviewKey: "unused", files },
    reviewed: { base: blob("1"), head: blob("2") },
    notes: [note(["src/a.ts"], "A note about a.")],
    ...overrides,
  });
}

test("only an identical change reuses every note", () => {
  const keys = record().keys;
  const config = memoryConfig(request, undefined);
  expect(planMemory(undefined, request, config, keys)).toMatchObject({
    exact: false,
    notes: [],
    moved: [],
  });
  expect(planMemory(record(), request, config, keys)).toMatchObject({ exact: true, moved: [] });
  expect(planMemory({ ...record(), number: 8 }, request, config, keys).reason).toContain(
    "another pull request",
  );
  expect(
    planMemory({ ...record(), schema: memorySchema + 1 }, request, config, keys).reason,
  ).toContain("schema");
  expect(planMemory(record(), request, { ...config, model: "other/model" }, keys).reason).toContain(
    "configuration",
  );
});

test("a note is kept only while every path it cites is byte-identical", () => {
  const config = memoryConfig(request, undefined);
  const previous = record({
    notes: [
      note(["src/a.ts"], "about a"),
      note(["src/a.ts", "src/b.ts"], "about both"),
      note(["src/gone.ts"], "about a context file"),
    ],
  });
  const next = built({
    repository: "owner/repo",
    number: 7,
    config,
    keys: {
      mergeBase: blob("1"),
      head: blob("2"),
      reviewKey: "other",
      files: [file("src/a.ts"), file("src/b.ts", { status: "added", headBlob: blob("c") })],
    },
    reviewed: { base: blob("1"), head: blob("2") },
    notes: [],
  });
  const plan = planMemory(previous, request, config, next.keys);
  expect(plan.exact).toBe(false);
  expect(plan.notes.map((entry) => entry.text)).toEqual(["about a"]);
  expect(plan.moved).toEqual(["src/b.ts"]);
});

test("records round-trip, stay neutral in Markdown, and reject tampering", () => {
  const notes = [note(["src/a.ts"], "Ping @octocat with `code` and a fenced block")];
  const stored = built({
    repository: "owner/repo",
    number: 7,
    config: memoryConfig(request, undefined),
    keys: record().keys,
    reviewed: { base: blob("1"), head: blob("2") },
    notes,
  });
  const body = encodeRecord(stored);
  const json = /```json\n([\s\S]*?)\n```/.exec(body)?.[1] ?? "";
  expect(json).not.toContain("@");
  expect(json).not.toContain("`");
  expect(body.startsWith(memoryMarker)).toBe(true);
  expect(decodeRecord(body)).toEqual(stored);
  expect(decodeRecord(undefined)).toBeUndefined();
  expect(decodeRecord("not memory")).toBeUndefined();
  expect(decodeRecord(`${memoryMarker}\n\`\`\`json\n{"schema":1}\n\`\`\`\n`)).toBeUndefined();
  expect(
    validateRecord({ ...stored, keys: { ...stored.keys, reviewKey: blob("9") } }),
  ).toBeUndefined();
  expect(validateRecord({ ...stored, notes: [note(["../escape"], "x")] })).toBeUndefined();
  expect(validateRecord({ ...stored, extra: true })).toBeUndefined();
});

test("an oversized memory record drops notes and refuses a change it cannot describe", () => {
  const notes = Array.from({ length: 40 }, (_value, index) =>
    note([`src/file-${index}.ts`], "x".repeat(2000)),
  );
  const trimmed = built({
    repository: "owner/repo",
    number: 7,
    config: memoryConfig(request, undefined),
    keys: record().keys,
    reviewed: { base: blob("1"), head: blob("2") },
    notes,
  });
  expect(trimmed.notes.length).toBeGreaterThan(0);
  expect(trimmed.notes.length).toBeLessThan(40);
  const body = encodeRecord(trimmed);
  expect((/```json\n([\s\S]*?)\n```/.exec(body)?.[1] ?? "").length).toBeLessThanOrEqual(
    memoryLimit,
  );
  expect(body.length).toBeLessThan(65536);

  const enormous = Array.from({ length: 3000 }, (_value, index) =>
    file(`src/generated/file-with-a-long-name-${index}.ts`),
  );
  expect(
    buildRecord({
      repository: "owner/repo",
      number: 7,
      config: memoryConfig(request, undefined),
      keys: { mergeBase: blob("1"), head: blob("2"), reviewKey: "unused", files: enormous },
      reviewed: { base: blob("1"), head: blob("2") },
      notes: [note(["src/generated/file-with-a-long-name-0.ts"], "a note")],
    }),
  ).toBeUndefined();
});

test("the configuration fingerprint tracks the model, mode, and skill contents", () => {
  const skill = { id: "pr-review", content: "rules", references: { "SKILL.md": "rules" } };
  const base = memoryConfig(request, undefined);
  expect(memoryConfig(request, undefined)).toEqual(base);
  expect(memoryConfig(request, skill).skill).toBe(hashSkill(skill));
  expect(memoryConfig(request, skill).skill).not.toBe(
    hashSkill({ ...skill, references: { "SKILL.md": "other" } }),
  );
  const withOnly = memoryConfig(
    parseRequest({
      repository: "owner/repo",
      "pr-number": "7",
      branch: "feature",
      model: "openai/gpt-5",
    }),
    undefined,
  );
  expect(withOnly.model).toBe("openai/gpt-5");
  expect(memoryConfig(request, undefined).mode).toBe("native");
  expect(
    memoryConfig(
      parseRequest({
        repository: "owner/repo",
        "pr-number": "7",
        branch: "feature",
        skill: "pr-review",
      }),
      undefined,
    ).mode,
  ).toBe("skill:pr-review");
});
