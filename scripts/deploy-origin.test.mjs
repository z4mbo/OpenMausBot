import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { removeTempDir } from "../server/testing/cleanup.ts";
import { siteRolloutScript } from "./origin-site-rollout.mjs";

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

function runBackend(root, backupDir, key, execute) {
  const script = new URL("./deploy-origin.mjs", import.meta.url).href;
  const args = ["--backup", "--backend", "--backup-dir", backupDir];
  if (execute) args.push("--execute");
  const entry = `
    import childProcess from "node:child_process";
    import { syncBuiltinESMExports } from "node:module";
    childProcess.spawnSync = (command, args, options) => {
      const settings = options ?? args;
      console.log("deployment-test-command=" + JSON.stringify({ command, args: Array.isArray(args) ? args : [], cwd: settings.cwd }));
      return { status: 0 };
    };
    syncBuiltinESMExports();
    process.argv = [process.execPath, "deploy-origin.mjs", ...${JSON.stringify(args)}];
    await import(${JSON.stringify(script)});
  `;
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, HOME: root, USERPROFILE: root, TEMP: root, TMP: root };
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
    expect(result.commands[0].cwd).toMatch(/[\\/]backend$/);
    expect(result.commands[1].cwd).toBe(result.commands[0].cwd);
    const invocation = command => [command.command, ...(command.args ?? [])].join(" ");
    expect(invocation(result.commands[0])).toMatch(/npx convex export --include-file-storage --path/);
    expect(invocation(result.commands[0])).toContain("convex-wry-fly-446-");
    expect(invocation(result.commands[0])).toContain(backupDir);
    expect(invocation(result.commands[1])).toBe("npx convex deploy --typecheck enable");
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
    expect(result.stdout).toContain("convex export --include-file-storage --path");
    expect(result.stdout).toContain("convex deploy --typecheck enable");
    expect(result.stdout + result.stderr).not.toContain("synthetic-private-token");
  });
});
