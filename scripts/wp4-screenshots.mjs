import { readFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(resolve(process.env.ORIGIN_PLAYWRIGHT_MODULE ?? 'node_modules/playwright-core/index.mjs')).href);
const fixture = JSON.parse(await readFile(resolve(process.argv[2], 'fixture.json'), 'utf8'));
if (new URL(fixture.app).hostname !== '127.0.0.1') throw new Error('Local screenshot fixture required');
const destination = resolve('docs/agents/wp4-screenshots'); await mkdir(destination, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1680, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await context.addInitScript(({ token, workspace }) => { localStorage.setItem('origin.sessionToken', token); localStorage.setItem('origin.workspace', workspace); }, { token: fixture.sessionToken, workspace: fixture.team.slug });
  const page = await context.newPage();
  await page.goto(`${fixture.app}/${fixture.team.slug}?tab=agents`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'PRs', exact: true }).waitFor();
  await page.getByRole('button', { name: 'PRs', exact: true }).click();
  await page.locator('a[href="https://github.com/z4mbo/origin-pr-sandbox/pull/3"]').waitFor();
  await page.getByRole('button', { name: 'Close chat', exact: true }).click();
  await page.screenshot({ path: join(destination, '01-project-agents-pr.png') });
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.locator(`#run-${fixture.runId}`).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(destination, '02-project-agents-runs.png') });
  await page.getByRole('button', { name: 'Issues', exact: true }).click();
  await page.getByText('Agent test', { exact: true }).waitFor();
  await page.getByText('Agent test', { exact: true }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500); // Let the existing board entrance animation settle before capturing it.
  await page.screenshot({ path: join(destination, '03-agent-test-board.png') });
  console.log('Headless screenshots saved to docs/agents/wp4-screenshots/');
} finally { await browser.close(); }
