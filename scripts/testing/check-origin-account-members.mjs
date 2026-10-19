import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const base = new URL(process.argv[2] ?? "");
assert.equal(base.hostname, "127.0.0.1");
assert.equal(base.pathname, "/__origin-pages.html");
const fixtureHtml = await (await fetch(base)).text();
assert.ok(fixtureHtml.includes("/scripts/testing/origin-pages-preview.tsx") && fixtureHtml.includes("Origin isolated project pages"), "The selected port must serve the Origin pages fixture");
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
  if (url.pathname === "/api/origin/invites") return route.fulfill({ json: { token: "synthetic-created-invite", expiresAt: Date.now() + 86400_000, inviteLink: base.origin + "/join/synthetic-created-invite", sent: false } });
  if (url.pathname === "/api/origin/app-address") return route.fulfill({ json: { origin: base.origin } });
  if (url.pathname.startsWith("/api/")) return route.fulfill({ json: {} });
  return route.continue();
});
const show = async (screen, theme, role = "owner", state = "populated") => {
  const url = new URL(base); url.search = new URLSearchParams({ screen, theme, role, state });
  await page.goto(url.href);
  await page.getByRole("button", { name: "Switch project", exact: true }).waitFor();
};
const record = async (screen, size, theme, extra = {}) => {
  await page.screenshot({ path: resolve(output, `${screen}-${phase}-${size}-${theme}.png`), animations: "disabled" });
  const bounds = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, dialogs: [...document.querySelectorAll('[role="dialog"]')].map((node) => ({ width: node.clientWidth, scrollWidth: node.scrollWidth })) }));
  cases.push({ screen, size, theme, bounds, ...extra });
  if (phase === "after") { assert.ok(bounds.document <= bounds.viewport, JSON.stringify(bounds)); for (const dialog of bounds.dialogs) assert.ok(dialog.scrollWidth <= dialog.width + 1, JSON.stringify(bounds)); }
};
try {
  for (const theme of ["dark", "light"]) for (const [size, viewport] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 375, height: 812 }]]) {
    await page.setViewportSize(viewport);
    await show("members", theme);
    await page.getByRole("heading", { name: "Members", exact: true }).waitFor();
    await record("workspace-members", size, theme);
    await page.getByRole("button", { name: "Remove Fixture teammate with a long display name", exact: true }).click();
    await record("workspace-member-remove-confirmation", size, theme);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByLabel("Email (optional)", { exact: true }).fill("synthetic-invitee@example.test");
    await page.getByRole("button", { name: "Send invite", exact: true }).click();
    await page.getByRole("textbox", { name: "Invitation link", exact: true }).waitFor();
    await record("workspace-invitation-created", size, theme);
    await show("members", theme, "viewer");
    assert.equal(await page.getByRole("button", { name: "Create link", exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: /^Remove Fixture/ }).count(), 0);
    await record("workspace-members-viewer", size, theme);
    await page.getByRole("button", { name: "Leave…", exact: true }).click();
    await page.getByRole("button", { name: "Leave workspace", exact: true }).click();
    await page.getByRole("heading", { name: "You left this workspace", exact: true }).waitFor();
    await page.getByRole("button", { name: "Switch project", exact: true }).click();
    const retainedLeave = await page.getByRole("heading", { name: "You left this workspace", exact: true }).isVisible();
    cases.push({ screen: "members-workspace-switch", size, theme, retainedLeave });
    if (phase === "after") assert.equal(retainedLeave, false);
    await show("account", theme);
    await page.getByRole("button", { name: "Open account menu", exact: true }).click();
    await record("account-menu", size, theme);
    await page.getByRole("menuitem", { name: "Account settings", exact: true }).click();
    await page.getByRole("dialog", { name: "Origin account", exact: true }).waitFor();
    await record("account-settings", size, theme);
    await page.getByRole("button", { name: "Change password", exact: true }).click();
    await page.getByRole("textbox", { name: "Display name", exact: true }).fill("Synthetic renamed user");
    await page.getByLabel("Current password", { exact: true }).fill("synthetic-current-password");
    await page.getByLabel("New password", { exact: true }).fill("synthetic-next-password");
    await record("account-password-editor", size, theme);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Change password", exact: true }).click();
    const retainedPassword = await page.getByLabel("Current password", { exact: true }).inputValue();
    const retainedNew = await page.getByLabel("New password", { exact: true }).inputValue();
    cases.push({ screen: "password-cancel", size, theme, retainedPassword: Boolean(retainedPassword), retainedNewPassword: Boolean(retainedNew) });
    if (phase === "after") { assert.equal(retainedPassword, ""); assert.equal(retainedNew, ""); }
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.evaluate(() => window.originPagesFixture.setQuery("auth:me", { _id: "fixture-other-user", email: "other-account@example.test", username: "other-account", name: "Other fixture account" }));
    const accountName = await page.getByRole("textbox", { name: "Display name", exact: true }).inputValue();
    cases.push({ screen: "account-identity-switch", size, theme, displayName: accountName });
    if (phase === "after") assert.equal(accountName, "Other fixture account");
  }
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, `account-members-${phase}-browser-checks.json`), JSON.stringify({ previewUrl: base.href, phase, checkedAt: new Date().toISOString(), cases, pageErrors: errors }, null, 2) + "\n");
  console.log(JSON.stringify({ cases: cases.length, regressions: cases.filter((item) => ["members-workspace-switch", "password-cancel", "account-identity-switch"].includes(item.screen)) }, null, 2));
} finally { await browser.close(); }
