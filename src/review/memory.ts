import { createHash } from "node:crypto";
import { memoryBounds } from "../_agent/protocol.ts";
import type { ReviewRequest } from "./review.ts";
import type { TrustedSkill } from "./review-workspace.ts";

export const memoryMarker = "<!-- opencode-gh-loops:memory:v1 -->";
export const memorySchema = 1;
/**
 * Bumped whenever the worker's memory instructions change, so a different
 * reviewer never inherits notes written under other rules.
 */
export const memoryInstructions = 1;
export const memoryLimit = 60000;
const { notes: maxNotes, text: maxNoteText, paths: maxNotePaths, path: maxPath } = memoryBounds;
const keySalt = "opencode-gh-loops/review-key/v1";

export type MemoryStatus = "added" | "deleted" | "modified" | "typechanged";

export interface MemoryFile {
  readonly path: string;
  readonly status: MemoryStatus;
  /** Mode and blob at the pinned base commit. */
  readonly baseMode: string;
  readonly baseBlob: string;
  /** Mode and blob at the pinned head commit. */
  readonly headMode: string;
  readonly headBlob: string;
}

/**
 * Content-addressed identity of one review. `reviewKey` covers the net change
 * from the merge base to the head, so it survives a rebase, a base merge, and
 * a base branch advancing past the merge. It changes only when the reviewed
 * bytes change, including a mode-only change.
 */
export interface MemoryKeys {
  readonly mergeBase: string;
  readonly head: string;
  readonly reviewKey: string;
  readonly files: readonly MemoryFile[];
}

export interface MemoryConfig {
  readonly model: string;
  readonly mode: string;
  readonly skill: string;
  readonly instructions: number;
}

export interface MemoryNote {
  readonly paths: readonly string[];
  readonly text: string;
}

export interface MemoryRecord {
  readonly schema: number;
  readonly repository: string;
  readonly number: number;
  readonly config: MemoryConfig;
  readonly keys: MemoryKeys;
  readonly notes: readonly MemoryNote[];
  readonly reviewed: { readonly base: string; readonly head: string };
}

export interface MemoryPlan {
  readonly reason: string;
  /** True when the whole previous review still describes the same bytes. */
  readonly exact: boolean;
  readonly notes: readonly MemoryNote[];
  /** Paths whose content differs from the previous record. */
  readonly moved: readonly string[];
  readonly previous?: MemoryRecord;
}

const statuses: Readonly<Record<string, MemoryStatus>> = {
  A: "added",
  D: "deleted",
  M: "modified",
  T: "typechanged",
};

function safePath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= maxPath &&
    !path.startsWith("/") &&
    !path.split("").some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) &&
    !path.split("/").some((part) => part === "" || part === "." || part === "..")
  );
}

/**
 * Parse `git diff --raw --no-abbrev --no-renames -z` between the merge base and
 * the head. Throws on anything unexpected so a caller can fail safe to "no
 * memory" instead of publishing a key that does not describe the snapshot.
 */
export function parseRawDiff(output: string): readonly MemoryFile[] {
  const tokens = output.split("\0");
  if (tokens.at(-1) === "") tokens.pop();
  if (tokens.length % 2 !== 0) throw new Error("Unexpected raw diff framing.");
  const files: MemoryFile[] = [];
  for (let index = 0; index < tokens.length; index += 2) {
    const match = /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([ADMT])$/.exec(
      tokens[index] ?? "",
    );
    const path = tokens[index + 1] ?? "";
    const status = match ? statuses[match[5] ?? ""] : undefined;
    if (!match || !status || !safePath(path)) throw new Error("Unexpected raw diff record.");
    files.push({
      path,
      status,
      baseMode: match[1] ?? "",
      baseBlob: match[3] ?? "",
      headMode: match[2] ?? "",
      headBlob: match[4] ?? "",
    });
  }
  return files.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
}

/** Hash the net change descriptor, not any commit identity. */
export function reviewKey(files: readonly MemoryFile[]): string {
  const hash = createHash("sha256").update(`${keySalt}\0`);
  for (const file of files)
    hash.update(
      `${file.status}\0${file.path}\0${file.baseMode}\0${file.baseBlob}\0${file.headMode}\0${file.headBlob}\0`,
    );
  return hash.digest("hex");
}

export function memoryKeys(
  mergeBase: string,
  head: string,
  files: readonly MemoryFile[],
): MemoryKeys {
  return { mergeBase, head, reviewKey: reviewKey(files), files };
}

export function hashSkill(skill: TrustedSkill | undefined): string {
  if (!skill) return "";
  const hash = createHash("sha256").update(`skill-v1\0${skill.id}\0`);
  for (const path of Object.keys(skill.references).sort())
    hash.update(`${path}\0${skill.references[path] ?? ""}\0`);
  return hash.digest("hex");
}

export function memoryConfig(
  request: ReviewRequest,
  skill: TrustedSkill | undefined,
): MemoryConfig {
  return {
    model: request.model,
    mode: request.mode.type === "skill" ? `skill:${request.mode.id}` : "native",
    skill: hashSkill(skill),
    instructions: memoryInstructions,
  };
}

function sameConfig(left: MemoryConfig, right: MemoryConfig): boolean {
  return (
    left.model === right.model &&
    left.mode === right.mode &&
    left.skill === right.skill &&
    left.instructions === right.instructions
  );
}

function fileStates(files: readonly MemoryFile[]): ReadonlyMap<string, string> {
  return new Map(
    files.map((file) => [file.path, `${file.status}\0${file.headMode}\0${file.headBlob}`]),
  );
}

/**
 * Decide which previous notes may be handed to the reviewer. Notes are only
 * reused when every path they cite is byte-identical, so a note can never be
 * carried across a change to the code it describes.
 */
export function planMemory(
  previous: MemoryRecord | undefined,
  request: ReviewRequest,
  config: MemoryConfig,
  keys: MemoryKeys,
): MemoryPlan {
  const empty = { notes: [], moved: [] } as const;
  if (!previous) return { reason: "No previous review memory.", exact: false, ...empty };
  if (previous.schema !== memorySchema)
    return { reason: "Memory schema changed.", exact: false, ...empty };
  if (previous.repository !== request.repository || previous.number !== request.number)
    return { reason: "Memory belongs to another pull request.", exact: false, ...empty };
  if (!sameConfig(previous.config, config))
    return { reason: "Review configuration changed.", exact: false, ...empty };
  if (previous.keys.reviewKey === keys.reviewKey)
    return {
      reason: "The reviewed change is byte-identical to the last review.",
      exact: true,
      notes: previous.notes,
      moved: [],
      previous,
    };
  const before = fileStates(previous.keys.files);
  const after = fileStates(keys.files);
  const notes = previous.notes.filter((note) =>
    note.paths.every((path) => before.has(path) && before.get(path) === after.get(path)),
  );
  const moved = keys.files
    .filter((file) => before.get(file.path) !== after.get(file.path))
    .map((file) => file.path);
  return {
    reason: "Changed files were re-verified and unchanged notes were reused.",
    exact: false,
    notes,
    moved,
    previous,
  };
}

/**
 * Assemble a storable record. Returns undefined when even a note-free record
 * cannot fit the size budget, which happens only for very large changes; the
 * caller then reviews without memory instead of writing something unreadable.
 * Notes are dropped from the end until the record fits.
 */
export function buildRecord(input: {
  readonly repository: string;
  readonly number: number;
  readonly config: MemoryConfig;
  readonly keys: MemoryKeys;
  readonly reviewed: { readonly base: string; readonly head: string };
  readonly notes: readonly MemoryNote[];
}): MemoryRecord | undefined {
  const notes = input.notes.slice(0, maxNotes).map((note) => ({
    paths: note.paths.slice(0, maxNotePaths),
    text: note.text.slice(0, maxNoteText),
  }));
  const base = {
    schema: memorySchema,
    repository: input.repository,
    number: input.number,
    config: input.config,
    // Derive the key from the files so a stored record is always self-consistent.
    keys: memoryKeys(input.keys.mergeBase, input.keys.head, input.keys.files),
    reviewed: input.reviewed,
  };
  for (let keep = notes.length; keep >= 0; keep--) {
    const record: MemoryRecord = { ...base, notes: notes.slice(0, keep) };
    if (serialize(record).length <= memoryLimit) return record;
  }
  return undefined;
}

function serialize(record: MemoryRecord): string {
  return JSON.stringify(record).replace(/@/g, "\\u0040").replace(/`/g, "\\u0060");
}

export function encodeRecord(record: MemoryRecord): string {
  const body = serialize(record);
  if (body.length > memoryLimit) throw new Error("Memory record exceeds its size limit.");
  return `${memoryMarker}\n<details><summary>OpenCode review memory (machine-readable)</summary>\n\n\`\`\`json\n${body}\n\`\`\`\n\n</details>\n`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.split("").some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  );
}

function isSha(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
}

function readNote(value: unknown): MemoryNote | undefined {
  if (!isPlainObject(value)) return undefined;
  if (Object.keys(value).some((key) => !["paths", "text"].includes(key))) return undefined;
  const paths = value.paths;
  if (
    !Array.isArray(paths) ||
    paths.length === 0 ||
    paths.length > maxNotePaths ||
    !paths.every((path) => isText(path) && safePath(path))
  )
    return undefined;
  if (!isText(value.text) || value.text.length > maxNoteText) return undefined;
  return { paths: paths as string[], text: value.text };
}

/** Strict, total validation of a record read back from GitHub. */
export function validateRecord(value: unknown): MemoryRecord | undefined {
  if (!isPlainObject(value)) return undefined;
  if (
    Object.keys(value).some(
      (key) =>
        !["schema", "repository", "number", "config", "keys", "notes", "reviewed"].includes(key),
    )
  )
    return undefined;
  if (value.schema !== memorySchema) return undefined;
  if (typeof value.repository !== "string" || !/^[^/\s]+\/[^/\s]+$/.test(value.repository))
    return undefined;
  if (!Number.isSafeInteger(value.number) || (value.number as number) < 1) return undefined;
  const config = value.config;
  if (!isPlainObject(config)) return undefined;
  if (
    Object.keys(config).some((key) => !["model", "mode", "skill", "instructions"].includes(key)) ||
    !isText(config.model) ||
    !isText(config.mode) ||
    typeof config.skill !== "string" ||
    (config.skill !== "" && !/^[0-9a-f]{64}$/.test(config.skill)) ||
    config.instructions !== memoryInstructions
  )
    return undefined;
  const keys = value.keys;
  if (!isPlainObject(keys)) return undefined;
  if (
    Object.keys(keys).some((key) => !["mergeBase", "head", "reviewKey", "files"].includes(key)) ||
    !isSha(keys.mergeBase) ||
    !isSha(keys.head) ||
    typeof keys.reviewKey !== "string" ||
    !/^[0-9a-f]{64}$/.test(keys.reviewKey) ||
    !Array.isArray(keys.files) ||
    keys.files.length > 2000
  )
    return undefined;
  const files: MemoryFile[] = [];
  for (const file of keys.files) {
    if (!isPlainObject(file)) return undefined;
    if (
      Object.keys(file).some(
        (key) => !["path", "status", "baseMode", "baseBlob", "headMode", "headBlob"].includes(key),
      ) ||
      !isText(file.path) ||
      !safePath(file.path) ||
      typeof file.status !== "string" ||
      !Object.values(statuses).includes(file.status as MemoryStatus) ||
      !/^[0-7]{6}$/.test(String(file.baseMode)) ||
      !/^[0-7]{6}$/.test(String(file.headMode)) ||
      !isSha(file.baseBlob) ||
      !isSha(file.headBlob)
    )
      return undefined;
    files.push({
      path: file.path,
      status: file.status as MemoryStatus,
      baseMode: String(file.baseMode),
      baseBlob: file.baseBlob,
      headMode: String(file.headMode),
      headBlob: file.headBlob,
    });
  }
  if (reviewKey(files) !== keys.reviewKey) return undefined;
  if (!Array.isArray(value.notes) || value.notes.length > maxNotes) return undefined;
  const notes: MemoryNote[] = [];
  for (const note of value.notes) {
    const parsed = readNote(note);
    if (!parsed) return undefined;
    notes.push(parsed);
  }
  const reviewed = value.reviewed;
  if (!isPlainObject(reviewed) || !isSha(reviewed.base) || !isSha(reviewed.head)) return undefined;
  if (Object.keys(reviewed).some((key) => !["base", "head"].includes(key))) return undefined;
  return {
    schema: memorySchema,
    repository: value.repository,
    number: value.number as number,
    config: {
      model: config.model,
      mode: config.mode,
      skill: config.skill,
      instructions: memoryInstructions,
    },
    keys: { mergeBase: keys.mergeBase, head: keys.head, reviewKey: keys.reviewKey, files },
    notes,
    reviewed: { base: reviewed.base, head: reviewed.head },
  };
}

/** Read the bot-owned memory record out of a comment body, if it is one. */
export function decodeRecord(body: string | undefined): MemoryRecord | undefined {
  if (typeof body !== "string" || !body.startsWith(memoryMarker)) return undefined;
  const fence = /\n```json\n([\s\S]*?)\n```\n/.exec(body.slice(memoryMarker.length));
  if (!fence?.[1]) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(fence[1]);
  } catch {
    return undefined;
  }
  return validateRecord(value);
}
