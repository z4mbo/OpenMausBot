import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const url = new URL(process.argv[2] ?? "");
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, "/__origin-broadcast.html");
const output = resolve(process.argv[3] ?? "docs/verification/evidence/origin-broadcast");
await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.OMB_VERIFY_PLAYWRIGHT || "playwright");
const browser = await chromium.launch();
const evidence = { checkedAt: new Date().toISOString(), previewUrl: url.href, cases: [], pageErrors: [] };

async function open(width, theme, query = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
  page.on("pageerror", (error) => evidence.pageErrors.push(`${width}-${theme}: ${error.message}`));
  await page.route(/^(?!http:\/\/127\.0\.0\.1)/, (route) => route.abort());
  const target = new URL(url);
  target.searchParams.set("theme", theme);
  for (const [key, value] of Object.entries(query)) target.searchParams.set(key, value);
  await page.goto(target.href);
  assert.equal(await page.title(), "Isolated Origin Broadcast");
  await page.getByRole("heading", { name: "Broadcast" }).waitFor();
  return page;
}

const capture = async (page, name) => {
  await page.waitForTimeout(220);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} scrolls sideways`);
  await page.screenshot({ path: resolve(output, `${name}.png`) });
};
const requests = (page) => page.evaluate(() => window.originBroadcastFixture.requests.map((request) => request.name));

try {
  for (const [width, theme] of [[1280, "dark"], [1280, "light"], [375, "dark"]]) {
    const tag = `${width}-${theme}`;
    const page = await open(width, theme);

    await page.getByText("Meet the team behind Origin.").first().waitFor();
    await page.getByText("1 post waits for your approval").waitFor();
    await page.locator('button[title="Connect TikTok"]').waitFor();
    const missing = await page.locator('button[title^="Connect "]').evaluateAll((items) => items.map((item) => item.getAttribute("title")));
    assert.deepEqual(missing, ["Connect LinkedIn", "Connect Facebook", "Connect Instagram", "Connect TikTok"]);
    await capture(page, `week-${tag}`);
    await page.locator('button[title="Connect TikTok"]').click();
    assert.deepEqual(await page.evaluate(() => window.originBroadcastDispatched.at(-1)), { type: "toggleAppSettings", open: true, section: "integrations" });
    evidence.cases.push({ tag, step: "week view with scheduled, unscheduled, approval banner and connect chips" });

    await page.getByText("1 post waits for your approval").click();
    await page.getByRole("button", { name: "Approval", pressed: true }).waitFor();
    await capture(page, `list-approval-${tag}`);
    await page.getByRole("button", { name: /Origin 0\.3 is out/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByText("Echo drafted this post").waitFor();
    assert.equal(await dialog.getByRole("button", { name: /Publish now|Schedule/ }).count(), 0);
    await capture(page, `agent-draft-${tag}`);
    await dialog.getByRole("button", { name: "Approve" }).click();
    await dialog.waitFor({ state: "detached" });
    assert.deepEqual((await requests(page)).slice(-2), ["broadcast:save", "broadcast:approve"]);
    evidence.cases.push({ tag, step: "agent draft blocked until approved, then approved" });

    await page.getByRole("button", { name: "All", exact: true }).click();
    await page.getByRole("button", { name: /Origin 0\.3 is out/ }).click();
    await dialog.getByRole("button", { name: "Publish now" }).waitFor();
    assert.equal(await dialog.getByRole("button", { name: "Publish now" }).isDisabled(), false);
    await dialog.getByRole("button", { name: "Close" }).click();
    await dialog.waitFor({ state: "detached" });

    await page.getByRole("button", { name: "New post", exact: true }).click();
    await dialog.getByRole("button", { name: "X", exact: true }).click();
    await dialog.getByRole("button", { name: "Instagram" }).click();
    await dialog.getByRole("textbox", { name: "Post text" }).fill("Launch week starts now.");
    await dialog.getByText("Instagram needs an image or a video").waitFor();
    assert.equal(await dialog.getByRole("button", { name: "Publish now" }).isDisabled(), true);
    await dialog.getByText("Instagram is not connected on this computer.").waitFor();
    await dialog.getByRole("button", { name: "Media" }).click();
    await dialog.getByRole("button", { name: "Launch cover" }).click();
    await dialog.getByText("Instagram needs an image or a video").waitFor({ state: "detached" });
    await dialog.getByRole("tab", { name: /23\/280/ }).click();
    await dialog.getByRole("textbox", { name: "X text" }).fill("x".repeat(290));
    await dialog.getByText("X allows 280 characters; this is 290").waitFor();
    assert.equal(await dialog.getByRole("tab", { name: /290\/280/ }).locator(".text-danger").count(), 1);
    await capture(page, `composer-over-limit-${tag}`);
    await dialog.getByRole("button", { name: "Use the shared text" }).click();
    await dialog.getByText("X allows 280 characters").waitFor({ state: "detached" });
    const tomorrow = await page.evaluate(() => { const at = new Date(); at.setDate(at.getDate() + 1); at.setHours(12, 0, 0, 0); const pad = (n) => String(n).padStart(2, "0"); return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T12:00`; });
    await dialog.getByLabel("Publish at").fill(tomorrow);
    await capture(page, `composer-ready-${tag}`);
    await dialog.getByRole("button", { name: "Schedule" }).click();
    await dialog.waitFor({ state: "detached" });
    const sent = await page.evaluate(() => window.originBroadcastFixture.requests.slice(-2));
    assert.deepEqual(sent.map((request) => request.name), ["broadcast:save", "broadcast:schedule"]);
    assert.deepEqual(sent[0].args.variants, [{ channel: "x", text: "Launch week starts now." }, { channel: "instagram", text: "Launch week starts now." }]);
    assert.deepEqual(sent[0].args.assetIds, ["asset-cover"]);
    assert.equal(typeof sent[1].args.at, "number");
    await page.getByRole("button", { name: "Week", exact: true }).click();
    await page.getByText("Launch week starts now.").waitFor();
    await capture(page, `week-after-schedule-${tag}`);
    evidence.cases.push({ tag, step: "new post: live limits, missing media rule, media picker, schedule" });

    await page.getByRole("button", { name: "New post", exact: true }).click();
    await dialog.getByRole("button", { name: "TikTok" }).click();
    await dialog.getByRole("textbox", { name: "Post text" }).fill("Clip");
    await dialog.getByRole("button", { name: "Media" }).click();
    await dialog.getByRole("button", { name: "Team photo" }).click();
    await dialog.getByText("TikTok needs exactly one video").waitFor();
    await dialog.getByRole("button", { name: "Remove Team photo" }).click({ force: true });
    await dialog.getByRole("button", { name: "Studio teaser.mp4" }).click();
    await dialog.getByText("TikTok needs exactly one video").waitFor({ state: "detached" });
    assert.equal(await dialog.getByRole("button", { name: "Pitch deck.pdf" }).count(), 0);
    await dialog.getByRole("button", { name: "Save draft" }).click();
    await dialog.waitFor({ state: "detached" });
    evidence.cases.push({ tag, step: "TikTok needs one video; documents are not offered as media" });

    await page.getByRole("button", { name: "List", exact: true }).click();
    await page.getByRole("button", { name: "Failed", exact: true }).click();
    await page.getByRole("button", { name: /Behind the scenes/ }).click();
    await dialog.getByText("TikTok answered 401").waitFor();
    await capture(page, `failed-post-${tag}`);
    await dialog.getByRole("button", { name: "Close" }).click();
    evidence.cases.push({ tag, step: "failed post shows the channel's error" });
    await page.close();
  }

  const viewer = await open(1280, "dark", { viewer: "1" });
  assert.equal(await viewer.getByRole("button", { name: "New post", exact: true }).count(), 0);
  await viewer.getByRole("button", { name: /Meet the team/ }).first().click();
  assert.equal(await viewer.getByRole("button", { name: "Save draft" }).count(), 0);
  await capture(viewer, "viewer-1280-dark");
  evidence.cases.push({ tag: "viewer", step: "viewer sees posts read-only" });
  await viewer.close();
} finally {
  await browser.close();
  await writeFile(resolve(output, "checks.json"), `${JSON.stringify(evidence, null, 2)}\n`);
}
assert.deepEqual(evidence.pageErrors, []);
console.log(`${evidence.cases.length} cases passed; evidence in ${output}`);
