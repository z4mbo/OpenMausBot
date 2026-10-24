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
const requests = [];
const evidence = { previewUrl: base.href, phase, checkedAt: new Date().toISOString(), boundary: "Production renderer, synthetic cloud hook/HTTP data, disposable fake-engine server; no live account or Convex integration.", cases: [] };
page.on("pageerror", (error) => errors.push(error.message));
await page.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (!["127.0.0.1", "localhost"].includes(url.hostname) && url.protocol !== "data:") return route.abort();
  if (!url.pathname.startsWith("/api/")) return route.continue();
  requests.push({ path: url.pathname, method: route.request().method() });
  const mode = new URL(page.url()).searchParams.get("state");
  if (mode === "error" && url.pathname.startsWith("/api/github/")) return route.fulfill({ status: 503, json: { error: "Synthetic GitHub outage. Try again." } });
  if (mode === "loading" && url.pathname.startsWith("/api/github/")) return;
  if (mode === "loading") return route.fulfill({ json: { messages: [], conversations: [], hasMore: false } });
  if (url.pathname === "/api/github/repo") return route.fulfill({ json: { repo: "fixture/origin", tokenConfigured: true, issues: [], pullRequests: mode === "empty" ? [] : [{ number: 14, title: "Synthetic workflow improvement", url: "https://github.com/fixture/origin/pull/14", author: "fixture-bot", state: "open", closes: [12], checks: "success", review: "review_required", branch: "fixture/workflow", updatedAt: Date.now() }], commits: mode === "empty" ? [] : [{ sha: "a".repeat(40), url: "https://github.com/fixture/origin/commit/" + "a".repeat(40), message: "Inspect synthetic workflow", author: "Fixture author", committedAt: Date.now() }], commitsError: "" } });
  if (url.pathname === "/api/github/workspace") return route.fulfill({ json: { configured: true, canSetup: true, login: "fixture-org", prPermissionNotice: null, permissionApprovalUrl: "https://github.com/fixture", installationUrl: null } });
  if (url.pathname === "/api/github/connection") return route.fulfill({ json: { connection: { login: "fixture-org", source: "workspace" } } });
  if (url.pathname === "/api/local-chat/conversations") return route.fulfill({ json: route.request().method() === "POST" ? { conversationId: "dm:fixture-other:fixture-user" } : { conversations: mode === "empty" ? [] : [{ id: "dm:fixture-other:fixture-user", otherUserId: "fixture-other", unread: 1, lastMessage: { id: "fixture-message", body: "Please inspect the workflow" } }] } });
  if (url.pathname === "/api/local-chat/messages") return route.fulfill({ json: { messages: mode === "empty" ? [] : [{ _id: "fixture-message", id: "fixture-message", authorId: "fixture-other", authorName: "Fixture teammate", authorEmail: "other@example.test", body: "Please inspect the synthetic workflow.", createdAt: Date.now(), attachments: [] }], hasMore: false } });
  if (url.pathname === "/api/origin/app-address") return route.fulfill({ json: { origin: base.origin } });
  if (url.pathname === "/api/github/mirror") return route.fulfill({ json: { results: [] } });
  return route.fulfill({ json: {} });
});
const show = async (screen, theme, state = "populated", role = "owner") => {
  const url = new URL(base);
  url.search = new URLSearchParams({ screen, theme, state, role });
  await page.goto(url.href);
  await page.getByRole("button", { name: "Switch project", exact: true }).waitFor();
  await page.waitForTimeout(350);
};
const capture = (name) => page.screenshot({ path: resolve(output, `${name}.png`), animations: "disabled" });
const geometry = () => page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, pageScrollers: [...document.querySelectorAll('section[aria-label="Project settings"], section[aria-label="Feedback"], section[aria-label="Vault"], section[aria-label="Assets"], section[aria-label="Repo"]')].filter((node) => node.scrollWidth > node.clientWidth + 1).map((node) => ({ label: node.getAttribute("aria-label"), width: node.clientWidth, scrollWidth: node.scrollWidth })), overflow: [...document.querySelectorAll("main *")].filter((node) => { const box = node.getBoundingClientRect(); const style = getComputedStyle(node); return box.right > innerWidth + 1 && !node.closest("[data-column-id]") && style.position !== "absolute" && style.position !== "fixed"; }).slice(0, 8).map((node) => ({ tag: node.tagName, label: (node.getAttribute("aria-label") ?? node.textContent)?.slice(0, 70), right: node.getBoundingClientRect().right })) }));
const record = async (screen, size, theme, state, role = "owner", extra = {}) => {
  await capture(`${screen}-${state}-${role}-${phase}-${size}-${theme}`);
  const bounds = await geometry();
  evidence.cases.push({ screen, size, theme, state, role, bounds, ...extra });
  if (phase === "after") assert.ok(bounds.document <= bounds.viewport, JSON.stringify({ screen, bounds }));
  if (phase === "after") assert.deepEqual(bounds.pageScrollers, [], JSON.stringify({ screen, bounds }));
};
try {
  for (const theme of ["dark", "light"]) for (const [size, viewport] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 375, height: 812 }]]) {
    await page.setViewportSize(viewport);
    for (const screen of ["issues", "assets", "vault", "feedback", "repo", "settings", "inbox", "chat"]) {
      await show(screen, theme);
      await record(screen, size, theme, "populated");
      if (screen === "assets") {
        await page.getByRole("button", { name: "Tokens", exact: true }).click();
        await record("tokens", size, theme, "populated");
        await page.getByRole("button", { name: "Add token", exact: true }).click();
        await record("token-editor", size, theme, "populated");
        await page.keyboard.press("Escape");
      }
      if (screen === "issues") {
        await page.getByRole("button", { name: "New issue", exact: true }).click();
        await page.getByRole("dialog", { name: "New issue", exact: true }).waitFor();
        await record("new-issue", size, theme, "populated");
        await page.keyboard.press("Escape");
        await page.getByRole("dialog", { name: "New issue", exact: true }).waitFor({ state: "detached" });
        await page.getByRole("button", { name: "List view", exact: true }).click();
        await page.getByRole("button").filter({ hasText: "Inspect the synthetic release workflow" }).first().click();
        await page.getByRole("dialog").last().waitFor();
        await record("issue-detail", size, theme, "populated");
        if (phase === "after") {
          await page.getByRole("textbox", { name: "Issue title", exact: true }).fill("My locally reviewed title");
          await page.evaluate(() => { const fixture = window.originPagesFixture; const details = fixture.getQuery("tasks:details"); fixture.setQuery("tasks:details", { ...details, task: { ...details.task, description: "A teammate updated this description while I edited the title." } }); });
          assert.equal(await page.getByRole("textbox", { name: "Issue description", exact: true }).inputValue(), "A teammate updated this description while I edited the title.");
          await record("issue-collaboration", size, theme, "populated");
          await page.getByRole("button", { name: "Save changes", exact: true }).click();
          const update = await page.evaluate(() => window.originPagesFixture.calls.findLast((call) => call.name === "tasks:updateTask"));
          assert.equal(update.args.title, "My locally reviewed title");
          assert.equal(Object.hasOwn(update.args, "description"), false);
          evidence.cases.push({ screen: "issue-collaboration-save", size, theme, mutation: update });
          await page.getByRole("button", { name: "Discard", exact: true }).click();
          const mirrorsBefore = requests.filter((request) => request.path === "/api/github/mirror").length;
          await page.getByRole("button", { name: "Mark complete", exact: true }).click();
          await page.waitForFunction(() => window.originPagesFixture.calls.some((call) => call.name === "tasks:updateTask" && call.args.done === true));
          assert.equal(await page.getByRole("dialog", { name: /^Complete ORI-/ }).count(), 0, "Completing must not route through a pull request dialog");
          assert.equal(await page.getByRole("button", { name: "Create GitHub issue" }).count(), 0, "GitHub issues are created automatically");
          await page.waitForTimeout(100);
          assert.ok(requests.filter((request) => request.path === "/api/github/mirror").length > mirrorsBefore, "Completing syncs the linked GitHub issue");
          await record("complete-issue", size, theme, "populated");
        }
        await page.keyboard.press("Escape");
        await page.getByRole("dialog").waitFor({ state: "detached" });
        if (phase === "after") {
          const row = page.getByRole("listitem").filter({ hasText: "Inspect the synthetic release workflow" }).first();
          const box = await row.boundingBox();
          await row.click({ button: "right", position: { x: box.width - 12, y: box.height / 2 } });
          const menu = page.getByRole("menu", { name: "Actions for Inspect the synthetic release workflow" });
          await menu.waitFor();
          assert.deepEqual(await menu.getByRole("menuitem").allTextContents(), ["Complete", "Move to Draft", "Delete"]);
          const sheet = await menu.boundingBox();
          const viewportSize = page.viewportSize();
          assert.ok(sheet.x >= 0 && sheet.y >= 0 && sheet.x + sheet.width <= viewportSize.width && sheet.y + sheet.height <= viewportSize.height, JSON.stringify({ sheet, viewportSize }));
          await record("issue-context-menu", size, theme, "populated", "owner", { sheet });
          await page.keyboard.press("Escape");
          await menu.waitFor({ state: "detached" });
          const draft = page.getByRole("listitem").filter({ hasText: "A private draft that must remain off GitHub" }).first();
          await draft.click({ button: "right" });
          const draftMenu = page.getByRole("menu", { name: "Actions for A private draft that must remain off GitHub" });
          assert.deepEqual(await draftMenu.getByRole("menuitem").allTextContents(), ["Complete", "Delete"]);
          await page.mouse.click(2, 2);
          await draftMenu.waitFor({ state: "detached" });
          await row.click({ button: "right" });
          await menu.getByRole("menuitem", { name: "Move to Draft" }).click();
          await page.waitForFunction(() => window.originPagesFixture.calls.some((call) => call.name === "tasks:moveTask" && call.args.columnId === "fixture-draft"));
        }
      }
      if (screen === "vault") {
        await page.getByLabel("Vault passphrase", { exact: true }).fill("fixture-passphrase");
        await page.getByRole("button", { name: "Unlock vault", exact: true }).click();
        await page.getByRole("button", { name: "New item", exact: true }).waitFor();
        await page.getByRole("button", { name: "Reveal Synthetic API credential", exact: true }).click();
        await page.getByText("synthetic-secret-value", { exact: true }).waitFor();
        await record("vault-unlocked", size, theme, "populated");
        await page.getByRole("button", { name: "Switch project", exact: true }).click();
        const stillUnlocked = await page.getByRole("button", { name: "New item", exact: true }).isVisible();
        evidence.cases.push({ screen: "vault-project-switch", size, theme, leakedUnlock: stillUnlocked });
        if (phase === "after") assert.equal(stillUnlocked, false, "Other project must require its own unlock");
      }
      if (screen === "inbox") {
        await page.getByRole("button", { name: "Calendar", exact: true }).click();
        await record("inbox-calendar", size, theme, "populated");
      }
      if (screen === "chat" && size === "mobile") {
        await page.getByRole("button", { name: "Workspace", exact: true }).click();
        await record("workspace-conversation", size, theme, "populated");
        await page.getByRole("button", { name: "All conversations", exact: true }).click();
      }
    }
  }
  await page.setViewportSize({ width: 375, height: 812 });
  for (const state of ["empty", "loading", "denied"]) for (const screen of ["issues", "assets", "vault", "feedback", "repo", "settings", "inbox", "chat"]) {
    await show(screen, "light", state);
    await record(screen, "mobile", "light", state);
  }
  for (const screen of ["issues", "assets", "vault", "feedback", "repo", "settings", "inbox", "chat"]) {
    await show(screen, "dark", "populated", "viewer");
    await record(screen, "mobile", "dark", "populated", "viewer");
    const forbidden = await page.getByRole("button", { name: /^(New issue|Add asset|New item|Portal settings|Merge|Save access|Save project)$/ }).count();
    assert.equal(forbidden, 0, `Viewer mutation controls: ${screen}`);
  }
  await show("repo", "dark", "error");
  await page.getByText("Synthetic GitHub outage. Try again.", { exact: true }).waitFor();
  await record("repo", "mobile", "dark", "error");
  if (phase === "after") {
    await show("assets", "dark", "error");
    await page.getByRole("button", { name: "Add asset", exact: true }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Synthetic linked asset");
    await page.getByRole("textbox", { name: "Link", exact: true }).fill("https://example.test/synthetic");
    await page.getByRole("button", { name: "Save asset", exact: true }).click();
    await page.getByText("Synthetic mutation failure. Try again.", { exact: true }).waitFor();
    assert.equal(await page.getByRole("textbox", { name: "Name", exact: true }).inputValue(), "Synthetic linked asset");
    await record("asset-editor", "mobile", "dark", "error");
    await show("feedback", "light", "error");
    await page.getByRole("button", { name: "Portal settings", exact: true }).click();
    await page.getByRole("textbox", { name: "Public title", exact: true }).fill("Synthetic public form");
    await page.getByRole("button", { name: "Save settings", exact: true }).click();
    await page.getByText("Synthetic mutation failure. Try again.", { exact: true }).waitFor();
    await record("feedback-editor", "mobile", "light", "error");
    await show("settings", "dark", "error");
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Synthetic project rename");
    await page.getByRole("button", { name: "Save project", exact: true }).click();
    await page.getByText("Synthetic mutation failure. Try again.", { exact: true }).waitFor();
    await record("settings-save", "mobile", "dark", "error");
    await show("vault", "light");
    await page.getByLabel("Vault passphrase", { exact: true }).fill("wrong-fixture-passphrase");
    await page.getByRole("button", { name: "Unlock vault", exact: true }).click();
    await page.getByText("Could not unlock. Check your vault passphrase.", { exact: true }).waitFor();
    await record("vault-unlock", "mobile", "light", "error");
    await page.getByLabel("Vault passphrase", { exact: true }).fill("fixture-passphrase");
    await page.getByRole("button", { name: "Unlock vault", exact: true }).click();
    await page.getByRole("button", { name: "New item", exact: true }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Second synthetic secret");
    await page.getByLabel("Secret", { exact: true }).fill("second-synthetic-secret");
    await page.getByRole("button", { name: "Save encrypted item", exact: true }).click();
    await page.getByText("Second synthetic secret", { exact: true }).waitFor();
    const vaultWrite = await page.evaluate(() => window.originPagesFixture.calls.findLast((call) => call.name === "credentials:create"));
    assert.ok(vaultWrite.args.ciphertext && vaultWrite.args.iv && vaultWrite.args.salt);
    assert.equal(JSON.stringify(vaultWrite).includes("second-synthetic-secret"), false);
    evidence.cases.push({ screen: "vault-encrypted-write", ciphertextPresent: true, plaintextAbsent: true });
    await record("vault-created", "mobile", "light", "populated");
    await page.getByRole("button", { name: "Lock", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "Reveal Second synthetic secret", exact: true }).count(), 0);
  }
  evidence.pageErrors = errors;
  evidence.requests = requests;
  await writeFile(resolve(output, `pages-${phase}-browser-checks.json`), JSON.stringify(evidence, null, 2) + "\n");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ cases: evidence.cases.length, errors, overflows: evidence.cases.filter((entry) => entry.bounds?.document > entry.bounds?.viewport), switches: evidence.cases.filter((entry) => entry.screen === "vault-project-switch") }, null, 2));
} catch (error) {
  evidence.pageErrors = errors;
  await writeFile(resolve(output, `pages-${phase}-browser-checks.json`), JSON.stringify(evidence, null, 2) + "\n");
  throw error;
} finally { await browser.close(); }
