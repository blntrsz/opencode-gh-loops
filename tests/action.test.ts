import { readFileSync, readdirSync } from "node:fs";
import { expect, test } from "vite-plus/test";

test("the composite action runs review TypeScript with Bun and production dependencies", () => {
  const action = readFileSync(new URL("../action.yml", import.meta.url), "utf8");
  expect(action).toContain("using: composite");
  expect(action).toContain("bun install --production --frozen-lockfile --ignore-scripts");
  expect(action).toContain("run: bun run ./src/review/index.ts");
  expect(action).not.toMatch(/setup-node|dist\/|bun run build/);
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  expect(manifest.scripts).not.toHaveProperty("build");
});

test("source is organized into internal slices and named actions", () => {
  const source = readdirSync(new URL("../src/", import.meta.url), { withFileTypes: true });
  expect(source.every((entry) => entry.isDirectory())).toBe(true);
  expect(source.map((entry) => entry.name).sort()).toEqual(["_agent", "review"]);
});
