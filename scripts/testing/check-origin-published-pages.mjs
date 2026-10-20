import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const url = new URL(process.argv[2] ?? "");
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, "/__origin-published-pages.html");
const output = resolve("docs/verification/evidence/origin-published-pages");
await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.OMB_VERIFY_PLAYWRIGHT || "playwright");
const VISITOR = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

const browser = await chromium.launch();
const evidence = { checkedAt: new Date().toISOString(), previewUrl: url.href, cases: [], pageErrors: [] };
try {
  for (const [index, width] of [375, 1280].entries()) {
    const height = width < 500 ? 812 : 860;
    const app = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
    app.on("pageerror", (error) => evidence.pageErrors.push(error.message));
    const shot = async (target, name) => {
      await target.waitForTimeout(150);
      assert.equal(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} scrolls sideways`);
      await target.screenshot({ path: resolve(output, `${name}-${width}.png`) });
    };
    await app.goto(url.href);
    await app.getByRole("toolbar", { name: "Canvas tools" }).waitFor();
    const result = { width };

    await app.getByRole("button", { name: /^Pages/ }).click();
    const menu = app.getByRole("dialog", { name: "Published pages" });
    await menu.waitFor();
    if (index === 0) assert.match(await menu.innerText(), /No published pages yet/);
    await shot(app, index === 0 ? "pages-empty" : "pages-before");
    await app.keyboard.press("Escape");
    await menu.waitFor({ state: "detached" });

    if (width < 860) await app.getByRole("button", { name: "Layers", exact: true }).click();
    await app.getByRole("complementary", { name: "Layers" }).getByText("Waitlist", { exact: true }).click();
    if (width < 860) {
      await app.getByRole("button", { name: "Layers", exact: true }).dispatchEvent("click");
      await app.getByRole("button", { name: "Design panel" }).click();
    }
    const panel = app.getByRole("complementary", { name: "Design" });
    const publish = panel.getByRole("region", { name: "Publish page" });
    await publish.scrollIntoViewIfNeeded();
    const address = publish.getByRole("textbox", { name: "Address", exact: true });
    assert.equal(await address.inputValue(), index === 0 ? "waitlist" : "early-access");
    if (index === 0) {
      await address.fill("early-access");
      await publish.getByRole("textbox", { name: "Title", exact: true }).fill("Origin early access");
    }
    await shot(app, "publish-form");
    await publish.getByRole("button", { name: index === 0 ? "Publish" : "Republish", exact: true }).click();
    await publish.getByRole("status").filter({ hasText: index === 0 ? "Published; lead capture is on in Pipeline" : "Updated" }).waitFor();
    const link = publish.getByRole("link", { name: /\/p\/acme-launch\/early-access$/ });
    await link.waitFor();
    const pageUrl = await link.getAttribute("href");
    result.saved = await app.evaluate(() => window.originCampaignsFixture.requests.filter((request) => request.name === "pages:publish").map((request) => Boolean(request.args.ogFileId)));
    result.pageUrl = pageUrl;
    await publish.scrollIntoViewIfNeeded();
    await shot(app, "published");

    const visitor = await browser.newContext({ viewport: { width, height }, userAgent: VISITOR, reducedMotion: "reduce" });
    const site = await visitor.newPage();
    site.on("pageerror", (error) => evidence.pageErrors.push(error.message));
    const served = await site.goto(pageUrl);
    assert.equal(served.status(), 200);
    assert.match(served.headers()["content-security-policy"], /form-action 'self'/);
    assert.equal(await site.title(), "Origin early access");
    assert.equal(await site.locator("h1").innerText(), "Take your idea from canvas to customers");
    assert.equal(await site.locator('meta[property="og:image"]').count(), 1);
    assert.equal(await site.locator("script").count(), 0);
    result.ogImage = await site.locator('meta[property="og:image"]').getAttribute("content");
    const features = await site.locator("main > div").filter({ has: site.getByText("Design", { exact: true }) }).boundingBox();
    result.featuresWidth = features?.width;
    await site.screenshot({ path: resolve(output, `page-${width}.png`), fullPage: true });
    assert.equal(await site.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "the page scrolls sideways");
    await site.getByLabel("Name").fill(`Grace ${width}`);
    await site.getByLabel("Email").fill(`grace${width}@navy.test`);
    await site.getByRole("button", { name: "Join the waitlist" }).click();
    await site.waitForURL(/\?sent=1#lead$/);
    await site.getByRole("status").filter({ hasText: "Thanks, we will be in touch." }).waitFor();
    assert.equal(await site.getByLabel("Email").isVisible(), false);
    await site.locator("#lead").scrollIntoViewIfNeeded();
    await site.screenshot({ path: resolve(output, `page-sent-${width}.png`) });
    await visitor.close();

    await app.getByRole("button", { name: /^Pages/ }).click();
    await menu.waitFor();
    const row = menu.getByRole("listitem").filter({ hasText: "Origin early access" });
    await row.getByText(`${index + 1} lead${index ? "s" : ""}`).waitFor({ timeout: 5000 });
    await row.getByText(`${index + 1} view${index ? "s" : ""}`).waitFor({ timeout: 5000 });
    const box = await menu.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= width && box.y + box.height <= height, "the pages menu leaves the screen");
    await shot(app, "pages-after");
    result.menu = await menu.innerText();
    if (index === 1) {
      await row.getByRole("button", { name: "Unpublish" }).click();
      await shot(app, "pages-confirm");
      await row.getByRole("button", { name: "Take it down" }).click();
      await menu.getByText(/No published pages yet/).waitFor();
      const gone = await (await browser.newPage()).goto(pageUrl);
      assert.equal(gone.status(), 404);
      result.unpublished = true;
    }
    evidence.cases.push(result);
    await app.close();
  }
  assert.deepEqual(evidence.pageErrors, []);
} finally {
  await writeFile(resolve(output, "report.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  await browser.close();
}
console.log(JSON.stringify(evidence, null, 2));
