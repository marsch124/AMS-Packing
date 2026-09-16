// Test 7 of the suite: a thing can be created with NO list, and lives on its own.
// (v175 — the catalogue got its own home; before it, an item could only exist as a
// side-effect of saving a template.)
import { test, expect } from '@playwright/test';
import { openApp } from './_app.js';

test('a thing created with no list exists, is findable, and keeps its own fields', async ({ page }) => {
  await openApp(page, '#/things');
  const name = `Thing ${Date.now()}`;

  page.once('dialog', (d) => d.accept(name));       // "What is it?"
  await page.getByTestId('thing-new').click();

  // It lands in its own editor, with no template behind it.
  await expect(page).toHaveURL(/#\/thing\//);
  const editor = page.locator('.item-editor');
  await expect(editor.locator('.nolist-note')).toBeVisible();
  await expect(editor.locator('input[name=name]')).toHaveValue(name);

  // A field that belongs to the THING itself is editable and saves.
  await editor.locator('input[name=weight]').fill('123');
  await editor.locator('[data-x="save"]').click();
  await expect(page).toHaveURL(/#\/things$/);

  // It is listed, marked as on no list, and its own field survived.
  const row = page.getByTestId('thing-row').filter({ hasText: name });
  await expect(row).toHaveCount(1);
  await expect(row.locator('.thing-nolist')).toBeVisible();

  // The "on no list" filter finds it; a search finds it.
  await page.getByTestId('thing-filter-nolist').click();
  await expect(page.getByTestId('thing-row').filter({ hasText: name })).toHaveCount(1);
  await page.getByTestId('thing-filter-nolist').click();
  await page.getByTestId('thing-search').fill(name);
  await expect(page.getByTestId('thing-row')).toHaveCount(1);

  await page.getByTestId('thing-row').click();
  await expect(page.locator('.item-editor input[name=weight]')).toHaveValue('123');
});
