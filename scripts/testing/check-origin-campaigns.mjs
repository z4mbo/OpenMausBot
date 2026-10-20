import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const url = new URL(process.argv[2] ?? "");
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, "/__origin-campaigns.html");
const output = resolve(process.argv[3] ?? "docs/verification/evidence/origin-campaigns");
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
  assert.equal(await page.title(), "Isolated Origin Campaigns");
  await page.getByRole("heading", { name: "Broadcast" }).waitFor();
  await page.getByRole("button", { name: "Campaigns" }).click();
  await page.getByRole("button", { name: /Spring launch/ }).waitFor();
  return page;
}

const capture = async (page, name) => {
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} scrolls sideways`);
  await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true });
};
const nav = (page) => page.getByTestId("navigation").evaluate((node) => ({ section: node.dataset.section, issue: node.dataset.issue }));
const requests = (page) => page.evaluate(() => window.originCampaignsFixture.requests.map((request) => request.name));

try {
  for (const [width, theme] of [[1280, "dark"], [375, "dark"], [1280, "light"]]) {
    const tag = `${width}-${theme}`;
    const page = await open(width, theme);
    await page.getByRole("button", { name: /Black Friday/ }).waitFor();
    await capture(page, `campaigns-${tag}`);

    await page.getByRole("button", { name: /Spring launch/ }).click();
    await page.getByText("200 beta sign-ups from indie founders in three weeks.").waitFor();
    await page.getByRole("img", { name: "Hero shot of the app on a dark desk" }).waitFor();
    await page.getByRole("button", { name: /Landing page for the launch/ }).waitFor();
    await page.getByText("128", { exact: true }).waitFor();
    await page.getByText("LinkedIn numbers need an API review; only X and Bluesky are read here.").waitFor();
    await capture(page, `detail-${tag}`);
    evidence.cases.push({ tag, step: "campaign detail: brief, timeline with per-channel state and X numbers, content, issues" });

    await page.getByRole("button", { name: "Refresh metrics" }).click();
    await page.getByText("Connect X in Settings to read its numbers.").waitFor();
    evidence.cases.push({ tag, step: "refresh reaches the fixture server's metrics route, which reads the campaign from the backend and reports X is not connected" });

    await page.getByRole("button", { name: "Plan with Atlas" }).click();
    const sent = await page.evaluate(() => window.originCampaignsDispatched.find((action) => action.type === "send"));
    assert.equal(sent.botId, "fixture-chief");
    assert.match(sent.text, /Plan the "Spring launch" campaign in Fixture project/);
    assert.match(sent.text, /utm_campaign=spring-launch/);
    evidence.cases.push({ tag, step: "Plan with the Chief sends the brief into its chat" });

    await page.getByRole("button", { name: /Landing page for the launch/ }).click();
    assert.equal((await nav(page)).section, "issues");
    assert.notEqual((await nav(page)).issue, "");
    await page.getByRole("button", { name: "Hero shot of the app on a dark desk" }).click();
    assert.equal((await nav(page)).section, "studio");
    evidence.cases.push({ tag, step: "issue and content links open Issues (with the issue) and Studio" });

    await page.getByRole("button", { name: /Teaser: one place to launch/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    await dialog.getByRole("button", { name: "Close" }).click();
    await dialog.waitFor({ state: "detached" });
    evidence.cases.push({ tag, step: "a timeline post opens in the Broadcast composer" });

    if (tag === "1280-dark") {
      await page.getByRole("button", { name: "Link issues" }).click();
      await dialog.getByRole("button", { name: /Unrelated bug in settings/ }).click();
      await dialog.getByRole("button", { name: /Unrelated bug in settings/, pressed: true }).waitFor();
      await capture(page, `link-issues-${tag}`);
      await dialog.getByRole("button", { name: "Close" }).click();
      await page.getByRole("button", { name: /Unrelated bug in settings/ }).waitFor();
      await page.getByRole("button", { name: "Running", exact: true }).click();
      await page.getByRole("button", { name: "Running", pressed: true }).waitFor();
      assert.deepEqual((await requests(page)).slice(-2), ["campaigns:link", "campaigns:update"]);
      evidence.cases.push({ tag, step: "linking an issue and moving the campaign to Running write through the real backend" });

      await page.getByRole("button", { name: "All campaigns" }).click();
      await page.getByRole("button", { name: "New campaign" }).first().click();
      await dialog.getByLabel("Name").fill("Summer promo");
      await dialog.getByText("utm_campaign=summer-promo").waitFor();
      await dialog.getByLabel("Starts").fill("2026-12-10");
      await dialog.getByLabel("Ends").fill("2026-12-01");
      await dialog.getByText("The end date is before the start date").waitFor();
      assert.equal(await dialog.getByRole("button", { name: "Create" }).isDisabled(), true);
      await capture(page, `new-campaign-${tag}`);
      await dialog.getByLabel("Ends").fill("2026-12-24");
      await dialog.getByRole("button", { name: "X", exact: true }).click();
      await dialog.getByRole("button", { name: "Create" }).click();
      await dialog.waitFor({ state: "detached" });
      await page.getByRole("heading", { name: "Summer promo" }).waitFor();
      await page.getByText("No posts yet.", { exact: false }).waitFor();
      await capture(page, `empty-campaign-${tag}`);
      evidence.cases.push({ tag, step: "new campaign: utm preview, date order check, opens empty" });
    }
    await page.close();
  }

  const viewer = await open(1280, "dark", { viewer: "1" });
  assert.equal(await viewer.getByRole("button", { name: "New campaign" }).count(), 0);
  await viewer.getByRole("button", { name: /Spring launch/ }).click();
  await viewer.getByRole("button", { name: /Landing page for the launch/ }).waitFor();
  assert.equal(await viewer.getByRole("button", { name: /Plan with/ }).count(), 0);
  assert.equal(await viewer.getByRole("button", { name: /^Link / }).count(), 0);
  await capture(viewer, "viewer-1280-dark");
  evidence.cases.push({ tag: "viewer", step: "viewer reads a campaign without edit, link or plan controls" });
  await viewer.close();
} finally {
  await browser.close();
  await writeFile(resolve(output, "checks.json"), `${JSON.stringify(evidence, null, 2)}\n`);
}
assert.deepEqual(evidence.pageErrors, []);
console.log(`${evidence.cases.length} cases passed; evidence in ${output}`);
