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
