import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const url = new URL(process.argv[2] ?? "");
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, "/__origin-calls.html");
const before = process.argv.includes("--before");
const output = resolve("docs/verification/evidence/origin-calls");
await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.OMB_VERIFY_PLAYWRIGHT || "playwright");
const browser = await chromium.launch();
const evidence = { before, checkedAt: new Date().toISOString(), cases: [], pageErrors: [] };
try {
  for (const theme of ["dark", "light"]) {
    for (const [size, viewport] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 375, height: 812 }]]) {
      const page = await browser.newPage({ viewport });
      page.on("pageerror", (error) => evidence.pageErrors.push(error.message));
      const next = new URL(url);
      next.search = new URLSearchParams({ theme, blockedAudio: "1" });
      await page.goto(next.href);
      await page.getByRole("button", { name: /^(Start|Join) call$/ }).waitFor();
      await page.getByRole("button", { name: /^(Start|Join) call$/ }).click();
      const retry = page.locator('[aria-label="Play audio from Remote person"]');
      await retry.waitFor({ state: "attached", timeout: 5_000 }).catch(async (error) => {
        console.error(JSON.stringify({ pageErrors: evidence.pageErrors, text: await page.locator("body").innerText(), audio: await page.locator("audio").count() }));
        throw error;
      });
      await page.waitForTimeout(300);
      const visible = await retry.isVisible();
      assert.equal(visible, !before);
      await page.screenshot({ path: resolve(output, `autoplay-${before ? "before" : "after"}-${size}-${theme}.png`) });
      if (!before) {
        await retry.click();
        await retry.waitFor({ state: "detached" });
      }
      evidence.cases.push({ theme, size, retryExists: true, retryVisible: visible, retryDismissedAfterPlay: !before });
      await page.close();
    }
  }
  assert.deepEqual(evidence.pageErrors, []);
  await writeFile(resolve(output, `autoplay-${before ? "before" : "after"}.json`), JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence, null, 2));
} finally { await browser.close(); }
