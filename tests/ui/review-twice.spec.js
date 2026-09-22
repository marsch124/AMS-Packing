// A thing can sit on ONE template twice, with a different "When" each time (a real
// Golf template has three such things). Until v189 the trip review taught such a
// thing nothing: the review updated the first copy, and saving the template let the
// second, untouched copy write its old counts back over the new ones. So it never
// reached Refine, and "Keep" on it never stuck either.
import { test, expect } from '@playwright/test';
import { openApp, restartApp } from './_app.js';

test('a thing twice on one template learns from every trip review, once', async ({ page }) => {
  test.setTimeout(60_000);
  await openApp(page);
  const stamp = Date.now();
  const thing = `Test tee bag ${stamp}`;

  // Test data through the app's own modules: a template holding the thing twice.
  const listId = await page.evaluate(async ({ stamp, thing }) => {
    const db = await import('./js/db.js');
    const M = await import('./js/model.js');
    const list = M.newList({ name: `Test golf ${stamp}` });
    list.items = [M.newItem({ name: thing, phase: 'week' }), M.newItem({ name: thing, phase: 'morning' })];
    await db.saveList(list);
    return list.id;
  }, { stamp, thing });
  const copies = await page.evaluate(async (id) => {
    const db = await import('./js/db.js');
    const rows = (await db.getList(id)).items;
    return { rows: rows.length, things: new Set(rows.map((r) => r._itemId)).size };
  }, listId);
  expect(copies, 'one thing, two places on the template').toEqual({ rows: 2, things: 1 });

  // Two trips from that template: the thing goes in the bag and is never used.
  for (let trip = 1; trip <= 2; trip += 1) {
    const eventId = await page.evaluate(async ({ listId, name }) => {
      const db = await import('./js/db.js');
      const M = await import('./js/model.js');
      const ev = M.newEvent({ name, mode: 'quick', activities: [listId] });
      ev.entries = M.buildTotalEntries(ev, await db.getLists());
      for (const e of ev.entries) e.checked = true;          // packed
      await db.saveEvent(ev);
      return ev.id;
    }, { listId, name: `Test round ${trip} ${stamp}` });

    await restartApp(page, `#/event/${eventId}`);
    await page.getByTestId('event-review').click();
    await page.getByTestId('review-find').fill(thing);
    await page.getByTestId('review-item').filter({ hasText: thing }).click();   // didn't use it
    await page.getByTestId('review-save').click();
    await expect(page).toHaveURL(/#\/refine$/);
  }

  // Two quiet trips is exactly what Refine waits for — and it names the thing once.
  const row = page.getByTestId('refine-row').filter({ hasText: thing });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('packed 2×');

  // "Keep" settles it: gone at once, and still gone after a restart.
  await row.getByTestId('refine-keep').click();
  await expect(row).toHaveCount(0);
  await restartApp(page, '#/refine');
  await expect(page.locator('#app[data-route="#/refine"]')).toBeAttached();
  await expect(page.getByTestId('refine-row').filter({ hasText: thing })).toHaveCount(0);
});
