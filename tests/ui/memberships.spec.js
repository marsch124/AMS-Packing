// Test 8: which lists a thing is on is controlled FROM THE THING — including
// unticking the list you opened it from, and unticking every one. (v176)
import { test, expect } from '@playwright/test';
import { openApp } from './_app.js';

test('a thing can be put on a list and taken off it, from the thing itself', async ({ page }) => {
  await openApp(page, '#/things');
  const name = `Thing ${Date.now()}`;
  page.once('dialog', (d) => d.accept(name));
  await page.getByTestId('thing-new').click();
  await expect(page).toHaveURL(/#\/thing\//);

  // v175 shipped with this block hidden for a thing on no list; v176 always shows it.
  const ticks = page.getByTestId('tmpl-check');
  await expect(ticks.first()).toBeVisible();
  await expect(page.getByTestId('thing-nolist-hint')).toBeVisible();
  await expect(page.locator('.item-editor input[name=tmpl]:checked')).toHaveCount(0);

  // Put it on the first template — the label is the control, the box is behind it.
  const first = ticks.first();
  const listName = (await first.textContent()).trim();
  await first.click();
  await expect(page.locator('.item-editor input[name=tmpl]:checked')).toHaveCount(1);
  await expect(page.getByTestId('thing-nolist-hint')).toBeHidden();
  await page.locator('.item-editor [data-x="save"]').click();
  await expect(page).toHaveURL(/#\/things$/);

  // Your things now says where it lives.
  const row = page.getByTestId('thing-row').filter({ hasText: name });
  await expect(row).toContainText(listName);
  await expect(row.locator('.thing-nolist')).toHaveCount(0);

  // Take it off again from the thing itself — the tick that is ON is the one it is on.
  await row.click();
  await expect(page.locator('.item-editor input[name=tmpl]:checked')).toHaveCount(1);
  await page.locator('.item-editor label.tmpl-check.on').first().click();
  await expect(page.locator('.item-editor input[name=tmpl]:checked')).toHaveCount(0);
  await expect(page.getByTestId('thing-nolist-hint')).toBeVisible();
  await page.locator('.item-editor [data-x="save"]').click();
  await expect(page).toHaveURL(/#\/things$/);
  await expect(page.getByTestId('thing-row').filter({ hasText: name }).locator('.thing-nolist')).toBeVisible();
});
