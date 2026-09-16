// Shared helpers for the UI tests. Controls are found by data-testid ONLY.
import { expect } from '@playwright/test';

// Open the app fresh: no network to the sync service, a clean origin, and wait
// until it has booted (the version marker in the tab bar is filled in last).
export async function openApp(page, hash = '#/') {
  await page.route(/dexie\.cloud/, (route) => route.abort());
  await page.goto(`/index.html${hash}`);
  await expect(page.getByTestId('app-version')).toHaveText(/v\d+/);
}
