import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const url = new URL(process.argv[2] ?? "");
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, "/__origin-studio.html");
const output = resolve(process.argv[3] ?? "docs/verification/evidence/origin-studio");
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
  assert.equal(await page.title(), "Isolated Origin Studio");
  return page;
}

const capture = async (page, name) => {
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} scrolls sideways`);
  await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true });
};
const falRequests = async (page) => page.evaluate(async () => (await fetch("/__origin-studio-fal.json")).json());

try {
  for (const [width, theme] of [[1280, "dark"], [375, "dark"], [1280, "light"], [375, "light"]]) {
    const tag = `${width}-${theme}`;
    const page = await open(width, theme);
    await page.getByRole("heading", { name: "Studio" }).waitFor();
    await page.locator("article", { hasText: "Pricing card, three tiers" }).getByText("Cancelled", { exact: true }).waitFor();
    await page.getByText("fal.ai refused the prompt: NSFW content detected").waitFor();
    for (const name of ["Hero shot of the app on a dark desk", "Five second teaser clip", "Pricing card, three tiers"]) {
      const article = page.locator("article", { hasText: name });
      const [card, remove] = [await article.boundingBox(), await article.getByRole("button", { name: "Delete generation" }).boundingBox()];
      assert.ok(card && remove && remove.x + remove.width <= card.x + card.width, `${name}: Delete fits inside its card`);
    }
    await capture(page, `gallery-${tag}`);

    const prompt = `Launch poster ${tag} ${Date.now()}`;
    await page.getByRole("textbox", { name: "Prompt" }).fill(prompt);
    await page.getByRole("button", { name: "Generate" }).click();
    const cancelsBefore = (await falRequests(page)).filter((request) => request.method === "PUT").length;
    const card = page.locator("article", { hasText: prompt });
    await card.getByRole("status").waitFor();
    await capture(page, `running-${tag}`);
    await card.getByRole("button", { name: "Cancel" }).focus();
    await page.keyboard.press("Enter");
    await card.getByText("Cancelled", { exact: true }).waitFor();
    assert.equal(await card.getByRole("button", { name: "Cancel" }).count(), 0, "a cancelled card offers no Cancel");
    const cancels = (await falRequests(page)).filter((request) => request.method === "PUT" && request.path.endsWith("/cancel"));
    assert.equal(cancels.length, cancelsBefore + 1, "Cancel reached fal's cancel_url once");
    await capture(page, `cancelled-${tag}`);
    evidence.cases.push({ tag, step: "Generate queues on the loopback fal through the fixture server; Cancel (keyboard) calls fal's cancel_url and the card settles as Cancelled" });

    if (width === 1280 && theme === "dark") {
      for (const name of ["Five second teaser clip", "Welcome to the Origin launch"]) {
        const save = page.locator("article", { hasText: name }).getByRole("button", { name: "Save" });
        if (await save.count()) await save.click();
        await page.locator("article", { hasText: name }).getByText("Saved", { exact: true }).waitFor();
      }
      evidence.cases.push({ tag, step: "a video and an audio output are saved to Assets" });
    }
    await page.close();

    const assets = await open(width, theme, { page: "assets" });
    await assets.getByRole("heading", { name: "Assets" }).waitFor();
    await assets.locator("article").getByText("video", { exact: true }).waitFor();
    await assets.locator("article").getByText("audio", { exact: true }).waitFor();
    await assets.getByRole("combobox", { name: "Asset type" }).selectOption("video");
    await assets.getByText("Five second teaser clip.mp4").waitFor();
    assert.equal(await assets.getByText("Welcome to the Origin launch.mp3").count(), 0, "the video filter leaves the audio asset out");
    await assets.getByRole("combobox", { name: "Asset type" }).selectOption("all");
    await capture(assets, `assets-${tag}`);
    evidence.cases.push({ tag, step: "Assets lists the Studio video and audio as their own types and filters by them" });
    await assets.close();
  }
} finally {
  await writeFile(resolve(output, "report.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  await browser.close();
}
assert.deepEqual(evidence.pageErrors, []);
console.log(JSON.stringify({ cases: evidence.cases.length, output }));
