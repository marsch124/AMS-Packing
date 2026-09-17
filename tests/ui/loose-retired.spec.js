// Test 9: the "Loose items" bin is dissolved, and its contents SURVIVE as ordinary
// things on no list. (v177 — step 3 of "every item lives its own life".)
import { test, expect } from '@playwright/test';
import { openApp, restartApp } from './_app.js';

test('a Loose items bin is dissolved on start-up and its things survive', async ({ page }) => {
  await openApp(page, '#/things');

  // Plant an old-style bin with something in it, exactly as an older version left it.
  const parked = `Parked ${Date.now()}`;
  const planted = await page.evaluate(async (name) => {
    const db = await import('./js/db.js');
    const m = await import('./js/model.js');
    const bin = m.newList({ name: 'Loose items', role: 'loose', builtin: true });
    bin.items = [m.newItem({ name })];
    await db.saveList(bin);
    const lists = await db.getLists();
    return {
      binExists: lists.some((l) => l.role === 'loose'),
      inBin: (lists.find((l) => l.role === 'loose')?.items || []).some((i) => i.name === name),
    };
  }, parked);
  expect(planted).toEqual({ binExists: true, inBin: true });

  // Restart the app — a real reload, not a hash change: the start-up work dissolves it.
  await restartApp(page, '#/things');
  const after = await page.evaluate(async (name) => {
    const db = await import('./js/db.js');
    const lists = await db.getLists();
    const rows = await db.getItemsWithTemplates();
    const row = rows.find((r) => r.item.name === name);
    return { binExists: lists.some((l) => l.role === 'loose'), kept: !!row, templates: row ? row.templates.length : -1 };
  }, parked);
  expect(after.binExists, 'the bin is gone').toBe(false);
  expect(after.kept, 'the thing it held survived').toBe(true);
  expect(after.templates, 'and is now on no list').toBe(0);

  // And it is visible in Your things, marked as on no list.
  const row = page.getByTestId('thing-row').filter({ hasText: parked });
  await expect(row).toHaveCount(1);
  await expect(row.locator('.thing-nolist')).toBeVisible();

  // The Templates tab no longer offers a Loose items card.
  await page.getByTestId('tab-templates').click();
  await expect(page.locator('.loose-card')).toHaveCount(0);
});

test('Several adds a batch of things, all on no list', async ({ page }) => {
  await openApp(page, '#/things');
  const stamp = Date.now();
  const names = [`Batch A ${stamp}`, `Batch B ${stamp}`];
  page.once('dialog', (d) => d.dismiss());   // no prompt here, but never hang on one
  await page.getByTestId('thing-batch').click();
  await page.locator('.batch-ta').fill(names.join('\n'));
  await page.locator('[data-b="add"]').click();
  for (const n of names) {
    const row = page.getByTestId('thing-row').filter({ hasText: n });
    await expect(row).toHaveCount(1);
    await expect(row.locator('.thing-nolist')).toBeVisible();
  }
});
