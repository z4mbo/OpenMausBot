import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { applyCanvasOps } from "../../shared/canvas-ops.ts";
import { encodeNode } from "../../shared/canvas-scene.ts";
const url = new URL(process.argv[2] ?? "");
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, "/__origin-draw.html");
const output = resolve("docs/verification/evidence/origin-draw");
await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.OMB_VERIFY_PLAYWRIGHT || "playwright");

const card = (name, price, featured = false) => ({
  type: "frame", name, w: 360, fill: featured ? "#111827" : "#FFFFFF", stroke: "#E5E7EB", strokeWidth: 1, radius: 16, grow: true,
  layout: { direction: "column", gap: 16, padding: 32, hug: "height" },
  children: [
    { type: "text", text: name, fontSize: 20, fontWeight: 600, fill: featured ? "#FFFFFF" : "#111827" },
    { type: "text", text: price, fontSize: 44, fontWeight: 700, fill: featured ? "#FFFFFF" : "#111827" },
    { type: "frame", name: "Button", w: 296, h: 44, radius: 10, fill: featured ? "#6366F1" : "#111827", layout: { direction: "row", align: "center", justify: "center" }, children: [{ type: "text", text: "Get started", fontSize: 15, fontWeight: 600, fill: "#FFFFFF" }] },
  ],
});
const agentRows = applyCanvasOps(new Map(), [{ op: "create", node: {
  type: "frame", name: "Pricing section", w: 1440, fill: "#F9FAFB", layout: { direction: "column", gap: 48, padding: [96, 120], align: "center", hug: "height" },
  children: [
    { type: "text", text: "Simple pricing", fontSize: 48, fontWeight: 700, fill: "#111827" },
    { type: "frame", name: "Plans", w: 1200, fill: null, layout: { direction: "row", gap: 24, hug: "height" }, children: [card("Starter", "$0"), card("Team", "$24", true), card("Studio", "$79")] },
  ],
} }]).changed.map(encodeNode);
const legacyRows = [
  { id: "legacy-box", type: "rectangle", version: 3, versionNonce: 5, index: "a0", x: -600, y: 0, width: 200, height: 120, strokeColor: "#1e1e1e", backgroundColor: "#a5d8ff", strokeWidth: 2 },
  { id: "legacy-note", type: "text", version: 2, versionNonce: 7, index: "a1", x: -580, y: 140, width: 160, height: 25, text: "Old sketch note", fontSize: 20, strokeColor: "#1e1e1e", backgroundColor: "transparent" },
].map((element) => JSON.stringify(element));

const browser = await chromium.launch();
const evidence = { checkedAt: new Date().toISOString(), previewUrl: url.href, cases: [], pageErrors: [] };
try {
  for (const theme of ["dark", "light"]) for (const width of [375, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: width < 500 ? 812 : 860 }, reducedMotion: "reduce", acceptDownloads: true });
    page.on("pageerror", (error) => evidence.pageErrors.push(error.message));
    const target = new URL(url); target.searchParams.set("theme", theme);
    await page.goto(target.href);
    await page.evaluate(() => sessionStorage.clear());
    await page.goto(target.href);
    assert.equal(await page.title(), "Isolated Origin canvas");
    await page.getByRole("toolbar", { name: "Canvas tools" }).waitFor();
    const result = { theme, width };
    const capture = async (name) => {
      await page.waitForTimeout(120);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: resolve(output, `${name}-${width}-${theme}.png`) });
    };
    const nodes = () => page.evaluate(() => window.originDrawFixture.scene.map((row) => JSON.parse(row)).filter((node) => !node.deleted));
    const named = async (name, type) => (await nodes()).find((node) => node.name === name && (!type || node.type === type));
    const fit = () => page.getByRole("button", { name: "Fit", exact: true }).click();
    const stage = await page.locator("[data-canvas-stage]").boundingBox();
    const at = (dx, dy) => ({ x: stage.x + stage.width / 2 + dx, y: stage.y + stage.height / 2 + dy });
    const drag = async (from, to) => { await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 6 }); await page.mouse.up(); };
    await capture("empty");

    await page.keyboard.press("f");
    await drag(at(-140, -150), at(140, 150));
    await page.waitForFunction(() => window.originDrawFixture.scene.some((row) => JSON.parse(row).type === "frame"));
    const frame = await named("Frame 1", "frame");
    assert.ok(frame && frame.width > 100);
    await page.keyboard.press("r");
    await drag(at(-100, -110), at(0, -40));
    await page.keyboard.press("t");
    await page.mouse.click(at(-100, 20).x, at(-100, 20).y);
    await page.keyboard.type("Hello canvas");
    await page.keyboard.press("Escape");
    await page.keyboard.press("o");
    await drag(at(20, 40), at(90, 110));
    await page.keyboard.press("Shift+L");
    await drag(at(-100, 120), at(80, 130));
    await page.waitForFunction(() => window.originDrawFixture.scene.length >= 5);
    const drawn = await nodes();
    assert.deepEqual(drawn.map((node) => node.type).sort(), ["arrow", "ellipse", "frame", "rect", "text"]);
    assert.ok(drawn.filter((node) => node.type !== "frame").every((node) => node.parentId === frame.id));
    assert.equal(drawn.find((node) => node.type === "text").text, "Hello canvas");
    await capture("drawn");

    const rect = drawn.find((node) => node.type === "rect");
    await page.keyboard.press("v");
    const rectBox = await page.locator(`[data-node-id="${rect.id}"]`).boundingBox();
    await drag({ x: rectBox.x + 20, y: rectBox.y + 20 }, { x: rectBox.x + 60, y: rectBox.y + 45 });
    await page.waitForFunction(() => !document.body.textContent.includes("Saving…"));
    const moved = (await nodes()).find((node) => node.id === rect.id);
    assert.ok(moved.x > rect.x && moved.y > rect.y);
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(300);
    assert.equal((await nodes()).find((node) => node.id === rect.id).x, rect.x);
    await page.keyboard.press("Control+Shift+z");
    await page.waitForTimeout(250);
    assert.equal((await nodes()).find((node) => node.id === rect.id).x, moved.x);
    await page.keyboard.press("Control+d");
    await page.waitForTimeout(250);
    assert.equal((await nodes()).filter((node) => node.type === "rect").length, 2);
    await page.keyboard.press("Delete");
    await page.waitForTimeout(250);
    assert.equal((await nodes()).filter((node) => node.type === "rect").length, 1);
    result.drawMoveUndoDuplicateDelete = true;

    const held = (await nodes()).find((node) => node.type === "rect");
    const heldBox = await page.locator(`[data-node-id="${held.id}"]`).boundingBox();
    await page.mouse.move(heldBox.x + 10, heldBox.y + 10);
    await page.mouse.down();
    await page.mouse.move(heldBox.x + 40, heldBox.y + 30, { steps: 4 });
    await page.waitForFunction(({ id, x }) => window.originDrawFixture.scene.some((row) => { const node = JSON.parse(row); return node.id === id && node.x !== x; }), { id: held.id, x: held.x });
    await page.mouse.up();
    await page.keyboard.press("Control+z");
    await page.waitForFunction(({ id, x }) => window.originDrawFixture.scene.some((row) => { const node = JSON.parse(row); return node.id === id && node.x === x; }), { id: held.id, x: held.x });
    result.dragSharedWhileHeld = true;

    if (width < 500) {
      await page.getByRole("button", { name: "Layers", exact: true }).click();
      await page.locator('aside[aria-label="Layers"]').waitFor();
      const rectangle = await page.getByRole("button", { name: "Rectangle", exact: true }).boundingBox();
      assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("button")?.getAttribute("aria-label"), { x: rectangle.x + rectangle.width / 2, y: rectangle.y + rectangle.height / 2 }), "Rectangle");
      await capture("layers-open");
      await page.getByRole("button", { name: "Design panel", exact: true }).click();
      assert.equal(await page.locator('aside[aria-label="Layers"]').count(), 0);
      await page.getByRole("button", { name: "Design panel", exact: true }).click();
      result.narrowPanelsKeepToolbar = true;
    }

    await page.evaluate((rows) => window.originDrawFixture.remote(rows), [...agentRows, ...legacyRows]);
    await page.waitForFunction(() => window.originDrawFixture.requests.some((request) => request.name === "draw:updateElements" && request.args.elements.some((row) => row.includes("Simple pricing"))));
    assert.ok(!(await nodes()).some((node) => node.unmeasured));
    assert.equal(await page.locator('[data-node-id="legacy-note"] text').textContent(), "Old sketch note");
    await fit();
    await capture("agent-section");
    result.agentSectionMeasured = true;
    result.legacyConverted = true;

    if (width >= 1000) {
      const plans = await named("Plans", "frame");
      const starter = await named("Starter", "frame");
      await page.locator('[role="tree"]').getByText("Starter", { exact: true }).first().click();
      const starterBox = await page.locator(`[data-node-id="${starter.id}"]`).first().boundingBox();
      const from = { x: starterBox.x + starterBox.width / 2, y: starterBox.y + starterBox.height - 6 };
      await page.keyboard.down("Alt");
      await drag(from, { x: from.x + 30, y: from.y });
      await page.keyboard.up("Alt");
      await page.waitForFunction(() => window.originDrawFixture.scene.filter((row) => { const node = JSON.parse(row); return node.name === "Starter" && node.type === "frame" && !node.deleted; }).length === 2);
      const copies = (await nodes()).filter((node) => node.name === "Starter" && node.type === "frame");
      assert.ok(copies.every((node) => node.parentId === plans.id));
      await page.keyboard.press("Control+z");
      await page.waitForFunction(() => window.originDrawFixture.scene.filter((row) => { const node = JSON.parse(row); return node.name === "Starter" && node.type === "frame" && !node.deleted; }).length === 1);
      result.altDragInAutoLayout = true;
    }

    if (width >= 1000) {
      const team = await named("Team", "frame");
      const teamBox = await page.locator(`[data-node-id="${team.id}"]`).first().boundingBox();
      await page.mouse.click(teamBox.x + 12, teamBox.y + 12);
      await page.waitForTimeout(450);
      await page.mouse.dblclick(teamBox.x + 12, teamBox.y + 12);
      await page.locator('aside[aria-label="Design"]').getByText("Team", { exact: true }).first().waitFor();
      await page.getByLabel("R", { exact: true }).fill("4");
      await page.getByLabel("R", { exact: true }).press("Enter");
      await page.waitForFunction((id) => window.originDrawFixture.scene.some((row) => { const node = JSON.parse(row); return node.id === id && node.radius === 4; }), team.id);
      const plans = await named("Plans", "frame");
      await page.locator('[role="tree"]').getByText("Plans", { exact: true }).click();
      await page.getByLabel("⇵").fill("64");
      await page.getByLabel("⇵").press("Enter");
      await page.waitForFunction((id) => window.originDrawFixture.scene.some((row) => { const node = JSON.parse(row); return node.id === id && node.layout?.gap === 64; }), plans.id);
      await page.locator('[role="tree"]').getByText("Plans", { exact: true }).hover();
      await page.getByRole("button", { name: "Hide Plans" }).click();
      await page.waitForFunction((id) => window.originDrawFixture.scene.some((row) => { const node = JSON.parse(row); return node.id === id && node.hidden; }), plans.id);
      await page.getByRole("button", { name: "Show Plans" }).click();
      await capture("inspector");
      const [png] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "PNG", exact: true }).click()]);
      assert.equal(png.suggestedFilename(), "Plans.png");
      const [svg] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "SVG", exact: true }).click()]);
      assert.equal(svg.suggestedFilename(), "Plans.svg");
      await page.getByRole("button", { name: "Save to Assets" }).click();
      await page.getByText("Saved Plans.png to Assets").waitFor();
      result.inspectorLayersExport = true;

      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Image", exact: true }).click();
      await page.getByRole("button", { name: "Insert Brand mark" }).click();
      await page.waitForFunction(() => window.originDrawFixture.scene.some((row) => JSON.parse(row).fileId === "asset-asset-logo"));
      result.assetImage = true;

      await page.getByRole("button", { name: "Ask Atlas" }).click();
      await page.getByRole("textbox", { name: "Question" }).fill("Design a pricing section next to this");
      await capture("ask");
      await page.getByRole("button", { name: "Send to Atlas" }).click();
      await page.waitForFunction(() => window.originCanvasSent.some((action) => action.type === "send"));
      const sent = await page.evaluate(() => window.originCanvasSent.find((action) => action.type === "send").text);
      assert.match(sent, /Design a pricing section next to this/);
      assert.match(sent, /origin_canvas_edit/);
      result.askChief = true;
    }

    target.searchParams.set("viewer", "1");
    await page.goto(target.href);
    await page.getByText("View only", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Rectangle", exact: true }).count(), 0);
    const before = await page.evaluate(() => window.originDrawFixture.scene.join("\n"));
    await drag(at(0, 0), at(40, 40));
    await page.keyboard.press("Delete");
    assert.equal(await page.evaluate(() => window.originDrawFixture.scene.join("\n")), before);
    await capture("viewer");
    result.viewerReadOnly = true;

    target.searchParams.delete("viewer"); target.searchParams.set("project", "1");
    await page.goto(target.href);
    await page.getByRole("button", { name: "New file", exact: true }).click();
    await page.getByRole("textbox", { name: "Name" }).fill("Landing page");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await page.getByRole("tab", { name: "Landing page", exact: true }).waitFor();
    await page.getByRole("button", { name: "Landing page options" }).click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    await page.getByRole("textbox", { name: "Name" }).fill("Launch page");
    await page.getByRole("textbox", { name: "Name" }).press("Enter");
    await page.getByRole("tab", { name: "Launch page", exact: true }).waitFor();
    await capture("project");
    await page.getByRole("button", { name: "Launch page options" }).click();
    await page.getByRole("menuitem", { name: "Delete…" }).click();
    await page.getByRole("menuitem", { name: "Delete design file" }).click();
    await page.getByRole("tab", { name: "Launch page", exact: true }).waitFor({ state: "detached" });
    result.projectCanvases = true;

    target.searchParams.delete("project"); target.searchParams.set("design", "1");
    await page.goto(target.href);
    await page.getByRole("button", { name: "Board", exact: true }).click();
    await page.getByRole("tab", { name: "Launch retro", exact: true }).waitFor();
    const ground = await page.locator("[data-canvas-stage]").boundingBox();
    const board = () => page.evaluate(() => window.originDrawFixture.requests.filter((item) => item.name === "draw:updateElements" && item.args.canvasId === "fixture-board").flatMap((item) => item.args.elements.map((row) => JSON.parse(row))));
    await page.mouse.click(ground.x + ground.width - 60, ground.y + 60);
    await page.keyboard.press("d");
    await page.getByRole("radiogroup", { name: "Ink colour" }).getByRole("radio", { name: "#1971C2" }).click();
    await page.mouse.move(ground.x + ground.width - 300, ground.y + ground.height - 220);
    await page.mouse.down();
    for (let step = 1; step <= 12; step++) await page.mouse.move(ground.x + ground.width - 300 + step * 15, ground.y + ground.height - 220 + Math.sin(step / 2) * 30);
    await page.mouse.up();
    await page.keyboard.press("s");
    await page.mouse.click(ground.x + ground.width - 200, ground.y + 160);
    await page.keyboard.type("Ship the eraser");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => window.originDrawFixture.requests.some((item) => item.name === "draw:updateElements" && item.args.elements.some((row) => row.includes("Ship the eraser"))));
    const sketched = await board();
    assert.ok(sketched.some((node) => node.type === "path" && node.stroke === "#1971C2" && node.points.length >= 6), "the pencil saves a smoothed path in the chosen ink");
    assert.ok(sketched.some((node) => node.type === "frame" && node.name === "Sticky"), "the sticky tool saves a sticky frame");
    await capture("board");
    await page.keyboard.press("x");
    const stroke = sketched.find((node) => node.type === "path" && node.stroke === "#1971C2");
    await page.mouse.move(ground.x + ground.width - 300 + 90, ground.y + ground.height - 300);
    await page.mouse.down();
    await page.mouse.move(ground.x + ground.width - 300 + 90, ground.y + ground.height - 140, { steps: 12 });
    await page.mouse.up();
    await page.waitForFunction((id) => window.originDrawFixture.requests.some((item) => item.name === "draw:updateElements" && item.args.elements.some((row) => row.includes(id) && row.includes('"deleted":true'))), stroke.id);
    result.board = true;

    await page.getByRole("button", { name: "Presentations", exact: true }).click();
    await page.locator("[data-design-page='deck'] [data-canvas-stage]").waitFor();
    if (!(await page.locator("[data-deck-panel]").isVisible())) await page.getByRole("button", { name: "Layers", exact: true }).click();
    await page.locator("[data-deck-panel]").waitFor();
    assert.equal(await page.locator("[data-slide]").count(), 4);
    await page.locator("[data-slide]").nth(1).getByRole("button", { name: /Slide 2/ }).click();
    await page.locator("[data-add-slide]").click();
    await page.getByRole("menuitem", { name: "Big number" }).click();
    await page.locator("[data-slide]").nth(4).waitFor();
    assert.match(await page.locator("[data-slide]").nth(2).getByRole("button").first().getAttribute("aria-label"), /Slide 3: Slide 3/);
    await page.locator("[data-speaker-notes]").fill("Pause for questions.");
    await page.locator("[data-speaker-notes]").blur();
    await page.waitForFunction(() => window.originDrawFixture.requests.some((item) => item.name === "draw:updateElements" && item.args.canvasId === "fixture-deck" && item.args.elements.some((row) => row.includes("Pause for questions."))));
    await page.locator("[data-slide]").nth(3).hover();
    await page.locator("[data-slide]").nth(3).getByRole("button", { name: "Move slide up" }).click();
    assert.match(await page.locator("[data-slide]").nth(2).getByRole("button").first().getAttribute("aria-label"), /Faster from idea to launch/);
    await capture("deck");
    await page.locator("[data-present-deck]").click();
    await page.getByRole("dialog", { name: /Presenting Origin/ }).waitFor();
    await page.keyboard.press("ArrowRight");
    await page.locator("[data-present-notes]").getByText("Open with the launch-week story.").waitFor();
    await page.keyboard.press("Escape");
    result.deck = true;
    evidence.cases.push(result);
    await page.close();
  }
  assert.deepEqual(evidence.pageErrors, []);
  await writeFile(resolve(output, "browser-checks.json"), JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence));
} finally { await browser.close(); }
