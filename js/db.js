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
  coerceList, coerceEvent, coerceItem, coerceMembership, coerceAction, coerceKit, normName,
  resolveMembership, buildCatalog, applyIntrinsic, catalogItemFromResolved, membershipFromResolved,
  buildTripBundle, parseTripBundle, sortEventsForList, backupCounts, backupShrinks,
  id as newId, isPhotoRef, inlinePhotos, looksLikeEmail, ownerNameFromEmail,
  DEFAULT_PHASES, PHASES, coercePhase, setPhases,
  SHARED_KINDS, coerceSharedRow, sharedRowsOfKind, sharedRowsFrom, isFactoryList,
  templateDefaults, containerDefaultsFrom, planContainerMigration,
} from './model.js';
import { seedLists } from './seed.js';
import { Dexie, dexieCloud } from './vendor/dexie-cloud.mjs';
import { CLOUD, UNSYNCED_TABLES, syncEnabled } from './cloud-config.js';

const DB_NAME = 'ams-packing-list';
// Dexie multiplies this by ten to get the IndexedDB version, so 1 → 10. The
// hand-built database went up to 6; adopting it is therefore a normal upgrade.
// Bump this (not the old DB_VERSION) when the SCHEMA below changes.
// v2 (v118): adds the `phases` store — purely additive, so nothing is rebuilt.
// v3 (v120): adds the `shared` store (the five author-made Settings lists) —
// also purely additive.
const DEXIE_VERSION = 3;
const ITEMS = 'items';
const MEMBERSHIPS = 'memberships';
const TEMPLATES = 'templates';
const EVENTS = 'events';
const ACTIONS = 'actions';          // standalone to-do store (tied-to-item or loose)
const KITS = 'kits';                // reusable bundles of items always packed together
const PHASES_STORE = 'phases';      // the editable "When" timeline — SYNCED, unlike the other lists
const SHARED = 'shared';            // the five lists you AUTHOR (conditions, presets, people, owners, places) — SYNCED
const SNAPSHOTS = 'snapshots';      // automatic on-device backup snapshots (a ring buffer)
const PHOTOS = 'photos';            // item images, held once and referenced by id from items
const LISTS = 'lists';              // legacy v1 store — read once to migrate, then ignored
const MAX_SNAPSHOTS = 8;            // how many automatic snapshots to keep (plus the richest is never evicted)
// Bump when the built-in seed data changes, to refresh the built-in templates on next load.
const SEED_VERSION = 16;            // v16: rain-tagged Rain jacket in Hiking; v15: cold-tagged Insulated gloves/beanie + Balaclava in Hiking; v14: cold-tagged Warm gloves/beanie/hat in Travel base (for the Force-pack Cold toggle); v13: storage place on every item; v12: weights on every item; v11: seeded Containers catalogue
const SEED_KEY = 'ams-seed-version';

// Every store keyed by a plain `id` string — no secondary indexes, which matches
// exactly how these stores were created by hand before Dexie. Declaring ALL of
// them (including the legacy `lists` store) matters: Dexie DELETES any object
// store missing from the schema when it upgrades.
const SCHEMA = {
  [LISTS]: 'id',
  [EVENTS]: 'id',
  [ITEMS]: 'id',
  [MEMBERSHIPS]: 'id',
  [TEMPLATES]: 'id',
  [ACTIONS]: 'id',
  [KITS]: 'id',
  [PHASES_STORE]: 'id',
  [SHARED]: 'id',
  [SNAPSHOTS]: 'id',
  [PHOTOS]: 'id',
};

let _db = null;
// Opens (and on first run, adopts) the database. Dexie can take over a database
// created by hand — which is what this one is — as long as the schema it declares
// matches the stores already there. It multiplies its own version by ten, so
// DEXIE_VERSION 1 means IndexedDB version 10; the hand-built database stopped at
// 6, so the first open with this build is a plain additive upgrade that creates
// nothing and drops nothing.
//
// The cloud addon is attached ONLY when a database URL is configured. With none —
// which is the shipped default — this is byte-for-byte the offline-only database
// of the previous release: no addon, no network, nothing leaving the device.
function open() {
  if (_db) return _db.isOpen() ? Promise.resolve(_db) : _db.open().then(() => _db);
  const cloud = syncEnabled();
  const d = cloud ? new Dexie(DB_NAME, { addons: [dexieCloud] }) : new Dexie(DB_NAME);
  d.version(DEXIE_VERSION).stores(SCHEMA);
  if (cloud) {
    d.cloud.configure({
      databaseUrl: CLOUD.databaseUrl,
      // The app must stay fully usable without an account: everything works
      // offline and locally, and signing in is what starts sharing it between
      // devices — never a gate in front of your own data.
      requireAuth: false,
      unsyncedTables: UNSYNCED_TABLES,
      // CRITICAL. The addon otherwise renames the local database to
      // `<name>-<cloud db id>`, which would silently open a BRAND NEW, EMPTY
      // database and leave every existing item, trip, to-do and kit stranded in
      // the original one — looking, from the app, exactly like total data loss.
      // This app has one cloud database and a local database that predates it by
      // a hundred releases, so the name must not move.
      nameSuffix: false,
    });
  }
  _db = d;
  return d.open().then(() => d);
}

// Is this build wired to a cloud database at all? (False in the shipped default.)
export const cloudConfigured = () => syncEnabled();

// A snapshot of the sync state for the Settings screen: whether sync is switched
// on, who is signed in, and what the connection is doing. Safe to call when sync
// is off — it simply reports that.
export async function syncStatus() {
  if (!syncEnabled()) return { enabled: false, signedIn: false, user: '', state: 'off' };
  const db = await open();
  const user = db.cloud.currentUser?.value || null;
  return {
    enabled: true,
    signedIn: !!(user && user.isLoggedIn),
    user: (user && (user.email || user.userId)) || '',
    state: db.cloud.syncState?.value?.phase || 'unknown',
  };
}

// Start the e-mail sign-in flow (Dexie Cloud sends a one-time code).
export async function signIn() {
  if (!syncEnabled()) throw new Error('Syncing is not switched on in this build.');
  const db = await open();
  return db.cloud.login();
}

// Wipe this device and take the account's copy instead.
//
// For a device that holds the wrong catalogue — a starter set it seeded before
// it ever synced, say — and should simply take what the account has.
//
// The ORDER is the important part: sign out FIRST, so this device is no longer
// syncing, and only then delete the local database. Clearing data while still
// connected would be read as "the user deleted all of this" and dutifully
// replicated to every other device. Signing out first makes it a purely local act.
const AWAITING_CLOUD_KEY = 'ams-awaiting-cloud';
function logResetFailure(err) { try { console.error('AMS Packing: reset failed', err); } catch { /* ignore */ } }
export async function resetFromCloud() {
  if (!syncEnabled()) throw new Error('Syncing is not switched on in this build.');
  // Set BEFORE the wipe. After the reload this device is empty AND signed out,
  // which is exactly the shape `ensureSeeded()` treats as "brand-new user, give
  // them the starter templates" — and seeding here would rebuild the very
  // catalogue we just deleted, ready to be pushed up as duplicates the moment
  // they sign in. The flag says: this emptiness is deliberate, wait for the sync.
  try { localStorage.setItem(AWAITING_CLOUD_KEY, '1'); } catch { /* ignore */ }
  // (The phases table is cleared below with everything else. Nothing to reset for
  // it: since v119 the timeline is never seeded into the database — an empty table
  // simply means "the factory seven", read from the code.)
  //
  // The five author-made lists are cleared too, and are then taken from the account
  // like everything else. Mark them adopted so this device does NOT offer up the
  // pre-v120 copies still sitting in its localStorage: that would push a list the
  // user has deliberately discarded straight back into the account.
  markAdopted(SHARED_KINDS);
  const db = await open();
  // Signing out must never be able to strand the reset. `logout()` can hang
  // (offline, or already signed out), and an un-awaited hang here would leave the
  // device in exactly the broken half-state this button exists to fix. Cap it.
  const withTimeout = (p, ms) => Promise.race([
    Promise.resolve(p).catch(() => {}),
    new Promise((res) => setTimeout(res, ms)),
  ]);
  try { await withTimeout(db.cloud.logout(), 5000); } catch { /* clearing below is the point */ }
  // NOTE: this deliberately does NOT call `indexedDB.deleteDatabase()`.
  //
  // Deleting requires EXCLUSIVE access, and on iOS the app is routinely open in
  // two places at once (a Safari tab and the Home Screen app), so the delete just
  // blocks. Worse, a blocked delete request stays QUEUED and then blocks every
  // later transaction — including any attempt to clean up a gentler way — which
  // wedges the app completely. Emptying the tables achieves exactly the same
  // result, needs no exclusivity, and cannot deadlock.
  //
  // Everything goes: the app's own tables, the addon's sync bookkeeping
  // ($baseRevs / $syncState / $logins / realms / members / roles) so the next
  // sign-in re-downloads from scratch instead of believing it is already current,
  // and every `$<table>_mutations` queue so nothing pending is ever pushed up.
  // `snapshots` is deliberately KEPT — it is this device's own local safety net
  // and never syncs, so there is no reason to destroy it.
  try {
    const db2 = await open();
    const targets = db2.tables.filter((t) => t.name !== SNAPSHOTS);
    await db2.transaction('rw', targets, async () => {
      for (const t of targets) await t.clear();
    });
    return true;
  } catch (err) {
    logResetFailure(err);
    return false;
  }
}

// Sign out on THIS device. Local data stays; it simply stops syncing.
export async function signOut() {
  if (!syncEnabled()) return;
  const db = await open();
  return db.cloud.logout();
}

// The live Dexie instance, for callers that want to run their own transaction.
export function dexie() { return open(); }

// v100 shipped with the cloud addon's `nameSuffix` left at its default, which
// renamed the local database to `<name>-<cloud db id>` — so the app opened an
// empty database, seeded it, and appeared to have lost everything (the real data
// was untouched in the original all along). v101 pins the name back.
//
// This removes the empty stray that v100 created. It is deliberately timid: it
// only ever deletes the SUFFIXED database, and only once the real one is known to
// hold data — so it can never be the thing that removes a sole copy.
export async function cleanupStrayCloudDb() {
  if (!syncEnabled() || !indexedDB.databases) return { removed: false };
  const dbid = (() => {
    try {
      const u = new URL(CLOUD.databaseUrl);
      return u.pathname === '/' ? u.hostname.split('.')[0] : u.pathname.split('/')[1];
    } catch { return ''; }
  })();
  if (!dbid) return { removed: false };
  const strayName = `${DB_NAME}-${dbid}`;
  const names = (await indexedDB.databases().catch(() => [])).map((d) => d.name);
  if (!names.includes(strayName)) return { removed: false };
  // Only proceed once the real database actually has templates in it.
  const real = await getAllRaw(TEMPLATES).catch(() => []);
  if (!real || !real.length) return { removed: false, reason: 'real database looks empty — left alone' };
  await new Promise((res) => {
    const req = indexedDB.deleteDatabase(strayName);
    req.onsuccess = req.onerror = req.onblocked = () => res();
  });
  return { removed: true, name: strayName };
}


// --- Low-level helpers (same names and contracts as the hand-rolled versions) ---
async function getAllRaw(store) {
  const db = await open();
  return db.table(store).toArray();
}
async function getOneRaw(store, key) {
  const db = await open();
  return db.table(store).get(key);
}
async function putOne(store, value) {
  const db = await open();
  await db.table(store).put(value);
  return value;
}
async function delOne(store, key) {
  const db = await open();
  return db.table(store).delete(key);
}
// Apply a set of puts ({store,value}) and deletes ({store,key}) in ONE transaction.
async function writeBatch(puts = [], dels = []) {
  const stores = [...new Set([...puts, ...dels].map((o) => o.store))];
  if (!stores.length) return;
  const db = await open();
  return db.transaction('rw', stores, async () => {
    for (const st of stores) {
      const vals = puts.filter((x) => x.store === st).map((x) => x.value);
      const keys = dels.filter((x) => x.store === st).map((x) => x.key);
      if (vals.length) await db.table(st).bulkPut(vals);
      if (keys.length) await db.table(st).bulkDelete(keys);
    }
  });
}

// --- Photos -----------------------------------------------------------------
// Item images used to live inline on the item as `data:` URLs. They now live
// here, once each, and items reference them by id. The reason is size: a single
// 900px JPEG is tens of KB, and inline they were copied into every catalog read,
// every backup and every snapshot — which is what made snapshots enormous.
//
// An item still carries a small `thumb` (a few KB) so list rows render instantly
// without touching this store; only the editor and the lightbox load full images.

export async function getPhoto(photoId) {
  if (!isPhotoRef(photoId)) return photoId || '';   // already an inline image (pre-migration)
  const rec = await getOneRaw(PHOTOS, photoId);
  return (rec && typeof rec.data === 'string') ? rec.data : '';
}

// Resolve many at once — one transaction, for the item editor.
export async function getPhotoMap(ids = []) {
  const want = [...new Set(ids.filter(isPhotoRef))];
  const out = new Map();
  if (!want.length) return out;
  const db = await open();
  const recs = await db.table(PHOTOS).bulkGet(want);   // aligned with `want`
  recs.forEach((rec, i) => { if (rec && typeof rec.data === 'string') out.set(want[i], rec.data); });
  return out;
}

// Store one image and hand back its id.
export async function savePhoto(dataURL) {
  const rec = { id: newId(), data: String(dataURL || ''), createdAt: new Date().toISOString() };
  await putOne(PHOTOS, rec);
  return rec.id;
}

export async function photoCount() {
  const all = await getAllRaw(PHOTOS);
  return (all || []).length;
}

// Every photo id referenced by anything we must not break: live catalog items,
// and the automatic snapshots (which store ids, not images). Used by the pruner
// so restoring an old snapshot never lands on a missing picture.
async function referencedPhotoIds() {
  const [items, snaps] = await Promise.all([getAllRaw(ITEMS), getAllRaw(SNAPSHOTS)]);
  const refs = new Set();
  for (const it of (items || [])) for (const p of (it.photos || [])) if (isPhotoRef(p)) refs.add(p);
  for (const s of (snaps || [])) {
    for (const l of ((s.data && s.data.lists) || [])) {
      for (const it of (l.items || [])) for (const p of (it.photos || [])) if (isPhotoRef(p)) refs.add(p);
    }
  }
  return refs;
}

// Delete photo records nothing points at any more. Safe to call at any time;
// returns how many were freed.
export async function pruneOrphanPhotos() {
  const [all, refs] = await Promise.all([getAllRaw(PHOTOS), referencedPhotoIds()]);
  const dead = (all || []).filter((rec) => !refs.has(rec.id)).map((rec) => rec.id);
  if (dead.length) await writeBatch([], dead.map((k) => ({ store: PHOTOS, key: k })));
  return dead.length;
}

// One-time (and idempotent) move of any still-inline images into the photos
// store, replacing them on the item with an id and generating the small thumb.
//
// Deliberately NOT done inside the IndexedDB upgrade transaction: making a
// thumbnail needs a canvas, which is async, and an upgrade transaction cannot
// wait. Instead this runs as a normal pass after open — so a half-finished run
// simply resumes next time, and `coerceItem` tolerates both shapes meanwhile.
//
// `makeThumb` is injected by the caller (app.js owns the canvas work); without
// it the images still move, they just don't get a thumbnail yet.
export async function migrateInlinePhotos({ makeThumb } = {}) {
  const items = (await getAllRaw(ITEMS)) || [];
  const todo = items.filter((it) => inlinePhotos(it).length > 0 || (!it.thumb && (it.photos || []).length));
  if (!todo.length) return { items: 0, photos: 0 };
  let moved = 0;
  for (const raw of todo) {
    const it = coerceItem(raw);
    const ids = [];
    for (const p of (it.photos || [])) {
      if (isPhotoRef(p)) { ids.push(p); continue; }
      ids.push(await savePhoto(p));
      moved++;
    }
    it.photos = ids;
    if (!it.thumb && ids.length && typeof makeThumb === 'function') {
      const first = await getPhoto(ids[0]);
      if (first) { try { it.thumb = await makeThumb(first); } catch { /* a missing thumb is cosmetic */ } }
    }
    await putOne(ITEMS, it);
  }
  return { items: todo.length, photos: moved };
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
  const tplDefaults = templateDefaults(template);   // e.g. "everything here goes in the hiking backpack"
  for (const m of mine) {
    const item = itemsById.get(m.itemId);
    if (!item) continue;
    const r = resolveMembership(item, m, tplDefaults);
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
      // Safe even for a link: `applyIntrinsic` steps over every field the caller
      // left undefined, so a contextual-only object cannot blank the shared item.
      applyIntrinsic(cat, it);                 // propagate edits to the shared thing
    } else if (it._link) {
      // A link whose target has vanished (deleted on another device mid-sync).
      // Never invent an item from a link — it would have no photos, no care record
      // and no purchase detail, and would then look canonical. Drop the row instead.
      continue;
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

// --- Kits (reusable bundles) — a flat store, like events + actions ---

export async function getKits() {
  const raw = await getAllRaw(KITS);
  return (raw || []).map(coerceKit).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}
export function saveKit(kit) {
  const k = coerceKit({ ...kit });
  k.updatedAt = new Date().toISOString();
  return putOne(KITS, k);
}
export function deleteKit(id) { return delOne(KITS, id); }

// --- Phases: the editable "When" timeline -----------------------------------
//
// The ONLY user-editable list that lives in the database rather than on the
// device. It has to: a phase id is stamped on every item, membership, trip entry
// and to-do, so a phase that existed on only one device would make the same item
// read as a different "When" there. Everything else (People, Owners, Conditions,
// storage places) is deliberately per-device; this one is deliberately not.
//
// NOTE the field names: `owner` and `realmId` are reserved by the sync addon and
// must never be used here — see model.js, and what that collision cost in v117.
// The timeline in force: what is stored, or — when nothing is stored, which is the
// normal state until the first edit — the factory seven from the code.
//
// The fallback is not a nicety. Callers edit the list they get back and write it
// whole, so returning [] on an untouched account would mean the first change you
// ever made found no phase to change and silently did nothing.
export async function getPhases() {
  const raw = (await getAllRaw(PHASES_STORE).catch(() => [])) || [];
  const stored = raw.map((p, i) => coercePhase(p, i)).filter((p) => p.id && p.label)
    .sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id));
  return stored.length ? stored : DEFAULT_PHASES.map((p, i) => coercePhase(p, i));
}
// Write the list whole: every phase is put, and any row no longer in the list is
// deleted, so a removal actually propagates to the other device instead of the
// two lists merging back together on the next sync.
export async function savePhases(list) {
  const clean = setPhases(list).map((p) => ({ ...p }));
  const db = await open();
  const existing = (await getAllRaw(PHASES_STORE).catch(() => [])) || [];
  const keep = new Set(clean.map((p) => p.id));
  const gone = existing.map((p) => p && p.id).filter((id) => id && !keep.has(id));
  await db.transaction('rw', [PHASES_STORE], async () => {
    if (gone.length) await db.table(PHASES_STORE).bulkDelete(gone);
    await db.table(PHASES_STORE).bulkPut(clean);
  });
  return clean;
}
// Adopt the timeline into the live list. READS ONLY — it must never write.
//
// ⚠️ THIS COST MARTIN HIS CUSTOMISED TIMELINE IN v118, so the reasoning matters.
//
// v118 seeded the factory seven into this table on a device that had none. The
// built-in ids are stable, which was meant to stop two devices doubling the list
// — and it did. What it also did was let a seed land exactly on top of a
// customised row and REPLACE it: `bulkPut` on an existing primary key overwrites
// the record whole. His second device found its own (brand-new, therefore empty)
// phases table, waited for the account's copy, gave up too early — "in sync"
// describes the database, and a table created seconds ago can still be empty at
// that moment — and wrote seven factory rows straight over his renamed,
// recoloured ones. The phase he had ADDED survived, because its id collided with
// nothing. Seven reverted, one survived: exactly what he saw.
//
// The fix is to stop seeding into shared data at all. The factory seven now live
// ONLY in memory, exactly as the condition list does: an account that has never
// edited the timeline stores no phase rows anywhere, both devices show the same
// seven straight from the code, and the FIRST EDIT is what writes a real list.
// There is no longer any moment where one device can write over another's.
export async function ensurePhases() {
  const have = (await getAllRaw(PHASES_STORE).catch(() => [])) || [];
  setPhases(have.length
    ? have.map((p, i) => coercePhase(p, i))
    : DEFAULT_PHASES.map((p) => ({ ...p })));
  return PHASES;
}
// Re-read the timeline from the database into the live list. Call before showing
// or editing it, so a device that has had the app open while the OTHER device
// changed the list is never working from a stale copy — writing one back would
// delete rows this device had simply never seen.
export async function refreshPhases() { return ensurePhases(); }

// --- The five author-made Settings lists ------------------------------------
//
// Conditions · Trip presets · People · Owners · Storage places, all in the one
// `shared` store, one row per ENTRY. The shape and the reasoning are in model.js;
// this is only the storage. Two rules govern everything below:
//
//  1. NOTHING IS EVER SEEDED HERE. A kind with no rows means "the factory list,
//     from the code". Writing defaults into shared data is what destroyed the
//     customised timeline in v118 — see `ensurePhases` above for the full story.
//  2. ADDING AND REMOVING ONE ENTRY WRITES ONE ROW. Only a genuine whole-list
//     operation — a reorder, a reset, a restore — writes a list whole. That is
//     what makes a stale screen harmless: it can no longer delete an entry added
//     on the other device simply by saving the copy it happens to be holding.
export async function getSharedRows() {
  const raw = (await getAllRaw(SHARED).catch(() => [])) || [];
  return raw.map((r, i) => coerceSharedRow(r, i)).filter((r) => r.kind && r.key && r.name);
}
// Write these rows and nothing else. Anything already in the store is untouched.
export async function putSharedRows(rows) {
  const clean = (Array.isArray(rows) ? rows : []).map((r, i) => coerceSharedRow(r, i))
    .filter((r) => r.kind && r.key && r.name);
  if (clean.length) {
    const db = await open();
    await db.table(SHARED).bulkPut(clean);
    markAdopted([...adoptedKinds(), ...clean.map((r) => r.kind)]);
  }
  return getSharedRows();
}
// Remove these rows and nothing else. A real delete, so the removal propagates.
export async function deleteSharedRows(ids) {
  const clean = (Array.isArray(ids) ? ids : []).filter((x) => typeof x === 'string' && x);
  if (clean.length) {
    const db = await open();
    await db.table(SHARED).bulkDelete(clean);
    markAdopted([...adoptedKinds(), ...clean.map((id) => id.split(':')[0])]);
  }
  return getSharedRows();
}
// Replace one whole list: put every row it now has, and delete the rows of that
// kind which are gone. For reorders, resets and restores — the operations that
// really are about the list rather than about one entry. An empty list therefore
// means "back to the factory version", stored as nothing at all.
export async function replaceSharedKind(kind, list, { remove = [], clear = false } = {}) {
  if (!SHARED_KINDS.includes(kind)) return getSharedRows();
  const rows = sharedRowsFrom(kind, list);
  const db = await open();
  // 🚨 A WHOLE-LIST SAVE NEVER DELETES BY OMISSION.
  //
  // It used to: anything of this kind that wasn't in the list went. That reads as
  // reasonable and is quietly lethal, because "the list" is only ever this device's
  // VIEW of it — and a view can be short for reasons that have nothing to do with
  // intent. v120 shipped with the iPhone holding one condition out of six (its copy
  // of the table had not finished arriving); one edit there would have deleted the
  // other five for both devices. Same shape as the v118 timeline loss: code treating
  // "I can't see it" as "it isn't there".
  //
  // So removal is now something a caller SAYS, by id — a rename naming the old row,
  // a delete naming the row deleted, a reset asking to clear the kind outright.
  let gone = (Array.isArray(remove) ? remove : []).filter((x) => typeof x === 'string' && x);
  if (clear) {
    const existing = (await getAllRaw(SHARED).catch(() => [])) || [];
    gone = existing.filter((r) => r && r.kind === kind && r.id).map((r) => r.id);
  }
  const keep = new Set(rows.map((r) => r.id));
  gone = gone.filter((id) => !keep.has(id));
  await db.transaction('rw', [SHARED], async () => {
    if (gone.length) await db.table(SHARED).bulkDelete(gone);
    if (rows.length) await db.table(SHARED).bulkPut(rows);
  });
  // Authoring the list supersedes whatever this device had before v120 — including
  // when the list is written EMPTY (a reset, or the last entry removed). Without
  // this, "no rows" would send the reader back to the pre-v120 fallback and the
  // reset would look as though it had done nothing. Marked only once the write has
  // actually gone through, so a failure leaves the fallback intact.
  markAdopted([...adoptedKinds(), kind]);
  return getSharedRows();
}
// Add only the rows this store hasn't got. Never overwrites, so a list arriving
// from a backup — or from a device being adopted — can add to what is here and
// can never quietly replace it.
export async function addSharedRowsIfAbsent(rows) {
  const have = new Set(((await getAllRaw(SHARED).catch(() => [])) || []).map((r) => r && r.id));
  return putSharedRows((Array.isArray(rows) ? rows : []).filter((r) => r && !have.has(r.id)));
}

// --- Adopting this device's pre-v120 lists ----------------------------------
//
// Before v120 all five lists lived in localStorage. The keys are still read once,
// so nothing anyone had is lost when the lists move into the account.
const LEGACY_LIST_KEYS = {
  conditions: 'ams-conditions',
  presets: 'ams-trip-presets',
  people: 'ams-people',
  owners: 'ams-owners',
  places: 'ams-storage-locations',
};
const SHARED_ADOPTED_KEY = 'ams-shared-lists';   // which kinds this device has already offered up
function adoptedKinds() {
  try {
    const a = JSON.parse(localStorage.getItem(SHARED_ADOPTED_KEY) || '[]');
    return Array.isArray(a) ? a.filter((k) => SHARED_KINDS.includes(k)) : [];
  } catch { return []; }
}
function markAdopted(kinds) {
  try { localStorage.setItem(SHARED_ADOPTED_KEY, JSON.stringify([...new Set(kinds)])); } catch { /* ignore */ }
}
// What this device had in localStorage for one list, or null once that copy has
// been superseded — either because the list was adopted into the account, or
// because it has since been authored here. Used twice: by the adoption below, and
// by the app to keep showing your own list until it has been adopted.
export function legacySharedList(kind) {
  const key = LEGACY_LIST_KEYS[kind];
  if (!key || adoptedKinds().includes(kind)) return null;
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a : null;
  } catch { return null; }
}

// Make this device download the whole `shared` table once, from scratch.
//
// 🚨 THE v120 FAULT THIS REPAIRS. The sync addon keeps a list of the tables it has
// already done a first, full download of. When a release adds a table, a device
// that was ALREADY syncing does that first download the next time it connects —
// and if the table happens to be empty at that moment, it faithfully downloads
// nothing and then records the table as done. From then on it only ever receives
// CHANGES. So Martin's iPhone, which reached the new table before his Mac had
// written anything into it, ended up holding exactly the two rows he added during
// the field check and none of the twenty-five that already existed.
//
// (The same shape cost him the timeline in v118: "in sync" describes the database,
// never a table that was created seconds ago.)
//
// The repair is to forget that the table was ever synced and let the addon do the
// first download again — this time against an account that has the rows. The push
// happens FIRST, so a row that exists only on this device is safely uploaded before
// the table is re-read from the account.
const SHARED_RESYNC_KEY = 'ams-shared-resync';    // v1 — one full re-download per device
export async function repairSharedSync() {
  if (!syncEnabled()) return { repaired: false };
  try { if (localStorage.getItem(SHARED_RESYNC_KEY) === '1') return { repaired: false, already: true }; } catch { /* ignore */ }
  if (!(await isSignedIn())) return { repaired: false, signedOut: true };   // nothing to pull; try again once signed in
  try {
    const db = await open();
    // Let this device finish saying what it has before we ask it to listen.
    await awaitFirstSync(15000);
    await db.cloud.sync({ purpose: 'push', wait: true }).catch(() => {});
    const st = await db.table('$syncState').get('syncState').catch(() => null);
    const before = (await getSharedRows()).length;
    if (st && Array.isArray(st.syncedTables) && st.syncedTables.includes(SHARED)) {
      await db.table('$syncState').update('syncState', {
        syncedTables: st.syncedTables.filter((t) => t !== SHARED),
      });
      await db.cloud.sync({ purpose: 'pull', wait: true }).catch(() => {});
    }
    try { localStorage.setItem(SHARED_RESYNC_KEY, '1'); } catch { /* ignore */ }
    const after = (await getSharedRows()).length;
    return { repaired: true, before, after };
  } catch (err) {
    return { repaired: false, error: String((err && err.message) || err) };
  }
}

// Re-send every shared row this device holds, so the other device receives them.
//
// 🚨 WHY THIS EXISTS, AND WHY IT IS THE ONE THAT WORKS. `repairSharedSync()` above
// tries to make the addon redo its first full download of the table. On Martin's
// iPhone it did not — it left him with one condition out of six even after running.
// That approach depends on the addon's internal bookkeeping behaving the way its
// (minified) source reads, which is a bet I lost.
//
// This one bets on nothing. The ONE delivery path proven to work all along is the
// ordinary one: a row CHANGED on one device reliably reaches the other — that is
// exactly how "Test shelf" and "Test worn out" got through when the other 25 rows
// did not. So instead of asking for a re-download, the device that HAS the lists
// simply writes them again. Every row becomes an ordinary change, and ordinary
// changes arrive.
//
// `data.rev` is a timestamp nobody reads (every reader takes named keys out of
// `data`), there purely so the write is a genuine change rather than a no-op the
// sync layer might reasonably skip.
export async function republishSharedLists() {
  const rows = await getSharedRows();
  if (!rows.length) return { sent: 0 };
  const stamped = rows.map((r) => ({ ...r, data: { ...r.data, rev: Date.now() } }));
  const db = await open();
  await db.table(SHARED).bulkPut(stamped);
  return { sent: stamped.length };
}

// Do that once per device, unprompted, so the repair needs nothing of the user.
// Safe on every device: a device holding a SHORT list re-sends only what it has,
// which cannot remove what the other one holds — rows are merged by id, and since
// v121 nothing is ever deleted by omission.
const SHARED_REPUBLISH_KEY = 'ams-shared-republish';   // v1
export async function republishSharedListsOnce() {
  try { if (localStorage.getItem(SHARED_REPUBLISH_KEY) === '1') return { sent: 0, already: true }; } catch { /* ignore */ }
  if (!syncEnabled() || !(await isSignedIn())) return { sent: 0, signedOut: true };
  try {
    const r = await republishSharedLists();
    try { localStorage.setItem(SHARED_REPUBLISH_KEY, '1'); } catch { /* ignore */ }
    return r;
  } catch (err) {
    return { sent: 0, error: String((err && err.message) || err) };
  }
}

// Move this device's own lists into the account, once.
//
// Three guards, each of which has a v118-shaped disaster behind it:
//
//  • NEVER MIGRATE BLIND. On a signed-in device the store is empty for the first
//    second or two no matter what the account holds, and writing this device's
//    copy into that gap is precisely how a customised list gets replaced by a
//    stale one. If the first sync doesn't land, nothing is marked and we simply
//    try again next launch.
//  • NEVER ADOPT A FACTORY LIST. If this device's list is still exactly what the
//    app ships, it is not data — it is the default, and the default lives in the
//    code. Writing it up would plant seven rows for the other device's real ones
//    to collide with.
//  • NEVER OVERWRITE. Only rows the store hasn't got are added, so the first
//    device to arrive sets the list and a second one can add to it but never
//    replace it.
export async function migrateSharedLists() {
  const done = adoptedKinds();
  const todo = SHARED_KINDS.filter((k) => !done.includes(k));
  if (!todo.length) return { added: 0, kinds: [] };
  if (await isSignedIn()) {
    if (!(await awaitFirstSync(12000))) return { added: 0, kinds: [], waiting: true };
  }
  const have = await getSharedRows();
  const add = [];
  const kinds = [];
  for (const kind of todo) {
    const local = legacySharedList(kind);
    if (!local || !local.length || isFactoryList(kind, local)) continue;
    const known = new Set(sharedRowsOfKind(have, kind).map((r) => r.id));
    const rows = sharedRowsFrom(kind, local).filter((r) => !known.has(r.id));
    if (rows.length) { add.push(...rows); kinds.push(kind); }
  }
  if (add.length) await putSharedRows(add);
  markAdopted([...done, ...todo]);
  return { added: add.length, kinds };
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
  return db.transaction('rw', [ITEMS, MEMBERSHIPS, TEMPLATES], async () => {
    await db.table(ITEMS).clear();
    await db.table(MEMBERSHIPS).clear();
    await db.table(TEMPLATES).clear();
    await db.table(ITEMS).bulkPut(catalog.items);
    await db.table(MEMBERSHIPS).bulkPut(catalog.memberships);
    await db.table(TEMPLATES).bulkPut(catalog.templates.map((t) => coerceList({ ...t, items: [] })));
  });
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

// Wait for the first sync to land, when this device is signed in.
//
// Why this exists: `ensureSeeded()` runs at startup and seeds the built-in
// templates whenever it finds an empty catalogue. On a device that is signed in
// to sync, "empty" is a LIE for the first second or two — the account's real
// catalogue is on its way. Seeding into that gap is what produced two complete
// sets of everything (v100 uploaded 880 items: the same 440 twice).
//
// Resolves true if a sync completed, false if not signed in or it timed out.
async function awaitFirstSync(timeoutMs = 20000) {
  if (!syncEnabled()) return false;
  const db = await open();
  const user = db.cloud.currentUser?.value;
  if (!user || !user.isLoggedIn) return false;      // never synced here — seeding is correct
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; try { sub?.unsubscribe(); } catch { /* ignore */ } clearTimeout(timer); resolve(v); };
    const timer = setTimeout(() => finish(false), timeoutMs);
    let sub = null;
    try {
      sub = db.cloud.syncState.subscribe((st) => {
        if (st && st.phase === 'in-sync') finish(true);
        if (st && st.phase === 'error') finish(false);
      });
    } catch { finish(false); }
  });
}

async function isSignedIn() {
  if (!syncEnabled()) return false;
  try {
    const db = await open();
    const u = db.cloud.currentUser?.value;
    return !!(u && u.isLoggedIn);
  } catch { return false; }
}

export async function ensureSeeded() {
  // FIRST, and outside everything below: the phase list has to be in place before
  // a single item is read, because an item's "When" is looked up in it. It also
  // has to happen on the paths that return early (an empty catalogue waiting for
  // the account's copy), which is why it is here and not at the bottom.
  await ensurePhases();
  const tmpls = await getAllRaw(TEMPLATES);
  let seededVersion = 0;
  try { seededVersion = Number(localStorage.getItem(SEED_KEY)) || 0; } catch { /* ignore */ }

  if (tmpls && tmpls.length) {
    // A catalogue is present, so any pending "waiting for the account's copy" is done.
    try { localStorage.removeItem(AWAITING_CLOUD_KEY); } catch { /* ignore */ }
  }
  if (!tmpls || !tmpls.length) {
    // This device was deliberately emptied to take the account's copy. Never seed
    // over that intent — wait, however long it takes, for the user to sign in.
    let awaiting = false;
    try { awaiting = localStorage.getItem(AWAITING_CLOUD_KEY) === '1'; } catch { /* ignore */ }
    if (awaiting && syncEnabled()) {
      if (await awaitFirstSync()) {
        const arrived = await getAllRaw(TEMPLATES);
        if (arrived && arrived.length) {
          try { localStorage.removeItem(AWAITING_CLOUD_KEY); } catch { /* ignore */ }
          try { localStorage.setItem(SEED_KEY, String(SEED_VERSION)); } catch { /* ignore */ }
          return getLists();
        }
      }
      return getLists();                        // still empty: show nothing, seed nothing
    }
    // An empty catalogue on a SIGNED-IN device usually means "the account's
    // catalogue hasn't arrived yet", not "this is a brand-new user". Give the
    // first sync a chance before seeding, or the device ends up holding the
    // starter set AND everything that syncs down.
    if (await awaitFirstSync()) {
      const arrived = await getAllRaw(TEMPLATES);
      if (arrived && arrived.length) {
        try { localStorage.setItem(SEED_KEY, String(SEED_VERSION)); } catch { /* ignore */ }
        return getLists();                       // the account supplied it — never seed over that
      }
    } else if (syncEnabled() && (await isSignedIn())) {
      // Signed in but the sync did not land (offline, or the server is unhappy).
      // Deliberately do NOT seed: an empty screen this launch is recoverable,
      // whereas a duplicate catalogue has to be untangled by hand.
      return getLists();
    }
    // Migrate existing v1 copy-based lists if present; otherwise seed fresh.
    const legacy = (await getAllRaw(LISTS).catch(() => [])) || [];
    const source = legacy.length ? legacy.map(coerceList) : seedLists();
    await replaceCatalog(buildCatalog(source));
  } else if (seededVersion < SEED_VERSION) {
    await reseedBuiltins();
  }
  try { localStorage.setItem(SEED_KEY, String(SEED_VERSION)); } catch { /* ignore */ }
  await migrateContainerModel();
  await migrateTemplateNames();
  await migrateOwnerField();
  return getLists();
}

// Move "whose it is" off the reserved `owner` property and onto `ownedBy` (v117).
//
// THE BUG THIS REPAIRS. `owner` is reserved by the sync addon: on every write it
// does `row.owner || (row.owner = <signed-in account>)`, because it uses that
// field for access control. The app was using the same name for its own "whose
// item is this", so the moment this database started syncing, every item that
// had no owner set was quietly stamped with the account's e-mail address — and
// that address is what then showed on the item rows, in the Care list, in the
// All-items table and in the "Whose it is" grouping. On Martin's catalogue that
// was 422 of 431 items.
//
// What this does, once per device:
//   • an address the sync stamped there becomes the person's NAME
//     ("martin.schabbauer@icloud.com" → "Martin"), which is what he actually
//     means by it;
//   • a real name he typed ("Anna", "Shared") is carried across untouched;
//   • `owner` itself is LEFT ALONE — it belongs to the sync addon now, which
//     will keep re-stamping it. Nothing in the app reads it any more.
//
// Idempotent: once `ownedBy` is set, re-running changes nothing.
const OWNER_FIELD_KEY = 'ams-owner-field';
const OWNER_FIELD_VERSION = 1;

export async function migrateOwnerField() {
  let done = 0;
  try { done = Number(localStorage.getItem(OWNER_FIELD_KEY)) || 0; } catch { /* ignore */ }
  if (done >= OWNER_FIELD_VERSION) return { skipped: true };
  const rows = (await getAllRaw(ITEMS).catch(() => [])) || [];
  const puts = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    // The presence of the key at all means this row has already been written by
    // v117 or later, so leave it — including a deliberately EMPTY one, which is
    // an owner the user has since cleared and must not be resurrected.
    if (typeof r.ownedBy === 'string') continue;
    const legacy = typeof r.owner === 'string' ? r.owner.trim() : '';
    if (!legacy) continue;
    const name = looksLikeEmail(legacy) ? ownerNameFromEmail(legacy) : legacy;
    if (!name) continue;
    puts.push({ store: ITEMS, value: { ...r, ownedBy: name } });
  }
  if (puts.length) await writeBatch(puts, []);
  try { localStorage.setItem(OWNER_FIELD_KEY, String(OWNER_FIELD_VERSION)); } catch { /* ignore */ }
  return { moved: puts.length };
}

// One-time repair of the container model (v108).
//
// Until v108 an item's default container was frozen at creation — no screen could
// change it — so every deliberate choice was stored as a per-list override and the
// default stayed at whatever the item happened to be born with. Now that the
// default is editable and propagates, it has to mean something: this gives each
// item the container it uses MOST across its lists, and keeps a real exception
// wherever a list genuinely differs.
//
// EFFECTIVE CONTAINERS DO NOT CHANGE. Every list shows exactly what it showed
// before; only the split between "default" and "exception" is rearranged. The
// calculation is deterministic, so two synced devices reach the same answer, and
// idempotent, so running it again is a no-op.
const CONTAINER_MODEL_KEY = 'ams-container-model';
const CONTAINER_MODEL_VERSION = 2;

export async function migrateContainerModel() {
  let done = 0;
  try { done = Number(localStorage.getItem(CONTAINER_MODEL_KEY)) || 0; } catch { /* ignore */ }
  if (done >= CONTAINER_MODEL_VERSION) return { skipped: true };

  const { items, mems, tmpls } = await loadCatalog();
  const itemsById = new Map(items.map((i) => [i.id, i]));

  // All the thinking happens in model.js, where it can be tested; this only applies
  // the result. The ordering inside that plan is load-bearing — see its comment.
  // Templates go in because a template's own default bag is part of how a row
  // resolves: without it, this would strip exceptions the default then overrides.
  const plan = planContainerMigration(items, mems, tmpls);
  const memById = new Map(mems.map((m) => [m.id, m]));
  const putItems = [];
  for (const c of plan.itemChanges) {
    const item = itemsById.get(c.id);
    if (item) { item.container = c.container; putItems.push(item); }
  }
  const putMems = [];
  for (const c of plan.memChanges) {
    const m = memById.get(c.id);
    if (m) { m.container = c.container; putMems.push(m); }
  }

  if (putItems.length || putMems.length) {
    await writeBatch([
      ...putItems.map((v) => ({ store: ITEMS, value: v })),
      ...putMems.map((v) => ({ store: MEMBERSHIPS, value: v })),
    ], []);
  }
  try { localStorage.setItem(CONTAINER_MODEL_KEY, String(CONTAINER_MODEL_VERSION)); } catch { /* ignore */ }
  return { items: putItems.length, memberships: putMems.length };
}

// Rename the "Yoga / Mobility" starter template to "Mobility" (v109).
//
// Deliberately NOT done by bumping SEED_VERSION: `reseedBuiltins()` replaces every
// built-in template wholesale, which would throw away years of edits to Travel,
// Hiking and the rest. This touches one field on one template and nothing else —
// its items, sections, memberships and id all stay exactly as they are.
// Idempotent: once renamed there is nothing left to match.
const RENAMES_KEY = 'ams-template-renames';
const RENAMES_VERSION = 1;
const TEMPLATE_RENAMES = [{ from: 'yoga / mobility', to: 'Mobility' }];

export async function migrateTemplateNames() {
  let done = 0;
  try { done = Number(localStorage.getItem(RENAMES_KEY)) || 0; } catch { /* ignore */ }
  if (done >= RENAMES_VERSION) return { skipped: true };
  const tmpls = await getAllRaw(TEMPLATES);
  const puts = [];
  for (const t of (tmpls || [])) {
    const hit = TEMPLATE_RENAMES.find((r) => normName(t.name) === r.from);
    // Never collide with a list that already carries the new name.
    if (!hit) continue;
    if ((tmpls || []).some((o) => o.id !== t.id && normName(o.name) === normName(hit.to))) continue;
    puts.push({ store: TEMPLATES, value: { ...t, name: hit.to } });
  }
  if (puts.length) await writeBatch(puts, []);
  try { localStorage.setItem(RENAMES_KEY, String(RENAMES_VERSION)); } catch { /* ignore */ }
  return { renamed: puts.length };
}

// --- Backup (Export / Import) ---
// Backups keep the familiar { lists, events } shape (resolved lists), so files
// stay compatible across the storage change: import simply decomposes them back.

// `extra` lets the caller fold in data that lives outside IndexedDB (e.g. the
// small localStorage preferences like custom storage places), so a JSON backup
// is a complete restore point. Photos/care/all item detail are already inside
// `lists` because getLists() resolves the full item shape.
export async function exportJSON(extra = {}) {
  const [lists, events, actions, kits, photos, phases] = await Promise.all([
    getLists(), getEvents(), getActions(), getKits(), getAllRaw(PHOTOS), getPhases(),
  ]);
  // Items now reference their images by id, so the images must travel in their
  // own array or a restore would come back picture-less. A backup stays a
  // COMPLETE restore point — that is worth the file size.
  return JSON.stringify(
    // `phases` travels with the data, not with the device prefs, because every
    // item in `lists` points into it — a backup without it could restore items
    // onto a "When" that doesn't exist.
    { app: 'ams-packing-list', version: 2, exportedAt: new Date().toISOString(), lists, events, actions, kits, phases, photos: photos || [], ...extra },
    null, 2,
  );
}

// Does a parsed object look like one of our backups? (Has lists or events.)
function looksLikeBackup(data) {
  return !!data && typeof data === 'object' && (Array.isArray(data.lists) || Array.isArray(data.events));
}

// Parse + validate a backup file WITHOUT touching the database, and report what's
// inside — so the UI can show "383 items · 14 templates · 5 trips (exported …)"
// and warn before a shrinking restore. Throws on anything that isn't a backup.
export function inspectBackup(text) {
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error('That file isn’t readable as a backup (not valid JSON).'); }
  if (!looksLikeBackup(data)) throw new Error('This file does not look like an AMS Packing List backup.');
  const lists = Array.isArray(data.lists) ? data.lists.map(coerceList) : [];
  const events = Array.isArray(data.events) ? data.events.map(coerceEvent) : [];
  const actions = Array.isArray(data.actions) ? data.actions.map(coerceAction) : [];
  const kits = Array.isArray(data.kits) ? data.kits.map(coerceKit) : [];
  const prefs = (data.prefs && typeof data.prefs === 'object') ? data.prefs : null;
  // Version 2 backups carry images in their own array; version 1 had them inline
  // on the items. Count whichever this file uses so the "restoring N photos"
  // guard reads correctly for both.
  const photoRecs = Array.isArray(data.photos)
    ? data.photos.filter((r) => r && typeof r.id === 'string' && typeof r.data === 'string')
    : [];
  let photos = photoRecs.length;
  if (!photos) for (const l of lists) for (const it of (l.items || [])) photos += (it.photos || []).length;
  return {
    counts: backupCounts({ lists, events, actions }),
    exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : '',
    photos,
    data: { lists, events, actions, kits, prefs, photos: photoRecs },
  };
}

// Live counts of what's currently stored, for the "you'd be replacing …" guard.
export async function currentCounts() {
  const [items, tmpls, events, actions, kits, photos] = await Promise.all([
    getAllRaw(ITEMS), getAllRaw(TEMPLATES), getAllRaw(EVENTS), getAllRaw(ACTIONS), getAllRaw(KITS), getAllRaw(PHOTOS),
  ]);
  return { items: (items || []).length, templates: (tmpls || []).length, events: (events || []).length, actions: (actions || []).length, kits: (kits || []).length, photos: (photos || []).length };
}

// Write an already-parsed backup payload into the stores. Shared by file import
// and snapshot restore. Never called without the caller having taken (or chosen
// to skip) a safety snapshot first.
async function applyBackup({ lists = [], events = [], actions = [], kits = [], photos = [], phases = [] }, { merge = false } = {}) {
  // Phases FIRST, so the items restored below always have a "When" to point at.
  // A backup from before v118 carries none, in which case whatever this device
  // already uses is left alone. A merge UNIONs (never drops a phase this device
  // is using); a replace takes the file's list whole, as it does for everything.
  if (Array.isArray(phases) && phases.length) {
    const incoming = phases.map((p, i) => coercePhase(p, i)).filter((p) => p.id && p.label);
    if (incoming.length) {
      const have = merge ? await getPhases() : [];
      const byId = new Map(have.map((p) => [p.id, p]));
      for (const p of incoming) byId.set(p.id, p);
      await savePhases([...byId.values()]);
    }
  }
  const L = lists.map(coerceList);
  const E = events.map(coerceEvent);
  const A = actions.map(coerceAction);
  const K = kits.map(coerceKit);
  // Images first, so the items that reference them never point at nothing — even
  // if the write below fails half-way. Photos are keyed by id and never edited,
  // so restoring them is always additive: a replace-restore must NOT clear this
  // store, or a snapshot taken before the restore would lose its pictures.
  const P = (photos || []).filter((r) => r && typeof r.id === 'string' && typeof r.data === 'string');
  if (P.length) await writeBatch(P.map((r) => ({ store: PHOTOS, value: r })));
  if (!merge) {
    await replaceCatalog(buildCatalog(L));
    const db = await open();
    await db.transaction('rw', [EVENTS, ACTIONS, KITS], async () => {
      await db.table(EVENTS).clear();
      if (E.length) await db.table(EVENTS).bulkPut(E);
      await db.table(ACTIONS).clear();
      if (A.length) await db.table(ACTIONS).bulkPut(A);
      await db.table(KITS).clear();
      if (K.length) await db.table(KITS).bulkPut(K);
    });
  } else {
    for (const l of L) await saveList(l);
    if (E.length || A.length || K.length) {
      const db = await open();
      await db.transaction('rw', [EVENTS, ACTIONS, KITS], async () => {
        if (E.length) await db.table(EVENTS).bulkPut(E);
        if (A.length) await db.table(ACTIONS).bulkPut(A);
        if (K.length) await db.table(KITS).bulkPut(K);
      });
    }
  }
  // A backup can carry data from BEFORE the container model was repaired, while
  // this device's "already migrated" marker (localStorage) says it is done — the
  // marker and the data live in different places and a restore replaces only one
  // of them. Re-run it over whatever just arrived; it is idempotent, so a restore
  // of already-repaired data changes nothing.
  try { localStorage.removeItem(CONTAINER_MODEL_KEY); } catch { /* ignore */ }
  await migrateContainerModel().catch(() => {});
  return { lists: L.length, events: E.length, actions: A.length, kits: K.length, photos: P.length };
}

export async function importJSON(text, { merge = false } = {}) {
  const info = inspectBackup(text);
  // A REPLACE overwrites everything — capture the current state as a safety
  // snapshot FIRST, so an unwanted import is always undoable.
  if (!merge) await saveSnapshot({ reason: 'before-restore', force: true }).catch(() => {});
  const res = await applyBackup(info.data, { merge });
  return { ...res, prefs: info.data.prefs };
}

// --- Automatic on-device snapshots (a self-healing safety net) ---
// The app quietly keeps the last few full copies of your data here, so a bad edit,
// an accidental delete or a mistaken import is always recoverable. Everything below
// is written to be safe even from itself (see the guards on saveSnapshot):
//   • it NEVER records an empty database over your real data;
//   • it keeps the newest MAX_SNAPSHOTS, but the single richest snapshot (the
//     "anchor") is never evicted, so a run of tiny snapshots can't push it out;
//   • it tolerates storage limits — on a quota error it prunes and retries, and
//     if it still can't save it skips silently rather than breaking anything.

async function snapshotData(prefs) {
  const [lists, events, actions, kits, phases] = await Promise.all([getLists(), getEvents(), getActions(), getKits(), getPhases()]);
  // NOTE: no `photos` array here on purpose. Items reference images by id and the
  // photos store is shared, so a snapshot only needs the ids — which is what
  // `referencedPhotoIds()` reads, keeping any image an old snapshot still needs
  // safe from the pruner. Before the split, every snapshot carried a full copy of
  // every image; eight of those was the bulk of the app's storage use.
  return { lists, events, actions, kits, phases, prefs: prefs || null };
}

export async function listSnapshots() {
  const raw = await getAllRaw(SNAPSHOTS);
  return (raw || []).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}
export async function newestSnapshotAt() {
  const all = await listSnapshots();
  return all.length ? all[0].createdAt : '';
}

// Prune to survivors: the newest MAX_SNAPSHOTS by time, always UNION the richest
// (most catalog items; newest wins ties) so the best copy is protected.
function chooseSnapshotSurvivors(all) {
  if (all.length <= MAX_SNAPSHOTS) return new Set(all.map((s) => s.id));
  const byTime = [...all].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const keep = new Set(byTime.slice(0, MAX_SNAPSHOTS).map((s) => s.id));
  let anchor = all[0];
  for (const s of all) {
    const si = (s.counts && s.counts.items) || 0, ai = (anchor.counts && anchor.counts.items) || 0;
    if (si > ai || (si === ai && String(s.createdAt) > String(anchor.createdAt))) anchor = s;
  }
  keep.add(anchor.id);
  return keep;
}

export async function saveSnapshot({ reason = 'auto', prefs = null, force = false } = {}) {
  const data = await snapshotData(prefs);
  const counts = backupCounts(data);
  // Never record "nothing" over real data — the classic safety-net-that-hurts bug.
  if (!force && counts.items === 0 && counts.events === 0) return null;
  const snap = {
    id: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(), reason, counts, data,
  };
  const existing = await listSnapshots();
  const keep = chooseSnapshotSurvivors([...existing, snap]);
  const dels = existing.filter((s) => !keep.has(s.id)).map((s) => ({ store: SNAPSHOTS, key: s.id }));
  try {
    await writeBatch([{ store: SNAPSHOTS, value: snap }], dels);
  } catch (err) {
    // Out of room? Drop the oldest non-anchor snapshots and try once more; if it
    // still fails, give up quietly — a failed snapshot must never break the app.
    try {
      const anchorKeep = chooseSnapshotSurvivors([snap]); // keep only the new one
      await writeBatch([{ store: SNAPSHOTS, value: snap }], existing.filter((s) => !anchorKeep.has(s.id)).map((s) => ({ store: SNAPSHOTS, key: s.id })));
    } catch { return null; }
  }
  return snap;
}

// Take an automatic snapshot only if the newest is older than ~20h, so ordinary
// use produces roughly one snapshot a day rather than one per launch.
export async function maybeAutoSnapshot(prefs = null) {
  const newest = await newestSnapshotAt();
  if (newest) {
    const ageMs = Date.now() - new Date(newest).getTime();
    if (ageMs >= 0 && ageMs < 20 * 3600 * 1000) return null;
  }
  return saveSnapshot({ reason: 'auto', prefs });
}

export function deleteSnapshot(id) { return delOne(SNAPSHOTS, id); }

// Restore a snapshot, capturing the current state as a fresh safety snapshot first
// (so a restore is itself undoable). Returns its counts + saved prefs.
export async function restoreSnapshot(id) {
  const snap = await getOneRaw(SNAPSHOTS, id);
  if (!snap || !snap.data) throw new Error('That backup is no longer available.');
  await saveSnapshot({ reason: 'before-restore', force: true }).catch(() => {});
  await applyBackup(snap.data, { merge: false });
  return { counts: snap.counts, prefs: snap.data.prefs || null };
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
