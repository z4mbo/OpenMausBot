import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const base = new URL(process.argv[2] ?? "");
const server = new URL(process.argv[3] ?? "");
const headId = process.argv[4] ?? "";
const scoutId = process.argv[5] ?? "";
assert.equal(base.hostname, "127.0.0.1");
assert.equal(base.pathname, "/__origin-workspace.html");
assert.equal(server.hostname, "127.0.0.1");
const out = resolve("docs/verification/evidence/round7");
const shots = resolve(tmpdir(), "origin-workspace");
await mkdir(out, { recursive: true });
await mkdir(shots, { recursive: true });
const { chromium } = await import(process.env.OMB_VERIFY_PLAYWRIGHT ? pathToFileURL(process.env.OMB_VERIFY_PLAYWRIGHT).href : "playwright");
const browser = await chromium.launch();
const report = { previewUrl: base.href, screenshots: shots, checkedAt: new Date().toISOString(), cases: [], failures: [], pageErrors: [], context: {} };
const best = { inbox: "workspace-inbox", routines: "workspace-routines", chat: "workspace-chat", "team-map": "workspace-team-map", settings: "workspace-settings", "new-agent": "workspace-new-agent" };
const api = (path, init) => fetch(new URL(path, server), { ...init, headers: { "content-type": "application/json", origin: server.origin } }).then((response) => response.json());

const drawerButton = (page) => page.getByRole("button", { name: "Open bot list", exact: true });
async function sidebar(page) {
  const drawer = drawerButton(page);
  if (await drawer.isVisible() && await drawer.getAttribute("aria-expanded") !== "true") {
    await drawer.click();
    await page.waitForTimeout(250);
  }
}
async function closeDrawer(page) {
  if (await drawerButton(page).getAttribute("aria-expanded").catch(() => null) === "true") await page.mouse.click(360, 420);
}
const nav = (name) => async (page) => {
  await sidebar(page);
  await page.getByRole("button", { name, exact: true }).first().click();
};

const flows = {
  async inbox(page, shoot) {
    await nav("Inbox")(page);
    assert.notEqual(await drawerButton(page).getAttribute("aria-expanded").catch(() => null), "true", "the phone drawer closes when a workspace page opens");
    await page.getByText("Book a walk for today").waitFor({ timeout: 10_000 });
    await page.getByRole("button", { name: "All issues", exact: true }).click();
    await page.getByText("Weekend menu photos").waitFor();
    await shoot();
  },
  async chat(page, shoot, run) {
    await nav("Chat")(page);
    const composer = page.getByPlaceholder("Message the workspace");
    await page.waitForTimeout(400);
    if (!await composer.isVisible()) await page.getByRole("complementary", { name: "Conversations" }).getByRole("button", { name: "Workspace", exact: true }).click();
    const text = { "dark 1280": "Bakery photos land Friday.", "dark 375": "The walk map fix is on staging.", "light 1280": "Launch review moved to 9:30.", "light 375": "Pilot walkers are confirmed." }[run];
    await composer.fill(text);
    await composer.press("Enter");
    await page.getByText(text).waitFor({ timeout: 10_000 });
    await shoot();
  },
  async call(page, shoot) {
    await nav("Call")(page);
    await page.getByRole("button", { name: /Start call/ }).waitFor();
    await shoot();
  },
  async routines(page, shoot) {
    await nav("Routines")(page);
    await page.getByRole("button", { name: "List", exact: true }).click();
    await page.getByText("Morning stand-up").first().waitFor();
    await page.getByText("Launch review").first().waitFor();
    const call = { name: `Pricing review ${Date.now()}`, botIds: [headId], schedule: { type: "once", at: Date.now() + 86_400_000 }, durationMinutes: 15 };
    const created = await api("/api/calendar-calls", { method: "POST", body: JSON.stringify(call) });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.getByText(call.name).waitFor({ timeout: 5_000 });
    await api(`/api/calendar-calls/${created.call.id}`, { method: "DELETE" });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.getByText(call.name).waitFor({ state: "detached", timeout: 5_000 });
    await shoot();
    await page.getByRole("button", { name: "New routine", exact: true }).click();
    const quick = page.getByRole("dialog", { name: "Quick create" });
    await quick.waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("placeholder")), "Add title", "the title field has focus");
    await page.keyboard.press("Escape");
    await quick.waitFor({ state: "hidden", timeout: 2_000 });
    await page.getByRole("button", { name: "Week", exact: true }).click();
    await page.getByRole("button", { name: "Run logs", exact: true }).first().click();
    await page.getByRole("button", { name: "Webhooks", exact: true }).first().click();
    await page.getByRole("button", { name: "Week", exact: true }).click();
    await page.getByText("BotAgent").waitFor({ state: "detached", timeout: 1_000 });
    await page.getByRole("button", { name: "Back", exact: true }).click();
  },
  async triggers(page, shoot) {
    await nav("Triggers")(page);
    await page.getByText("YOUR TRIGGERS", { exact: false }).first().waitFor();
    await shoot();
    await page.keyboard.press("Escape");
  },
  async "team-map"(page, shoot) {
    await nav("Team map")(page);
    await page.getByText("6 bots").waitFor();
    await shoot();
  },
  async apps(page, shoot) {
    await nav("Apps")(page);
    await page.getByPlaceholder("Search apps").waitFor();
    await shoot();
    await page.keyboard.press("Escape");
    await page.getByPlaceholder("Search apps").waitFor({ state: "hidden" });
  },
  async search(page, shoot) {
    await nav("Search bots and messages")(page);
    const box = page.getByPlaceholder(/Search projects, agents/);
    await box.fill("Scout");
    await page.getByRole("option", { name: /Scout/ }).first().waitFor().catch(async () => page.getByText("Scout", { exact: true }).last().waitFor());
    await shoot();
    await page.keyboard.press("Escape");
  },
  async settings(page, shoot) {
    await nav("Open account menu")(page);
    await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
    const dialog = page.getByRole("dialog").last();
    for (const group of ["Appearance", "Model providers", "API keys", "Integrations", "Logins", "Usage", "Backups", "People", "Activity", "General"]) {
      const item = dialog.getByRole("button", { name: group, exact: true });
      if (await item.isVisible().catch(() => false)) {
        await item.click();
        await page.waitForTimeout(150);
      }
    }
    await shoot();
    await page.keyboard.press("Escape");
  },
  async "new-agent"(page, shoot) {
    await nav("New agent")(page);
    const dialog = page.getByRole("dialog", { name: "New agent" });
    await dialog.waitFor();
    await dialog.getByRole("button", { name: "Create agent" }).waitFor();
    await shoot();
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
  },
  async "whats-new"(page, shoot) {
    await nav("What's new, unread update, version 0.7.1")(page).catch(async () => page.getByRole("button", { name: /^What's new/ }).first().click());
    await page.getByText("What's new").first().waitFor();
    await shoot();
    await page.keyboard.press("Escape");
  },
};

try {
  const head = await api(`/api/bots/${headId}/system-prompt`);
  await new Promise((done) => setTimeout(done, 3_000));
  const headPrompt = JSON.stringify(await api(`/api/bots/${headId}/system-prompt`));
  const scoutPrompt = JSON.stringify(await api(`/api/bots/${scoutId}/system-prompt`));
  report.context = {
    headSections: Object.keys(head ?? {}),
    head: ["Walkies", "Bakery", "Morning stand-up", "Launch review", "Competitor scan", "Book a walk for today"].filter((text) => headPrompt.includes(text)),
    scout: ["you are one of", "Walkies", "Bakery", "Launch review", "Competitor scan"].filter((text) => scoutPrompt.includes(text)),
  };
  for (const text of ["Walkies", "Bakery", "Morning stand-up", "Launch review"]) if (!headPrompt.includes(text)) report.failures.push(`head prompt lacks ${text}`);
  for (const text of ["you are one of", "Walkies", "Launch review"]) if (!scoutPrompt.includes(text)) report.failures.push(`standalone agent prompt lacks ${text}`);

  for (const theme of ["dark", "light"]) {
    for (const width of [1280, 375]) {
      const context = await browser.newContext({ viewport: { width, height: width < 600 ? 812 : 860 }, colorScheme: theme });
      await context.addInitScript((skin) => { try { localStorage.setItem("omb-skin", skin); } catch { /* storage blocked */ } }, theme === "dark" ? "midnight" : "daylight");
      const page = await context.newPage();
      page.setDefaultTimeout(6_000);
      page.on("pageerror", (error) => report.pageErrors.push(`${theme} ${width}: ${error.message}`));
      await page.route("**/*", (route) => {
        const url = new URL(route.request().url());
        return ["127.0.0.1", "localhost"].includes(url.hostname) || url.protocol === "data:" ? route.continue() : route.abort();
      });
      await page.goto(base.href, { timeout: 120_000 });
      await page.waitForTimeout(3_000);
      for (const [id, run] of Object.entries(flows)) {
        const shoot = async () => {
          await page.mouse.move(0, 0);
          await page.waitForTimeout(250);
          await page.screenshot({ path: resolve(shots, `${id}-${width}-${theme}.png`) });
          if (theme === "dark" && width === 1280 && best[id]) await page.screenshot({ path: resolve(out, `${best[id]}.png`) });
        };
        const started = Date.now();
        try {
          await run(page, shoot, `${theme} ${width}`);
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
          assert.ok(overflow <= 1, `${id} overflows by ${overflow}px`);
          report.cases.push({ theme, width, flow: id, ms: Date.now() - started });
        } catch (error) {
          report.failures.push(`${theme} ${width} ${id}: ${error instanceof Error ? error.message.split("\n")[0] : error}`);
          await page.screenshot({ path: resolve(shots, `${id}-${width}-${theme}-failed.png`) }).catch(() => undefined);
          await page.keyboard.press("Escape").catch(() => undefined);
          await page.keyboard.press("Escape").catch(() => undefined);
        }
        await closeDrawer(page);
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
  await writeFile(resolve(out, "workspace-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ cases: report.cases.length, failures: report.failures, pageErrors: report.pageErrors, context: report.context }, null, 2));
  if (report.failures.length || report.pageErrors.length) process.exitCode = 1;
}
