// db.js — on-device persistence via IndexedDB.
//
// ENDEAVOUR 2 storage model (relational): instead of copying an item into every
// template, an item lives ONCE in the `items` catalog and templates reference it
// through `memberships`. The three building-block stores are:
//   • items        — the canonical catalog (the thing itself)
//   • memberships  — item ↔ template links, holding conditions + overrides + order
//   • templates    — the reusable lists, minus their inline items
// Plus `events` (each event still carries its own materialised trip entries).
//
// The public API is UNCHANGED from the old copy-based version: getLists()/getList()
// RESOLVE the catalog back into today's list-with-items shape, and saveList()/
// deleteList() DECOMPOSE an edited list back into shared items + memberships. So the
// rest of the app keeps working exactly as before while the storage underneath is
// relational. All data stays on this device; export/import moves it as JSON/CSV/Excel.
import {
  coerceList, coerceEvent, coerceItem, coerceMembership, coerceAction, normName,
  resolveMembership, buildCatalog, applyIntrinsic, catalogItemFromResolved, membershipFromResolved,
  buildTripBundle, parseTripBundle, sortEventsForList,
} from './model.js';
import { seedLists } from './seed.js';

const DB_NAME = 'ams-packing-list';
const DB_VERSION = 3;               // v3: adds the `actions` store (to-dos); v2: relational stores
const ITEMS = 'items';
const MEMBERSHIPS = 'memberships';
const TEMPLATES = 'templates';
const EVENTS = 'events';
const ACTIONS = 'actions';          // standalone to-do store (tied-to-item or loose)
const LISTS = 'lists';              // legacy v1 store — read once to migrate, then ignored
// Bump when the built-in seed data changes, to refresh the built-in templates on next load.
const SEED_VERSION = 11;            // v11: seeded Containers catalogue; v10: Diving pre-filled with sections; v9: storage in the relational catalog
const SEED_KEY = 'ams-seed-version';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Additive migrations — existing data (incl. the legacy `lists` store) is preserved.
      if (!db.objectStoreNames.contains(LISTS)) db.createObjectStore(LISTS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(EVENTS)) db.createObjectStore(EVENTS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(ITEMS)) db.createObjectStore(ITEMS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(MEMBERSHIPS)) db.createObjectStore(MEMBERSHIPS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(TEMPLATES)) db.createObjectStore(TEMPLATES, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(ACTIONS)) db.createObjectStore(ACTIONS, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// --- Low-level promise helpers ---
function reqP(req) { return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); }); }
function txP(tx) { return new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); }); }

async function getAllRaw(store) {
  const db = await open();
  return reqP(db.transaction(store, 'readonly').objectStore(store).getAll());
}
async function getOneRaw(store, key) {
  const db = await open();
  return reqP(db.transaction(store, 'readonly').objectStore(store).get(key));
}
async function putOne(store, value) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  await txP(tx);
  return value;
}
async function delOne(store, key) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  return txP(tx);
}
// Apply a set of puts ({store,value}) and deletes ({store,key}) in ONE transaction.
async function writeBatch(puts = [], dels = []) {
  const stores = [...new Set([...puts, ...dels].map((o) => o.store))];
  if (!stores.length) return;
  const db = await open();
  const tx = db.transaction(stores, 'readwrite');
  for (const p of puts) tx.objectStore(p.store).put(p.value);
  for (const d of dels) tx.objectStore(d.store).delete(d.key);
  return txP(tx);
}

// --- Catalog read + resolve ---

async function loadCatalog() {
  const [items, mems, tmpls] = await Promise.all([
    getAllRaw(ITEMS).then((a) => (a || []).map(coerceItem)),
    getAllRaw(MEMBERSHIPS).then((a) => (a || []).map(coerceMembership)),
    getAllRaw(TEMPLATES).then((a) => (a || []).map(coerceList)),
  ]);
  return { items, mems, tmpls };
}

// Rebuild one template into today's list-with-items shape. Each resolved item
// carries hidden `_itemId` / `_memId` links so saveList can decompose it back.
function resolveOne(template, itemsById, mems) {
  const mine = mems
    .filter((m) => m.templateId === template.id)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  const items = [];
  for (const m of mine) {
    const item = itemsById.get(m.itemId);
    if (!item) continue;
    const r = resolveMembership(item, m);
    r._itemId = item.id;
    r._memId = m.id;
    items.push(r);
  }
  return coerceList({ ...template, items });
}

// --- Templates (building-block "lists") — public API preserved ---

export async function getLists() {
  const { items, mems, tmpls } = await loadCatalog();
  const byId = new Map(items.map((i) => [i.id, i]));
  return tmpls
    .map((t) => resolveOne(t, byId, mems))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

export async function getList(id) {
  const { items, mems, tmpls } = await loadCatalog();
  const t = tmpls.find((x) => x.id === id);
  if (!t) return null;
  const byId = new Map(items.map((i) => [i.id, i]));
  return resolveOne(t, byId, mems);
}

// Decompose an edited (resolved) list back into the shared catalog + memberships.
// Intrinsic edits flow to the shared item; container/phase/conditions/qty/note flow
// to the membership (as overrides). Removed items drop their membership; a catalog
// item referenced by no template is cleaned up.
export async function saveList(list) {
  const { items, mems } = await loadCatalog();
  const itemsById = new Map(items.map((i) => [i.id, i]));
  const itemByName = new Map();
  for (const i of items) if (!itemByName.has(normName(i.name))) itemByName.set(normName(i.name), i);
  const memById = new Map(mems.map((m) => [m.id, m]));

  const putItems = new Map();   // id -> catalog item (deduped)
  const putMems = [];
  const presentMemIds = new Set();
  let order = 0;

  for (const it of (list.items || [])) {
    if (!String(it.name || '').trim()) continue;
    // Resolve which catalog item this is: by link, else by name, else brand new.
    let cat = null;
    if (it._itemId && itemsById.has(it._itemId)) cat = itemsById.get(it._itemId);
    else if (itemByName.has(normName(it.name))) cat = itemByName.get(normName(it.name));
    if (cat) {
      applyIntrinsic(cat, it);                 // propagate edits to the shared thing
    } else {
      cat = catalogItemFromResolved(it);       // a new item added in this template
      itemsById.set(cat.id, cat);
      itemByName.set(normName(cat.name), cat);
    }
    putItems.set(cat.id, cat);
    // Reuse the existing membership when we can (keeps its id stable), else make one.
    let existing = null;
    if (it._memId && memById.has(it._memId) && memById.get(it._memId).templateId === list.id) existing = memById.get(it._memId);
    else existing = mems.find((m) => m.templateId === list.id && m.itemId === cat.id) || null;
    const m = membershipFromResolved(cat, list.id, it, order++, existing);
    putMems.push(m);
    presentMemIds.add(m.id);
  }

  // Memberships of THIS template that are no longer present -> delete.
  const delMems = mems.filter((m) => m.templateId === list.id && !presentMemIds.has(m.id)).map((m) => m.id);
  // Orphan catalog items: referenced by no membership after this change.
  const finalMems = mems.filter((m) => m.templateId !== list.id).concat(putMems);
  const referenced = new Set(finalMems.map((m) => m.itemId));
  const delItems = [];
  for (const i of itemsById.values()) if (!referenced.has(i.id)) { delItems.push(i.id); putItems.delete(i.id); }

  const template = coerceList({ ...list, items: [] });
  template.updatedAt = new Date().toISOString();

  const puts = [
    { store: TEMPLATES, value: template },
    ...[...putItems.values()].map((v) => ({ store: ITEMS, value: v })),
    ...putMems.map((v) => ({ store: MEMBERSHIPS, value: v })),
  ];
  const dels = [
    ...delMems.map((k) => ({ store: MEMBERSHIPS, key: k })),
    ...delItems.map((k) => ({ store: ITEMS, key: k })),
  ];
  await writeBatch(puts, dels);
  return list;
}

export async function deleteList(id) {
  const { items, mems } = await loadCatalog();
  const delMemIds = mems.filter((m) => m.templateId === id).map((m) => m.id);
  const finalMems = mems.filter((m) => m.templateId !== id);
  const referenced = new Set(finalMems.map((m) => m.itemId));
  const delItemIds = items.filter((i) => !referenced.has(i.id)).map((i) => i.id);
  const dels = [
    { store: TEMPLATES, key: id },
    ...delMemIds.map((k) => ({ store: MEMBERSHIPS, key: k })),
    ...delItemIds.map((k) => ({ store: ITEMS, key: k })),
  ];
  await writeBatch([], dels);
}

// --- Events (unchanged) ---

export async function getEvents() {
  const raw = await getAllRaw(EVENTS);
  return sortEventsForList((raw || []).map(coerceEvent));
}
export function getEvent(id) { return getOneRaw(EVENTS, id).then((e) => (e ? coerceEvent(e) : null)); }
export function saveEvent(event) { event.updatedAt = new Date().toISOString(); return putOne(EVENTS, event); }
export function deleteEvent(id) { return delOne(EVENTS, id); }

// --- Actions (to-dos) — a flat store, like events ---

export async function getActions() {
  const raw = await getAllRaw(ACTIONS);
  return (raw || []).map(coerceAction);
}
export async function getActionsForItem(itemId) {
  if (!itemId) return [];
  return (await getActions()).filter((a) => a.itemId === itemId);
}
export function saveAction(action) {
  const a = coerceAction({ ...action });
  a.updatedAt = new Date().toISOString();
  return putOne(ACTIONS, a);
}
export function deleteAction(id) { return delOne(ACTIONS, id); }
// Reconcile the stored actions for one item to match `wanted` (used by the item
// editor, which buffers its action edits and commits them on Save). Deletes the
// item's actions that are no longer wanted, then writes the current set.
export async function replaceItemActions(itemId, itemName, wanted) {
  if (!itemId) return;
  const existing = await getActionsForItem(itemId);
  const keep = new Set((wanted || []).map((a) => a.id));
  const puts = (wanted || []).map((a) => ({ store: ACTIONS, value: coerceAction({ ...a, itemId, itemName, updatedAt: new Date().toISOString() }) }));
  const dels = existing.filter((a) => !keep.has(a.id)).map((a) => ({ store: ACTIONS, key: a.id }));
  await writeBatch(puts, dels);
}

// The raw catalog items (the shared "thing itself" records), for screens that
// need every item once — e.g. the central Actions list resolving item names,
// and its "tie to an item" picker.
export async function getCatalogItems() {
  const raw = await getAllRaw(ITEMS);
  return (raw || []).map(coerceItem);
}

// --- Catalog write helpers (seed / migrate / reseed) ---

async function replaceCatalog(catalog) {
  const db = await open();
  const tx = db.transaction([ITEMS, MEMBERSHIPS, TEMPLATES], 'readwrite');
  tx.objectStore(ITEMS).clear();
  tx.objectStore(MEMBERSHIPS).clear();
  tx.objectStore(TEMPLATES).clear();
  for (const i of catalog.items) tx.objectStore(ITEMS).put(i);
  for (const m of catalog.memberships) tx.objectStore(MEMBERSHIPS).put(m);
  for (const t of catalog.templates) tx.objectStore(TEMPLATES).put(coerceList({ ...t, items: [] }));
  return txP(tx);
}

// Refresh built-in templates from the seed while preserving user-created templates,
// their memberships and the catalog items only they reference.
async function reseedBuiltins() {
  const { items, mems, tmpls } = await loadCatalog();
  const userTmpls = tmpls.filter((t) => !t.builtin);
  const userTmplIds = new Set(userTmpls.map((t) => t.id));
  const userMems = mems.filter((m) => userTmplIds.has(m.templateId));
  const usedItemIds = new Set(userMems.map((m) => m.itemId));
  const userItems = items.filter((i) => usedItemIds.has(i.id));
  const fresh = buildCatalog(seedLists()); // all built-in
  await replaceCatalog({
    items: [...fresh.items, ...userItems],
    memberships: [...fresh.memberships, ...userMems],
    templates: [...fresh.templates, ...userTmpls],
  });
}

// --- First-run seeding + one-time migration from the legacy `lists` store ---
export async function ensureSeeded() {
  const tmpls = await getAllRaw(TEMPLATES);
  let seededVersion = 0;
  try { seededVersion = Number(localStorage.getItem(SEED_KEY)) || 0; } catch { /* ignore */ }

  if (!tmpls || !tmpls.length) {
    // Migrate existing v1 copy-based lists if present; otherwise seed fresh.
    const legacy = (await getAllRaw(LISTS).catch(() => [])) || [];
    const source = legacy.length ? legacy.map(coerceList) : seedLists();
    await replaceCatalog(buildCatalog(source));
  } else if (seededVersion < SEED_VERSION) {
    await reseedBuiltins();
  }
  try { localStorage.setItem(SEED_KEY, String(SEED_VERSION)); } catch { /* ignore */ }
  return getLists();
}

// --- Backup (Export / Import) ---
// Backups keep the familiar { lists, events } shape (resolved lists), so files
// stay compatible across the storage change: import simply decomposes them back.

// `extra` lets the caller fold in data that lives outside IndexedDB (e.g. the
// small localStorage preferences like custom storage places), so a JSON backup
// is a complete restore point. Photos/care/all item detail are already inside
// `lists` because getLists() resolves the full item shape.
export async function exportJSON(extra = {}) {
  const [lists, events, actions] = await Promise.all([getLists(), getEvents(), getActions()]);
  return JSON.stringify(
    { app: 'ams-packing-list', version: 1, exportedAt: new Date().toISOString(), lists, events, actions, ...extra },
    null, 2,
  );
}

export async function importJSON(text, { merge = false } = {}) {
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || (!Array.isArray(data.lists) && !Array.isArray(data.events))) {
    throw new Error('This file does not look like an AMS Packing List backup.');
  }
  const lists = Array.isArray(data.lists) ? data.lists.map(coerceList) : [];
  const events = Array.isArray(data.events) ? data.events.map(coerceEvent) : [];
  const actions = Array.isArray(data.actions) ? data.actions.map(coerceAction) : [];
  if (!merge) {
    // Replace: rebuild the catalog from the imported lists in one shot.
    await replaceCatalog(buildCatalog(lists));
    const db = await open();
    const tx = db.transaction([EVENTS, ACTIONS], 'readwrite');
    tx.objectStore(EVENTS).clear();
    for (const e of events) tx.objectStore(EVENTS).put(e);
    tx.objectStore(ACTIONS).clear();
    for (const a of actions) tx.objectStore(ACTIONS).put(a);
    await txP(tx);
  } else {
    // Merge: decompose each imported list into the existing catalog, add events + actions.
    for (const l of lists) await saveList(l);
    if (events.length || actions.length) {
      const db = await open();
      const tx = db.transaction([EVENTS, ACTIONS], 'readwrite');
      for (const e of events) tx.objectStore(EVENTS).put(e);
      for (const a of actions) tx.objectStore(ACTIONS).put(a);
      await txP(tx);
    }
  }
  return { lists: lists.length, events: events.length, actions: actions.length, prefs: (data.prefs && typeof data.prefs === 'object') ? data.prefs : null };
}

// --- Trip sharing (one event, backend-free) ---

export async function exportTrip(eventId) {
  const event = await getEvent(eventId);
  if (!event) throw new Error('Trip not found.');
  return JSON.stringify(buildTripBundle(event));
}

export async function importTrip(data) {
  const event = parseTripBundle(data);
  await saveEvent(event);
  return event;
}
