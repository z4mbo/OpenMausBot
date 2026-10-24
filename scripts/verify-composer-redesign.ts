import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Browser, Page } from "playwright";
import type { VerificationServer } from "./control-omb.ts";
import { REPO_ROOT } from "./testing/preview-fixture.ts";
import { composerFixture, openChat as openThemedChat, REPLIES, SENDS, shooter as evidenceShooter, SIZES, THEMES, within, type Evidence, type Size, type Theme } from "./testing/composer-fixture.ts";

type Json = Record<string, unknown>;

const label = process.argv[2] === "before" ? "before" : "after";
const EVIDENCE = join(REPO_ROOT, "docs", "verification", "evidence", "composer-redesign", label);
const SKINS = ["midnight", "atelier", "foundry", "lagoon", "graphite", "linen", "dusk", "daylight", "meadow"];
const LIGHT_SKINS = new Set(["atelier", "lagoon", "linen", "daylight", "meadow"]);
const PASTE = Array.from({ length: 24 }, (_, index) => `${index + 1}. Launch checklist item ${index + 1}: confirm owner, date and the link to the brief.`).join("\n");

const report: Json = { label, screenshots: [] as string[], checks: {} as Json, errors: [] as string[] };
const checks = report.checks as Record<string, unknown>;
const errors = report.errors as string[];
const evidence: Evidence = { dir: EVIDENCE, screenshots: report.screenshots as string[], checks, errors };
const fixture = composerFixture;
const openChat = (browser: Browser, url: string, theme: Theme, size: Size) => openThemedChat(browser, url, theme, size, errors);
const shooter = (page: Page, theme: Theme, size: Size) => evidenceShooter(page, theme, size, evidence);

const playwright = await import(process.env.OMB_VERIFY_PLAYWRIGHT ? pathToFileURL(process.env.OMB_VERIFY_PLAYWRIGHT).href : "playwright") as typeof import("playwright");
mkdirSync(EVIDENCE, { recursive: true });
const owned: Array<{ server: VerificationServer; preview: { close(): Promise<void> } }> = [];
let browser: Browser | undefined;
try {
  const main = await fixture({ FAKE_CLAUDE_CACHE_READ_TOKENS: "64000", FAKE_CLAUDE_TOOL_CALLS: "[]", FAKE_CLAUDE_REPLIES: JSON.stringify(REPLIES) }, "26610-26700", SENDS);
  owned.push(main);
  report.log = basename(main.server.info.logPath);
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
    mkdirSync(join(EVIDENCE, "skins"), { recursive: true });
    for (const skin of SKINS) {
      const theme: Theme = { id: LIGHT_SKINS.has(skin) ? "light" : "dark", skin, scheme: LIGHT_SKINS.has(skin) ? "light" : "dark" };
      const { context, page } = await openChat(browser, main.preview.previewUrl, theme, SIZES[0]!);
      await page.locator('[data-tour="model"]').first().click();
      await page.locator("[data-model-picker-content]").waitFor();
      await page.waitForTimeout(400);
      const file = join(EVIDENCE, "skins", `${skin}-picker.png`);
      await page.screenshot({ path: file, clip: { x: 440, y: 120, width: 720, height: 740 } });
      (report.screenshots as string[]).push(file.slice(REPO_ROOT.length + 1).replaceAll("\\", "/"));
      await context.close();
    }

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
  console.log(JSON.stringify({ ok: checks.noPageErrors, evidence: EVIDENCE, logPath: main.server.info.logPath }));
} finally {
  await browser?.close();
  for (const { server, preview } of owned.reverse()) {
    await preview.close();
    await server.close();
  }
}
