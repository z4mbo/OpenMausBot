import { join } from "node:path";
import type { Browser, Page } from "playwright";
import { launchVerificationServer, runControlOmb } from "../control-omb.ts";
import { fixtureApi, mountPreview, REPO_ROOT } from "./preview-fixture.ts";

export type Theme = { id: "dark" | "light"; skin: string; scheme: "dark" | "light" };
export type Size = { width: number; height: number };
export type Evidence = { dir: string; screenshots: string[]; checks: Record<string, unknown>; errors: string[] };

export const THEMES: Theme[] = [{ id: "dark", skin: "midnight", scheme: "dark" }, { id: "light", skin: "meadow", scheme: "light" }];
export const SIZES: Size[] = [{ width: 1280, height: 860 }, { width: 375, height: 812 }];
export const COMPOSER = 'textarea[aria-label="Message Pepper"]';
export const REPLIES = [
  "Here is the plan for the launch week:\n\n1. **Monday** — freeze the landing page copy and record the demo.\n2. **Tuesday** — run the pricing check with two customers.\n3. **Wednesday** — ship the release and post the announcement.\n\nI kept the checklist short so it fits on one screen. Tell me which step to start with.",
  "Done. The demo script is in the project files and the announcement draft waits for your review.",
];
export const SENDS = ["Plan the launch week for the new release.", "Write the demo script."];

function planUsage(_req: unknown, res: { setHeader(name: string, value: string): void; end(body: string): void }) {
  const now = Date.now();
  const window = (usedPercent: number, delay: number) => ({ available: true, usedPercent, remainingPercent: 100 - usedPercent, resetsAt: new Date(now + delay).toISOString() });
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ fetchedAt: new Date(now).toISOString(), providers: [{ id: "claude", name: "Synthetic Claude account", driver: "claudeAgent", plan: "Max plan", ok: true, error: null,
    fiveHour: window(34, 2 * 3_600_000 + 14 * 60_000), weekly: window(61, 3 * 86_400_000 + 5 * 3_600_000), extra: [],
    models: [{ name: "Opus", windows: [{ label: "Weekly", usedPercent: 22, remainingPercent: 78, resetsAt: new Date(now + 3 * 86_400_000).toISOString() }] }] }] }));
}

export async function composerFixture(env: NodeJS.ProcessEnv, ports: string, sends: string[], route = "/__composer-redesign.html") {
  const server = await launchVerificationServer({ ...process.env, OMB_TEST_PORTS: ports, ...env }, undefined, undefined, undefined, undefined, undefined, ["codex"]);
  const api = fixtureApi(server.info.url);
  await api("PATCH", "/api/config", { language: "en" });
  const pepper = (await runControlOmb(["new-bot", "--name", "Pepper", "--url", server.info.url]) as { bot: { id: string } }).bot;
  for (const text of sends) {
    await runControlOmb(["send", "--bot", pepper.id, "--text", text, "--url", server.info.url]);
    await runControlOmb(["wait", "--bot", pepper.id, "--timeout", "60", "--url", server.info.url]);
  }
  const preview = await mountPreview(server, {
    entry: "/scripts/testing/threads-preview.tsx", route, title: "Isolated composer", logLevel: "warn",
    extraRoutes: [{ path: "/api/plan-usage", method: "GET", handler: planUsage }],
  });
  return { server, preview, api, pepper };
}

export async function openChat(browser: Browser, url: string, theme: Theme, size: Size, errors: string[], init?: () => void) {
  const context = await browser.newContext({ viewport: size, colorScheme: theme.scheme, deviceScaleFactor: size.width < 768 ? 2 : 1 });
  await context.addInitScript((skin) => {
    try { localStorage.setItem("omb-skin", skin); } catch { /* storage blocked */ }
  }, theme.skin);
  if (init) await context.addInitScript(init);
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

export function shooter(page: Page, theme: Theme, size: Size, evidence: Evidence) {
  return async (state: string, clip?: { x: number; y: number; width: number; height: number }) => {
    await page.waitForTimeout(350);
    const file = join(evidence.dir, `${theme.id}-${size.width}-${state}.png`);
    await page.screenshot({ path: file, clip });
    evidence.screenshots.push(file.slice(REPO_ROOT.length + 1).replaceAll("\\", "/"));
    evidence.checks[`${theme.id}-${size.width}-${state}-overflowPx`] = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  };
}

export async function within(page: Page, selector: string) {
  return page.locator(selector).first().evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: Math.round(rect.left), right: Math.round(rect.right), top: Math.round(rect.top), bottom: Math.round(rect.bottom), inside: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight };
  });
}
