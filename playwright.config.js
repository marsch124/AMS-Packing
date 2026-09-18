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
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    // 🚨 Service workers OFF. This app installs one, and it serves its cached copy
    // on every load after the first — so a test that reloads was testing the CACHE,
    // not the code just changed. (Found in v177: a second page.goto ran the previous
    // build and the start-up migration appeared never to happen.) The service worker
    // is verified by its own release checklist, not by these tests.
    serviceWorkers: 'block',
  },
  // The phone is where he lives; test at its size.
  projects: [
    { name: 'iphone-chromium', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
    // He works on this app on the Mac as much as on the phone, and until v182 no test
    // ever looked at it — so a change that was right on the phone and wrong on the
    // Mac (v182's first trip toolbar) could only be caught by eye. The tour of every
    // screen runs again at a Mac window's size: the app's 720px column, no touch.
    { name: 'mac-chromium', testMatch: /routes\.spec\.js/,
      use: { browserName: 'chromium', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 } },
  ],
  webServer: {
    command: 'python3 -m http.server 4173 --bind 127.0.0.1',
    url: 'http://127.0.0.1:4173/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
