import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const url = new URL(process.argv[2] ?? "");
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, "/__origin-ship.html");
const output = resolve(process.argv[3] ?? "docs/verification/evidence/origin-ship");
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
  assert.equal(await page.title(), "Isolated Origin Ship");
  return page;
}

const capture = async (page, name) => {
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} scrolls sideways`);
  await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true });
};
const providerRequests = async (page) => page.evaluate(async () => (await fetch("/__origin-ship-requests.json")).json());
const card = (page, name) => page.locator(`article[aria-label="${name}"]`);
const ready = async (page) => {
  await page.getByRole("heading", { name: "Ship", exact: true }).waitFor();
  await card(page, "Web").locator("[data-deployment]").first().waitFor();
  await card(page, "Docs").locator("[data-deployment]").first().waitFor();
  await card(page, "Mobile build").locator("[data-deployment]").first().waitFor();
};

try {
  const page = await open(1280, "dark");
  await ready(page);
  const web = card(page, "Web");
  assert.equal(await web.getByText("Live", { exact: true }).count(), 1, "one live Vercel deployment");
  assert.equal(await web.locator('[data-deployment="dpl_prev"]').getByRole("button", { name: "Roll back" }).count(), 1, "an earlier production deployment can be rolled back to");
  assert.equal(await web.locator('[data-deployment="dpl_preview42"]').getByRole("button", { name: "Promote" }).count(), 1, "a preview can be promoted");
  assert.match(await web.textContent(), /launch\.fixture\.test/);
  await capture(page, "ship-1280-dark-targets");
  evidence.cases.push("1280 dark: three targets with live deployments, production address, per-deployment actions");

  await page.getByRole("button", { name: "Ask Atlas to ship" }).click();
  const sent = await page.evaluate(() => window.originShipDispatched.find((action) => action.type === "send"));
  assert.match(sent.text, /origin_release_draft \(deploy_target "Web", announce true\)/);
  evidence.cases.push("Ask Atlas to ship sends the Chief the release brief naming the Web target");

  await page.getByRole("button", { name: "Draft release" }).click();
  const draft = page.locator("article[data-ship-release]");
  await draft.waitFor();
  assert.equal(await draft.getByLabel("Tag").inputValue(), "v1.4.0", "a feature bumps v1.3.2 to v1.4.0");
  const notes = await draft.getByLabel("Notes").inputValue();
  assert.match(notes, /Dark mode for the dashboard \(#41\) by @ada/);
  assert.doesNotMatch(notes, /Released last week/, "pull requests merged before the last tag are left out");
  await draft.getByText("4 merged pull requests").click();
  await draft.getByLabel("Title (optional)").fill("Night shift");
  await draft.getByLabel("Deploy after release").selectOption({ label: "Web" });
  await draft.getByLabel("Draft an announcement in Broadcast").check();
  await capture(page, "ship-1280-dark-release-draft");
  await draft.getByRole("button", { name: "Approve & release" }).click();
  const steps = await draft.getByRole("group", { name: "Confirm release" }).textContent();
  assert.match(steps, /Tag v1\.4\.0 on GitHub.*Deploy Web to production.*Draft an announcement in Broadcast for approval/);
  await capture(page, "ship-1280-dark-release-confirm");
  await draft.getByRole("group", { name: "Confirm release" }).getByRole("button", { name: "Approve & release" }).click();
  await page.getByText(/Released v1\.4\.0\. Vercel is building main for production\. The announcement waits for approval in Broadcast\./).waitFor();
  await page.locator('section[aria-label="Releases"]').getByText("v1.4.0").waitFor();
  const requests = await providerRequests(page);
  const release = requests.find((request) => request.method === "POST" && request.path === "/github/repos/acme/launch/releases");
  assert.equal(release.body.tag_name, "v1.4.0");
  assert.equal(release.body.name, "Night shift");
  const deploy = requests.find((request) => request.method === "POST" && request.path.startsWith("/vercel/v13/deployments"));
  assert.equal(deploy.body.target, "production");
  assert.equal(deploy.auth, "Bearer fixture-vercel-token", "the member's own token goes only to the loopback provider");
  await web.locator('[data-deployment]').first().getByText("Building").waitFor({ timeout: 10_000 });
  await capture(page, "ship-1280-dark-released");
  evidence.cases.push("Draft release: v1.4.0 from 4 pull requests merged since v1.3.2; approving tags it on GitHub, deploys Web and drafts the Broadcast announcement");

  await page.getByRole("button", { name: "Review announcement" }).click();
  assert.equal(await page.getByTestId("navigation").getAttribute("data-section"), "broadcast");

  const docs = card(page, "Docs");
  await docs.locator('[data-deployment="cf-old"]').getByRole("button", { name: "Roll back" }).click();
  assert.match(await docs.getByRole("group", { name: "Confirm" }).textContent(), /Roll Docs back to this deployment \(4a0d9e2\)\?/);
  await docs.getByRole("group", { name: "Confirm" }).getByRole("button", { name: "Roll back" }).click();
  await docs.getByText("Cloudflare Pages is rolling production back to that deployment.").waitFor();
  await docs.locator('[data-deployment="cf-old"]').getByText("Live", { exact: true }).waitFor({ timeout: 10_000 });
  evidence.cases.push("Roll back on Cloudflare Pages asks first, then the older deployment serves production");

  const mobile = card(page, "Mobile build");
  await mobile.getByRole("button", { name: "Run workflow" }).click();
  await mobile.getByRole("group", { name: "Confirm" }).getByRole("button", { name: "Deploy" }).click();
  await mobile.getByText("GitHub Actions started mobile.yml on main.").waitFor();
  await mobile.locator("[data-deployment]").first().getByText("Building").waitFor({ timeout: 10_000 });
  const dispatched = (await providerRequests(page)).find((request) => request.path === "/github/repos/acme/launch/actions/workflows/mobile.yml/dispatches");
  assert.deepEqual(dispatched.body, { ref: "main" });
  evidence.cases.push("Run workflow dispatches mobile.yml on main and the new run shows as building");

  await web.locator("[data-deployment]").first().getByText("Live", { exact: true }).waitFor({ timeout: 20_000 });
  await mobile.locator("[data-deployment]").first().getByText("Ready", { exact: true }).waitFor({ timeout: 20_000 });
  await capture(page, "ship-1280-dark-live-polling");
  evidence.cases.push("Live polling: the release deployment turns Ready and Live, and the workflow run Ready, without a reload");
  await page.close();

  const chat = await open(1280, "dark", { card: "1" });
  const preview = chat.getByRole("link", { name: /Preview/ });
  await preview.waitFor();
  assert.equal(await preview.getAttribute("href"), "https://dpl-preview42.vercel.app");
  await chat.locator("section[data-origin-pull-request]").screenshot({ path: resolve(output, "ship-pr-card-preview.png") });
  evidence.cases.push("The pull request card in chat links its Vercel preview by PR number");
  await chat.close();

  const narrow = await open(375, "dark");
  await ready(narrow);
  await capture(narrow, "ship-375-dark");
  const narrowCard = await open(375, "dark", { card: "1" });
  await narrowCard.getByRole("link", { name: /Preview/ }).waitFor();
  await capture(narrowCard, "ship-375-dark-pr-card");
  evidence.cases.push("375 dark: page and PR card fit without sideways scrolling");
  await narrow.close();
  await narrowCard.close();

  const light = await open(1280, "light");
  await ready(light);
  await capture(light, "ship-1280-light");
  await light.close();

  const viewer = await open(1280, "dark", { viewer: "1" });
  await ready(viewer);
  for (const name of ["Add target", "Draft release", "Deploy", "Run workflow", "Roll back", "Promote", "Redeploy"]) {
    assert.equal(await viewer.getByRole("button", { name, exact: true }).count(), 0, `a viewer has no ${name}`);
  }
  await capture(viewer, "ship-1280-dark-viewer");
  evidence.cases.push("A viewer sees deployments and releases but no deploy, release or target controls");
  await viewer.close();
} finally {
  await writeFile(resolve(output, "report.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  await browser.close();
}
assert.deepEqual(evidence.pageErrors, []);
console.log(JSON.stringify(evidence, null, 2));
