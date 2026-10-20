import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { confinedPermissionRefusal } from "./confined-permission.ts";

it("confines native permission paths including new writes, traversals and directory links", () => {
  const home = mkdtempSync(join(tmpdir(), "origin-confined-permission-")), project = join(home, "project"), privateFolder = join(home, "private");
  mkdirSync(project); mkdirSync(privateFolder); writeFileSync(join(privateFolder, "secret.md"), "PRIVATE_CANARY");
  symlinkSync(privateFolder, join(project, "escape"), process.platform === "win32" ? "junction" : "dir");
  const check = (tool: string, input: Record<string, unknown>) => confinedPermissionRefusal({ kind: "permission", tool, input }, project);
  try {
    expect(check("Read", { file_path: "README.md" })).toBeUndefined();
    expect(check("Write", { file_path: "new/sub/file.md" })).toBeUndefined();
    expect(check("Grep", { pattern: "needle" })).toBeUndefined();
    for (const path of ["../private/secret.md", join(privateFolder, "secret.md"), "escape/secret.md", "escape/new.md", "~/.claude/settings.json"]) expect(check("Read", { file_path: path })).toMatch(/confined/);
    expect(check("Glob", { pattern: "../**" })).toMatch(/confined/);
    expect(check("Bash", { command: "anything" })).toMatch(/confined/);
    expect(check("mcp__browser__read", {})).toMatch(/confined/);
    expect(check("mcp__agents__options", {})).toBeUndefined();
  } finally { rmSync(home, { recursive: true, force: true }); }
});
