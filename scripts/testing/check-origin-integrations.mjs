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
  fal: { ok: true, detail: "fal.ai accepted the key" },
  stripe: { ok: true, account: "Acme test", detail: "Stripe accepted the key", mode: "test" },
  x: { ok: true, account: "@origin", detail: "X accepted the keys" },
  brevo: { ok: false, detail: "Brevo rejected the key: Key not found" },
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

    await stack.getByText("4 of 7 ready").waitFor();
    await step("sms").getByRole("button", { expanded: true }).waitFor();
    await provider("twilio").getByText("Incomplete").waitFor();
    assert.equal(await provider("twilio").getByRole("link", { name: "Get Twilio keys" }).getAttribute("href"), "https://console.twilio.com");
    await capture(page, `stack-${tag}`);
    evidence.cases.push({ tag, step: "checklist: 4 of 7 ready (GitHub shared, fal, X, Stripe), the first unfinished step (SMS, half filled) open with its key page" });

    await step("payments").getByRole("button", { expanded: false }).click();
    await provider("stripe").getByText("Yours").waitFor();
    await provider("stripe").getByRole("button", { name: "Check" }).click();
    await provider("stripe").getByText("Works as Acme test").waitFor();
    await provider("stripe").getByText("Test mode").waitFor();

    await step("social").getByRole("button", { expanded: false }).click();
    await provider("x").getByRole("button", { name: "Check" }).click();
    await provider("x").getByText("Works as @origin").waitFor();
    const socials = stack.getByRole("group", { name: "Accounts per service" });
    await socials.getByText("Founder").waitFor();
    await socials.getByText("Main account").waitFor();
    await socials.getByRole("button", { name: "Add X account" }).click();
    const form = stack.getByRole("form", { name: "Add X account" });
    await form.getByLabel("Name in Broadcast").fill(`Support ${tag}`);
    for (const label of ["API key", "API secret", "Access token", "Access token secret"]) await form.getByLabel(label, { exact: true }).fill("fixture");
    await capture(page, `social-accounts-${tag}`);
    await form.getByRole("button", { name: "Add account" }).click();
    await socials.getByText(`Support ${tag}`).waitFor();
    page.once("dialog", (dialog) => void dialog.accept());
    await socials.getByRole("button", { name: `Remove Support ${tag}` }).click();
    await socials.getByText(`Support ${tag}`).waitFor({ state: "detached" });
    evidence.cases.push({ tag, step: "checks show the account and Stripe test mode; a second X account is added and removed through the server" });

    await step("email").getByRole("button", { expanded: false }).click();
    await provider("brevo").getByRole("button", { name: "Add key" }).click();
    const row = page.locator('[data-integration="brevo"]');
    await row.getByRole("button", { expanded: true }).waitFor();
    await row.getByLabel("API key").fill("xkeysib-fixture");
    await row.getByLabel("Sender email").fill("hello@fixture.test");
    await row.getByRole("button", { name: "Save" }).click();
    await row.getByText("Brevo rejected the key: Key not found").waitFor();
    await provider("brevo").getByText("Brevo rejected the key: Key not found").waitFor();
    await stack.getByText("4 of 7 ready").waitFor();
    await step("email").locator("span.border-warning").waitFor();
    await capture(page, `inline-check-${tag}`);
    evidence.cases.push({ tag, step: "Add key opens Brevo's form; saving checks the key at once and shows the rejection in the form and in the checklist" });
    page.once("dialog", (dialog) => void dialog.accept());
    await row.getByRole("button", { name: "Disconnect" }).click();
    await stack.getByText("4 of 7 ready").waitFor();
    await page.close();
  }
} finally {
  await browser.close();
  await writeFile(resolve(output, "checks.json"), `${JSON.stringify(evidence, null, 2)}\n`);
}
assert.deepEqual(evidence.pageErrors, []);
console.log(`${evidence.cases.length} cases passed; evidence in ${output}`);
