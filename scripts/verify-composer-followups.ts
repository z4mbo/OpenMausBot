import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Browser, Locator, Page } from "playwright";
import type { VerificationServer } from "./control-omb.ts";
import { REPO_ROOT } from "./testing/preview-fixture.ts";
import { COMPOSER, composerFixture, openChat, REPLIES, SENDS, shooter, SIZES, THEMES, within, type Evidence, type Size, type Theme } from "./testing/composer-fixture.ts";

const EVIDENCE = join(REPO_ROOT, "docs", "verification", "evidence", "composer-followups");
const GAUGE = 'button[aria-label="Show plan usage and context"]';
const PANEL = "[data-chat-usage-popover]";
const CHIP = "[data-compact-chip]";
const LISTEN = '[data-chathead-controls] button[aria-label^="Listen for"], [data-chathead-controls] button[aria-label="Wake listening isn\'t available here"]';

const evidence: Evidence = { dir: EVIDENCE, screenshots: [], checks: {}, errors: [] };
const { checks, errors } = evidence;

function desktopBridge() {
  const host = window as unknown as { ogb?: object };
  host.ogb ??= {};
}

async function header(page: Page) {
  return page.evaluate((listen) => {
    const rect = (selector: string) => document.querySelector(selector)?.getBoundingClientRect() ?? null;
    const identity = rect("[data-chathead-identity]"), controls = rect("[data-chathead-controls]"), pill = rect("[data-chathead-pill]");
    const thread = document.querySelector<HTMLElement>("button[data-chathead-thread]");
    const avatar = document.querySelector<HTMLElement>("[data-chathead-pill] button, button[data-chathead-pill]");
    const present = (selector: string) => Boolean(document.querySelector(selector)?.getClientRects().length);
    return {
      oneRow: Boolean(identity && controls && Math.abs((identity.top + identity.bottom) / 2 - (controls.top + controls.bottom) / 2) < 6),
      rowHeight: Math.round(document.querySelector("[data-chathead-row]")!.getBoundingClientRect().height),
      pillWidth: pill ? Math.round(pill.width) : null,
      agentName: avatar?.getAttribute("aria-label") ?? null,
      agentTooltip: avatar?.getAttribute("title") ?? null,
      threadTruncated: thread ? (thread.querySelector<HTMLElement>("span.truncate")?.scrollWidth ?? 0) > (thread.querySelector<HTMLElement>("span.truncate")?.clientWidth ?? 0) : null,
      runsOn: present('[data-chathead-controls] [data-testid="runs-on-badge"]'),
      listen: present(listen),
      computer: present('[data-chathead-controls] [data-tour="computer"]'),
      more: present('[data-chathead-controls] [data-testid="chat-more"]'),
      controlsInside: Boolean(controls && controls.right <= innerWidth),
      noOverlap: Boolean(identity && controls && identity.right <= controls.left),
    };
  }, LISTEN);
}

async function press(target: Locator) {
  await target.evaluate((element: HTMLElement) => element.click());
}

async function panelOpen(page: Page) {
  await page.locator(GAUGE).first().click();
  await page.locator(PANEL).waitFor();
  await page.waitForTimeout(300);
}

async function panelGone(page: Page) {
  return page.locator(PANEL).waitFor({ state: "detached", timeout: 3_000 }).then(() => true, () => false);
}

async function usageClosing(page: Page, theme: Theme, size: Size, shoot: ReturnType<typeof shooter>) {
  const key = `${theme.id}-${size.width}`;
  await panelOpen(page);
  checks[`${key}-usage`] = await within(page, PANEL);
  await shoot("usage-open");
  await page.locator(COMPOSER).click();
  checks[`${key}-usageClosesOnOutsideClick`] = await panelGone(page);
  await shoot("usage-closed-outside");
  await panelOpen(page);
  await page.keyboard.press("Escape");
  checks[`${key}-usageClosesOnEscape`] = await panelGone(page);
  checks[`${key}-escapeFocus`] = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? null);
  if (size.width < 768) return;
  await panelOpen(page);
  const pepperGone = () => page.locator('textarea[aria-label="Message Pepper"]').waitFor({ state: "hidden", timeout: 10_000 }).then(() => true, () => false);
  for (const name of ["Fixture Starter", "Chat", "Inbox"]) {
    await press(page.getByText(name, { exact: true }).filter({ visible: true }).first());
    if (await pepperGone()) { checks[`${key}-switchedVia`] = name; break; }
    await page.keyboard.press("Escape");
  }
  checks[`${key}-usageClosesOnChatSwitch`] = await page.locator(PANEL).count() === 0;
  await shoot("usage-other-chat");
  await page.getByRole("button", { name: /Pepper/ }).filter({ visible: true }).first().click();
  checks[`${key}-backOnPepper`] = await page.locator('textarea[aria-label="Message Pepper"]').waitFor({ timeout: 15_000 }).then(() => true, () => false);
  await page.locator(CHIP).waitFor();
  checks[`${key}-usageClosedAfterChatSwitch`] = await page.locator(PANEL).count() === 0;
  await shoot("usage-after-chat-switch");
  await panelOpen(page);
  await press(page.locator("button[data-chathead-thread]").first());
  await press(page.getByRole("button", { name: "New thread" }).first());
  await page.locator(CHIP).waitFor({ state: "detached" });
  checks[`${key}-usageClosesOnThreadSwitch`] = await panelGone(page);
  await shoot("usage-after-thread-switch");
  await page.locator("button[data-chathead-thread]").first().click();
  await page.locator("[data-thread-menu]").getByText(SENDS[0]!).first().click();
  await page.locator(CHIP).waitFor();
  checks[`${key}-usageClosedBackOnThread`] = await page.locator(PANEL).count() === 0;
}

async function compaction(browser: Browser, url: string) {
  const theme = THEMES[0]!, size = SIZES[0]!;
  const { context, page } = await openChat(browser, url, theme, size, errors, desktopBridge);
  const shoot = shooter(page, theme, size, evidence);
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/bots/*/compact", async (route) => { await held; await route.continue(); });
  await page.locator(CHIP).click();
  await page.locator(`${CHIP}[aria-busy="true"]`).waitFor();
  checks.compactingLabel = await page.locator(CHIP).getAttribute("aria-label");
  await shoot("compacting");
  release();
  checks.chipGoneAfterCompaction = await page.locator(CHIP).waitFor({ state: "detached", timeout: 60_000 }).then(() => true, () => false);
  await page.locator('[data-composer-stop]').waitFor({ state: "detached", timeout: 60_000 }).catch(() => undefined);
  await shoot("compacted");
  await context.close();
}

const playwright = await import(process.env.OMB_VERIFY_PLAYWRIGHT ? pathToFileURL(process.env.OMB_VERIFY_PLAYWRIGHT).href : "playwright") as typeof import("playwright");
mkdirSync(EVIDENCE, { recursive: true });
const summaryDir = mkdtempSync(join(tmpdir(), "composer-followups-"));
const summary = join(summaryDir, "summary.txt");
writeFileSync(summary, "Pepper planned the launch week and wrote the demo script.");
let owned: { server: VerificationServer; preview: { close(): Promise<void> } } | undefined;
let browser: Browser | undefined;
try {
  const main = await composerFixture({
    FAKE_CLAUDE_CACHE_READ_TOKENS: "185990", FAKE_CLAUDE_TOOL_CALLS: "[]", FAKE_CLAUDE_REPLIES: JSON.stringify(REPLIES), FAKE_CLAUDE_TEXT_FILE: summary,
  }, "26810-26900", SENDS, "/__composer-followups.html");
  owned = main;
  await main.api("PATCH", `/api/bots/${main.pepper.id}`, { section: "Launch" });
  await main.api("PATCH", `/api/bots/${main.pepper.id}`, { chiefOfStaff: true, managedSections: ["Launch"], acknowledgePeerScope: true });
  browser = await playwright.chromium.launch();
  for (const theme of THEMES) {
    for (const size of SIZES) {
      const { context, page } = await openChat(browser, main.preview.previewUrl, theme, size, errors, desktopBridge);
      const shoot = shooter(page, theme, size, evidence);
      const key = `${theme.id}-${size.width}`;
      checks[`${key}-header`] = await header(page);
      const row = (await page.locator("[data-chathead-row]").first().boundingBox())!;
      await shoot("header", { x: 0, y: Math.max(0, row.y - 14), width: size.width, height: row.height + 28 });
      await page.locator(CHIP).waitFor();
      checks[`${key}-chip`] = { label: await page.locator(CHIP).getAttribute("aria-label"), percent: await page.locator(GAUGE).first().getAttribute("data-context-percent") };
      await shoot("compact-chip");
      await usageClosing(page, theme, size, shoot);
      await context.close();
    }
  }
  await compaction(browser, main.preview.previewUrl);
  checks.noPageErrors = errors.length === 0;
  writeFileSync(join(EVIDENCE, "report.json"), `${JSON.stringify({ log: basename(main.server.info.logPath), ...evidence, dir: undefined }, null, 2)}\n`);
  console.log(JSON.stringify({ ok: checks.noPageErrors, evidence: EVIDENCE, logPath: main.server.info.logPath }));
} finally {
  await browser?.close();
  await owned?.preview.close();
  await owned?.server.close();
  rmSync(summaryDir, { recursive: true, force: true });
}
