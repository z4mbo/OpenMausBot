import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const url = new URL(process.argv[2] ?? "");
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, "/__origin-launchpad.html");
const output = resolve(process.argv[3] ?? "docs/verification/evidence/origin-launchpad");
await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.OMB_VERIFY_PLAYWRIGHT || "playwright");
const browser = await chromium.launch();
const evidence = { checkedAt: new Date().toISOString(), previewUrl: url.href, cases: [], pageErrors: [] };
const config = await (await fetch(new URL("/__origin-launchpad.json", url))).json();
const cloud = await (await fetch(new URL("/__origin-campaigns.json", url))).json();

async function convex(kind, path, args) {
  const response = await fetch(`${config.url}/api/${kind}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, format: "convex_encoded_json", args: [{ sessionToken: cloud.token, ...args }] }) });
  const body = await response.json();
  assert.equal(body.status, "success", body.errorMessage);
  return body.value;
}
async function open(width, query = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
  page.on("pageerror", (error) => evidence.pageErrors.push(`${width}: ${error.message}`));
  await page.route(/^(?!http:\/\/127\.0\.0\.1)/, (route) => route.abort());
  const target = new URL(url);
  for (const [key, value] of Object.entries(query)) target.searchParams.set(key, value);
  await page.goto(target.href);
  assert.equal(await page.title(), "Isolated Origin Launchpad");
  return page;
}
const capture = async (page, name) => {
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} scrolls sideways`);
  await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true });
};
const sent = (page) => page.evaluate(() => window.originLaunchpadDispatched.filter((action) => action.type === "send").map((action) => ({ botId: action.botId, text: action.text })));

try {
  for (const width of [375, 1280]) {
    const page = await open(width);
    const strip = page.getByRole("group", { name: "Milestones" });
    await strip.getByRole("button", { name: /MVP.*1\/4/ }).waitFor();
    await strip.getByRole("button", { name: /Launch.*0\/2/ }).waitFor();
    await capture(page, `issues-${width}`);
    evidence.cases.push({ width, step: "milestones written by the Chief's origin_milestone_set show on the Issues strip with their progress" });

    if (width === 1280) {
      await strip.getByRole("button", { name: /MVP/ }).click();
      await page.getByRole("button", { name: /MVP.*1\/4/, pressed: true }).waitFor();
      await page.getByText("Book a walk for today").waitFor();
      assert.equal(await page.getByText("Pick a name for the push notifications").count(), 0, "the milestone filter hides other issues");
      await capture(page, "issues-mvp-1280");
      evidence.cases.push({ width, step: "a milestone on the strip filters Issues to it" });

      await page.getByRole("button", { name: "All issues" }).click();
      await page.getByText("Pick a name for the push notifications").click();
      const detail = page.getByRole("dialog");
      await detail.getByRole("button", { name: /Milestone/ }).click();
      await page.getByRole("option", { name: /Launch/ }).click();
      await page.getByRole("button", { name: /Launch.*0\/3/ }).waitFor();
      await capture(page, "issue-milestone-1280");
      await detail.getByRole("button", { name: "Close" }).first().click();
      evidence.cases.push({ width, step: "an issue's Milestone chip moves it into Launch; the strip's count follows" });

      await page.getByRole("button", { name: "Milestone", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "New milestone" });
      await dialog.getByLabel("Name").fill("Beta");
      await dialog.getByRole("button", { name: "Create" }).click();
      await page.getByRole("button", { name: /Beta.*0\/0/, pressed: true }).waitFor();
      evidence.cases.push({ width, step: "creating a milestone from Issues selects it" });
    }
    await page.close();
  }

  for (const width of [1280, 375]) {
    const page = await open(width, { project: "empty" });
    await page.locator("[data-launchpad-cta]").waitFor();
    await capture(page, `empty-issues-${width}`);
    await page.getByRole("button", { name: "Plan from an idea" }).click();
    const dialog = page.getByRole("dialog", { name: /Plan Empty idea from an idea/ });
    await dialog.getByLabel("Idea").fill("A marketplace that matches retired engineers with student hardware teams for weekly mentoring calls.");
    await dialog.getByLabel(/Audience/).fill("University robotics clubs in Europe");
    await capture(page, `launchpad-project-${width}`);
    await dialog.getByRole("button", { name: "Send to Atlas" }).click();
    const [kickoff] = await sent(page);
    assert.equal(kickoff.botId, "fixture-chief");
    assert.match(kickoff.text, /Kickoff for Empty idea/);
    assert.match(kickoff.text, /Audience:\nUniversity robotics clubs in Europe/);
    assert.doesNotMatch(kickoff.text, /Constraints:/);
    for (const tool of ["origin_milestone_set", "origin_create_issue"]) assert.match(kickoff.text, new RegExp(tool));
    evidence.cases.push({ width, step: "an empty project offers Launchpad; it sends the Chief the kickoff brief with only the fields given" });
    await page.close();
  }

  {
    const page = await open(1280, { project: "empty" });
    await page.locator("[data-launchpad-cta]").waitFor();
    await page.getByRole("button", { name: "New project" }).click();
    const dialog = page.getByRole("dialog", { name: "New project from an idea" });
    await dialog.getByLabel("Idea").fill("Habit tracker for students that turns study streaks into a shared class leaderboard.");
    await dialog.getByLabel(/Constraints/).fill("Two months, solo developer, React Native");
    assert.equal(await dialog.getByLabel("Project name").inputValue(), "Habit Tracker Students");
    await dialog.getByLabel("Project name").fill("Streaks");
    await dialog.getByRole("button", { name: /Everyone in the workspace/ }).click();
    await dialog.getByRole("radio", { name: "Later" }).check({ force: true });
    await capture(page, "launchpad-new-1280");
    await dialog.getByRole("button", { name: "Create and plan" }).click();
    await dialog.waitFor({ state: "detached", timeout: 30_000 });
    const actions = await page.evaluate(() => window.originLaunchpadDispatched.map((action) => action.type));
    assert.ok(actions.includes("botAdded"), `the Chief is created (${actions.join(", ")})`);
    const [kickoff] = await sent(page);
    assert.match(kickoff.text, /Kickoff for Streaks/);
    assert.match(kickoff.text, /Constraints:\nTwo months, solo developer, React Native/);
    const projects = await convex("query", "projects:listForUser", { teamId: config.teamId });
    assert.ok(projects.some((project) => project.name === "Streaks"), "the shared project exists in the backend");
    const bots = await page.evaluate(() => fetch("/api/bots").then((response) => response.json()));
    const chief = (bots.bots ?? bots).find((bot) => bot.name === "Streaks");
    assert.ok(chief, "the fixture server holds the new Chief");
    assert.equal(chief.title, "Project lead");
    const links = await page.evaluate(() => fetch("/api/origin/cloud-links").then((response) => response.json()));
    assert.equal(links.projects?.[chief.id], projects.find((project) => project.name === "Streaks")._id, "the Chief is linked to its project");
    evidence.cases.push({ width: 1280, step: "Launchpad creates the shared project (repository later), its Chief with the project-lead role on the fixture server, links them and sends the kickoff" });
    await page.close();

    const mobile = await open(375, {});
    await mobile.getByRole("button", { name: "New project" }).click();
    await mobile.getByRole("dialog", { name: "New project from an idea" }).getByLabel("Idea").fill("Pet sitter booking for weekends");
    await capture(mobile, "launchpad-new-375");
    await mobile.close();
  }

  assert.deepEqual(evidence.pageErrors, []);
} finally {
  await writeFile(resolve(output, "report.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  await browser.close();
}
console.log(JSON.stringify({ ok: true, cases: evidence.cases.length, output }));
