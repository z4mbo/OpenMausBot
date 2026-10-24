import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const url = new URL(process.argv[2] ?? "");
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, "/__origin-integrations.html");
const output = resolve(process.argv[3] ?? "docs/verification/evidence/origin-integrations");
await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.OMB_VERIFY_PLAYWRIGHT || "playwright");
const browser = await chromium.launch();
const evidence = { checkedAt: new Date().toISOString(), previewUrl: url.href, cases: [], pageErrors: [], checkCalls: [] };

/** Each provider's answer to a key check, standing in for the vendor so nothing leaves this computer. */
const CHECKS = {
  netlify: { ok: false, detail: "Netlify rejected the key: Unauthorized" },
  vercel: { ok: true, account: "origin", detail: "Vercel accepted the key" },
};

async function open(width, theme) {
  const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: "reduce" });
  page.on("pageerror", (error) => evidence.pageErrors.push(`${width}-${theme}: ${error.message}`));
  await page.route(/^(?!http:\/\/127\.0\.0\.1|data:)/, (route) => route.abort());
  await page.route(/\/api\/integrations\/[a-z]+\/check$/, async (route) => {
    const id = /\/api\/integrations\/([a-z]+)\/check$/.exec(route.request().url())[1];
    evidence.checkCalls.push(id);
    await new Promise((done) => setTimeout(done, 80));
    await route.fulfill({ json: { check: { ...(CHECKS[id] ?? { ok: true, detail: "Works" }), checkedAt: Date.now() } } });
  });
  const target = new URL(url);
  target.searchParams.set("theme", theme);
  await page.goto(target.href);
  assert.equal(await page.title(), "Isolated Origin Integrations");
  await page.getByRole("region", { name: "Connect your stack" }).waitFor();
  return page;
}

const capture = async (page, name) => {
  await page.waitForTimeout(240);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} scrolls sideways`);
  await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true });
};

try {
  for (const [width, theme] of [[1280, "dark"], [1280, "light"], [375, "dark"], [375, "light"]]) {
    const tag = `${width}-${theme}`;
    const page = await open(width, theme);
    const stack = page.getByRole("region", { name: "Connect your stack" });
    const step = (id) => stack.locator(`[data-stack-step="${id}"]`);
    const provider = (id) => stack.locator(`[data-stack-provider="${id}"]`);

    await stack.getByText("1 of 2 ready").waitFor();
    await step("deploy").getByRole("button", { expanded: true }).waitFor();
    await provider("vercel").getByText("Not connected").waitFor();
    assert.equal(await provider("vercel").getByRole("link", { name: "Get Vercel keys" }).getAttribute("href"), "https://vercel.com/account/settings/tokens");
    await capture(page, `stack-${tag}`);
    evidence.cases.push({ tag, step: "checklist: 1 of 2 ready (GitHub shared), the first unfinished step (Deploys) open with its key pages" });

    await provider("netlify").getByRole("button", { name: "Add key" }).click();
    const netlify = page.locator('[data-integration="netlify"]');
    await netlify.getByRole("button", { expanded: true }).waitFor();
    await netlify.getByLabel("Personal access token").fill("nfp_fixture");
    await netlify.getByRole("button", { name: "Save" }).click();
    await netlify.getByText("Netlify rejected the key: Unauthorized").waitFor();
    await provider("netlify").getByText("Netlify rejected the key: Unauthorized").waitFor();
    await stack.getByText("1 of 2 ready").waitFor();
    await step("deploy").locator("span.border-warning").waitFor();
    await capture(page, `inline-check-${tag}`);
    evidence.cases.push({ tag, step: "Add key opens Netlify's form; saving checks the key at once and shows the rejection in the form and in the checklist" });
    page.once("dialog", (dialog) => void dialog.accept());
    await netlify.getByRole("button", { name: "Disconnect" }).click();
    await stack.getByText("1 of 2 ready").waitFor();

    await provider("vercel").getByRole("button", { name: "Add key" }).click();
    const vercel = page.locator('[data-integration="vercel"]');
    await vercel.getByRole("button", { expanded: true }).waitFor();
    await vercel.getByLabel("Access token").fill("fixture");
    await vercel.getByRole("button", { name: "Save" }).click();
    await stack.getByText("2 of 2 ready").waitFor();
    await vercel.getByText("Works as origin").waitFor();
    evidence.cases.push({ tag, step: "a working Vercel key completes Deploys and the check names the account" });
    page.once("dialog", (dialog) => void dialog.accept());
    await vercel.getByRole("button", { name: "Disconnect" }).click();
    await stack.getByText("1 of 2 ready").waitFor();
    await page.close();
  }
} finally {
  await browser.close();
  await writeFile(resolve(output, "checks.json"), `${JSON.stringify(evidence, null, 2)}\n`);
}
assert.deepEqual(evidence.pageErrors, []);
console.log(`${evidence.cases.length} cases passed; evidence in ${output}`);
