// Tests 15–16: the workout grab lists — the part of this app used most often, and
// the part with no coverage at all until now. These are the lists he picks up with
// his glasses off on the way out of the door, so a silent break here costs a
// workout, not a tidy-up.
import { test, expect } from '@playwright/test';
import { openApp, restartApp } from './_app.js';

// --- 15: using one ---------------------------------------------------------
test('a grab list counts what is in hand, holds things back, and remembers', async ({ page }) => {
  await openApp(page, '#/grab/bike');

  const count = page.getByTestId('grab-count');
  const items = page.getByTestId('grab-item');
  const total = await items.count();
  expect(total, 'the list has things on it').toBeGreaterThan(2);
  await expect(count).toHaveText(new RegExp(`^0 of ${total} in hand`));

  // "Ready to go" before you have everything must NOT leave the screen.
  await page.getByTestId('grab-ready').click();
  await expect(page).toHaveURL(/#\/grab\/bike$/);
  await expect(count).toHaveText(new RegExp(`^0 of ${total} in hand`));

  // Pick two up.
  await items.nth(0).click();
  await items.nth(1).click();
  await expect(count).toHaveText(new RegExp(`^2 of ${total} in hand`));

  // Leave one behind just this once: it stops being counted as needed.
  await page.getByTestId('grab-skip').nth(2).click();
  await expect(count).toHaveText(new RegExp(`^2 of ${total - 1} in hand · 1 skipped`));

  // Ticks are a saved fact — they survive leaving and coming back.
  await restartApp(page, '#/grab/bike');
  await expect(page.getByTestId('grab-count')).toHaveText(new RegExp(`^2 of ${total - 1} in hand · 1 skipped`));

  // Start over clears both the ticks and the skip.
  await page.getByTestId('grab-reset').click();
  await expect(page.getByTestId('grab-count')).toHaveText(new RegExp(`^0 of ${total} in hand`));

  // With everything in hand the count gives way to the "all there" banner — the
  // signal he reads across the room with his glasses off.
  const fresh = page.getByTestId('grab-item');
  for (let i = 0; i < total; i++) await fresh.nth(i).click();
  await expect(page.getByTestId('grab-allthere')).toBeVisible();
  await expect(page.getByTestId('grab-count')).toHaveCount(0);
  await page.getByTestId('grab-ready').click();
  await expect(page).toHaveURL(/#\/$/, { timeout: 15_000 });
});

// --- 16: changing one ------------------------------------------------------
test('editing a grab list sticks, and reaches the account', async ({ page }) => {
  await openApp(page, '#/grab/run');
  const added = `Gels ${Date.now()}`;

  await page.getByTestId('grab-edit').click();
  await page.getByTestId('grab-add-name').fill(added);
  await page.getByTestId('grab-add').click();

  // Fix a typo on the first thing, the way the pencil is meant to be used.
  const firstName = page.getByTestId('grab-rename').first();
  const renamed = `Shoes ${Date.now()}`;
  await firstName.fill(renamed);
  await firstName.blur();
  await page.getByTestId('grab-done').click();

  // Both changes are on the list, and still there after a restart.
  await expect(page.getByTestId('grab-item').filter({ hasText: added })).toHaveCount(1);
  await restartApp(page, '#/grab/run');
  await expect(page.getByTestId('grab-item').filter({ hasText: added })).toHaveCount(1);
  await expect(page.getByTestId('grab-item').filter({ hasText: renamed })).toHaveCount(1);

  // ...and the list reached the account's shared store, which is what carries it
  // to his other device (v163) and into the "is this device missing anything" check.
  const shared = await page.evaluate(async () => {
    const db = await import('./js/db.js');
    const rows = await db.getSharedRows();
    const row = rows.find((r) => r.kind === 'grab' && r.data && r.data.gid === 'run');
    return row ? row.data.items : null;
  });
  expect(shared, 'the run list is in the shared store').not.toBeNull();
  expect(shared, 'with the added thing').toContain(added);
  expect(shared, 'and the corrected name').toContain(renamed);
});
