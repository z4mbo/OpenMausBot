import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const base = process.argv[2];
if (!base?.startsWith("http://127.0.0.1:")) throw new Error("Pass the fixture's printed previewUrl");
const { chromium } = await import(process.env.OMB_VERIFY_PLAYWRIGHT ?? "playwright");
const out = join(import.meta.dirname, "../../docs/verification/evidence/origin-vault-roles");
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.route("**/*", (route) => (new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort()));
const evidence = { cases: [] };
const show = async (screen, theme, viewport) => {
  await page.setViewportSize(viewport);
  const url = new URL(base);
  url.search = new URLSearchParams({ screen, theme }).toString();
  await page.goto(url.href);
  await page.getByRole("button", { name: "Switch project", exact: true }).waitFor();
};
const shot = async (name) => {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  const viewport = page.viewportSize().width;
  assert.ok(width <= viewport, `${name}: document is ${width}px wide in a ${viewport}px viewport`);
  await page.screenshot({ path: join(out, `${name}.png`) });
  evidence.cases.push({ name, documentWidth: width, viewport });
};

try {
  for (const [size, viewport] of [["desktop", { width: 1280, height: 860 }], ["mobile", { width: 375, height: 812 }]]) {
    for (const theme of ["dark", "light"]) {
      await show("vault", theme, viewport);
      await page.getByLabel("Vault passphrase", { exact: true }).fill("fixture-passphrase");
      await page.getByRole("button", { name: "Unlock vault", exact: true }).click();
      await page.getByText("Convex sign-in", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Reveal Production Convex", exact: true }).click();
      await page.getByText("CONVEX_DEPLOY_KEY=prod:fixture|synthetic-deploy-key", { exact: true }).waitFor();
      await shot(`project-vault-${size}-${theme}`);

      await page.getByRole("button", { name: "Personal", exact: true }).click();
      await page.getByText("My Vercel", { exact: true }).waitFor();
      assert.equal(await page.getByText("Production Convex", { exact: true }).count(), 0);
      await page.getByLabel("Vault passphrase", { exact: true }).fill("personal-fixture-passphrase");
      await page.getByRole("button", { name: "Unlock vault", exact: true }).click();
      await page.getByRole("button", { name: "Lock", exact: true }).waitFor();
      await shot(`personal-vault-${size}-${theme}`);

      await page.getByRole("button", { name: "New item", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "New vault item", exact: true });
      await dialog.locator("select").nth(0).selectOption("service");
      await dialog.locator("select").nth(1).selectOption("apple");
      await dialog.getByLabel("Key ID · APP_STORE_CONNECT_API_KEY_KEY_ID", { exact: true }).fill("ABC123DEFG");
      await dialog.getByLabel("Issuer ID · APP_STORE_CONNECT_API_KEY_ISSUER_ID", { exact: true }).fill("69a6de70-03db-47e3-e053-5b8c7c11a4d1");
      await dialog.getByLabel("Private key (.p8 contents) · APP_STORE_CONNECT_API_KEY_KEY", { exact: true }).fill("-----BEGIN PRIVATE KEY-----\nsynthetic-p8-body\n-----END PRIVATE KEY-----");
      await shot(`service-sign-in-${size}-${theme}`);
      await dialog.getByRole("button", { name: "Save encrypted item", exact: true }).click();
      await page.getByText("Apple App Store Connect sign-in", { exact: true }).waitFor();
      const write = await page.evaluate(() => window.originPagesFixture.calls.findLast((call) => call.name === "personalCredentials:create"));
      assert.equal(write.args.kind, "service");
      assert.equal(write.args.service, "apple");
      assert.equal("projectId" in write.args, false);
      assert.equal(JSON.stringify(write).includes("synthetic-p8-body"), false);
      evidence.cases.push({ name: `personal-service-write-${size}-${theme}`, encrypted: true, plaintextAbsent: true, projectless: true });

      await show("settings", theme, viewport);
      const roles = page.getByRole("definition");
      await roles.first().waitFor();
      assert.deepEqual(await page.getByRole("term").allTextContents(), ["admin", "member", "viewer"]);
      assert.deepEqual(await page.getByLabel("Role", { exact: true }).locator("option").allTextContents(), ["Admin", "Member", "Viewer"]);
      await page.getByText("What each role can do", { exact: false }).count();
      await page.getByRole("term").first().scrollIntoViewIfNeeded();
      await shot(`members-roles-${size}-${theme}`);
    }
  }
  evidence.pageErrors = errors;
  assert.deepEqual(errors, []);
} finally {
  writeFileSync(join(out, "browser-checks.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  await browser.close();
}
console.log(JSON.stringify({ ok: true, cases: evidence.cases.length }));
