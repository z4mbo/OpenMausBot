import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const base = new URL(process.argv[2] ?? "");
const phase = process.argv[3] ?? "after";
assert.ok(["before", "after"].includes(phase));
assert.equal(base.hostname, "127.0.0.1");
assert.equal(base.pathname, "/__origin-ui.html");
const html = await (await fetch(base)).text();
assert.match(html, /<title>Origin isolated UI verification<\/title>/);
assert.match(html, /scripts\/testing\/origin-ui-preview\.tsx/);
const output = resolve("docs/verification/evidence/origin-ui/chat-attachments");
await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.OMB_VERIFY_PLAYWRIGHT || "playwright");
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const png = Buffer.from(await page.evaluate(() => {
  const canvas = document.createElement("canvas");
  canvas.width = 1600;
  canvas.height = 400;
  const context = canvas.getContext("2d");
  context.fillStyle = "#155e75";
  context.fillRect(0, 0, 1600, 400);
  context.fillStyle = "#a5f3fc";
  context.fillRect(0, 0, 300, 400);
  context.font = "64px sans-serif";
  context.fillStyle = "#ffffff";
  context.fillText("Synthetic 1600 x 400 attachment", 340, 220);
  return canvas.toDataURL("image/png").split(",")[1];
}), "base64");
const longName = `${"OriginProjectRequirements".repeat(8)}.pdf`;
const documentBytes = Buffer.from("%PDF-1.4\nSynthetic isolated attachment bytes\n%%EOF\n");
let current = "image";
const evidence = { previewUrl: base.href, phase, checkedAt: new Date().toISOString(), syntheticImage: { width: 1600, height: 400 }, longFilenameLength: longName.length, cases: [] };

await page.route("**/*", async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) return route.abort();
  if (url.pathname === "/api/local-chat/messages") {
    assert.equal(request.method(), "GET");
    const file = current === "image"
      ? { id: "fixture-wide-png", name: "Synthetic-wide-preview.png", contentType: "image/png", size: png.length }
      : { id: "fixture-long-document", name: longName, contentType: "application/pdf", size: 4096 };
    return route.fulfill({ json: { messages: [{ id: `fixture-${current}`, authorUserId: "peer", authorName: "Fixture teammate", authorEmail: "peer@example.test", body: "Synthetic attachment for layout verification.", createdAt: 1792270000000, attachments: [file] }], hasMore: false } });
  }
  if (url.pathname === "/api/local-chat/files") {
    assert.equal(request.method(), "GET");
    const id = url.searchParams.get("id");
    assert.ok(["fixture-wide-png", "fixture-long-document"].includes(id));
    return route.fulfill({ status: 200, contentType: id === "fixture-wide-png" ? "image/png" : "application/pdf", body: id === "fixture-wide-png" ? png : documentBytes });
  }
  return route.continue();
});

try {
  for (const theme of ["dark", "light"]) {
    for (const [size, viewport] of [["mobile", { width: 375, height: 812 }], ["desktop", { width: 1280, height: 900 }]]) {
      for (const attachment of ["image", "file"]) {
        current = attachment;
        await page.setViewportSize(viewport);
        const next = new URL(base);
        next.search = new URLSearchParams({ screen: "chat", theme }).toString();
        await page.goto(next.href);
        await page.locator(`[data-member-message="fixture-${attachment}"]`).waitFor();
        if (attachment === "image") await page.getByRole("img", { name: "Synthetic-wide-preview.png", exact: true }).evaluate((node) => node.decode());
        else await page.getByRole("button", { name: new RegExp(longName) }).waitFor();
        await page.screenshot({ path: resolve(output, `${attachment}-${phase}-${size}-${theme}.png`), animations: "disabled" });
        const geometry = await page.locator(`[data-member-message="fixture-${attachment}"]`).evaluate((message, kind) => {
          const section = message.closest("section");
          const scroller = section.firstElementChild;
          const content = message.children[1];
          const element = kind === "image" ? message.querySelector("img") : [...message.querySelectorAll("button")].find((node) => node.textContent.includes("OriginProjectRequirements"));
          const bounds = (node) => ({ left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right, width: node.getBoundingClientRect().width, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth });
          const horizontalScrollers = [section, ...section.querySelectorAll("*")].filter((node) => node.clientWidth > 0 && ["auto", "scroll"].includes(getComputedStyle(node).overflowX)).map((node) => ({ tag: node.tagName, ...bounds(node) }));
          return { viewport: innerWidth, document: { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }, section: bounds(section), scroller: { ...bounds(scroller), overflowX: getComputedStyle(scroller).overflowX }, message: bounds(message), content: bounds(content), attachment: bounds(element), horizontalScrollers, ...(kind === "image" ? { intrinsicWidth: element.naturalWidth, intrinsicHeight: element.naturalHeight } : {}) };
        }, attachment);
        const result = { attachmentKind: attachment, theme, size, ...geometry, scrollerOverflow: geometry.scroller.scrollWidth > geometry.scroller.clientWidth, attachmentEscapesContent: geometry.attachment.right > geometry.content.right + 1 };
        if (phase === "after") {
          assert.equal(result.scrollerOverflow, false, JSON.stringify(result));
          assert.equal(result.attachmentEscapesContent, false, JSON.stringify(result));
          assert.ok(geometry.document.scrollWidth <= geometry.document.clientWidth);
          for (const scroller of geometry.horizontalScrollers) assert.ok(scroller.scrollWidth <= scroller.clientWidth, JSON.stringify(scroller));
          if (attachment === "file") {
            const downloaded = page.waitForEvent("download");
            await page.getByRole("button", { name: new RegExp(longName) }).click();
            const download = await downloaded;
            assert.equal(download.suggestedFilename(), longName);
            assert.deepEqual(await readFile(await download.path()), documentBytes);
            result.downloadVerified = true;
            result.suggestedFilename = download.suggestedFilename();
          }
        }
        evidence.cases.push(result);
      }
    }
  }
  assert.deepEqual(errors, []);
  evidence.pageErrors = errors;
  await writeFile(resolve(output, `${phase}-browser-checks.json`), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await browser.close();
}
