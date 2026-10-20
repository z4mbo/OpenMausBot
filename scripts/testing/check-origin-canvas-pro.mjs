import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { applyCanvasOps } from "../../shared/canvas-ops.ts";
import { encodeNode } from "../../shared/canvas-scene.ts";
const url = new URL(process.argv[2] ?? "");
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, "/__origin-draw.html");
const output = resolve("docs/verification/evidence/origin-canvas-pro");
await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.OMB_VERIFY_PLAYWRIGHT || "playwright");

const crowd = applyCanvasOps(new Map(), [{ op: "create", node: {
  type: "frame", name: "Crowd", x: 3000, y: 0, w: 2400, h: 2400, fill: "#FFFFFF",
  children: Array.from({ length: 1500 }, (_, at) => ({ type: at % 3 ? "rect" : "ellipse", name: `Dot ${at}`, x: (at % 40) * 60, y: Math.floor(at / 40) * 60, w: 40, h: 40, fill: at % 2 ? "#6366F1" : "#F59E0B" })),
} }]).changed.map(encodeNode);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><rect x="4" y="4" width="50" height="30" rx="6" fill="#22C55E"/><path d="M70 10 C90 0 110 20 100 40 Z" fill="#EF4444"/><circle cx="30" cy="60" r="12" fill="none" stroke="#0EA5E9" stroke-width="3"/></svg>';

const browser = await chromium.launch();
const evidence = { checkedAt: new Date().toISOString(), previewUrl: url.href, cases: [], pageErrors: [] };
try {
  for (const [theme, width] of [["dark", 1280], ["light", 1280], ["dark", 375]]) {
    const page = await browser.newPage({ viewport: { width, height: width < 500 ? 812 : 900 }, reducedMotion: "reduce", acceptDownloads: true });
    page.on("pageerror", (error) => evidence.pageErrors.push(error.message));
    const target = new URL(url); target.searchParams.set("theme", theme);
    await page.goto(target.href);
    await page.evaluate(() => sessionStorage.clear());
    await page.goto(target.href);
    await page.getByRole("toolbar", { name: "Canvas tools" }).waitFor();
    const result = { theme, width };
    const capture = async (name) => {
      await page.waitForTimeout(150);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} scrolls sideways`);
      if (name.startsWith("round5-") && theme !== "dark") return;
      await page.screenshot({ path: resolve(output, `${name}-${width}-${theme}.png`) });
    };
    const nodes = () => page.evaluate(() => window.originDrawFixture.scene.map((row) => JSON.parse(row)).filter((node) => !node.deleted));
    const named = async (name, type) => (await nodes()).find((node) => node.name === name && (!type || node.type === type));
    const until = (fn, arg) => page.waitForFunction(fn, arg, { timeout: 10_000 });
    const stage = await page.locator("[data-canvas-stage]").boundingBox();
    const at = (dx, dy) => ({ x: stage.x + stage.width / 2 + dx, y: stage.y + stage.height / 2 + dy });
    const drag = async (from, to, steps = 6) => { await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps }); await page.mouse.up(); };
    const design = page.locator('aside[aria-label="Design"]');
    const selectLayer = async (name) => { await page.locator('[role="tree"]').getByText(name, { exact: true }).first().click(); };

    try {
    if (width >= 1000) {
      await page.keyboard.press("f");
      await drag(at(-300, -250), at(100, 150));
      await until(() => window.originDrawFixture.scene.some((row) => JSON.parse(row).type === "frame"));
      const frame = await named("Frame 1", "frame");

      await page.keyboard.press("p");
      await page.mouse.click(at(-260, -200).x, at(-260, -200).y);
      await drag(at(-180, -220), at(-150, -180), 4);
      await page.mouse.click(at(-120, -120).x, at(-120, -120).y);
      await page.keyboard.press("Enter");
      await until(() => window.originDrawFixture.scene.some((row) => JSON.parse(row).type === "path"));
      const vector = (await nodes()).find((node) => node.type === "path");
      assert.equal(vector.points.length, 6);
      assert.ok(vector.curves?.some((value) => value !== 0), "the dragged anchor has handles");
      assert.equal(vector.parentId, frame.id);
      await page.keyboard.press("Enter");
      await page.locator('[data-anchor="0:point"]').waitFor();
      const anchor = await page.locator('[data-anchor="0:point"]').boundingBox();
      await drag({ x: anchor.x + 4, y: anchor.y + 4 }, { x: anchor.x - 30, y: anchor.y + 20 });
      await until((id) => window.originDrawFixture.scene.some((row) => { const node = JSON.parse(row); return node.id === id && node.version > 1 && node.x < 0 + node.x + 1; }), vector.id);
      const edited = (await nodes()).find((node) => node.id === vector.id);
      assert.notDeepEqual(edited.points, vector.points);
      const segment = await page.evaluate(() => {
        const path = document.querySelector('[data-segment="0:1"]');
        const point = path.getPointAtLength(path.getTotalLength() / 2);
        const box = path.ownerSVGElement.getBoundingClientRect();
        return { x: box.left + point.x, y: box.top + point.y };
      });
      await page.mouse.click(segment.x, segment.y);
      await until((id) => window.originDrawFixture.scene.some((row) => { const node = JSON.parse(row); return node.id === id && node.points.length === 8; }), vector.id);
      result.addPointOnSegment = true;
      await page.keyboard.press("Escape");
      await capture("pen-path");
      result.penAndBezierEditing = true;

      await page.keyboard.press("Escape");
      await page.keyboard.press("r");
      await drag(at(-60, -200), at(40, -100));
      await page.keyboard.press("r");
      await drag(at(0, -160), at(90, -60));
      await until(() => window.originDrawFixture.scene.filter((row) => JSON.parse(row).type === "rect").length === 2);
      await page.keyboard.press("v");
      await selectLayer("Rectangle");
      await page.locator('[role="tree"]').getByText("Rectangle", { exact: true }).nth(1).click({ modifiers: ["Shift"] });
      await design.getByRole("button", { name: "Union" }).waitFor();
      await page.keyboard.press("Control+Alt+u");
      await until(() => window.originDrawFixture.scene.some((row) => { const node = JSON.parse(row); return node.name === "Union" && !node.deleted; }));
      const union = await named("Union", "group");
      assert.equal(union.boolean, "union");
      assert.equal((await nodes()).filter((node) => node.type === "rect" && node.parentId === union.id).length, 2, "the union keeps its rectangles");
      await page.keyboard.press("Control+z");
      await until(() => window.originDrawFixture.scene.filter((row) => { const node = JSON.parse(row); return node.type === "rect" && !node.deleted; }).length === 2);
      await selectLayer("Rectangle");
      await page.locator('[role="tree"]').getByText("Rectangle", { exact: true }).nth(1).click({ modifiers: ["Shift"] });
      await design.getByRole("button", { name: "Subtract" }).click();
      await until(() => window.originDrawFixture.scene.some((row) => { const node = JSON.parse(row); return node.name === "Subtract" && !node.deleted; }));
      const subtract = await named("Subtract", "group");
      await page.locator("[data-canvas-stage]").focus();
      await page.keyboard.press("Enter");
      await design.getByLabel("W", { exact: true }).fill("60");
      await design.getByLabel("W", { exact: true }).press("Enter");
      await until((id) => { const rows = window.originDrawFixture.scene.map((row) => JSON.parse(row)).filter((node) => node.parentId === id && !node.deleted); return rows.length === 2 && rows.every((node) => node.width === 60); }, subtract.id);
      assert.equal((await named("Subtract", "group")).boolean, "subtract");
      await page.keyboard.press("Escape");
      await capture("round5-boolean");
      result.booleans = true;
      result.booleanGroupEditableChildren = true;

      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await page.keyboard.press("f");
      await drag(at(200, -250), at(330, -190));
      await until(() => window.originDrawFixture.scene.filter((row) => JSON.parse(row).type === "frame").length === 2);
      const card = (await nodes()).filter((node) => node.type === "frame").sort((a, b) => b.x - a.x)[0];
      await page.keyboard.press("t");
      await page.mouse.click(at(215, -230).x, at(215, -230).y);
      await page.keyboard.type("Buy");
      await page.keyboard.press("Escape");
      await selectLayer(card.name);
      await page.keyboard.press("Control+Alt+k");
      await until((id) => window.originDrawFixture.scene.some((row) => { const node = JSON.parse(row); return node.id === id && node.component; }), card.id);
      await page.getByRole("tab", { name: "Assets" }).click();
      await page.getByRole("button", { name: `Insert ${card.name}` }).click();
      await until(() => window.originDrawFixture.scene.some((row) => JSON.parse(row).instanceOf));
      const instance = (await nodes()).find((node) => node.instanceOf);
      assert.equal(instance.instanceOf, card.id);
      await capture("assets");
      await page.getByRole("tab", { name: "Layers" }).click();
      await selectLayer(card.name);
      await design.getByLabel("Fill hex").fill("#7C3AED");
      await design.getByLabel("Fill hex").press("Enter");
      await until((id) => window.originDrawFixture.scene.some((row) => { const node = JSON.parse(row); return node.id === id && node.fill === "#7C3AED"; }), instance.id);
      await page.locator('[role="tree"]').getByText(card.name, { exact: true }).nth(0).click();
      await page.evaluate((id) => { const node = window.originDrawFixture.scene.map((row) => JSON.parse(row)).find((item) => item.id === id); return node; }, instance.id);
      result.componentsAndInstances = true;

      await selectLayer(frame.name);
      await design.getByRole("button", { name: "Add layout grid" }).click();
      await until((id) => window.originDrawFixture.scene.some((row) => { const node = JSON.parse(row); return node.id === id && node.grids?.length === 1; }), frame.id);
      await design.getByRole("button", { name: "Shadow" }).click();
      await until((id) => window.originDrawFixture.scene.some((row) => { const node = JSON.parse(row); return node.id === id && node.shadow; }), frame.id);
      await design.getByRole("button", { name: "Remove shadow" }).click();
      await until((id) => window.originDrawFixture.scene.some((row) => { const node = JSON.parse(row); return node.id === id && !node.shadow; }), frame.id);
      await selectLayer("Subtract");
      await design.getByLabel("Horizontal constraint").selectOption("right");
      await until(() => window.originDrawFixture.scene.some((row) => { const node = JSON.parse(row); return node.name === "Subtract" && !node.deleted && node.constraints?.h === "right"; }));
      const before = await named("Subtract", "group");
      await selectLayer(frame.name);
      await design.getByLabel("W", { exact: true }).fill(String(Math.round(frame.width + 100)));
      await design.getByLabel("W", { exact: true }).press("Enter");
      await until((x) => window.originDrawFixture.scene.some((row) => { const node = JSON.parse(row); return node.name === "Subtract" && !node.deleted && Math.abs(node.x - x) < 1; }), before.x + 100);
      await capture("grid-constraints");
      result.gridsEffectsConstraints = true;

      await selectLayer(frame.name);
      await design.getByRole("button", { name: "Independent corners" }).click();
      await design.getByLabel("Top left radius").fill("24");
      await design.getByLabel("Top left radius").press("Enter");
      await until((id) => window.originDrawFixture.scene.some((row) => { const node = JSON.parse(row); return node.id === id && node.radii?.[0] === 24; }), frame.id);
      await design.getByRole("button", { name: "Linear gradient" }).click();
      await until((id) => window.originDrawFixture.scene.some((row) => { const node = JSON.parse(row); return node.id === id && node.gradient?.kind === "linear"; }), frame.id);
      await design.getByLabel("Stop 2 hex").fill("#C7D2FE");
      await design.getByLabel("Stop 2 hex").press("Enter");
      await design.getByLabel("Gradient angle").fill("45");
      await design.getByLabel("Gradient angle").press("Enter");
      await until((id) => window.originDrawFixture.scene.some((row) => { const node = JSON.parse(row); return node.id === id && node.gradient?.angle === 45 && node.gradient.stops[1].color === "#C7D2FE"; }), frame.id);
      await capture("round5-paint");
      result.cornerRadiiAndGradient = true;

      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await page.keyboard.press("i");
      await page.getByRole("button", { name: "Insert Brand mark" }).click();
      await until(() => window.originDrawFixture.scene.some((row) => JSON.parse(row).type === "image"));
      const image = (await nodes()).find((node) => node.type === "image");
      await design.getByRole("button", { name: "Crop: zoom and move the image" }).click();
      await until((id) => window.originDrawFixture.scene.some((row) => { const node = JSON.parse(row); return node.id === id && node.imageFit === "crop"; }), image.id);
      await page.locator("[data-canvas-stage]").focus();
      await page.keyboard.press("Enter");
      await page.locator("[data-crop-frame]").waitFor();
      const picture = await page.locator(`[data-node-id="${image.id}"]`).first().boundingBox();
      await drag({ x: picture.x + picture.width / 2, y: picture.y + picture.height / 2 }, { x: picture.x + picture.width / 2 + 12, y: picture.y + picture.height / 2 + 8 });
      await until((id) => window.originDrawFixture.scene.some((row) => { const node = JSON.parse(row); return node.id === id && node.crop && node.crop.x > -0.125; }), image.id);
      await capture("round5-crop");
      await page.keyboard.press("Escape");
      result.imageCrop = true;

      await selectLayer("Buy");
      await design.getByLabel("Text style").selectOption("h1");
      await until(() => window.originDrawFixture.scene.some((row) => { const node = JSON.parse(row); return node.text === "Buy" && node.textStyle === "h1" && node.fontSize === 44; }));
      result.textStyles = true;

      await selectLayer(frame.name);
      await page.keyboard.press("Shift+a");
      await design.getByLabel("Direction").getByRole("button", { name: "Horizontal" }).click();
      await design.getByText("Wrap", { exact: true }).click();
      await until((id) => window.originDrawFixture.scene.some((row) => { const node = JSON.parse(row); return node.id === id && node.layout?.wrap; }), frame.id);
      await page.keyboard.press("Control+z");
      await page.keyboard.press("Control+z");
      await page.keyboard.press("Control+z");
      result.autoLayoutWrap = true;

      await page.getByRole("tab", { name: "Code" }).click();
      await design.getByLabel("Generated code").waitFor();
      assert.match(await design.getByLabel("Generated code").textContent(), /export function/);
      await design.getByRole("button", { name: "Tailwind" }).click();
      assert.match(await design.getByLabel("Generated code").textContent(), /w-\[/);
      await capture("dev-mode");
      result.devMode = true;

      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await page.keyboard.press("f");
      await drag(at(-250, 190), at(-120, 280));
      await until(() => window.originDrawFixture.scene.filter((row) => { const node = JSON.parse(row); return node.type === "frame" && !node.parentId && !node.component && !node.instanceOf && !node.deleted; }).length === 2);
      const second = (await nodes()).filter((node) => node.type === "frame" && !node.parentId).sort((a, b) => b.y - a.y)[0];
      await selectLayer(frame.name);
      await page.getByRole("tab", { name: "Prototype" }).click();
      await design.getByLabel("Navigate to").selectOption(second.id);
      await until((id) => window.originDrawFixture.scene.some((row) => JSON.parse(row).prototype?.to === id), second.id);
      await page.locator("[data-prototype-link]").first().waitFor();
      await page.keyboard.press("Control+Alt+Enter");
      const presenting = page.getByRole("dialog", { name: `Presenting ${frame.name}` });
      await presenting.waitFor();
      await capture("present");
      await presenting.getByRole("img", { name: frame.name }).click({ position: { x: 20, y: 20 } });
      await page.getByRole("dialog", { name: `Presenting ${second.name}` }).waitFor();
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "detached" });
      await page.getByRole("tab", { name: "Design" }).click();
      result.prototypeAndPresent = true;

      await page.evaluate((svg) => {
        const data = new DataTransfer();
        data.setData("text/plain", svg);
        window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data }));
      }, SVG);
      await until(() => window.originDrawFixture.scene.some((row) => { const node = JSON.parse(row); return node.type === "ellipse" && node.stroke === "#0EA5E9" && node.parentId; }));
      const holder = (await nodes()).find((node) => node.type === "ellipse" && node.stroke === "#0EA5E9").parentId;
      assert.deepEqual((await nodes()).filter((node) => node.parentId === holder).map((node) => node.type).sort(), ["ellipse", "path", "rect"]);
      result.svgImport = true;

      await selectLayer(frame.name);
      const [pdf] = await Promise.all([page.waitForEvent("download"), design.getByRole("button", { name: "PDF", exact: true }).click()]);
      assert.equal(pdf.suggestedFilename(), `${frame.name}.pdf`);
      const bytes = await readFile(await pdf.path());
      assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
      assert.match(bytes.toString("latin1"), /\/Filter \/DCTDecode/);
      result.pdfExport = true;

      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await page.keyboard.press("c");
      const frameBox = await page.locator(`[data-node-id="${frame.id}"]`).first().boundingBox();
      await page.mouse.click(frameBox.x + 40, frameBox.y + 40);
      const composer = page.getByRole("textbox", { name: /^Comment on/ });
      await composer.fill("Tighten this @Fix");
      await page.getByRole("option", { name: /Fixture teammate/ }).click();
      await composer.press("Enter");
      await until(() => window.originDrawFixture.comments.length === 1);
      const comment = await page.evaluate(() => window.originDrawFixture.comments[0]);
      assert.ok(comment.nodeId, "the comment is pinned to the layer under it");
      assert.deepEqual(comment.mentions.map((item) => item.name), ["Fixture teammate"]);
      await page.locator(`[data-comment-pin="${comment._id}"]`).click();
      await page.getByRole("textbox", { name: "Reply" }).fill("Done");
      await page.getByRole("textbox", { name: "Reply" }).press("Enter");
      await until(() => window.originDrawFixture.comments.length === 2);
      await capture("comments");
      await page.getByRole("button", { name: "Resolve thread" }).click();
      await until(() => window.originDrawFixture.comments[0].resolved === true);
      await page.keyboard.press("v");
      result.comments = true;

      const ruler = await page.locator('[data-canvas-chrome] > div[aria-hidden="true"]').first().boundingBox();
      await drag({ x: ruler.x + 300, y: ruler.y + 10 }, { x: ruler.x + 300, y: ruler.y + 200 });
      await until(() => window.originDrawFixture.pages[0].guides?.length === 1);
      result.rulersGuides = true;

      await page.getByRole("button", { name: "Version history" }).click();
      await page.getByLabel("Version name").fill("Before cleanup");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.getByText("Before cleanup").waitFor();
      const count = (await nodes()).length;
      await page.getByRole("button", { name: "Version history" }).click();
      await selectLayer(second.name);
      await page.keyboard.press("Delete");
      await until((total) => window.originDrawFixture.scene.filter((row) => !JSON.parse(row).deleted).length < total, count);
      await page.getByRole("button", { name: "Version history" }).click();
      await page.getByRole("button", { name: "Restore Before cleanup" }).click();
      await page.getByRole("button", { name: "Restore", exact: true }).click();
      await until((total) => window.originDrawFixture.scene.filter((row) => !JSON.parse(row).deleted).length === total, count);
      await capture("versions");
      await page.getByRole("button", { name: "Version history" }).click();
      result.versionHistory = true;

      await page.evaluate(({ frameId, frameName }) => {
        window.originDrawFixture.select("other", [frameId]);
        window.originDrawFixture.agent("Atlas", 120, 80, [frameId]);
        window.originDrawFixture.link(frameId, frameName);
      }, { frameId: frame.id, frameName: frame.name });
      await page.locator('[data-cursor="agent"]').waitFor();
      await page.locator('[data-remote-selection="Fixture teammate"]').waitFor();
      await page.locator(`[data-issue-chip]`).waitFor();
      await capture("presence-agent");
      result.presenceSelectionsAgentCursorIssueChip = true;

      await page.getByRole("button", { name: "Ask Atlas" }).click();
      await page.waitForFunction(() => {
        const panel = document.querySelector("[data-agent-panel]")?.getBoundingClientRect();
        const chrome = [document.querySelector('[aria-label="Zoom out"]')?.parentElement, document.querySelector('[role="toolbar"][aria-label="Canvas tools"]')];
        return panel && chrome.every((element) => element && element.getBoundingClientRect().right <= panel.left);
      }, undefined, { timeout: 5_000 });
      await page.getByLabel("Design an issue").selectOption("fixtureissue0001");
      await page.getByRole("button", { name: "Send to Atlas" }).click();
      await page.waitForFunction(() => window.originCanvasSent.some((action) => action.type === "send" && action.text.includes("origin_design_submit")));
      await capture("agent-panel");
      await page.route("**/api/threads/fixture-designer-thread/messages*", async (route) => {
        const asked = await page.evaluate(() => window.originCanvasSent.filter((action) => action.type === "send" && action.botId === "fixture-designer").at(-1));
        const at = Date.now();
        await route.fulfill({ json: { messages: [
          { id: "dana-1", role: "user", kind: "text", text: asked.text, sendId: asked.sendId, at },
          { id: "dana-2", role: "bot", kind: "activity", tool: { name: "origin_canvas_edit", ok: true }, at },
          { id: "dana-3", role: "bot", kind: "text", text: "Laying out three pricing tiers next to the hero", status: "streaming", at },
        ] } });
      });
      await page.getByLabel("Agent to ask").selectOption("fixture-designer");
      await page.getByLabel("Question").fill("Add a pricing section");
      await page.getByRole("button", { name: "Send to Dana" }).click();
      await page.locator("[data-agent-panel]").getByText("Laying out three pricing tiers next to the hero").waitFor();
      await page.locator("[data-agent-panel]").getByText("Edited the canvas").waitFor();
      await capture("round5-agent-stream");
      result.agentPanelStreamsChosenAgent = true;
      await page.locator("[data-agent-panel]").getByRole("button", { name: "Close" }).click();
      result.agentPanelDesignIssue = true;

      assert.equal(await page.getByRole("button", { name: "Add page" }).count(), 0, "a canvas is one page");
      assert.equal(await page.getByRole("button", { name: /^Published pages/ }).count(), 0, "no published pages menu");
      result.onePageNoPublishing = true;

      await page.getByRole("tab", { name: "Assets" }).click();
      await page.getByRole("button", { name: "Design system" }).click();
      await until(() => { const rows = window.originDrawFixture.scene.map((row) => JSON.parse(row)).filter((node) => !node.deleted); return rows.some((node) => node.name === "Design system" && !node.parentId) && rows.filter((node) => node.component?.set === "Button").length === 2; });
      await page.waitForTimeout(300);
      await capture("round5-design-system");
      await page.getByRole("tab", { name: "Layers" }).click();
      result.designSystemFromBrand = true;

      if (theme === "dark") {
        const zoomLabel = () => page.getByRole("button", { name: "Zoom to 100%" }).textContent();
        const pressed = () => page.evaluate(() => [...document.querySelectorAll('[role="toolbar"] button[aria-pressed="true"]')].map((button) => button.getAttribute("aria-label")));
        for (const [key, tool] of [["h", "Hand"], ["l", "Line"], ["o", "Ellipse"], ["e", "Ellipse"], ["r", "Rectangle"], ["t", "Text"], ["f", "Frame"], ["p", "Pen"], ["c", "Comment"], ["Shift+l", "Arrow"], ["v", "Move"]]) {
          await page.keyboard.press(key);
          assert.ok((await pressed()).includes(tool), `${key} picks ${tool}`);
        }
        await page.keyboard.press("l");
        await drag(at(-200, 100), at(-100, 140));
        await page.keyboard.press("r");
        await drag(at(-60, 60), at(0, 120));
        await page.keyboard.press("o");
        await drag(at(-30, 90), at(40, 150));
        await until(() => window.originDrawFixture.scene.filter((row) => JSON.parse(row).page === "page-3").length === 3);
        const mine = async () => (await nodes()).filter((node) => node.page === "page-3");
        await page.keyboard.press("Control+a");
        await page.keyboard.press("Control+g");
        await until(() => window.originDrawFixture.scene.some((row) => { const node = JSON.parse(row); return node.type === "group" && !node.deleted && node.page === "page-3"; }));
        await page.keyboard.press("Control+Shift+g");
        await until(() => !window.originDrawFixture.scene.some((row) => { const node = JSON.parse(row); return node.type === "group" && !node.deleted && node.page === "page-3"; }));
        await page.keyboard.press("Control+Alt+g");
        await until(() => window.originDrawFixture.scene.some((row) => { const node = JSON.parse(row); return node.type === "frame" && !node.deleted && node.page === "page-3"; }));
        await page.keyboard.press("Control+Shift+g");
        await until(() => !window.originDrawFixture.scene.some((row) => { const node = JSON.parse(row); return node.type === "frame" && !node.deleted && node.page === "page-3"; }));
        await page.keyboard.press("Escape");
        const ellipse = (await mine()).find((node) => node.type === "ellipse");
        const rect = (await mine()).find((node) => node.type === "rect");
        await page.locator('[role="tree"]').getByText("Rectangle", { exact: true }).last().click();
        await page.locator('[role="tree"]').getByText("Ellipse", { exact: true }).last().click({ modifiers: ["Shift"] });
        for (const [key, name] of [["Control+Alt+s", "Subtract"], ["Control+Alt+i", "Intersect"], ["Control+Alt+x", "Exclude"]]) {
          await page.keyboard.press(key);
          await until((wanted) => window.originDrawFixture.scene.some((row) => { const node = JSON.parse(row); return node.name === wanted && !node.deleted; }), name);
          await page.keyboard.press("Control+z");
          await until((ids) => ids.every((id) => window.originDrawFixture.scene.some((row) => { const node = JSON.parse(row); return node.id === id && !node.deleted; })), [ellipse.id, rect.id]);
          await page.locator('[role="tree"]').getByText("Rectangle", { exact: true }).last().click();
          await page.locator('[role="tree"]').getByText("Ellipse", { exact: true }).last().click({ modifiers: ["Shift"] });
        }
        await page.locator('[role="tree"]').getByText("Ellipse", { exact: true }).last().click();
        await page.keyboard.press("Control+e");
        await until((id) => window.originDrawFixture.scene.some((row) => { const node = JSON.parse(row); return node.id === id && node.deleted; }), ellipse.id);
        await page.keyboard.press("Control+z");
        await page.locator('[role="tree"]').getByText("Rectangle", { exact: true }).last().click();
        const moved = async () => (await nodes()).find((node) => node.id === rect.id);
        await page.locator("[data-canvas-stage]").focus();
        await page.keyboard.press("ArrowRight");
        await page.keyboard.press("Shift+ArrowDown");
        await until(({ id, x, y }) => window.originDrawFixture.scene.some((row) => { const node = JSON.parse(row); return node.id === id && node.x === x + 1 && node.y === y + 10; }), { id: rect.id, x: rect.x, y: rect.y });
        await page.keyboard.press("Control+Shift+h");
        await until((id) => window.originDrawFixture.scene.some((row) => { const node = JSON.parse(row); return node.id === id && node.hidden; }), rect.id);
        await page.keyboard.press("Control+Shift+h");
        const zOf = async () => (await nodes()).find((node) => node.id === rect.id).z;
        const startZ = await zOf();
        await page.keyboard.press("]");
        await until(({ id, z }) => window.originDrawFixture.scene.some((row) => { const node = JSON.parse(row); return node.id === id && node.z > z; }), { id: rect.id, z: startZ });
        await page.keyboard.press("Control+[");
        await until(({ id, z }) => window.originDrawFixture.scene.some((row) => { const node = JSON.parse(row); return node.id === id && node.z < z; }), { id: rect.id, z: startZ });
        await page.keyboard.press("Control+]");
        await page.keyboard.press("[");
        await page.keyboard.press("Control+c");
        await page.keyboard.press("Control+v");
        await until(() => window.originDrawFixture.scene.filter((row) => { const node = JSON.parse(row); return node.type === "rect" && node.page === "page-3" && !node.deleted; }).length === 2);
        await page.keyboard.press("Control+Shift+l");
        await until(() => window.originDrawFixture.scene.some((row) => { const node = JSON.parse(row); return node.type === "rect" && node.page === "page-3" && node.locked; }));
        await page.keyboard.press("Shift+r");
        assert.equal(await page.locator('[data-canvas-chrome] > div[aria-hidden="true"]').count(), 0, "Shift+R hides rulers");
        await page.keyboard.press("Shift+r");
        await page.keyboard.press("Shift+0");
        assert.equal(await zoomLabel(), "100%");
        await page.keyboard.press("Control+=");
        assert.equal(await zoomLabel(), "125%");
        await page.keyboard.press("Control+-");
        assert.equal(await zoomLabel(), "100%");
        await page.keyboard.press("Shift+1");
        await page.keyboard.down(" ");
        await drag(at(0, 0), at(60, 30));
        await page.keyboard.up(" ");
        await page.keyboard.press("i");
        await page.getByRole("button", { name: "Upload from this device" }).waitFor();
        await page.keyboard.press("Escape");
        assert.ok(moved);
        await capture("shortcuts");
        result.everyShortcut = true;
        await page.getByRole("button", { name: "Page 1", exact: true }).click();
      }

      await page.evaluate((rows) => window.originDrawFixture.remote(rows), crowd);
      await page.locator('[role="tree"]').getByText("Crowd", { exact: true }).waitFor();
      await selectLayer("Crowd");
      await page.keyboard.press("Shift+2");
      await page.waitForTimeout(300);
      const crowdBox = await page.locator('[data-node-id]').first().boundingBox();
      await page.evaluate(() => { window.__frames = []; let last = performance.now(); const tick = (now) => { window.__frames.push(now - last); last = now; if (window.__frames.length < 400) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
      const handle = await page.locator('[data-canvas-stage]').boundingBox();
      const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      const began = Date.now();
      for (let step = 1; step <= 30; step++) await page.mouse.move(start.x + step * 4, start.y + step * 2);
      const spent = Date.now() - began;
      await page.mouse.up();
      const frames = await page.evaluate(() => window.__frames.slice(2));
      frames.sort((a, b) => a - b);
      result.thousandNodes = { nodes: 1501, dragMoveMs: Math.round(spent / 30), frameP50: Math.round(frames[Math.floor(frames.length / 2)]), frameP95: Math.round(frames[Math.floor(frames.length * 0.95)]) };
      assert.ok(crowdBox);
      assert.ok(result.thousandNodes.dragMoveMs < 120, `drag step ${result.thousandNodes.dragMoveMs} ms`);
      await capture("crowd");
    } else {
      await page.getByRole("button", { name: "Layers", exact: true }).click();
      await page.getByRole("tab", { name: "Assets" }).click();
      await page.getByText("Colour styles").waitFor();
      await capture("narrow-assets");
      await page.getByRole("button", { name: "Design panel", exact: true }).click();
      await page.getByRole("tab", { name: "Code" }).click();
      await page.getByRole("tab", { name: "Design" }).click();
      await page.getByRole("button", { name: "Design panel", exact: true }).click();
      await page.keyboard.press("f");
      await drag(at(-120, -150), at(120, 100));
      await until(() => window.originDrawFixture.scene.some((row) => JSON.parse(row).type === "frame"));
      await page.getByRole("button", { name: "Comment", exact: true }).click();
      await page.mouse.click(at(0, 0).x, at(0, 0).y);
      await page.getByRole("textbox", { name: /^Comment on/ }).fill("Looks good on phones");
      await page.getByRole("textbox", { name: /^Comment on/ }).press("Enter");
      await until(() => window.originDrawFixture.comments.length === 1);
      await capture("narrow-comment");
      await page.keyboard.press("Control+Alt+Enter");
      await page.getByRole("dialog").waitFor();
      await capture("narrow-present");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Ask Atlas" }).click();
      await page.locator("[data-agent-panel]").waitFor();
      await capture("narrow-agent");
      await page.locator("[data-agent-panel]").getByRole("button", { name: "Close" }).click();
      result.narrowPagesAssetsCommentsPresentAgent = true;
    }
    } catch (error) {
      await page.screenshot({ path: resolve(output, `failure-${width}-${theme}.png`) });
      console.log(String(error?.stack ?? error).slice(0, 1500), await page.evaluate(() => location.href).catch(() => "?"));
      throw error;
    }
    evidence.cases.push(result);
    await page.close();
  }
  assert.deepEqual(evidence.pageErrors, []);
  await writeFile(resolve(output, "browser-checks.json"), JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence));
} finally { await browser.close(); }
