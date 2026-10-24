import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const url = new URL(process.argv[2] ?? "");
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, "/__origin-brand-kit.html");
const output = resolve(process.argv[3] ?? "docs/verification/evidence/origin-brand-kit");
await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.OMB_VERIFY_PLAYWRIGHT || "playwright");
const browser = await chromium.launch();
const evidence = { checkedAt: new Date().toISOString(), previewUrl: url.href, cases: [], pageErrors: [] };
const config = await (await fetch(new URL("/__origin-cloud.json", url))).json();

async function convex(kind, path, args) {
  const response = await fetch(`${config.url}/api/${kind}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, format: "convex_encoded_json", args: [{ sessionToken: config.token, ...args }] }) });
  const body = await response.json();
  assert.equal(body.status, "success", body.errorMessage);
  return body.value;
}
const agent = async (tool, args) => (await fetch(new URL("/__brand-agent", url), { method: "POST", body: JSON.stringify({ tool, args }) })).json();

async function open(width, theme, query = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
  page.on("pageerror", (error) => evidence.pageErrors.push(`${width}-${theme}: ${error.message}`));
  await page.route(/^(?!http:\/\/127\.0\.0\.1)/, (route) => route.abort());
  const target = new URL(url);
  target.searchParams.set("theme", theme);
  for (const [key, value] of Object.entries(query)) target.searchParams.set(key, value);
  await page.goto(target.href);
  assert.equal(await page.title(), "Isolated Origin brand kit");
  return page;
}
async function openBrand(width, theme, query = {}) {
  const page = await open(width, theme, query);
  await page.getByRole("heading", { name: "Assets" }).waitFor();
  await page.getByRole("button", { name: "Brand" }).click();
  await page.locator("[data-brand-panel]").waitFor();
  return page;
}
const capture = async (page, name) => {
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} scrolls sideways`);
  await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true });
};

try {
  const fresh = await openBrand(1280, "dark");
  await fresh.getByText("Not saved yet").waitFor();
  assert.equal(await fresh.getByRole("textbox", { name: "Name", exact: true }).inputValue(), "Lumen");
  await capture(fresh, "empty-1280-dark");
  await fresh.getByRole("button", { name: "Draft with Atlas" }).click();
  const sent = await fresh.evaluate(() => window.originBrandDispatched.find((action) => action.type === "send"));
  assert.equal(sent.botId, "fixture-chief");
  assert.match(sent.text, /Draft the brand kit for Lumen with origin_brand_update/);
  evidence.cases.push({ step: "a project without a kit opens the editor on defaults; Draft with the Chief sends the brief into its chat" });

  const drafted = await agent("origin_brand_update", {
    tagline: "Light for night owls", voice_adjectives: ["calm", "warm", "precise"], voice_do: ["Short sentences", "Name the outcome first"], voice_dont: ["Hype words", "Exclamation marks"],
    primary: "#7C3AED", secondary: "#FDE68A", neutrals: ["#FAFAF9", "#1C1917", "#A8A29E"], heading_font: "fraunces", body_font: "dm-sans",
    logos: ["Lumen logo"], icon: "Lumen icon", imagery: ["soft lamplight", "film grain", "deep violet shadows"],
  });
  assert.equal(drafted.isError, undefined, drafted.text);
  assert.match(drafted.text, /headings Fraunces \(family "fraunces"\)/);
  const read = await agent("origin_brand_get", {});
  assert.match(read.text, /Voice: calm, warm, precise/);
  assert.match(read.text, /Contrast: Text on background [\d.]+:1 AAA/);
  await fresh.getByText("Saved by Atlas").waitFor();
  await fresh.locator("[data-brand-preview]").getByText("Light for night owls").waitFor();
  await fresh.locator("[data-brand-preview] img").first().waitFor();
  evidence.cases.push({ step: "the Chief's origin_brand_update, through the real tool and Convex functions, shows live in the panel; origin_brand_get reads it back with contrast" });
  await fresh.close();

  for (const [width, theme] of [[1280, "dark"], [1280, "light"], [375, "dark"]]) {
    const page = await openBrand(width, theme);
    await page.getByText("Saved by Atlas").waitFor();
    await capture(page, `kit-${width}-${theme}`);
    await page.close();
  }
  evidence.cases.push({ step: "the drafted kit at 1280 dark and light and 375 dark, without sideways scroll" });

  const edit = await openBrand(1280, "dark");
  await edit.getByText("Saved by Atlas").waitFor();
  const contrast = edit.getByRole("list", { name: "Contrast checks" });
  await edit.getByLabel("Primary hex").fill("#FDE68A");
  await contrast.getByText("Fails").first().waitFor();
  await capture(edit, "contrast-fail-1280-dark");
  await edit.getByLabel("Primary hex").fill("#6D28D9");
  assert.equal(await contrast.getByText("Fails").count(), 0);
  await edit.getByLabel("Style words for images").fill("quiet interiors");
  await edit.getByLabel("Style words for images").press("Enter");
  await edit.getByLabel("Headings").selectOption("playfair-display");
  await edit.getByRole("button", { name: "Save brand" }).click();
  await edit.getByText(/Saved by ada/).waitFor();
  const stored = await convex("query", "brand:get", { projectId: config.projectId });
  assert.equal(stored.colors.primary, "#6D28D9");
  assert.equal(stored.fonts.heading, "playfair-display");
  assert.deepEqual(stored.imagery, ["soft lamplight", "film grain", "deep violet shadows", "quiet interiors"]);
  evidence.cases.push({ step: "editing shows a failing contrast live, then saves colour, font and imagery through brand:update" });
  await edit.close();

  const viewer = await openBrand(1280, "dark", { viewer: "1" });
  await viewer.getByText("Only editors can change the brand kit.").waitFor();
  assert.equal(await viewer.getByRole("button", { name: "Save brand" }).count(), 0);
  assert.equal(await viewer.getByRole("button", { name: /Draft with/ }).count(), 0);
  assert.equal(await viewer.getByRole("textbox", { name: "Name", exact: true }).isDisabled(), true);
  await capture(viewer, "viewer-1280-dark");
  evidence.cases.push({ step: "a viewer reads the kit without save, draft or editable fields" });
  await viewer.close();
} finally {
  await browser.close();
  await writeFile(resolve(output, "checks.json"), `${JSON.stringify(evidence, null, 2)}\n`);
}
assert.deepEqual(evidence.pageErrors, []);
console.log(`${evidence.cases.length} cases passed; evidence in ${output}`);
