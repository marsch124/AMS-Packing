// Test 4 of the suite: the Density switch loosens the app, remembers, and tightens again.
import { test, expect } from '@playwright/test';
import { openApp } from './_app.js';

// The Appearance section folds; open it if it is closed (folds remember their state).
async function openAppearance(page) {
  const fold = page.getByTestId('fold-theme');
  await expect(fold).toBeAttached();
  if (!(await fold.evaluate((d) => d.open))) await fold.locator('summary').click();
  await expect(page.getByTestId('density-comfortable')).toBeVisible();
}

test('the Density switch loosens the app, remembers it, and tightens again', async ({ page }) => {
  await openApp(page, '#/settings');
  const html = page.locator('html');
  await expect(html).toHaveClass(/\bcompact\b/);            // Compact is the everyday setting

  await openAppearance(page);
  await page.getByTestId('density-comfortable').click();
  await expect(html).not.toHaveClass(/\bcompact\b/);

  // A choice, not a screen state: it must survive a reload.
  await page.reload();
  await expect(page.getByTestId('app-version')).toHaveText(/v\d+/);
  await expect(html).not.toHaveClass(/\bcompact\b/);

  await openAppearance(page);
  await page.getByTestId('density-compact').click();
  await expect(html).toHaveClass(/\bcompact\b/);
});
