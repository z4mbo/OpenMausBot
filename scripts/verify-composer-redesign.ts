import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Browser, Page } from "playwright";
import { launchVerificationServer, runControlOmb, type VerificationServer } from "./control-omb.ts";
import { fixtureApi, mountPreview, REPO_ROOT } from "./testing/preview-fixture.ts";

type Json = Record<string, unknown>;
type Theme = { id: "dark" | "light"; skin: string; scheme: "dark" | "light" };

const label = process.argv[2] === "before" ? "before" : "after";
const EVIDENCE = join(REPO_ROOT, "docs", "verification", "evidence", "composer-redesign", label);
const THEMES: Theme[] = [{ id: "dark", skin: "midnight", scheme: "dark" }, { id: "light", skin: "meadow", scheme: "light" }];
const SIZES = [{ width: 1280, height: 860 }, { width: 375, height: 812 }];
const COMPOSER = 'textarea[aria-label="Message Pepper"]';
const REPLIES = [
  "Here is the plan for the launch week:\n\n1. **Monday** — freeze the landing page copy and record the demo.\n2. **Tuesday** — run the pricing check with two customers.\n3. **Wednesday** — ship the release and post the announcement.\n\nI kept the checklist short so it fits on one screen. Tell me which step to start with.",
  "Done. The demo script is in the project files and the announcement draft waits for your review.",
];
const PASTE = Array.from({ length: 24 }, (_, index) => `${index + 1}. Launch checklist item ${index + 1}: confirm owner, date and the link to the brief.`).join("\n");

const report: Json = { label, screenshots: [] as string[], checks: {} as Json, errors: [] as string[] };
const checks = report.checks as Record<string, unknown>;
const errors = report.errors as string[];

function planUsage(_req: unknown, res: { setHeader(name: string, value: string): void; end(body: string): void }) {
  const now = Date.now();
  const window = (usedPercent: number, delay: number) => ({ available: true, usedPercent, remainingPercent: 100 - usedPercent, resetsAt: new Date(now + delay).toISOString() });
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ fetchedAt: new Date(now).toISOString(), providers: [{ id: "claude", name: "Synthetic Claude account", driver: "claudeAgent", plan: "Max plan", ok: true, error: null,
    fiveHour: window(34, 2 * 3_600_000 + 14 * 60_000), weekly: window(61, 3 * 86_400_000 + 5 * 3_600_000), extra: [],
    models: [{ name: "Opus", windows: [{ label: "Weekly", usedPercent: 22, remainingPercent: 78, resetsAt: new Date(now + 3 * 86_400_000).toISOString() }] }] }] }));
}

async function fixture(env: NodeJS.ProcessEnv, ports: string, sends: string[]) {
  const server = await launchVerificationServer({ ...process.env, OMB_TEST_PORTS: ports, ...env }, undefined, undefined, undefined, undefined, undefined, ["codex"]);
  const api = fixtureApi(server.info.url);
  await api("PATCH", "/api/config", { language: "en" });
  const pepper = (await runControlOmb(["new-bot", "--name", "Pepper", "--url", server.info.url]) as { bot: { id: string } }).bot;
  for (const text of sends) {
    await runControlOmb(["send", "--bot", pepper.id, "--text", text, "--url", server.info.url]);
    await runControlOmb(["wait", "--bot", pepper.id, "--timeout", "60", "--url", server.info.url]);
  }
  const preview = await mountPreview(server, {
    entry: "/scripts/testing/threads-preview.tsx", route: "/__composer-redesign.html", title: "Isolated composer redesign", logLevel: "warn",
    extraRoutes: [{ path: "/api/plan-usage", method: "GET", handler: planUsage }],
  });
  return { server, preview, api, pepper };
}

async function openChat(browser: Browser, url: string, theme: Theme, size: { width: number; height: number }) {
  const context = await browser.newContext({ viewport: size, colorScheme: theme.scheme, deviceScaleFactor: size.width < 768 ? 2 : 1 });
  await context.addInitScript((skin) => {
    try {
      localStorage.setItem("omb-skin", skin);
      localStorage.setItem("origin-chat-usage-open", "0");
    } catch { /* storage blocked */ }
  }, theme.skin);
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`${theme.id}-${size.width}: ${error.message}`));
  page.setDefaultTimeout(60_000);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 240_000 });
  const input = page.locator(COMPOSER);
  if (!await input.waitFor({ state: "visible", timeout: 120_000 }).then(() => true, () => false)) {
    await page.getByRole("button", { name: /Pepper/ }).first().click();
  }
  await input.waitFor({ state: "visible" });
  await page.locator("[data-mid]").last().waitFor();
  await page.waitForTimeout(800);
  await page.mouse.move(size.width - 4, 4);
  return { context, page, input };
}

function shooter(page: Page, theme: Theme, size: { width: number }) {
  return async (state: string) => {
    await page.waitForTimeout(350);
    const file = join(EVIDENCE, `${theme.id}-${size.width}-${state}.png`);
    await page.screenshot({ path: file });
    (report.screenshots as string[]).push(file.slice(REPO_ROOT.length + 1).replaceAll("\\", "/"));
    checks[`${theme.id}-${size.width}-${state}-overflowPx`] = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  };
}

async function within(page: Page, selector: string) {
  return page.locator(selector).first().evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: Math.round(rect.left), right: Math.round(rect.right), top: Math.round(rect.top), bottom: Math.round(rect.bottom), inside: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight };
  });
}

const playwright = await import(process.env.OMB_VERIFY_PLAYWRIGHT ? pathToFileURL(process.env.OMB_VERIFY_PLAYWRIGHT).href : "playwright") as typeof import("playwright");
mkdirSync(EVIDENCE, { recursive: true });
const owned: Array<{ server: VerificationServer; preview: { close(): Promise<void> } }> = [];
let browser: Browser | undefined;
try {
  const main = await fixture({ FAKE_CLAUDE_CACHE_READ_TOKENS: "64000", FAKE_CLAUDE_TOOL_CALLS: "[]", FAKE_CLAUDE_REPLIES: JSON.stringify(REPLIES) }, "26610-26700",
    ["Plan the launch week for the new release.", "Write the demo script."]);
  owned.push(main);
  report.logPath = main.server.info.logPath;
  browser = await playwright.chromium.launch();
  for (const theme of THEMES) {
    for (const size of SIZES) {
      const { context, page, input } = await openChat(browser, main.preview.previewUrl, theme, size);
      const shoot = shooter(page, theme, size);
      await shoot("chat");
      await input.click();
      await input.fill("Draft the announcement post for Wednesday.\nKeep it under 280 characters and link the demo.");
      await shoot("composer-focused");
      await input.fill("");
      await page.locator('[data-tour="model"]').first().click();
      await page.locator("[data-model-picker-content]").waitFor();
      await page.waitForTimeout(300);
      checks[`${theme.id}-${size.width}-picker`] = await within(page, "[data-model-picker-content]");
      await shoot("picker-open");
      if (label === "after" && size.width >= 768) {
        await page.locator('input[aria-label="Search models"]').fill("fable");
        await shoot("picker-search");
        await page.locator('input[aria-label="Search models"]').fill("");
        await page.locator('[data-model-group="family:claude"] [data-model-update]').click();
        await page.locator("[data-engine-update-notice]").waitFor();
        await shoot("picker-update");
      }
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await page.locator("[data-model-picker-content]").waitFor({ state: "detached", timeout: 5_000 }).catch(() => undefined);
      await page.locator('button[aria-label="Show plan usage and context"]').first().click();
      await page.locator("[data-chat-usage-popover]").waitFor();
      await page.waitForTimeout(400);
      checks[`${theme.id}-${size.width}-usage`] = await within(page, "[data-chat-usage-popover]");
      await shoot("usage-open");
      await page.keyboard.press("Escape");
      if (label === "after" && size.width >= 768) {
        await input.click();
        await input.evaluate((element, text) => {
          const data = new DataTransfer();
          data.setData("text/plain", text);
          element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
        }, PASTE);
        const image = await page.screenshot({ clip: { x: 0, y: 0, width: 160, height: 120 } });
        await page.locator('input[type="file"]').first().setInputFiles({ name: "launch-hero.png", mimeType: "image/png", buffer: image });
        await page.locator("[data-composer-attachments] img").first().waitFor();
        await input.fill("Use these for the announcement.");
        await shoot("composer-attachments");
      }
      await context.close();
    }
  }

  if (label === "after") {
    await main.api("POST", "/api/groups", {
      memberIds: [main.pepper.id], name: "Launch room",
      setup: { bulletin: "", defaultResponder: { kind: "member", botId: main.pepper.id } },
    });
    for (const theme of THEMES) {
      const { context, page } = await openChat(browser, main.preview.previewUrl, theme, SIZES[0]!);
      await page.getByText("Launch room", { exact: true }).first().click();
      const room = page.locator('textarea[aria-label="Message Launch room"]');
      await room.waitFor();
      await room.fill("@Pepper can you take the Wednesday post?");
      await shooter(page, theme, SIZES[0]!)("group-composer");
      await context.close();
    }

    const gateDir = mkdtempSync(join(tmpdir(), "composer-redesign-gate-"));
    const gate = join(gateDir, "finish");
    writeFileSync(gate, "ok");
    const slow = await fixture({ FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_SLOW_FINISH_GATE: gate, FAKE_CLAUDE_TOOL_CALLS: "[]" }, "26710-26800", ["Plan the launch week for the new release."]);
    owned.push(slow);
    try {
      for (const [theme, size] of [[THEMES[0]!, SIZES[0]!], [THEMES[1]!, SIZES[0]!], [THEMES[0]!, SIZES[1]!]] as const) {
        const { context, page, input } = await openChat(browser, slow.preview.previewUrl, theme, size);
        const shoot = shooter(page, theme, size);
        rmSync(gate, { force: true });
        await input.fill("Draft the announcement post for Wednesday.");
        await input.press("Enter");
        await page.locator("[data-composer-stop]").first().waitFor();
        await shoot("composer-working");
        if (size.width >= 768) {
          await input.fill("Also add a short line about pricing.");
          await shoot("composer-working-draft");
          await input.fill("");
        }
        checks[`${theme.id}-${size.width}-stop`] = await page.locator("[data-composer-stop]").first().getAttribute("aria-label");
        writeFileSync(gate, "ok");
        await page.locator("[data-composer-stop]").first().waitFor({ state: "detached", timeout: 30_000 });
        await context.close();
      }
    } finally {
      writeFileSync(gate, "ok");
      rmSync(gateDir, { recursive: true, force: true });
    }
  }
  checks.noPageErrors = errors.length === 0;
  writeFileSync(join(EVIDENCE, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ok: checks.noPageErrors, evidence: EVIDENCE, logPath: report.logPath }));
} finally {
  await browser?.close();
  for (const { server, preview } of owned.reverse()) {
    await preview.close();
    await server.close();
  }
}
