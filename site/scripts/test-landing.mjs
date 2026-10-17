// Checks the website and its sign-in pages served at $SITE (default 127.0.0.1:3001, `pnpm dev` or `pnpm build && pnpm start -p 3001`)
// against the local Convex at 127.0.0.1:3210. Creates throwaway @example.test accounts there; never point it at production.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const site = process.env.SITE || "http://127.0.0.1:3001";
const convex = new ConvexHttpClient("http://127.0.0.1:3210");
const shots = process.env.LANDING_SHOTS || join(tmpdir(), "origin-landing");
const label = process.env.LANDING_LABEL ? `-${process.env.LANDING_LABEL}` : "";
await mkdir(shots, { recursive: true });
const WINDOWS_URL = "https://origin.imbored.fun/downloads/Origin-Setup.exe";
const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const hideDevOverlay = "nextjs-portal { display: none !important; }";
const { inviteOnly } = await convex.query(makeFunctionReference("auth:signupMode"), {});
assert.ok(!inviteOnly, "run against a local Convex that allows open signup");

const browser = await chromium.launch({ headless: true });
const errors = [];
const watch = page => {
  page.on("pageerror", error => errors.push(`${page.url()}: ${error.message}`));
  page.on("console", message => {
    if (message.type() === "error" && !message.text().includes("Invalid email or password")) errors.push(`${page.url()}: ${message.text()}`);
  });
};
const shot = (page, name, options = {}) => page.screenshot({ path: join(shots, `${name}${label}.png`), style: hideDevOverlay, ...options });
const demoStep = page => page.locator("figure[data-step]").getAttribute("data-step").then(Number);

async function loadAll(page) {
  await page.evaluate(() => document.fonts.ready);
  const height = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < height; y += 400) {
    await page.evaluate(top => new Promise(resolve => { scrollTo(0, top); requestAnimationFrame(() => requestAnimationFrame(resolve)); }), y);
    await page.waitForFunction(() => [...document.images].filter(image => {
      const box = image.getBoundingClientRect();
      return box.height > 0 && box.bottom > 0 && box.top < innerHeight;
    }).every(image => image.complete && image.naturalWidth > 0));
  }
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await page.waitForFunction(() => !document.querySelector("[data-motion]") || [...document.querySelectorAll("[data-reveal]")].every(node => node.hasAttribute("data-in")), null, { timeout: 5000 })
    .catch(async error => {
      const hidden = await page.evaluate(() => [...document.querySelectorAll("[data-reveal]:not([data-in])")].map(node => node.textContent.slice(0, 40)));
      throw new Error(`never revealed: ${JSON.stringify(hidden)}`, { cause: error });
    });
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(900);
}

try {
  for (const colorScheme of ["light", "dark"]) {
    for (const [width, height] of [[1440, 900], [1024, 768], [768, 1024], [375, 812], [320, 640]]) {
      const context = await browser.newContext({ viewport: { width, height }, colorScheme });
      const page = await context.newPage();
      watch(page);
      await page.goto(`${site}/`);
      await page.getByRole("heading", { level: 1, name: "Every project gets a team of agents that ships." }).waitFor();
      await loadAll(page);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `horizontal overflow at ${width} ${colorScheme}`);
      const product = await page.locator("figure img").first().boundingBox();
      assert.ok(product && product.y < height + 340, `the product image should start near the first screen at ${width}x${height}`);
      for (const name of ["How Origin is organized", "Issue, agent, pull request", "Meet the team", "Runs where you want"]) assert.ok(await page.getByText(name, { exact: true }).isVisible());
      assert.equal(await page.getByRole("link", { name: "Download for Windows" }).first().getAttribute("href"), WINDOWS_URL);
      const download = page.locator("#download");
      assert.equal(await download.getByRole("link", { name: "Download for Windows" }).getAttribute("href"), WINDOWS_URL);
      assert.ok(await download.getByText("Download for Mac").isVisible());
      assert.ok(await download.getByText("More info", { exact: true }).isVisible());
      if (width === 1440 || width === 375) {
        await page.locator("figure[data-step]").scrollIntoViewIfNeeded();
        await page.waitForTimeout(4200);
        await page.evaluate(() => scrollTo(0, 0));
        await shot(page, `landing-${width}-${colorScheme}`, { fullPage: true });
        await page.waitForTimeout(300);
        await shot(page, `hero-${width}-${colorScheme}`);
      }
      console.log(`PASS landing ${width}x${height} ${colorScheme}: no overflow, images loaded, every section revealed, download links`);
      await context.close();
    }
  }

  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    watch(page);
    await page.goto(`${site}/`);
    await page.getByRole("heading", { level: 1 }).waitFor();
    assert.equal(await page.locator('link[rel="icon"]').first().getAttribute("href"), "/origin.svg");
    assert.match(await page.locator('meta[property="og:image"]').getAttribute("content"), /\/og\.png$/);
    assert.equal(await page.getByRole("banner").getByRole("link", { name: "Download" }).getAttribute("href"), WINDOWS_URL);
    await page.waitForTimeout(1500);
    const shift = await page.evaluate(() => new Promise(resolve => {
      let total = 0;
      new PerformanceObserver(list => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) total += entry.value; }).observe({ type: "layout-shift", buffered: true });
      setTimeout(() => resolve(total), 300);
    }));
    assert.ok(shift < 0.02, `cumulative layout shift on load was ${shift}`);
    const logo = page.getByRole("banner").locator("svg").first();
    const box = await logo.boundingBox();
    await page.mouse.move(box.x + 600, box.y + box.height / 2);
    await page.waitForFunction(() => Number(document.querySelector("header svg")?.style.getPropertyValue("--look-x")) > 0.5);
    await page.mouse.move(box.x + box.width / 2, box.y + 500);
    await page.waitForFunction(() => Number(document.querySelector("header svg")?.style.getPropertyValue("--look-y")) > 0.5);
    console.log(`PASS favicon, og image, header download link, layout shift ${shift.toFixed(4)}, logo follows the pointer`);

    const demo = page.locator("figure[data-step]");
    await demo.scrollIntoViewIfNeeded();
    const first = await demoStep(page);
    await page.waitForFunction(start => Number(document.querySelector("figure[data-step]").dataset.step) !== start, first, { timeout: 5000 });
    await demo.getByRole("button", { name: "Pause the example" }).click();
    const paused = await demoStep(page);
    await page.waitForTimeout(2500);
    assert.equal(await demoStep(page), paused);
    await demo.getByRole("button", { name: "Play the example" }).click();
    await page.waitForFunction(start => Number(document.querySelector("figure[data-step]").dataset.step) !== start, paused, { timeout: 5000 });
    await page.waitForFunction(() => document.querySelector("figure[data-step]").dataset.step === "8", null, { timeout: 20000 });
    await page.waitForTimeout(900);
    await demo.screenshot({ path: join(shots, `demo-merged-1440${label}.png`) });
    assert.equal(await page.locator("ol li[data-active]").count(), 1);
    console.log("PASS product demo plays in view, pauses, resumes and reaches the merged step");
    await context.close();
  }

  for (const colorScheme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, colorScheme, reducedMotion: "reduce" });
    const page = await context.newPage();
    watch(page);
    await page.goto(`${site}/`);
    await page.getByRole("heading", { level: 1 }).waitFor();
    await page.waitForTimeout(500);
    assert.equal(await page.locator("[data-motion]").count(), 0);
    assert.equal(await demoStep(page), 8);
    assert.equal(await page.getByRole("button", { name: "Pause the example" }).count(), 0);
    const still = await page.evaluate(() => [...document.querySelectorAll("[data-reveal], h1 span, header svg g")].every(node => {
      const style = getComputedStyle(node);
      return style.opacity === "1" && style.animationName === "none";
    }));
    assert.ok(still, "reduced motion leaves everything visible and still");
    await loadAll(page);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await shot(page, `reduced-375-${colorScheme}`, { fullPage: true });
    console.log(`PASS reduced motion ${colorScheme}: no reveals, no animations, demo shows the finished run`);
    await context.close();
  }

  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, userAgent: MAC_UA });
    const page = await context.newPage();
    watch(page);
    await page.goto(`${site}/`);
    const hero = page.locator("section").first();
    await hero.getByText("Download for Mac").waitFor();
    assert.equal(await hero.getByRole("link", { name: "Download for Mac" }).first().getAttribute("href"), "https://origin.imbored.fun/downloads/Origin-Mac-AppleSilicon.dmg");
    assert.equal(await page.getByRole("banner").getByRole("link", { name: "Download" }).getAttribute("href"), "https://origin.imbored.fun/downloads/Origin-Mac-AppleSilicon.dmg");
    assert.equal(await page.locator("#download").getByRole("link", { name: "Download for Windows" }).getAttribute("href"), WINDOWS_URL);
    await page.getByRole("heading", { name: "Get Origin for Mac." }).waitFor({ state: "attached" });
    await page.waitForTimeout(900);
    await shot(page, "mac-hero-1440-light");
    console.log("PASS macOS visitors get the Mac download first and the Windows link in the download section");
    await context.close();
  }

  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  watch(page);
  await page.goto(`${site}/`);
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Skip to content");
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("link", { name: "FAQ" }).click();
  assert.equal(await page.getByRole("navigation", { name: "Mobile navigation" }).count(), 0);
  await page.getByText("Can I bring my team?", { exact: true }).click();
  assert.ok(await page.getByText("Workspace admins send invite links", { exact: false }).isVisible());
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("navigation", { name: "Mobile navigation" }).count(), 0);
  console.log("PASS skip link, mobile menu (link and Escape) and FAQ");

  const id = Date.now();
  const owner = { email: `landing-owner-${id}@example.test`, password: `Origin-landing-${id}` };
  await page.goto(`${site}/signup`);
  await page.getByRole("heading", { name: "Create your Origin account" }).waitFor();
  await page.waitForTimeout(700);
  await shot(page, "signup-375-light");
  await page.getByLabel("Your name").fill("Landing Owner");
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page.getByLabel("Workspace name").fill(`Landing ${id}`);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("heading", { name: "You're signed in, Landing." }).waitFor();
  await page.getByText(`Landing ${id}`, { exact: true }).waitFor();
  assert.equal(await page.getByRole("link", { name: "Download for Windows" }).getAttribute("href"), WINDOWS_URL);
  await page.waitForTimeout(700);
  await shot(page, "account-375-light", { fullPage: true });
  await page.goto(`${site}/`);
  await page.getByText("You're signed in, Landing.", { exact: true }).waitFor({ state: "attached" });
  assert.equal(new URL(page.url()).pathname, "/");
  await page.goto(`${site}/login`);
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("heading", { name: "Sign in to Origin" }).waitFor();
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password", { exact: true }).fill("wrong-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Invalid email or password" }).waitFor();
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("heading", { name: "You're signed in, Landing." }).waitFor();
  const ownerToken = await page.evaluate(() => localStorage.getItem("origin.sessionToken"));
  console.log("PASS signup, signed-in landing stays on / and points at the app, sign out, wrong password, sign in");

  const workspace = (await convex.query(makeFunctionReference("workspaces:list"), { sessionToken: ownerToken }))[0];
  const invite = await convex.mutation(makeFunctionReference("workspaces:createInvite"), { sessionToken: ownerToken, teamId: workspace._id, role: "member" });
  const guestContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  const guest = await guestContext.newPage();
  watch(guest);
  await guest.goto(`${site}/join/not-a-real-invite`);
  await guest.getByRole("heading", { name: "Invitation unavailable" }).waitFor();
  await guest.goto(`${site}/join/${invite.token}`);
  await guest.getByRole("heading", { name: `Join ${workspace.name}` }).waitFor();
  assert.equal(await guest.getByLabel("Workspace name").count(), 0);
  await guest.waitForTimeout(700);
  await shot(guest, "join-1440-dark");
  await guest.getByLabel("Your name").fill("Robin Guest");
  await guest.getByLabel("Email").fill(`landing-guest-${id}@example.test`);
  await guest.getByLabel("Password", { exact: true }).fill(`Origin-guest-${id}`);
  await guest.getByRole("button", { name: "Create account" }).click();
  await guest.getByRole("button", { name: "Join workspace" }).click();
  await guest.getByRole("heading", { name: `You're in ${workspace.name}` }).waitFor();
  await guest.waitForTimeout(700);
  await shot(guest, "joined-1440-dark", { fullPage: true });
  const guestToken = await guest.evaluate(() => localStorage.getItem("origin.sessionToken"));
  assert.ok((await convex.query(makeFunctionReference("workspaces:list"), { sessionToken: guestToken })).some(w => w._id === workspace._id));
  console.log("PASS invite links: unknown token, signup through an invite, join, membership recorded");

  await guest.goto(`${site}/login`);
  await guest.getByRole("heading", { name: "You're signed in, Robin." }).waitFor();
  await guest.waitForTimeout(700);
  await shot(guest, "account-1440-dark", { fullPage: true });
  await guest.getByRole("button", { name: "Sign out" }).click();
  await guest.getByRole("heading", { name: "Sign in to Origin" }).waitFor();
  await guest.waitForTimeout(700);
  await shot(guest, "login-1440-dark");
  const light = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  const lightPage = await light.newPage();
  watch(lightPage);
  await lightPage.goto(`${site}/login`);
  await lightPage.getByRole("heading", { name: "Sign in to Origin" }).waitFor();
  await lightPage.waitForTimeout(700);
  await shot(lightPage, "login-1440-light");
  for (const [width, colorScheme] of [[375, "dark"], [320, "light"]]) {
    await lightPage.setViewportSize({ width, height: 700 });
    await lightPage.emulateMedia({ colorScheme });
    await lightPage.goto(`${site}/signup`);
    await lightPage.getByRole("heading", { name: "Create your Origin account" }).waitFor();
    assert.ok(await lightPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `sign-up overflows at ${width}`);
  }
  await lightPage.waitForTimeout(700);
  await shot(lightPage, "signup-320-light");
  console.log("PASS account page after joining, sign out, sign-in page in both themes, sign-up at 375 and 320");

  assert.deepEqual(errors, []);
  console.log(`PASS no console errors. Screenshots in ${shots}`);
} finally {
  await browser.close();
}
