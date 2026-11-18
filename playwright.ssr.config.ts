import { defineConfig } from '@playwright/test';

const baseURL = 'http://127.0.0.1:5181';
const executablePath = process.env.BROWSER_EXECUTABLE_PATH;

export default defineConfig({
  testDir: './tests/ssr',
  use: {
    baseURL,
    reducedMotion: 'reduce',
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: {
    command: 'pnpm --filter @brightwork/api start',
    url: baseURL + '/health',
    env: {
      APP_ORIGIN: baseURL,
      API_PORT: '5181',
      SITE_BASE_DOMAIN: 'published.example.test',
    },
    timeout: 30_000,
  },
});
