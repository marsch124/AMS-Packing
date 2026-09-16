// Test 5 of the suite: the trip review files a thing you wished you'd had into a template.
import { test, expect } from '@playwright/test';
import { openApp, createTrip } from './_app.js';

test('the review files a wished-for thing into one of the trip’s templates', async ({ page }) => {
  await openApp(page);
  await createTrip(page);
  await page.getByTestId('event-review').click();

  const wish = `Wished for ${Date.now()}`;
  await page.getByTestId('review-miss-input').fill(wish);
  await page.getByTestId('review-miss-add').click();
  const where = page.getByTestId('review-miss-where');
  await expect(where).toHaveCount(1);
  const listId = await where.inputValue();          // the template the review chose for it
  expect(listId).toBeTruthy();

  await page.getByTestId('review-save').click();
  await expect(page).toHaveURL(/#\/refine$/);

  // The thing is now on that template — found by the card's identifier + its own id.
  await page.getByTestId('tab-templates').click();
  await page.locator(`[data-testid="template-card"][href="#/list/${listId}"]`).click();
  await expect(page.getByTestId('item-row').filter({ hasText: wish })).toHaveCount(1);
});
