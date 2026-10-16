import * as core from "@actions/core";
import { beforeEach, expect, test, vi } from "vite-plus/test";
import { run } from "../src/index.ts";

vi.mock("@actions/core", () => ({
  getInput: vi.fn(),
  setOutput: vi.fn(),
  info: vi.fn(),
  setFailed: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
});

test("sets an output and logs a greeting for the supplied name", () => {
  vi.mocked(core.getInput).mockReturnValue("Octocat");
  run();
  expect(core.getInput).toHaveBeenCalledWith("name");
  expect(core.setOutput).toHaveBeenCalledWith("greeting", "Hello, Octocat!");
  expect(core.info).toHaveBeenCalledWith("Hello, Octocat!");
  expect(core.setFailed).not.toHaveBeenCalled();
});

test("defaults to world when the input is empty", () => {
  vi.mocked(core.getInput).mockReturnValue("");
  run();
  expect(core.setOutput).toHaveBeenCalledWith("greeting", "Hello, world!");
});

test("marks the action as failed on errors", () => {
  vi.mocked(core.getInput).mockImplementation(() => {
    throw new Error("Input failed");
  });
  run();
  expect(core.setFailed).toHaveBeenCalledWith("Input failed");
  expect(core.setOutput).not.toHaveBeenCalled();
});

test("handles non-Error failures", () => {
  vi.mocked(core.getInput).mockImplementation(() => {
    throw "Input failed";
  });
  run();
  expect(core.setFailed).toHaveBeenCalledWith("Input failed");
});
