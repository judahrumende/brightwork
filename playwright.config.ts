import { defineConfig } from '@playwright/test';

const baseURL = 'http://127.0.0.1:5173';
const executablePath = process.env.BROWSER_EXECUTABLE_PATH;

export default defineConfig({
  testDir: './tests',
  testIgnore: ['**/unit/**', '**/ssr/**'],
  use: {
    baseURL,
    viewport: { width: 1920, height: 772 },
    reducedMotion: 'reduce',
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: {
    command: 'pnpm dev',
    url: `${baseURL}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
