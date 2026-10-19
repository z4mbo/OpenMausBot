import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const base = new URL(process.argv[2] ?? "");
assert.equal(base.hostname, "127.0.0.1");
assert.equal(base.pathname, "/__origin-pages.html");
const html = await (await fetch(base)).text();
assert.ok(html.includes("/scripts/testing/origin-pages-preview.tsx") && html.includes("Origin isolated project pages"));
const phase = process.argv[3] ?? "after";
assert.ok(["before", "after"].includes(phase));
const output = resolve("docs/verification/evidence/origin-pages");
await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.OMB_VERIFY_PLAYWRIGHT || "playwright");
const browser = await chromium.launch();
const page = await browser.newPage();
page.setDefaultTimeout(10_000);
const errors = [];
const cases = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.route("**/*", (route) => {
  const url = new URL(route.request().url());
  if (!["127.0.0.1", "localhost"].includes(url.hostname) && url.protocol !== "data:") return route.abort();
  if (url.pathname === "/api/origin/app-address") return route.fulfill({ json: { origin: base.origin } });
  if (url.pathname.startsWith("/api/")) return route.fulfill({ json: {} });
  return route.continue();
});
const show = async (screen, theme) => { const url = new URL(base); url.search = new URLSearchParams({ screen, theme }); await page.goto(url.href); await page.getByRole("button", { name: "Switch project", exact: true }).waitFor(); };
try {
  for (const theme of ["dark", "light"]) for (const [size, viewport] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 375, height: 812 }]]) for (const editor of ["asset", "token", "vault", "portal", "convert"]) {
    await page.setViewportSize(viewport);
    await show(editor === "asset" || editor === "token" ? "assets" : editor === "vault" ? "vault" : "feedback", theme);
    let label, field, save;
    if (editor === "asset") { await page.getByRole("button", { name: "Edit Release workflow documentation with a long filename", exact: true }).click(); label = "Edit asset"; field = "Name"; save = "Save asset"; }
    if (editor === "token") { await page.getByRole("button", { name: "Tokens", exact: true }).click(); await page.getByRole("button", { name: "Edit Project accent", exact: true }).click(); label = "Edit token"; field = "Name"; save = "Save token"; }
    if (editor === "vault") { await page.getByLabel("Vault passphrase", { exact: true }).fill("fixture-passphrase"); await page.getByRole("button", { name: "Unlock vault", exact: true }).click(); await page.getByRole("button", { name: "New item", exact: true }).click(); label = "New vault item"; field = "Name"; save = "Save encrypted item"; }
    if (editor === "portal") { await page.getByRole("button", { name: "Portal settings", exact: true }).click(); label = "Feedback settings"; field = "Public title"; save = "Save settings"; }
    if (editor === "convert") { await page.getByRole("button", { name: "Convert to issue", exact: true }).click(); label = "Convert feedback to issue"; field = "Due date"; save = "Create issue"; }
    const dialog = page.getByRole("dialog", { name: label, exact: true });
    const value = editor === "convert" ? "2026-11-03" : `Unsaved ${editor} draft`;
    await dialog.getByLabel(field, { exact: true }).fill(value);
    if (editor === "vault") await dialog.getByLabel("Secret", { exact: true }).fill("synthetic-draft-secret");
    if (editor === "convert") await dialog.getByLabel(/^Assigned to/).selectOption("user@example.test");
    await page.evaluate((role) => window.originPagesFixture.setRole(role), editor === "portal" ? "member" : "viewer");
    assert.equal(await dialog.getByLabel(field, { exact: true }).inputValue(), value);
    const saveDisabled = await dialog.getByRole("button", { name: save, exact: true }).isDisabled();
    const before = await page.evaluate(() => window.originPagesFixture.calls.length);
    await page.screenshot({ path: resolve(output, `${editor}-role-downgrade-${phase}-${size}-${theme}.png`), animations: "disabled" });
    await dialog.locator("form").evaluate((form) => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await page.waitForTimeout(250);
    const writes = await page.evaluate((start) => window.originPagesFixture.calls.slice(start).map((call) => call.name), before);
    cases.push({ editor, size, theme, saveDisabled, mutationsAfterDowngrade: writes, draftPreserved: true });
    if (phase === "after") {
      assert.equal(saveDisabled, true, editor);
      assert.deepEqual(writes, [], editor);
      await dialog.getByText(/draft is kept/i).waitFor();
      await page.evaluate(() => window.originPagesFixture.setRole("owner"));
      assert.equal(await dialog.getByLabel(field, { exact: true }).inputValue(), value);
      assert.equal(await dialog.getByRole("button", { name: save, exact: true }).isEnabled(), true);
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, `editor-roles-${phase}-browser-checks.json`), JSON.stringify({ previewUrl: base.href, phase, checkedAt: new Date().toISOString(), boundary: "Production editors, synthetic reactive role changes and mutation receipts; backend enforcement is tested separately.", cases, pageErrors: errors }, null, 2) + "\n");
  console.log(JSON.stringify({ cases: cases.length, unsafeCases: cases.filter((row) => !row.saveDisabled || row.mutationsAfterDowngrade.length), pageErrors: errors }, null, 2));
} finally { await browser.close(); }
