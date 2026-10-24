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
const cloud = await (await fetch(new URL("/__origin-cloud.json", url))).json();

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
    await page.getByText("Book a walk for today").waitFor();
    assert.equal(await page.getByRole("group", { name: "Milestones" }).count(), 0, "Issues shows no milestones");
    await capture(page, `issues-${width}`);
    evidence.cases.push({ width, step: "the Issues board lists the kickoff issues without a milestone strip" });
    await page.close();
  }

  for (const width of [1280, 375]) {
    const page = await open(width, { project: "empty" });
    await page.getByRole("button", { name: "New project" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Plan from an idea" }).count(), 0, "an empty project offers no Plan from an idea");
    assert.equal(await page.getByText("Start from an idea").count(), 0, "an empty project shows no Start from an idea banner");
    await capture(page, `empty-issues-${width}`);
    evidence.cases.push({ width, step: "an empty project's Issues shows no Start from an idea banner" });
    await page.close();
  }

  {
    const page = await open(1280, { project: "empty" });
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
    assert.doesNotMatch(kickoff.text, /Audience:/);
    assert.match(kickoff.text, /origin_create_issue/);
    assert.doesNotMatch(kickoff.text, /milestone/i);
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
