import { expect, test } from "vite-plus/test";
import { decodeWorkerResult, executionDiagnostic } from "../src/worker-protocol.ts";

test("worker failures preserve bounded diagnostics without response bodies or credentials", () => {
  const error = executionDiagnostic({
    type: "Provider.RequestError",
    message:
      "Rejected https://example.invalid/private Bearer secret sk-privatekey\nprivate response",
    status: 429,
    response: { body: "private response" },
  });
  expect(error).toEqual({
    type: "Provider.RequestError",
    message: "Model provider request failed. Response details omitted.",
    status: 429,
  });
  expect(() => decodeWorkerResult(JSON.stringify({ ok: false, error }))).toThrow(
    "OpenCode Provider.RequestError (HTTP 429): Model provider request failed.",
  );
  expect(
    executionDiagnostic({
      type: "Error",
      message: "Failed https://example.invalid/private Bearer secret sk-privatekey token=private",
    }).message,
  ).toBe("Failed [URL omitted] [credential omitted] [credential omitted] [credential omitted]");
  expect(executionDiagnostic({ type: "Error", message: "x".repeat(2000) }).message.length).toBe(
    512,
  );
});

test("worker protocol admits only explicit success and validated failure", () => {
  expect(() => decodeWorkerResult("private malformed output")).toThrow("Invalid worker response.");
  expect(decodeWorkerResult('{"ok":true,"markdown":"Review"}')).toEqual({ markdown: "Review" });
  for (const result of [
    null,
    {},
    { markdown: "Review" },
    { ok: true, markdown: " " },
    { ok: false, error: { type: "Error", message: "Bad", response: { body: "private" } } },
    { ok: false, error: { type: "Error", message: "Bad", status: "429" } },
  ])
    expect(() => decodeWorkerResult(JSON.stringify(result))).toThrow("Invalid worker response.");
});
