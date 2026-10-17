import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { cleanEnvironment, processRun } from "../src/_agent/process.ts";

test("worker environment has no inherited credentials or OpenCode configuration", () => {
  process.env.TEST_REVIEW_SECRET = "not inherited";
  const env = cleanEnvironment("/isolated/home");
  expect(env).not.toHaveProperty("TEST_REVIEW_SECRET");
  expect(env).not.toHaveProperty("GITHUB_TOKEN");
  expect(env).not.toHaveProperty("NODE_OPTIONS");
  expect(env).not.toHaveProperty("BUN_OPTIONS");
  expect(env.HOME).toBe("/isolated/home");
  expect(env.GIT_CONFIG_GLOBAL).toBe("/dev/null");
  delete process.env.TEST_REVIEW_SECRET;
});

test("split UTF-8 snapshot output and diagnostics preserve Unicode within the byte limit", async () => {
  const text = "Snapshot € 🚀 日本語\n";
  const bytes = [...Buffer.from(text)];
  const script = (stream: "stdout" | "stderr") => `
    const bytes = ${JSON.stringify(bytes)};
    function write() {
      if (!bytes.length) { process.exitCode = ${stream === "stderr" ? 7 : 0}; return; }
      process.${stream}.write(Buffer.from([bytes.shift()]), () => setTimeout(write, 20));
    }
    write();
  `;
  const options = { cwd: process.cwd(), env: cleanEnvironment(process.cwd()) };
  expect(
    await processRun(process.execPath, ["-e", script("stdout")], {
      ...options,
      maxBytes: bytes.length,
    }),
  ).toBe(text);
  await expect(
    processRun(process.execPath, ["-e", script("stdout")], {
      ...options,
      maxBytes: bytes.length - 1,
    }),
  ).rejects.toThrow("limit");
  await expect(
    processRun(process.execPath, ["-e", script("stderr")], {
      ...options,
      diagnostics: true,
    }),
  ).rejects.toThrow(`Review process exited with code 7. ${text}`);
});

test("child output, failure, timeout, and cancellation are bounded", async () => {
  const root = await mkdtemp(join(tmpdir(), "review-process-test-"));
  const options = { cwd: root, env: cleanEnvironment(root) };
  try {
    expect(await processRun(process.execPath, ["-e", "process.stdout.write('ok')"], options)).toBe(
      "ok",
    );
    await expect(processRun(process.execPath, ["-e", "process.exit(7)"], options)).rejects.toThrow(
      "code 7",
    );
    await expect(
      processRun(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
        ...options,
        timeout: 100,
      }),
    ).rejects.toThrow("timed out");
    await expect(
      processRun(process.execPath, ["-e", "process.stdout.write('too much')"], {
        ...options,
        maxBytes: 2,
      }),
    ).rejects.toThrow("limit");
    const controller = new AbortController();
    const child = processRun(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      ...options,
      signal: controller.signal,
    });
    controller.abort();
    await expect(child).rejects.toThrow("cancelled");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
