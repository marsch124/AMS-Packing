// Test 6 of the suite: an item that sits in several templates is ONE row on the Care list.
// (The v165 bug: it used to be one row per template, and "3 overdue" for one jacket.)
import { test, expect } from '@playwright/test';
import { openApp } from './_app.js';

test('an item in several templates is listed once on Care, naming all of them', async ({ page }) => {
  await openApp(page);

  // Test data, through the app's own storage: pick a thing that already sits in
  // at least two templates and give it an overdue care schedule.
  const fixture = await page.evaluate(async () => {
    const db = await import('./js/db.js');
    const lists = (await db.getLists()).filter((l) => l.role !== 'container' && l.role !== 'loose');
    const homes = new Map();
    for (const l of lists) for (const it of l.items) {
      const k = it._itemId || it.id;
      if (!homes.has(k)) homes.set(k, []);
      homes.get(k).push(l);
    }
    const found = [...homes.entries()].find(([, ls]) => ls.length >= 2);
    if (!found) return null;
    const [key, ls] = found;
    const target = ls[0].items.find((it) => (it._itemId || it.id) === key);
    target.maintenance = { notes: 'Test care', link: '', intervalDays: 30, lastDone: '2020-01-01', log: [] };
    await db.saveList(ls[0]);
    return { name: target.name, templates: ls.map((l) => l.name) };
  });
  expect(fixture, 'a starter item that lives in two or more templates').not.toBeNull();

  await page.getByTestId('tab-care').click();
  const row = page.getByTestId('care-row').filter({ hasText: fixture.name });
  await expect(row).toHaveCount(1);                       // once — not once per template
  await expect(row).toContainText(fixture.templates[0]);   // and it says where it lives
  await expect(row).toContainText(fixture.templates[1]);
});
