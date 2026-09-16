// Test 2 of the suite: the core flow — a trip made on Home appears on Events.
import { test, expect } from '@playwright/test';
import { openApp, createTrip } from './_app.js';

test('a trip created on Home shows up on the Events tab', async ({ page }) => {
  await openApp(page);
  const name = await createTrip(page);
  await expect(page.getByTestId('pack-cta')).toBeVisible();
  // ...and Events lists it.
  await page.getByTestId('tab-events').click();
  await expect(page.getByTestId('event-card').filter({ hasText: name })).toHaveCount(1);
});
