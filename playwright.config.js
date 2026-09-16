// UI tests — Martin's standing rule (2026-09-16): they run in CI on every push,
// every control is found by its data-testid (never by its words), and the suite
// grows ONE test at a time. Local: `npm run test:ui`. The app is plain static
// files, so the web server is Python's built-in one — present on every machine
// and every GitHub runner.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/ui',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,   // a test that passes on a retry is a flaky test, not a green one — v169 caught a real bug that way
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'on-first-retry' },
  // The phone is where he lives; test at its size.
  projects: [{ name: 'iphone-chromium', use: { ...devices['iPhone 13'], browserName: 'chromium' } }],
  webServer: {
    command: 'python3 -m http.server 4173 --bind 127.0.0.1',
    url: 'http://127.0.0.1:4173/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
