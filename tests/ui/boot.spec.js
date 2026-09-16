// Test 1 of the suite: the app opens and says which version it is.
import { test, expect } from '@playwright/test';
import { openApp } from './_app.js';

test('the app boots and shows its version', async ({ page }) => {
  await openApp(page);
  // Both markers (the tab-bar corner and the Home link) name the same version.
  const corner = (await page.getByTestId('app-version').textContent()).trim();
  await expect(page.getByTestId('home-version')).toContainText(corner);
  await expect(page.getByTestId('tab-home')).toBeVisible();
  await expect(page.getByTestId('event-submit')).toBeVisible();
});
