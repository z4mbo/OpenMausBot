import assert from "node:assert/strict";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
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
  await page.route(/^(?!http:\/\/127\.0\.0\.1|blob:|data:)/, (route) => route.abort());
  const target = new URL(url);
  target.searchParams.set("theme", theme);
  for (const [key, value] of Object.entries(query)) target.searchParams.set(key, value);
  await page.goto(target.href);
  assert.equal(await page.title(), "Isolated Origin Broadcast");
  await page.getByRole("heading", { name: "Publish" }).waitFor();
  await page.evaluate(() => window.originBroadcastFixture.clipReady);
  return page;
}

const capture = async (page, name) => {
  await page.waitForTimeout(260);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} scrolls sideways`);
  await page.screenshot({ path: resolve(output, `${name}.png`) });
};
const requests = (page) => page.evaluate(() => window.originBroadcastFixture.requests.map((request) => request.name));
const lastRequests = (page, count) => page.evaluate((n) => window.originBroadcastFixture.requests.slice(-n), count);
const localDay = (page, offset) => page.evaluate((days) => { const at = new Date(); at.setDate(at.getDate() + days); return at.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" }); }, offset);

try {
  for (const [width, theme] of [[1280, "dark"], [1280, "light"], [375, "dark"], [375, "light"]]) {
    const tag = `${width}-${theme}`;
    const wide = width >= 1024;
    const page = await open(width, theme);
    const dialog = page.getByRole("dialog");

    await page.getByText("Meet the team behind Origin.").first().waitFor();
    await page.getByText("1 post waits for your approval").waitFor();
    const accounts = page.getByRole("group", { name: "Accounts" });
    await accounts.getByText("@origin.bsky.social").waitFor();
    assert.equal(await accounts.getByText("Founder").count(), 2);
    assert.deepEqual(await accounts.locator('button[title^="Connect "]').evaluateAll((items) => items.map((item) => item.getAttribute("title"))), ["Connect LinkedIn"]);
    await capture(page, `week-${tag}`);
    await accounts.getByRole("button", { name: "Connect LinkedIn" }).click();
    assert.deepEqual(await page.evaluate(() => window.originBroadcastDispatched.at(-1)), { type: "toggleAppSettings", open: true, section: "integrations" });
    evidence.cases.push({ tag, step: "week view with media thumbnails, accounts strip (two Founder accounts, LinkedIn to connect) and the approval pill" });

    await page.getByText("1 post waits for your approval").click();
    await page.getByRole("button", { name: "Approval", pressed: true }).waitFor();
    await page.getByRole("button", { name: /Origin 0\.6 is out/ }).click();
    await dialog.getByText("Echo drafted this post").waitFor();
    assert.equal(await dialog.getByRole("button", { name: /Publish now|Schedule/ }).count(), 0);
    await capture(page, `agent-draft-${tag}`);
    await dialog.getByRole("button", { name: "Approve" }).click();
    await dialog.waitFor({ state: "detached" });
    assert.deepEqual((await requests(page)).slice(-2), ["broadcast:save", "broadcast:approve"]);
    evidence.cases.push({ tag, step: "agent draft blocked until approved, then approved" });

    await page.getByRole("button", { name: "All", exact: true }).click();
    if (wide) await page.getByLabel("Engagement").first().waitFor();
    await page.getByRole("button", { name: "New post", exact: true }).click();
    await dialog.getByRole("button", { name: "X", exact: true }).click();
    await dialog.getByRole("button", { name: "LinkedIn", exact: true }).click();
    await dialog.getByRole("button", { name: "Instagram", exact: true }).click();
    await dialog.getByRole("textbox", { name: "Post text" }).fill("Pulse puts every project's numbers on one page. We use it every Monday to decide what ships next, and the agents draft the follow-ups for us. https://origin.test/pulse");
    await dialog.getByText("Instagram needs an image or a video").first().waitFor();
    assert.equal(await dialog.getByRole("button", { name: "Publish now" }).isDisabled(), true);
    await dialog.getByRole("group", { name: "Post as" }).getByRole("button", { name: "Connect LinkedIn" }).waitFor();
    await dialog.getByLabel("X account").selectOption({ label: "Founder" });
    await dialog.getByLabel("Add hashtag").fill("buildinpublic");
    await dialog.getByLabel("Add hashtag").press("Enter");
    await dialog.getByRole("button", { name: "Remove #buildinpublic" }).waitFor();
    await dialog.getByRole("button", { name: "Media" }).click();
    await dialog.getByRole("button", { name: "Pulse dashboard" }).click();
    await dialog.getByRole("button", { name: "Media" }).click();
    await dialog.getByText("Instagram needs an image or a video").waitFor({ state: "detached" });
    const preview = dialog.getByRole("complementary", { name: "Preview" });
    await preview.locator('[data-post-preview="x"]').getByText("Founder").waitFor();
    await preview.getByRole("tab", { name: "Preview on LinkedIn" }).click();
    await preview.locator('[data-post-preview="linkedin"]').getByText("more", { exact: false }).first().waitFor();
    await preview.getByRole("tab", { name: "Preview on Instagram" }).click();
    await preview.locator('[data-post-preview="instagram"] img').first().waitFor();
    await capture(page, `composer-preview-${tag}`);
    await dialog.getByRole("tab", { name: /\/280/ }).click();
    await dialog.getByRole("textbox", { name: "X text" }).fill("x".repeat(290));
    await dialog.getByText("X allows 280 characters; this is 290").waitFor();
    await capture(page, `composer-over-limit-${tag}`);
    await dialog.getByRole("button", { name: "Use the shared text" }).click();
    await dialog.getByText("X allows 280 characters").waitFor({ state: "detached" });
    const best = dialog.getByRole("group", { name: "Your best times" });
    await best.getByRole("button").first().click();
    assert.match(await dialog.getByLabel("Publish at").inputValue(), /T09:00$/);
    await capture(page, `composer-ready-${tag}`);
    await dialog.getByRole("button", { name: "Schedule" }).click();
    await dialog.waitFor({ state: "detached" });
    const sent = await lastRequests(page, 2);
    assert.deepEqual(sent.map((request) => request.name), ["broadcast:save", "broadcast:schedule"]);
    const text = "Pulse puts every project's numbers on one page. We use it every Monday to decide what ships next, and the agents draft the follow-ups for us. https://origin.test/pulse\n\n#buildinpublic";
    assert.deepEqual(sent[0].args.variants, [
      { channel: "x", text, accountId: "acct-founder-x", accountLabel: "Founder" }, { channel: "linkedin", text }, { channel: "instagram", text },
    ]);
    assert.deepEqual(sent[0].args.assetIds, ["asset-dashboard"]);
    assert.equal(sent[0].args.format, "post");
    assert.equal(new Date(sent[1].args.at).getHours(), 9);
    evidence.cases.push({ tag, step: "post composer: per-account choice, hashtags, platform previews, limits, best time from measured X posts, schedule" });

    await page.getByRole("button", { name: "New reel" }).click();
    assert.equal(await dialog.getByRole("button", { name: "Bluesky", exact: true }).isDisabled(), true);
    await dialog.getByRole("button", { name: "Instagram", exact: true }).click();
    await dialog.getByRole("button", { name: "TikTok", exact: true }).click();
    await dialog.getByRole("textbox", { name: "Post text" }).fill("From idea to launch in four scenes");
    await dialog.getByText("A reel is exactly one video").waitFor();
    await dialog.getByRole("button", { name: "Product reel.webm" }).click();
    await dialog.getByText("A reel is exactly one video").waitFor({ state: "detached" });
    await dialog.getByRole("button", { name: /^Cover at 2\.\d seconds$/ }).first().waitFor();
    await dialog.getByRole("button", { name: /^Cover at 2\.\d seconds$/ }).first().click();
    await dialog.getByLabel("Music").fill("Nightcall · Kavinsky");
    await preview.getByRole("img", { name: "Instagram safe zone" }).waitFor();
    await preview.getByText("Nightcall · Kavinsky").waitFor();
    await capture(page, `reel-editor-${tag}`);
    await preview.getByRole("tab", { name: "Preview on TikTok" }).click();
    await preview.getByRole("img", { name: "TikTok safe zone" }).waitFor();
    await preview.getByRole("button", { name: "Safe zones" }).click();
    assert.equal(await preview.getByRole("img", { name: "TikTok safe zone" }).count(), 0);
    await dialog.getByRole("button", { name: "Save draft" }).click();
    await dialog.waitFor({ state: "detached" });
    const [reel] = await lastRequests(page, 1);
    assert.equal(reel.name, "broadcast:save");
    assert.equal(reel.args.format, "reel");
    assert.deepEqual(reel.args.assetIds, ["asset-reel"]);
    assert.ok(reel.args.reel.coverMs >= 2000 && reel.args.reel.coverMs < 3000, `cover at ${reel.args.reel.coverMs}`);
    assert.equal(reel.args.reel.music, "Nightcall · Kavinsky");
    assert.deepEqual(reel.args.variants.map((variant) => variant.channel), ["instagram", "tiktok"]);
    evidence.cases.push({ tag, step: "reel: Studio video, cover frame, music, Instagram and TikTok 9:16 previews with safe zones" });

    await page.getByRole("button", { name: "Month", exact: true }).click();
    await page.getByRole("grid", { name: "Month" }).waitFor();
    const tomorrow = await localDay(page, 1);
    const later = await localDay(page, 2);
    const from = page.getByRole("gridcell", { name: tomorrow, exact: true });
    if (!(await from.count())) await page.getByRole("button", { name: "Next month" }).click();
    if (wide) {
      await capture(page, `month-${tag}`);
      const chip = page.getByRole("gridcell", { name: tomorrow, exact: true }).locator('[data-post="post-scheduled"]');
      await chip.dragTo(page.getByRole("gridcell", { name: later, exact: true }));
      await page.getByRole("gridcell", { name: later, exact: true }).locator('[data-post="post-scheduled"]').waitFor();
      const [moved] = await lastRequests(page, 1);
      assert.equal(moved.name, "broadcast:reschedule");
      assert.equal(moved.args.postId, "post-scheduled");
      const at = new Date(moved.args.at);
      assert.equal(at.getHours(), 10);
      assert.equal(at.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" }), later);
      await capture(page, `month-after-drag-${tag}`);
      evidence.cases.push({ tag, step: "month calendar: drag a scheduled post to another day; it keeps 10:00" });
    } else {
      await page.getByRole("gridcell", { name: tomorrow, exact: true }).click();
      await page.getByRole("region", { name: tomorrow, exact: true }).getByText("Meet the team behind Origin.").waitFor();
      await capture(page, `month-${tag}`);
      evidence.cases.push({ tag, step: "month calendar on a phone: dots per day, tap for the day's posts" });
    }

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

  for (const [from, to] of [["week-1280-dark", "round5-week"], ["month-1280-dark", "round5-month"], ["composer-preview-1280-dark", "round5-composer-preview"],
    ["reel-editor-1280-dark", "round5-reel-editor"], ["month-after-drag-1280-dark", "round5-month-drag"]]) {
    await copyFile(resolve(output, `${from}.png`), resolve(output, `${to}.png`));
  }
} finally {
  await browser.close();
  await writeFile(resolve(output, "checks.json"), `${JSON.stringify(evidence, null, 2)}\n`);
}
assert.deepEqual(evidence.pageErrors, []);
console.log(`${evidence.cases.length} cases passed; evidence in ${output}`);
