import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const base = new URL(process.argv[2] ?? "");
assert.equal(base.hostname, "127.0.0.1");
assert.equal(base.pathname, "/__origin-ui.html");
const phase = process.argv[3] ?? "after";
assert.ok(["before", "after"].includes(phase));
const output = resolve("docs/verification/evidence/origin-ui");
await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.OMB_VERIFY_PLAYWRIGHT || "playwright");
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const evidence = { previewUrl: base.href, phase, checkedAt: new Date().toISOString(), cases: [] };
await page.route("**/*", (route) => {
  const target = new URL(route.request().url());
  return ["127.0.0.1", "localhost"].includes(target.hostname) || target.protocol === "data:" ? route.continue() : route.abort();
});
try {
  for (const theme of ["dark", "light"]) for (const [size, viewport] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 375, height: 812 }]]) {
    await page.setViewportSize(viewport);
    for (const screen of ["assign", "connect", "members"]) {
      const url = new URL(base);
      url.search = new URLSearchParams({ screen, theme }).toString();
      await page.goto(url.href);
      let opener;
      if (screen === "members") {
        opener = page.getByRole("button", { name: "Switch workspace", exact: true });
        await opener.click();
        await page.getByRole("menuitem", { name: "Members & invites…", exact: true }).click();
      } else {
        opener = page.getByRole("button", { name: `Open ${screen}`, exact: true });
        await opener.click();
      }
      const dialog = page.getByRole("dialog").last();
      await dialog.waitFor();
      await page.waitForTimeout(250);
      const initialFocusInside = await dialog.evaluate((node) => node.contains(document.activeElement));
      await page.screenshot({ path: resolve(output, `${screen}-${phase}-${size}-${theme}.png`) });
      await page.keyboard.press("Shift+Tab");
      const reverseTabInside = await dialog.evaluate((node) => node.contains(document.activeElement));
      const bounds = await dialog.evaluate((node) => ({ left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right }));
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
      const escaped = await page.getByRole("dialog").count() === 0;
      const focusReturned = await opener.evaluate((node) => node === document.activeElement);
      const result = { screen, theme, size, initialFocusInside, reverseTabInside, escaped, focusReturned, bounds };
      evidence.cases.push(result);
      if (phase === "after") {
        assert.ok(initialFocusInside && reverseTabInside && escaped && focusReturned, JSON.stringify(result));
        assert.ok(bounds.left >= 0 && bounds.right <= viewport.width, JSON.stringify(result));
        if (screen === "assign") {
          await opener.click();
          await page.getByRole("dialog").getByRole("button").filter({ hasText: "Fixture developer" }).click();
          await page.getByRole("status").filter({ hasText: "Assigned to Fixture developer" }).waitFor();
          result.choosesAgent = true;
        }
        if (screen === "connect") {
          await opener.click();
          await page.getByRole("textbox", { name: "Email", exact: true }).fill("fixture@example.test");
          await page.getByLabel("Password", { exact: true }).fill("fixture-only-password");
          assert.equal(await page.getByRole("button", { name: "Sign in", exact: true }).isEnabled(), true);
          await page.keyboard.press("Escape");
          await page.getByRole("dialog").waitFor({ state: "detached" });
          result.signInFieldsEnableSubmit = true;
        }
        if (screen === "members") {
          await opener.click();
          await page.getByRole("menuitem", { name: "Members & invites…", exact: true }).click();
          await page.getByRole("button", { name: "Sign in to Origin", exact: true }).click();
          await page.getByRole("dialog", { name: "Origin account", exact: true }).waitFor();
          await page.keyboard.press("Escape");
          await page.getByRole("dialog", { name: "Origin account", exact: true }).waitFor({ state: "detached" });
          assert.equal(await page.getByRole("dialog", { name: "Members & invites", exact: true }).count(), 1);
          assert.equal(await page.getByRole("button", { name: "Sign in to Origin", exact: true }).evaluate((node) => document.activeElement === node), true);
          await page.keyboard.press("Escape");
          await page.getByRole("dialog").waitFor({ state: "detached" });
          result.nestedAccountDismissesAlone = true;
        }
      }
    }
  }
  assert.deepEqual(errors, []);
  evidence.pageErrors = errors;
  await writeFile(resolve(output, `dialogs-${phase}-browser-checks.json`), JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await browser.close();
}
