export interface WorkerDiagnostic {
  readonly type: string;
  readonly message: string;
  readonly status?: number;
}

export class WorkerFailure extends Error {
  readonly diagnostic: WorkerDiagnostic;
  constructor(diagnostic: WorkerDiagnostic) {
    super(diagnostic.message);
    this.diagnostic = diagnostic;
  }
}

export function executionDiagnostic(error: {
  type: string;
  message: string;
  status?: number;
  response?: { body: string };
}): WorkerDiagnostic {
  let message = error.response
    ? "Model provider request failed. Response details omitted."
    : error.message;
  message = message
    .replace(/https?:\/\/\S+/gi, "[URL omitted]")
    .replace(/\b(?:Bearer\s+\S+|(?:sk-|gh[pousr]_)[\w-]+)\b/gi, "[credential omitted]")
    .replace(
      /\b(?:authorization|api[-_ ]?key|token)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi,
      "[credential omitted]",
    )
    .split("")
    .map((char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? " " : char))
    .join("")
    .slice(0, 512);
  return {
    type: error.type.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 128) || "ExecutionError",
    message: message || "OpenCode execution failed.",
    ...(Number.isInteger(error.status) ? { status: error.status } : {}),
  };
}

export function decodeWorkerResult(output: string): { markdown: string } {
  let result: unknown;
  try {
    result = JSON.parse(output);
  } catch {
    throw new Error("Invalid worker response.");
  }
  if (typeof result !== "object" || result === null || !("ok" in result))
    throw new Error("Invalid worker response.");
  if (
    result.ok === true &&
    Object.keys(result).every((key) => ["ok", "markdown"].includes(key)) &&
    "markdown" in result &&
    typeof result.markdown === "string" &&
    result.markdown.trim()
  )
    return { markdown: result.markdown };
  if (
    result.ok === false &&
    Object.keys(result).every((key) => ["ok", "error"].includes(key)) &&
    "error" in result &&
    typeof result.error === "object" &&
    result.error !== null
  ) {
    const error = result.error;
    if (
      "type" in error &&
      typeof error.type === "string" &&
      /^[a-zA-Z0-9_.-]{1,128}$/.test(error.type) &&
      "message" in error &&
      typeof error.message === "string" &&
      error.message.length > 0 &&
      error.message.length <= 512 &&
      !error.message
        .split("")
        .some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) &&
      (!("status" in error) ||
        (typeof error.status === "number" && Number.isInteger(error.status))) &&
      Object.keys(error).every((key) => ["type", "message", "status"].includes(key))
    )
      throw new Error(
        `OpenCode ${error.type}${"status" in error && typeof error.status === "number" ? ` (HTTP ${error.status})` : ""}: ${error.message}`,
      );
  }
  throw new Error("Invalid worker response.");
}
