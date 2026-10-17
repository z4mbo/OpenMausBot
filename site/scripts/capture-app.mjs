// Captures the landing page's product images from the real Origin desktop renderer, signed in to synthetic data.
//
// Never point this at your own app or account. Prepare a disposable setup first:
//   1. The local Convex dev deployment (backend/) on http://127.0.0.1:3210.
//   2. From site/:
//        node scripts/capture-app.mjs --seed fixture.json   creates an @example.test account, workspace, projects, issues
//      It prints the key of "Ship the Windows installer link", ORI-XXXX below.
//   3. In the repository root, an isolated fake-engine fixture with a scripted Developer reply naming that key:
//        FAKE_CLAUDE_REPLIES='["Done. I branched ori-xxxx from main, ..."]' \
//        FAKE_CLAUDE_TOOL_CALLS='[{"name":"Bash","input":{"command":"git checkout -b ori-xxxx"},"ok":true}, ...]' \
//        node --experimental-strip-types scripts/control-omb.ts launch
//      then its renderer on another port: OMB_PORT=<fixture port> npx vite --port 5299 --strictPort
//   4. ORIGIN_FIXTURE_URL=<fixture url> node scripts/capture-app.mjs fixture.json
//      removes the fixture's starter bot, finishes the welcome flow, hands the issue to the Developer and writes
//      public/landing
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import sharp from "sharp";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const app = process.env.ORIGIN_APP_URL || "http://127.0.0.1:5299";
const convexUrl = "http://127.0.0.1:3210";
const out = "public/landing";
const seeding = process.argv[2] === "--seed";
const fixturePath = seeding ? process.argv[3] : process.argv[2];
assert.ok(fixturePath, "usage: capture-app.mjs [--seed] fixture.json");
assert.match(new URL(app).hostname, /^(127\.0\.0\.1|localhost)$/);

if (seeding) {
  const client = new ConvexHttpClient(convexUrl);
  const ref = name => makeFunctionReference(name);
  const id = Date.now().toString(36);
  const email = `maya-${id}@example.test`;
  const account = await client.action(ref("auth:signup"), { email, password: `Landing-${randomBytes(9).toString("hex")}`, name: "Maya Chen", workspaceName: "Northwind", slug: `northwind-${id}` });
  const sessionToken = account.sessionToken;
  await client.mutation(ref("auth:updateProfile"), { sessionToken, username: "maya", name: "Maya Chen" })
    .catch(() => client.mutation(ref("auth:updateProfile"), { sessionToken, username: `maya-${id}`, name: "Maya Chen" }));
  const workspace = (await client.query(ref("workspaces:list"), { sessionToken })).find(w => w.slug === account.slug);
  const projects = {};
  for (const [name, description] of [["Website relaunch", "New marketing site and sign-up flow"], ["Mobile app", "iOS and Android companion"], ["Brand refresh", "Logo, type and voice"]]) {
    projects[name] = await client.mutation(ref("projects:create"), { sessionToken, teamId: workspace._id, name, description });
  }
  const { columns } = await client.query(ref("tasks:board"), { sessionToken, projectId: projects["Website relaunch"] });
  for (const [column, title, priority] of [[0, "Write the pricing page copy", "medium"], [0, "Research three competitor onboarding flows", "low"], [1, "Design the hero for the download page", "high"], [1, "Ship the Windows installer link", "high"], [2, "Sign-up form validation", "medium"], [2, "Set up analytics-free page metrics", "low"]]) {
    await client.mutation(ref("tasks:createTask"), { sessionToken, projectId: projects["Website relaunch"], columnId: columns[column]._id, title, priority, dueDate: "2026-10-24", assignedToEmail: email });
  }
  await writeFile(fixturePath, JSON.stringify({ email, sessionToken, workspace, projects }, null, 2));
  const board = await client.query(ref("tasks:board"), { sessionToken, projectId: projects["Website relaunch"] });
  const handed = board.tasks.find(task => task.title === "Ship the Windows installer link");
  console.log(`Seeded ${workspace.slug}; the Developer's issue is ORI-${handed._id.slice(-4).toUpperCase()}. Now launch the fixture and run the capture.`);
  process.exit(0);
}

const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
assert.ok(fixture.email.endsWith("@example.test"));
const fixtureServer = process.env.ORIGIN_FIXTURE_URL;
assert.ok(fixtureServer && /^http:\/\/127\.0\.0\.1:\d+$/.test(fixtureServer), "set ORIGIN_FIXTURE_URL to the control-omb launch url");
for (const bot of await (await fetch(`${fixtureServer}/api/bots`)).json().then(body => body.bots ?? body)) {
  if (bot.name === "Fixture Starter") await fetch(`${fixtureServer}/api/bots/${bot.id}`, { method: "DELETE", headers: { origin: fixtureServer } });
}
await mkdir(join(out, "avatars"), { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, colorScheme: "dark" });
  await context.addInitScript(token => { localStorage.setItem("origin-cloud-url", "http://127.0.0.1:3210"); localStorage.setItem("origin-cloud-session", token); }, fixture.sessionToken);
  const page = await context.newPage();
  const skipTour = async () => { for (const skip of await page.getByText("Skip tour", { exact: true }).all()) await skip.click().catch(() => {}); };
  const open = async () => {
    await page.goto(app);
    await page.getByText("Website relaunch", { exact: true }).first().waitFor({ timeout: 30_000 });
    const welcome = page.locator(".fixed.inset-0").getByRole("button", { name: "Continue", exact: true });
    for (let step = 0; step < 8 && await welcome.count(); step++) { await welcome.first().click(); await page.waitForTimeout(1200); }
    await page.waitForTimeout(1500);
    await skipTour();
    await page.getByRole("button", { name: "Website relaunch issues", exact: true }).click();
    await page.waitForTimeout(1500);
    await skipTour();
  };
  const tab = async name => { await page.locator("main").getByRole("button", { name, exact: true }).first().click(); await page.waitForTimeout(1500); };
  const save = async (name, crop) => {
    const png = await page.screenshot();
    await sharp(png).resize({ width: 1600 }).webp({ quality: 82 }).toFile(join(out, `${name}.webp`));
    await sharp(png).resize({ width: 960 }).webp({ quality: 80 }).toFile(join(out, `${name}-960.webp`));
    await sharp(png).extract(crop).resize({ width: 760 }).webp({ quality: 80 }).toFile(join(out, `${name}-crop.webp`));
  };
  await open();
  await tab("Issues");
  await save("issues", { left: 640, top: 270, width: 1380, height: 900 });
  await tab("Agents");
  const avatars = await page.evaluate(() => [...document.querySelectorAll("svg[role=img][aria-label]")].filter(svg => svg.querySelector("linearGradient")).map(svg => [svg.getAttribute("aria-label"), svg.outerHTML]));
  const wanted = { "Website relaunch": "chief", Researcher: "researcher", "Product Manager": "product-manager", Designer: "designer", Developer: "developer", Marketer: "marketer", Copywriter: "copywriter" };
  for (const [label, markup] of avatars) {
    if (!wanted[label]) continue;
    await writeFile(join(out, "avatars", `${wanted[label]}.svg`), markup.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ').replace(/ width="[^"]*" height="[^"]*"/, "").replace(/ style="opacity: 1;"/g, ""));
  }
  await page.locator("main").getByRole("button", { name: /^Developer\s+Developer/ }).click();
  await page.waitForTimeout(1500);
  if (!(await page.getByText("You're assigned issue", { exact: false }).count())) {
    await tab("Issues");
    await page.getByRole("button", { name: "Hand Ship the Windows installer link to an agent", exact: true }).click();
    await page.getByRole("dialog").getByText("Developer", { exact: true }).click();
    await page.getByText("This run", { exact: true }).waitFor({ timeout: 60_000 });
    await page.getByRole("button", { name: "Website relaunch issues", exact: true }).click();
    await page.waitForTimeout(1500);
    await tab("Agents");
    await page.locator("main").getByRole("button", { name: /^Developer\s+Developer/ }).click();
    await page.waitForTimeout(1500);
  }
  await page.getByText("This run", { exact: true }).waitFor();
  await save("run", { left: 556, top: 352, width: 1990, height: 1211 });
  console.log(`Captured the issues and run images plus ${Object.keys(wanted).length} avatars into ${out}`);
} finally { await browser.close(); }
