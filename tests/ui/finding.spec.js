// Tests 19–20: finding things, and the two to-do lists.
import { test, expect } from '@playwright/test';
import { openApp } from './_app.js';

test('search finds a thing, a template and a trip, and its hits lead somewhere', async ({ page }) => {
  await openApp(page);
  const stamp = Date.now();
  const words = { thing: `Zzthing${stamp}`, tpl: `Zztemplate${stamp}`, trip: `Zztrip${stamp}` };
  await page.evaluate(async (w) => {
    const db = await import('./js/db.js');
    const m = await import('./js/model.js');
    await db.saveCatalogItem(m.newItem({ name: w.thing }));
    await db.saveList(m.newList({ name: w.tpl }));
    await db.saveEvent(m.newEvent({ name: w.trip, startDate: '2026-11-01' }));
  }, words);

  await page.evaluate(() => { window.location.hash = '#/search'; });
  await expect(page.locator('#app[data-route="#/search"]')).toBeAttached();

  // A distinctive word finds exactly its own kind of thing.
  for (const [kind, word] of Object.entries(words)) {
    await page.getByTestId('search-input').fill(word);
    await expect(page.getByTestId('search-hit'), `search finds the ${kind}`).toHaveCount(1);
    await expect(page.getByTestId('search-hit')).toContainText(word);
  }

  // A hit is a way in, not just a label.
  const href = await page.getByTestId('search-hit').first().getAttribute('href');
  expect(href, 'the hit links somewhere').toMatch(/^#\//);
  await page.getByTestId('search-hit').first().click();
  await expect(page).not.toHaveURL(/#\/search$/);

  // Nonsense finds nothing, rather than everything.
  await page.evaluate(() => { window.location.hash = '#/search'; });
  await page.getByTestId('search-input').fill('qqzzxx-nothing-matches');
  await expect(page.getByTestId('search-hit')).toHaveCount(0);
});

test('a to-do can be added and ticked, and a suggestion joins the shopping list', async ({ page }) => {
  await openApp(page, '#/actions');
  const todo = `Book the ferry ${Date.now()}`;

  // Add a to-do: New opens an inline editor, which is filled in and saved.
  await page.getByTestId('action-new').click();
  await expect(page.getByTestId('action-editor')).toBeVisible();
  await page.getByTestId('action-text').fill(todo);
  await page.getByTestId('action-save').click();
  const row = page.getByTestId('action-row').filter({ hasText: todo });
  await expect(row).toHaveCount(1);

  // Tick it: the tick is saved, not just drawn.
  await row.getByTestId('action-tick').click();
  await expect.poll(async () => page.evaluate(async (t) => {
    const db = await import('./js/db.js');
    return (await db.getActions()).some((a) => a.text === t && a.done);
  }, todo), { timeout: 10_000 }).toBe(true);

  // The shopping list suggests what needs buying, and Add puts it on the list.
  const consumable = `Sunscreen ${Date.now()}`;
  await page.evaluate(async (n) => {
    const db = await import('./js/db.js');
    const m = await import('./js/model.js');
    await db.saveCatalogItem(m.newItem({ name: n, consumable: true }));
  }, consumable);

  await page.evaluate(() => { window.location.hash = '#/shopping'; });
  await expect(page.locator('#app[data-route="#/shopping"]')).toBeAttached();
  const suggestion = page.getByTestId('shop-suggestion').filter({ hasText: consumable });
  await expect(suggestion, 'a consumable is suggested').toHaveCount(1);
  await suggestion.getByTestId('shop-add').click();

  // It is now a real line on the buy-list, and no longer merely a suggestion.
  await expect(page.getByTestId('shop-row').filter({ hasText: consumable })).toHaveCount(1);
  await expect(page.getByTestId('shop-suggestion').filter({ hasText: consumable })).toHaveCount(0);
});
