// A backup has to survive the whole round trip: out of the app into a place you
// chose, and back in again from the file.
//
// Both halves had a hole, found on 2026-09-21 by restoring his REAL backup into a
// throwaway copy of the app rather than counting what was in it:
//   · a file restore dropped his own "When" timeline and every thing on no list
//     — both were written into the file, then thrown away on the way back in;
//   · on the iPhone, "Save backup" was a download link, which does nothing inside
//     a Home Screen app — while the app recorded "backed up" anyway.
import { test, expect } from '@playwright/test';
import { openApp, restartApp } from './_app.js';

test.setTimeout(120_000);

test('a restore from a file brings back his own timeline and his loose things', async ({ page }) => {
  await openApp(page);

  // His state: a renamed phase, one he added himself, and a thing on no list.
  const file = await page.evaluate(async () => {
    const db = await import('./js/db.js'); const m = await import('./js/model.js');
    const phases = (await db.getPhases()).map((p) => (p.id === 'week' ? { ...p, label: 'A week ahead' } : p));
    phases.push({ id: 'prep-load-the-rv', label: 'Prep/load the RV', order: 99 });
    await db.savePhases(phases);
    await db.saveCatalogItem(m.newItem({ name: 'Loose head torch' }));
    return db.exportJSON({});
  });

  // Something happens to the device…
  await page.evaluate(async () => {
    const db = await import('./js/db.js');
    await db.savePhases([]);                         // back to the factory seven
    const t = (await db.getUnlistedItems()).find((i) => i.name === 'Loose head torch');
    if (t) await db.deleteCatalogItem(t.id);
  });

  // …and the file is put back.
  await page.evaluate(async (text) => { const db = await import('./js/db.js'); await db.importJSON(text, {}); }, file);
  await restartApp(page);

  const back = await page.evaluate(async () => {
    const db = await import('./js/db.js');
    return {
      phases: (await db.getPhases()).map((p) => `${p.id}=${p.label}`),
      loose: (await db.getUnlistedItems()).map((i) => i.name),
    };
  });
  expect(back.phases, 'his renamed phase came back').toContain('week=A week ahead');
  expect(back.phases, 'and the one he added himself').toContain('prep-load-the-rv=Prep/load the RV');
  expect(back.loose, 'a thing on no list survives a file restore').toContain('Loose head torch');
});

test('on the phone, Save backup opens the share sheet and records only a real save', async ({ page }) => {
  // The share sheet, stood in for: it keeps what it is handed, and answers the way
  // the test tells it to — saved, or cancelled.
  await page.addInitScript(() => {
    window.__shareAnswer = 'saved';
    window.__shared = [];
    navigator.canShare = () => true;
    navigator.share = async ({ files }) => {
      for (const f of files || []) window.__shared.push({ name: f.name, text: await f.text() });
      if (window.__shareAnswer === 'cancel') { const e = new Error('cancelled'); e.name = 'AbortError'; throw e; }
    };
  });
  await openApp(page, '#/settings');
  const fold = page.getByTestId('fold-data');
  if (!(await fold.getAttribute('open'))) await fold.locator('summary').click();

  // Cancelled: nothing saved, and nothing recorded as saved.
  await page.evaluate(() => { window.__shareAnswer = 'cancel'; localStorage.removeItem('ams-last-backup'); });
  await page.getByTestId('backup-save').click();
  await expect.poll(() => page.evaluate(() => window.__shared.length)).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem('ams-last-backup')), 'a cancelled share is not a backup').toBeNull();

  // Saved: the file handed over is a real, complete backup, and only then recorded.
  await page.evaluate(() => { window.__shareAnswer = 'saved'; });
  await page.getByTestId('backup-save').click();
  await expect.poll(() => page.evaluate(() => window.__shared.length)).toBe(2);
  const handed = await page.evaluate(() => window.__shared[1]);
  expect(handed.name).toMatch(/^ams-packing-list-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const data = JSON.parse(handed.text);
  expect(data.app).toBe('ams-packing-list');
  expect(data.lists.length, 'the file holds his templates').toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('ams-last-backup')),
    { message: 'a saved share is recorded as a backup' }).not.toBeNull();
});
