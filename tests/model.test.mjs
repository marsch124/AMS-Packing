import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newItem, newList, newEvent, coerceList, itemMatchesEvent, listsForEvent, buildTotalEntries, regenerateEntries,
  entriesByPhase, groupByContainer, groupByCategory, groupBy, progress, packSteps, totalListRows,
  applyReview, pruneSuggestions, effectiveQty, bagLoads, packingFlags,
  daysUntil, countdownLabel, tripNudge, sortEventsForList, nightsBetween, endFromNights,
  buildTripBundle, parseTripBundle, encodeTripLink, decodeTripLink,
  toBase64Url, fromBase64Url, TRIP_LINK_MAX,
  weatherCode, deriveWeather, weatherSuggestions, pendingWeatherItems, weatherGear, coerceEvent, WEATHER_THRESHOLDS,
  PHASE_IDS, CATEGORIES, CONTAINERS, GROUP_IDS,
  coerceItem, normalizeMaintenance, hasCare, maintenanceStatus, maintenanceList, maintenanceSummary,
  maintenanceByDate, logMaintenance, addDays, daysBetween, MAINTENANCE_SOON_DAYS, MAX_PHOTOS,
  coerceMembership, newMembership, resolveMembership, resolveTemplate, resolveTemplateItems, buildCatalog,
  applyIntrinsic, catalogItemFromResolved, membershipFromResolved,
  normalizeSections, newSection, sectionName, groupItemsBySection, groupBySection,
  containerNames, containerLimits, groupByStorage,
  catalogRows, dupeKey, duplicateGroups, duplicateIds,
  coerceGeo, eventCoords, eventsNeedingCoords, placesVisited, tripPath, mostVisited,
  backupCounts, backupShrinks, qtyNights, LAUNDRY_CAP_NIGHTS,
  presetConfigFromEvent, applyPresetConfig,
  newKit, coerceKit, kitEmoji, clusterByKit, KIT_DEFAULT_EMOJI,
  newAction, coerceAction, shoppingReason, shoppingSuggestions, openShoppingCount, EXPIRY_SOON_DAYS,
} from '../js/model.js';
import { seedLists } from '../js/seed.js';

test('itemMatchesEvent: empty constraints always apply', () => {
  const it = newItem({ name: 'Phone' });
  assert.equal(itemMatchesEvent(it, newEvent({ season: 'Winter', transport: 'Plane', catering: 'self' })), true);
});

test('itemMatchesEvent: season constraint filters', () => {
  const summer = newItem({ name: 'Sunscreen', seasons: ['Summer'] });
  assert.equal(itemMatchesEvent(summer, newEvent({ season: 'Summer' })), true);
  assert.equal(itemMatchesEvent(summer, newEvent({ season: 'Winter' })), false);
});

test('itemMatchesEvent: transport + catering constraints', () => {
  const rvOnly = newItem({ name: 'Camping stove', transports: ['RV'], catering: ['self', 'mixed'] });
  assert.equal(itemMatchesEvent(rvOnly, newEvent({ transport: 'RV', catering: 'self' })), true);
  assert.equal(itemMatchesEvent(rvOnly, newEvent({ transport: 'RV', catering: 'eatout' })), false);
  assert.equal(itemMatchesEvent(rvOnly, newEvent({ transport: 'Car', catering: 'self' })), false);
});

test('itemMatchesEvent: context applies to WET lists only', () => {
  const raceItem = newItem({ name: 'Race belt', contexts: ['Race'] });
  const wet = newList({ name: 'Run', group: 'WET' });
  const ga = newList({ name: 'Hiking', group: 'GA' });
  // On a WET list, the event context narrows as before.
  assert.equal(itemMatchesEvent(raceItem, newEvent({ contexts: ['Race'] }), wet), true);
  assert.equal(itemMatchesEvent(raceItem, newEvent({ contexts: ['Indoor'] }), wet), false);
  assert.equal(itemMatchesEvent(raceItem, newEvent({ contexts: [] }), wet), true); // no context pinned -> keep
  // On a non-WET list (or with no list), context is ignored -> the item always applies.
  assert.equal(itemMatchesEvent(raceItem, newEvent({ contexts: ['Indoor'] }), ga), true);
  assert.equal(itemMatchesEvent(raceItem, newEvent({ contexts: ['Indoor'] })), true);
});

test('buildTotalEntries: combines chosen lists and filters by event', () => {
  const hiking = newList({ name: 'Hiking', items: [
    newItem({ name: 'Boots', container: 'Hiking backpack', phase: 'week' }),
    newItem({ name: 'Sun hat', container: 'Hiking backpack', phase: 'week', seasons: ['Summer'] }),
  ] });
  const swim = newList({ name: 'Swim', items: [ newItem({ name: 'Goggles', container: 'Swim bag', phase: 'week' }) ] });
  const ev = newEvent({ season: 'Winter', activities: [hiking.id, swim.id] });
  const entries = buildTotalEntries(ev, [hiking, swim]);
  const names = entries.map((e) => e.name).sort();
  assert.deepEqual(names, ['Boots', 'Goggles']); // sun hat dropped (winter)
});

test('buildTotalEntries: de-duplicates by name+container across lists', () => {
  const a = newList({ name: 'A', items: [ newItem({ name: 'Toothbrush', container: 'Toiletry bag' }) ] });
  const b = newList({ name: 'B', items: [ newItem({ name: 'Toothbrush', container: 'Toiletry bag' }) ] });
  const ev = newEvent({ activities: [a.id, b.id] });
  assert.equal(buildTotalEntries(ev, [a, b]).length, 1);
});

test('buildTotalEntries: only includes chosen activities', () => {
  const a = newList({ name: 'A', items: [ newItem({ name: 'X' }) ] });
  const b = newList({ name: 'B', items: [ newItem({ name: 'Y' }) ] });
  const ev = newEvent({ activities: [a.id] });
  assert.deepEqual(buildTotalEntries(ev, [a, b]).map((e) => e.name), ['X']);
});

test('coerceList: keeps the loose role', () => {
  assert.equal(coerceList(newList({ name: 'Loose items', role: 'loose' })).role, 'loose');
  assert.equal(coerceList(newList({ name: 'X', role: 'bogus' })).role, ''); // unknown roles blanked
});

test('listsForEvent / buildTotalEntries: the loose bin is never fed to a trip', () => {
  const loose = newList({ name: 'Loose items', role: 'loose', items: [ newItem({ name: 'Sun hat' }) ] });
  const swim = newList({ name: 'Swim', items: [ newItem({ name: 'Goggles', container: 'Swim bag' }) ] });
  // Even if the loose list id is (wrongly) ticked as an activity, it contributes nothing.
  const ev = newEvent({ activities: [loose.id, swim.id] });
  assert.deepEqual(listsForEvent(ev, [loose, swim]).map((l) => l.name), ['Swim']);
  assert.deepEqual(buildTotalEntries(ev, [loose, swim]).map((e) => e.name), ['Goggles']);
});

test('regenerateEntries: keeps checked state and custom additions', () => {
  const list = newList({ name: 'Run', items: [ newItem({ name: 'Shoes' }), newItem({ name: 'Watch' }) ] });
  const ev = newEvent({ activities: [list.id] });
  ev.entries = buildTotalEntries(ev, [list]);
  // user ticks Shoes and adds a custom item
  ev.entries.find((e) => e.name === 'Shoes').checked = true;
  ev.entries.push(newItem({ name: 'Snacks', custom: true }));

  const again = regenerateEntries(ev, [list]);
  assert.equal(again.find((e) => e.name === 'Shoes').checked, true, 'checked state preserved');
  assert.ok(again.find((e) => e.name === 'Snacks' && e.custom), 'custom item preserved');
  assert.equal(again.filter((e) => e.name === 'Watch').length, 1, 'no duplicate for unchanged item');
});

test('regenerateEntries: adds newly matching items after a list grows', () => {
  const list = newList({ name: 'Run', items: [ newItem({ name: 'Shoes' }) ] });
  const ev = newEvent({ activities: [list.id] });
  ev.entries = buildTotalEntries(ev, [list]);
  list.items.push(newItem({ name: 'Cap' }));
  const again = regenerateEntries(ev, [list]);
  assert.deepEqual(again.map((e) => e.name).sort(), ['Cap', 'Shoes']);
});

test('entriesByPhase: only returns non-empty phases, in timeline order', () => {
  const entries = [ newItem({ name: 'A', phase: 'morning' }), newItem({ name: 'B', phase: 'prep' }) ];
  const groups = entriesByPhase(entries);
  assert.deepEqual(groups.map((g) => g.phase.id), ['prep', 'morning']);
});

test('groupByContainer: orders known containers first', () => {
  const entries = [ newItem({ name: 'A', container: 'Golf bag' }), newItem({ name: 'B', container: 'Toiletry bag' }) ];
  const groups = groupByContainer(entries);
  assert.equal(groups[0].container, 'Toiletry bag'); // Toiletry bag precedes Golf bag in CONTAINERS
});

test('packSteps: one step per non-empty phase, with packed/remaining counts', () => {
  const entries = [
    newItem({ name: 'A', phase: 'week', checked: true }),
    newItem({ name: 'B', phase: 'week', checked: false }),
    newItem({ name: 'C', phase: 'morning', checked: false }),
  ];
  const steps = packSteps(entries);
  assert.deepEqual(steps.map((s) => s.phase.id), ['week', 'morning']); // timeline order, empties skipped
  const week = steps.find((s) => s.phase.id === 'week');
  assert.equal(week.total, 2);
  assert.equal(week.done, 1);
  assert.equal(week.remaining, 1);
  const morning = steps.find((s) => s.phase.id === 'morning');
  assert.equal(morning.remaining, 1);
});

test('applyReview: folds used/unused flags into source-item stats', () => {
  const list = newList({ name: 'Run', items: [newItem({ name: 'Shoes' }), newItem({ name: 'Belt' })] });
  const ev = newEvent({ activities: [list.id] });
  ev.entries = buildTotalEntries(ev, [list]);
  ev.entries.find((e) => e.name === 'Shoes').used = true;
  ev.entries.find((e) => e.name === 'Belt').used = false;
  const changed = applyReview(ev, [list], '2026-07-27T00:00:00Z');
  assert.equal(changed.length, 1);
  const shoes = list.items.find((i) => i.name === 'Shoes');
  const belt = list.items.find((i) => i.name === 'Belt');
  assert.deepEqual([shoes.stats.packed, shoes.stats.used, shoes.stats.unused], [1, 1, 0]);
  assert.deepEqual([belt.stats.packed, belt.stats.used, belt.stats.unused], [1, 0, 1]);
});

test('applyReview: accumulates across trips', () => {
  const list = newList({ name: 'Golf', items: [newItem({ name: 'Umbrella' })] });
  const mkReview = (usedFlag) => {
    const ev = newEvent({ activities: [list.id] });
    ev.entries = buildTotalEntries(ev, [list]);
    ev.entries[0].used = usedFlag;
    applyReview(ev, [list]);
  };
  mkReview(false); mkReview(false); mkReview(false);
  const it = list.items[0];
  assert.equal(it.stats.packed, 3);
  assert.equal(it.stats.unused, 3);
  assert.equal(it.stats.used, 0);
});

test('pruneSuggestions: flags packed-but-never-used items, respects keep', () => {
  const list = newList({ name: 'Travel', items: [
    newItem({ name: 'Beach blanket', stats: { packed: 3, used: 0, unused: 3 } }),
    newItem({ name: 'Passport', stats: { packed: 3, used: 3, unused: 0 } }),
    newItem({ name: 'Umbrella', stats: { packed: 1, used: 0, unused: 1 } }),
  ] });
  const s = pruneSuggestions([list], { minTrips: 2 });
  assert.deepEqual(s.map((x) => x.item.name), ['Beach blanket']); // Passport used; Umbrella only 1 trip
  // keep flag suppresses the suggestion
  list.items[0].keep = true;
  assert.equal(pruneSuggestions([list], { minTrips: 2 }).length, 0);
});

test('effectiveQty: per-night scales with nights, else explicit qty or 1', () => {
  assert.equal(effectiveQty(newItem({ perNight: true }), 6), 6);
  assert.equal(effectiveQty(newItem({ perNight: true }), 0), 1); // no nights -> 1
  assert.equal(effectiveQty(newItem({ qty: '3' }), 6), 3);
  assert.equal(effectiveQty(newItem({}), 6), 1);
});

test('bagLoads: sums weight×qty per bag with limit warnings', () => {
  const entries = [
    newItem({ name: 'Socks', container: 'Carry-on / hand luggage', weight: 50, perNight: true }),
    newItem({ name: 'Laptop', container: 'Carry-on / hand luggage', weight: 1600 }),
    newItem({ name: 'Boots', container: 'Checked luggage', weight: 900 }),
  ];
  const loads = bagLoads(entries, 4); // socks ×4 = 200g + laptop 1600g = 1.8kg carry-on
  const carry = loads.find((b) => b.container === 'Carry-on / hand luggage');
  assert.equal(carry.kg, 1.8);
  assert.equal(carry.limitKg, 8);
  assert.equal(carry.over, false);
  // push carry-on over its 8 kg limit
  const heavy = bagLoads([newItem({ container: 'Carry-on / hand luggage', weight: 9000 })], 0);
  assert.equal(heavy[0].over, true);
});

test('bagLoads & packingFlags: ignore reminders; count flags and known weight', () => {
  const entries = [
    newItem({ name: 'Shampoo', container: 'Toiletry bag', weight: 200, liquid: true }),
    newItem({ name: 'Powerbank', container: 'Carry-on / hand luggage', weight: 350, restricted: true }),
    newItem({ name: 'Charge devices', itemType: 'reminder', container: 'Toiletry bag', weight: 999 }),
  ];
  const f = packingFlags(entries, 0);
  assert.equal(f.liquids, 1);
  assert.equal(f.restricted, 1);
  assert.equal(f.total, 2);        // reminder excluded
  assert.equal(f.weighed, 2);
  assert.equal(f.totalKg, 0.6);    // 200 + 350 = 550 -> 0.6 (rounded to 0.1)
  const loads = bagLoads(entries, 0);
  assert.ok(!loads.find((b) => b.grams >= 999), 'reminder weight not counted');
});

test('daysUntil / countdownLabel', () => {
  assert.equal(daysUntil('2026-08-10', '2026-08-03'), 7);
  assert.equal(daysUntil('2026-08-03', '2026-08-03'), 0);
  assert.equal(daysUntil('2026-08-01', '2026-08-03'), -2);
  assert.equal(daysUntil('', '2026-08-03'), null);
  assert.equal(countdownLabel(7), 'in 7 days');
  assert.equal(countdownLabel(0), 'Today');
  assert.equal(countdownLabel(1), 'Tomorrow');
  assert.equal(countdownLabel(-2), '2 days ago');
});

test('nightsBetween / endFromNights', () => {
  assert.equal(nightsBetween('2026-08-02', '2026-08-09'), 7);
  assert.equal(nightsBetween('2026-08-02', '2026-08-02'), 0);   // day trip
  assert.equal(nightsBetween('2026-08-09', '2026-08-02'), null); // end before start
  assert.equal(nightsBetween('', '2026-08-09'), null);
  assert.equal(nightsBetween('2026-08-02', ''), null);
  // Round-trips with endFromNights
  assert.equal(endFromNights('2026-08-02', 7), '2026-08-09');
  assert.equal(endFromNights('2026-08-02', 0), '2026-08-02');
  assert.equal(endFromNights('', 7), '');
  assert.equal(nightsBetween('2026-08-02', endFromNights('2026-08-02', 5)), 5);
});

test('tripNudge: focuses the earliest due phase with unpacked items', () => {
  const ev = newEvent({ startDate: '2026-08-10' });
  ev.entries = [
    newItem({ name: 'Boots', phase: 'week', checked: false }),
    newItem({ name: 'Passport', phase: 'morning', checked: false }),
  ];
  // 7 days out: only the "≥1 week ahead" phase is due (lead 7 >= 7); morning (lead 0) not yet.
  const n = tripNudge(ev, '2026-08-03');
  assert.equal(n.daysToGo, 7);
  assert.equal(n.focusPhaseId, 'week');
  assert.equal(n.dueCount, 1);
  // departure day: both phases due; earliest timeline (week) is the focus, count = 2.
  const n2 = tripNudge(ev, '2026-08-10');
  assert.equal(n2.focusPhaseId, 'week');
  assert.equal(n2.dueCount, 2);
});

test('tripNudge: null without a date; zero due when all packed', () => {
  assert.equal(tripNudge(newEvent({}), '2026-08-03'), null);
  const ev = newEvent({ startDate: '2026-08-04' });
  ev.entries = [newItem({ name: 'X', phase: 'week', checked: true })];
  assert.equal(tripNudge(ev, '2026-08-03').dueCount, 0);
});

test('progress: counts checked entries', () => {
  const entries = [ newItem({ checked: true }), newItem({ checked: false }), newItem({ checked: true }) ];
  assert.deepEqual(progress(entries), { done: 2, total: 3, pct: 67 });
});

test('totalListRows: flat rows carry phase, container, item', () => {
  const ev = newEvent();
  ev.entries = [ newItem({ name: 'Boots', container: 'Hiking backpack', phase: 'week' }) ];
  const rows = totalListRows(ev, null);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Item, 'Boots');
  assert.equal(rows[0].Container, 'Hiking backpack');
  assert.ok(rows[0].Phase.length);
});

test('groupByCategory: groups by category in CATEGORIES order', () => {
  const entries = [ newItem({ name: 'Boots', category: 'Footwear' }), newItem({ name: 'Shirt', category: 'Clothing' }) ];
  const groups = groupByCategory(entries);
  assert.equal(groups[0].category, 'Clothing'); // Clothing precedes Footwear in CATEGORIES
});

test('groupBy dispatcher: category / container / when all return labelled groups', () => {
  const entries = [ newItem({ name: 'X', category: 'Clothing', container: 'Golf bag', phase: 'morning' }) ];
  assert.equal(groupBy('category', entries)[0].label, 'Clothing');
  assert.equal(groupBy('container', entries)[0].label, 'Golf bag');
  assert.equal(groupBy('when', entries)[0].label, 'Morning list');
});

test('newItem: carries the new flags with safe defaults', () => {
  const r = newItem({ name: 'Headlamp', charging: true, itemType: 'reminder', shortList: true, swedish: 'Pannlampa', sub: ['a'] });
  assert.equal(r.charging, true);
  assert.equal(r.itemType, 'reminder');
  assert.equal(r.shortList, true);
  assert.equal(r.swedish, 'Pannlampa');
  assert.deepEqual(r.sub, ['a']);
  const d = newItem({ name: 'Plain' });
  assert.equal(d.charging, false);
  assert.equal(d.itemType, 'item');
});

test('seedLists: Martin\'s activity lists, all fields valid', () => {
  const lists = seedLists();
  const names = lists.map((l) => l.name);
  for (const n of ['Bike', 'Golf', 'Hiking', 'Run', 'Swim']) assert.ok(names.includes(n), `${n} present`);
  const cats = new Set(CATEGORIES);
  const cons = new Set(CONTAINERS);
  let total = 0;
  for (const l of lists) {
    assert.ok(l.builtin, `${l.name} is builtin`);
    for (const it of l.items) {
      total++;
      assert.ok(it.name, 'item has a name');
      assert.ok(PHASE_IDS.includes(it.phase), `phase ${it.phase} valid in ${l.name}`);
      assert.ok(cats.has(it.category), `category ${it.category} valid (${it.name})`);
      assert.ok(cons.has(it.container), `container ${it.container} valid (${it.name})`);
      assert.ok(it.itemType === 'item' || it.itemType === 'reminder');
    }
  }
  assert.ok(total > 100, `encoded a substantial number of items (${total})`);
});

test('newList / coerceList: group is a valid GROUP id or empty', () => {
  assert.equal(newList({ name: 'X', group: 'GA' }).group, 'GA');
  assert.equal(newList({ name: 'X' }).group, '');
  assert.equal(newList({ name: 'X', group: 'nonsense' }).group, '', 'invalid group falls back to ungrouped');
});

test('seedLists: every list has a valid group; activities cover GA and WET', () => {
  const lists = seedLists();
  const groups = new Set();
  for (const l of lists) {
    assert.ok(l.group === '' || GROUP_IDS.includes(l.group), `${l.name} group ${l.group} valid`);
    if (l.group) groups.add(l.group);
  }
  assert.ok(groups.has('GA'), 'has GA lists');
  assert.ok(groups.has('WET'), 'has WET lists');
  const byName = Object.fromEntries(lists.map((l) => [l.name, l.group]));
  assert.equal(byName.Golf, 'GA');
  assert.equal(byName.Hiking, 'GA');
  assert.equal(byName.Swim, 'WET');
  assert.equal(byName.Bike, 'WET');
  assert.equal(byName.Run, 'WET');
});

test('seedLists: scaffolded empty activities exist under the right groups', () => {
  const byName = Object.fromEntries(seedLists().map((l) => [l.name, l]));
  for (const n of ['Diving', 'Freediving']) { assert.ok(byName[n], `${n} exists`); assert.equal(byName[n].group, 'GA'); }
  assert.equal(byName.Freediving.items.length, 0);   // still an empty scaffold
  for (const n of ['Strength', 'Yoga / Mobility', 'Breath work']) { assert.ok(byName[n], `${n} exists`); assert.equal(byName[n].group, 'WET'); }
});

test('seedLists: the built-in Diving template ships pre-filled with sections', () => {
  const dive = seedLists().find((l) => l.name === 'Diving');
  assert.ok(dive.items.length > 20, `Diving is populated (${dive.items.length})`);
  assert.ok(dive.sections.length >= 4, `Diving has sections (${dive.sections.length})`);
  const secIds = new Set(dive.sections.map((s) => s.id));
  // Every item points at a real section, and every section is used.
  assert.ok(dive.items.every((it) => it.section && secIds.has(it.section)), 'every item has a valid section');
  const used = new Set(dive.items.map((it) => it.section));
  assert.ok(dive.sections.every((s) => used.has(s.id)), 'every section has items');
});

test('seedLists: EVERY template ships with a well-formed section list', () => {
  for (const l of seedLists()) {
    if (l.role === 'container') continue; // the Containers catalogue isn't a template
    assert.ok(Array.isArray(l.sections) && l.sections.length > 0, `${l.name} has sections`);
    assert.ok(l.sections.every((s) => s.id && s.name), `${l.name} sections are well-formed`);
    const ids = new Set(l.sections.map((s) => s.id));
    assert.equal(ids.size, l.sections.length, `${l.name} has unique section ids`);
    // Populated templates: every item lands in a real section (no orphan refs).
    for (const it of l.items) {
      assert.ok(it.section && ids.has(it.section), `${l.name} item "${it.name}" has a valid section`);
    }
  }
});

test('seedLists: Travel and RV bases are populated with valid items', () => {
  const byName = Object.fromEntries(seedLists().map((l) => [l.name, l]));
  assert.ok(byName.Travel.items.length > 80, `Travel base is substantial (${byName.Travel.items.length})`);
  assert.equal(byName.Travel.role, 'base', 'Travel is the always-on common base');
  assert.ok(byName['RV Granden (base)'], 'RV base exists');
  assert.equal(byName['RV Granden (base)'].role, 'transport', 'RV base is a transport list');
  assert.equal(byName['RV Granden (base)'].transport, 'RV', 'RV base is bound to the RV transport');
  const cats = new Set(CATEGORIES); const cons = new Set(CONTAINERS);
  for (const l of [byName.Travel, byName['RV Granden (base)']]) {
    for (const it of l.items) {
      assert.ok(it.name, 'named');
      assert.ok(PHASE_IDS.includes(it.phase));
      assert.ok(cats.has(it.category), `cat ${it.category} valid (${it.name})`);
      assert.ok(cons.has(it.container), `con ${it.container} valid (${it.name})`);
    }
  }
});

test('seedLists: has exactly one always-on base and a transport list per transport', () => {
  const lists = seedLists();
  const base = lists.filter((l) => l.role === 'base');
  assert.equal(base.length, 1, 'exactly one common base list');
  assert.equal(base[0].name, 'Travel');
  assert.ok(base[0].items.length > 0, 'the common base has items');
  const transports = lists.filter((l) => l.role === 'transport');
  assert.deepEqual(transports.map((l) => l.transport).sort(), ['Car', 'Plane', 'RV']);
  const rv = transports.find((l) => l.transport === 'RV');
  assert.ok(rv.items.length > 0, 'RV transport list carries the motorhome kit');
});

test('listsForEvent: always includes the base, adds only the matching transport list', () => {
  const lists = seedLists();
  const baseId = lists.find((l) => l.role === 'base').id;
  const rvId = lists.find((l) => l.role === 'transport' && l.transport === 'RV').id;
  const carId = lists.find((l) => l.role === 'transport' && l.transport === 'Car').id;

  const rvTrip = newEvent({ transport: 'RV', activities: [] });
  const ids = listsForEvent(rvTrip, lists).map((l) => l.id);
  assert.ok(ids.includes(baseId), 'common base always in');
  assert.ok(ids.includes(rvId), 'RV list in for an RV trip');
  assert.ok(!ids.includes(carId), 'other transport lists stay out');

  const carTrip = newEvent({ transport: 'Car', activities: [] });
  const carIds = listsForEvent(carTrip, lists).map((l) => l.id);
  assert.ok(carIds.includes(baseId) && carIds.includes(carId) && !carIds.includes(rvId));
});

test('buildTotalEntries: an RV trip with zero ticked activities still gets base + RV kit', () => {
  const lists = seedLists();
  const rv = lists.find((l) => l.role === 'transport' && l.transport === 'RV');
  const rvSample = rv.items.find((i) => i.name && !i.weather.length);
  const trip = newEvent({ transport: 'RV', activities: [], season: 'Summer' });
  const entries = buildTotalEntries(trip, lists);
  assert.ok(entries.length > 0, 'a no-activity RV trip is not empty');
  assert.ok(entries.some((e) => e.sourceListId === rv.id), 'RV items are present without ticking anything');
  assert.ok(entries.some((e) => e.name === rvSample.name), `RV item "${rvSample.name}" made it in`);
});

test('buildTotalEntries: switching transport away from RV drops the RV-only kit', () => {
  const lists = seedLists();
  const rv = lists.find((l) => l.role === 'transport' && l.transport === 'RV');
  const carTrip = newEvent({ transport: 'Car', activities: [], season: 'Summer' });
  const entries = buildTotalEntries(carTrip, lists);
  assert.ok(!entries.some((e) => e.sourceListId === rv.id), 'no RV list items on a Car trip');
});

test('quick mode: only the ticked activities feed the list — no base, no transport kit', () => {
  const lists = seedLists();
  const swim = lists.find((l) => l.name === 'Swim');
  const baseId = lists.find((l) => l.role === 'base').id;
  const transportIds = new Set(lists.filter((l) => l.role === 'transport').map((l) => l.id));

  const quick = newEvent({ mode: 'quick', transport: 'RV', activities: [swim.id], season: 'Summer' });
  const chosen = listsForEvent(quick, lists).map((l) => l.id);
  assert.deepEqual(chosen, [swim.id], 'quick list is exactly the ticked activity');
  assert.ok(!chosen.includes(baseId), 'no common base in quick mode');
  assert.ok(![...transportIds].some((id) => chosen.includes(id)), 'no transport kit in quick mode even if transport is set');

  const entries = buildTotalEntries(quick, lists);
  assert.ok(entries.length > 0 && entries.length < 40, `quick swim bag is small (${entries.length})`);
  assert.ok(entries.every((e) => e.sourceListId === swim.id), 'every quick item comes from the Swim list');
});

test('quick vs trip: the same ticked activity yields far fewer items in quick mode', () => {
  const lists = seedLists();
  const run = lists.find((l) => l.name === 'Run');
  const common = { transport: 'Car', activities: [run.id], season: 'Summer', contexts: ['Outdoor'] };
  const trip = buildTotalEntries(newEvent({ mode: 'trip', ...common }), lists);
  const quick = buildTotalEntries(newEvent({ mode: 'quick', ...common }), lists);
  assert.ok(quick.length < trip.length, `quick (${quick.length}) is smaller than full trip (${trip.length})`);
});

test('seedLists: Car and Plane transport lists are populated; Plane flags carry-on rules', () => {
  const lists = seedLists();
  const car = lists.find((l) => l.role === 'transport' && l.transport === 'Car');
  const plane = lists.find((l) => l.role === 'transport' && l.transport === 'Plane');
  assert.ok(car.items.length > 0, 'Car base has items');
  assert.ok(plane.items.length > 0, 'Plane base has items');
  assert.ok(plane.items.some((i) => i.liquid), 'Plane has a liquids item');
  assert.ok(plane.items.some((i) => i.restricted), 'Plane flags a restricted (carry-on-only) item');
});

test('seedLists: Run has an after phase, a reminder, a charging item and a short-list flag', () => {
  const run = seedLists().find((l) => l.name === 'Run');
  assert.ok(run.items.some((i) => i.phase === 'after'), 'has after phase');
  assert.ok(run.items.some((i) => i.itemType === 'reminder'), 'has a reminder');
  assert.ok(run.items.some((i) => i.charging), 'has a charging item');
  assert.ok(run.items.some((i) => i.shortList), 'has a short-list item');
});

// --- Trip sharing (manual, backend-free) ---

function sampleTripEvent() {
  const lists = seedLists();
  const ev = newEvent({ name: 'Vasa Diveweekend', activities: lists.map((l) => l.id), season: 'Summer', transport: 'Plane', nights: 3 });
  ev.entries = buildTotalEntries(ev, lists);
  // Simulate real trip state that must NOT leak to the receiver.
  ev.entries[0].checked = true;
  ev.entries[0].used = false;
  ev.status = 'done';
  ev.reviewedAt = '2026-07-01T00:00:00.000Z';
  return ev;
}

test('buildTripBundle: self-contained, event-only envelope', () => {
  const ev = sampleTripEvent();
  const b = buildTripBundle(ev);
  assert.equal(b.app, 'ams-packing-list');
  assert.equal(b.kind, 'trip');
  assert.equal(b.version, 1);
  assert.ok(b.exportedAt);
  assert.equal(b.event.name, 'Vasa Diveweekend');
  assert.ok(b.event.entries.length > 0);
});

test('parseTripBundle: round-trips entries but resets id, status and packed state', () => {
  const ev = sampleTripEvent();
  const json = JSON.stringify(buildTripBundle(ev));
  const got = parseTripBundle(json);
  assert.equal(got.name, ev.name);
  assert.equal(got.entries.length, ev.entries.length);
  assert.notEqual(got.id, ev.id, 'fresh id so import never clobbers an existing event');
  assert.equal(got.status, 'active');
  assert.equal(got.reviewedAt, '');
  assert.ok(got.entries.every((e) => e.checked === false), 'receiver starts unpacked');
});

test('parseTripBundle: accepts a parsed object as well as a JSON string', () => {
  const ev = sampleTripEvent();
  const got = parseTripBundle(buildTripBundle(ev));
  assert.equal(got.name, ev.name);
});

test('parseTripBundle: rejects non-trip payloads', () => {
  assert.throws(() => parseTripBundle('{"app":"ams-packing-list","kind":"backup"}'));
  assert.throws(() => parseTripBundle('not json at all'));
  assert.throws(() => parseTripBundle(JSON.stringify({ kind: 'trip' })));
});

test('base64url: round-trips unicode and stays URL-safe', () => {
  const s = 'Vandersteg järn — åäö & spår/plus+slash';
  const enc = toBase64Url(s);
  assert.equal(fromBase64Url(enc), s);
  assert.ok(!/[+/=]/.test(enc), 'no +, / or = in a URL-safe payload');
});

test('encodeTripLink / decodeTripLink: full round-trip through a deep link', () => {
  const lists = seedLists();
  const ev = newEvent({ name: 'Weekend run', nights: 1, activities: lists.map((l) => l.id) });
  ev.entries = buildTotalEntries(ev, lists).slice(0, 5);
  const frag = encodeTripLink(ev);
  assert.ok(frag.startsWith('#/t/'));
  const got = decodeTripLink(frag.slice('#/t/'.length));
  assert.equal(got.name, 'Weekend run');
  assert.equal(got.entries.length, 5);
});

test('encodeTripLink: returns null when the payload is too large for a link', () => {
  const lists = seedLists();
  const ev = newEvent({ name: 'Everything', activities: lists.map((l) => l.id) });
  const all = buildTotalEntries(ev, lists);
  // Repeat the materialised entries until even the slimmed link would overflow.
  ev.entries = [];
  while (encodeTripLink(ev) !== null) ev.entries.push(...all);
  assert.equal(encodeTripLink(ev), null);
  assert.ok(ev.entries.length > 30, 'a normal-sized trip still fits; only very large ones fall back to a file');
});

// --- Weather (Open-Meteo interpretation) ---

const wEvent = (daily, extra = {}) => newEvent({ season: 'Summer', weather: { place: 'Chamonix, FR', lat: 45.9, lon: 6.9, fetchedAt: '2026-08-01T00:00:00Z', daily }, ...extra });

test('weatherCode: maps WMO codes to icon key + wet flag', () => {
  assert.equal(weatherCode(0).icon, 'sun');
  assert.equal(weatherCode(0).wet, false);
  assert.equal(weatherCode(3).icon, 'cloud');
  assert.equal(weatherCode(63).icon, 'rain');
  assert.equal(weatherCode(63).wet, true);
  assert.equal(weatherCode(73).icon, 'snow');
  assert.equal(weatherCode(95).icon, 'storm');
});

test('deriveWeather: builds per-day rows and a temperature range', () => {
  const d = deriveWeather(wEvent([
    { date: '2026-08-03', code: 0, tmax: 19, tmin: 9, precipProb: 5, wind: 8 },
    { date: '2026-08-04', code: 61, tmax: 11, tmin: 7, precipProb: 80, wind: 20 },
  ]));
  assert.equal(d.days.length, 2);
  assert.equal(d.days[0].icon, 'sun');
  assert.equal(d.days[1].rainy, true);
  assert.equal(d.tempMax, 19);
  assert.equal(d.tempMin, 7);
  assert.equal(d.rangeLabel, '7–19°C');
  assert.ok(d.days[0].dow && d.days[1].dow, 'weekday labels present');
});

test('deriveWeather: derives rain + cold conditions from the forecast', () => {
  const d = deriveWeather(wEvent([
    { date: '2026-08-03', code: 80, tmax: 12, tmin: 3, precipProb: 70, wind: 15 },
  ]));
  assert.ok(d.conditions.includes('rain'));
  assert.ok(d.conditions.includes('cold'), 'tmin 3°C <= coldMinC');
});

test('deriveWeather: flags a summer trip that is cooler than expected', () => {
  const d = deriveWeather(wEvent([
    { date: '2026-08-03', code: 3, tmax: 12, tmin: 9, precipProb: 10, wind: 10 },
  ]));
  assert.ok(d.coolerThanSeason, 'max 12°C < coolMaxSummerC while season is Summer');
  assert.ok(d.conditions.includes('cold'));
});

test('deriveWeather: hot + windy conditions', () => {
  const d = deriveWeather(wEvent([
    { date: '2026-08-03', code: 0, tmax: 31, tmin: 20, precipProb: 0, wind: 42 },
  ]));
  assert.ok(d.conditions.includes('hot'));
  assert.ok(d.conditions.includes('wind'));
  assert.ok(!d.conditions.includes('rain'));
});

test('deriveWeather: returns null when there is no forecast', () => {
  assert.equal(deriveWeather(newEvent({})), null);
});

test('weatherSuggestions: suggests condition-matched items, skipping ones already packed', () => {
  const ev = wEvent([{ date: '2026-08-03', code: 61, tmax: 11, tmin: 4, precipProb: 80, wind: 12 }]);
  ev.entries = [newItem({ name: 'Rain jacket' })];   // already have this one
  const s = weatherSuggestions(ev);
  const names = s.items.map((i) => i.name);
  assert.ok(names.includes('Waterproof / pack cover'), 'rain add-on offered');
  assert.ok(names.includes('Long tights'), 'cold add-on offered');
  assert.ok(!names.includes('Rain jacket'), 'already-packed item is not re-suggested');
  assert.ok(s.items.every((i) => i.reason), 'each suggestion carries the driving condition');
  assert.ok(s.summary.length > 0);
});

test('weatherSuggestions: no forecast -> nothing suggested', () => {
  assert.deepEqual(weatherSuggestions(newEvent({})), { conditions: [], items: [], summary: '' });
});

test('coerceEvent: normalises destination + weather, drops a malformed snapshot', () => {
  const ok = coerceEvent({ destination: 'Nice', weather: { place: 'Nice, FR', daily: [{ date: '2026-08-03', code: '0', tmax: '20', tmin: '12', precipProb: '5', wind: '9' }] } });
  assert.equal(ok.destination, 'Nice');
  assert.equal(ok.weather.daily[0].code, 0);
  assert.equal(ok.weather.daily[0].tmax, 20);
  const bad = coerceEvent({ weather: { nope: true } });
  assert.equal(bad.weather, null);
  assert.equal(bad.destination, '');
});

// --- Weather-condition item flag (conditional gear) ---

test('coerceItem: keeps only known weather conditions', () => {
  const it = newItem({ name: 'Rain suit', weather: ['rain', 'sunshine', 'cold'] });
  assert.deepEqual(it.weather, ['rain', 'cold']);
});

test('buildTotalEntries: weather-tagged items stay OUT of the base list', () => {
  const list = newList({ name: 'Hiking', items: [
    newItem({ name: 'Boots' }),
    newItem({ name: 'Rain suit', weather: ['rain'] }),
  ] });
  const ev = newEvent({ activities: [list.id] });
  const names = buildTotalEntries(ev, [list]).map((e) => e.name);
  assert.deepEqual(names, ['Boots'], 'rain suit is conditional, not in the base list');
});

test('weatherSuggestions: pulls your own tagged gear from the chosen lists', () => {
  const list = newList({ name: 'Hiking', items: [
    newItem({ name: 'Rain suit', category: 'Adventure clothing', container: 'Hiking backpack', weather: ['rain'] }),
    newItem({ name: 'Sun umbrella', weather: ['hot'] }),  // not forecast -> not suggested
  ] });
  const ev = wEvent([{ date: '2026-08-03', code: 61, tmax: 16, tmin: 8, precipProb: 80, wind: 12 }]);
  ev.activities = [list.id];
  const s = weatherSuggestions(ev, [list]);
  const own = s.items.find((i) => i.name === 'Rain suit');
  assert.ok(own, 'your own rain suit is suggested');
  assert.equal(own.own, true);
  assert.equal(own.sourceItemId, list.items[0].id, 'keeps the source link for trip-review stats');
  assert.equal(own.container, 'Hiking backpack', 'carries its container');
  assert.ok(!s.items.some((i) => i.name === 'Sun umbrella'), 'hot-only item not suggested when it is not hot');
});

test('weatherSuggestions: your own item is preferred and de-duped against the curated add-on', () => {
  const list = newList({ name: 'Run', items: [newItem({ name: 'Rain jacket', weather: ['rain'] })] });
  const ev = wEvent([{ date: '2026-08-03', code: 61, tmax: 16, tmin: 9, precipProb: 80, wind: 12 }]);
  ev.activities = [list.id];
  const s = weatherSuggestions(ev, [list]);
  const jackets = s.items.filter((i) => i.name === 'Rain jacket');
  assert.equal(jackets.length, 1, 'not duplicated by the curated map');
  assert.equal(jackets[0].own, true, 'the users own item wins');
});

test('pendingWeatherItems: counts conditional gear waiting on a forecast, ignoring packed ones', () => {
  const list = newList({ name: 'Hiking', items: [
    newItem({ name: 'Rain suit', weather: ['rain'] }),
    newItem({ name: 'Rain cover', weather: ['rain'] }),
    newItem({ name: 'Down jacket', weather: ['cold'], seasons: ['Winter'] }),
    newItem({ name: 'Boots' }),  // not weather-tagged
  ] });
  const summer = newEvent({ season: 'Summer', activities: [list.id] });
  // Down jacket is Winter-only, so it doesn't count for a Summer trip.
  assert.equal(pendingWeatherItems(summer, [list]), 2);
  // Already having one packed drops the count.
  summer.entries = [newItem({ name: 'Rain suit' })];
  assert.equal(pendingWeatherItems(summer, [list]), 1);
});

test('weatherGear: returns all applicable weather items regardless of forecast, with source links', () => {
  const list = newList({ name: 'Hiking', items: [
    newItem({ name: 'Rain suit', container: 'Hiking backpack', weather: ['rain'] }),
    newItem({ name: 'Down jacket', weather: ['cold'], seasons: ['Winter'] }),  // not this season
    newItem({ name: 'Boots' }),  // not tagged
  ] });
  const ev = newEvent({ season: 'Summer', activities: [list.id] });
  const gear = weatherGear(ev, [list]);   // no forecast at all
  assert.deepEqual(gear.map((g) => g.name), ['Rain suit']);
  assert.equal(gear[0].container, 'Hiking backpack');
  assert.equal(gear[0].sourceItemId, list.items[0].id);
  assert.deepEqual(gear[0].conditions, ['rain']);
  // once packed, it drops out
  ev.entries = [newItem({ name: 'Rain suit' })];
  assert.equal(weatherGear(ev, [list]).length, 0);
});

test('sortEventsForList orders nearest-upcoming first, then undated, then past', () => {
  const today = '2026-07-29T00:00:00Z';
  const ev = (id, startDate, createdAt) => ({ id, startDate, createdAt: createdAt || '2026-01-01T00:00:00Z' });
  const soon = ev('soon', '2026-08-02');       // +4 days
  const later = ev('later', '2026-12-25');      // far future
  const past = ev('past', '2026-07-10');        // -19 days
  const older = ev('older', '2026-01-05');      // more past
  const draftA = ev('draftA', '', '2026-06-01T00:00:00Z');
  const draftB = ev('draftB', '', '2026-07-20T00:00:00Z'); // newer draft
  const out = sortEventsForList([older, draftA, later, past, soon, draftB], today).map((e) => e.id);
  assert.deepEqual(out, ['soon', 'later', 'draftB', 'draftA', 'past', 'older']);
});

// ---------------------------------------------------------------- Care & maintenance

test('addDays / daysBetween: UTC date arithmetic', () => {
  assert.equal(addDays('2026-01-01', 365), '2027-01-01');
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(daysBetween('2026-07-01', '2026-07-21'), 20);
  assert.equal(daysBetween('2026-07-21', '2026-07-01'), -20);
  assert.equal(daysBetween('nope', '2026-07-01'), null);
});

test('normalizeMaintenance: empty record collapses to null', () => {
  assert.equal(normalizeMaintenance(null), null);
  assert.equal(normalizeMaintenance({ notes: '', link: '', intervalDays: 0, lastDone: '', log: [] }), null);
});

test('normalizeMaintenance: keeps real content and cleans bad values', () => {
  const m = normalizeMaintenance({
    notes: 'Rinse in fresh water', link: 'https://x', intervalDays: 90.7,
    lastDone: 'bad-date', log: [{ date: '2026-01-01', note: 'ok' }, { date: 'bad' }],
  });
  assert.equal(m.notes, 'Rinse in fresh water');
  assert.equal(m.intervalDays, 90);           // floored
  assert.equal(m.lastDone, '');               // bad date dropped
  assert.equal(m.log.length, 1);              // invalid log entry filtered out
});

test('coerceItem: backfills care fields on legacy items and normalizes maintenance', () => {
  const it = coerceItem({ name: 'Old item' });
  assert.equal(it.storage, '');
  assert.deepEqual(it.photos, []);
  assert.equal(it.photo, undefined); // legacy single field folded away
  assert.equal(it.maintenance, null);
  // A legacy single `photo` string migrates into the photos array.
  const legacy = coerceItem({ name: 'Wetsuit', photo: 'data:image/jpeg;base64,AAA' });
  assert.deepEqual(legacy.photos, ['data:image/jpeg;base64,AAA']);
  assert.equal(legacy.photo, undefined);
  const withCare = coerceItem({ name: 'Wetsuit', maintenance: { intervalDays: 365 } });
  assert.equal(withCare.maintenance.intervalDays, 365);
});

test('coerceItem: photos array is filtered and capped at MAX_PHOTOS', () => {
  const dirty = coerceItem({ name: 'Bike', photos: ['a', '', null, 'b', 42] });
  assert.deepEqual(dirty.photos, ['a', 'b']); // non-string / empty entries dropped
  const many = coerceItem({ name: 'Drone', photos: Array.from({ length: MAX_PHOTOS + 3 }, (_, i) => `p${i}`) });
  assert.equal(many.photos.length, MAX_PHOTOS);
  // An explicit photos array wins over a legacy single photo.
  const both = coerceItem({ name: 'Tent', photo: 'legacy', photos: ['new'] });
  assert.deepEqual(both.photos, ['new']);
});

test('hasCare: only true when the record holds something', () => {
  assert.equal(hasCare(newItem({ name: 'Socks' })), false);
  assert.equal(hasCare(newItem({ name: 'Bike', maintenance: { link: 'https://x' } })), true);
  assert.equal(hasCare(newItem({ name: 'Tent', maintenance: { intervalDays: 365 } })), true);
});

test('maintenanceStatus: overdue / soon / ok by next-due date', () => {
  const today = '2026-07-30T00:00:00Z';
  const mk = (lastDone, intervalDays) => newItem({ name: 'x', maintenance: { intervalDays, lastDone } });
  assert.equal(maintenanceStatus(mk('2026-01-01', 90), today).state, 'overdue'); // due 2026-04-01
  assert.equal(maintenanceStatus(mk('2026-07-20', 30), today).state, 'soon');    // due 2026-08-19 (20 days)
  assert.equal(maintenanceStatus(mk('2026-07-01', 365), today).state, 'ok');     // due next year
  assert.equal(maintenanceStatus(newItem({ name: 'x' }), today), null);          // no record
});

test('maintenanceStatus: reference-only (no interval) and never-done', () => {
  const today = '2026-07-30T00:00:00Z';
  const ref = maintenanceStatus(newItem({ name: 'x', maintenance: { notes: 'hand wash' } }), today);
  assert.equal(ref.state, 'reference');
  assert.equal(ref.scheduled, false);
  const never = maintenanceStatus(newItem({ name: 'x', maintenance: { intervalDays: 30 } }), today);
  assert.equal(never.neverDone, true);
  assert.equal(never.nextDue, '2026-07-30'); // due today when never logged
});

test('maintenanceList: orders overdue → soon → ok → reference', () => {
  const today = '2026-07-30T00:00:00Z';
  const list = newList({ name: 'Gear', items: [
    newItem({ name: 'OK', maintenance: { intervalDays: 365, lastDone: '2026-07-01' } }),
    newItem({ name: 'Reference', maintenance: { notes: 'wipe down' } }),
    newItem({ name: 'Overdue', maintenance: { intervalDays: 90, lastDone: '2026-01-01' } }),
    newItem({ name: 'Soon', maintenance: { intervalDays: 30, lastDone: '2026-07-20' } }),
    newItem({ name: 'Plain socks' }), // no care → excluded
  ] });
  const names = maintenanceList([list], today).map((r) => r.item.name);
  assert.deepEqual(names, ['Overdue', 'Soon', 'OK', 'Reference']);
});

test('maintenanceSummary: counts due (overdue + soon)', () => {
  const today = '2026-07-30T00:00:00Z';
  const list = newList({ items: [
    newItem({ maintenance: { intervalDays: 90, lastDone: '2026-01-01' } }), // overdue
    newItem({ maintenance: { intervalDays: 30, lastDone: '2026-07-20' } }), // soon
    newItem({ maintenance: { notes: 'x' } }),                                // reference
  ] });
  const s = maintenanceSummary([list], today);
  assert.equal(s.overdue, 1);
  assert.equal(s.soon, 1);
  assert.equal(s.due, 2);
  assert.equal(s.reference, 1);
  assert.equal(s.total, 3);
});

test('maintenanceByDate: buckets scheduled items on their next-due date', () => {
  const today = '2026-07-30T00:00:00Z';
  const list = newList({ items: [
    newItem({ name: 'A', maintenance: { intervalDays: 30, lastDone: '2026-07-20' } }), // due 2026-08-19
    newItem({ name: 'Ref', maintenance: { notes: 'x' } }),                              // no date → excluded
  ] });
  const map = maintenanceByDate([list], today);
  assert.equal(map.get('2026-08-19').length, 1);
  assert.equal([...map.keys()].length, 1);
});

test('logMaintenance: records a service, resets the schedule, appends history', () => {
  const it = newItem({ name: 'Bike', maintenance: { intervalDays: 90, lastDone: '2026-01-01' } });
  logMaintenance(it, '2026-07-30', 'chain + drivetrain');
  assert.equal(it.maintenance.lastDone, '2026-07-30');
  assert.equal(it.maintenance.log.length, 1);
  assert.equal(it.maintenance.log[0].note, 'chain + drivetrain');
  // status now computes from the new lastDone (ok, due ~3 months out)
  assert.equal(maintenanceStatus(it, '2026-07-31T00:00:00Z').state, 'ok');
  // works on an item with no prior record
  const fresh = newItem({ name: 'Jacket' });
  logMaintenance(fresh, '2026-07-30');
  assert.equal(fresh.maintenance.lastDone, '2026-07-30');
});

test('buildTotalEntries: carries the item storage location onto trip entries', () => {
  const list = newList({ name: 'Gear', items: [newItem({ name: 'Wetsuit', container: 'Duffel bag', storage: 'Garage shelf 3' })] });
  const ev = newEvent({ activities: [list.id] });
  const [entry] = buildTotalEntries(ev, [list]);
  assert.equal(entry.storage, 'Garage shelf 3');
});

// ============================================================================
// RELATIONAL CORE ("Endeavour 2") — Item catalog + Memberships
// ============================================================================

test('coerceMembership: normalizes conditions and keeps override sentinels', () => {
  const m = coerceMembership({ id: 'm1', itemId: 'i1', templateId: 't1', seasons: 'Summer', phase: 'bogus', itemType: 'nope', container: 42 });
  assert.deepEqual(m.seasons, []);          // non-array coerced to []
  assert.equal(m.phase, '');                // invalid phase -> '' (use item default)
  assert.equal(m.itemType, '');             // invalid itemType -> '' (use item default)
  assert.equal(m.container, '');            // non-string -> '' (use item default)
});

test('resolveMembership: overrides win, blanks fall back to the item default', () => {
  const item = newItem({ name: 'Socks', category: 'Clothing', container: 'Duffel bag', phase: 'week', swedish: 'Strumpor' });
  const plain = resolveMembership(item, newMembership({ itemId: item.id, templateId: 't1' }));
  assert.equal(plain.container, 'Duffel bag');   // no override -> item default
  assert.equal(plain.phase, 'week');
  const overridden = resolveMembership(item, newMembership({ itemId: item.id, templateId: 't2', container: 'Checked luggage', seasons: ['Summer'] }));
  assert.equal(overridden.container, 'Checked luggage'); // override wins
  assert.equal(overridden.category, 'Clothing');          // intrinsic still from item
  assert.equal(overridden.swedish, 'Strumpor');
  assert.deepEqual(overridden.seasons, ['Summer']);       // condition comes from the membership
});

test('buildCatalog: counts match the analysis (unique items, one membership per copy)', () => {
  const lists = seedLists();
  const totalCopies = lists.reduce((n, l) => n + l.items.filter((it) => String(it.name || '').trim()).length, 0);
  const uniqueNames = new Set(lists.flatMap((l) => l.items.map((it) => it.name.trim().toLowerCase().replace(/\s+/g, ' ')).filter(Boolean))).size;
  const { items, memberships, templates } = buildCatalog(lists);
  assert.equal(items.length, uniqueNames);        // same-named copies merged into one catalog item
  assert.equal(memberships.length, totalCopies);  // one membership per original copy
  assert.equal(templates.length, lists.length);
  assert.ok(templates.every((t) => t.items.length === 0)); // templates no longer hold inline items
});

test('buildCatalog: resolving a template reproduces each copy\'s container / phase / conditions', () => {
  const lists = seedLists();
  const { items, memberships, templates } = buildCatalog(lists);
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const orig of lists) {
    const tmpl = templates.find((t) => t.id === orig.id);
    const resolved = resolveTemplateItems(tmpl, byId, memberships);
    // match resolved items back to originals by (name, container) — contextual fidelity
    for (const o of orig.items) {
      if (!String(o.name || '').trim()) continue;
      const r = resolved.find((x) => x.name.toLowerCase() === o.name.toLowerCase() && x.container === o.container && x.phase === o.phase);
      assert.ok(r, `no resolved match for "${o.name}" (${o.container}/${o.phase}) in ${orig.name}`);
      assert.deepEqual(r.seasons, o.seasons);
      assert.deepEqual(r.contexts, o.contexts);
      assert.deepEqual(r.transports, o.transports);
      assert.deepEqual(r.weather, o.weather);
    }
  }
});

test('buildCatalog: a trip built from resolved templates matches one built from the originals', () => {
  const lists = seedLists();
  const { items, memberships, templates } = buildCatalog(lists);
  const byId = new Map(items.map((i) => [i.id, i]));
  const resolvedLists = templates.map((t) => resolveTemplate(t, byId, memberships));
  const golf = lists.find((l) => l.name === 'Golf');
  const ev = newEvent({ activities: [golf.id], season: 'Summer', transport: 'Plane', mode: 'trip' });
  const key = (e) => `${e.name.toLowerCase()}|${e.container}|${e.phase}`;
  const before = new Set(buildTotalEntries(ev, lists).map(key));
  const after = new Set(buildTotalEntries(ev, resolvedLists).map(key));
  assert.deepEqual([...after].sort(), [...before].sort());
});

test('buildCatalog: per-template container override (Socks default vs Travel/RV)', () => {
  const lists = seedLists();
  const { items, memberships } = buildCatalog(lists);
  const socks = items.find((i) => i.name.toLowerCase() === 'socks');
  assert.ok(socks);
  const socksMems = memberships.filter((m) => m.itemId === socks.id);
  assert.ok(socksMems.length >= 3);                       // Socks lives in several templates
  assert.ok(socksMems.some((m) => m.container === '' ));  // at least one uses the default
  assert.ok(socksMems.some((m) => m.container && m.container !== socks.container)); // at least one overrides
});

test('buildCatalog: itemType override preserves the Bike "after" reminders', () => {
  const lists = seedLists();
  const { items, memberships, templates } = buildCatalog(lists);
  const byId = new Map(items.map((i) => [i.id, i]));
  const bike = templates.find((t) => t.name === 'Bike');
  const swim = templates.find((t) => t.name === 'Swim');
  const bikeItems = resolveTemplateItems(bike, byId, memberships);
  const swimItems = resolveTemplateItems(swim, byId, memberships);
  const bikeTowel = bikeItems.find((x) => x.name === 'Towel');
  const swimTowel = swimItems.find((x) => x.name === 'Towel');
  assert.equal(bikeTowel.itemType, 'reminder'); // Bike keeps its after-list reminder behavior
  assert.equal(swimTowel.itemType, 'item');     // same catalog item, shown as a packable item in Swim
});

test('membershipFromResolved: stores overrides only where the item differs from its default', () => {
  const cat = newItem({ name: 'Socks', container: 'Duffel bag', phase: 'week', itemType: 'item' });
  const resolved = resolveMembership(cat, newMembership({ itemId: cat.id, templateId: 't1' }));
  resolved.container = 'Checked luggage';   // user changes the bag in this template
  resolved.seasons = ['Summer'];            // and adds a condition
  const m = membershipFromResolved(cat, 't1', resolved, 3);
  assert.equal(m.container, 'Checked luggage'); // differs from default -> stored as override
  assert.equal(m.phase, '');                    // equals default -> no override
  assert.deepEqual(m.seasons, ['Summer']);
  assert.equal(m.order, 3);
  // round-trips back to the same resolved values
  const back = resolveMembership(cat, m);
  assert.equal(back.container, 'Checked luggage');
  assert.equal(back.phase, 'week');
  assert.deepEqual(back.seasons, ['Summer']);
});

test('applyIntrinsic: shared-item edits propagate; container/phase defaults are left alone', () => {
  const cat = newItem({ name: 'Jacket', category: 'Clothing', container: 'Duffel bag', phase: 'week', weight: 0 });
  const edited = resolveMembership(cat, newMembership({ itemId: cat.id, templateId: 't1', container: 'Checked luggage' }));
  edited.category = 'Adventure clothing'; // intrinsic edit
  edited.weight = 620;                     // intrinsic edit
  applyIntrinsic(cat, edited);
  assert.equal(cat.category, 'Adventure clothing'); // propagates to the shared item
  assert.equal(cat.weight, 620);
  assert.equal(cat.container, 'Duffel bag');         // the DEFAULT is untouched by an override edit
  assert.equal(cat.phase, 'week');
});

test('catalogItemFromResolved: a new item takes its own container/phase as defaults', () => {
  const it = newItem({ name: 'New gadget', category: 'Electronics', container: 'Tech pouch', phase: 'daybefore' });
  const cat = catalogItemFromResolved(it);
  assert.equal(cat.container, 'Tech pouch');
  assert.equal(cat.phase, 'daybefore');
  assert.equal(cat.category, 'Electronics');
});

test('resolveTemplateItems: respects membership order', () => {
  const a = newItem({ name: 'A' }); const b = newItem({ name: 'B' }); const c = newItem({ name: 'C' });
  const tmpl = newList({ name: 'T' });
  const mems = [
    newMembership({ itemId: c.id, templateId: tmpl.id, order: 0 }),
    newMembership({ itemId: a.id, templateId: tmpl.id, order: 1 }),
    newMembership({ itemId: b.id, templateId: tmpl.id, order: 2 }),
  ];
  const items = resolveTemplateItems(tmpl, [a, b, c], mems);
  assert.deepEqual(items.map((x) => x.name), ['C', 'A', 'B']);
});

test('coerceItem: defaults and validates the new metadata fields', () => {
  const empty = coerceItem({ name: 'Thing' });
  for (const f of ['color', 'size', 'manufacturer', 'model', 'owner', 'acquired', 'currency', 'purchaseLink', 'expiry', 'condition', 'serial']) {
    assert.equal(empty[f], '', `${f} should default to ''`);
  }
  assert.equal(empty.price, 0);
  assert.equal(empty.qtyOwned, 0);
  // Invalid values are rejected; valid ones kept.
  const bad = coerceItem({ name: 'X', condition: 'sparkly', acquired: 'not-a-date', price: -5, qtyOwned: -2 });
  assert.equal(bad.condition, '');       // unknown condition id dropped
  assert.equal(bad.acquired, '');        // non-YMD date dropped
  assert.equal(bad.price, 0);            // negative price clamped
  assert.equal(bad.qtyOwned, 0);         // negative qty clamped
  const good = coerceItem({ name: 'X', condition: 'worn', acquired: '2026-01-15', price: 19.9, qtyOwned: 3 });
  assert.equal(good.condition, 'worn');
  assert.equal(good.acquired, '2026-01-15');
  assert.equal(good.price, 19.9);
  assert.equal(good.qtyOwned, 3);
  // Lifecycle ("Not in use"): boolean defaults false; reason validated & only kept when valid.
  assert.equal(empty.retired, false);
  assert.equal(empty.retiredReason, '');
  const retiredBad = coerceItem({ name: 'X', retired: 1, retiredReason: 'exploded' });
  assert.equal(retiredBad.retired, true);       // any truthy -> true
  assert.equal(retiredBad.retiredReason, '');   // unknown reason id dropped
  const retiredGood = coerceItem({ name: 'X', retired: true, retiredReason: 'sold' });
  assert.equal(retiredGood.retired, true);
  assert.equal(retiredGood.retiredReason, 'sold');
});

test('buildTotalEntries: excludes items marked "Not in use" (retired)', () => {
  const kit = newList({ name: 'Kit', items: [
    newItem({ name: 'Tent', container: 'Backpack' }),
    newItem({ name: 'Old stove', container: 'Backpack', retired: true, retiredReason: 'broken' }),
  ] });
  const ev = newEvent({ activities: [kit.id] });
  const names = buildTotalEntries(ev, [kit]).map((e) => e.name);
  assert.deepEqual(names, ['Tent']); // the retired stove never joins the trip
});

test('applyIntrinsic: metadata edits propagate to the shared catalog item', () => {
  const cat = newItem({ name: 'Jacket' });
  const edited = resolveMembership(cat, newMembership({ itemId: cat.id, templateId: 't1' }));
  Object.assign(edited, {
    color: 'Navy', size: 'M', manufacturer: 'Patagonia', model: 'Nano Puff', owner: 'Martin',
    acquired: '2025-12-01', price: 199.95, currency: 'EUR', purchaseLink: 'https://x.example',
    expiry: '2030-01-01', condition: 'good', retired: true, retiredReason: 'replaced',
    serial: 'SN-42', qtyOwned: 2, warranty: '2027-01-01',
  });
  applyIntrinsic(cat, edited);
  assert.equal(cat.color, 'Navy');
  assert.equal(cat.manufacturer, 'Patagonia');
  assert.equal(cat.owner, 'Martin');
  assert.equal(cat.price, 199.95);
  assert.equal(cat.currency, 'EUR');
  assert.equal(cat.condition, 'good');
  assert.equal(cat.retired, true);
  assert.equal(cat.retiredReason, 'replaced');
  assert.equal(cat.qtyOwned, 2);
  assert.equal(cat.warranty, '2027-01-01');
});

test('buildCatalog: item metadata survives the migration round-trip', () => {
  const lists = [newList({ name: 'Travel', items: [
    newItem({ name: 'Backpack', manufacturer: 'Osprey', color: 'Black', price: 250, currency: 'USD', condition: 'good' }),
  ] })];
  const { items } = buildCatalog(lists);
  const bag = items.find((i) => i.name === 'Backpack');
  assert.equal(bag.manufacturer, 'Osprey');
  assert.equal(bag.color, 'Black');
  assert.equal(bag.price, 250);
  assert.equal(bag.currency, 'USD');
  assert.equal(bag.condition, 'good');
});

// --- Sections (per-template groupings) -------------------------------------

test('normalizeSections: drops blank names, keeps ids, dedups', () => {
  const a = newSection('Lights');
  const out = normalizeSections([a, { id: '', name: '  Rig  ' }, { name: '' }, a]);
  assert.equal(out.length, 2);
  assert.equal(out[0].id, a.id);
  assert.equal(out[0].name, 'Lights');
  assert.equal(out[1].name, 'Rig');       // trimmed
  assert.ok(out[1].id);                    // generated an id
});

test('coerceList / newList: sections normalize and default to empty', () => {
  assert.deepEqual(newList({ name: 'X' }).sections, []);
  const l = coerceList({ id: 't1', name: 'Dive', sections: [{ id: 's1', name: 'Rig' }, { name: '' }] });
  assert.equal(l.sections.length, 1);
  assert.equal(l.sections[0].name, 'Rig');
});

test('membership round-trip: section id survives resolve -> save', () => {
  const item = newItem({ name: 'Head torch' });
  const m = newMembership({ itemId: item.id, templateId: 't1', section: 's-lights' });
  const resolved = resolveMembership(item, m);
  assert.equal(resolved.section, 's-lights');            // read onto the resolved item
  const back = membershipFromResolved(item, 't1', resolved, 0, null);
  assert.equal(back.section, 's-lights');                // written back to the membership
  // No section -> stays empty, and it is NOT an intrinsic item default.
  assert.equal(resolveMembership(item, newMembership({ itemId: item.id, templateId: 't2' })).section, '');
  assert.equal(item.section, '');
});

test('same item, different section per template', () => {
  const item = newItem({ name: 'Head torch' });
  const inDive = resolveMembership(item, newMembership({ itemId: item.id, templateId: 'dive', section: 'lights' }));
  const inRun = resolveMembership(item, newMembership({ itemId: item.id, templateId: 'run', section: 'visibility' }));
  assert.equal(inDive.section, 'lights');
  assert.equal(inRun.section, 'visibility');   // independent — no cross-contamination
});

test('groupItemsBySection: template order, empty sections omitted, ungrouped last', () => {
  const sections = [newSection('Lights'), newSection('Rig'), newSection('Regulators')];
  const [L, R, G] = sections;
  const items = [
    newItem({ name: 'Reg 1', section: G.id }),
    newItem({ name: 'Light 1', section: L.id }),
    newItem({ name: 'Loose thing' }),                 // no section
    newItem({ name: 'Light 2', section: L.id }),
  ];
  const groups = groupItemsBySection(items, sections);
  // Rig has no items -> omitted; Lights before Regulators (template order); Ungrouped last.
  assert.deepEqual(groups.map((g) => (g.section ? g.section.name : 'Ungrouped')), ['Lights', 'Regulators', 'Ungrouped']);
  assert.equal(groups[0].items.length, 2);
  assert.equal(groups[2].section, null);
});

test('groupBySection: trip entries by name, first-appearance order, Everything else last', () => {
  const entries = [
    newItem({ name: 'a', section: 'Regulators' }),
    newItem({ name: 'b', section: 'Lights' }),
    newItem({ name: 'c' }),                            // unsectioned
    newItem({ name: 'd', section: 'Regulators' }),
  ];
  const groups = groupBySection(entries);
  assert.deepEqual(groups.map((g) => g.label), ['Regulators', 'Lights', 'Everything else']);
  assert.equal(groups[0].entries.length, 2);          // both Regulators merged
});

test('sectionName + buildTotalEntries: trip line carries the section DISPLAY NAME', () => {
  const light = newSection('Lights');
  const list = coerceList(newList({ id: 'dive', name: 'Diving', role: '', sections: [light] }));
  const torch = newItem({ name: 'Head torch', section: light.id });
  assert.equal(sectionName(list, light.id), 'Lights');
  list.items = [torch];
  const ev = newEvent({ mode: 'quick', activities: ['dive'] });
  const entries = buildTotalEntries(ev, [list]);
  assert.equal(entries[0].section, 'Lights');         // id resolved to name for the trip
});

test('buildCatalog: section survives the migration round-trip', () => {
  const light = newSection('Lights');
  const list = coerceList(newList({ id: 'dive', name: 'Diving', sections: [light],
    items: [newItem({ name: 'Head torch', section: light.id })] }));
  const { items, memberships, templates } = buildCatalog([list]);
  const tmpl = templates.find((t) => t.id === 'dive');
  assert.deepEqual(tmpl.sections.map((s) => s.name), ['Lights']);
  const resolved = resolveTemplateItems(tmpl, new Map(items.map((i) => [i.id, i])), memberships);
  assert.equal(resolved[0].section, light.id);        // membership kept the section id
});

// --- Containers (bags as maintainable objects) ------------------------------

test('capacityL + maxKg round-trip through the catalog', () => {
  const bag = newItem({ name: 'Osprey 40', capacityL: 40, maxKg: 8 });
  assert.equal(bag.capacityL, 40);
  assert.equal(bag.maxKg, 8);
  const m = newMembership({ itemId: bag.id, templateId: 'c1' });
  const back = membershipFromResolved(bag, 'c1', resolveMembership(bag, m), 0, m);
  const rebuilt = resolveMembership(applyIntrinsic(newItem({ name: 'Osprey 40' }), bag), back);
  assert.equal(rebuilt.capacityL, 40);
  assert.equal(rebuilt.maxKg, 8);
});

test('containerNames: merges built-in names with the user container records', () => {
  const cl = newList({ name: 'Containers', role: 'container', items: [newItem({ name: 'Osprey 40' })] });
  const names = containerNames([cl]);
  assert.ok(names.includes('Checked luggage'));  // built-in default
  assert.ok(names.includes('Osprey 40'));         // user record appended
  assert.ok(names.indexOf('Checked luggage') < names.indexOf('Osprey 40')); // defaults first
});

test('containerLimits + bagLoads: a real bag maxKg drives the over-limit warning', () => {
  const cl = newList({ name: 'Containers', role: 'container', items: [newItem({ name: 'Osprey 40', maxKg: 10 })] });
  const limits = containerLimits([cl]);
  assert.equal(limits['Osprey 40'], 10);
  assert.equal(limits['Checked luggage'], 23); // built-in default still present
  const entries = [newItem({ name: 'Rock', container: 'Osprey 40', weight: 12000 })]; // 12 kg
  const [bag] = bagLoads(entries, 0, limits);
  assert.equal(bag.limitKg, 10);
  assert.equal(bag.over, true);
  // Without the real limit, an unknown bag has no ceiling and never flags "over".
  assert.equal(bagLoads(entries, 0)[0].over, false);
});

test('seedLists: ships a Containers catalogue (role container) with capacities', () => {
  const cl = seedLists().find((l) => l.role === 'container');
  assert.ok(cl, 'a container list exists');
  assert.equal(cl.name, 'Containers');
  assert.equal(cl.sections.length, 0, 'containers have no sections');
  assert.ok(cl.items.length >= 10, `seeded with bags (${cl.items.length})`);
  assert.ok(cl.items.some((i) => i.capacityL > 0), 'some bags have a capacity');
  assert.ok(cl.items.some((i) => i.maxKg > 0), 'some bags have a max weight');
});

test('seedLists: every packable item has a weight; reminders have none', () => {
  let items = 0, weighed = 0, remWithWeight = 0;
  for (const l of seedLists()) {
    for (const it of l.items) {
      if (it.itemType === 'reminder') { if (it.weight > 0) remWithWeight++; continue; }
      items++;
      if (it.weight > 0) weighed++;
    }
  }
  assert.equal(weighed, items, `all ${items} packable items are weighed`);
  assert.equal(remWithWeight, 0, 'reminders carry no weight');
});

test('groupByStorage: groups by storage place, alphabetical, "No place set" last', () => {
  const entries = [
    newItem({ name: 'Tent', storage: 'Garage' }),
    newItem({ name: 'Socks' }),                         // no place
    newItem({ name: 'Charger', storage: 'Bedroom wardrobe' }),
    newItem({ name: 'Pump', storage: 'Garage' }),
  ];
  const groups = groupByStorage(entries);
  assert.deepEqual(groups.map((g) => g.label), ['Bedroom wardrobe', 'Garage', 'No place set']);
  assert.equal(groups[1].entries.length, 2);            // both Garage items together
  assert.equal(groupBy('stored', entries)[0].label, 'Bedroom wardrobe'); // via the dispatcher
});

test('seedLists: every packable item has a storage place; none in "Garage"', () => {
  let items = 0, stored = 0, garage = 0, remWith = 0;
  for (const l of seedLists()) {
    if (l.role === 'container') continue;
    for (const it of l.items) {
      if (it.itemType === 'reminder') { if (it.storage) remWith++; continue; }
      items++;
      if (it.storage) stored++;
      if (/garage/i.test(it.storage)) garage++;
    }
  }
  assert.equal(stored, items, `all ${items} packable items have a storage place`);
  assert.equal(garage, 0, 'nothing is filed under Garage');
  assert.equal(remWith, 0, 'reminders carry no storage');
});

test('catalogRows: one line per catalog item, gathering all its templates', () => {
  // The same catalog item (shared id) resolved into two templates collapses to one row.
  const boots = newItem({ name: 'Boots' });
  const hiking = newList({ name: 'Hiking', items: [boots, newItem({ name: 'Poles' })] });
  const travel = newList({ name: 'Travel', items: [{ ...boots }] }); // same id, different template
  const rows = catalogRows([hiking, travel]);
  assert.equal(rows.length, 2, 'Boots + Poles = 2 unique items');
  const bootRow = rows.find((r) => r.name === 'Boots');
  assert.deepEqual(bootRow.templates.map((t) => t.name).sort(), ['Hiking', 'Travel']);
  const poleRow = rows.find((r) => r.name === 'Poles');
  assert.deepEqual(poleRow.templates.map((t) => t.name), ['Hiking']);
  // Blank-named items are ignored.
  assert.equal(catalogRows([newList({ items: [newItem({ name: '' })] })]).length, 0);
});

test('dupeKey: collapses spacing and plurals for probable duplicates', () => {
  assert.equal(dupeKey('Sunglasses'), dupeKey('Sun glasses'));
  assert.equal(dupeKey('Running shoes'), dupeKey('Running shoe'));
  assert.equal(dupeKey('Ear plugs'), dupeKey('Earplugs'));
  assert.notEqual(dupeKey('Cap'), dupeKey('Cape'));   // short words are not over-stripped
  assert.notEqual(dupeKey('Socks'), dupeKey('Shorts'));
  assert.equal(dupeKey('   '), '');                    // blank -> empty key
});

test('duplicateGroups / duplicateIds: surface look-alike items', () => {
  const rows = catalogRows([newList({ name: 'A', items: [
    newItem({ name: 'Sunglasses' }),
    newItem({ name: 'Sun glasses' }),
    newItem({ name: 'Passport' }),
    newItem({ name: 'Head torch' }),
    newItem({ name: 'Head torch' }),  // exact duplicate name, distinct catalog item
  ] })]);
  const groups = duplicateGroups(rows);
  const byKey = new Map(groups.map((g) => [g.rows.map((r) => r.name).sort().join('|'), g]));
  assert.ok(byKey.has('Sun glasses|Sunglasses'), 'near-duplicate pair grouped');
  assert.equal(byKey.get('Sun glasses|Sunglasses').exact, false);
  const exactGroup = groups.find((g) => g.exact);
  assert.ok(exactGroup && exactGroup.rows.every((r) => r.name === 'Head torch'), 'exact-name duplicates flagged exact');
  // Passport has no partner -> not in any group, and not flagged.
  const ids = duplicateIds(rows);
  const passport = rows.find((r) => r.name === 'Passport');
  assert.equal(ids.has(passport.id), false);
  assert.ok(ids.size >= 4, 'both look-alike pairs are flagged');
});

// ---- Places visited (world map) -------------------------------------------

test('coerceGeo: keeps valid coordinates, rejects junk', () => {
  assert.deepEqual(coerceGeo({ lat: 59.33, lon: 18.06, place: 'Stockholm, SE' }),
    { lat: 59.33, lon: 18.06, place: 'Stockholm, SE' });
  assert.deepEqual(coerceGeo({ lat: '51.5', lon: '-0.12' }), { lat: 51.5, lon: -0.12, place: '' });
  assert.equal(coerceGeo(null), null);
  assert.equal(coerceGeo({ lat: 10 }), null);              // missing lon
  assert.equal(coerceGeo({ lat: 999, lon: 0 }), null);     // out of range
  assert.equal(coerceGeo({ lat: 'x', lon: 'y' }), null);   // not numbers
});

test('eventCoords: reads weather snapshot, then the geo fix, else null', () => {
  const bare = newEvent({ name: 'Nowhere' });
  assert.equal(eventCoords(bare), null);

  const withGeo = newEvent({ name: 'Geo only', destination: 'Oslo' });
  withGeo.geo = { lat: 59.91, lon: 10.75, place: 'Oslo, NO' };
  assert.deepEqual(eventCoords(withGeo), { lat: 59.91, lon: 10.75, place: 'Oslo, NO' });

  // A fetched forecast wins over the geo fix, and carries its tidy label.
  const withWeather = newEvent({ name: 'Weathered', destination: 'oslo' });
  withWeather.geo = { lat: 1, lon: 1, place: 'stale' };
  withWeather.weather = { lat: 59.91, lon: 10.75, place: 'Oslo, NO', daily: [] };
  assert.deepEqual(eventCoords(withWeather), { lat: 59.91, lon: 10.75, place: 'Oslo, NO' });
});

test('eventsNeedingCoords: only trips with a destination and no coordinates', () => {
  const located = newEvent({ name: 'Has coords', destination: 'Rome' });
  located.geo = { lat: 41.9, lon: 12.5, place: 'Rome, IT' };
  const needs = newEvent({ name: 'Needs lookup', destination: 'Lisbon' });
  const noDest = newEvent({ name: 'No destination' });
  const list = eventsNeedingCoords([located, needs, noDest]);
  assert.deepEqual(list.map((e) => e.name), ['Needs lookup']);
});

test('placesVisited: merges repeat visits to the same place into one pin', () => {
  const mk = (name, startDate, place, lat, lon) => {
    const e = newEvent({ name, destination: place, startDate });
    e.geo = { lat, lon, place };
    return e;
  };
  const events = [
    mk('Stockholm spring', '2025-04-10', 'Stockholm, SE', 59.33, 18.06),
    mk('Stockholm winter', '2026-01-05', 'Stockholm, SE', 59.33, 18.06),
    mk('London trip', '2025-09-01', 'London, GB', 51.5, -0.12),
    newEvent({ name: 'Undestined' }),   // no coords -> not on the map
  ];
  const pins = placesVisited(events);
  assert.equal(pins.length, 2, 'two distinct places');
  const sthlm = pins.find((p) => p.place === 'Stockholm, SE');
  assert.equal(sthlm.events.length, 2, 'both Stockholm trips under one pin');
  // Newest visit leads within the pin.
  assert.equal(sthlm.events[0].name, 'Stockholm winter');
  const london = pins.find((p) => p.place === 'London, GB');
  assert.equal(london.events.length, 1);
});

test('placesVisited: same spot with no label still merges by coordinates', () => {
  const a = newEvent({ name: 'A', destination: 'spot' });
  a.geo = { lat: 12.34, lon: 56.78, place: '' };
  const b = newEvent({ name: 'B', destination: 'spot' });
  b.geo = { lat: 12.341, lon: 56.779, place: '' };   // ~same, rounds together
  const pins = placesVisited([a, b]);
  assert.equal(pins.length, 1);
  assert.equal(pins[0].events.length, 2);
});

test('tripPath: dated trips with coordinates, oldest first; undated left off', () => {
  const mk = (name, startDate, lat, lon) => {
    const e = newEvent({ name, destination: name, startDate });
    if (lat != null) e.geo = { lat, lon, place: name };
    return e;
  };
  const events = [
    mk('London', '2025-09-01', 51.5, -0.12),
    mk('Tokyo', '2024-11-02', 35.68, 139.7),
    mk('Undated', '', 10, 10),            // no date -> not on the line
    mk('NoCoords', '2025-01-01', null),   // no coords -> not on the line
    mk('Oslo', '2026-01-05', 59.9, 10.75),
  ];
  const path = tripPath(events);
  assert.deepEqual(path.map((s) => s.name), ['Tokyo', 'London', 'Oslo']);
  assert.equal(path[0].lat, 35.68);
});

test('mostVisited: the top place, but only when somewhere beats a single visit', () => {
  const mk = (name, startDate, place) => {
    const e = newEvent({ name, destination: place, startDate });
    e.geo = { lat: 1, lon: 1, place };
    return e;
  };
  // Everywhere once -> nothing stands out.
  assert.equal(mostVisited(placesVisited([
    mk('a', '2025-01-01', 'Alpha, X'), mk('b', '2025-02-01', 'Beta, X'),
  ])), null);
  // Beta visited twice -> it's the winner.
  const top = mostVisited(placesVisited([
    mk('a', '2025-01-01', 'Alpha, X'),
    mk('b1', '2025-02-01', 'Beta, X'), mk('b2', '2025-03-01', 'Beta, X'),
  ]));
  assert.equal(top.place, 'Beta, X');
  assert.equal(top.events.length, 2);
});

// ---- Backup counts + shrink guard (data-safety hardening) ----

test('backupCounts: empty payload is all zeros', () => {
  const c = backupCounts({});
  assert.deepEqual(c, { items: 0, templates: 0, events: 0, actions: 0 });
});

test('backupCounts: counts unique catalog items, templates, events, actions', () => {
  const lists = seedLists();
  const c = backupCounts({ lists, events: [newEvent({ name: 'A' }), newEvent({ name: 'B' })], actions: [{ id: 'x' }] });
  assert.equal(c.templates, lists.length);
  assert.equal(c.events, 2);
  assert.equal(c.actions, 1);
  assert.ok(c.items > 0, 'seed has catalog items');
  // Unique items <= total per-template copies (merge-by-name collapses duplicates).
  const totalCopies = lists.reduce((n, l) => n + (l.items || []).length, 0);
  assert.ok(c.items <= totalCopies);
});

test('backupShrinks: flags a replace that loses more than half the catalog', () => {
  assert.equal(backupShrinks({ items: 383 }, { items: 380 }), false); // small drop is fine
  assert.equal(backupShrinks({ items: 383 }, { items: 100 }), true);  // lost most of it
  assert.equal(backupShrinks({ items: 383 }, { items: 0 }), true);    // going to empty
  assert.equal(backupShrinks({ items: 0 }, { items: 0 }), false);     // nothing to lose
  assert.equal(backupShrinks({ items: 0 }, { items: 5 }), false);     // growing is fine
});

// ---- Laundry-aware quantity scaling ----

test('qtyNights: no laundry -> full trip length', () => {
  assert.equal(qtyNights(newEvent({ nights: 12 })), 12);
  assert.equal(qtyNights(newEvent({ nights: 3 })), 3);
});

test('qtyNights: laundry caps long trips but never raises short ones', () => {
  assert.equal(qtyNights(newEvent({ nights: 12, laundry: true })), LAUNDRY_CAP_NIGHTS);
  assert.equal(qtyNights(newEvent({ nights: 3, laundry: true })), 3);   // below the cap -> unchanged
  assert.equal(qtyNights(newEvent({ nights: LAUNDRY_CAP_NIGHTS, laundry: true })), LAUNDRY_CAP_NIGHTS);
  assert.equal(qtyNights(newEvent({ nights: 0, laundry: true })), 0);
});

test('laundry feeds effectiveQty: a per-night item packs the cap, not one per night', () => {
  const socks = newItem({ name: 'Socks', perNight: true });
  const trip = newEvent({ nights: 10, laundry: true });
  assert.equal(effectiveQty(socks, qtyNights(trip)), LAUNDRY_CAP_NIGHTS); // 4, not 10
  const noLaundry = newEvent({ nights: 10 });
  assert.equal(effectiveQty(socks, qtyNights(noLaundry)), 10);
});

test('coerceEvent + newEvent carry the laundry flag', () => {
  assert.equal(newEvent({}).laundry, false);
  assert.equal(coerceEvent({ laundry: true }).laundry, true);
  assert.equal(coerceEvent({}).laundry, false);
});

// ---- Trip presets (saved event recipes) ----

test('presetConfigFromEvent: captures the recipe, not the trip specifics', () => {
  const ev = newEvent({
    name: 'Kalmar 2026', startDate: '2026-08-20', endDate: '2026-08-24', nights: 4,
    destination: 'Kalmar', mode: 'trip', transport: 'Plane', season: 'Summer',
    contexts: ['Outdoor'], catering: 'self', weatherOn: ['rain'], laundry: true,
    activities: ['a', 'b'],
  });
  const c = presetConfigFromEvent(ev);
  assert.deepEqual(c, { mode: 'trip', activities: ['a', 'b'], transport: 'Plane', season: 'Summer', contexts: ['Outdoor'], catering: 'self', weatherOn: ['rain'], laundry: true });
  // Trip specifics are NOT part of the preset.
  assert.equal('startDate' in c, false);
  assert.equal('destination' in c, false);
  assert.equal('name' in c, false);
});

test('applyPresetConfig: fills conditions but leaves name/dates/entries alone', () => {
  const ev = newEvent({ name: 'My trip', startDate: '2026-09-01', destination: 'Rome' });
  ev.entries = [newItem({ name: 'Passport' })];
  applyPresetConfig(ev, { mode: 'quick', activities: ['x'], transport: 'RV', season: 'Winter', contexts: ['Indoor'], catering: 'eatout', weatherOn: ['cold'], laundry: true });
  assert.equal(ev.mode, 'quick');
  assert.deepEqual(ev.activities, ['x']);
  assert.equal(ev.transport, 'RV');
  assert.equal(ev.season, 'Winter');
  assert.equal(ev.laundry, true);
  // Untouched:
  assert.equal(ev.name, 'My trip');
  assert.equal(ev.startDate, '2026-09-01');
  assert.equal(ev.destination, 'Rome');
  assert.equal(ev.entries.length, 1);
});

test('preset round-trip: config from an event re-applies to an identical config', () => {
  const src = newEvent({ mode: 'trip', transport: 'Car', season: 'Summer', contexts: ['Race'], catering: 'mixed', weatherOn: [], laundry: false, activities: ['golf'] });
  const config = presetConfigFromEvent(src);
  const target = applyPresetConfig(newEvent({ name: 'New', startDate: '2026-01-01' }), config);
  assert.deepEqual(presetConfigFromEvent(target), config);
});

// ---- Kits (reusable bundles) ----

test('coerceKit: de-dups member ids (order preserved) and normalises fields', () => {
  const k = coerceKit({ id: 'k1', name: 'Charging kit', emoji: ' 🔌 ', note: 5, itemIds: ['a', 'b', 'a', '', 'c', 'b'] });
  assert.deepEqual(k.itemIds, ['a', 'b', 'c']);
  assert.equal(k.emoji, '🔌');
  assert.equal(k.note, ''); // non-string note coerced away
});

test('newKit: sane defaults + timestamps', () => {
  const k = newKit({ name: 'Wash bag' });
  assert.equal(k.name, 'Wash bag');
  assert.deepEqual(k.itemIds, []);
  assert.equal(k.emoji, '');
  assert.ok(k.id && k.createdAt && k.updatedAt);
});

test('kitEmoji: own emoji wins, else the default bundle glyph', () => {
  assert.equal(kitEmoji(newKit({ emoji: '🩹' })), '🩹');
  assert.equal(kitEmoji(newKit({})), KIT_DEFAULT_EMOJI);
});

test('clusterByKit: loose entries stay in place; a kit emits its whole run once', () => {
  const e = [
    { name: 'A', kit: 'Charging kit' },
    { name: 'B', kit: '' },
    { name: 'C', kit: 'Charging kit' },
    { name: 'D', kit: 'Wash bag' },
  ];
  const cl = clusterByKit(e);
  assert.deepEqual(cl.map((c) => [c.kit, c.entries.length]), [['Charging kit', 2], ['', 1], ['Wash bag', 1]]);
  assert.deepEqual(cl[0].entries.map((x) => x.name), ['A', 'C']);
});

test('kit name flows catalog item -> membership -> resolved item', () => {
  const item = newItem({ name: 'USB-C cable' });
  const m = newMembership({ itemId: item.id, templateId: 't1', kit: 'Charging kit' });
  const resolved = resolveMembership(item, m);
  assert.equal(resolved.kit, 'Charging kit');
});

test('kit is a membership override, not a catalog default', () => {
  const resolved = newItem({ name: 'Plug', kit: 'Charging kit' });
  const cat = catalogItemFromResolved(resolved);
  assert.equal(cat.kit, ''); // never sticks to the shared item
  const m = membershipFromResolved(cat, 't1', resolved, 0);
  assert.equal(m.kit, 'Charging kit'); // it lives on the membership
});

test('a kit-tagged item carries its kit onto a built trip entry', () => {
  const list = coerceList(newList({ name: 'Travel', role: 'base', items: [newItem({ name: 'Power bank', kit: 'Charging kit' })] }));
  const ev = newEvent({ mode: 'trip' });
  const entries = buildTotalEntries(ev, [list]);
  const e = entries.find((x) => x.name === 'Power bank');
  assert.ok(e);
  assert.equal(e.kit, 'Charging kit');
});

// ---- Shopping list (pre-trip restock & replace) ----

const SHOP_TODAY = '2026-08-18T00:00:00Z';

test('action kind: defaults to todo, keeps a valid shopping kind', () => {
  assert.equal(newAction().kind, 'todo');
  assert.equal(coerceAction({ kind: 'shopping' }).kind, 'shopping');
  assert.equal(coerceAction({ kind: 'nonsense' }).kind, 'todo');
});

test('consumable flag survives coerceItem/newItem', () => {
  assert.equal(newItem({ name: 'Toothpaste', consumable: true }).consumable, true);
  assert.equal(newItem({ name: 'Phone' }).consumable, false);
});

test('shoppingReason: most-urgent reason wins', () => {
  assert.equal(shoppingReason(newItem({ condition: 'retire', consumable: true }), SHOP_TODAY), 'Needs replacing');
  assert.equal(shoppingReason(newItem({ expiry: '2026-01-01' }), SHOP_TODAY), 'Expired');
  assert.equal(shoppingReason(newItem({ expiry: '2026-09-01' }), SHOP_TODAY), 'Replace soon'); // within 30d
  assert.equal(shoppingReason(newItem({ consumable: true }), SHOP_TODAY), 'Restock');
  assert.equal(shoppingReason(newItem({ expiry: '2027-01-01' }), SHOP_TODAY), ''); // far future, nothing
  assert.equal(shoppingReason(newItem({ name: 'Phone' }), SHOP_TODAY), '');
});

test('shoppingSuggestions: skips retired + already-listed, sorts by urgency', () => {
  const items = [
    newItem({ id: 'a', name: 'Sunscreen', expiry: '2026-01-01' }),
    newItem({ id: 'b', name: 'Energy gels', consumable: true }),
    newItem({ id: 'c', name: 'Running shoes', condition: 'retire' }),
    newItem({ id: 'd', name: 'Rope', expiry: '2026-09-01' }),
    newItem({ id: 'e', name: 'Phone' }),
    newItem({ id: 'f', name: 'Old tent', consumable: true, retired: true }),
  ];
  const actions = [coerceAction({ kind: 'shopping', done: false, itemId: 'b' })]; // gels already on the list
  const sug = shoppingSuggestions(items, actions, SHOP_TODAY);
  assert.deepEqual(sug.map((s) => [s.item.name, s.reason]), [
    ['Running shoes', 'Needs replacing'],
    ['Sunscreen', 'Expired'],
    ['Rope', 'Replace soon'],
  ]);
});

test('openShoppingCount counts only open shopping-kind actions', () => {
  const actions = [
    coerceAction({ kind: 'shopping', done: false }),
    coerceAction({ kind: 'shopping', done: true }),
    coerceAction({ kind: 'todo', done: false }),
  ];
  assert.equal(openShoppingCount(actions), 1);
  assert.ok(EXPIRY_SOON_DAYS > 0);
});
