import { spawn, type ChildProcess } from "node:child_process";
import { buildClaudeCodeChildEnv } from "./auth-env.js";
import { findBinaryOnPath } from "./executable-path.js";

export type ClaudeCliLoginStatus =
  | { state: "idle" }
  | { state: "running"; pid: number | null }
  | { state: "succeeded" }
  | { state: "failed"; message: string };

type SpawnLogin = (
  executable: string,
  args: string[],
  options: Parameters<typeof spawn>[2],
) => ChildProcess;

let status: ClaudeCliLoginStatus = { state: "idle" };
let child: ChildProcess | null = null;

export function getClaudeCliLoginStatus(): ClaudeCliLoginStatus {
  return status;
}

export function startClaudeCliLogin(options?: {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  cwd?: string;
  binaryPath?: string | null;
  spawnLogin?: SpawnLogin;
}): ClaudeCliLoginStatus {
  if (child && child.exitCode === null && !child.killed) return status;

  const env = buildClaudeCodeChildEnv(options?.env ?? process.env);
  const binaryPath =
    options?.binaryPath === undefined
      ? findBinaryOnPath("claude", env)
      : options.binaryPath;
  if (!binaryPath) {
    status = {
      state: "failed",
      message: "Claude Code CLI (`claude`) was not found on PATH.",
    };
    return status;
  }

  try {
    const spawnLogin = options?.spawnLogin ?? spawn;
    child = spawnLogin(binaryPath, ["auth", "login", "--claudeai"], {
      cwd: options?.cwd ?? process.cwd(),
      env: env as NodeJS.ProcessEnv,
      stdio: "ignore",
      windowsHide: false,
    });
    status = { state: "running", pid: child.pid ?? null };
    child.once("error", (error) => {
      status = { state: "failed", message: error.message };
      child = null;
    });
    child.once("exit", (code, signal) => {
      status =
        code === 0
          ? { state: "succeeded" }
          : {
              state: "failed",
              message: `Claude Code login exited with ${
                signal ? `signal ${signal}` : `code ${code ?? "unknown"}`
              }.`,
            };
      child = null;
    });
    return status;
  } catch (error) {
    child = null;
    status = {
      state: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
    return status;
  }
}

export function resetClaudeCliLoginForTests(): void {
  child?.kill();
  child = null;
  status = { state: "idle" };
}
