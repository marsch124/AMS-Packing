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
    // 🪤 ...but that check is BLIND to content drawn past the edge, because <main>
    // clips rather than scrolls: the page stays phone-width while a count or a field
    // quietly disappears off the right. (v182 found two: a trip's 14/41 count, and
    // the item editor's When field, 20px over since before v181.) Anything inside a
    // deliberate sideways-swipe row is allowed to extend; nothing else is.
    const past = await page.evaluate(() => {
      const W = window.innerWidth;
      const inSwipeRow = (el) => {
        for (let p = el.parentElement; p && p.tagName !== 'MAIN'; p = p.parentElement) {
          const o = getComputedStyle(p).overflowX;
          if (o === 'auto' || o === 'scroll') return true;
        }
        return false;
      };
      return [...document.querySelectorAll('.screen *')]
        .filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.right > W + 1 && !inSwipeRow(el); })
        .slice(0, 3)
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.className.baseVal ?? el.className).split(' ')[0]}`);
    });
    expect(past, `${route} draws nothing past the right edge`).toEqual([]);
    // On a wide screen nothing needs a sideways swipe to be reached: the swipe rows
    // are a PHONE answer to a phone problem. (v182 first unstacked the trip toolbar
    // everywhere, and on the Mac that hid Excel behind a sideways scroll while
    // saving no height at all.)
    const onWideScreen = await page.evaluate(() => window.innerWidth >= 700);
    if (onWideScreen) {
      const hiddenTools = await page.evaluate(() => {
        const tb = document.querySelector('.trip-toolbar');
        if (!tb) return [];
        const edge = tb.getBoundingClientRect().right;
        return [...tb.querySelectorAll('.btn, .seg')]
          .filter((b) => b.getBoundingClientRect().right > edge + 1)
          .map((b) => (b.textContent || '').trim());
      });
      expect(hiddenTools, `${route}: on a wide screen every trip tool is in view`).toEqual([]);
    }
    expect(errors, `${route} raised no error`).toEqual([]);
  }
});
