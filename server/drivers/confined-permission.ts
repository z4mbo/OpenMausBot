import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { Ask } from "./claude-permission-broker.ts";

const DENIED = "This shared request is confined to its granted project folder. Its permissions cannot be widened.";

function realTarget(path: string): string {
  if (existsSync(path)) return realpathSync(path);
  const parent = dirname(path);
  if (parent === path) throw new Error("No existing parent directory");
  return resolve(realTarget(parent), relative(parent, path));
}

export function confinedPermissionRefusal(ask: Pick<Ask, "kind" | "tool" | "input">, cwd: string): string | undefined {
  if (typeof ask.tool !== "string") return DENIED;
  if (ask.kind === "question" || ask.tool === "WebSearch" || ask.tool.startsWith("mcp__agents__")) return undefined;
  if (!["Read", "Grep", "Glob", "Edit", "Write"].includes(ask.tool)) return DENIED;
  const input = ask.input.file_path ?? ask.input.path ?? (["Grep", "Glob"].includes(ask.tool) ? "." : undefined);
  if (typeof input !== "string" || !input || input.startsWith("~") || input.includes("\0")) return DENIED;
  if (ask.tool === "Glob" && typeof ask.input.pattern === "string" && (isAbsolute(ask.input.pattern) || ask.input.pattern.split(/[\\/]/).includes(".."))) return DENIED;
  try {
    const path = relative(realpathSync(cwd), realTarget(resolve(cwd, input)));
    return path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path) ? DENIED : undefined;
  } catch { return DENIED; }
}
