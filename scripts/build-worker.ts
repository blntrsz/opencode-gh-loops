import { cp, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const result = spawnSync(
  "bun",
  [
    "build",
    "worker/review-worker.ts",
    "--target=node",
    "--packages=external",
    "--outdir=dist/worker",
  ],
  { stdio: "inherit" },
);
if (result.status !== 0) throw new Error("Worker build failed.");
await mkdir("dist/worker", { recursive: true });
for (const file of ["package.json", "bun.lock", "smoke-models.json"])
  await cp(`worker/${file}`, `dist/worker/${file}`);
