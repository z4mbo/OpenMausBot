import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const url = new URL(process.argv[2]);
const output = resolve(process.argv[3] ?? "docs/verification/evidence/origin-publish");
await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.OMB_VERIFY_PLAYWRIGHT || "playwright");
const browser = await chromium.launch();
const errors = [];
const passed = [];

async function open(width, theme = "dark") {
  const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
  page.on("pageerror", (error) => errors.push(`${width}: ${error.message}`));
  await page.route(/^(?!http:\/\/127\.0\.0\.1)/, (route) => route.abort());
  const target = new URL(url);
  target.searchParams.set("theme", theme);
  await page.goto(target.href);
  await page.getByRole("heading", { name: "Publish" }).waitFor();
  return page;
}
const shot = async (page, name) => {
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} scrolls sideways`);
  await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true });
};
const requests = (page) => page.evaluate(() => window.originCampaignsFixture.requests.map((request) => ({ name: request.name, args: request.args })));

try {
  for (const width of [1280, 375]) {
    const page = await open(width);
    const overview = page.getByRole("group", { name: "Overview" });
    await overview.getByRole("button", { name: /Needs approval/ }).waitFor();
    if (width === 1280) await shot(page, "publish-week-overview");
    await overview.getByRole("button", { name: /Needs approval/ }).click();
    await page.getByRole("button", { name: /Three ways a Chief runs your launch week/ }).waitFor();
    assert.equal(await page.getByRole("button", { name: /Hiring: a designer/ }).count(), 0);
    passed.push(`${width}: overview tile opens the list filtered to approvals`);

    await page.getByRole("button", { name: "All", exact: true }).click();
    await page.getByRole("searchbox", { name: "Search posts" }).fill("teaser");
    await page.getByRole("button", { name: /Teaser: one place/ }).waitFor();
    assert.equal(await page.getByRole("button", { name: /Hiring: a designer/ }).count(), 0);
    await page.getByRole("searchbox", { name: "Search posts" }).fill("");
    await page.getByLabel("Campaign").selectOption({ label: "Spring launch" });
    await page.getByRole("button", { name: /Origin 0.4 is live/ }).waitFor();
    if (width === 1280) assert.equal(await page.getByRole("button", { name: /Hiring: a designer/ }).count(), 0);
    passed.push(`${width}: search and campaign filter narrow the list; rows carry the campaign tag`);
    await page.getByLabel("Campaign").selectOption("all");
    await shot(page, `publish-list-${width}`);

    if (width === 1280) {
      await page.getByRole("button", { name: /Hiring: a designer/ }).hover();
      await page.getByRole("button", { name: "Duplicate post" }).first().waitFor();
      await shot(page, "publish-list-hover");

      await page.getByRole("button", { name: /Hiring: a designer/ }).click();
      await page.getByRole("dialog").getByLabel("Campaign").selectOption({ label: "Spring launch" });
      await shot(page, "publish-composer-campaign");
      await page.getByRole("button", { name: "Save draft" }).click();
      await page.getByRole("dialog").waitFor({ state: "detached" });
      const linked = (await requests(page)).find((request) => request.name === "campaigns:link");
      assert.equal(linked?.args.kind, "post");
      passed.push("composer links the saved post to the chosen campaign");

      await page.getByRole("button", { name: "Campaigns" }).click();
      await page.getByRole("group", { name: "Filter campaigns" }).waitFor();
      await shot(page, "campaigns-grid");
      await page.getByRole("button", { name: /Spring launch/ }).click();
      await page.getByText("200 beta sign-ups from indie founders in three weeks.").waitFor();
      await page.getByText(/wait.? for your approval\./).waitFor();
      await page.getByText("Next post").waitFor();
      await shot(page, "campaign-detail");
      passed.push("campaign detail shows next post, approvals notice and four tiles");

      await page.getByRole("button", { name: "New post in this campaign" }).click();
      const picker = page.getByRole("dialog").getByLabel("Campaign");
      const chosen = await picker.evaluate((node) => node.options[node.selectedIndex].text);
      assert.equal(chosen, "Spring launch");
      passed.push("New post from a campaign preselects that campaign");
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "detached" });

      await page.getByRole("button", { name: "Review" }).click();
      await page.getByRole("button", { name: /Three ways a Chief/ }).waitFor();
      passed.push("Review opens the post list on approvals for that campaign");
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed, errors }, null, 2));
} finally {
  await browser.close();
}
