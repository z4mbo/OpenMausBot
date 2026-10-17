import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const url = new URL(process.argv[2] ?? "");
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, "/__origin-ui.html");
assert.match(await (await fetch(url)).text(), /scripts\/testing\/origin-ui-preview\.tsx/);
const output = resolve("docs/verification/evidence/origin-ui");
await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.OMB_VERIFY_PLAYWRIGHT || "playwright");
const browser = await chromium.launch();
const evidence = { previewUrl: url.href, checkedAt: new Date().toISOString(), cases: [] };
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const show = async (screen, theme = "dark") => {
  const next = new URL(url);
  next.search = new URLSearchParams({ screen, theme }).toString();
  await page.goto(next.href);
};
const capture = (name) => page.screenshot({ path: resolve(output, `${name}.png`) });

try {
  for (const theme of ["dark", "light"]) {
    for (const [size, viewport] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 375, height: 812 }]]) {
      await page.setViewportSize(viewport);
      await show("issue", theme);
      await page.getByRole("button", { name: "Open issue", exact: true }).click();
      await page.waitForTimeout(200);
      await capture(`issue-after-${size}-${theme}`);
      const dateScheme = await page.getByRole("textbox", { name: "Due date" }).evaluate((node) => getComputedStyle(node).colorScheme);
      assert.equal(dateScheme, theme);
      for (const name of ["Status: Draft", "Priority: Medium", "Assignee: Fixture person"]) {
        await page.getByRole("button", { name, exact: true }).click();
        await page.waitForTimeout(200);
        const bounds = await page.getByRole("listbox").evaluate((node) => ({ left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right }));
        assert.ok(bounds.left >= 7 && bounds.right <= viewport.width - 7, JSON.stringify({ name, bounds, viewport }));
        await capture(`issue-${name.split(":")[0].toLowerCase()}-after-${size}-${theme}`);
        await page.keyboard.press("Escape");
        assert.equal(await page.getByRole("dialog").count(), 1);
      }
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "detached" });
      assert.equal(await page.getByRole("button", { name: "Open issue", exact: true }).evaluate((node) => document.activeElement === node), true);
      evidence.cases.push({ screen: "issue", size, theme, dateScheme, menusInViewport: true, escapeReturnsFocus: true });

      await show("modal", theme);
      await page.getByRole("button", { name: "Open modal", exact: true }).click();
      await page.waitForTimeout(200);
      await capture(`modal-after-${size}-${theme}`);
      await page.getByRole("button", { name: "Start saving", exact: true }).click();
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await page.waitForTimeout(200);
      const opacity = await page.getByRole("dialog").evaluate((node) => getComputedStyle(node).opacity);
      assert.equal(opacity, "1");
      await capture(`modal-busy-after-${size}-${theme}`);
      await page.getByRole("button", { name: "Finish saving", exact: true }).click();
      await page.getByRole("button", { name: "Open confirmation", exact: true }).click();
      await page.keyboard.press("Escape");
      await page.getByRole("dialog", { name: "Confirm asset", exact: true }).waitFor({ state: "detached" });
      assert.equal(await page.getByRole("dialog").count(), 1);
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "detached" });
      evidence.cases.push({ screen: "modal", size, theme, guardedCloseOpacity: opacity, nestedEscape: true });

      await show("whatsnew", theme);
      await page.getByRole("button", { name: /^What's new/ }).click();
      await page.getByRole("dialog", { name: "What's new", exact: true }).waitFor();
      await page.getByRole("heading", { name: "A safer, more consistent workspace", exact: true }).waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await capture(`whatsnew-after-${size}-${theme}`);
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "detached" });
      evidence.cases.push({ screen: "whatsnew", size, theme, currentRelease: true, escapeCloses: true });
    }
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await show("chat");
  const input = page.getByRole("combobox", { name: "Message", exact: true });
  await input.fill("First message");
  const sent = page.waitForResponse((response) => response.url().includes("/api/local-chat/messages") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await input.fill("Second draft");
  await capture("chat-after-pending");
  await sent;
  await page.getByRole("button", { name: "Send", exact: true }).waitFor({ state: "visible" });
  await page.waitForTimeout(100);
  assert.equal(await input.inputValue(), "Second draft");
  assert.equal(await page.getByRole("button", { name: "Send", exact: true }).isEnabled(), true);
  await capture("chat-after-finished");
  evidence.cases.push({ screen: "chat", newerDraft: await input.inputValue(), sendReenabled: true });

  await show("issue");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Open issue", exact: true }).click();
  const motion = await page.getByRole("dialog").evaluate((node) => getComputedStyle(node).animationName);
  assert.equal(motion, "none");
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  evidence.cases.push({ screen: "issue", reducedMotion: motion, dismissedImmediately: true });
  assert.deepEqual(errors, []);
  evidence.pageErrors = errors;
  await writeFile(resolve(output, "after-browser-checks.json"), JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await browser.close();
}
