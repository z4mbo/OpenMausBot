import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const base = new URL(process.argv[2] ?? "");
assert.equal(base.hostname, "127.0.0.1");
assert.equal(base.pathname, "/__origin-core.html");
const out = resolve("docs/verification/evidence/origin-core");
await mkdir(out, { recursive: true });
const { chromium } = await import(process.env.OMB_VERIFY_PLAYWRIGHT || "playwright");
const browser = await chromium.launch();
const evidence = { previewUrl: base.href, cases: [], pageErrors: [] };
const sections = ["General", "Appearance", "Remote access", "Model providers", "API keys", "Decision model", "Local VM", "Logins", "Usage", "Backups", "People", "Activity", "Experimental"];
try {
  for (const theme of ["midnight", "daylight"]) {
    for (const width of [375, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
      await context.addInitScript(theme => localStorage.setItem("omb-skin", theme), theme);
      const page = await context.newPage();
      page.on("pageerror", error => evidence.pageErrors.push(error.message));
      await page.route("**/*", route => {
        const url = new URL(route.request().url());
        return ["127.0.0.1", "localhost"].includes(url.hostname) || url.protocol === "data:" ? route.continue() : route.abort();
      });
      await page.goto(base.href);
      await page.getByRole("textbox", { name: /^Message / }).waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "chat overflow");
      await page.screenshot({ path: resolve(out, `chat-${theme}-${width}.png`) });
      const drawer = page.getByRole("button", { name: "Open bot list", exact: true });
      if (await drawer.isVisible()) await drawer.click();
      await page.getByRole("button", { name: "You", exact: true }).click();
      await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
      await dialog.waitFor();
      const mobilePicker = dialog.getByRole("combobox", { name: "Settings", exact: true });
      const labels = width < 640 ? await mobilePicker.locator("option").allTextContents() : await dialog.getByRole("navigation").getByRole("button").allTextContents();
      assert.ok(sections.filter(label => labels.includes(label)).length >= 10, "settings sections are reachable");
      for (const section of sections.filter(label => labels.includes(label))) {
        if (width < 640) await mobilePicker.selectOption({ label: section });
        else await dialog.getByRole("navigation").getByRole("button", { name: section, exact: true }).click();
        const geometry = await dialog.evaluate(el => ({ width: innerWidth, left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right, scrollWidth: document.documentElement.scrollWidth }));
        assert.ok(geometry.left >= -1 && geometry.right <= width + 1 && geometry.scrollWidth <= width, `settings ${section} overflow: ${JSON.stringify(geometry)}`);
        await page.screenshot({ path: resolve(out, `settings-${section.toLowerCase().replaceAll(" ", "-")}-${theme}-${width}.png`) });
        evidence.cases.push({ screen: "settings", section, theme, width, geometry });
      }
      await page.getByRole("button", { name: "Close settings", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      evidence.cases.push({ screen: "chat/sidebar/settings", theme, width, closed: true });
      await context.close();
    }
  }
  assert.deepEqual(evidence.pageErrors, []);
  await writeFile(resolve(out, "browser-checks.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ cases: evidence.cases.length, pageErrors: evidence.pageErrors }));
} finally { await browser.close(); }
