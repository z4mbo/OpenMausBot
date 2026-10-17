import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const rootPath = path => fileURLToPath(new URL(`../${path}`, import.meta.url));

export default defineConfig({
  testDir: './specs',
  outputDir: rootPath('test-results'),
  fullyParallel: true,
  workers: Number(process.env.E2E_WORKERS || 2),
  timeout: 90000,
  globalTimeout: 600000,
  expect: { timeout: 15000 },
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: [['list'], ['html', { open: 'never', outputFolder: rootPath('playwright-report') }], ['json', { outputFile: rootPath('test-results/results.json') }]],
  use: {
    baseURL: process.env.ORIGIN_E2E_APP_URL,
    headless: true,
    reducedMotion: 'reduce',
    actionTimeout: 15000,
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    permissions: ['camera', 'microphone'],
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--window-position=-1900,80', '--window-size=1880,1040'] },
  },
});
