import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const localChrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173/ger-archive/',
    browserName: 'chromium',
    launchOptions: {
      executablePath:
        process.env.CHROME_PATH || (existsSync(localChrome) ? localChrome : undefined),
    },
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node scripts/preview-pages.mjs',
    url: 'http://127.0.0.1:4173/ger-archive/',
    reuseExistingServer: false,
    timeout: 15000,
  },
});
