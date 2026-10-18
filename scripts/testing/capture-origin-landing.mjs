import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [address, output, source] = process.argv.slice(2);
const base = new URL(address);
assert.equal(base.protocol, "http:"); assert.equal(base.hostname, "127.0.0.1");
assert.ok(!["3210", "5199", "8799"].includes(base.port)); assert.equal(base.pathname, "/__origin-landing.html");
assert.match(source ?? "", /^[a-f0-9]{40}$/); assert.ok(output);
const root = fileURLToPath(new URL("../../", import.meta.url));
const git = args => execFileSync("git", args, { cwd: root, maxBuffer: 4 * 1024 * 1024 });
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const version = JSON.parse(git(["show", `${source}:package.json`])).version;
const metadata = await fetch(new URL("/__origin-landing-fixture.json", base)).then(response => response.json());
assert.equal(metadata.synthetic, true); assert.equal(metadata.source, source); assert.equal(metadata.version, version);
assert.equal(metadata.noCloudBackend, true); assert.equal(metadata.packagedApp, false);
const snapshot = resolve(process.env.ORIGIN_LANDING_SNAPSHOT || root);
const modules = await Promise.all(metadata.sourceFiles.map(async file => {
  const bytes = git(["show", `${source}:${file.path}`]);
  const observed = await readFile(resolve(snapshot, file.path));
  assert.equal(file.sha256, hash(observed), file.path);
  const normalized = observed.toString("utf8").replaceAll("\r\n", "\n");
  assert.equal(normalized, bytes.toString("utf8").replaceAll("\r\n", "\n"), file.path);
  return { ...file, lfSha256: hash(normalized), gitBlob: git(["rev-parse", `${source}:${file.path}`]).toString().trim() };
}));
const { chromium } = await import(process.env.OMB_VERIFY_PLAYWRIGHT || "playwright");
const { default: sharp } = await import(process.env.OMB_VERIFY_SHARP || "sharp");
const destination = resolve(output);
await mkdir(destination, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2, locale: "en-US", colorScheme: "dark", reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors = [], externalRequests = [], webSockets = [];
  page.on("pageerror", error => errors.push(error.message));
  await context.route("**/*", route => {
    const target = new URL(route.request().url());
    if (target.origin === base.origin || ["data:", "blob:"].includes(target.protocol)) return route.continue();
    externalRequests.push(target.origin); return route.abort();
  });
  await context.routeWebSocket("**/*", route => { const target = new URL(route.url()); webSockets.push({ origin: target.origin, blocked: true, previewOnly: target.hostname === "127.0.0.1" && [base.port, "0"].includes(target.port) }); route.close(); });
  await page.goto(base.href, { waitUntil: "domcontentloaded", timeout: 90_000 });
  assert.equal(await page.title(), "Origin isolated landing capture");
  await page.locator('[data-chief-section="issues"][aria-current="page"]').waitFor();
  await page.locator("[data-task-id]").first().waitFor();
  await page.getByText(`v${version}`, { exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  const observations = await page.evaluate(version => {
    const box = element => { const rect = element.getBoundingClientRect(); return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }; };
    const sidebar = document.querySelector("[data-sidebar]");
    const header = sidebar.querySelector("[data-sidebar-top-row]");
    const account = box(sidebar.querySelector('[aria-label="Open account menu"]'));
    const search = box(header.querySelector('[aria-label="Search bots and messages"]'));
    const computer = box(sidebar.querySelector('[data-tour="server-switcher"]'));
    const columns = [...document.querySelectorAll("[data-column-id]")].map(column => ({ title: column.querySelector("strong").textContent, draft: column.dataset.draft === "true", ...box(column) }));
    return { viewport: { width: innerWidth, height: innerHeight }, scrollWidth: document.documentElement.scrollWidth, accountBeforeSearch: account.right <= search.left, computerBelowAccount: computer.top >= account.bottom, computerFullWidth: computer.width >= sidebar.clientWidth - 24, computerName: sidebar.querySelector('[data-tour="server-switcher"]').textContent, visibleFooterVersion: sidebar.innerText.includes(`v${version}`), columns, activeTaskCards: document.querySelectorAll("[data-task-id]").length, reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches };
  }, version);
  assert.ok(observations.accountBeforeSearch && observations.computerBelowAccount && observations.computerFullWidth && observations.visibleFooterVersion && observations.reducedMotion);
  assert.equal(observations.scrollWidth, observations.viewport.width); assert.equal(observations.computerName.trim(), "This computer");
  assert.deepEqual(observations.columns.map(column => column.title), ["Draft", "Todo", "In Progress"]);
  assert.equal(observations.columns[0].draft, true); assert.equal(observations.activeTaskCards, 6);
  assert.ok(observations.columns.every(column => column.left >= 0 && column.right <= observations.viewport.width));
  assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []); assert.ok(webSockets.every(socket => socket.previewOnly));
  const raw = await page.screenshot();
  await writeFile(resolve(destination, "issues-after.png"), raw);
  const files = [{ path: "issues-after.png", bytes: raw.length, sha256: hash(raw), width: 3200, height: 2000 }];
  for (const [name, width] of [["issues.webp", 1600], ["issues-960.webp", 960], ["issues-crop.webp", 760]]) {
    const bytes = await sharp(raw).resize({ width }).webp({ quality: 82 }).toBuffer();
    await writeFile(resolve(destination, name), bytes);
    files.push({ path: name, bytes: bytes.length, sha256: hash(bytes), width, height: width * 1000 / 1600 });
  }
  const recipes = await Promise.all(["scripts/verify-origin-landing.ts", "scripts/testing/landing-cloud.ts", "scripts/testing/landing-preview.tsx", "scripts/testing/capture-origin-landing.mjs"].map(async path => ({ path, sha256: hash(await readFile(resolve(root, path))) })));
  await writeFile(resolve(destination, "report.json"), JSON.stringify({ source, version, observedAt: new Date().toISOString(), actualAppComponent: true, syntheticCloudAndDesktopBridge: true, liveBackend: false, packagedApp: false, viewport: { width: 1600, height: 1000, deviceScaleFactor: 2 }, observations, pageErrors: errors, externalRequests, webSockets, modules, recipes, files, transformation: "The raw browser PNG is only resized and encoded as WebP. All three derivatives retain the complete frame; the legacy crop filename is retained without cropping.", limits: ["This is the actual App renderer with synthetic cloud queries, a simulated Windows bridge, and an isolated fake-engine HTTP server.", "No real account, cloud backend, native Electron window, installer or production data was used.", "Cloud mutations throw; no backend authorization or actual task execution is claimed."] }, null, 2) + "\n");
  console.log(JSON.stringify({ source, version, screenshots: 1, derivatives: 3, pageErrors: errors.length, externalRequests: externalRequests.length, observations }));
} finally { await browser.close(); }
