import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const url = new URL(process.argv[2] ?? "");
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, "/__origin-calls.html");
const output = resolve("docs/verification/evidence/origin-calls");
await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.OMB_VERIFY_PLAYWRIGHT || "playwright");
const browser = await chromium.launch();
const evidence = { previewUrl: url.href, checkedAt: new Date().toISOString(), cases: [], pageErrors: [] };
try {
  for (const theme of ["dark", "light"]) {
    for (const [size, viewport] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 375, height: 812 }]]) {
      const page = await browser.newPage({ viewport });
      page.on("pageerror", (error) => evidence.pageErrors.push(error.message));
      const next = new URL(url);
      next.searchParams.set("theme", theme);
      await page.goto(next.href);
      const capture = async (name) => {
        await page.waitForTimeout(250);
        await page.screenshot({ path: resolve(output, `${name}-${size}-${theme}.png`) });
      };
      await page.getByRole("button", { name: "Start call", exact: true }).waitFor();
      await capture("lobby");
      await page.getByRole("button", { name: "Start call", exact: true }).click();
      await page.getByRole("toolbar", { name: "Call controls" }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await capture("joined");
      await page.getByRole("button", { name: "People", exact: true }).click();
      await page.getByRole("complementary", { name: "People", exact: true }).waitFor();
      await capture("people");
      await page.getByRole("button", { name: "Close people", exact: true }).click();
      await page.getByRole("button", { name: "Call devices", exact: true }).click();
      await page.getByRole("region", { name: "Call devices", exact: true }).waitFor();
      await capture("devices");
      await page.getByRole("button", { name: "Close devices", exact: true }).click();
      await page.getByRole("button", { name: "Raise hand", exact: true }).click();
      assert.equal(await page.getByRole("button", { name: "Lower hand", exact: true }).getAttribute("aria-pressed"), "true");
      await page.getByRole("button", { name: "Reactions", exact: true }).click();
      await page.getByRole("menuitem", { name: "React 👍", exact: true }).click();
      await page.getByRole("button", { name: "Leave call", exact: true }).click();
      await page.getByRole("button", { name: "Second room", exact: true }).click();
      await page.getByRole("button", { name: /^(Start|Join) call$/ }).click();
      await page.getByRole("toolbar", { name: "Call controls" }).waitFor();
      await capture("replacement-before-old-leave");
      await page.getByRole("button", { name: "Release delayed leave", exact: true }).click();
      await page.getByRole("status", { name: "Fixture status", exact: true }).filter({ hasText: /^release$/ }).waitFor();
      assert.equal(await page.getByRole("toolbar", { name: "Call controls" }).count(), 1);
      assert.equal(await page.getByRole("heading", { name: "Second room", exact: true }).count(), 1);
      await capture("replacement-after-old-leave");
      await page.getByRole("button", { name: "Join from another device", exact: true }).click();
      await page.getByText("This call ended or was joined on another device. Join again to continue.", { exact: true }).waitFor({ timeout: 12_000 });
      assert.equal(await page.getByRole("toolbar", { name: "Call controls" }).count(), 0);
      await capture("replaced-on-another-device");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      evidence.cases.push({ theme, size, noPageOverflow: true, peopleAndDevices: true, reactionsAndRaisedHand: true, delayedOldLeavePreservesReplacement: true, replacedMachineStops: true });
      await page.close();
    }
  }
  assert.deepEqual(evidence.pageErrors, []);
  const response = await fetch(new URL("/__call-fixture/evidence", url));
  evidence.server = await response.json();
  await writeFile(resolve(output, "browser-checks.json"), JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await browser.close();
}
