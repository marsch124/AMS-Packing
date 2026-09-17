// Test 10: every screen opens, renders, and raises no error.
//
// The broadest, cheapest guard there is: a crash on any one screen — a renamed
// helper, a field read from markup that is no longer there — turns the publish red
// instead of reaching the phone. Screens are reached by their real addresses; what
// is asserted is only that something rendered and nothing threw.
import { test, expect } from '@playwright/test';
import { openApp } from './_app.js';

// Twenty-two screens in one test, and some are genuinely heavy (All items builds a
// 400-row table). The default 30s budget is for a single interaction, not a tour.
test.setTimeout(120_000);

test('every screen opens without an error', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`${e}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/dexie\.cloud|Failed to load resource|service worker/i.test(m.text())) errors.push(m.text()); });

  await openApp(page);

  // Real content to render: a trip with entries, a template, and a thing on no list.
  const ids = await page.evaluate(async () => {
    const db = await import('./js/db.js');
    const m = await import('./js/model.js');
    const lists = (await db.getLists()).filter((l) => l.role !== 'container' && l.items.length > 3);
    const src = lists.slice(0, 2);
    const ev = m.newEvent({
      name: 'Route check', startDate: '2026-10-01', endDate: '2026-10-08', nights: 7,
      destination: 'Visby, Sweden', activities: src.map((l) => l.id),
    });
    ev.entries = m.buildTotalEntries(ev, src);
    ev.entries.forEach((e, i) => { e.checked = i % 3 === 0; });
    await db.saveEvent(ev);
    const thing = await db.saveCatalogItem(m.newItem({ name: 'Route check thing' }));
    const tpl = src[0];
    return { ev: ev.id, tpl: tpl.id, item: tpl.items[0].id, thing: thing.id };
  });

  const routes = [
    '#/', '#/events', '#/map', '#/lists', '#/refine', '#/maintenance', '#/containers',
    '#/items', '#/things', '#/actions', '#/shopping', '#/search', '#/settings', '#/overview',
    '#/grab/bike',
    `#/event/${ids.ev}`, `#/event/${ids.ev}/pack`, `#/event/${ids.ev}/review`, `#/event/${ids.ev}/edit`,
    `#/list/${ids.tpl}`, `#/list/${ids.tpl}/item/${ids.item}`, `#/thing/${ids.thing}`,
  ];

  for (const route of routes) {
    await page.evaluate((h) => { window.location.hash = h; }, route);
    // Wait for THIS screen, not whichever one is still on show: #app carries the
    // route it last rendered, written after the swap.
    await expect(page.locator(`#app[data-route="${route}"]`), `${route} renders`).toBeAttached({ timeout: 30_000 });
    await expect(page.locator('.screen'), `${route} renders a screen`).toBeVisible();
    // Something was actually drawn, not an empty shell.
    const text = (await page.locator('.screen').innerText()).trim();
    expect(text.length, `${route} has content`).toBeGreaterThan(10);
    // The phone must never scroll sideways (the v165 bug).
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(wide, `${route} does not scroll sideways`).toBe(false);
    expect(errors, `${route} raised no error`).toEqual([]);
  }
});
