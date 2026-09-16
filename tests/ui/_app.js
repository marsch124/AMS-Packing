// Shared helpers for the UI tests. Controls are found by data-testid ONLY.
import { expect } from '@playwright/test';

// Open the app fresh: no network to the sync service, a clean origin, and wait
// until it has booted (the version marker in the tab bar is filled in last).
export async function openApp(page, hash = '#/') {
  await page.route(/dexie\.cloud/, (route) => route.abort());
  await page.goto(`/index.html${hash}`);
  await expect(page.getByTestId('app-version')).toHaveText(/v\d+/);
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
