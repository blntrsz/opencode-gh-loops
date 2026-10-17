import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

export function cleanEnvironment(home: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: home,
    XDG_CONFIG_HOME: `${home}/config`,
    XDG_CACHE_HOME: `${home}/cache`,
    XDG_DATA_HOME: `${home}/data`,
    XDG_STATE_HOME: `${home}/state`,
    TMPDIR: `${home}/tmp`,
    LANG: "C.UTF-8",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_LFS_SKIP_SMUDGE: "1",
  };
}

export function processRun(
  command: string,
  args: readonly string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    input?: string;
    timeout?: number;
    signal?: AbortSignal;
    maxBytes?: number;
    processGroup?: boolean;
    diagnostics?: boolean;
  },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      detached: options.processGroup !== false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    let bytes = 0;
    let diagnostics = "";
    let failure: Error | undefined;
    const stop = (message: string) => {
      failure ??= new Error(message);
      if (child.pid) {
        try {
          process.kill(options.processGroup === false ? child.pid : -child.pid, "SIGKILL");
        } catch {
          /* The process may already have exited. */
        }
      }
    };
    const abort = () => stop("Review process cancelled.");
    const timer = setTimeout(() => stop("Review process timed out."), options.timeout ?? 600000);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > (options.maxBytes ?? 8 * 1024 * 1024)) stop("Process output exceeded its limit.");
      else output += stdoutDecoder.write(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (options.diagnostics)
        diagnostics = (diagnostics + stderrDecoder.write(chunk)).slice(0, 4096);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(options.input);
    child.on("error", (error) => {
      failure = error;
    });
    child.on("close", (code) => {
      output += stdoutDecoder.end();
      if (options.diagnostics) diagnostics = (diagnostics + stderrDecoder.end()).slice(0, 4096);
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      if (failure) reject(failure);
      else if (code !== 0)
        reject(
          new Error(
            `Review process exited with code ${code}.${diagnostics ? ` ${diagnostics}` : ""}`,
          ),
        );
      else resolve(output);
    });
  });
}
