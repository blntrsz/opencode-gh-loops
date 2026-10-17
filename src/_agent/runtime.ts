import { cp, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { cleanEnvironment, processRun } from "./process.ts";

export async function installWorker(
  action: string,
  root: string,
  home: string,
  signal?: AbortSignal,
): Promise<string> {
  if (process.platform !== "linux" || process.arch !== "x64")
    throw new Error("The review worker currently requires Linux x64.");
  if (!process.versions.bun) throw new Error("The review action must run with Bun.");
  const runtime = join(root, "runtime");
  await mkdir(runtime);
  for (const file of ["package.json", "bun.lock"])
    await cp(join(action, file), join(runtime, file));
  for (const file of [
    "index.ts",
    "memory-prompt.ts",
    "process.ts",
    "protocol.ts",
    "smoke-models.json",
  ])
    await cp(join(action, "src", "_agent", file), join(runtime, file));
  await processRun(
    process.execPath,
    ["install", "--cwd", runtime, "--production", "--frozen-lockfile", "--ignore-scripts"],
    {
      cwd: root,
      env: cleanEnvironment(home),
      signal,
      timeout: 180000,
    },
  );
  const manifest = JSON.parse(
    await readFile(join(runtime, "node_modules", "@opencode", "sdk", "package.json"), "utf8"),
  ) as { version: string };
  if (manifest.version !== "2.0.25") throw new Error("Unexpected SDK version.");
  return join(runtime, "index.ts");
}
