// Tests 17–18: two things that fail SILENTLY when they break — an export that
// writes nothing, and a photo that is not really kept. Neither shows an error on
// screen, so neither would be noticed until the day it mattered.
import { test, expect } from '@playwright/test';
import { openApp, restartApp } from './_app.js';

// A tiny real PNG (1×1, transparent) — enough to travel the whole photo pipeline.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

test('the Excel export writes a real file', async ({ page }) => {
  await openApp(page, '#/overview');
  await expect(page.getByTestId('overview-export')).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20_000 }),
    page.getByTestId('overview-export').click(),
  ]);
  expect(download.suggestedFilename(), 'named as a spreadsheet').toMatch(/\.xlsx$/);

  const stream = await download.createReadStream();
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  const bytes = Buffer.concat(chunks);
  // A workbook is a zip: it must start "PK" and hold real content, not 0 bytes.
  expect(bytes.length, 'the file has content').toBeGreaterThan(1000);
  expect(bytes.subarray(0, 2).toString(), 'it is a real workbook, not an empty file').toBe('PK');
});

test('a photo added to a thing is really kept', async ({ page }) => {
  await openApp(page, '#/things');

  // A thing of our own to photograph.
  const name = `Photo thing ${Date.now()}`;
  page.once('dialog', (d) => d.accept(name));
  await page.getByTestId('thing-new').click();
  await expect(page).toHaveURL(/#\/thing\//);
  const url = page.url();

  await page.getByTestId('item-photo-input').setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: PNG });
  // The editor holds photos until Save, so an added one must appear first...
  await expect(page.locator('.item-editor img').first()).toBeVisible({ timeout: 15_000 });
  await page.locator('.item-editor [data-x="save"]').click();
  await expect(page).toHaveURL(/#\/things$/);

  // ...and then really be there: stored once in the photos store, referenced by id
  // from the item (the v98 split — an item must never carry the image inline).
  const kept = await page.evaluate(async (n) => {
    const db = await import('./js/db.js');
    const item = (await db.getCatalogItems()).find((i) => i.name === n);
    if (!item) return { found: false };
    const refs = item.photos || [];
    const map = await db.getPhotoMap(refs);
    return {
      found: true,
      refs: refs.length,
      byId: refs.every((r) => typeof r === 'string' && !r.startsWith('data:')),
      resolves: refs.every((r) => typeof (map[r] || map.get?.(r)) === 'string'),
    };
  }, name);
  expect(kept.found, 'the thing is still there').toBe(true);
  expect(kept.refs, 'with one photo').toBe(1);
  expect(kept.byId, 'stored by id, not inline on the item').toBe(true);
  expect(kept.resolves, 'and the image itself resolves').toBe(true);

  // It survives a restart, and shows on the thing again.
  await page.goto(url);
  await expect(page.locator('html[data-ready="1"]')).toBeAttached({ timeout: 20_000 });
  await expect(page.locator('.item-editor img').first()).toBeVisible({ timeout: 15_000 });
});
