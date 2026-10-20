import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const base = new URL(process.argv[2] ?? "");
assert.equal(base.hostname, "127.0.0.1");
assert.equal(base.pathname, "/__origin-ui.html");
const phase = process.argv[3] ?? "after";
assert.ok(["before", "after"].includes(phase));
const output = resolve("docs/verification/evidence/origin-ui");
await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.OMB_VERIFY_PLAYWRIGHT || "playwright");
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const evidence = { previewUrl: base.href, phase, checkedAt: new Date().toISOString(), cases: [] };
await page.route("**/*", (route) => {
  const target = new URL(route.request().url());
  if (!["127.0.0.1", "localhost"].includes(target.hostname) && target.protocol !== "data:") return route.abort();
  if (target.pathname === "/api/threads/fixture-delegation/messages") return route.fulfill({ json: { messages: [
    { id: "fixture-request-message", role: "user", kind: "text", text: "Inspect the release flow and record the result", at: 1, roomRequest: { id: "fixture-request", phase: "request" } },
    { id: "fixture-result", role: "bot", kind: "text", text: "The fixture release flow was inspected.", at: 2, turnTerminal: true, turnSucceeded: true },
  ] } });
  if (target.pathname === "/api/search") return route.fulfill({ json: { hits: [] } });
  return route.continue();
});
const show = async (screen, theme, extra = {}) => {
  const url = new URL(base);
  url.search = new URLSearchParams({ screen, theme, ...extra }).toString();
  await page.goto(url.href);
  await page.waitForTimeout(350);
};
const capture = (name) => page.screenshot({ path: resolve(output, `${name}.png`) });
const overflow = () => page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, offenders: [...document.querySelectorAll("body *")].filter((element) => {
  const bounds = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return bounds.right > innerWidth + 1 && style.position !== "absolute" && style.position !== "fixed";
}).slice(0, 12).map((element) => ({ tag: element.tagName, label: element.getAttribute("aria-label") ?? element.textContent?.slice(0, 50), right: element.getBoundingClientRect().right, width: element.getBoundingClientRect().width })) }));
try {
  for (const theme of ["dark", "light"]) for (const [size, viewport] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 375, height: 812 }]]) {
    await page.setViewportSize(viewport);
    await show("project", theme);
    await page.getByRole("navigation", { name: "Fixture project with a long title agents", exact: true }).waitFor();
    await capture(`project-agents-${phase}-${size}-${theme}`);
    const projectOverflow = await overflow();
    const toolsBounds = await page.getByRole("group", { name: "Project tools", exact: true }).evaluate((node) => ({ left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right }));
    evidence.cases.push({ screen: "project-agents", size, theme, geometry: projectOverflow, toolsBounds });
    if (phase === "after") assert.ok(projectOverflow.document <= viewport.width, JSON.stringify(projectOverflow));
    if (phase === "after") assert.ok(toolsBounds.left >= 0 && toolsBounds.right <= viewport.width, JSON.stringify(toolsBounds));
    if (size === "mobile") {
      await page.getByRole("button", { name: /Fixture developer with a very long name/ }).click();
      await page.getByRole("button", { name: "Back to agents", exact: true }).waitFor();
      await capture(`project-agent-chat-${phase}-${size}-${theme}`);
      await page.getByRole("button", { name: "Back to agents", exact: true }).click();
      assert.ok(await page.getByRole("navigation", { name: "Fixture project with a long title agents", exact: true }).isVisible());
      evidence.cases.push({ screen: "project-agent-chat", size, theme, backToAgents: true });
    }
    if (phase === "after") for (const [id, label, phaseName] of [["issues", "Issues", "build"], ["team-chat", "Team", "plan"], ["call", "Call", "plan"], ["draw", "Canvas", "plan"], ["studio", "Studio", "launch"], ["broadcast", "Publish", "launch"], ["assets", "Assets", "launch"], ["vault", "Vault"], ["repo", "Repo", "build"], ["feedback", "Feedback", "sell"], ["settings", "Settings"]]) {
      if (phaseName && await page.locator(`[data-project-phase="${phaseName}"]`).getAttribute("aria-current") !== "true") await page.locator(`[data-project-phase="${phaseName}"]`).click();
      const button = page.locator(`[data-chief-section="${id}"]`);
      if (await button.isVisible()) {
        await button.click();
        assert.equal(await button.getAttribute("aria-current"), "page");
      } else {
        await page.getByRole("button", { name: /^More sections/ }).click();
        await page.getByRole("menuitem", { name: label, exact: true }).click();
        await page.getByRole("button", { name: `More sections, ${label} open`, exact: true }).waitFor();
      }
      await page.getByRole("heading", { name: "No workspace server", exact: true }).waitFor();
      const geometry = await overflow();
      assert.ok(geometry.document <= viewport.width, JSON.stringify({ id, geometry }));
      await capture(`project-${id}-gate-${phase}-${size}-${theme}`);
      evidence.cases.push({ screen: `project-${id}`, size, theme, selected: label, gate: "No workspace server", documentWidth: geometry.document });
    }

    await show("delegation", theme);
    const disclosure = page.getByRole("button", { name: /Fixture developer with a very long name/ }).first();
    await disclosure.waitFor();
    const delegationOverflow = await overflow();
    await capture(`delegation-${phase}-${size}-${theme}`);
    await disclosure.click();
    assert.equal(await disclosure.getAttribute("aria-expanded"), "true");
    await page.getByText("The fixture release flow was inspected.", { exact: true }).waitFor();
    await capture(`delegation-expanded-${phase}-${size}-${theme}`);
    evidence.cases.push({ screen: "delegation", size, theme, geometry: delegationOverflow, expands: true });
    if (phase === "after") assert.ok(delegationOverflow.document <= viewport.width, JSON.stringify(delegationOverflow));

    await show("search", theme);
    await page.getByRole("button", { name: "Open search", exact: true }).click();
    const search = page.getByRole("combobox", { name: "Search projects, agents, issues and messages", exact: true });
    await search.fill("Fixture");
    await page.waitForTimeout(250);
    await page.getByRole("option").first().waitFor();
    await capture(`search-${phase}-${size}-${theme}`);
    await page.keyboard.press("ArrowDown");
    const selected = await search.getAttribute("aria-activedescendant");
    assert.equal(selected, "origin-search-1");
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
    const focusReturned = await page.getByRole("button", { name: "Open search", exact: true }).evaluate((node) => document.activeElement === node);
    if (phase === "after") assert.equal(focusReturned, true);
    evidence.cases.push({ screen: "search", size, theme, movesSelection: true, escapeReturnsFocus: focusReturned });
  }
  assert.deepEqual(errors, []);
  evidence.pageErrors = errors;
  await writeFile(resolve(output, `project-ui-${phase}-browser-checks.json`), JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence, null, 2));
} finally { await browser.close(); }
