import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const url = new URL(process.argv[2] ?? "");
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, "/__origin-pulse.html");
const output = resolve(process.argv[3] ?? "docs/verification/evidence/origin-pulse");
await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.OMB_VERIFY_PLAYWRIGHT || "playwright");
const browser = await chromium.launch();
const evidence = { checkedAt: new Date().toISOString(), previewUrl: url.href, cases: [], pageErrors: [] };

async function open(width, theme, query = {}) {
  const page = await browser.newPage({ viewport: { width, height: width < 600 ? 2400 : 900 }, reducedMotion: "reduce" });
  page.on("pageerror", (error) => evidence.pageErrors.push(`${width}-${theme}: ${error.message}`));
  await page.route(/^(?!http:\/\/127\.0\.0\.1)/, (route) => route.abort());
  const target = new URL(url);
  target.searchParams.set("theme", theme);
  for (const [key, value] of Object.entries(query)) target.searchParams.set(key, value);
  await page.goto(target.href);
  assert.equal(await page.title(), "Isolated Origin Pulse");
  return page;
}

const capture = async (page, name) => {
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} scrolls sideways`);
  await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true });
};
const nav = (page) => page.getByTestId("navigation").evaluate((node) => ({ rocket: node.dataset.rocket, apollo: node.dataset.apollo }));
const stat = (page, card, label) => page.getByRole("region", { name: card }).locator("dt", { hasText: new RegExp(`^${label}$`) }).locator("xpath=following-sibling::dd[1]").innerText();

try {
  for (const [width, theme] of [[1280, "dark"], [375, "dark"], [1280, "light"]]) {
    const tag = `${width}-${theme}`;
    const page = await open(width, theme);
    await page.getByRole("heading", { name: "Pulse" }).waitFor();
    await page.getByRole("region", { name: "Build" }).waitFor();
    assert.match(await page.getByRole("list", { name: "Journey: Sell" }).innerText(), /Plan[\s\S]*No Brief · 1 canvas[\s\S]*Sell[\s\S]*26 leads/);
    await page.getByRole("region", { name: "Next step" }).getByRole("heading", { name: "Posts live → follow up leads in Sales" }).waitFor();
    assert.match(await stat(page, "Launch", "Pages live"), /^2/);
    assert.match(await stat(page, "Sell", "Conversion"), /^15%/);
    assert.match(await page.getByRole("region", { name: "Team" }).innerText(), /\$71\.40 of \$120(?!\.)/);
    await page.getByRole("img", { name: /Page views per day: .* over 7 days/ }).waitFor();
    await page.getByLabel("Needs attention").getByRole("button", { name: "2 PRs waiting" }).waitFor();
    await capture(page, `project-7d-${tag}`);

    await page.getByRole("button", { name: "30d" }).click();
    await page.getByRole("img", { name: /Issues done per day: .* over 30 days/ }).waitFor();
    assert.match(await stat(page, "Build", "Done"), /^22/);
    await capture(page, `project-30d-${tag}`);
    evidence.cases.push({ tag, step: "project pulse: journey strip at Sell with its next step, Build, Launch, Sell and Team tiles from real Convex data, 7d and 30d ranges, attention chips" });

    if (width === 1280 && theme === "dark") {
      const bars = page.getByRole("img", { name: /Page views per day/ });
      const box = await bars.boundingBox();
      await page.mouse.move(box.x + box.width * 0.1, box.y + box.height / 2);
      const readout = await page.getByRole("region", { name: "Launch" }).locator("figcaption").first().innerText();
      assert.doesNotMatch(readout, /^Page views per day\s*$/);
      evidence.cases.push({ tag, step: `hovering a day shows its value: ${readout.replace(/\s+/g, " ")}` });

      await page.getByLabel("Needs attention").getByRole("button", { name: "2 PRs waiting" }).click();
      assert.equal((await nav(page)).rocket, "repo");
      await page.getByRole("region", { name: "Sell" }).getByRole("button", { name: "Sales" }).click();
      assert.equal((await nav(page)).rocket, "pipeline");
      await page.getByRole("list", { name: /^Journey:/ }).getByRole("button", { name: /Launch/ }).click();
      assert.equal((await nav(page)).rocket, "broadcast");
      evidence.cases.push({ tag, step: "attention chips, tile links and journey buttons open Repo, Sales and Broadcast" });
    }
    await page.close();

    const notes = await open(width, theme, { project: "notes" });
    await notes.getByRole("list", { name: "Journey: Plan" }).waitFor();
    await notes.getByRole("region", { name: "Next step" }).getByRole("heading", { name: "Write the Brief" }).waitFor();
    await notes.getByText("No issues outside Draft yet.").waitFor();
    await notes.getByText("No agent has run in this project yet.").waitFor();
    await capture(notes, `idea-${tag}`);
    evidence.cases.push({ tag, step: "a project with only an idea sits at Plan, its next step is the Brief, and each tile says what moves it on" });
    await notes.close();

    const org = await open(width, theme, { view: "workspace" });
    const rows = org.locator("[data-pulse-project]");
    await org.getByRole("heading", { name: "Pulse" }).waitFor();
    await org.locator("[data-pulse-project]").getByText("Budget reached").waitFor();
    await org.waitForFunction(() => document.querySelectorAll("[data-pulse-project] dl").length === 3);
    const names = await rows.locator("strong, button").allInnerTexts();
    assert.deepEqual(names.filter((name) => ["Apollo", "Rocket", "Notes"].includes(name)), ["Apollo", "Rocket", "Notes"], "projects with the most waiting come first");
    await capture(org, `workspace-${tag}`);
    evidence.cases.push({ tag, step: "workspace pulse on the Org page: one row per project, ordered by what needs attention (Apollo over budget with a failed run first)" });
    if (width === 1280 && theme === "dark") {
      await org.locator("[data-pulse-project]").getByRole("button", { name: "Apollo", exact: true }).click();
      assert.equal((await nav(org)).apollo, "pulse");
      assert.equal(await org.locator("[data-pulse-project]").getByRole("button", { name: "Notes", exact: true }).count(), 0, "a project with no Chief in this app is not a link");
      evidence.cases.push({ tag, step: "a project row opens that project's Pulse section" });
    }
    await org.close();
  }
  assert.deepEqual(evidence.pageErrors, []);
} finally {
  await writeFile(resolve(output, "report.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  await browser.close();
}
console.log(JSON.stringify({ ok: true, cases: evidence.cases.length, output }));
