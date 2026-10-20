import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const url = new URL(process.argv[2] ?? "");
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, "/__origin-journey.html");
const output = resolve(process.argv[3] ?? "docs/verification/evidence/origin-journey");
await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.OMB_VERIFY_PLAYWRIGHT || "playwright");
const browser = await chromium.launch();
const evidence = { checkedAt: new Date().toISOString(), previewUrl: url.href, cases: [], pageErrors: [] };

async function open(width, theme, project, section, context) {
  const page = await context.newPage();
  page.on("pageerror", (error) => evidence.pageErrors.push(`${width}-${theme}: ${error.message}`));
  await page.route(/^(?!http:\/\/127\.0\.0\.1)/, (route) => route.abort());
  const target = new URL(url);
  for (const [key, value] of Object.entries({ theme, project, section })) target.searchParams.set(key, value);
  await page.goto(target.href);
  assert.equal(await page.title(), "Isolated Origin journey");
  return page;
}

const sent = async (page) => Number(await page.getByTestId("navigation").getAttribute("data-sent"));
const strip = (page) => page.getByRole("region", { name: "Next step" });
const phase = (page, name) => page.getByRole("group", { name: "Phases" }).locator(`[data-project-phase="${name}"]`);
const capture = async (page, name) => {
  await page.waitForTimeout(250);
  const width = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }));
  assert.ok(width.document <= width.viewport, `${name} scrolls sideways: ${JSON.stringify(width)}`);
  await page.screenshot({ path: resolve(output, `${name}.png`) });
};
const waitSection = async (page, id) => { await page.waitForFunction((want) => document.querySelector("[data-testid=navigation]")?.getAttribute("data-section") === want, id); };

async function openTab(page, id, label) {
  const tab = page.locator(`[data-chief-sections] [data-chief-section="${id}"]`);
  if (await tab.isVisible()) await tab.click();
  else {
    await page.getByRole("button", { name: /^More sections/ }).click();
    await page.getByRole("menuitem", { name: label, exact: true }).click();
  }
  await waitSection(page, id);
}

try {
  for (const [width, theme] of [[1280, "dark"], [1280, "light"], [375, "dark"], [375, "light"]]) {
    const tag = `${width}-${theme}`;
    const context = await browser.newContext({ viewport: { width, height: width < 600 ? 812 : 860 }, reducedMotion: theme === "light" ? "reduce" : "no-preference" });

    const seed = await open(width, theme, "seed", "docs", context);
    await strip(seed).getByText("Write the Brief").waitFor();
    assert.equal(await phase(seed, "plan").getAttribute("aria-current"), "true");
    await capture(seed, `after-seed-docs-${tag}`);
    await strip(seed).getByRole("button", { name: "Hand this step to Seed" }).click();
    await waitSection(seed, "chat");
    assert.equal(await sent(seed), 1, "handing the step to the Chief sends it one message");
    evidence.cases.push({ tag, step: "Seed with nothing made: Docs points to Write the Brief; Ask Seed sends the brief to the Chief and opens its chat" });
    await seed.close();

    const sketch = await open(width, theme, "sketch", "docs", context);
    await strip(sketch).getByText("Brief ready → sketch in Canvas").waitFor();
    await capture(sketch, `after-sketch-docs-${tag}`);
    await strip(sketch).getByRole("button", { name: "Open Canvas" }).click();
    await waitSection(sketch, "draw");
    await strip(sketch).getByText("Brief ready → sketch in Canvas").waitFor();
    assert.equal(await strip(sketch).getByRole("button", { name: "Open Canvas" }).count(), 0, "on Canvas the step offers only the hand-off");
    evidence.cases.push({ tag, step: "Sketch with a Brief: Docs says Brief ready → sketch in Canvas and its one click opens Canvas" });
    await sketch.close();

    const forge = await open(width, theme, "forge", "pulse", context);
    await forge.getByRole("list", { name: "Journey: Build" }).waitFor();
    const card = forge.getByRole("region", { name: "Next step" });
    await card.getByRole("heading", { name: "Build the MVP · 3 issues open" }).waitFor();
    assert.match(await forge.getByRole("list", { name: "Journey: Build" }).innerText(), /Plan[\s\S]*Brief · 1 canvas[\s\S]*Build[\s\S]*3 open · 0 done/);
    assert.equal(await phase(forge, "plan").getAttribute("aria-label"), "Plan, done");
    assert.equal(await phase(forge, "build").getAttribute("aria-label"), "Build, next step");
    await capture(forge, `after-forge-pulse-${tag}`);
    await card.getByRole("button", { name: "Open Issues" }).click();
    await waitSection(forge, "issues");
    assert.equal(await phase(forge, "build").getAttribute("aria-current"), "true");
    await forge.getByRole("heading", { name: "Issues" }).waitFor();
    await capture(forge, `after-forge-issues-${tag}`);

    await phase(forge, "plan").click();
    await waitSection(forge, "chat");
    await strip(forge).getByText("Build the MVP · 3 issues open").waitFor();
    await capture(forge, `after-forge-chat-${tag}`);
    await openTab(forge, "draw", "Canvas");
    await phase(forge, "launch").click();
    await waitSection(forge, "studio");
    await openTab(forge, "assets", "Assets");
    await phase(forge, "sell").click();
    await waitSection(forge, "pipeline");
    assert.ok(await forge.locator('[data-chief-sections] [data-chief-section="pipeline"]').innerText().then((text) => text.includes("Sales")));
    await phase(forge, "build").click();
    await waitSection(forge, "issues");
    await phase(forge, "plan").click();
    await waitSection(forge, "draw");
    await phase(forge, "launch").click();
    await waitSection(forge, "assets");
    for (const [id, label] of [["vault", "Vault"], ["settings", "Settings"]]) {
      await forge.locator(`[data-chief-sections] [data-chief-section="${id}"]`).click();
      await waitSection(forge, id);
      assert.equal(await forge.getByRole("group", { name: "Sections" }).count(), 0, `${label} shows no phase tabs`);
    }
    await forge.locator('[data-chief-sections] [data-chief-section="pulse"]').click();
    await waitSection(forge, "pulse");
    evidence.cases.push({ tag, step: "Forge in Build: Pulse marks Plan done and Build next; the card opens Issues; each phase opens the section last seen in it, Sales sits in Sell, tools sit outside the phases" });

    for (const [phaseName, tabs] of [["plan", [["chat", "Chief"], ["team-chat", "Team"], ["call", "Call"], ["docs", "Docs"], ["draw", "Canvas"]]], ["build", [["issues", "Issues"], ["agents", "Agents"], ["repo", "Repo"], ["ship", "Ship"]]], ["launch", [["studio", "Studio"], ["broadcast", "Broadcast"], ["assets", "Assets"]]], ["sell", [["pipeline", "Sales"], ["feedback", "Feedback"]]]]) {
      await phase(forge, phaseName).click();
      for (const [id, label] of tabs) {
        await openTab(forge, id, label);
        if (width < 600 && id === "draw") await capture(forge, `after-forge-overflow-${tag}`);
      }
    }
    evidence.cases.push({ tag, step: "every section id still opens through its phase, with More holding the tabs that do not fit" });
    await forge.close();

    const rocket = await open(width, theme, "rocket", "broadcast", context);
    await strip(rocket).getByText("Posts live → follow up leads in Sales").waitFor();
    await strip(rocket).getByText("2 replies wait for an answer.").count();
    await capture(rocket, `after-rocket-broadcast-${tag}`);
    await strip(rocket).getByRole("button", { name: "Hide this step" }).click();
    await strip(rocket).waitFor({ state: "detached" });
    await rocket.reload();
    await rocket.getByRole("heading", { name: "Broadcast" }).waitFor();
    await rocket.waitForTimeout(1_000);
    assert.equal(await strip(rocket).count(), 0, "a hidden step stays hidden");
    await rocket.locator('[data-chief-sections] [data-chief-section="pulse"]').click();
    await rocket.getByRole("list", { name: "Journey: Sell" }).waitFor();
    await capture(rocket, `after-rocket-pulse-${tag}`);
    evidence.cases.push({ tag, step: "Rocket with posts live: Broadcast says Posts live → follow up leads in Sales; Hide keeps it hidden after a reload; Pulse shows Sell" });
    await rocket.close();
    await context.close();
  }
  assert.deepEqual(evidence.pageErrors, []);
} finally {
  await writeFile(resolve(output, "report.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  await browser.close();
}
console.log(JSON.stringify({ ok: true, cases: evidence.cases.length, output }));
