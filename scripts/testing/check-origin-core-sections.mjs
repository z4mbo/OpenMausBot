import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const base = new URL(process.argv[2] ?? "");
assert.equal(base.hostname, "127.0.0.1");
assert.equal(base.pathname, "/__origin-core-sections.html");
const out = resolve("docs/verification/evidence/round6");
const shots = resolve(tmpdir(), "origin-core-sections");
await mkdir(shots, { recursive: true });
const { chromium } = await import(process.env.OMB_VERIFY_PLAYWRIGHT ? pathToFileURL(process.env.OMB_VERIFY_PLAYWRIGHT).href : "playwright");
const browser = await chromium.launch();
const report = { previewUrl: base.href, screenshots: shots, checkedAt: new Date().toISOString(), cases: [], failures: [], pageErrors: [] };
const best = { issues: "core-issues", "issues-detail": "core-issue-detail", agents: "core-agents", vault: "core-vault" };

const sectionsOf = { chat, agents, issues, "team-chat": teamChat, call, assets, vault, repo, feedback, settings };

async function chat(page) {
  await page.getByRole("textbox", { name: /^Message Atlas/ }).fill("Draft the walker agreement next");
}
async function agents(page) {
  await page.getByRole("button", { name: /^Nova/ }).click();
  await page.getByRole("textbox", { name: /^Message Nova/ }).waitFor();
  const back = page.getByRole("button", { name: "Back to agents" });
  if (await back.isVisible()) await back.click();
  await page.locator("[data-agents-header]").getByRole("button", { name: "New agent" }).click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
}
async function issues(page, shoot) {
  const board = page;
  await board.getByRole("button", { name: /^New issue/ }).first().click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const actions = board.getByRole("button", { name: "Actions for Launch landing page" });
  await board.getByRole("article", { name: /Launch landing page/ }).hover();
  await actions.click();
  const menu = page.getByRole("menu");
  await menu.waitFor();
  assert.ok(await menu.evaluate((element) => { const box = element.getBoundingClientRect(); const hit = document.elementFromPoint(box.left + box.width / 2, box.bottom - 6); return element.contains(hit); }), "board actions menu is fully visible");
  await page.keyboard.press("Escape");
  assert.equal(await actions.evaluate((element) => element === document.activeElement), true, "Escape returns focus to the actions button");
  assert.equal(await board.getByRole("textbox", { name: "Search issues" }).count(), 0, "search starts as an icon");
  await board.getByRole("button", { name: "Search issues" }).click();
  await board.getByRole("textbox", { name: "Search issues" }).fill("map");
  assert.equal(await board.locator("[data-task-id]").count(), 1, "search narrows the board");
  await board.getByRole("textbox", { name: "Search issues" }).fill("");
  await board.getByTitle("List", { exact: true }).click();
  const rows = board.getByRole("button", { name: /^Actions for / });
  await rows.last().click();
  const listMenu = page.getByRole("menu");
  await listMenu.waitFor();
  assert.ok(await listMenu.evaluate((element) => { const box = element.getBoundingClientRect(); const hit = document.elementFromPoint(box.left + box.width / 2, box.bottom - 6); return element.contains(hit); }), "list actions menu is fully visible");
  await page.keyboard.press("Escape");
  await board.getByTitle("Board", { exact: true }).click();
  await board.getByRole("group", { name: "Issue state" }).getByRole("button").last().click();
  await board.getByText("Walker sign-up and vetting").waitFor();
  await board.getByRole("group", { name: "Issue state" }).getByRole("button").first().click();
  await board.getByRole("article", { name: /Book a walk for today/ }).click();
  const detail = page.getByRole("dialog");
  await detail.getByText(/booking sheet works on phones/).waitFor();
  await page.waitForTimeout(250);
  await shoot("issues-detail");
  await page.keyboard.press("Escape");
  await detail.waitFor({ state: "hidden" });
}
async function teamChat(page, _shoot, run) {
  const section = page;
  await section.getByText("Pilot walkers are booked for Saturday").waitFor({ timeout: 10_000 });
  const text = `Checking the map on my Pixel now (${run}, ${Date.now()}).`;
  await section.getByPlaceholder("Message Walkies").fill(text);
  await section.getByPlaceholder("Message Walkies").press("Enter");
  await section.getByText(text).waitFor({ timeout: 10_000 });
}
async function call(page) {
  await page.getByRole("button", { name: /Start call/ }).waitFor();
}
async function assets(page) {
  const section = page;
  for (const tab of ["Tokens", "Brand", "Files"]) await section.getByRole("button", { name: tab, exact: true }).click();
  await section.getByRole("button", { name: "Add asset" }).click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
}
async function vault(page) {
  const section = page;
  await section.locator('input[type="password"]').fill("fixture-passphrase");
  await section.getByRole("button", { name: "Unlock vault" }).click();
  await section.getByRole("button", { name: "Reveal Stripe test key" }).click();
  await section.getByText("sk_test_fixture_only").waitFor();
}
async function repo(page) {
  await page.getByRole("button", { name: "Refresh" }).click();
}
async function feedback(page) {
  const section = page;
  for (const tab of ["Completed", "Dismissed", "All", "Open"]) await section.getByRole("button", { name: tab, exact: true }).click();
  await section.getByRole("button", { name: /Convert to issue/ }).first().click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
}
async function settings(page) {
  await page.getByRole("heading", { name: "Settings" }).waitFor();
}

async function barSweep(page) {
  await open(page, "chat");
  const overlaps = [];
  for (let width = 1120; width >= 800; width -= 8) {
    await page.setViewportSize({ width, height: 860 });
    for (const id of ["broadcast", "studio"]) {
      await open(page, id);
      await page.waitForTimeout(120);
      const box = await page.evaluate(() => {
        const strip = document.querySelector('[role="group"][aria-label="Sections"]');
        const shown = [...strip.children].filter((child) => !child.getAttribute("aria-hidden"));
        return { right: Math.max(...shown.map((child) => child.getBoundingClientRect().right)), edge: strip.getBoundingClientRect().right };
      });
      if (box.right > box.edge + 0.5) overlaps.push({ width, id, ...box });
    }
  }
  await page.setViewportSize({ width: 1280, height: 860 });
  report.cases.push({ theme: "dark", width: "1120-800", section: "bar sweep", overlaps });
  assert.deepEqual(overlaps, [], "tab strip stays inside its row");
}

async function open(page, id) {
  const tab = page.locator(`[data-chief-section="${id}"]`).first();
  if (await tab.isVisible()) return tab.click();
  await page.getByRole("button", { name: /^More sections/ }).click();
  const label = { "team-chat": "Chat", broadcast: "Publish" }[id] ?? id;
  await page.getByRole("menuitem", { name: new RegExp(`^${label}`, "i") }).click();
}

try {
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
      const drawer = page.getByRole("button", { name: "Open bot list", exact: true });
      await page.waitForTimeout(1500);
      if (await drawer.isVisible()) await drawer.click();
      await page.getByRole("button", { name: /^Atlas/ }).first().click({ timeout: 60_000 });
      for (const [id, run] of Object.entries(sectionsOf)) {
        const shoot = async (name) => {
          await page.mouse.move(0, 0);
          await page.waitForTimeout(250);
          await page.screenshot({ path: resolve(shots, `${name}-${width}-${theme}.png`) });
          if (theme === "dark" && width === 1280 && best[name]) await page.screenshot({ path: resolve(out, `${best[name]}.png`) });
        };
        const started = Date.now();
        try {
          await open(page, id);
          await page.locator(id === "chat" ? "[data-chief-sections]" : `[data-section-page="${id}"]`).first().waitFor();
          await page.waitForTimeout(900);
          await shoot(id);
          await run(page, shoot, `${theme} ${width}`);
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
          assert.ok(overflow <= 1, `${id} overflows by ${overflow}px`);
          report.cases.push({ theme, width, section: id, ms: Date.now() - started });
        } catch (error) {
          report.failures.push(`${theme} ${width} ${id}: ${error instanceof Error ? error.message.split("\n")[0] : error}`);
          await page.keyboard.press("Escape").catch(() => undefined);
        }
      }
      if (theme === "dark" && width === 1280) await barSweep(page).catch((error) => report.failures.push(`bar sweep: ${error.message.split("\n")[0]}`));
      await context.close();
    }
  }
} finally {
  await browser.close();
  await writeFile(resolve(out, "core-sections-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ cases: report.cases.length, failures: report.failures, pageErrors: report.pageErrors }, null, 2));
  if (report.failures.length || report.pageErrors.length) process.exitCode = 1;
}
