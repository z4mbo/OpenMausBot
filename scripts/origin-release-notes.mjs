import { createHash } from "node:crypto";
import { createReadStream, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { releases } from "../shared/origin-releases.ts";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const releaseNotesPath = ".omb-scratch/origin-release-notes.md";

export function validateOriginRelease(version, history = releases) {
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error("Origin's desktop version must be a semantic version");
  }
  if (!Array.isArray(history) || history[0]?.version !== version) {
    throw new Error(`The first Origin changelog must describe package.json version ${version}`);
  }
  const versions = new Set();
  const text = value => typeof value === "string" && value.trim().length > 0;
  for (const release of history) {
    if (!text(release.version) || versions.has(release.version)) throw new Error("Origin changelog versions must be unique");
    versions.add(release.version);
    if (!text(release.title) || !/^\d{4}-\d{2}-\d{2}$/.test(release.date) ||
        new Date(`${release.date}T00:00:00Z`).toISOString().slice(0, 10) !== release.date) {
      throw new Error(`Origin ${release.version} needs a title and valid release date`);
    }
    if (!Array.isArray(release.changes) || release.changes.length === 0 ||
        release.changes.some(change => !text(change?.title) || !text(change?.body))) {
      throw new Error(`Origin ${release.version} needs non-empty changelog entries`);
    }
  }
  return history[0];
}

export function renderOriginReleaseNotes(release) {
  return `# Origin ${release.version}: ${release.title}\n\n${release.date}\n\n${release.changes
    .map(change => `## ${change.title}\n\n${change.body}`)
    .join("\n\n")}\n`;
}

function currentRelease(root, history = releases) {
  const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  return validateOriginRelease(version, history);
}

export function writeOriginReleaseNotes(root = ROOT, history = releases) {
  const release = currentRelease(root, history);
  const path = join(root, releaseNotesPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderOriginReleaseNotes(release));
  return path;
}

export default function beforePack(context) {
  writeOriginReleaseNotes(context.packager.projectDir);
}

export async function validateOriginUpdateFeed(feedPath, release = currentRelease(ROOT)) {
  const feed = parse(readFileSync(feedPath, "utf8"));
  if (feed?.version !== release.version) throw new Error(`${feedPath}: update version must be ${release.version}`);
  if (feed.releaseNotes !== renderOriginReleaseNotes(release)) {
    throw new Error(`${feedPath}: update releaseNotes do not match Origin's current changelog`);
  }
  const expected = basename(feedPath) === "latest-mac.yml"
    ? ["arm64.zip", "x64.zip", "arm64.dmg", "x64.dmg"].map(suffix => `Origin-${release.version}-${suffix}`)
    : basename(feedPath) === "latest.yml" ? [`Origin-${release.version}-setup.exe`] : null;
  if (!expected) throw new Error("Expected an Origin latest.yml or latest-mac.yml update feed");
  if (!Array.isArray(feed.files) || feed.files.length === 0) throw new Error(`${feedPath}: no update artifacts`);
  const names = new Set();
  for (const file of feed.files) {
    if (typeof file?.url !== "string" || !expected.includes(file.url) || names.has(file.url)) {
      throw new Error(`${feedPath}: unexpected or duplicate update artifact`);
    }
    names.add(file.url);
    const path = join(dirname(feedPath), file.url);
    const hash = createHash("sha512");
    for await (const bytes of createReadStream(path)) hash.update(bytes);
    if (file.sha512 !== hash.digest("base64") || file.size !== statSync(path).size) {
      throw new Error(`${feedPath}: hash or size mismatch for ${file.url}`);
    }
  }
  if (expected.some(name => !names.has(name))) throw new Error(`${feedPath}: missing an Origin update architecture or installer`);
  if (feed.path !== feed.files[0].url || feed.sha512 !== feed.files[0].sha512) {
    throw new Error(`${feedPath}: legacy update path and hash must match the first artifact`);
  }
  return feed;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length === 0 || (args.length === 1 && args[0] === "--check")) {
    const release = currentRelease(ROOT);
    console.log(`Origin ${release.version}: ${release.changes.length} changelog entries verified`);
  } else if (args.length === 1 && args[0] === "--write") {
    console.log(`Origin release notes: ${writeOriginReleaseNotes()}`);
  } else if (args[0] === "--feed" && args.length > 1) {
    for (const path of args.slice(1)) {
      await validateOriginUpdateFeed(resolve(path));
      console.log(`Origin update feed verified: ${path}`);
    }
  } else {
    throw new Error("Usage: node scripts/origin-release-notes.mjs [--check | --write | --feed latest.yml ...]");
  }
}
