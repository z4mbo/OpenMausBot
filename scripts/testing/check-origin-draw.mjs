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
    await page.waitForFunction((id) => window.originDrawFixture.scene.some((row) => { const node = JSON.parse(row); return node.id === id && node.version > 1; }), rect.id);
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

    await page.evaluate((rows) => window.originDrawFixture.remote(rows), [...agentRows, ...legacyRows]);
    await page.waitForFunction(() => window.originDrawFixture.requests.some((request) => request.name === "draw:updateElements" && request.args.elements.some((row) => row.includes("Simple pricing"))));
    assert.ok(!(await nodes()).some((node) => node.unmeasured));
    assert.equal(await page.locator('[data-node-id="legacy-note"] text').textContent(), "Old sketch note");
    await fit();
    await capture("agent-section");
    result.agentSectionMeasured = true;
    result.legacyConverted = true;

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
    await page.getByRole("button", { name: "New canvas", exact: true }).click();
    await page.getByRole("textbox", { name: "Canvas name" }).fill("Landing page");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await page.getByRole("tab", { name: "Landing page", exact: true }).waitFor();
    await page.getByRole("button", { name: "Landing page options" }).click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    await page.getByRole("textbox", { name: "Canvas name" }).fill("Launch page");
    await page.getByRole("textbox", { name: "Canvas name" }).press("Enter");
    await page.getByRole("tab", { name: "Launch page", exact: true }).waitFor();
    await capture("project");
    await page.getByRole("button", { name: "Launch page options" }).click();
    await page.getByRole("menuitem", { name: "Delete…" }).click();
    await page.getByRole("menuitem", { name: "Delete canvas" }).click();
    await page.getByRole("tab", { name: "Launch page", exact: true }).waitFor({ state: "detached" });
    result.projectCanvases = true;
    evidence.cases.push(result);
    await page.close();
  }
  assert.deepEqual(evidence.pageErrors, []);
  await writeFile(resolve(output, "browser-checks.json"), JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence));
} finally { await browser.close(); }
