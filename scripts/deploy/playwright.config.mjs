import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: 'read-only.spec.mjs', workers: 1, retries: 0,
  timeout: 45000, reporter: 'list', use: { headless: true },
});
