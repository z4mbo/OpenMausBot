import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const base = new URL(process.argv[2] ?? "");
assert.equal(base.hostname, "127.0.0.1");
assert.equal(base.pathname, "/__origin-query-errors.html");
const backend = new URL(base.searchParams.get("backend") ?? "");
assert.equal(backend.hostname, "127.0.0.1");
assert.equal(backend.protocol, "http:");
const html = await (await fetch(base)).text();
assert.ok(html.includes("/scripts/testing/origin-query-errors-preview.tsx") && html.includes("Origin isolated query error verification"));
const output = resolve("docs/verification/evidence/origin-pages/query-errors");
await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.OMB_VERIFY_PLAYWRIGHT || "playwright");
const browser = await chromium.launch();
const page = await browser.newPage();
page.setDefaultTimeout(15_000);
const errors = [];
const consoleErrors = [];
const cases = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
await page.route("**/*", (route) => {
  const target = new URL(route.request().url());
  if (!["127.0.0.1", "localhost"].includes(target.hostname) && target.protocol !== "data:") return route.abort();
  return route.continue();
});
const setMode = async (mode, publish = true) => assert.equal((await fetch(new URL("/mode", backend), { method: "POST", body: JSON.stringify({ mode, publish }) })).ok, true);
const show = async (screen, theme, legacy = false) => {
  const url = new URL(base); url.searchParams.set("screen", screen); url.searchParams.set("theme", theme); if (legacy) url.searchParams.set("legacy", "1");
  await page.goto(url.href);
  await page.getByRole("button", { name: "Outside component 0", exact: true }).waitFor();
};
const capture = async (screen, state, phase, size, theme) => {
  await page.screenshot({ path: resolve(output, `${screen}-${state}-${phase}-${size}-${theme}.png`), animations: "disabled" });
  const bounds = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
  assert.ok(bounds.document <= bounds.viewport, JSON.stringify(bounds));
  cases.push({ screen, state, phase, size, theme, bounds });
};
try {
  for (const theme of ["dark", "light"]) for (const [size, viewport] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 375, height: 812 }]]) for (const screen of ["assets", "pages"]) {
    await page.setViewportSize(viewport);
    await setMode("failure");
    await show(screen, theme, true);
    await page.waitForTimeout(250);
    assert.equal(await page.getByRole("button", { name: "Try again", exact: true }).count(), 0);
    await capture(screen, "rejected-query", "legacy", size, theme);
    await show(screen, theme);
    await page.getByRole("heading", { name: `Could not load ${screen}`, exact: true }).waitFor();
    await capture(screen, "rejected-query", "after", size, theme);
    await page.getByRole("button", { name: "Outside component 0", exact: true }).click();
    await page.getByRole("button", { name: "Outside component 1", exact: true }).waitFor();
    assert.equal((await page.locator("body").innerText()).includes("SYNTHETIC_PRIVATE_MARKER"), false);
    await setMode("ready");
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await page.getByText(screen === "assets" ? "Recovered synthetic asset" : "Recovered synthetic page", { exact: true }).waitFor();
    await capture(screen, "recovered", "after", size, theme);
  }
  for (const theme of ["dark", "light"]) for (const [size, viewport] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 375, height: 812 }]]) {
    await page.setViewportSize(viewport);
    await setMode("ready");
    await show("assets", theme);
    await page.getByRole("button", { name: "Edit Recovered synthetic asset", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Edit asset", exact: true });
    await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Unsaved synthetic asset draft");
    await setMode("refresh-failure");
    await dialog.getByText(/Could not refresh assets/).waitFor();
    assert.equal(await dialog.getByRole("textbox", { name: "Name", exact: true }).inputValue(), "Unsaved synthetic asset draft");
    await capture("asset-editor", "loaded-refresh-failure", "after", size, theme);
    await setMode("ready", false);
    await dialog.getByRole("button", { name: "Try again", exact: true }).click();
    await dialog.getByText(/Could not refresh assets/).waitFor({ state: "detached" });
    assert.equal(await dialog.getByRole("textbox", { name: "Name", exact: true }).inputValue(), "Unsaved synthetic asset draft");
    await capture("asset-editor", "loaded-refresh-recovered", "after", size, theme);
    await setMode("revoked");
    await page.getByRole("heading", { name: "Could not load assets", exact: true }).waitFor();
    await dialog.waitFor({ state: "detached" });
    assert.equal(await page.getByText("Recovered synthetic asset", { exact: true }).count(), 0);
    await capture("assets", "access-revoked", "after", size, theme);
  }
  await page.setViewportSize({ width: 375, height: 812 });
  for (const screen of ["assets", "pages"]) {
    await setMode("pending");
    await show(screen, "dark");
    await page.getByRole("status").last().waitFor();
    await page.getByRole("heading", { name: `Could not load ${screen}`, exact: true }).waitFor({ timeout: 15_000 });
    await capture(screen, "unresolved-query", "after", "mobile", "dark");
    await setMode("ready");
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await page.getByText(screen === "assets" ? "Recovered synthetic asset" : "Recovered synthetic page", { exact: true }).waitFor();
  }
  await setMode("offline");
  await show("assets", "light");
  await page.getByRole("heading", { name: "Could not load assets", exact: true }).waitFor({ timeout: 15_000 });
  await capture("assets", "offline-transport", "after", "mobile", "light");
  await setMode("ready");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await page.getByText("Recovered synthetic asset", { exact: true }).waitFor({ timeout: 30_000 });
  assert.deepEqual(errors, []);
  assert.equal(consoleErrors.some((error) => /SYNTHETIC_PRIVATE_MARKER|synthetic-private-session/.test(error)), false);
  const state = await (await fetch(new URL("/state", backend))).json();
  assert.ok(state.events.some((event) => event.query === "design:list" && event.outcome === "QueryFailed"));
  assert.ok(state.events.some((event) => event.query === "fixture:pages" && event.outcome === "QueryFailed"));
  await writeFile(resolve(output, "browser-checks.json"), JSON.stringify({ previewUrl: base.href, boundary: "Real ConvexReactClient/hooks and production Assets page against a loopback synthetic Convex WebSocket protocol; legacy cases exercise unchanged raw-hook behavior outside the opt-in scope.", checkedAt: new Date().toISOString(), cases, pageErrors: errors, consoleErrorsSanitized: true, protocolEvents: state.events }, null, 2) + "\n");
  console.log(JSON.stringify({ cases: cases.length, pageErrors: errors, consoleErrorsSanitized: true, protocolEvents: state.events.length }, null, 2));
} finally { await browser.close(); }
