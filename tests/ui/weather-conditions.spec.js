// Tests 23–24: the forecast, and the conditions that decide what a trip packs.
//
// The weather test never touches the internet: both Open-Meteo calls are answered
// from a canned forecast inside the test. That is deliberate — what is worth
// guarding is how the app READS a forecast and what it then suggests, not whether
// a third party is up today. A test that depends on the network is a test that
// goes red for reasons that are nobody's fault.
import { test, expect } from '@playwright/test';
import { openApp } from './_app.js';

// A week that is unmistakably wet and cold, so the app's reading of it is obvious.
function cannedForecast(startISO) {
  const day = (n) => {
    const d = new Date(`${startISO}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const time = [0, 1, 2, 3].map(day);
  return {
    daily: {
      time,
      weathercode: [61, 63, 80, 61],          // rain, all week
      temperature_2m_max: [6, 5, 7, 4],
      temperature_2m_min: [1, 0, 2, -1],
      precipitation_probability_max: [90, 95, 85, 92],
      windspeed_10m_max: [35, 40, 30, 38],
    },
  };
}

test('a forecast is fetched, read and turned into suggestions', async ({ page }) => {
  // Answer both Open-Meteo endpoints ourselves.
  await page.route(/geocoding-api\.open-meteo\.com/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ results: [{ name: 'Bergen', country_code: 'NO', latitude: 60.39, longitude: 5.32 }] }),
  }));
  let forecastCalls = 0;
  await page.route(/api\.open-meteo\.com\/v1\/forecast/, (route) => {
    forecastCalls += 1;
    const start = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cannedForecast(start)) });
  });

  await openApp(page);

  // A trip soon, somewhere with a destination, built from a real template.
  const id = await page.evaluate(async () => {
    const db = await import('./js/db.js');
    const m = await import('./js/model.js');
    const src = (await db.getLists()).filter((l) => l.role !== 'container' && l.items.length > 3).slice(0, 1);
    const start = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const end = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10);
    const ev = m.newEvent({ name: `Wet trip ${Date.now()}`, startDate: start, endDate: end, nights: 3, destination: 'Bergen', activities: src.map((l) => l.id) });
    ev.entries = m.buildTotalEntries(ev, src);
    await db.saveEvent(ev);
    return ev.id;
  });

  await page.evaluate((e) => { window.location.hash = `#/event/${e}`; }, id);
  await expect(page.locator(`#app[data-route="#/event/${id}"]`)).toBeAttached();

  // Ask for the forecast through the real button.
  await page.getByTestId('wx-fetch').click();
  await expect(page.getByTestId('wx-strip')).toBeVisible({ timeout: 15_000 });
  expect(forecastCalls, 'the forecast was actually fetched').toBeGreaterThan(0);

  // Four days came back, and the app read them as wet.
  await expect(page.getByTestId('wx-day')).toHaveCount(4);
  await expect(page.locator('.wx-day.wet').first(), 'rain is shown as rain').toBeVisible();

  // It is kept on the trip, so it survives leaving the screen.
  const stored = await page.evaluate(async (e) => {
    const db = await import('./js/db.js');
    const ev = await db.getEvent(e);
    return { days: (ev.weather && ev.weather.daily || []).length, place: ev.weather && ev.weather.place };
  }, id);
  expect(stored.days, 'the forecast is stored on the trip').toBe(4);
  expect(stored.place).toMatch(/Bergen/);
});

test('a trip only packs what its season, transport and context call for', async ({ page }) => {
  await openApp(page);

  const res = await page.evaluate(async () => {
    const db = await import('./js/db.js');
    const m = await import('./js/model.js');
    const stamp = Date.now();
    const names = {
      always: `Always ${stamp}`, summer: `SummerOnly ${stamp}`, winter: `WinterOnly ${stamp}`,
      plane: `PlaneOnly ${stamp}`, outdoor: `OutdoorOnly ${stamp}`,
    };
    // One template, five things, each with a different condition on it.
    const tpl = m.newList({ name: `Cond ${stamp}`, group: 'WET' });
    tpl.items = [
      m.newItem({ name: names.always }),
      m.newItem({ name: names.summer, seasons: ['Summer'] }),
      m.newItem({ name: names.winter, seasons: ['Winter'] }),
      m.newItem({ name: names.plane, transports: ['Plane'] }),
      m.newItem({ name: names.outdoor, contexts: ['Outdoor'] }),
    ];
    await db.saveList(tpl);
    const saved = (await db.getLists()).find((l) => l.id === tpl.id);

    const built = (opts) => {
      const ev = m.newEvent({ name: 'x', activities: [saved.id], ...opts });
      return m.buildTotalEntries(ev, [saved]).map((e) => e.name);
    };
    return {
      names,
      summerCar: built({ season: 'Summer', transport: 'Car', contexts: ['Indoor'] }),
      winterPlane: built({ season: 'Winter', transport: 'Plane', contexts: ['Outdoor'] }),
      listId: saved.id,
    };
  });

  const { names, summerCar, winterPlane } = res;

  // A summer trip by car, indoors.
  expect(summerCar, 'unconditional things always come').toContain(names.always);
  expect(summerCar, 'summer gear comes in summer').toContain(names.summer);
  expect(summerCar, 'winter gear stays behind').not.toContain(names.winter);
  expect(summerCar, 'plane-only gear stays behind in the car').not.toContain(names.plane);
  expect(summerCar, 'outdoor gear stays behind indoors').not.toContain(names.outdoor);

  // The same template, a winter flight, outdoors — the opposite half comes.
  expect(winterPlane).toContain(names.always);
  expect(winterPlane).toContain(names.winter);
  expect(winterPlane).toContain(names.plane);
  expect(winterPlane).toContain(names.outdoor);
  expect(winterPlane, 'and summer gear now stays behind').not.toContain(names.summer);

  // The same rule, all the way through to what a real trip shows on screen.
  const id = await page.evaluate(async (listId) => {
    const db = await import('./js/db.js');
    const m = await import('./js/model.js');
    const saved = (await db.getLists()).find((l) => l.id === listId);
    const ev = m.newEvent({ name: `Winter flight ${Date.now()}`, season: 'Winter', transport: 'Plane', contexts: ['Outdoor'], activities: [listId] });
    ev.entries = m.buildTotalEntries(ev, [saved]);
    await db.saveEvent(ev);
    return ev.id;
  }, res.listId);

  await page.evaluate((e) => { window.location.hash = `#/event/${e}`; }, id);
  await expect(page.locator(`#app[data-route="#/event/${id}"]`)).toBeAttached();
  await expect(page.locator('.screen')).toContainText(names.winter);
  await expect(page.locator('.screen')).not.toContainText(names.summer);
});
