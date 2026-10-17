import { expect, test } from "vite-plus/test";
import { decodeWorkerResult, executionDiagnostic } from "../src/_agent/protocol.ts";

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

test("reviewer notes are bounded and unusable notes never lose the review", () => {
  const note = { paths: ["src/a.ts"], text: "one note" };
  expect(
    decodeWorkerResult(JSON.stringify({ ok: true, markdown: "Review", notes: [note] })),
  ).toEqual({ markdown: "Review", notes: [note] });
  for (const notes of [
    [{ paths: [], text: "no paths" }],
    [{ paths: ["../escape"], text: "traversal" }],
    [{ paths: ["/absolute"], text: "absolute" }],
    [{ paths: ["src/a.ts"], text: "" }],
    [{ paths: ["src/a.ts"], text: "x".repeat(2001) }],
    [{ paths: ["src/a.ts"], text: "line\nbreak" }],
    Array.from({ length: 41 }, () => note),
    [{ paths: ["src/a.ts"], text: "note", extra: true }],
    "not an array",
  ])
    expect(decodeWorkerResult(JSON.stringify({ ok: true, markdown: "Review", notes }))).toEqual({
      markdown: "Review",
    });
});
