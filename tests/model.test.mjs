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
  coercePerson, newPerson, personColor, assignedPeople, PERSON_COLORS,
  listEmoji, listColor, TEMPLATE_DEFAULT_EMOJI, TEMPLATE_COLORS,
  isPhotoRef, photoRefs, inlinePhotos, hasInlinePhotos,
  backupState, backupSnoozeDays, newestChangeAt, oldestCreatedAt, BACKUP_DUE_DAYS, BACKUP_URGENT_DAYS,
  INTRINSIC_FIELDS, linkFromResolved, itemFromEntry, containerDefaultsFrom, templateDefaults, planContainerMigration, containerOverrideFor, mapSectionAcrossTemplates, orderActivities, ACTIVITY_ORDER,
  sortRowsBy, groupRowsBy, itemConditionLabel, ITEM_CONDITIONS,
  DEFAULT_ITEM_CONDITIONS, ITEM_CONDITION_IDS, coerceCondition, newCondition, setItemConditions,
  itemCondition, conditionTone, conditionReplaces, careSections, MAINTENANCE_UPCOMING_DAYS,
  looksLikeEmail, ownerNameFromEmail,
  PHASES, DEFAULT_PHASES, setPhases, coercePhase, newPhase, phasesCustomised,
  phaseOrFallback, phaseLeadDays, phaseEmoji, defaultPhaseId, phaseOrder,
  SHARED_KINDS, DEFAULT_PEOPLE, DEFAULT_STORAGE_LOCATIONS, sharedRowId, coerceSharedRow, sharedRowsOfKind,
  conditionsToRows, conditionsFromRows, peopleToRows, peopleFromRows,
  namesToRows, namesFromRows, presetsToRows, presetsFromRows,
  sharedRowsFrom, defaultListFor, isFactoryList,
  orderedNamesFromRows, ownersByUsage,
  monthKey, shiftMonth, monthGrid, rangeCellState, orderRange,
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
  for (const n of ['Strength', 'Mobility', 'Breath work']) { assert.ok(byName[n], `${n} exists`); assert.equal(byName[n].group, 'WET'); }
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
  // Due exactly N days from today, whatever the threshold currently is.
  const dueIn = (days) => mk(addDays('2026-07-30', days - 30), 30);
  assert.equal(maintenanceStatus(mk('2026-01-01', 90), today).state, 'overdue'); // due 2026-04-01
  assert.equal(maintenanceStatus(dueIn(3), today).state, 'soon');
  assert.equal(maintenanceStatus(mk('2026-07-01', 365), today).state, 'ok');     // due next year
  assert.equal(maintenanceStatus(newItem({ name: 'x' }), today), null);          // no record
  // The "due soon" window is a boundary, so pin both sides of it.
  assert.equal(maintenanceStatus(dueIn(MAINTENANCE_SOON_DAYS), today).state, 'soon');
  assert.equal(maintenanceStatus(dueIn(MAINTENANCE_SOON_DAYS + 1), today).state, 'ok');
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
    newItem({ maintenance: { intervalDays: 30, lastDone: addDays('2026-07-30', -27) } }), // soon (3 days)
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
  // Since v118 phases are editable AND synced, so an id this device doesn't know is
  // KEPT, not blanked: it is almost certainly a phase added on the other device, and
  // discarding it would move the item to a different place on the packing list.
  assert.equal(m.phase, 'bogus');
  assert.equal(coerceMembership({ id: 'm2', itemId: 'i1', templateId: 't1', phase: 42 }).phase, ''); // non-string -> use the item default
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

test('membershipFromResolved: stores the per-list exception the editor states', () => {
  const cat = newItem({ name: 'Socks', container: 'Duffel bag', phase: 'week', itemType: 'item' });
  const resolved = resolveMembership(cat, newMembership({ itemId: cat.id, templateId: 't1' }));
  resolved._ovContainer = 'Checked luggage';   // user sets an exception for THIS list
  resolved.container = 'Checked luggage';      // …and the effective value follows
  resolved.seasons = ['Summer'];               // and adds a condition
  const m = membershipFromResolved(cat, 't1', resolved, 3);
  assert.equal(m.container, 'Checked luggage'); // an exception was asked for -> stored
  assert.equal(m.phase, '');                    // no exception -> follows the item default
  assert.deepEqual(m.seasons, ['Summer']);
  assert.equal(m.order, 3);
  // round-trips back to the same resolved values
  const back = resolveMembership(cat, m);
  assert.equal(back.container, 'Checked luggage');
  assert.equal(back.phase, 'week');
  assert.deepEqual(back.seasons, ['Summer']);
});

test('membershipFromResolved: clearing the exception falls back to the item default', () => {
  const cat = newItem({ name: 'Socks', container: 'Duffel bag' });
  const m0 = newMembership({ itemId: cat.id, templateId: 't1', container: 'Checked luggage' });
  const resolved = resolveMembership(cat, m0);
  assert.equal(resolved.container, 'Checked luggage');
  resolved._ovContainer = '';                       // "— use the default —"
  const m = membershipFromResolved(cat, 't1', resolved, 0, m0);
  assert.equal(m.container, '');
  assert.equal(resolveMembership(cat, m).container, 'Duffel bag');
});

test('a freshly built item (no exception channel) still infers its override', () => {
  // Paths that hand-build an item never went through resolveMembership, so they
  // carry no `_ovContainer`. Those must keep working the old way.
  const cat = newItem({ name: 'Socks', container: 'Duffel bag' });
  const raw = newItem({ name: 'Socks', container: 'Checked luggage' });
  const m = membershipFromResolved(cat, 't1', raw, 0);
  assert.equal(m.container, 'Checked luggage');
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
  for (const f of ['color', 'size', 'manufacturer', 'model', 'ownedBy', 'acquired', 'currency', 'purchaseLink', 'expiry', 'condition', 'serial']) {
    assert.equal(empty[f], '', `${f} should default to ''`);
  }
  assert.equal(empty.price, 0);
  assert.equal(empty.qtyOwned, 0);
  // Invalid values are rejected; valid ones kept.
  const bad = coerceItem({ name: 'X', condition: '  sparkly  ', acquired: 'not-a-date', price: -5, qtyOwned: -2 });
  // Conditions are editable and live per-device, so an id this device doesn't know
  // is KEPT (trimmed), not dropped — dropping it would erase a rating set elsewhere.
  assert.equal(bad.condition, 'sparkly');
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
    color: 'Navy', size: 'M', manufacturer: 'Patagonia', model: 'Nano Puff', ownedBy: 'Martin',
    acquired: '2025-12-01', price: 199.95, currency: 'EUR', purchaseLink: 'https://x.example',
    expiry: '2030-01-01', condition: 'good', retired: true, retiredReason: 'replaced',
    serial: 'SN-42', qtyOwned: 2, warranty: '2027-01-01',
  });
  applyIntrinsic(cat, edited);
  assert.equal(cat.color, 'Navy');
  assert.equal(cat.manufacturer, 'Patagonia');
  assert.equal(cat.ownedBy, 'Martin');
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

// ---- People (who packs what) ----

test('coercePerson: trims name, validates colour, ensures id', () => {
  const p = coercePerson({ name: '  Anna ', color: 'nope' });
  assert.equal(p.name, 'Anna');
  assert.equal(p.color, PERSON_COLORS[0]);
  assert.ok(p.id);
  assert.equal(coercePerson({ name: 'X', color: '#a855f7' }).color, '#a855f7');
});

test('personColor: roster colour when known, stable hash otherwise, blank for empty', () => {
  const people = [newPerson({ name: 'Martin', color: '#3b82f6' }), newPerson({ name: 'Anna', color: '#a855f7' })];
  assert.equal(personColor('martin', people), '#3b82f6'); // case-insensitive
  assert.equal(personColor('', people), '');
  const emil = personColor('Emil', people);
  assert.ok(PERSON_COLORS.includes(emil));
  assert.equal(personColor('Emil', people), emil); // deterministic
});

test('assignedPeople: distinct packer names, first-seen order, case-folded', () => {
  const entries = [{ packer: 'Anna' }, { packer: '' }, { packer: 'Martin' }, { packer: 'anna' }, { packer: '  ' }];
  assert.deepEqual(assignedPeople(entries), ['Anna', 'Martin']);
});

test('packer flows onto a trip entry and survives the share bundle', () => {
  assert.equal(newItem({ name: 'Tent', packer: 'Anna' }).packer, 'Anna');
  const ev = newEvent({ name: 'Trip' });
  ev.entries = [newItem({ name: 'Tent', packer: 'Anna' })];
  const back = parseTripBundle(buildTripBundle(ev));
  assert.equal(back.entries[0].packer, 'Anna');
});

// --- Template covers (emoji + colour) ---
test('coerceList: cleans cover emoji and colour, drops junk', () => {
  const l = coerceList(newList({ name: 'Golf', emoji: '  ⛳ ', color: '#3b82f6' }));
  assert.equal(l.emoji, '⛳');
  assert.equal(l.color, '#3b82f6');
  const bad = coerceList(newList({ name: 'X', emoji: 42, color: 'blue' }));
  assert.equal(bad.emoji, '');
  assert.equal(bad.color, '');
});

test('listEmoji: custom emoji else the default glyph', () => {
  assert.equal(listEmoji(newList({ name: 'Dive', emoji: '🤿' })), '🤿');
  assert.equal(listEmoji(newList({ name: 'Plain' })), TEMPLATE_DEFAULT_EMOJI);
  assert.equal(listEmoji(newList({ name: 'Blankish', emoji: '   ' })), TEMPLATE_DEFAULT_EMOJI);
});

test('listColor: custom colour wins, else a stable palette pick from the id', () => {
  assert.equal(listColor(newList({ name: 'Run', color: '#ef4444' })), '#ef4444');
  const l = newList({ name: 'Auto', id: 'fixed-id' });
  const c1 = listColor(l);
  const c2 = listColor(l);
  assert.equal(c1, c2);                       // stable
  assert.ok(TEMPLATE_COLORS.includes(c1));     // from the palette
});

// --- Photos split out of the item (v98) ---
const DATA_URL = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

test('isPhotoRef: ids are refs, data URLs are not', () => {
  assert.equal(isPhotoRef('abc123'), true);
  assert.equal(isPhotoRef(DATA_URL), false);
  assert.equal(isPhotoRef(''), false);
  assert.equal(isPhotoRef(null), false);
});

test('photoRefs / inlinePhotos split a mixed (mid-migration) item', () => {
  const it = newItem({ name: 'Tent', photos: ['id-1', DATA_URL, 'id-2'] });
  assert.deepEqual(photoRefs(it), ['id-1', 'id-2']);
  assert.deepEqual(inlinePhotos(it), [DATA_URL]);
  assert.equal(hasInlinePhotos([newItem({ name: 'A' }), it]), true);
  assert.equal(hasInlinePhotos([newItem({ name: 'A', photos: ['id-9'] })]), false);
});

test('coerceItem keeps both photo shapes and defaults thumb to a string', () => {
  const it = coerceItem(newItem({ name: 'Stove', photos: ['id-1', DATA_URL] }));
  assert.deepEqual(it.photos, ['id-1', DATA_URL]);   // migration converts the inline one later
  assert.equal(it.thumb, '');
  assert.equal(coerceItem({ name: 'X', thumb: DATA_URL }).thumb, DATA_URL);
});

test('thumb + photo ids survive the catalog round-trip (edit propagates everywhere)', () => {
  const src = newItem({ name: 'Lamp', photos: ['id-7'], thumb: DATA_URL });
  const cat = catalogItemFromResolved(src);
  assert.deepEqual(cat.photos, ['id-7']);
  assert.equal(cat.thumb, DATA_URL);
  // An edit to the shared item must carry both fields through applyIntrinsic.
  const edited = newItem({ name: 'Lamp', photos: ['id-7', 'id-8'], thumb: 'data:image/jpeg;base64,QQ==' });
  const back = applyIntrinsic(cat, edited);
  assert.deepEqual(back.photos, ['id-7', 'id-8']);
  assert.equal(back.thumb, 'data:image/jpeg;base64,QQ==');
});

// Regression: a replace-import and every snapshot restore rebuild the catalog
// through buildCatalog(). Photos and the care record are intrinsic to the object,
// so they MUST survive that rebuild — they used to be dropped silently, which
// quietly stripped every picture and maintenance schedule from a restore.
test('buildCatalog keeps photos, thumb and the care record through a restore', () => {
  const withPhoto = newItem({
    name: 'Dive light', photos: ['pid-1', 'pid-2'], thumb: DATA_URL,
    maintenance: { notes: 'rinse in fresh water', intervalDays: 90, lastDone: '2026-06-01', log: [] },
  });
  const lists = [newList({ name: 'Diving', items: [withPhoto] })];
  const { items } = buildCatalog(lists);
  const back = items.find((i) => i.name === 'Dive light');
  assert.deepEqual(back.photos, ['pid-1', 'pid-2']);
  assert.equal(back.thumb, DATA_URL);
  assert.ok(back.maintenance, 'the care record must survive the rebuild');
  assert.equal(back.maintenance.intervalDays, 90);
  assert.equal(back.maintenance.notes, 'rinse in fresh water');
});

test('buildCatalog merges same-named copies without losing the one that has a photo', () => {
  const bare = newItem({ name: 'Torch' });
  const rich = newItem({ name: 'Torch', photos: ['pid-9'], thumb: DATA_URL });
  const { items } = buildCatalog([
    newList({ name: 'A', items: [bare] }),
    newList({ name: 'B', items: [rich] }),
  ]);
  const merged = items.filter((i) => i.name === 'Torch');
  assert.equal(merged.length, 1, 'same-named items merge into one catalog entry');
  assert.deepEqual(merged[0].photos, ['pid-9']);
  assert.equal(merged[0].thumb, DATA_URL);
});

// --- Backup reminders (#13) ---------------------------------------------------

const NOW = '2026-08-20T12:00:00.000Z';

test('newestChangeAt: picks the latest stamp across every group', () => {
  const events = [{ updatedAt: '2026-08-01T09:00:00.000Z' }, { createdAt: '2026-08-03T09:00:00.000Z' }];
  const lists = [{ updatedAt: '2026-08-11T09:00:00.000Z' }];
  const actions = [{ updatedAt: '2026-08-05T09:00:00.000Z' }];
  assert.equal(newestChangeAt(events, lists, actions), '2026-08-11T09:00:00.000Z');
  assert.equal(newestChangeAt(), '', 'nothing at all reads as no change');
  assert.equal(newestChangeAt([], null, [{}, null]), '', 'rows without stamps are skipped');
});

test('backupState: an empty install is never nagged', () => {
  const s = backupState({ hasData: false, lastBackupAt: '', now: NOW });
  assert.equal(s.level, 'ok');
  assert.equal(s.unsaved, false);
});

test('backupState: stays silent when nothing changed since the backup, however long ago', () => {
  const s = backupState({
    hasData: true,
    lastBackupAt: '2026-01-01T10:00:00.000Z',   // 200+ days ago
    changedAt: '2025-12-30T10:00:00.000Z',      // but nothing touched since
    now: NOW,
  });
  assert.equal(s.level, 'ok', 'a quiet year is not a risk');
  assert.equal(s.unsaved, false);
  assert.ok(s.days > BACKUP_URGENT_DAYS, 'the age is still reported, it just does not nag');
});

test('backupState: escalates amber then red once there are unsaved changes', () => {
  const at = (days) => new Date(Date.parse(NOW) - days * 86400000).toISOString();
  const stateAfter = (days) => backupState({
    hasData: true, lastBackupAt: at(days), changedAt: NOW, now: NOW,
  });
  assert.equal(stateAfter(3).level, 'ok', 'a few days with changes is fine');
  assert.equal(stateAfter(BACKUP_DUE_DAYS).level, 'due');
  assert.equal(stateAfter(BACKUP_URGENT_DAYS - 1).level, 'due');
  assert.equal(stateAfter(BACKUP_URGENT_DAYS).level, 'urgent');
  assert.equal(stateAfter(BACKUP_DUE_DAYS).days, BACKUP_DUE_DAYS);
});

test('backupState: a same-day edit after a same-day backup still counts as unsaved', () => {
  const s = backupState({
    hasData: true,
    lastBackupAt: '2026-08-20T08:00:00.000Z',
    changedAt: '2026-08-20T11:00:00.000Z',
    now: NOW,
  });
  assert.equal(s.unsaved, true, 'the timestamp, not the date, decides');
  assert.equal(s.level, 'ok', 'but it is not overdue yet, so no nag');
});

test('backupState: a legacy date-only backup stamp errs towards nagging', () => {
  const s = backupState({
    hasData: true,
    lastBackupAt: '2026-08-20',                 // old date-only key
    changedAt: '2026-08-20T11:00:00.000Z',
    now: NOW,
  });
  assert.equal(s.unsaved, true);
});

test('backupState: never backed up escalates from first use', () => {
  const fresh = backupState({ hasData: true, lastBackupAt: '', firstUseAt: '2026-08-18', now: NOW });
  assert.equal(fresh.never, true);
  assert.equal(fresh.unsaved, true);
  assert.equal(fresh.level, 'ok', 'two days in, do not pounce on a new user');

  const old = backupState({ hasData: true, lastBackupAt: '', firstUseAt: '2026-01-01', now: NOW });
  assert.equal(old.level, 'urgent', 'months of use and no file ever saved is the worst case');
  assert.ok(old.days > BACKUP_URGENT_DAYS);
});

test('backupSnoozeDays: dismissing buys less time the more overdue you are', () => {
  assert.equal(backupSnoozeDays('due'), 7);
  assert.equal(backupSnoozeDays('urgent'), 1);
});

test('oldestCreatedAt: dates a device from its earliest trip, not the newest', () => {
  const events = [{ createdAt: '2026-03-01T00:00:00.000Z' }, { createdAt: '2025-07-14T00:00:00.000Z' }];
  const lists = [{ createdAt: '2026-01-05T00:00:00.000Z' }];
  assert.equal(oldestCreatedAt(events, lists), '2025-07-14T00:00:00.000Z');
  assert.equal(oldestCreatedAt([], [{}]), '', 'rows with no stamp contribute nothing');
});

// --- v108: one physical item, shared properly -------------------------------
// These lock shut the bug where putting an item into a second template wrote a
// half-filled copy over the SHARED item and erased its photos, care record and
// purchase details everywhere at once.

// A fully-described physical object, the way a well-kept item looks.
function richItem() {
  return newItem({
    name: 'Insta360 X4', category: 'electronics', container: 'Day pack', phase: 'day',
    manufacturer: 'Insta360', model: 'X4', serial: 'IX4-99812',
    price: 4990, currency: 'SEK', purchaseLink: 'https://example.com',
    acquired: '2025-03-01', warranty: '2027-03-01', condition: 'good', qtyOwned: 1,
    weight: 203, storage: 'Chest of drawers',
    photos: ['photo-abc123'], thumb: 'data:image/jpeg;base64,AAAA',
    maintenance: { intervalDays: 90, lastDone: '2026-05-01' },
  });
}

test('linkFromResolved: joining another template cannot touch the shared item', () => {
  const cat = richItem();
  const before = JSON.parse(JSON.stringify(cat));
  const link = linkFromResolved(cat, cat.id);
  applyIntrinsic(cat, link);            // exactly what saveList does with the link
  for (const f of INTRINSIC_FIELDS) {
    if (f === 'name') continue;         // the link carries the name, unchanged
    assert.deepEqual(cat[f], before[f], `link erased the shared item's "${f}"`);
  }
  assert.equal(cat.container, before.container, 'link erased the container default');
});

test('linkFromResolved: carries the per-list choices and links by id', () => {
  const cat = richItem();
  const src = { ...cat, seasons: ['Summer'], note: 'in the side pocket', qty: '2', kit: 'Camera kit' };
  const link = linkFromResolved(src, cat.id);
  assert.equal(link._itemId, cat.id);
  assert.equal(link._link, true);
  assert.deepEqual(link.seasons, ['Summer']);
  assert.equal(link.note, 'in the side pocket');
  assert.equal(link.qty, '2');
  assert.equal(link.kit, 'Camera kit');
  assert.equal(link._ovContainer, '', 'a new home starts with no exception');
  // and it carries NONE of the intrinsic detail, so there is nothing to overwrite with
  for (const f of INTRINSIC_FIELDS) {
    if (f === 'name') continue;
    assert.equal(link[f], undefined, `a link must not carry "${f}"`);
  }
});

test('applyIntrinsic: an absent field is left alone, an empty one still clears', () => {
  const cat = richItem();
  applyIntrinsic(cat, { serial: '' });                 // deliberate clear
  assert.equal(cat.serial, '');
  assert.equal(cat.manufacturer, 'Insta360');          // untouched, not wiped
  assert.deepEqual(cat.photos, ['photo-abc123']);
});

test('editing an item in one template propagates to every other template', () => {
  const cat = richItem();
  const mTravel = newMembership({ itemId: cat.id, templateId: 'travel' });
  const mHiking = newMembership({ itemId: cat.id, templateId: 'hiking' });
  // Open it in Travel and change things under "① The item itself".
  const edited = resolveMembership(cat, mTravel);
  edited.storage = 'Camera shelf';
  edited.weight = 210;
  edited._defContainer = 'Carry-on / hand luggage';   // the ① default, not an exception
  applyIntrinsic(cat, edited);
  const hiking = resolveMembership(cat, mHiking);
  assert.equal(hiking.storage, 'Camera shelf');
  assert.equal(hiking.weight, 210);
  assert.equal(hiking.container, 'Carry-on / hand luggage', 'the container default must travel too');
});

test('a per-list exception survives an edit to the shared default', () => {
  const cat = newItem({ name: 'Sunglasses', container: 'Duffel bag' });
  const mHiking = newMembership({ itemId: cat.id, templateId: 'hiking', container: 'Hiking backpack' });
  const edited = resolveMembership(cat, newMembership({ itemId: cat.id, templateId: 'travel' }));
  edited._defContainer = 'Carry-on / hand luggage';
  applyIntrinsic(cat, edited);
  assert.equal(resolveMembership(cat, mHiking).container, 'Hiking backpack', 'the exception still wins');
});

test('container resolves exception → template default → item default', () => {
  const cat = newItem({ name: 'Socks', container: 'Duffel bag' });
  const plain = newMembership({ itemId: cat.id, templateId: 'hiking' });
  const withEx = newMembership({ itemId: cat.id, templateId: 'hiking', container: 'RV storage box' });
  const tpl = templateDefaults({ defaultContainer: 'Hiking backpack' });
  assert.equal(resolveMembership(cat, plain, null).container, 'Duffel bag');       // item default
  assert.equal(resolveMembership(cat, plain, tpl).container, 'Hiking backpack');   // template beats item
  assert.equal(resolveMembership(cat, withEx, tpl).container, 'RV storage box');   // exception beats both
});

test('containerDefaultsFrom: the most-used container wins, ties go to first seen', () => {
  const d = containerDefaultsFrom([
    { itemId: 'a', container: 'Duffel bag' },
    { itemId: 'a', container: 'Duffel bag' },
    { itemId: 'a', container: 'Carry-on / hand luggage' },
    { itemId: 'b', container: 'Golf bag' },
    { itemId: 'b', container: 'Checked luggage' },
  ]);
  assert.equal(d.get('a'), 'Duffel bag');
  assert.equal(d.get('b'), 'Golf bag');       // 1-1 tie -> the one seen first
});

test('the container migration never moves an item on any list', () => {
  const cat = newItem({ name: 'Sunglasses', container: 'Day pack' });   // frozen birth default
  const mems = [
    newMembership({ itemId: cat.id, templateId: 'golf', container: 'Duffel bag' }),
    newMembership({ itemId: cat.id, templateId: 'run', container: 'Duffel bag' }),
    newMembership({ itemId: cat.id, templateId: 'hiking', container: 'Hiking backpack' }),
    newMembership({ itemId: cat.id, templateId: 'car', container: '' }),   // followed the old default
  ];
  const before = mems.map((m) => resolveMembership(cat, m).container);
  // …the migration, exactly as db.js runs it
  const rows = mems.map((m) => ({ itemId: m.itemId, container: m.container || cat.container || '' }));
  const defaults = containerDefaultsFrom(rows);
  cat.container = defaults.get(cat.id);
  for (const m of mems) {
    const eff = m.container || 'Day pack';
    m.container = eff === defaults.get(m.itemId) ? '' : eff;
  }
  assert.equal(cat.container, 'Duffel bag', 'the container it actually uses most becomes the default');
  const after = mems.map((m) => resolveMembership(cat, m).container);
  assert.deepEqual(after, before, 'every list must still show exactly what it showed');
});

test('itemFromEntry: promoting a trip one-off keeps its photo and care record', () => {
  const entry = newItem({
    name: 'Beach umbrella', container: 'Checked luggage', seasons: ['Summer'],
    photos: ['photo-xyz'], thumb: 'data:image/jpeg;base64,BBBB',
    maintenance: { intervalDays: 365 }, price: 300,
  });
  const it = itemFromEntry(entry);
  assert.deepEqual(it.photos, ['photo-xyz']);
  assert.equal(it.thumb, 'data:image/jpeg;base64,BBBB');
  assert.equal(it.maintenance.intervalDays, 365);
  assert.equal(it.price, 300);
  assert.deepEqual(it.seasons, ['Summer'], 'and its conditions come along');
});

test('coerceList: a template can carry its own default container', () => {
  assert.equal(coerceList({ name: 'Hiking' }).defaultContainer, '');
  assert.equal(coerceList({ name: 'Hiking', defaultContainer: 'Hiking backpack' }).defaultContainer, 'Hiking backpack');
  assert.equal(coerceList({ name: 'Hiking', defaultContainer: 42 }).defaultContainer, '');
});

test('planContainerMigration: reads every row BEFORE rewriting any default', () => {
  // The trap: "Sunglasses" is born in the Day pack, and the Car list has no
  // override so it simply follows that default. Once the default becomes
  // "Duffel bag", anything that recomputed the Car row's old value by reading the
  // item would get "Duffel bag" — and the row would silently move.
  const cat = newItem({ name: 'Sunglasses', container: 'Day pack' });
  const mems = [
    newMembership({ itemId: cat.id, templateId: 'golf', container: 'Duffel bag' }),
    newMembership({ itemId: cat.id, templateId: 'run', container: 'Duffel bag' }),
    newMembership({ itemId: cat.id, templateId: 'car', container: '' }),   // follows the default
  ];
  const before = mems.map((m) => resolveMembership(cat, m).container);
  const plan = planContainerMigration([cat], mems);

  assert.equal(plan.defaults.get(cat.id), 'Duffel bag');
  // The Car row must be given "Day pack" as an explicit exception, NOT left empty.
  const carChange = plan.memChanges.find((c) => c.id === mems[2].id);
  assert.ok(carChange, 'the row that relied on the old default must be pinned');
  assert.equal(carChange.container, 'Day pack');

  // Apply the plan and confirm nothing moved.
  for (const c of plan.itemChanges) cat.container = c.container;
  for (const c of plan.memChanges) mems.find((m) => m.id === c.id).container = c.container;
  assert.deepEqual(mems.map((m) => resolveMembership(cat, m).container), before);
});

test('planContainerMigration: is idempotent and leaves settled data alone', () => {
  const cat = newItem({ name: 'Socks', container: 'Duffel bag' });
  const mems = [
    newMembership({ itemId: cat.id, templateId: 'a', container: '' }),
    newMembership({ itemId: cat.id, templateId: 'b', container: '' }),
    newMembership({ itemId: cat.id, templateId: 'c', container: 'RV storage box' }),
  ];
  const p1 = planContainerMigration([cat], mems);
  assert.deepEqual(p1.itemChanges, [], 'the default is already the most-used one');
  assert.deepEqual(p1.memChanges, [], 'and every exception is already correct');
});

test('planContainerMigration: an item with no memberships is left untouched', () => {
  const cat = newItem({ name: 'Orphan', container: 'Day pack' });
  const plan = planContainerMigration([cat], []);
  assert.deepEqual(plan.itemChanges, []);
  assert.deepEqual(plan.memChanges, []);
});

test('containerOverrideFor: an exception is only kept when the fallback misses', () => {
  // No template default: compare against the item's own.
  assert.equal(containerOverrideFor('Duffel bag', '', 'Duffel bag'), '');
  assert.equal(containerOverrideFor('Golf bag', '', 'Duffel bag'), 'Golf bag');
  // With a template default, THAT is what the row would fall back to.
  assert.equal(containerOverrideFor('Hiking backpack', 'Hiking backpack', 'Duffel bag'), '');
  assert.equal(containerOverrideFor('Duffel bag', 'Hiking backpack', 'Duffel bag'), 'Duffel bag',
    'must stay an exception — the template default would otherwise capture this row');
});

test('buildCatalog: a template default cannot swallow a row that differs from it', () => {
  // The restore path runs through buildCatalog. Hiking packs into the backpack by
  // default, but these wipes live in the duffel — that must survive a round-trip.
  const lists = [
    coerceList({ id: 'hiking', name: 'Hiking', defaultContainer: 'Hiking backpack',
      items: [newItem({ name: 'Hand-sanitizer wipes', container: 'Duffel bag' })] }),
    coerceList({ id: 'travel', name: 'Travel',
      items: [newItem({ name: 'Hand-sanitizer wipes', container: 'Carry-on / hand luggage' })] }),
  ];
  const cat = buildCatalog(lists);
  const rebuilt = {};
  for (const t of cat.templates) {
    for (const it of resolveTemplateItems(t, cat.items, cat.memberships)) rebuilt[t.name] = it.container;
  }
  assert.equal(rebuilt.Hiking, 'Duffel bag', 'the row must not be captured by the template default');
  assert.equal(rebuilt.Travel, 'Carry-on / hand luggage');
});

test('planContainerMigration: respects a template default when re-run after a restore', () => {
  const cat = newItem({ name: 'Wipes', container: 'Duffel bag' });
  const mems = [newMembership({ itemId: cat.id, templateId: 'hiking', container: 'Duffel bag' })];
  const tmpls = [{ id: 'hiking', defaultContainer: 'Hiking backpack' }];
  const before = 'Duffel bag';
  const plan = planContainerMigration([cat], mems, tmpls);
  for (const c of plan.itemChanges) cat.container = c.container;
  for (const c of plan.memChanges) mems[0].container = c.container;
  const after = resolveMembership(cat, mems[0], templateDefaults(tmpls[0])).container;
  assert.equal(after, before, 're-running the repair must not move a row onto the template default');
});

test('a link never carries a foreign section id', () => {
  const src = newItem({ name: 'Insta360 X4', section: 'sec-belonging-to-travel' });
  const link = linkFromResolved(src, 'item-1');
  assert.equal(link.section, '', 'a section id from another template means nothing here');
});

test('mapSectionAcrossTemplates: the section travels by name, not by id', () => {
  const travel = coerceList({ id: 'travel', name: 'Travel',
    sections: [{ id: 's-tv-1', name: 'Electronics' }, { id: 's-tv-2', name: 'Toiletries' }] });
  const hiking = coerceList({ id: 'hiking', name: 'Hiking',
    sections: [{ id: 's-hk-9', name: 'electronics' }, { id: 's-hk-8', name: 'Lights' }] });
  // same name, different id -> lands in the destination's own section
  assert.equal(mapSectionAcrossTemplates('s-tv-1', travel, hiking), 's-hk-9');
  // no such section over there -> Ungrouped, never invented
  assert.equal(mapSectionAcrossTemplates('s-tv-2', travel, hiking), '');
  assert.equal(hiking.sections.length, 2, 'the destination must not gain a section');
  // unsectioned stays unsectioned; an unknown id is not carried
  assert.equal(mapSectionAcrossTemplates('', travel, hiking), '');
  assert.equal(mapSectionAcrossTemplates('nonsense', travel, hiking), '');
});

test('a mapped section is the one the link actually stores', () => {
  const travel = coerceList({ id: 'travel', name: 'Travel', sections: [{ id: 's-tv-1', name: 'Electronics' }] });
  const hiking = coerceList({ id: 'hiking', name: 'Hiking', sections: [{ id: 's-hk-9', name: 'Electronics' }] });
  const src = newItem({ name: 'Insta360 X4', section: 's-tv-1' });
  const link = linkFromResolved(src, 'item-1', { section: mapSectionAcrossTemplates(src.section, travel, hiking) });
  assert.equal(link.section, 's-hk-9');
  // and it survives the decompose into a membership
  const cat = newItem({ name: 'Insta360 X4' });
  const m = membershipFromResolved(cat, 'hiking', link, 0);
  assert.equal(m.section, 's-hk-9');
  assert.equal(resolveMembership(cat, m).section, 's-hk-9');
});

test('groupItemsBySection ignores a section id from another template', () => {
  const items = [newItem({ name: 'X4', section: 'sec-from-travel' })];
  const groups = groupItemsBySection(items, [{ id: 's-hk-9', name: 'Electronics' }]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].section, null, 'it falls into Ungrouped rather than vanishing');
});

test('orderActivities: WET follows the deliberate order, not the alphabet', () => {
  const names = ['Breath work', 'Mobility', 'Run', 'Strength', 'Swim', 'Bike'];  // alphabetical-ish input
  const out = orderActivities('WET', names.map((n) => ({ id: n, name: n })));
  assert.deepEqual(out.map((l) => l.name), ['Swim', 'Bike', 'Run', 'Strength', 'Mobility', 'Breath work']);
});

test('orderActivities: an activity of your own lands after the known ones, A–Z', () => {
  const lists = ['Padel', 'Swim', 'Breath work', 'Aerial hoop'].map((n) => ({ id: n, name: n }));
  const out = orderActivities('WET', lists).map((l) => l.name);
  assert.deepEqual(out, ['Swim', 'Breath work', 'Aerial hoop', 'Padel']);
  assert.equal(out.length, 4, 'nothing may be dropped');
});

test('orderActivities: a group with no set order keeps what it was given', () => {
  const lists = [{ id: 'b', name: 'Golf' }, { id: 'a', name: 'Diving' }];
  assert.deepEqual(orderActivities('GA', lists).map((l) => l.name), ['Golf', 'Diving']);
  assert.deepEqual(orderActivities('', lists).map((l) => l.name), ['Golf', 'Diving']);
});

test('orderActivities: matches names case- and spacing-insensitively', () => {
  const out = orderActivities('WET', [{ name: 'breath  work' }, { name: 'SWIM' }]);
  assert.deepEqual(out.map((l) => l.name), ['SWIM', 'breath  work']);
});

test('the seed ships Mobility, not Yoga / Mobility', () => {
  const names = seedLists().map((l) => l.name);
  assert.ok(names.includes('Mobility'), 'the renamed scaffold must be there');
  assert.ok(!names.some((n) => /yoga/i.test(n)), 'the old name must be gone');
  // every name in the WET order must actually exist as a seeded list
  for (const want of ACTIVITY_ORDER.WET) {
    assert.ok(names.includes(want), `WET order names a list that does not exist: ${want}`);
  }
});

// ---- All-items index: sorting & grouping ----------------------------------

test('sortRowsBy: text sorts A–Z, case-insensitively', () => {
  const rows = [{ n: 'zebra' }, { n: 'Apple' }, { n: 'mango' }];
  assert.deepEqual(sortRowsBy(rows, (r) => r.n).map((r) => r.n), ['Apple', 'mango', 'zebra']);
  assert.deepEqual(sortRowsBy(rows, (r) => r.n, { dir: 'desc' }).map((r) => r.n), ['zebra', 'mango', 'Apple']);
});

test('sortRowsBy: blanks sink to the bottom in BOTH directions', () => {
  const rows = [{ m: '' }, { m: 'Osprey' }, { m: '  ' }, { m: 'Arcteryx' }];
  const asc = sortRowsBy(rows, (r) => r.m).map((r) => r.m.trim());
  const desc = sortRowsBy(rows, (r) => r.m, { dir: 'desc' }).map((r) => r.m.trim());
  assert.deepEqual(asc, ['Arcteryx', 'Osprey', '', '']);
  assert.deepEqual(desc, ['Osprey', 'Arcteryx', '', ''], 'a reversed sort must not lead with blanks');
});

test('sortRowsBy: numbers compare arithmetically and 0 counts as unrecorded', () => {
  const rows = [{ w: 90 }, { w: 0 }, { w: 1200 }, { w: 7 }];
  assert.deepEqual(sortRowsBy(rows, (r) => r.w, { num: true }).map((r) => r.w), [7, 90, 1200, 0]);
  assert.deepEqual(sortRowsBy(rows, (r) => r.w, { num: true, dir: 'desc' }).map((r) => r.w), [1200, 90, 7, 0]);
});

test('sortRowsBy: ties settle by the tie-breaker, and never flip with direction', () => {
  const rows = [{ c: 'Duffel bag', n: 'Towel' }, { c: 'Duffel bag', n: 'Cap' }, { c: 'Day pack', n: 'Map' }];
  const tie = (a, b) => a.n.localeCompare(b.n);
  assert.deepEqual(sortRowsBy(rows, (r) => r.c, { tie }).map((r) => r.n), ['Map', 'Cap', 'Towel']);
  assert.deepEqual(sortRowsBy(rows, (r) => r.c, { tie, dir: 'desc' }).map((r) => r.n), ['Cap', 'Towel', 'Map']);
});

test('sortRowsBy: does not mutate the rows it is given', () => {
  const rows = [{ n: 'b' }, { n: 'a' }];
  sortRowsBy(rows, (r) => r.n);
  assert.deepEqual(rows.map((r) => r.n), ['b', 'a']);
});

test('groupRowsBy: known buckets first in order, the rest A–Z, "not set" last', () => {
  const rows = [
    { c: '' }, { c: 'Zulu bag' }, { c: 'Duffel bag' }, { c: 'Toiletry bag' }, { c: 'Alpha bag' }, { c: '' },
  ];
  const out = groupRowsBy(rows, (r) => r.c, { order: CONTAINERS, emptyLabel: 'No bag chosen' });
  assert.deepEqual(out.map((g) => g.label), ['Toiletry bag', 'Duffel bag', 'Alpha bag', 'Zulu bag', 'No bag chosen']);
  assert.equal(out[out.length - 1].rows.length, 2);
});

test('groupRowsBy: keeps the incoming order inside each bucket (so the sort still applies)', () => {
  const rows = [{ c: 'A', n: 1 }, { c: 'B', n: 2 }, { c: 'A', n: 3 }, { c: 'A', n: 4 }];
  const out = groupRowsBy(rows, (r) => r.c);
  assert.deepEqual(out[0].rows.map((r) => r.n), [1, 3, 4]);
});

test('groupRowsBy: every row lands in exactly one bucket', () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({ c: i % 5 ? `bag ${i % 5}` : '' }));
  const out = groupRowsBy(rows, (r) => r.c);
  assert.equal(out.reduce((s, g) => s + g.rows.length, 0), 40);
});

test('itemConditionLabel: every condition has a label, unrated has none', () => {
  for (const c of ITEM_CONDITIONS) assert.equal(itemConditionLabel(c.id), c.label);
  assert.equal(itemConditionLabel(''), '');
  // An id this device has no name for shows AS ITSELF rather than vanishing — it
  // belongs to a condition set on another device, or one since removed.
  assert.equal(itemConditionLabel('nonsense'), 'nonsense');
});

// ---- Editable conditions (v113) ----------------------------------------------
// Every test here restores the factory list afterwards: setItemConditions mutates
// the shared arrays in place, so leaking a custom list would poison later tests.
const withConditions = (list, fn) => {
  try { setItemConditions(list); fn(); }
  finally { setItemConditions(DEFAULT_ITEM_CONDITIONS.map((c) => ({ ...c }))); }
};

test('coerceCondition: trims, bounds and rejects an unknown tone', () => {
  const c = coerceCondition({ id: '  worn  ', label: '  Worn  ', tone: 'purple', replace: 1 });
  assert.equal(c.id, 'worn');
  assert.equal(c.label, 'Worn');
  assert.equal(c.tone, '');            // not one of the three tones
  assert.equal(c.replace, true);       // coerced to a real boolean
  assert.equal(coerceCondition(null).id, '');
  assert.equal(coerceCondition({ id: 'x'.repeat(80) }).id.length, 40);
});

test('newCondition: makes a readable id and never collides', () => {
  assert.equal(newCondition('Being repaired').id, 'being-repaired');
  assert.equal(newCondition('Worn', ['worn']).id, 'worn-2');
  assert.equal(newCondition('Worn', ['worn', 'worn-2']).id, 'worn-3');
  assert.equal(newCondition('!!!').id.startsWith('cond-'), true);  // nothing usable in the name
  assert.equal(newCondition('Failing').label, 'Failing');
});

test('setItemConditions: mutates the shared arrays in place, so importers stay live', () => {
  const conds = ITEM_CONDITIONS;          // the very array another module would hold
  const ids = ITEM_CONDITION_IDS;
  withConditions([{ id: 'fine', label: 'Fine' }, { id: 'failing', label: 'Failing', tone: 'danger', replace: true }], () => {
    assert.equal(conds, ITEM_CONDITIONS); // same array identity, not a replacement
    assert.equal(ids, ITEM_CONDITION_IDS);
    assert.deepEqual(ITEM_CONDITION_IDS, ['fine', 'failing']);
    assert.equal(ITEM_CONDITIONS.length, 2);
  });
  assert.deepEqual(ITEM_CONDITION_IDS, DEFAULT_ITEM_CONDITIONS.map((c) => c.id));
});

test('setItemConditions: drops unusable rows and never leaves the app with none', () => {
  withConditions([{ id: '', label: 'No id' }, { id: 'a', label: '' }, { id: 'ok', label: 'Ok' }, { id: 'ok', label: 'Dupe' }], () => {
    assert.deepEqual(ITEM_CONDITION_IDS, ['ok']);
  });
  withConditions([], () => {
    // An empty list falls back to the factory four rather than leaving nothing.
    assert.deepEqual(ITEM_CONDITION_IDS, DEFAULT_ITEM_CONDITIONS.map((c) => c.id));
  });
});

test('conditionReplaces / conditionTone: behaviour follows the flag, not the id', () => {
  assert.equal(conditionReplaces('retire'), true);     // the built-in one
  assert.equal(conditionReplaces('worn'), false);
  assert.equal(conditionTone('worn'), 'warn');
  assert.equal(conditionTone('good'), '');
  withConditions([{ id: 'failing', label: 'Failing', tone: 'danger', replace: true }], () => {
    assert.equal(conditionReplaces('failing'), true);  // a condition you invented does the job
    assert.equal(conditionReplaces('retire'), false);  // ...and the old id no longer does
    assert.equal(itemCondition('retire'), null);
  });
});

test('shoppingReason: any "needs replacing" condition feeds the buy list', () => {
  const today = '2026-08-24T00:00:00Z';
  assert.equal(shoppingReason(newItem({ name: 'Shoes', condition: 'retire' }), today), 'Needs replacing');
  assert.equal(shoppingReason(newItem({ name: 'Shoes', condition: 'worn' }), today), '');
  withConditions([{ id: 'failing', label: 'Failing', tone: 'danger', replace: true }, { id: 'ok', label: 'Ok' }], () => {
    assert.equal(shoppingReason(newItem({ name: 'Shoes', condition: 'failing' }), today), 'Needs replacing');
    assert.equal(shoppingReason(newItem({ name: 'Shoes', condition: 'ok' }), today), '');
  });
});

test('careSections: overdue and due-soon stay open, far-off and reference fold', () => {
  const row = (state, days) => ({ status: { state, days } });
  const rows = [row('overdue', -5), row('soon', 3), row('ok', 20), row('ok', 400), row('reference', null)];
  const secs = careSections(rows, 60);
  const by = Object.fromEntries(secs.map((s) => [s.key, s]));
  assert.deepEqual(secs.map((s) => s.key), ['overdue', 'soon', 'upcoming', 'later', 'reference']);
  assert.equal(by.upcoming.rows.length, 1);         // the 20-day one
  assert.equal(by.later.rows.length, 1);            // the 400-day one
  assert.equal(by.overdue.fold, false);
  assert.equal(by.soon.fold, false);
  assert.equal(by.upcoming.fold, false);
  assert.equal(by.later.fold, true);
  assert.equal(by.reference.fold, true);
  // Every row lands in exactly one section, so nothing is hidden by the split.
  assert.equal(secs.reduce((n, s) => n + s.rows.length, 0), rows.length);
});

test('careSections: the fold boundary, and a missing day count sinks to Later', () => {
  const row = (days) => ({ status: { state: 'ok', days } });
  const at = (days) => careSections([row(days)], MAINTENANCE_UPCOMING_DAYS);
  assert.equal(at(MAINTENANCE_UPCOMING_DAYS).find((s) => s.key === 'upcoming').rows.length, 1);
  assert.equal(at(MAINTENANCE_UPCOMING_DAYS + 1).find((s) => s.key === 'later').rows.length, 1);
  assert.equal(at(null).find((s) => s.key === 'later').rows.length, 1);
  assert.deepEqual(careSections(null).map((s) => s.rows.length), [0, 0, 0, 0, 0]);
});

test('careSections: rows keep the order they arrived in (the urgency sort still rules)', () => {
  const row = (name, days) => ({ name, status: { state: 'ok', days } });
  const secs = careSections([row('a', 5), row('b', 1), row('c', 9)], 60);
  assert.deepEqual(secs.find((s) => s.key === 'upcoming').rows.map((r) => r.name), ['a', 'b', 'c']);
});

// ---- "Whose it is" moved off the reserved `owner` property (v117) -----------

test('looksLikeEmail: tells a sign-in address from a person’s name', () => {
  assert.equal(looksLikeEmail('martin.schabbauer@icloud.com'), true);
  assert.equal(looksLikeEmail('  a@b.co  '), true);
  assert.equal(looksLikeEmail('Martin'), false);
  assert.equal(looksLikeEmail('Anna & Martin'), false);
  assert.equal(looksLikeEmail('Shared'), false);
  assert.equal(looksLikeEmail(''), false);
  assert.equal(looksLikeEmail(null), false);
  assert.equal(looksLikeEmail('no-at-sign.com'), false);
});

test('ownerNameFromEmail: an address becomes the name a person would use', () => {
  assert.equal(ownerNameFromEmail('martin.schabbauer@icloud.com'), 'Martin');
  assert.equal(ownerNameFromEmail('anna@example.com'), 'Anna');
  assert.equal(ownerNameFromEmail('anna_b+tag@example.com'), 'Anna');
  // Too short to be a name on its own — keep the whole local part rather than "M".
  assert.equal(ownerNameFromEmail('m.schabbauer@icloud.com'), 'M.schabbauer');
  assert.equal(ownerNameFromEmail(''), '');
});

test('coerceItem: adopts a legacy owner name, but never the address sync stamped there', () => {
  // A real name typed before v117 is carried across.
  assert.equal(coerceItem({ name: 'Tent', owner: 'Anna' }).ownedBy, 'Anna');
  // The sync addon's own stamp is not a name and must not become one here — the
  // one-time migration in db.js is what turns it into "Martin".
  assert.equal(coerceItem({ name: 'Tent', owner: 'martin.schabbauer@icloud.com' }).ownedBy, '');
  // Once ownedBy exists it wins, including when deliberately empty.
  assert.equal(coerceItem({ name: 'Tent', owner: 'Anna', ownedBy: 'Martin' }).ownedBy, 'Martin');
  assert.equal(coerceItem({ name: 'Tent', owner: 'Anna', ownedBy: '' }).ownedBy, '');
});

test('INTRINSIC_FIELDS carries ownedBy and no longer the reserved owner', () => {
  assert.ok(INTRINSIC_FIELDS.includes('ownedBy'));
  assert.ok(!INTRINSIC_FIELDS.includes('owner'));
});

test('buildCatalog: the owner survives being rebuilt from a backup', () => {
  // Two copies of one item, as a pre-relational backup file holds them: the owner
  // is on one copy only and must not be lost when they are merged back into one.
  const list = coerceList({
    id: 'l1', name: 'Travel',
    items: [newItem({ name: 'Jacket', ownedBy: '' })],
  });
  const other = coerceList({
    id: 'l2', name: 'Hiking',
    items: [newItem({ name: 'Jacket', ownedBy: 'Anna' })],
  });
  const cat = buildCatalog([list, other]);
  const jacket = cat.items.find((i) => i.name === 'Jacket');
  assert.equal(jacket.ownedBy, 'Anna');
});


// ---- The editable, synced "When" timeline (v118) ----------------------------

// Every test here restores the factory seven afterwards: PHASES is a live list
// shared by the whole module, so leaving it edited would leak into other tests.
const withPhases = (list, fn) => {
  try { setPhases(list); return fn(); }
  finally { setPhases(DEFAULT_PHASES.map((p) => ({ ...p }))); }
};

test('setPhases: sorts by order, renumbers, and drops the unusable', () => {
  withPhases([
    { id: 'b', label: 'Second', order: 5 },
    { id: 'a', label: 'First', order: 1 },
    { id: '', label: 'No id', order: 2 },        // dropped
    { id: 'c', label: '', order: 3 },            // dropped
    { id: 'a', label: 'Duplicate id', order: 4 },// dropped
  ], () => {
    assert.deepEqual(PHASES.map((p) => p.id), ['a', 'b']);
    assert.deepEqual(PHASES.map((p) => p.order), [0, 1]);   // renumbered, so two devices agree
    assert.deepEqual(PHASE_IDS, ['a', 'b']);                // the ids list is kept in step
  });
});

test('setPhases: an empty list falls back to the factory seven, never to nothing', () => {
  withPhases([], () => {
    assert.equal(PHASES.length, DEFAULT_PHASES.length);
    assert.deepEqual(PHASES.map((p) => p.id), DEFAULT_PHASES.map((p) => p.id));
  });
});

test('coercePhase: fills in an emoji, a colour and a sane lead time', () => {
  const p = coercePhase({ id: 'x', label: 'X' }, 0);
  assert.ok(p.emoji);
  assert.match(p.color, /^#[0-9a-fA-F]{3,8}$/);
  assert.equal(p.leadDays, 0);
  assert.equal(p.task, false);
  assert.equal(coercePhase({ id: 'x', label: 'X', leadDays: 9999 }).leadDays, 365); // clamped
  assert.equal(coercePhase({ id: 'x', label: 'X', leadDays: -50 }).leadDays, -1);   // clamped
  assert.equal(coercePhase({ id: 'x', label: 'X', leadDays: 'soon' }).leadDays, 0);
});

test('newPhase: earns a readable id and never collides', () => {
  assert.equal(newPhase('Load the car', []).id, 'load-the-car');
  assert.equal(newPhase('Load the car', ['load-the-car']).id, 'load-the-car-2');
  assert.match(newPhase('!!!', []).id, /^phase-/);
});

test('the built-in phase ids are stable — two devices seeding must not double up', () => {
  // If these ever change, a device that seeds independently writes DIFFERENT
  // primary keys and the two lists merge into fourteen phases instead of seven.
  assert.deepEqual(DEFAULT_PHASES.map((p) => p.id),
    ['prep', 'week', 'daybefore', 'morning', 'door', 'wear', 'after']);
});

test('phaseOrFallback: an unknown id is shown, never swapped for a real phase', () => {
  const p = phaseOrFallback('a-phase-from-the-other-device');
  assert.equal(p.id, 'a-phase-from-the-other-device');
  assert.equal(p.label, 'a-phase-from-the-other-device');   // reads as itself rather than vanishing
  assert.ok(p.emoji);
  assert.equal(phaseLeadDays('nonsense'), 0);
  assert.ok(phaseEmoji('nonsense'));
});

test('phaseOrder: an unknown phase sorts to the END, not into the middle', () => {
  assert.equal(phaseOrder('prep'), 0);
  assert.equal(phaseOrder('unknown'), PHASE_IDS.length);
});

test('defaultPhaseId: a new item lands on the first phase you actually pack in', () => {
  assert.equal(defaultPhaseId(), 'week');           // 'prep' is a to-do phase, so it is skipped
  withPhases([{ id: 'only', label: 'Only', task: true, order: 0 }], () => {
    assert.equal(defaultPhaseId(), 'only');         // ...unless there is nothing else
  });
});

test('coerceItem: keeps a phase this device does not know (it syncs, so it is real)', () => {
  // The old behaviour reset anything unrecognised to "≥1 week ahead", which with an
  // editable+synced list would silently retag items the other device had just filed.
  assert.equal(coerceItem({ name: 'Tent', phase: 'load-the-car' }).phase, 'load-the-car');
  assert.equal(coerceItem({ name: 'Tent', phase: '  door  ' }).phase, 'door');
  assert.equal(coerceItem({ name: 'Tent' }).phase, defaultPhaseId());
  assert.equal(coerceItem({ name: 'Tent', phase: 42 }).phase, defaultPhaseId());
});

test('entriesByPhase: an unknown phase gets its own group at the end, not merged away', () => {
  const groups = entriesByPhase([
    { id: 'a', name: 'Towel', phase: 'week' },
    { id: 'b', name: 'Mystery', phase: 'from-the-mac' },
    { id: 'c', name: 'Keys', phase: 'door' },
  ]);
  assert.deepEqual(groups.map((g) => g.phase.id), ['week', 'door', 'from-the-mac']);
  assert.equal(groups.at(-1).entries.length, 1);
  // Nothing is lost, and nothing was quietly moved into "≥1 week ahead".
  assert.equal(groups.reduce((n, g) => n + g.entries.length, 0), 3);
});

test('phasesCustomised: true only once the list really differs from the standard seven', () => {
  assert.equal(phasesCustomised(), false);
  withPhases(DEFAULT_PHASES.map((p, i) => (i === 3 ? { ...p, label: 'The morning of' } : { ...p })), () => {
    assert.equal(phasesCustomised(), true);
  });
  withPhases(DEFAULT_PHASES.map((p) => ({ ...p, emoji: '🧳' })), () => {
    assert.equal(phasesCustomised(), true);
  });
});

test('setPhases: a tie on order is broken deterministically, so two devices agree', () => {
  // Two phases sharing an order is not hypothetical — an added phase is appended
  // at the end, and both devices may append. Without a stable second key each
  // device would renumber them in whatever order it read them, then write that
  // back and fight the other one.
  const a = [{ id: 'zulu', label: 'Z', order: 6 }, { id: 'alpha', label: 'A', order: 6 }];
  const b = [{ id: 'alpha', label: 'A', order: 6 }, { id: 'zulu', label: 'Z', order: 6 }];
  const orderOf = (list) => { setPhases(list); return PHASES.map((p) => p.id); };
  try {
    assert.deepEqual(orderOf(a), orderOf(b));
    assert.deepEqual(orderOf(a), ['alpha', 'zulu']);
  } finally { setPhases(DEFAULT_PHASES.map((p) => ({ ...p }))); }
});

// --- The five shared Settings lists (v120) ----------------------------------

test('sharedRowId: two devices adding the same name land on the same key', () => {
  // The whole reason ids are built from the name rather than generated: this is
  // what makes two devices MERGE a list instead of doubling it.
  assert.equal(sharedRowId('places', 'Garage shelf'), sharedRowId('places', '  garage   SHELF '));
  assert.equal(sharedRowId('places', 'Garage shelf'), 'places:garage shelf');
  assert.notEqual(sharedRowId('places', 'Garage'), sharedRowId('owners', 'Garage'));
});

test('conditions: a round trip keeps the id items are stamped with, verbatim', () => {
  const list = [
    { id: 'good', label: 'Good', tone: '', replace: false },
    { id: 'borrowed-from-anna', label: 'Borrowed', tone: 'warn', replace: false },
    { id: 'failing', label: 'Failing', tone: 'danger', replace: true },
  ];
  const back = conditionsFromRows(conditionsToRows(list));
  assert.deepEqual(back, list);
  // The id survives even when the key had to be normalised to build the row.
  const odd = conditionsFromRows(conditionsToRows([{ id: 'Mixed Case', label: 'Odd' }]));
  assert.equal(odd[0].id, 'Mixed Case');
});

test('conditions: order survives, and a tie on order is broken deterministically', () => {
  const list = [{ id: 'c', label: 'C' }, { id: 'a', label: 'A' }, { id: 'b', label: 'B' }];
  assert.deepEqual(conditionsFromRows(conditionsToRows(list)).map((c) => c.label), ['C', 'A', 'B']);
  // Both devices appended, so both rows claim the same order. Without the id
  // tiebreak each device would settle it differently and then fight.
  const tied = [
    { kind: 'conditions', key: 'zulu', name: 'Z', order: 4, data: { cid: 'zulu' } },
    { kind: 'conditions', key: 'alpha', name: 'A', order: 4, data: { cid: 'alpha' } },
  ];
  assert.deepEqual(conditionsFromRows(tied).map((c) => c.id), ['alpha', 'zulu']);
  assert.deepEqual(conditionsFromRows(tied.slice().reverse()).map((c) => c.id), ['alpha', 'zulu']);
});

test('people: a round trip keeps the colour, and the id is the same on both devices', () => {
  const people = [{ id: 'whatever-local-id', name: 'Anna', color: '#a855f7' }];
  const back = peopleFromRows(peopleToRows(people));
  assert.equal(back[0].name, 'Anna');
  assert.equal(back[0].color, '#a855f7');
  assert.equal(back[0].id, 'people:anna');   // derived from the name, not generated
});

test('people: the same name twice collapses to one row rather than doubling', () => {
  const rows = peopleToRows([{ name: 'Anna', color: '#a855f7' }, { name: ' anna ', color: '#22c55e' }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].data.color, '#a855f7');   // first spelling and first colour win
});

test('owners & places: names round-trip, de-duplicate case-insensitively, sort A–Z', () => {
  const rows = namesToRows('places', ['Garage', 'garage', 'Attic', '  ', 'RV / camper']);
  assert.equal(rows.length, 3);
  assert.deepEqual(namesFromRows(rows, 'places'), ['Attic', 'Garage', 'RV / camper']);
  // Rows of another kind are never picked up by mistake.
  assert.deepEqual(namesFromRows([...rows, ...namesToRows('owners', ['Martin'])], 'owners'), ['Martin']);
});

test('presets: re-saving under a name you already used replaces it, never doubles it', () => {
  const a = presetsToRows([{ name: 'Golf weekend', config: { mode: 'trip', season: 'Summer' } }]);
  const b = presetsToRows([{ name: 'golf  Weekend', config: { mode: 'quick' } }]);
  assert.equal(a[0].id, b[0].id);
  const back = presetsFromRows(b);
  assert.equal(back[0].name, 'golf  Weekend');
  assert.deepEqual(back[0].config, { mode: 'quick' });
  // A preset with no config is not a preset — it is dropped rather than shown empty.
  assert.deepEqual(presetsFromRows(presetsToRows([{ name: 'Broken' }])), []);
});

test('sharedRowsOfKind: rows of other lists are never mixed in', () => {
  const rows = [...namesToRows('places', ['Attic']), ...namesToRows('owners', ['Martin']),
    ...peopleToRows([{ name: 'Anna' }])];
  assert.deepEqual(sharedRowsOfKind(rows, 'places').map((r) => r.name), ['Attic']);
  assert.deepEqual(sharedRowsOfKind(rows, 'people').map((r) => r.name), ['Anna']);
  assert.deepEqual(sharedRowsOfKind(rows, 'presets'), []);
});

test('coerceSharedRow: a row from an unknown list, or with junk in it, is dropped', () => {
  assert.equal(coerceSharedRow({ kind: 'nonsense', key: 'x', name: 'X' }).kind, '');
  assert.deepEqual(coerceSharedRow({ kind: 'places', key: 'a', name: 'A', data: 'not an object' }).data, {});
  assert.equal(sharedRowsOfKind([{ kind: 'places', key: '', name: '' }], 'places').length, 0);
});

test('isFactoryList: the defaults are recognised so they are never written as data', () => {
  // This is the guard that keeps v118 from happening again: a list that is still
  // exactly what the app ships is not data, and must never reach shared storage.
  for (const kind of ['conditions', 'people', 'places']) {
    assert.equal(isFactoryList(kind, defaultListFor(kind)), true, kind);
  }
  assert.equal(isFactoryList('places', [...DEFAULT_STORAGE_LOCATIONS, 'Boat locker']), false);
  assert.equal(isFactoryList('people', DEFAULT_PEOPLE.map((p) => ({ ...p, color: '#123456' }))), false);
  assert.equal(isFactoryList('people', [{ name: 'Martin' }, { name: 'Bengt' }]), false);
  assert.equal(isFactoryList('conditions', DEFAULT_ITEM_CONDITIONS.map((c) => ({ ...c, label: c.label.toUpperCase() }))), false);
  // Presets and owners have no factory version, so nothing is ever "just default".
  assert.equal(isFactoryList('presets', []), false);
  assert.equal(isFactoryList('owners', ['Martin']), false);
});

test('sharedRowsFrom: every kind builds rows, and an unknown kind builds none', () => {
  for (const kind of SHARED_KINDS) {
    const rows = sharedRowsFrom(kind, defaultListFor(kind).length ? defaultListFor(kind)
      : (kind === 'presets' ? [{ name: 'P', config: {} }] : ['Someone']));
    assert.ok(rows.length, kind);
    assert.ok(rows.every((r) => r.kind === kind && r.id.startsWith(`${kind}:`)), kind);
  }
  assert.deepEqual(sharedRowsFrom('phases', [{ id: 'x', label: 'X' }]), []);
});

// ---------- v125: the trip date picker's calendar ----------

test('monthKey: a real date gives its month, anything else gives nothing', () => {
  assert.equal(monthKey('2026-09-12'), '2026-09');
  assert.equal(monthKey('2026-09-12T10:00:00Z'), '2026-09');
  assert.equal(monthKey(''), '');
  assert.equal(monthKey('not a date'), '');
  assert.equal(monthKey('2026-13-01'), '');   // month 13 is not a month
});

test('shiftMonth: steps months and rolls the year over both ways', () => {
  assert.equal(shiftMonth('2026-09', 1), '2026-10');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-06', 0), '2026-06');
  assert.equal(shiftMonth('2026-01', -13), '2024-12');
  assert.equal(shiftMonth('nonsense', 1), '');
});

test('monthGrid: always 42 cells, starting on the chosen weekday, in UTC', () => {
  // 1 Sept 2026 is a Tuesday, so a Monday-first grid leads with 31 August.
  const g = monthGrid('2026-09', 1);
  assert.equal(g.days.length, 42);
  assert.equal(g.days[0].iso, '2026-08-31');
  assert.equal(g.days[0].inMonth, false);
  assert.equal(g.days[1].iso, '2026-09-01');
  assert.equal(g.days[1].inMonth, true);
  assert.equal(g.days.filter((d) => d.inMonth).length, 30);
  // Sunday-first shifts the whole grid one day earlier.
  assert.equal(monthGrid('2026-09', 0).days[0].iso, '2026-08-30');
  // Every cell is exactly one day after the last — no gaps, no repeats, and no
  // daylight-saving hiccup, which is the whole reason this is UTC arithmetic.
  for (let i = 1; i < g.days.length; i += 1) {
    const step = Date.parse(`${g.days[i].iso}T00:00:00Z`) - Date.parse(`${g.days[i - 1].iso}T00:00:00Z`);
    assert.equal(step, 86400000, `${g.days[i - 1].iso} -> ${g.days[i].iso}`);
  }
  assert.deepEqual(monthGrid('rubbish').days, []);
});

test('monthGrid: a month starting exactly on the week start needs no lead-in', () => {
  // 1 June 2026 is a Monday.
  assert.equal(monthGrid('2026-06', 1).days[0].iso, '2026-06-01');
  // February in a leap year still fills 42 cells.
  assert.equal(monthGrid('2028-02', 1).days.filter((d) => d.inMonth).length, 29);
});

test('rangeCellState: paints the two ends, the days between, and nothing else', () => {
  assert.equal(rangeCellState('2026-09-12', '2026-09-12', '2026-09-19'), 'start');
  assert.equal(rangeCellState('2026-09-19', '2026-09-12', '2026-09-19'), 'end');
  assert.equal(rangeCellState('2026-09-15', '2026-09-12', '2026-09-19'), 'between');
  assert.equal(rangeCellState('2026-09-20', '2026-09-12', '2026-09-19'), '');
  assert.equal(rangeCellState('2026-09-11', '2026-09-12', '2026-09-19'), '');
  // A start with no end yet, and a same-day trip, are both a single round cell —
  // 'start' would draw a flat right edge leading into a range that isn't there.
  assert.equal(rangeCellState('2026-09-12', '2026-09-12', ''), 'only');
  assert.equal(rangeCellState('2026-09-12', '2026-09-12', '2026-09-12'), 'only');
  assert.equal(rangeCellState('2026-09-13', '2026-09-12', ''), '');
  assert.equal(rangeCellState('2026-09-12', '', ''), '');
});

test('orderRange: two taps become a trip, whichever order they came in', () => {
  assert.deepEqual(orderRange('2026-09-12', '2026-09-19'), ['2026-09-12', '2026-09-19']);
  // Tapping an earlier day second is a correction, not an error.
  assert.deepEqual(orderRange('2026-09-19', '2026-09-12'), ['2026-09-12', '2026-09-19']);
  assert.deepEqual(orderRange('2026-09-12', '2026-09-12'), ['2026-09-12', '2026-09-12']);
  assert.deepEqual(orderRange('2026-09-12', ''), ['2026-09-12', '']);
  assert.deepEqual(orderRange('', '2026-09-12'), ['2026-09-12', '']);
  assert.deepEqual(orderRange('', ''), ['', '']);
});

test('the picker and nightsBetween agree on what a range means', () => {
  const [a, b] = orderRange('2026-09-19', '2026-09-12');
  assert.equal(nightsBetween(a, b), 7);
  assert.equal(nightsBetween(...orderRange('2026-09-12', '2026-09-12')), 0);
});

// ---------- v125: list ordering in Settings ----------

test('orderedNamesFromRows: storage places keep the order they are stored in', () => {
  const rows = namesToRows('places', ['Garage', 'Bedroom wardrobe', 'Loft / attic']);
  // The A–Z reader is unchanged — the Owner dropdowns still rely on it.
  assert.deepEqual(namesFromRows(rows, 'places'), ['Bedroom wardrobe', 'Garage', 'Loft / attic']);
  // The ordered reader hands back what was written, which is what the ▲▼ set.
  assert.deepEqual(orderedNamesFromRows(rows, 'places'), ['Garage', 'Bedroom wardrobe', 'Loft / attic']);
  assert.deepEqual(orderedNamesFromRows(rows, 'owners'), []);
});

test('orderedNamesFromRows: two devices appending at the same order still agree', () => {
  // Both devices append, so two rows genuinely can share an `order`; the id
  // tiebreak in sharedRowsOfKind is what stops them being sorted differently on
  // each device and then written back at each other.
  const rows = [
    { kind: 'places', key: 'shed', name: 'Shed', order: 3 },
    { kind: 'places', key: 'boat locker', name: 'Boat locker', order: 3 },
    { kind: 'places', key: 'garage', name: 'Garage', order: 1 },
  ];
  assert.deepEqual(orderedNamesFromRows(rows, 'places'), ['Garage', 'Boat locker', 'Shed']);
  assert.deepEqual(orderedNamesFromRows([...rows].reverse(), 'places'), ['Garage', 'Boat locker', 'Shed']);
});

test('ownersByUsage: the biggest owner comes first, ties settle A–Z', () => {
  const counts = new Map([['martin', 300], ['anna', 120], ['shared', 120], ['the kids', 0]]);
  assert.deepEqual(
    ownersByUsage(['The kids', 'Shared', 'Anna', 'Martin'], counts),
    ['Martin', 'Anna', 'Shared', 'The kids'],
  );
  // A name nobody owns anything under still appears — it just sinks.
  assert.deepEqual(ownersByUsage(['Bengt', 'Martin'], counts), ['Martin', 'Bengt']);
  // Counts are matched case-insensitively, the same way the roster de-duplicates.
  assert.deepEqual(ownersByUsage(['anna', 'MARTIN'], counts), ['MARTIN', 'anna']);
  // No counts at all is simply A–Z, so an empty catalogue reads sensibly.
  assert.deepEqual(ownersByUsage(['Shared', 'Anna'], new Map()), ['Anna', 'Shared']);
  assert.deepEqual(ownersByUsage([], counts), []);
  // A plain object works as well as a Map — the helper shouldn't care.
  assert.deepEqual(ownersByUsage(['Anna', 'Martin'], { martin: 5, anna: 1 }), ['Martin', 'Anna']);
});
