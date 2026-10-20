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

const capture = async (page, name, { top = false } = {}) => {
  if (top) {
    await page.mouse.move(0, 0);
    await page.evaluate(() => {
      document.activeElement?.blur?.();
      document.querySelector("section[aria-label]")?.scrollTo(0, 0);
    });
  }
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

/** Two touch pointers spread apart on the workflow canvas; returns the zoom label before and after. */
async function pinch(page) {
  const zoom = page.locator("[data-workflow-zoom]");
  const before = await zoom.textContent();
  await page.evaluate(() => {
    const canvas = document.querySelector("[data-workflow-canvas]");
    const box = canvas.getBoundingClientRect();
    const y = box.top + box.height / 2;
    const x = box.left + box.width / 2;
    const fire = (type, pointerId, clientX) => canvas.dispatchEvent(new PointerEvent(type, { pointerId, pointerType: "touch", clientX, clientY: y, bubbles: true, button: 0, buttons: 1 }));
    fire("pointerdown", 11, x - 30);
    fire("pointerdown", 12, x + 30);
    for (let step = 1; step <= 6; step += 1) {
      fire("pointermove", 11, x - 30 - step * 12);
      fire("pointermove", 12, x + 30 + step * 12);
    }
    fire("pointerup", 11, x - 102);
    fire("pointerup", 12, x + 102);
  });
  return { before, after: await zoom.textContent() };
}

const nodeCount = (page) => page.locator("[data-workflow-node]").count();

async function addNode(page, query) {
  await page.getByRole("button", { name: "Node", exact: true }).click();
  await page.getByRole("combobox", { name: "Search nodes" }).fill(query);
  await page.keyboard.press("Enter");
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
    await tile(page, "Five second teaser clip").locator("video[poster^='blob:']").waitFor();
    assert.equal(await tile(page, "Five second teaser clip").locator("video").getAttribute("preload"), "none", "a video with a poster waits for hover to load");
    step(tag, "a video tile without a poster from fal shows its first frame, drawn in the browser and cached");
    await capture(page, `gallery-${tag}`);
    const views = page.getByRole("group", { name: "Studio view" });
    const viewsLeft = async () => Math.round((await views.boundingBox()).x);
    const createLeft = await viewsLeft();
    for (const name of ["Workflows", "Presets", "Design"]) {
      await views.getByRole("button", { name, exact: true }).click();
      await views.getByRole("button", { name, exact: true, pressed: true }).waitFor();
      if (width === 1280) {
        assert.equal(await viewsLeft(), createLeft, `${name} keeps the Studio header in place`);
        assert.ok(await page.getByRole("heading", { name: "Studio", exact: true }).isVisible(), `${name} shows the Studio title`);
      }
    }
    await views.getByRole("button", { name: "Create", exact: true }).click();
    await page.getByRole("textbox", { name: "Prompt" }).waitFor();
    step(tag, "Create, Workflows, Presets and Design share the Studio header and its four-way control");

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

    await prompt.fill("");
    await prompt.blur();
    await page.getByRole("button", { name: "Library", exact: true }).click();
    await page.locator("[data-library-entry='Aurora bottle']").waitFor();
    const mia = `Mia ${run}`;
    if (full) {
      await page.getByRole("button", { name: "New character, product or style" }).click();
      const editor = page.getByRole("dialog", { name: "New library entry" });
      await editor.getByLabel("Name").fill(mia);
      await editor.getByLabel("What stays the same").fill("Red bob haircut, green bomber jacket");
      await editor.getByRole("button", { name: "Add a reference image" }).click();
      await page.locator("[data-studio-media-picker] button").first().click();
      await editor.locator("[data-library-references] img").first().waitFor();
      await editor.getByRole("button", { name: "Add to library" }).click();
      await page.locator(`[data-library-entry='${mia}']`).waitFor();
    }
    await capture(page, `library-${tag}`);
    if (full) {
      await page.getByRole("button", { name: `Create with ${mia}` }).click();
      await page.getByRole("button", { name: `Following ${mia}`, exact: true }).waitFor();
      const followed = `Mia waves from the stage ${run}`;
      await prompt.fill(followed);
      await page.keyboard.press("Control+Enter");
      await tile(page, followed).waitFor();
      const sent = (await submitted(page, "fal-ai/nano-banana-pro/edit")).at(-1);
      assert.ok(sent.body.prompt.includes(`Keep ${mia} consistent with the reference images: Red bob haircut, green bomber jacket.`), "the library entry joins the prompt");
      assert.equal(sent.body.image_urls.length, 1, "the library entry's reference image is sent");
      await tile(page, followed).getByText(mia, { exact: true }).waitFor({ state: "attached" });
      await page.getByRole("button", { name: `Stop following ${mia}` }).click();
      await tile(page, poster).focus();
      await page.keyboard.press("l");
      await page.getByRole("dialog", { name: "New library entry" }).locator("[data-library-references] img").waitFor();
      await page.keyboard.press("Escape");
      step(tag, "a library entry is saved from a generated image, followed by the next generation (references and description reach fal), and L on a tile seeds a new one");
    } else {
      await page.getByRole("group", { name: "Studio view" }).getByRole("button", { name: "Create", exact: true }).click();
      step(tag, "the Library tab lists the project's characters, products and styles");
    }

    await page.keyboard.press("c");
    const pack = page.getByRole("dialog", { name: "Campaign pack" });
    const brief = `Aurora sparkling water launch ${tag} ${run}`;
    await pack.getByRole("textbox", { name: "Brief" }).fill(brief);
    if (full) {
      await pack.getByRole("radio", { name: mia }).click();
      await capture(page, `campaign-dialog-${tag}`);
    }
    await pack.getByRole("button", { name: "Generate pack" }).click();
    const strip = page.locator("[data-campaign-run]", { hasText: brief });
    await strip.waitFor();
    await page.locator("[data-campaign-run=done]", { hasText: brief }).waitFor({ timeout: 120_000 });
    await strip.getByText("Feed post and Reel drafted").waitFor();
    await capture(page, `campaign-${tag}`, { top: true });
    const voice = (await submitted(page, "fal-ai/elevenlabs/tts/eleven-v3")).at(-1);
    assert.match(voice.body.text, new RegExp(`^Meet the launch: Aurora sparkling water launch ${tag}`), "the voice-over is written from the brief");
    assert.ok((await submitted(page, "fal-ai/ffmpeg-api/merge-audio-video")).length > 0, "the reel gets its voice-over");
    step(tag, "C opens the Campaign pack; one brief runs hero, square post, 9:16 reel and voice-over, and the feed post and reel are drafted in Publish");

    if (full) {
      await strip.getByRole("button", { name: "Open its workflow" }).click();
      await page.locator("[data-workflow-run=done]").waitFor();
      await page.locator("[data-workflow-posts]").getByText("2 drafts in Publish").waitFor();
      await capture(page, `campaign-workflow-${tag}`);
      await page.getByRole("group", { name: "Studio view" }).getByRole("button", { name: "Create", exact: true }).click();
      const broadcast = await open(width, theme, { page: "broadcast" });
      await broadcast.getByText(`${brief} #launch`).first().waitFor({ timeout: 20_000 });
      await capture(broadcast, `broadcast-drafts-${tag}`);
      await broadcast.close();
      step(tag, "the pack's run shows its two drafts in Publish, and Publish lists them with the written caption");
    }

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

      await tile(page, poster).getByRole("button", { name: "Add to Publish" }).click();
      await tile(page, poster).getByRole("button", { name: "Remove from Publish" }).waitFor();
      step(tag, "an output is picked for Publish from its tile");

      await prompt.blur();
      await page.keyboard.press("t");
      await page.locator("[data-studio-presets] [data-preset-card='motion-transfer'] img").waitFor();
      assert.equal(await page.getByRole("group", { name: "Studio view" }).getByRole("button", { name: "Presets", exact: true }).getAttribute("aria-pressed"), "true", "T opens the Presets tab");
      await capture(page, `presets-${tag}`);
      await page.keyboard.type("motion transfer");
      await page.keyboard.press("Enter");
      await page.locator("[data-studio-preset='motion-transfer']").waitFor();
      await page.getByRole("button", { name: "Model: Kling 3 Pro · motion transfer" }).waitFor();
      if (!(await page.getByTitle(`Change: ${poster}`).count())) {
        await page.getByRole("button", { name: "Character", exact: true }).click();
        await page.locator("[data-studio-media-picker] button", { hasText: poster }).click();
      }
      await page.getByRole("button", { name: "Motion video", exact: true }).click();
      await page.locator("[data-studio-media-picker] button", { hasText: "Five second teaser clip" }).click();
      await capture(page, `preset-motion-transfer-${tag}`);
      await page.locator("[data-studio-composer]").getByRole("button", { name: "Generate" }).click();
      let motion;
      for (let tries = 0; !motion && tries < 60; tries += 1) {
        motion = (await submitted(page, "fal-ai/kling-video/v3/pro/motion-control")).at(-1);
        if (!motion) await page.waitForTimeout(250);
      }
      assert.match(motion.body.image_url, /^https:\/\/127\.0\.0\.1:\d+\/image\//, "the character is the poster's output");
      assert.ok(motion.body.video_url, "the motion video is sent");
      assert.equal(motion.body.character_orientation, "video");
      step(tag, "T opens the Presets tab with ComfyUI preview images; Motion transfer labels its inputs Character and Motion video and sends both to Kling's motion control");
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
    const templateNodes = await nodeCount(page);
    await addNode(page, "kling");
    assert.equal(await nodeCount(page), templateNodes + 1, "the palette adds the searched model");
    await page.getByRole("button", { name: "Undo" }).click();
    assert.equal(await nodeCount(page), templateNodes, "Undo removes it");
    await page.getByRole("button", { name: "Redo" }).click();
    assert.equal(await nodeCount(page), templateNodes + 1, "Redo brings it back");
    await page.getByRole("button", { name: "Undo" }).click();
    const zoomed = await pinch(page);
    assert.notEqual(zoomed.after, zoomed.before, "a two-finger pinch zooms the canvas");
    step(tag, `the node palette searches models, Undo and Redo walk the edit, and a pinch zooms the canvas (${zoomed.before} to ${zoomed.after})`);
    await page.getByRole("button", { name: "Run" }).click();
    await page.locator("[data-workflow-run=done]").waitFor({ timeout: 60_000 });
    assert.equal(await page.getByText("Saved to Assets", { exact: true }).count(), 3, "each Output node saved its file");
    await capture(page, `workflow-run-${tag}`);
    step(tag, "the podcast template runs step by step and its three Outputs land in Assets");

    if (full) {
      await page.getByRole("button", { name: "All workflows" }).click();
      await page.getByRole("button", { name: "New workflow" }).click();
      await page.getByRole("textbox", { name: "Workflow name" }).fill(`Teaser builder ${run}`);
      for (const query of ["prompt", "schnell", "output to assets"]) await addNode(page, query);
      const nodes = page.locator("[data-workflow-node]");
      assert.equal(await nodeCount(page), 3);
      await page.keyboard.press("Control+z");
      assert.equal(await nodeCount(page), 2, "Ctrl+Z undoes the last node");
      await page.keyboard.press("Control+Shift+z");
      assert.equal(await nodeCount(page), 3, "Ctrl+Shift+Z redoes it");
      await nodes.nth(1).locator("span.truncate").first().click();
      await page.keyboard.press("Control+c");
      await page.keyboard.press("Control+v");
      assert.equal(await nodeCount(page), 4, "Ctrl+C then Ctrl+V pastes a copy");
      await page.keyboard.press("Control+z");
      assert.equal(await nodeCount(page), 3);
      const canvas = page.locator("[data-workflow-canvas]");
      const box = await canvas.boundingBox();
      await page.mouse.dblclick(box.x + 40, box.y + box.height - 60);
      await page.getByRole("combobox", { name: "Search nodes" }).waitFor();
      await page.keyboard.press("Escape");
      await page.getByRole("combobox", { name: "Search nodes" }).waitFor({ state: "detached" });
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
      step(tag, "a workflow built from the searchable palette (with Ctrl+Z, Ctrl+Shift+Z, Ctrl+C/V and double-click to add) and dragged links is saved with Ctrl+S, runs with Ctrl+Enter and is listed");
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
