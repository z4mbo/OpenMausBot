import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const session = JSON.parse(await readFile("/tmp/origin-qa-session.json", "utf8"));
const origin = "http://127.0.0.1:3001";
const client = new ConvexHttpClient("http://127.0.0.1:3210", { logger: false });
const scope = { sessionToken: session.alex.sessionToken, teamId: session.workspace._id };
const query = name => client.query(makeFunctionReference(name), scope);
const browser = await chromium.launch({ headless: true });
const errors = [];
const pages = [];
try {
  for (const account of [session.alex, session.sam]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(token => localStorage.setItem("origin.sessionToken", token), account.sessionToken);
    // Exercise the file-input fallback, whose chooser Playwright can control.
    await context.addInitScript(() => { delete window.showOpenFilePicker; delete window.showSaveFilePicker; });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}/${session.workspace.slug}?view=chat`);
    await page.getByRole("heading", { name: "Team chat" }).waitFor();
    pages.push(page);
  }
  const [alex, sam] = pages;
  const message = `Attachment QA ${Date.now()}`;
  await alex.locator('input[type="file"]').setInputFiles("public/origin-workspace-mobile.png");
  await alex.getByRole("textbox", { name: "Message", exact: true }).fill(message);
  await alex.getByRole("button", { name: "Send message", exact: true }).click();
  const remoteMessage = sam.locator(".conversation-message").filter({ hasText: message });
  await remoteMessage.waitFor();
  await remoteMessage.locator("img[alt='origin-workspace-mobile.png']").waitFor();
  await sam.waitForFunction(text => {
    const row = [...document.querySelectorAll(".conversation-message")].find(el => el.textContent.includes(text));
    return row?.querySelector(".message-file img")?.naturalWidth > 0;
  }, message);
  const messages = await fetch(`${origin}/api/local-chat/messages?teamId=${scope.teamId}`, { headers: { Authorization: `Bearer ${scope.sessionToken}` } }).then(response => response.json());
  const uploaded = messages.messages.find(item => item.body === message).attachments[0];
  const anonymous = await fetch(`${origin}/api/local-chat/files?teamId=${scope.teamId}&id=${uploaded.id}`);
  assert.equal(anonymous.status, 404);
  assert.equal((await anonymous.json()).error, "File not found or access denied");
  console.log("PASS image attachment upload, peer delivery, image decoding and unauthenticated download rejection");

  for (const page of pages) await page.getByRole("button", { name: "Draw", exact: true }).click();
  for (const page of pages) await page.getByRole("radio", { name: "Rectangle", exact: true }).waitFor();
  const before = (await query("draw:scene")).map(JSON.parse);
  await alex.getByRole("radio", { name: "Rectangle", exact: true }).check({ force: true });
  await alex.mouse.move(880, 420); await alex.mouse.down(); await alex.mouse.move(1070, 560, { steps: 12 }); await alex.mouse.up();
  await alex.waitForFunction(() => document.querySelector(".drawing-status")?.textContent.includes("All changes saved"));
  await new Promise(resolve => setTimeout(resolve, 1000));
  const after = (await query("draw:scene")).map(JSON.parse);
  assert.ok(after.filter(item => !item.isDeleted).length > before.filter(item => !item.isDeleted).length);

  const responsePromise = sam.waitForResponse(response => response.url().includes("/api/storage/") && response.status() === 200).catch(() => null);
  const chooser = alex.waitForEvent("filechooser");
  await alex.getByRole("radio", { name: "Insert image", exact: true }).click({ force: true });
  await (await chooser).setFiles("public/origin-workspace-mobile.png");
  await alex.mouse.click(800, 550);
  assert.ok(await responsePromise, "Peer receives the uploaded drawing image");
  const files = await query("draw:files");
  assert.ok(files.length > 0 && files.some(file => file.url));
  let imageElement;
  for (let attempt = 0; attempt < 30; attempt++) {
    imageElement = (await query("draw:scene")).map(JSON.parse).find(element => element.type === "image" && element.fileId && !element.isDeleted);
    if (imageElement) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(imageElement?.fileId, "The persisted image element references the uploaded image");
  await sam.waitForTimeout(800);
  await sam.screenshot({ path: "/tmp/origin-draw-collaboration.png" });
  await sam.setViewportSize({ width: 390, height: 844 });
  await sam.waitForFunction(() => document.documentElement.scrollWidth === window.innerWidth && document.querySelector(".sidebar").getBoundingClientRect().right <= 0);
  await sam.reload();
  await sam.locator(".drawing-status").waitFor();
  await sam.waitForTimeout(800);
  assert.ok(await sam.locator(".excalidraw canvas").first().isVisible());
  await sam.screenshot({ path: "/tmp/origin-draw-collaboration-mobile.png" });
  console.log("PASS drawing persistence, shared image delivery and mobile canvas layout");
  assert.deepEqual(errors, []);
} catch (error) {
  for (const [index, page] of pages.entries()) {
    console.log("Drawing diagnostics", index, await page.locator(".drawing-status").textContent().catch(() => "Canvas not open"), errors);
    await page.screenshot({ path: `/tmp/origin-collaboration-failure-${index}.png` });
  }
  throw error;
} finally {
  await browser.close();
}
