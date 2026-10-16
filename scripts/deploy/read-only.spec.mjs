// Separate production subset: no fixtures, login, forms, mutations or POSTs.
import { test, expect } from '@playwright/test';

const origin = process.env.ORIGIN_PROD_URL;
if (origin !== 'http://localhost:3000') throw new Error('Set ORIGIN_PROD_URL=http://localhost:3000');

test('public HTTPS shell and read-only auth boundaries', async ({ page, request }) => {
  // Block client POSTs/WebSockets: production app code cannot establish mutations
  // during this unauthenticated shell inspection.
  await page.route('**/*', async route => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.abort();
    return route.continue();
  });
  await page.routeWebSocket('**/*', ws => ws.close());
  const response = await page.goto(origin, { waitUntil: 'domcontentloaded' });
  expect(response.status()).toBe(200);
  await expect(page.locator('body')).toBeVisible();
  expect(await page.title()).toMatch(/Origin/i);
  const metadata = await request.get(origin + '/.well-known/oauth-protected-resource');
  expect(metadata.status()).toBe(200);
  expect((await metadata.json()).resource).toContain(origin);
  expect((await request.get(origin + '/api/mcp')).status()).toBe(401);
  expect((await request.get(origin + '/api/agent')).status()).toBe(404);
});
