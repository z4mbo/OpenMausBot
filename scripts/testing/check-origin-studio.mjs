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
  const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: "reduce", ignoreHTTPSErrors: true });
  page.on("pageerror", (error) => evidence.pageErrors.push(`${width}-${theme}: ${error.message}`));
  await page.route(/^(?!https?:\/\/127\.0\.0\.1)/, (route) => route.abort());
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
  await page.screenshot({ path: resolve(output, `${name}.png`) });
};
const falRequests = async (page) => page.evaluate(async () => (await fetch("/__origin-studio-fal.json")).json());
const submitted = async (page, endpoint) => (await falRequests(page)).filter((request) => request.method === "POST" && request.path === `/${endpoint}`);
const tile = (page, text) => page.locator("[data-studio-tile]", { hasText: text });
const step = (tag, text) => evidence.cases.push({ tag, step: text });

async function dragBy(page, locator, dx, dy) {
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + 60, box.y + 15);
  await page.mouse.down();
  await page.mouse.move(box.x + 60 + dx, box.y + 15 + dy, { steps: 6 });
  await page.mouse.up();
}

async function link(page, from, to) {
  const [a, b] = [await from.boundingBox(), await to.boundingBox()];
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
}

try {
  for (const [width, theme] of [[1280, "dark"], [375, "dark"], [1280, "light"], [375, "light"]]) {
    const tag = `${width}-${theme}`;
    const full = width === 1280 && theme === "dark";
    const page = await open(width, theme);
    await page.getByRole("heading", { name: "Studio" }).waitFor();
    await tile(page, "Pricing card, three tiers").getByText("Cancelled", { exact: true }).waitFor();
    await page.getByText("fal.ai refused the prompt: NSFW content detected").waitFor();
    await capture(page, `gallery-${tag}`);

    const prompt = page.getByRole("textbox", { name: "Prompt" });
    await page.keyboard.press("/");
    assert.equal(await prompt.evaluate((node) => node === document.activeElement), true, "/ focuses the prompt");
    const run = Date.now().toString(36).slice(-4);
    const poster = `Launch poster ${tag} ${run}`;
    await page.keyboard.type(poster);
    await page.keyboard.press("Control+Enter");
    await tile(page, poster).getByRole("status").waitFor();
    await tile(page, poster).locator("img").waitFor({ timeout: 30_000 });
    step(tag, "Ctrl+Enter generates on the loopback fal; the tile shows progress with an ETA, then the image");

    const held = `Hold the mascot sketch ${tag} ${run}`;
    await prompt.fill(held);
    await page.getByRole("button", { name: "Generate" }).click();
    await tile(page, held).getByRole("status").waitFor();
    await capture(page, `running-${tag}`);
    const cancelsBefore = (await falRequests(page)).filter((request) => request.method === "PUT").length;
    await tile(page, held).getByRole("button", { name: "Cancel" }).focus();
    await page.keyboard.press("Enter");
    await tile(page, held).getByText("Cancelled", { exact: true }).waitFor();
    assert.equal((await falRequests(page)).filter((request) => request.method === "PUT" && request.path.endsWith("/cancel")).length, cancelsBefore + 1, "Cancel reached fal's cancel_url once");
    step(tag, "a held generation is cancelled from its tile with the keyboard");

    await prompt.blur();
    await page.keyboard.press("2");
    await page.getByRole("button", { name: "Model: Veo 3.1" }).waitFor();
    for (const name of ["Aspect ratio", "Duration", "Resolution", "Camera motion"]) await page.getByRole("combobox", { name }).waitFor();
    await page.getByRole("switch", { name: "Soundtrack" }).click();
    assert.equal(await page.getByRole("switch", { name: "Soundtrack" }).getAttribute("aria-checked"), "false");
    await page.keyboard.press("m");
    await page.getByRole("dialog", { name: "Models" }).waitFor();
    await page.keyboard.type("flux 3");
    if (full || width === 375) await capture(page, `models-${tag}`);
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Model: FLUX 3" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Image", exact: true }).getAttribute("aria-pressed"), "true", "picking an image model switches the mode");
    step(tag, "number keys switch mode, M opens the model picker, search and Enter pick FLUX 3; Veo shows its own controls");

    await prompt.fill("poster idea");
    await page.getByRole("button", { name: "Enhance prompt" }).click();
    await page.waitForFunction(() => document.querySelector("textarea[aria-label=Prompt]")?.value.startsWith("A cinematic poster idea"));
    step(tag, "Enhance rewrites the prompt through the cheap model");

    if (full) {
      await prompt.blur();
      await page.keyboard.press("3");
      await page.getByRole("button", { name: /^Voice:/ }).click();
      await page.getByRole("button", { name: "Hear Brian" }).click();
      await page.getByRole("button", { name: "Stop Brian" }).waitFor({ timeout: 20_000 });
      await capture(page, `voices-${tag}`);
      await page.getByRole("button", { name: /^Brian Deep/ }).click();
      await page.getByRole("button", { name: "Voice: Brian" }).waitFor();
      step(tag, "the voice picker plays a sample and picks Brian");

      await tile(page, poster).focus();
      await page.keyboard.press("a");
      await page.getByRole("button", { name: "Model: Kling 3 Pro · animate" }).waitFor();
      await page.getByTitle(`Change: ${poster}`).waitFor();
      await prompt.fill(`The rocket lifts off ${run}`);
      await page.keyboard.press("Control+Enter");
      await tile(page, `The rocket lifts off ${run}`).waitFor();
      const animate = (await submitted(page, "fal-ai/kling-video/v3/pro/image-to-video")).at(-1);
      assert.match(animate.body.start_image_url, /^https:\/\/127\.0\.0\.1:\d+\/image\//, "Animate starts from the poster's output");
      await tile(page, poster).focus();
      await page.keyboard.press("u");
      await page.waitForFunction(async () => (await (await fetch("/__origin-studio-fal.json")).json()).some((request) => request.path === "/fal-ai/seedvr/upscale/image"));
      step(tag, "A on a tile sets up Animate with the output as its start frame; U upscales at once");

      await tile(page, poster).getByRole("button", { name: "Use in Broadcast" }).click();
      await tile(page, poster).getByRole("button", { name: "Remove from Broadcast" }).waitFor();
      step(tag, "an output is picked for Broadcast from its tile");
    }

    await tile(page, poster).focus();
    await page.keyboard.press("Enter");
    const viewer = page.getByRole("dialog");
    await viewer.getByText(poster).first().waitFor();
    await capture(page, `viewer-${tag}`);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Escape");
    await viewer.waitFor({ state: "detached" });
    await page.keyboard.press("?");
    await page.getByRole("dialog", { name: "Keyboard shortcuts" }).waitFor();
    await page.keyboard.press("Escape");
    step(tag, "Enter opens the viewer, arrows walk results, ? lists the shortcuts");

    await page.keyboard.press("w");
    await page.getByRole("region", { name: "Templates" }).waitFor();
    await page.getByRole("region", { name: "Templates" }).getByRole("button", { name: /Podcast cover and voice intro/ }).click();
    await page.locator("[data-workflow-node]").first().waitFor();
    await page.getByRole("button", { name: "Run" }).click();
    await page.locator("[data-workflow-run=done]").waitFor({ timeout: 60_000 });
    assert.equal(await page.getByText("Saved to Assets", { exact: true }).count(), 3, "each Output node saved its file");
    await capture(page, `workflow-run-${tag}`);
    step(tag, "the podcast template runs step by step and its three Outputs land in Assets");

    if (full) {
      await page.getByRole("button", { name: "All workflows" }).click();
      await page.getByRole("button", { name: "New workflow" }).click();
      await page.getByRole("textbox", { name: "Workflow name" }).fill(`Teaser builder ${run}`);
      for (const name of ["Prompt", "FLUX.1 schnell", "Output to Assets"]) {
        await page.getByRole("button", { name: "Node", exact: true }).click();
        await page.getByRole("dialog", { name: "Add a node" }).getByRole("button", { name, exact: true }).click();
      }
      const nodes = page.locator("[data-workflow-node]");
      await dragBy(page, nodes.nth(0), -320, 0);
      await dragBy(page, nodes.nth(2), 320, 40);
      await link(page, nodes.nth(0).locator("[data-port-out]"), nodes.nth(1).locator("[data-port-in=prompt]"));
      await link(page, nodes.nth(1).locator("[data-port-out]"), nodes.nth(2).locator("[data-port-in=media]"));
      await nodes.nth(0).getByRole("textbox", { name: "Prompt text" }).fill("Neon city skyline at dusk");
      await page.keyboard.press("Control+s");
      await page.getByRole("button", { name: "Saved" }).waitFor();
      await capture(page, `workflow-editor-${tag}`);
      await page.keyboard.press("Control+Enter");
      await page.locator("[data-workflow-run=done]").waitFor({ timeout: 60_000 });
      const [flux] = await submitted(page, "fal-ai/flux/schnell");
      assert.ok(flux, "the built workflow ran FLUX.1 schnell");
      await page.getByRole("button", { name: "All workflows" }).click();
      await page.getByRole("button", { name: new RegExp(`Teaser builder ${run}`) }).first().waitFor();
      step(tag, "a workflow built by adding nodes and dragging links is saved with Ctrl+S, runs with Ctrl+Enter and is listed");
    }
    await page.close();

    const assets = await open(width, theme, { page: "assets" });
    await assets.getByRole("heading", { name: "Assets" }).waitFor();
    await assets.getByRole("combobox", { name: "Folder" }).selectOption("Studio");
    await assets.getByText(`${poster}.png`).waitFor();
    await assets.getByText("Podcast cover.png").first().waitFor();
    assert.equal(await assets.getByText("Product photo.png").count(), 0, "the Studio folder leaves other assets out");
    await capture(assets, `assets-${tag}`);
    step(tag, "every finished output is in Assets under the Studio folder without a Save step");
    await assets.close();
  }
} finally {
  await writeFile(resolve(output, "report.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  await browser.close();
}
assert.deepEqual(evidence.pageErrors, []);
console.log(JSON.stringify({ cases: evidence.cases.length, output }));
