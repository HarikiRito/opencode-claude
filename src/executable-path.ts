/**
 * Resolve the `claude` CLI binary (from OpenChamber harness executable-path).
 */
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildClaudeCodeChildEnv } from "./auth-env.js";

function probeClaude(
  candidate: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): boolean {
  try {
    const result = spawnSync(candidate, ["--version"], {
      encoding: "utf8",
      timeout: 4000,
      env: buildClaudeCodeChildEnv(env) as NodeJS.ProcessEnv,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error) return false;
    return result.status === 0 || Boolean((result.stdout || "").trim());
  } catch {
    return false;
  }
}

/**
 * Install locations the managed OpenChamber server commonly misses because its
 * PATH is not a login shell's PATH: the official installer's `~/.local/bin`
 * and the npm global bin.
 */
function knownClaudeLocations(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): string[] {
  const home = typeof env.HOME === "string" && env.HOME ? env.HOME : homedir();
  const candidates = [join(home, ".local", "bin", "claude")];

  try {
    const prefix = spawnSync("npm", ["prefix", "-g"], {
      encoding: "utf8",
      timeout: 6000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const dir = `${prefix.stdout || ""}`.trim();
    if (dir) candidates.push(join(dir, "bin", "claude"));
  } catch {
    // no npm prefix available — PATH and ~/.local/bin remain
  }
  return candidates;
}

export function findBinaryOnPath(
  name: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string | null {
  const pathEnv = typeof env.PATH === "string" ? env.PATH : "";
  const parts = pathEnv.split(process.platform === "win32" ? ";" : ":");
  const exts =
    process.platform === "win32" ? [".cmd", ".exe", ".bat", ""] : [""];
  for (const dir of parts) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = `${dir.replace(/[/\\]$/, "")}/${name}${ext}`;
      if (probeClaude(candidate, env)) return candidate;
    }
  }

  try {
    if (probeClaude(name, env)) return name;
  } catch {
    // missing
  }
  return null;
}

/**
 * `claude` as the managed server sees it: PATH first, then the install
 * locations that a clean server environment usually cannot see.
 */
export function resolveClaudeCli(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string | null {
  const onPath = findBinaryOnPath("claude", env);
  if (onPath) return onPath;
  for (const candidate of knownClaudeLocations(env)) {
    if (probeClaude(candidate, env)) return candidate;
  }
  return null;
}

export function resolveClaudeCodeExecutable(options?: {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}): string | null {
  return resolveClaudeCli(options?.env ?? process.env);
}

export function assertClaudeWorkingDirectory(cwd: unknown): string {
  return typeof cwd === "string" && cwd.trim() ? cwd.trim() : process.cwd();
}
