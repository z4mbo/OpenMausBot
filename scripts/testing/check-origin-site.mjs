import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const base = new URL(process.argv[2] ?? "");
assert.equal(base.hostname, "127.0.0.1");
assert.equal(base.pathname, "/");
const phase = process.argv[3] ?? "after";
assert.match(phase, /^[a-z-]+$/);
const out = resolve("docs/verification/evidence/origin-site");
await mkdir(out, { recursive: true });
const { version } = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
const { chromium } = await import(process.env.OMB_VERIFY_PLAYWRIGHT || "playwright");
const browser = await chromium.launch();
const evidence = { previewUrl: base.href, version, cases: [], pageErrors: [] };
try {
  for (const colorScheme of ["light", "dark"]) {
    for (const width of [375, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme, reducedMotion: "reduce" });
      await context.routeWebSocket("**", socket => socket.onMessage(() => {}));
      const page = await context.newPage();
      page.on("pageerror", error => evidence.pageErrors.push(error.message));
      await page.route("**/*", route => {
        const url = new URL(route.request().url());
        return ["127.0.0.1", "localhost"].includes(url.hostname) || url.protocol === "data:" ? route.continue() : route.abort();
      });
      for (const path of ["/", "/login", "/signup", "/whats-new"]) {
        await page.goto(new URL(path, base).href);
        await page.getByRole("heading", { level: 1 }).waitFor();
        await page.evaluate(() => document.fonts.ready);
        const geometry = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
        assert.ok(geometry.scrollWidth <= width, `horizontal overflow ${path}: ${JSON.stringify(geometry)}`);
        const name = path === "/" ? "landing" : path.slice(1);
        await page.screenshot({ path: resolve(out, `${name}-${width}-${colorScheme}-${phase}-full.png`), fullPage: true, style: "nextjs-portal { display: none !important; }" });
        if (path === "/login" || path === "/signup") {
          await page.getByRole("textbox", { name: "Email", exact: true }).fill("fixture@example.test");
          await page.getByRole("button", { name: "Show password" }).click();
          await page.getByRole("textbox", { name: "Password", exact: true }).fill("Synthetic-fixture-only");
          await page.getByRole("button", { name: "Hide password" }).click();
          assert.equal(await page.locator('input[autocomplete$="password"]').getAttribute("type"), "password");
          await page.getByRole("textbox", { name: "Email", exact: true }).focus();
        } else if (path === "/") {
          if (width === 375) {
            await page.getByRole("button", { name: "Open menu" }).click();
            await page.keyboard.press("Escape");
            assert.equal(await page.getByRole("button", { name: "Open menu" }).getAttribute("aria-expanded"), "false");
          }
          assert.equal(await page.getByRole("link", { name: "Download for Windows" }).first().getAttribute("href"), "https://origin.imbored.fun/downloads/Origin-Setup.exe");
        } else {
          await page.getByText(`v${version}`, { exact: true }).waitFor();
        }
        evidence.cases.push({ path, width, colorScheme, geometry });
      }
      await context.close();
    }
  }
  assert.deepEqual(evidence.pageErrors, []);
  await writeFile(resolve(out, `${phase}-full-results.json`), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ phase, checks: evidence.cases.length, pageErrors: evidence.pageErrors.length, out }));
} finally {
  await browser.close();
}
