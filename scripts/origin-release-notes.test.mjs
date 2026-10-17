import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { releases } from "../shared/origin-releases.ts";
import beforePack, {
  releaseNotesPath,
  renderOriginReleaseNotes,
  validateOriginRelease,
  validateOriginUpdateFeed,
  writeOriginReleaseNotes,
} from "./origin-release-notes.mjs";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), "origin-release-notes-"));
  roots.push(root);
  writeFileSync(join(root, "package.json"), JSON.stringify({ version: packageJson.version }));
  return root;
}

function updateFeed(platform) {
  const root = fixtureRoot();
  const release = releases[0];
  const names = platform === "mac"
    ? ["arm64.zip", "x64.zip", "arm64.dmg", "x64.dmg"].map(suffix => `Origin-${release.version}-${suffix}`)
    : [`Origin-${release.version}-setup.exe`];
  const files = names.map(url => {
    const bytes = Buffer.from(`fixture artifact ${url}`);
    writeFileSync(join(root, url), bytes);
    return { url, sha512: createHash("sha512").update(bytes).digest("base64"), size: bytes.length };
  });
  const feed = {
    version: release.version,
    releaseNotes: renderOriginReleaseNotes(release),
    files,
    path: files[0].url,
    sha512: files[0].sha512,
  };
  const path = join(root, platform === "mac" ? "latest-mac.yml" : "latest.yml");
  const save = () => writeFileSync(path, stringify(feed));
  save();
  return { root, release, feed, path, save };
}

describe("Origin release history", () => {
  it("provides changelog entries for the desktop version being built", () => {
    expect(releases[0].version).toBe(packageJson.version);
    expect(releases[0].changes.length).toBeGreaterThan(0);
    expect(validateOriginRelease(packageJson.version)).toBe(releases[0]);
  });

  it("rejects a version bump without matching current release notes", () => {
    expect(() => validateOriginRelease("9.9.9")).toThrow(/first Origin changelog/);
    expect(() => validateOriginRelease(packageJson.version, [])).toThrow(/first Origin changelog/);
    expect(() => validateOriginRelease("desktop-1.0")).toThrow(/semantic version/);
  });

  it("rejects blank, duplicate and incomplete release entries", () => {
    const latest = releases[0];
    for (const change of [{ changes: [] }, { title: " " }, { changes: [{ title: "Fix", body: " " }] }]) {
      expect(() => validateOriginRelease(latest.version, [{ ...latest, ...change }])).toThrow();
    }
    expect(() => validateOriginRelease(latest.version, [latest, latest])).toThrow(/unique/);
    expect(() => validateOriginRelease(latest.version, [{ ...latest, date: "2026-02-30" }])).toThrow(/valid release date/);
  });

  it("writes identical Markdown on repeated builds and replaces stale generated notes", () => {
    const root = fixtureRoot();
    const path = writeOriginReleaseNotes(root);
    const expected = renderOriginReleaseNotes(releases[0]);
    expect(readFileSync(path, "utf8")).toBe(expected);
    writeFileSync(path, "stale release notes");
    beforePack({ packager: { projectDir: root } });
    expect(readFileSync(path, "utf8")).toBe(expected);
    writeOriginReleaseNotes(root);
    expect(readFileSync(path, "utf8")).toBe(expected);
  });

  it("stops direct electron-builder packaging when the changelog is missing", () => {
    const root = fixtureRoot();
    writeFileSync(join(root, "package.json"), JSON.stringify({ version: "9.9.9" }));
    expect(() => beforePack({ packager: { projectDir: root } })).toThrow(/first Origin changelog/);
    expect(existsSync(join(root, releaseNotesPath))).toBe(false);
  });
});

describe("Origin desktop update feeds", () => {
  it.each(["mac", "windows"])("accepts %s feeds emitted by the installed electron-builder", async platform => {
    const require = createRequire(import.meta.url);
    const builderRequire = createRequire(require.resolve("electron-builder/package.json"));
    const { Arch, Platform, PlatformPackager } = builderRequire("app-builder-lib");
    const { createUpdateInfoTasks, writeUpdateInfoFiles } = builderRequire("app-builder-lib/out/publish/updateInfoBuilder.js");
    const { root, path, feed, release } = updateFeed(platform);
    rmSync(path);
    writeOriginReleaseNotes(root);
    const packager = {
      projectDir: root,
      appInfo: { version: release.version },
      platform: platform === "mac" ? Platform.MAC : Platform.WINDOWS,
      platformSpecificBuildOptions: {},
      config: { releaseInfo: { releaseNotesFile: releaseNotesPath } },
      info: { buildResourcesDir: join(root, "build") },
      resourceList: Promise.resolve([]),
      getResource: PlatformPackager.prototype.getResource,
      emitArtifactCreated: async () => {},
    };
    const tasks = [];
    for (const file of feed.files) {
      tasks.push(...await createUpdateInfoTasks({
        packager,
        file: join(root, file.url),
        arch: file.url.includes("arm64") ? Arch.arm64 : Arch.x64,
        target: { outDir: root },
        updateInfo: { sha512: file.sha512, size: file.size },
      }, [{ provider: "generic", url: "https://origin.imbored.fun/downloads/" }]));
    }
    await writeUpdateInfoFiles(tasks, packager);
    await expect(validateOriginUpdateFeed(path, release)).resolves.toMatchObject({
      version: release.version, releaseNotes: renderOriginReleaseNotes(release),
    });
  });

  it.each(["mac", "windows"])("verifies %s notes and every updater artifact against disk", async platform => {
    const { path, feed, release } = updateFeed(platform);
    await expect(validateOriginUpdateFeed(path, release)).resolves.toEqual(feed);
  });

  it.each(["mac", "windows"])("rejects a %s feed without the current changelog", async platform => {
    const { path, feed, release, save } = updateFeed(platform);
    delete feed.releaseNotes;
    save();
    await expect(validateOriginUpdateFeed(path, release)).rejects.toThrow(/releaseNotes/);
    feed.releaseNotes = "Notes from a previous version";
    save();
    await expect(validateOriginUpdateFeed(path, release)).rejects.toThrow(/releaseNotes/);
  });

  it("rejects another version and incomplete macOS architecture coverage", async () => {
    const { path, feed, release, save } = updateFeed("mac");
    feed.version = "0.0.1";
    save();
    await expect(validateOriginUpdateFeed(path, release)).rejects.toThrow(/update version/);
    feed.version = release.version;
    feed.files.pop();
    save();
    await expect(validateOriginUpdateFeed(path, release)).rejects.toThrow(/missing an Origin update architecture/);
  });

  it("rejects edited bytes, incorrect size and a mismatched legacy update path", async () => {
    const { root, path, feed, release, save } = updateFeed("windows");
    const artifact = join(root, feed.files[0].url);
    const bytes = readFileSync(artifact);
    writeFileSync(artifact, "edited installer");
    await expect(validateOriginUpdateFeed(path, release)).rejects.toThrow(/hash or size mismatch/);
    writeFileSync(artifact, bytes);
    feed.files[0].size++;
    save();
    await expect(validateOriginUpdateFeed(path, release)).rejects.toThrow(/hash or size mismatch/);
    feed.files[0].size--;
    feed.path = "other-installer.exe";
    save();
    await expect(validateOriginUpdateFeed(path, release)).rejects.toThrow(/legacy update path/);
  });

  it("rejects duplicated artifacts and paths outside the artifact directory", async () => {
    const { path, feed, release, save } = updateFeed("windows");
    feed.files.push(feed.files[0]);
    save();
    await expect(validateOriginUpdateFeed(path, release)).rejects.toThrow(/unexpected or duplicate/);
    feed.files.pop();
    feed.files[0].url = "../other-installer.exe";
    save();
    await expect(validateOriginUpdateFeed(path, release)).rejects.toThrow(/unexpected or duplicate/);
  });
});

describe("Origin desktop packaging gates", () => {
  it("uses the shared changelog for direct packages and normal package preparation", () => {
    const config = parse(readFileSync(new URL("../electron-builder.yml", import.meta.url), "utf8"));
    expect(config.beforePack).toBe("./scripts/origin-release-notes.mjs");
    expect(config.releaseInfo.releaseNotesFile).toBe(releaseNotesPath);
    expect(packageJson.scripts["package:prepare"].startsWith("pnpm release:notes && ")).toBe(true);
  });

  it("checks release coverage before building and verifies both feeds before uploading", () => {
    const workflow = parse(readFileSync(new URL("../.github/workflows/origin-desktop.yml", import.meta.url), "utf8"));
    expect(workflow.jobs.version.steps.some(step => step.run === "pnpm check:releases")).toBe(true);
    for (const [job, feed] of [["mac", "latest-mac.yml"], ["windows", "latest.yml"]]) {
      expect(workflow.jobs[job].needs).toBe("version");
      const steps = workflow.jobs[job].steps;
      const gate = steps.findIndex(step => step.run === `node scripts/origin-release-notes.mjs --feed release-origin/${feed}`);
      const upload = steps.findIndex(step => step.uses?.startsWith("actions/upload-artifact@"));
      expect(gate).toBeGreaterThan(-1);
      expect(upload).toBeGreaterThan(gate);
    }
  });
});
