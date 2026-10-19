import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function check(previewUrl, out, stage) {
  const base = new URL(previewUrl);
  assert.equal(base.hostname, "127.0.0.1");
  assert.ok(![5199, 8799, 3210, 5173, 5174, 5175, 5176].includes(Number(base.port)));
  assert.equal(base.pathname, "/__origin-flat-dialogs.html");
  const response = await fetch(base);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.ok(html.includes("Origin flat dialog verification") && html.includes("/__origin-flat-dialogs-entry.tsx"));
  const { chromium } = await import(pathToFileURL(resolve("site/node_modules/playwright/index.mjs")).href);
  const browser = await chromium.launch({ headless: true });
  const result = { marker: "origin-flat-dialogs-031", stage, checkedAt: new Date().toISOString(), synthetic: true, actualComponents: ["AboutDialog", "ConfirmDialog", "FilesView"], cases: [], pageErrors: [], externalRequestsBlocked: [], nativeOrPackagedAcceptance: false };
  const save = () => writeFile(resolve(out, "results.json"), JSON.stringify(result, null, 2) + "\n");
  const focusInside = page => page.evaluate(() => [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].some(el => el.contains(document.activeElement)));
  try {
    for (const theme of ["dark", "light"]) for (const [size, viewport] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 375, height: 812 }]]) {
      const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
      await context.route("**/*", route => {
        const url = new URL(route.request().url());
        if (url.origin === base.origin || ["data:", "blob:"].includes(url.protocol)) return route.continue();
        result.externalRequestsBlocked.push({ origin: url.origin, pathname: url.pathname });
        return route.abort();
      });
      const page = await context.newPage();
      page.on("pageerror", error => result.pageErrors.push(error.message));
      for (const screen of ["about", "confirm-neutral", "confirm-danger", "confirm-pending", "files-refusal", "files-suggest", "files-menu"]) {
        const url = new URL(base); url.search = new URLSearchParams({ screen, theme });
        await page.goto(url.href);
        await page.locator('[data-flat-dialog-fixture="origin-flat-dialogs-031"]').waitFor();
        assert.equal(await page.title(), "Origin flat dialog verification");
        await page.locator("[data-fixture-opener]").click();
        if (screen === "files-refusal") await page.getByRole("button", { name: "Add a folder", exact: true }).click();
        if (screen === "files-menu") await page.getByRole("button", { name: "More for Project notes", exact: true }).click();
        const panel = page.locator(screen === "files-menu" ? '[role="menu"]' : screen.startsWith("confirm-") ? '[role="alertdialog"]' : '[role="dialog"]');
        await panel.waitFor();
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(180);
        const entry = { screen, theme, size, viewport, screenshot: `${screen}-${size}-${theme}.png`, geometry: await panel.evaluate(el => {
          const r = el.getBoundingClientRect(), s = getComputedStyle(el);
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height, documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, shadow: s.boxShadow, radius: s.borderTopLeftRadius, borderColor: s.borderColor, background: s.backgroundColor };
        }) };
        assert.ok(entry.geometry.left >= 0 && entry.geometry.right <= viewport.width, `${screen}: panel bounds`);
        assert.ok(entry.geometry.scrollWidth <= entry.geometry.clientWidth, `${screen}: panel overflow`);
        assert.equal(entry.geometry.documentWidth, viewport.width, `${screen}: document overflow`);
        assert.equal(entry.geometry.shadow === "none", stage === "after", `${screen}: source-qualified flat surface`);
        await page.screenshot({ path: resolve(out, entry.screenshot) });
        if (screen === "files-menu") {
          await page.keyboard.press("Escape");
          assert.equal(await panel.count(), 0);
          entry.escapeClosed = true;
        } else if (screen === "confirm-pending") {
          assert.equal(await panel.getAttribute("aria-busy"), "true");
          assert.equal(await panel.getByRole("button", { name: "Cancel", exact: true }).isDisabled(), true);
          await page.keyboard.press("Escape");
          await page.mouse.click(5, 5);
          assert.equal(await panel.count(), 1, "Pending operation survives Escape and outside click");
          entry.pendingAfterBackdropInside = await focusInside(page);
          await page.screenshot({ path: resolve(out, `${screen}-${size}-${theme}-backdrop.png`) });
          assert.equal(entry.pendingAfterBackdropInside, stage !== "before", "Pending backdrop focus regression is source-qualified");
          await page.evaluate(() => window.__flatDialogFixture.settlePending());
          await page.getByRole("button", { name: "Cancel", exact: true }).click();
          assert.equal(await panel.count(), 0);
          entry.pendingDismissalBlocked = true;
        } else {
          assert.equal(await focusInside(page), true, `${screen}: initial focus`);
          const controls = await panel.locator('button:not(:disabled), input:not(:disabled), [tabindex="0"]').count();
          for (let i = 0; i < controls + 2; i++) { await page.keyboard.press("Tab"); assert.equal(await focusInside(page), true, `${screen}: forward focus`); }
          for (let i = 0; i < controls + 2; i++) { await page.keyboard.press("Shift+Tab"); assert.equal(await focusInside(page), true, `${screen}: reverse focus`); }
          await page.keyboard.press("Escape");
          assert.equal(await panel.count(), 0);
          entry.keyboardContained = true; entry.escapeClosed = true;
        }
        if (!screen.startsWith("files-")) assert.equal(await page.locator("[data-fixture-opener]").evaluate(el => el === document.activeElement), true);
        result.cases.push(entry); await save();
        console.log(JSON.stringify({ stage, screen, theme, size, shadow: entry.geometry.shadow, radius: entry.geometry.radius }));
      }
      if (stage !== "before") {
        const url = new URL(base); url.search = new URLSearchParams({ screen: "confirm-danger", theme });
        await page.goto(url.href); await page.locator("[data-fixture-opener]").click();
        let panel = page.getByRole("alertdialog");
        await panel.getByRole("button", { name: "Remove folder", exact: true }).click();
        assert.equal(await panel.getAttribute("aria-busy"), "true");
        assert.equal(await panel.getByRole("button", { name: "Cancel", exact: true }).isDisabled(), true);
        await page.mouse.click(5, 5); await page.keyboard.press("Escape");
        assert.equal(await focusInside(page), true);
        assert.deepEqual(await page.evaluate(() => window.__flatDialogFixture.actions), ["confirm-synthetic-operation"]);
        await page.evaluate(() => window.__flatDialogFixture.settlePending());
        await panel.getByRole("button", { name: "Cancel", exact: true }).click();
        assert.equal(await panel.count(), 0);
        assert.equal(await page.locator("[data-fixture-opener]").evaluate(el => el === document.activeElement), true);
        url.search = new URLSearchParams({ screen: "confirm-nested", theme });
        await page.goto(url.href); await page.locator("[data-fixture-opener]").click();
        await page.getByRole("button", { name: "Open nested confirmation", exact: true }).click();
        panel = page.getByRole("alertdialog"); await panel.waitFor();
        assert.equal(await panel.getByRole("button", { name: "Cancel", exact: true }).evaluate(el => el === document.activeElement), true);
        await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab");
        assert.equal(await panel.evaluate(el => el.contains(document.activeElement)), true);
        await page.keyboard.press("Escape"); assert.equal(await panel.count(), 0);
        assert.equal(await page.getByRole("dialog", { name: "Outer confirmation fixture", exact: true }).count(), 1);
        assert.equal(await page.getByRole("button", { name: "Open nested confirmation", exact: true }).evaluate(el => el === document.activeElement), true);
        await page.keyboard.press("Escape");
        assert.equal(await page.getByRole("dialog").count(), 0);
        result.cases.push({ screen: "confirmation-submit-and-nested", theme, size, viewport, singleSubmit: true, pendingBackdropRetainedFocus: true, pendingEscapeBlocked: true, resolvedCancelRestoredOpener: true, nestedEscapeClosedOnlyInner: true, outerEscapeRestoredOpener: true });
      }
      await context.close();
    }
    assert.equal(result.cases.length, stage === "before" ? 28 : 32);
    assert.deepEqual(result.pageErrors, []);
    assert.deepEqual(result.externalRequestsBlocked, []);
    result.completedAt = new Date().toISOString(); await save(); return result;
  } finally { await browser.close(); }
}
