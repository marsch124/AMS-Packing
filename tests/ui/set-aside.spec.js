// "Not this time": something left behind for THIS trip only.
//
// His words, packing for a real trip: "there are things that I don't want to
// bring this time, but I still want them to be on the list." The danger in a
// feature like this is quiet arithmetic — if what you set aside stays in the
// tally, the trip can never reach 100% and the ring reports finished work as
// unfinished. So this test watches the COUNT as much as the row.
import { test, expect } from '@playwright/test';
import { openApp, createTrip, restartApp, parseProgress } from './_app.js';

test.setTimeout(120_000);

// "2/38 · 3 set aside" -> { done: 2, total: 38, aside: 3 }
function parseGroupCount(text) {
  const m = /(\d+)\/(\d+)(?:\s*·\s*(\d+) set aside)?/.exec((text || '').replace(/\s+/g, ' '));
  if (!m) throw new Error(`count not understood: ${JSON.stringify(text)}`);
  return { done: Number(m[1]), total: Number(m[2]), aside: Number(m[3] || 0) };
}

test('a thing set aside leaves the count, stays on the list, and comes back', async ({ page }) => {
  await openApp(page);
  await createTrip(page);

  const count = page.getByTestId('group-count').first();
  const before = parseGroupCount(await count.textContent());
  expect(before.aside, 'nothing is set aside to begin with').toBe(0);
  expect(before.total).toBeGreaterThan(2);

  // Leave the first thing behind. One tap, no question.
  const row = page.locator('.total .entry').first();
  const name = (await row.locator('.e-name').textContent()).trim();
  await row.getByTestId('entry-skip').click();

  // It is still there — set aside is not delete.
  await expect(page.locator('.total .entry').first().locator('.e-name')).toHaveText(name);
  await expect(page.locator('.total .entry').first()).toHaveClass(/skipped/);
  await expect(page.locator('.total .entry').first().getByTestId('entry-skip'))
    .toHaveAttribute('aria-pressed', 'true');

  // …and it has left the tally, without being forgotten.
  await expect.poll(async () => parseGroupCount(await count.textContent()).total,
    { message: 'the count of what is left drops by one' }).toBe(before.total - 1);
  expect(parseGroupCount(await count.textContent()).aside, 'and is named beside it').toBe(1);

  // A decision, not a screen state: it survives closing the app.
  await restartApp(page, '#/events');
  await page.getByTestId('event-card').first().click();
  const kept = page.locator('.total .entry').filter({ hasText: name }).first();
  await expect(kept).toHaveClass(/skipped/);
  await expect(page.getByTestId('group-count').first()).toContainText('1 set aside');

  // Packing Mode walks what you are packing — not what you left behind.
  await page.getByTestId('pack-cta').click();
  const walk = parseProgress(await page.getByTestId('pack-progress').textContent());
  expect(walk.total, 'the walk is one shorter too').toBe(before.total - 1);
  await expect(page.locator('.pack-item').filter({ hasText: name })).toHaveCount(0);

  // And one tap takes it along after all.
  await page.goBack();
  const back = page.locator('.total .entry').filter({ hasText: name }).first();
  await back.getByTestId('entry-skip').click();
  await expect(back).not.toHaveClass(/skipped/);
  await expect.poll(async () => parseGroupCount(await page.getByTestId('group-count').first().textContent()).total)
    .toBe(before.total);
});
