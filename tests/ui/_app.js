// Shared helpers for the UI tests. Controls are found by data-testid ONLY.
import { expect } from '@playwright/test';

// Open the app fresh: no network to the sync service, a clean origin, and wait
// until it has booted (the version marker in the tab bar is filled in last).
export async function openApp(page, hash = '#/') {
  await page.route(/dexie\.cloud/, (route) => route.abort());
  await page.goto(`/index.html${hash}`);
  await settled(page);
}

// A genuine restart of the app.
//
// 🪤 page.goto() to the URL the page is ALREADY on is a same-document HASH change:
// the document is not reloaded and the app never re-runs, so anything that happens
// only at start-up (a migration, say) appears never to happen — and `data-ready`
// is still set from the first load, so waiting for it proves nothing. Reload.
export async function restartApp(page, hash = '#/') {
  await page.evaluate((h) => { window.location.hash = h; }, hash);
  await page.reload();
  await settled(page);
}

// Booted, and every start-up repair finished.
async function settled(page) {
  await expect(page.getByTestId('app-version')).toHaveText(/v\d+/);
  await expect(page.locator('html[data-ready="1"]')).toBeAttached({ timeout: 20_000 });
}

// Create a trip from the Home form and land on it. Returns the name used.
export async function createTrip(page, name = `Test trip ${Date.now()}`) {
  await page.getByTestId('event-name').fill(name);
  await page.getByTestId('event-submit').click();
  await expect(page.getByTestId('event-title')).toHaveText(name);
  return name;
}

// "12/70 packed · 17%" -> { done: 12, total: 70 }
export function parseProgress(text) {
  const m = /(\d+)\/(\d+) packed/.exec(text || '');
  if (!m) throw new Error(`progress line not understood: ${JSON.stringify(text)}`);
  return { done: Number(m[1]), total: Number(m[2]) };
}
