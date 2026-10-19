import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const cards = ["Project notes", "Issue tracker", "Team calendar"].map((label, index) => ({ slug: `synthetic-${index}`, label, blurb: "Synthetic connection for isolated verification", logo: null, domain: null, categories: ["productivity"] }));
const responses = {
  "/api/connectors/connected": { services: {}, credentialStore: "available" },
  "/api/connectors/catalog": { cards, configured: true, mode: "self-hosted", source: "curated" },
  "/api/mcp/servers": { servers: [] },
  "/api/highlevel": { connected: false },
  "/api/tts/voices": { voices: [{ id: "synthetic-voice", label: "Synthetic voice" }] },
  "/api/about-me": { text: "" },
  "/api/profile": { name: "Fixture member", email: "fixture@example.invalid" },
  "/api/whop": { connected: false },
  "/api/profile/learned": { learned: [] },
  "/api/origin/projects-root": { root: "Fixture/Projects", chosen: false, suggestions: [{ label: "Fixture projects", path: "Fixture/Projects" }] },
  "/api/auth/session": { kind: "loopback" },
  "/api/origin/avatar-looks": { looks: {} },
};

export async function check(previewUrl, out, stage) {
  const base = new URL(previewUrl);
  assert.equal(base.hostname, "127.0.0.1");
  assert.ok(![5199, 8799, 3210].includes(Number(base.port)));
  const fixtureConfig = await (await fetch(new URL("/api/config", base))).json();
  const { chromium } = await import(pathToFileURL(resolve("site/node_modules/playwright/index.mjs")).href);
  const browser = await chromium.launch({ headless: true, args: ["--disable-gpu"] });
  const result = { marker: "origin-flat-popups-032", stage, checkedAt: new Date().toISOString(), synthetic: true, actualComponents: ["PluginsPanel", "SettingsModal", "TriggersPanel", "VoiceSetupDialog", "SidebarPopoverMenu"], cases: [], pageErrors: [], requests: [], unexpectedRequests: [], externalRequestsBlocked: [], nativeOrPackagedAcceptance: false };
  const save = () => writeFile(resolve(out, "results.json"), JSON.stringify(result, null, 2) + "\n");
  try {
    const probe = process.argv[4] === "voice-probe";
    for (const theme of probe ? ["dark"] : ["dark", "light"]) for (const [size, viewport] of (probe ? [["desktop", { width: 1280, height: 900 }]] : [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 375, height: 812 }]])) {
      const context = await browser.newContext({ viewport, reducedMotion: "no-preference" });
      await context.route("**/*", route => {
        const request = route.request(), url = new URL(request.url());
        if (["data:", "blob:"].includes(url.protocol)) return route.continue();
        if (url.origin !== base.origin) { result.externalRequestsBlocked.push({ origin: url.origin, pathname: url.pathname }); return route.abort(); }
        if (!url.pathname.startsWith("/api/")) return route.continue();
        result.requests.push({ method: request.method(), path: url.pathname });
        if (request.method() === "PUT" && url.pathname === "/api/config") return route.fulfill({ json: fixtureConfig });
        if (request.method() !== "GET" || !(url.pathname in responses)) { result.unexpectedRequests.push({ method: request.method(), path: url.pathname }); return route.fulfill({ status: 503, json: { error: "Unplanned synthetic fixture request" } }); }
        return route.fulfill({ json: responses[url.pathname] });
      });
      const page = await context.newPage();
      page.on("pageerror", error => { result.pageErrors.push(error.stack || error.message || String(error)); console.log(JSON.stringify({ fixturePageError: error.stack || error.message || String(error) })); });
      page.on("console", message => { if (message.type() === "error" || message.type() === "warning") console.log(JSON.stringify({ fixtureConsole: message.type(), text: message.text() })); });
      page.on("response", response => { if (response.status() >= 400) console.log(JSON.stringify({ fixtureResponse: response.status(), pathname: new URL(response.url()).pathname })); });
      for (const screen of probe ? ["voice"] : ["settings", "apps", "triggers", "voice", "menu-anchored", "menu-inline"]) {
        const url = new URL(base); url.search = new URLSearchParams({ screen, theme });
        await page.goto(url.href);
        await page.locator('[data-flat-popup-fixture="origin-flat-popups-032"]').waitFor();
        const menu = screen.startsWith("menu");
        if (menu) await page.getByRole("button", { name: "Workspace options", exact: true }).click();
        else await page.locator("[data-fixture-opener]").click();
        const panel = page.getByRole(menu ? "menu" : "dialog").first();
        await panel.waitFor(); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(280);
        if (screen === "apps") await page.getByText("Project notes", { exact: true }).first().waitFor();
        const entry = { screen, theme, size, viewport, reducedMotion: "no-preference", screenshot: `${screen}-${size}-${theme}.png`, geometry: await panel.evaluate(el => {
          const r = el.getBoundingClientRect(), s = getComputedStyle(el);
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height, documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, shadow: s.boxShadow, radius: s.borderTopLeftRadius, borderColor: s.borderColor, background: s.backgroundColor, backdrop: s.backdropFilter };
        }) };
        assert.ok(entry.geometry.left >= 0 && entry.geometry.right <= viewport.width, `${screen}: horizontal bounds`);
        assert.ok(entry.geometry.top >= 0 && entry.geometry.bottom <= viewport.height, `${screen}: vertical bounds`);
        assert.ok(entry.geometry.scrollWidth <= entry.geometry.clientWidth, `${screen}: panel overflow`);
        assert.equal(entry.geometry.documentWidth, viewport.width, `${screen}: document overflow`);
        assert.equal(entry.geometry.shadow === "none", stage === "after", `${screen}: source-qualified surface`);
        if (stage === "after") { assert.equal(entry.geometry.radius, "12px"); assert.equal(entry.geometry.backdrop, "none"); }
        await page.screenshot({ path: resolve(out, entry.screenshot) });
        entry.unchangedLayout = await page.evaluate(() => ({ fixtureHeaderGap: getComputedStyle(document.querySelector('main > header')).gap, layout: [...document.querySelectorAll('[role="dialog"] .grid')].map(el => ({ classes: el.className, display: getComputedStyle(el).display, columns: getComputedStyle(el).gridTemplateColumns, gap: getComputedStyle(el).gap })) }));
        if (menu) {
          await panel.getByRole("menuitem", { name: "Settings", exact: true }).focus();
          await page.keyboard.press("End");
          assert.equal(await panel.getByRole("menuitem", { name: "Appearance", exact: true }).evaluate(el => el === document.activeElement), true, "Disabled row is skipped");
          if (screen === "menu-anchored") {
            await page.keyboard.press("ArrowRight");
            const sub = page.getByRole("menu", { name: "Appearance", exact: true }); await sub.waitFor(); await page.waitForTimeout(220);
            entry.submenu = await sub.evaluate(el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, shadow: s.boxShadow, radius: s.borderTopLeftRadius }; });
            assert.ok(entry.submenu.left >= 0 && entry.submenu.right <= viewport.width);
            assert.equal(entry.submenu.shadow === "none", stage === "after");
            entry.submenuScreenshot = `${screen}-submenu-${size}-${theme}.png`;
            await page.screenshot({ path: resolve(out, entry.submenuScreenshot) });
            await sub.getByRole("menuitem", { name: "Light", exact: true }).focus();
            await page.keyboard.press("Escape"); assert.equal(await sub.count(), 0);
            assert.equal(await panel.getByRole("menuitem", { name: "Appearance", exact: true }).evaluate(el => el === document.activeElement), true);
            await page.keyboard.press("Tab");
          } else await page.keyboard.press("Escape");
          await panel.waitFor({ state: "detached" });
          entry.keyboardNavigation = true;
        } else {
          assert.equal(await panel.evaluate(el => el.contains(document.activeElement)), true, `${screen}: initial focus`);
          const count = await panel.locator('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]').count();
          for (let i = 0; i < count + 2; i++) {
            const previous = await page.evaluate(() => ({ html: document.activeElement?.outerHTML, hiddenDetails: [...document.querySelectorAll('details:not([open]) button')].map(el => ({ html: el.outerHTML, rects: el.getClientRects().length, visible: el.checkVisibility() })) }));
            await page.keyboard.press("Tab");
            const inside = await panel.evaluate(el => el.contains(document.activeElement));
            if (!inside) { await page.screenshot({ path: resolve(out, `${screen}-${size}-${theme}-focus-escape.png`) }); console.log(JSON.stringify({ focusEscape: { screen, theme, size, previous, current: await page.evaluate(() => document.activeElement?.outerHTML) } })); }
            assert.equal(inside, true, `${screen}: forward containment`);
          }
          for (let i = 0; i < count + 2; i++) { await page.keyboard.press("Shift+Tab"); assert.equal(await panel.evaluate(el => el.contains(document.activeElement)), true, `${screen}: reverse containment`); }
          await page.keyboard.press("Escape"); await panel.waitFor({ state: "detached" });
          assert.equal(await page.locator("[data-fixture-opener]").evaluate(el => el === document.activeElement), true, `${screen}: opener restoration`);
          entry.keyboardContained = true; entry.escapeAndFocusRestored = true;
        }
        result.cases.push(entry); await save(); console.log(JSON.stringify({ stage, screen, size, theme, shadow: entry.geometry.shadow }));
      }
      await context.close();
    }
    assert.equal(result.cases.length, probe ? 1 : 24);
    assert.deepEqual(result.pageErrors, []);
    assert.deepEqual(result.unexpectedRequests, []);
    assert.deepEqual(result.externalRequestsBlocked, []);
    result.completedAt = new Date().toISOString(); await save(); return result;
  } finally { await save(); await browser.close(); }
}
