// Test 3 of the suite: a tick in Packing Mode counts, and survives a reload.
import { test, expect } from '@playwright/test';
import { openApp, createTrip, parseProgress } from './_app.js';

test('ticking a thing in Packing Mode moves the count, and the tick sticks', async ({ page }) => {
  await openApp(page);
  await createTrip(page);
  await page.getByTestId('pack-cta').click();

  const progress = page.getByTestId('pack-progress');
  const before = parseProgress(await progress.textContent());
  expect(before.done).toBe(0);
  expect(before.total).toBeGreaterThan(0);

  // The first phase can be empty for a small trip; step forward until a row shows.
  for (let i = 0; i < 6 && (await page.getByTestId('pack-toggle').count()) === 0; i++) {
    await page.getByTestId('pack-next').click();
  }
  const first = page.getByTestId('pack-toggle').first();
  await expect(first).toHaveAttribute('aria-pressed', 'false');
  await first.click();

  await expect(progress).toHaveText(new RegExp(`^1/${before.total} packed`));

  // A tick is a saved fact, not a screen state: it must still be there after a reload.
  await page.reload();
  await expect(page.getByTestId('app-version')).toHaveText(/v\d+/);
  await expect(page.getByTestId('pack-progress')).toHaveText(new RegExp(`^1/${before.total} packed`));
});
