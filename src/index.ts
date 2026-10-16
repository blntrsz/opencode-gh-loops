import * as core from "@actions/core";

export function run(): void {
  try {
    const name = core.getInput("name") || "world";
    const greeting = `Hello, ${name}!`;
    core.setOutput("greeting", greeting);
    core.info(greeting);
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}
