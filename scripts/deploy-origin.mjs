#!/usr/bin/env node
// Deploys Origin: production Convex backup and push, the origin.imbored.fun site, and the desktop downloads.
// Prints the plan unless --execute is given. See `node scripts/deploy-origin.mjs --help`.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { quoteShellWord as quote, siteRolloutScript } from "./origin-site-rollout.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CONVEX_CLI = join(ROOT, "backend", "node_modules", "convex", "bin", "main.js");
const PRODUCTION_DEPLOYMENT = "wry-fly-446";
const PRODUCTION_DEPLOYMENT_TYPE = "dev";
const REMOTE_SITE = "/root/origin";
const REMOTE_COMPOSE = "/root/multi-ghost";
const REMOTE_DOWNLOADS = "/root/multi-ghost/origin-downloads";
const SITE_PATHS = ["site", "backend/package.json", "backend/convex", "backend/lib", "shared/origin-theme.css", "shared/origin-releases.ts", "shared/origin-site-address.ts"];

const HELP = `Usage: node scripts/deploy-origin.mjs [steps] [options]

Steps, run in this order (at least one, or --all):
  --backup       Convex export of production into --backup-dir
  --backend      Convex deploy of backend/ to production
  --site         build context from HEAD -> tarball -> ${"$"}HOST:${REMOTE_SITE} (old tree kept as ${REMOTE_SITE}.bak-<release>),
                 preserve deploy/ operator config, then docker compose up -d --no-deps --build origin in ${REMOTE_COMPOSE}
  --downloads    desktop installers and update feeds -> ${"$"}HOST:${REMOTE_DOWNLOADS}
  --all          all four

Options:
  --execute               run the steps; without it the commands are only printed
  --host <ssh host>       default: ORIGIN_DEPLOY_HOST or "hetzner"
  --backup-dir <dir>      default: ~/origin-backups
  --downloads-dir <dir>   a folder holding built desktop files (repeat for the Windows and the macOS
                          builds), default: release-origin
  --version <x.y.z>       desktop version to upload, default: package.json version
  --stage <dir>           only write the site build context to <dir> (no upload); for local checks

--backup and --backend need CONVEX_DEPLOY_KEY for ${PRODUCTION_DEPLOYMENT} in the environment. It is never printed or written.`;

function parseArgs(argv) {
  const options = { steps: new Set(), execute: false, host: process.env.ORIGIN_DEPLOY_HOST || "hetzner", backupDir: join(homedir(), "origin-backups"), downloadsDirs: [], version: JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version, stage: null };
  const value = (index, name) => { if (!argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error(`${name} needs a value`); return argv[index + 1]; };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") { console.log(HELP); process.exit(0); }
    else if (["--backup", "--backend", "--site", "--downloads"].includes(arg)) options.steps.add(arg.slice(2));
    else if (arg === "--all") ["backup", "backend", "site", "downloads"].forEach(step => options.steps.add(step));
    else if (arg === "--execute") options.execute = true;
    else if (arg === "--host") options.host = value(i++, arg);
    else if (arg === "--backup-dir") options.backupDir = resolve(value(i++, arg));
    else if (arg === "--downloads-dir") options.downloadsDirs.push(resolve(value(i++, arg)));
    else if (arg === "--version") options.version = value(i++, arg);
    else if (arg === "--stage") options.stage = resolve(value(i++, arg));
    else throw new Error(`Unknown argument ${arg}\n\n${HELP}`);
  }
  if (!/^[\w.-]+$/.test(options.host)) throw new Error(`Unexpected host ${options.host}`);
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(options.version)) throw new Error(`Unexpected version ${options.version}`);
  if (!options.downloadsDirs.length) options.downloadsDirs.push(join(ROOT, "release-origin"));
  if (!options.steps.size && !options.stage) throw new Error(`Choose at least one step.\n\n${HELP}`);
  return options;
}

/** npx and pnpm are .cmd shims on Windows, which Node only starts through a shell. */
function spawnTool(command, args, options) {
  if (process.platform !== "win32" || !["npx", "pnpm"].includes(command)) return spawnSync(command, args, options);
  return spawnSync([command, ...args].map(arg => /[\s"&|<>^]/.test(arg) ? `"${arg}"` : arg).join(" "), { ...options, shell: true });
}

function makeRunner(execute) {
  return function run(command, args, { cwd = ROOT, input } = {}) {
    console.log(`  $ ${cwd === ROOT ? "" : `(cd ${cwd}) `}${[command, ...args].map(quote).join(" ")}`);
    if (!execute) return "";
    const result = spawnTool(command, args, { cwd, input, stdio: [input === undefined ? "inherit" : "pipe", "inherit", "inherit"] });
    if (result.status !== 0) throw new Error(`${command} exited with ${result.status ?? result.signal}`);
    return "";
  };
}

function requireDeployKey(execute) {
  const key = process.env.CONVEX_DEPLOY_KEY;
  const prefix = `${PRODUCTION_DEPLOYMENT_TYPE}:${PRODUCTION_DEPLOYMENT}|`;
  if (key?.startsWith(prefix) && key.length > prefix.length) return;
  const problem = key ? `CONVEX_DEPLOY_KEY is not a ${PRODUCTION_DEPLOYMENT_TYPE} deployment key for ${PRODUCTION_DEPLOYMENT}` : "CONVEX_DEPLOY_KEY is not set";
  if (execute) throw new Error(problem);
  console.log(`  ! ${problem}; --execute would stop here`);
}

const timestamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");

function backup(run, options, ts) {
  console.log(`\n# Back up production Convex (${PRODUCTION_DEPLOYMENT})`);
  requireDeployKey(options.execute);
  if (options.execute) mkdirSync(options.backupDir, { recursive: true });
  run(process.execPath, [CONVEX_CLI, "export", "--include-file-storage", "--path", join(options.backupDir, `convex-${PRODUCTION_DEPLOYMENT}-${ts}.zip`)], { cwd: join(ROOT, "backend") });
}

function deployBackend(run, options) {
  console.log(`\n# Deploy backend/ to production Convex (${PRODUCTION_DEPLOYMENT})`);
  requireDeployKey(options.execute);
  run(process.execPath, [CONVEX_CLI, "deploy", "--typecheck", "enable"], { cwd: join(ROOT, "backend") });
}

function git(args) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.trim()}`);
  return result.stdout;
}

function stageSite(stage) {
  const dirty = git(["status", "--porcelain", "--", ...SITE_PATHS]).trim();
  if (dirty) console.log(`  ! uncommitted changes under ${SITE_PATHS.join(", ")} are not deployed (the site is built from HEAD):\n${dirty.replace(/^/gm, "    ")}`);
  mkdirSync(stage, { recursive: true });
  const archive = spawnSync("git", ["-c", "core.autocrlf=false", "archive", "--format=tar", "HEAD", "--", ...SITE_PATHS], { cwd: ROOT, maxBuffer: 1 << 30 });
  if (archive.status !== 0) throw new Error(`git archive: ${archive.stderr}`);
  const untar = spawnSync("tar", ["-x"], { cwd: stage, input: archive.stdout });
  if (untar.status !== 0) throw new Error(`tar -x: ${untar.stderr}`);
  const workspace = readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8");
  const settings = workspace.split(/\r?\n/).filter(line => !line.startsWith("#")).join("\n").replace(/^packages:\n(?:\s+-.*\n)+/m, "");
  writeFileSync(join(stage, "pnpm-workspace.yaml"), `packages:\n  - backend\n  - site\n${settings}`);
  const { packageManager } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  writeFileSync(join(stage, "package.json"), `${JSON.stringify({ name: "origin-site-build", private: true, packageManager }, null, 2)}\n`);
  writeFileSync(join(stage, "pnpm-lock.yaml"), git(["-c", "core.autocrlf=false", "show", "HEAD:pnpm-lock.yaml"]));
  const prune = spawnTool("pnpm", ["install", "--lockfile-only", "--ignore-scripts"], { cwd: stage, stdio: "inherit" });
  if (prune.status !== 0) throw new Error("pnpm install --lockfile-only failed in the staged site");
  writeFileSync(join(stage, "Dockerfile"), readFileSync(join(stage, "site", "Dockerfile"), "utf8").replace(/\r\n/g, "\n"));
  writeFileSync(join(stage, ".dockerignore"), readFileSync(join(stage, "site", ".dockerignore"), "utf8").replace(/\r\n/g, "\n"));
}

function deploySite(run, options, ts) {
  console.log(`\n# Build and ship the site to ${options.host}:${REMOTE_SITE}`);
  const work = mkdtempSync(join(tmpdir(), "origin-site-"));
  const releaseId = `${ts}-${randomUUID()}`;
  try {
    const stage = join(work, "origin");
    console.log(`  staging HEAD's ${SITE_PATHS.join(", ")} in ${stage} with a lockfile pruned to backend + site`);
    stageSite(stage);
    const tarball = `origin-site-${releaseId}.tgz`;
    const remoteTarball = `/tmp/origin-site-${releaseId}.tgz`;
    run("tar", ["-czf", tarball, "-C", "origin", "."], { cwd: work });
    run("scp", [tarball, `${options.host}:${remoteTarball}`], { cwd: work });
    const remote = siteRolloutScript({ site: REMOTE_SITE, compose: REMOTE_COMPOSE, tarball: remoteTarball, releaseId });
    run("ssh", [options.host, "sh -s"], { input: remote });
    for (const line of remote.split("\n")) console.log(`      ${line}`);
    console.log(`  rollback: ssh ${options.host} 'test ! -e ${REMOTE_SITE}.failed-${releaseId} && test ! -L ${REMOTE_SITE}.failed-${releaseId} && mv -- ${REMOTE_SITE} ${REMOTE_SITE}.failed-${releaseId} && test ! -e ${REMOTE_SITE} && test ! -L ${REMOTE_SITE} && mv -- ${REMOTE_SITE}.bak-${releaseId} ${REMOTE_SITE} && cd ${REMOTE_COMPOSE} && docker compose up -d --no-deps --build origin'`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** electron-updater acts on latest*.yml as soon as it is served, so the installers it names go up first. */
function downloadsPlan(dirs, version) {
  const files = [], feeds = [], links = [];
  const platform = (feed, installers, extras) => {
    const dir = dirs.find(candidate => existsSync(join(candidate, feed)));
    if (!dir) {
      if (installers.some(name => dirs.some(candidate => existsSync(join(candidate, name))))) throw new Error(`${installers.join(", ")} found without its ${feed}`);
      return false;
    }
    const need = name => { const path = join(dir, name); if (!existsSync(path)) throw new Error(`${path} is missing`); return path; };
    if (!readFileSync(join(dir, feed), "utf8").includes(`version: ${version}`)) throw new Error(`${join(dir, feed)} is not for ${version}`);
    for (const name of [...installers, ...extras]) {
      files.push(need(name));
      if (existsSync(join(dir, `${name}.blockmap`))) files.push(join(dir, `${name}.blockmap`));
    }
    feeds.push(join(dir, feed));
    return true;
  };
  const setup = `Origin-${version}-setup.exe`;
  if (platform("latest.yml", [setup], [])) links.push(["Origin-Setup.exe", setup]);
  const [arm, intel] = ["arm64", "x64"].map(arch => `Origin-${version}-${arch}.dmg`);
  if (platform("latest-mac.yml", [arm, intel], ["arm64", "x64"].map(arch => `Origin-${version}-${arch}.zip`))) links.push(["Origin-Mac-AppleSilicon.dmg", arm], ["Origin-Mac-Intel.dmg", intel]);
  if (!files.length) throw new Error(`No latest.yml or latest-mac.yml in ${dirs.join(", ")}`);
  return { files, feeds, links };
}

function uploadDownloads(run, options) {
  console.log(`
# Upload Origin ${options.version} downloads to ${options.host}:${REMOTE_DOWNLOADS}`);
  const { files, feeds, links } = downloadsPlan(options.downloadsDirs, options.version);
  for (const path of [...files, ...feeds]) run("scp", [basename(path), `${options.host}:${REMOTE_DOWNLOADS}/`], { cwd: dirname(path) });
  run("ssh", [options.host, `cd ${REMOTE_DOWNLOADS} && ${links.map(([link, target]) => `ln -sfn ${target} ${link}`).join(" && ")}`]);
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.stage) {
    if (existsSync(options.stage)) throw new Error(`${options.stage} already exists`);
    stageSite(options.stage);
    console.log(`Staged the site build context in ${options.stage}`);
  } else {
    const run = makeRunner(options.execute);
    const ts = timestamp();
    console.log(options.execute ? `Deploying (${ts})` : `Dry run (${ts}): nothing is executed. Add --execute to run these commands.`);
    if (options.steps.has("backup")) backup(run, options, ts);
    if (options.steps.has("backend")) deployBackend(run, options);
    if (options.steps.has("site")) deploySite(run, options, ts);
    if (options.steps.has("downloads")) uploadDownloads(run, options);
  }
} catch (error) {
  console.error(`deploy-origin: ${error.message}`);
  process.exit(1);
}
