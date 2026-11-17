import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', timeout: 45000, workers: 1, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4173', channel: process.env.CI ? undefined : 'chrome', headless: true, viewport: {width:1440,height:960}, screenshot: 'only-on-failure' },
  webServer: {
    command: 'node tests/support/start-e2e.mjs', url: 'http://127.0.0.1:4173/api/decompose-nl/status',
    reuseExistingServer: false, timeout: 30000,
    gracefulShutdown: { signal:'SIGTERM', timeout: 5000 },
  },
});
