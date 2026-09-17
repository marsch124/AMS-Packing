// Tests 21–22: kits (things always packed together) and sharing (a template sent
// to another phone as a link). Both are "set up once, relied on later" features,
// so a break is invisible until the moment it matters.
import { test, expect } from '@playwright/test';
import { openApp } from './_app.js';

test('a kit lands on a trip as one cluster, and packs as one', async ({ page }) => {
  await openApp(page);

  const kitName = `Charging kit ${Date.now()}`;
  const trip = await page.evaluate(async (kn) => {
    const db = await import('./js/db.js');
    const m = await import('./js/model.js');
    // Three things, a kit made of them, and a trip built from a template holding them.
    const tpl = m.newList({ name: `Kit tpl ${Date.now()}` });
    tpl.items = ['Cable', 'Plug', 'Power bank'].map((n) => m.newItem({ name: `${n} ${Date.now()}` }));
    await db.saveList(tpl);
    const saved = (await db.getLists()).find((l) => l.id === tpl.id);
    const kit = m.newKit({ name: kn, emoji: '🔌' });
    kit.itemIds = saved.items.map((i) => i._itemId);
    await db.saveKit(kit);
    // The trip, with the kit tagged onto its entries the way addKitToTrip does.
    const ev = m.newEvent({ name: `Kit trip ${Date.now()}`, startDate: '2026-12-01', activities: [tpl.id] });
    ev.entries = m.buildTotalEntries(ev, [saved]).map((e) => ({ ...e, kit: kn }));
    await db.saveEvent(ev);
    return { ev: ev.id, members: kit.itemIds.length };
  }, kitName);

  await page.evaluate((id) => { window.location.hash = `#/event/${id}`; }, trip.ev);
  await expect(page.locator(`#app[data-route="#/event/${trip.ev}"]`)).toBeAttached();

  // The kit reads as ONE thing on the list, with its own count.
  const cluster = page.getByTestId('kit-cluster').filter({ hasText: kitName });
  await expect(cluster, 'the kit is one cluster').toHaveCount(1);
  await expect(cluster).toContainText(`0/${trip.members}`);

  // "Pack all" packs the whole kit in one tap, and it is really saved.
  await cluster.getByTestId('kit-packall').click();
  await expect(cluster).toContainText(`${trip.members}/${trip.members}`);
  await expect.poll(async () => page.evaluate(async (id) => {
    const db = await import('./js/db.js');
    const ev = await db.getEvent(id);
    return ev.entries.filter((e) => e.checked).length;
  }, trip.ev), { timeout: 10_000 }).toBe(trip.members);

  // And it unpacks as one too.
  await cluster.getByTestId('kit-packall').click();
  await expect(cluster).toContainText(`0/${trip.members}`);
});

test('a template shared as a link can be taken in by pasting it back', async ({ page }) => {
  await openApp(page, '#/lists');

  // A template with something distinctive on it.
  const tplName = `Shared ${Date.now()}`;
  const itemName = `Wetsuit ${Date.now()}`;
  const link = await page.evaluate(async (n) => {
    const db = await import('./js/db.js');
    const m = await import('./js/model.js');
    const l = m.newList({ name: n.tpl });
    l.items = [m.newItem({ name: n.item, category: 'Sport gear' })];
    await db.saveList(l);
    const saved = (await db.getLists()).find((x) => x.id === l.id);
    const code = m.encodeListShare(saved);
    // Then lose it, so the paste has to do real work.
    await db.deleteList(l.id);
    return code;
  }, { tpl: tplName, item: itemName });
  expect(link, 'a share code was produced').toBeTruthy();

  const gone = await page.evaluate(async (n) => {
    const db = await import('./js/db.js');
    return (await db.getLists()).some((l) => l.name === n);
  }, tplName);
  expect(gone, 'the template really is gone').toBe(false);

  // Paste it back in, through the real control in Settings.
  await page.evaluate(() => { window.location.hash = '#/settings'; });
  await expect(page.locator('#app[data-route="#/settings"]')).toBeAttached();
  const fold = page.getByTestId('fold-sharedtrips');
  if (!(await fold.evaluate((d) => d.open))) await fold.locator('summary').click();
  page.on('dialog', (d) => d.accept());
  await page.getByTestId('paste-share').click();
  await page.getByTestId('paste-input').fill(link);
  await page.getByTestId('paste-import').click();

  // What arrived is shown first, with an honest choice — take it as a new template.
  await expect(page.getByTestId('share-add')).toBeVisible();
  await page.getByTestId('share-add').click();

  // The template is back, with its item.
  await expect.poll(async () => page.evaluate(async (n) => {
    const db = await import('./js/db.js');
    const l = (await db.getLists()).find((x) => x.name === n.tpl);
    return l ? l.items.map((i) => i.name) : null;
  }, { tpl: tplName, item: itemName }), { timeout: 15_000 }).toContain(itemName);
});
