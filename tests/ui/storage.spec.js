// Tests 11–13: the storage layer — the part with no coverage at all until now, and
// the part where every dangerous bug in this app has lived. These run against the
// real database in the browser, because none of it can be reached from the model
// tests. Controls are still found by identifier; the setup and the checks talk to
// the app's own db module.
import { test, expect } from '@playwright/test';
import { openApp, restartApp } from './_app.js';

// --- 11 ------------------------------------------------------------------
// The automatic on-device backup, end to end, through its real buttons. It is the
// app's own safety net, and an untested safety net should be assumed dead.
test('an on-device backup restores what was there, including settings', async ({ page }) => {
  await openApp(page, '#/settings');

  const thing = `Kept ${Date.now()}`;
  await page.evaluate(async (name) => {
    const db = await import('./js/db.js');
    const m = await import('./js/model.js');
    await db.saveCatalogItem(m.newItem({ name }));                 // a thing on no list
    localStorage.setItem('ams-grab-lists', JSON.stringify({ bike: ['Helmet', 'Bidon'] }));
    localStorage.setItem('ams-grab-meta', JSON.stringify({ bike: { label: 'Biz trip', tone: 'purple' } }));
  }, thing);
  await restartApp(page, '#/settings');                            // so the grab lists are live

  // Take the backup through the button a person would press.
  const fold = page.getByTestId('fold-snapshots');
  if (!(await fold.evaluate((d) => d.open))) await fold.locator('summary').click();
  await page.getByTestId('snapshot-save').click();
  await expect(page.getByTestId('snapshot-row').first()).toBeVisible();

  // Now lose all of it, the way a bad edit or a mistaken import would.
  await page.evaluate(async (name) => {
    const db = await import('./js/db.js');
    const rows = await db.getItemsWithTemplates();
    const row = rows.find((r) => r.item.name === name);
    await db.deleteCatalogItem(row.item.id);
    localStorage.setItem('ams-grab-lists', JSON.stringify({ bike: ['Wrong'] }));
    localStorage.setItem('ams-grab-meta', JSON.stringify({ bike: { label: 'Wrong', tone: 'red' } }));
  }, thing);
  const gone = await page.evaluate(async (name) => {
    const db = await import('./js/db.js');
    return (await db.getItemsWithTemplates()).some((r) => r.item.name === name);
  }, thing);
  expect(gone, 'the thing really was lost').toBe(false);

  // Restore, through its real button.
  page.on('dialog', (d) => d.accept());
  const f2 = page.getByTestId('fold-snapshots');
  if (!(await f2.evaluate((d) => d.open))) await f2.locator('summary').click();
  await page.getByTestId('snapshot-restore').first().click();
  await expect.poll(async () => page.evaluate(async (name) => {
    const db = await import('./js/db.js');
    return (await db.getItemsWithTemplates()).some((r) => r.item.name === name);
  }, thing), { timeout: 15_000 }).toBe(true);

  // ...and the settings that only live outside the database came back too.
  const grab = await page.evaluate(() => ({
    items: JSON.parse(localStorage.getItem('ams-grab-lists') || '{}').bike,
    label: (JSON.parse(localStorage.getItem('ams-grab-meta') || '{}').bike || {}).label,
  }));
  expect(grab.items, 'the grab list came back').toEqual(['Helmet', 'Bidon']);
  expect(grab.label, 'and its name').toBe('Biz trip');
});

// --- 12 ------------------------------------------------------------------
// The promise the whole storage model rests on since v108: one thing, many lists.
test('one thing in three templates: renaming reaches all, removing frees only one', async ({ page }) => {
  await openApp(page);
  const result = await page.evaluate(async () => {
    const db = await import('./js/db.js');
    const m = await import('./js/model.js');
    const names = ['T1 ' + Date.now(), 'T2 ' + Date.now(), 'T3 ' + Date.now()];
    const made = [];
    for (const n of names) { const l = m.newList({ name: n }); await db.saveList(l); made.push(l.id); }

    // One thing, put on all three.
    const cat = await db.saveCatalogItem(m.newItem({ name: 'Shared thing', weight: 250 }));
    for (const id of made) {
      const l = (await db.getLists()).find((x) => x.id === id);
      l.items.push(m.linkFromResolved(m.resolveItemAlone(cat), cat.id, {}));
      await db.saveList(l);
    }
    const on = async () => (await db.getItemsWithTemplates()).find((r) => r.item.id === cat.id);
    const start = (await on()).templates.length;

    // Rename it once, in one template.
    let l0 = (await db.getLists()).find((x) => x.id === made[0]);
    const row = l0.items.find((z) => z._itemId === cat.id);
    row.name = 'Renamed thing';
    await db.saveList(l0);
    const lists1 = await db.getLists();
    const namesEverywhere = made.map((id) => {
      const l = lists1.find((x) => x.id === id);
      return (l.items.find((z) => z._itemId === cat.id) || {}).name;
    });

    // Take it off ONE template.
    let l1 = (await db.getLists()).find((x) => x.id === made[1]);
    l1.items = l1.items.filter((z) => z._itemId !== cat.id);
    await db.saveList(l1);
    const afterOne = (await on()).templates.length;

    // Take it off the remaining two — the thing must still exist (v176).
    for (const id of [made[0], made[2]]) {
      const l = (await db.getLists()).find((x) => x.id === id);
      l.items = l.items.filter((z) => z._itemId !== cat.id);
      await db.saveList(l);
    }
    const last = await on();
    const survivor = (await db.getCatalogItems()).find((i) => i.id === cat.id);
    for (const id of made) await db.deleteList(id);            // tidy up
    return {
      start, namesEverywhere, afterOne,
      stillListed: !!last, templatesLeft: last ? last.templates.length : -1,
      survives: !!survivor, keptWeight: survivor ? survivor.weight : -1,
      keptName: survivor ? survivor.name : '',
    };
  });

  expect(result.start, 'on all three').toBe(3);
  expect(result.namesEverywhere, 'renamed once, renamed everywhere').toEqual(['Renamed thing', 'Renamed thing', 'Renamed thing']);
  expect(result.afterOne, 'removing from one leaves the other two').toBe(2);
  expect(result.survives, 'losing its last template does not destroy the thing').toBe(true);
  expect(result.templatesLeft, 'it is simply on no list').toBe(0);
  expect(result.keptName).toBe('Renamed thing');
  expect(result.keptWeight, 'with its own fields intact').toBe(250);
});

// --- 13 ------------------------------------------------------------------
// Every restore takes a copy first so it is itself undoable. That copy used to be
// taken WITHOUT the settings — the one copy whose whole job is putting things back
// was the one that could not put the settings back (found and fixed in v161).
test('the safety copy taken before a restore carries the settings too', async ({ page }) => {
  await openApp(page);
  const res = await page.evaluate(async () => {
    const db = await import('./js/db.js');
    const before = (await db.listSnapshots()).length;
    // A restore of anything at all: take a snapshot, then restore it, passing prefs
    // exactly as the app does.
    const mine = await db.saveSnapshot({ reason: 'manual', prefs: { theme: 'dark', grab: { items: { bike: ['X'] } } }, force: true });
    await db.restoreSnapshot(mine.id, { theme: 'light', grab: { items: { bike: ['Current'] } } });
    const all = await db.listSnapshots();
    const safety = all.find((s) => s.reason === 'before-restore');
    return {
      grew: all.length > before,
      hasSafety: !!safety,
      safetyPrefs: safety ? safety.data.prefs : null,
    };
  });
  expect(res.hasSafety, 'a before-restore copy was taken').toBe(true);
  expect(res.safetyPrefs, 'and it carries the settings, not null').not.toBeNull();
  expect(res.safetyPrefs.grab.items.bike, 'the settings as they were at that moment').toEqual(['Current']);
});

// --- 14 ------------------------------------------------------------------
// v188. A Replace-restore rebuilds the catalogue from the lists in the file, and
// that rebuild used to carry a hand-written subset of a thing's fields: who packs
// it, "not in use", which kit it is in and everything the trip reviews had taught
// were all in the file and all dropped on the way back in. Test 11 could not see
// it — it checked that a thing came back, not what came back with it. This one
// goes out through the app's own backup writer, back in through the real Import
// button, and then looks at each field ON SCREEN.
test('a restore from a file keeps the packer, "not in use", the kit and the review count', async ({ page }) => {
  test.setTimeout(90_000);
  await openApp(page);
  const ts = Date.now();
  const n = { tpl: `Camp ${ts}`, lamp: `Headlamp ${ts}`, bank: `Power bank ${ts}`, kit: `Charging kit ${ts}` };

  // A template with two things: one with a packer, not in use (sold) and a review
  // history Refine will show; one packed as part of a kit.
  const file = await page.evaluate(async (n) => {
    const db = await import('./js/db.js'); const m = await import('./js/model.js');
    const tpl = m.newList({ name: n.tpl });
    tpl.items = [
      m.newItem({ name: n.lamp, packer: 'Anna', retired: true, retiredReason: 'sold', consumable: true,
        stats: { packed: 3, used: 0, unused: 3, skipped: 0, lastReviewed: '2026-08-01T00:00:00.000Z' } }),
      m.newItem({ name: n.bank, kit: n.kit }),
    ];
    await db.saveList(tpl);
    return db.exportJSON({});                                   // what "Save backup file" writes
  }, n);

  // Lose the template and both things.
  await page.evaluate(async (n) => {
    const db = await import('./js/db.js');
    const tpl = (await db.getLists()).find((l) => l.name === n.tpl);
    await db.deleteList(tpl.id);
    for (const r of await db.getItemsWithTemplates()) {
      if (r.item.name === n.lamp || r.item.name === n.bank) await db.deleteCatalogItem(r.item.id);
    }
  }, n);
  const gone = await page.evaluate(async (n) => {
    const db = await import('./js/db.js');
    return (await db.getLists()).some((l) => l.name === n.tpl)
      || (await db.getItemsWithTemplates()).some((r) => r.item.name === n.lamp);
  }, n);
  expect(gone, 'the template and its things really were lost').toBe(false);

  // Put the file back through the real Import button, answering its questions:
  // "Continue?" yes · "Merge (OK) or Replace (Cancel)?" Replace · "Imported." ok.
  await page.evaluate(() => { window.location.hash = '#/settings'; });
  await expect(page.locator('#app[data-route="#/settings"]')).toBeAttached();
  const fold = page.getByTestId('fold-data');
  if (!(await fold.evaluate((d) => d.open))) await fold.locator('summary').click();
  page.on('dialog', (d) => (d.message().startsWith('Import as a MERGE') ? d.dismiss() : d.accept()));
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('backup-import').click();
  await (await chooser).setFiles({ name: `ams-packing-list-backup-${ts}.json`, mimeType: 'application/json', buffer: Buffer.from(file) });
  await expect.poll(async () => page.evaluate(async (n) => {
    const db = await import('./js/db.js');
    return (await db.getLists()).some((l) => l.name === n.tpl);
  }, n), { timeout: 20_000 }).toBe(true);

  // The thing's own answers, in its editor: who packs it, and that it is not in use.
  await page.evaluate(() => { window.location.hash = '#/things'; });
  await expect(page.locator('#app[data-route="#/things"]')).toBeAttached();
  await page.getByTestId('thing-search').fill(n.lamp);
  // 🪤 Find the row by ITS name, never as "the one row left after the search": on
  // the CI runner the screen was redrawn under the test right after the search
  // (a render still in flight from the import), the filtered row was detached and
  // a bare `thing-row` click then met all 428 rows. Filtered by text it resolves
  // to exactly one element however many rows are on screen.
  const lampRow = page.getByTestId('thing-row').filter({ hasText: n.lamp });
  await expect(lampRow).toHaveCount(1);
  await lampRow.click();
  await expect(page).toHaveURL(/#\/thing\//);
  await expect(page.getByTestId('item-packer'), 'Packed by came back').toHaveValue('Anna');
  await expect(page.getByTestId('item-retired'), 'Not in use came back').toBeChecked();
  await expect(page.getByTestId('item-retired-reason').locator('select'), 'with its reason').toHaveValue('sold');

  // What the trips taught it: Refine still knows it was packed three times and never used.
  await page.evaluate(() => { window.location.hash = '#/refine'; });
  await expect(page.locator('#app[data-route="#/refine"]')).toBeAttached();
  await expect(page.getByTestId('refine-row').filter({ hasText: n.lamp }), 'the review count came back').toContainText('packed 3×');

  // And the kit: a trip built from the restored template clusters the power bank under it.
  const evId = await page.evaluate(async (n) => {
    const db = await import('./js/db.js'); const m = await import('./js/model.js');
    const tpl = (await db.getLists()).find((l) => l.name === n.tpl);
    const ev = m.newEvent({ name: `Trip ${n.tpl}`, startDate: '2026-12-01', activities: [tpl.id] });
    ev.entries = m.buildTotalEntries(ev, [tpl]);
    await db.saveEvent(ev);
    return ev.id;
  }, n);
  await page.evaluate((id) => { window.location.hash = `#/event/${id}`; }, evId);
  await expect(page.locator(`#app[data-route="#/event/${evId}"]`)).toBeAttached();
  await expect(page.getByTestId('kit-cluster').filter({ hasText: n.kit }), 'the kit came back with the template').toHaveCount(1);
});
