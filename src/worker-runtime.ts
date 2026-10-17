import { createHash } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cleanEnvironment, processRun } from "./review-process.ts";

const bunDigest = "3e730528d89775f03f87f05c06787c4df4099d0a37f3f252e7b829cb23816e18";
export async function installWorker(
  action: string,
  root: string,
  home: string,
  signal?: AbortSignal,
): Promise<string> {
  if (process.platform !== "linux" || process.arch !== "x64")
    throw new Error("The review worker currently requires Linux x64.");
  const runtime = join(root, "runtime");
  await mkdir(runtime);
  for (const file of ["package.json", "bun.lock", "review-worker.js", "smoke-models.json"])
    await cp(join(action, "dist", "worker", file), join(runtime, file));
  const response = await fetch(
    "https://github.com/oven-sh/bun/releases/download/bun-v1.4.3/bun-linux-x64.zip",
    {
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(60000)])
        : AbortSignal.timeout(60000),
    },
  );
  if (!response.ok) throw new Error("Could not download pinned dependency installer.");
  const zip = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(zip).digest("hex") !== bunDigest)
    throw new Error("Dependency installer checksum mismatch.");
  const archive = join(root, "bun.zip");
  await writeFile(archive, zip);
  const options = { cwd: root, env: cleanEnvironment(home), signal, timeout: 180000 };
  await processRun("unzip", ["-q", archive, "-d", root], options);
  await processRun(
    join(root, "bun-linux-x64", "bun"),
    ["install", "--cwd", runtime, "--frozen-lockfile", "--ignore-scripts"],
    options,
  );
  // Check the installed manifest rather than trusting installer stdout.
  const manifest = JSON.parse(
    await readFile(join(runtime, "node_modules", "@opencode", "sdk", "package.json"), "utf8"),
  ) as { version: string };
  if (manifest.version !== "2.0.25") throw new Error("Unexpected SDK version.");
  return join(runtime, "review-worker.js");
}
