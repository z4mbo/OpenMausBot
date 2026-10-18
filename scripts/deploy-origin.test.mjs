import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { removeTempDir } from "../server/testing/cleanup.ts";
import { siteRolloutScript } from "./origin-site-rollout.mjs";
import ts from "typescript";

const shell = process.platform === "win32"
  ? resolve(spawnSync("git", ["--exec-path"], { encoding: "utf8" }).stdout.trim(), "../../../bin/bash.exe")
  : "/bin/sh";
const fixtures = [];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "origin-deploy-test-"));
  fixtures.push(root);
  const site = "Origin live's site";
  const compose = "compose app";
  const incoming = join(root, "incoming");
  mkdirSync(join(root, site, "deploy"), { recursive: true });
  mkdirSync(join(root, compose));
  mkdirSync(incoming);
  writeFileSync(join(root, site, "site.txt"), "previous website");
  writeFileSync(join(root, site, "deploy", "operator.conf"), "synthetic operator config");
  writeFileSync(join(incoming, "site.txt"), "next website");
  const archive = () => {
    const result = spawnSync("tar", ["-czf", join(root, "incoming.tgz"), "-C", incoming, "."], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
  };
  archive();
  const run = () => {
    expect(resolve(root).startsWith(join(tmpdir(), "origin-deploy-test-"))).toBe(true);
    return spawnSync(shell, ["-c", `docker_log="$PWD/docker.log"
docker() { printf '%s\\n' "$*" >> "$docker_log"; }
${siteRolloutScript({ site, compose, tarball: "incoming.tgz", releaseId: "fixture-rollout" })}`], { cwd: root, encoding: "utf8" });
  };
  return { root, site, incoming, archive, run };
}

afterEach(async () => {
  for (const root of fixtures.splice(0)) {
    expect(resolve(root).startsWith(join(tmpdir(), "origin-deploy-test-"))).toBe(true);
    await removeTempDir(root);
  }
});

describe("Origin site deployment", () => {
  it("stages the shared workflow module required by the backend's site typecheck", () => {
    const root = mkdtempSync(join(tmpdir(), "origin-deploy-test-"));
    fixtures.push(root);
    const repository = join(root, "source");
    const stage = join(root, "staged");
    const files = {
      "package.json": JSON.stringify({ version: "0.2.11", packageManager: "pnpm@10.33.0" }),
      "pnpm-workspace.yaml": "packages:\n  - backend\n  - site\n",
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      "backend/package.json": "{}\n",
      "backend/convex/tasks.ts": "import { workflow } from '../../shared/origin-columns';\nexport const taskWorkflow = workflow;\n",
      "backend/lib/fixture.ts": "export {};\n",
      "shared/origin-columns.ts": "export const workflow = 'Draft';\n",
      "shared/origin-theme.css": ":root {}\n",
      "shared/origin-releases.ts": "export const releases = [];\n",
      "shared/origin-site-address.ts": "export const site = 'https://example.invalid';\n",
      "site/Dockerfile": "FROM node:24-alpine\n",
      "site/.dockerignore": "node_modules\n",
      "scripts/deploy-origin.mjs": readFileSync(new URL("./deploy-origin.mjs", import.meta.url), "utf8"),
      "scripts/origin-site-rollout.mjs": readFileSync(new URL("./origin-site-rollout.mjs", import.meta.url), "utf8"),
    };
    for (const [name, contents] of Object.entries(files)) {
      const path = join(repository, name);
      mkdirSync(resolve(path, ".."), { recursive: true });
      writeFileSync(path, contents);
    }
    for (const args of [["init", "--quiet"], ["add", "."], ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", `core.hooksPath=${join(root, "no-hooks")}`, "commit", "--quiet", "-m", "Synthetic site source"]]) {
      const result = spawnSync("git", args, { cwd: repository, encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
    }
    const script = pathToFileURL(join(repository, "scripts/deploy-origin.mjs")).href;
    const entry = `
      import childProcess from "node:child_process";
      import { syncBuiltinESMExports } from "node:module";
      const original = childProcess.spawnSync;
      childProcess.spawnSync = (command, ...args) => {
        if (command === "pnpm" || typeof command === "string" && command.startsWith("pnpm ")) return { status: 0 };
        return original(command, ...args);
      };
      syncBuiltinESMExports();
      process.argv = [process.execPath, "deploy-origin.mjs", "--stage", ${JSON.stringify(stage)}];
      await import(${JSON.stringify(script)});
    `;
    const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, HOME: root, USERPROFILE: root, TEMP: root, TMP: root };
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", entry], { cwd: repository, env, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    const task = join(stage, "backend/convex/tasks.ts");
    const program = ts.createProgram([task], { noEmit: true, types: [], target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler });
    expect(ts.getPreEmitDiagnostics(program).filter(diagnostic => diagnostic.code === 2307).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([]);
    expect(readFileSync(join(stage, "shared/origin-columns.ts"), "utf8")).toBe(files["shared/origin-columns.ts"]);
  });

  it("preserves operator configuration while replacing the site and retaining its previous tree", () => {
    const { root, site, run } = fixture();
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(root, site, "site.txt"), "utf8")).toBe("next website");
    expect(readFileSync(join(root, site, "deploy", "operator.conf"), "utf8")).toBe("synthetic operator config");
    expect(readFileSync(join(root, `${site}.bak-fixture-rollout`, "site.txt"), "utf8")).toBe("previous website");
  });

  it("leaves unrelated staging and Docker image state alone", () => {
    const { root, site, run } = fixture();
    mkdirSync(join(root, `${site}.new`));
    writeFileSync(join(root, `${site}.new`, "another-operator.txt"), "keep this");
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(root, `${site}.new`, "another-operator.txt"), "utf8")).toBe("keep this");
    expect(readFileSync(join(root, "docker.log"), "utf8").trim()).toBe("compose up -d --no-deps --build origin");
  });

  it.each(["new", "bak"])("refuses an occupied rollout %s path before moving the current site", (kind) => {
    const { root, site, run } = fixture();
    mkdirSync(join(root, `${site}.${kind}-fixture-rollout`));
    writeFileSync(join(root, `${site}.${kind}-fixture-rollout`, "keep.txt"), "keep this");
    const result = run();
    expect(result.status).not.toBe(0);
    expect(readFileSync(join(root, site, "site.txt"), "utf8")).toBe("previous website");
    expect(readFileSync(join(root, `${site}.${kind}-fixture-rollout`, "keep.txt"), "utf8")).toBe("keep this");
    expect(existsSync(join(root, "docker.log"))).toBe(false);
  });

  it("rejects an incoming operator-config collision before replacing the current site", () => {
    const { root, site, incoming, archive, run } = fixture();
    mkdirSync(join(incoming, "deploy"));
    writeFileSync(join(incoming, "deploy", "operator.conf"), "unreviewed replacement");
    archive();
    const result = run();
    expect(result.status).not.toBe(0);
    expect(readFileSync(join(root, site, "site.txt"), "utf8")).toBe("previous website");
    expect(readFileSync(join(root, site, "deploy", "operator.conf"), "utf8")).toBe("synthetic operator config");
    expect(existsSync(join(root, "docker.log"))).toBe(false);
  });
});

function backendFixture() {
  const root = mkdtempSync(join(tmpdir(), "origin-deploy-test-"));
  fixtures.push(root);
  return { root, backupDir: join(root, "backups") };
}

function runBackend(root, backupDir, key, execute, { failFirst = false, commandPath = process.env.PATH } = {}) {
  const script = new URL("./deploy-origin.mjs", import.meta.url).href;
  const args = ["--backup", "--backend", "--backup-dir", backupDir];
  if (execute) args.push("--execute");
  const entry = `
    import childProcess from "node:child_process";
    import { syncBuiltinESMExports } from "node:module";
    childProcess.spawnSync = (command, args, options) => {
      const settings = options ?? args;
      console.log("deployment-test-command=" + JSON.stringify({ command, args: Array.isArray(args) ? args : [], cwd: settings.cwd }));
      return { status: ${failFirst ? 7 : 0} };
    };
    syncBuiltinESMExports();
    process.argv = [process.execPath, "deploy-origin.mjs", ...${JSON.stringify(args)}];
    await import(${JSON.stringify(script)});
  `;
  const env = { PATH: commandPath, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, HOME: root, USERPROFILE: root, TEMP: root, TMP: root };
  if (key !== undefined) env.CONVEX_DEPLOY_KEY = key;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", entry], { cwd: root, env, encoding: "utf8" });
  const commands = result.stdout.split(/\r?\n/).filter(line => line.startsWith("deployment-test-command=")).map(line => JSON.parse(line.slice("deployment-test-command=".length)));
  return { ...result, commands };
}

describe("Origin backend deployment authority", () => {
  it("backs up before deploying with the dev key for the exact public deployment", () => {
    const { root, backupDir } = backendFixture();
    const key = "dev:wry-fly-446|synthetic-private-token";
    const result = runBackend(root, backupDir, key, true);
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(backupDir)).toBe(true);
    expect(result.commands).toHaveLength(2);
    const backend = resolve(import.meta.dirname, "../backend");
    const cli = join(backend, "node_modules", "convex", "bin", "main.js");
    expect(result.commands[0]).toEqual({ command: process.execPath, args: [cli, "export", "--include-file-storage", "--path", expect.any(String)], cwd: backend });
    expect(result.commands[0].args[4]).toMatch(/[\\/]convex-wry-fly-446-[^\\/]+\.zip$/);
    expect(result.commands[0].args[4]).toContain(backupDir);
    expect(result.commands[1]).toEqual({ command: process.execPath, args: [cli, "deploy", "--typecheck", "enable"], cwd: backend });
    expect(JSON.stringify(result.commands)).not.toContain(key);
    expect(JSON.stringify(result.commands)).not.toContain("synthetic-private-token");
    expect(result.stdout).not.toContain("--execute would stop here");
    expect(result.stdout + result.stderr).not.toContain(key);
    expect(result.stdout + result.stderr).not.toContain("synthetic-private-token");
  });

  it.each([
    ["a production key with the same name", "prod:wry-fly-446|synthetic-private-token"],
    ["another development deployment", "dev:other-deployment|synthetic-private-token"],
    ["another production deployment", "prod:other-deployment|synthetic-private-token"],
    ["a similarly named deployment", "dev:wry-fly-446-extra|synthetic-private-token"],
    ["a preview deployment", "preview:wry-fly-446|synthetic-private-token"],
    ["a project key", "project:synthetic-project|synthetic-private-token"],
    ["an empty deployment token", "dev:wry-fly-446|"],
    ["an absent deployment key", undefined],
  ])("rejects %s before creating a backup or running a command", (_label, key) => {
    const { root, backupDir } = backendFixture();
    const result = runBackend(root, backupDir, key, true);
    expect(result.status).toBe(1);
    expect(result.commands).toEqual([]);
    expect(existsSync(backupDir)).toBe(false);
    expect(result.stderr).toContain(key === undefined ? "CONVEX_DEPLOY_KEY is not set" : "CONVEX_DEPLOY_KEY is not a");
    expect(result.stdout + result.stderr).not.toContain("synthetic-private-token");
  });

  it.each([undefined, "prod:wry-fly-446|synthetic-private-token"])("prints a read-only plan without valid authority (%s)", key => {
    const { root, backupDir } = backendFixture();
    const result = runBackend(root, backupDir, key, false);
    expect(result.status, result.stderr).toBe(0);
    expect(result.commands).toEqual([]);
    expect(existsSync(backupDir)).toBe(false);
    expect(result.stdout).toContain("--execute would stop here");
    expect(result.stdout).toContain(process.execPath);
    expect(result.stdout).toContain("export --include-file-storage --path");
    expect(result.stdout).toContain("deploy --typecheck enable");
    expect(result.stdout).not.toContain("npx convex");
    expect(result.stdout + result.stderr).not.toContain("synthetic-private-token");
  });

  it("uses the selected Node runtime when PATH cannot resolve package-manager shims", () => {
    const { root, backupDir } = backendFixture();
    const result = runBackend(root, backupDir, "dev:wry-fly-446|synthetic-private-token", true, { commandPath: join(root, "no-command-shims") });
    expect(result.status, result.stderr).toBe(0);
    expect(result.commands).toHaveLength(2);
    for (const command of result.commands) {
      expect(command.command).toBe(process.execPath);
      expect(command.args[0]).toBe(resolve(import.meta.dirname, "../backend/node_modules/convex/bin/main.js"));
    }
  });

  it("stops before deployment if the selected Convex export fails", () => {
    const { root, backupDir } = backendFixture();
    const result = runBackend(root, backupDir, "dev:wry-fly-446|synthetic-private-token", true, { failFirst: true });
    expect(result.status).toBe(1);
    expect(result.commands).toHaveLength(1);
    expect(result.stderr).toContain("exited with 7");
    expect(result.stdout).not.toContain("# Deploy backend/");
    expect(result.stdout + result.stderr).not.toContain("synthetic-private-token");
  });
});
