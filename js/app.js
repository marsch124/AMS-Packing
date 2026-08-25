// app.js — screens, navigation and wiring for AMS Packing List.
import {
  CATEGORIES, CONTAINERS, CONTAINER_ROLE, CONTAINER_LIST_NAME, containerNames, PHASES, PHASE_IDS, phase, phaseLabel, SEASONS, TRANSPORTS, CONTEXTS, DEFAULT_STORAGE_LOCATIONS,
  DEFAULT_PHASES, PHASE_DEFAULT_EMOJI, coercePhase, newPhase, setPhases, phasesCustomised, phaseOrFallback, phaseColor, defaultPhaseId,
  ACTIVITY_ORDER, orderActivities,
  CATERING, cateringLabel, CHARGE_TYPES, chargeTypeShort, chargeTypeLabel, ITEM_CONDITIONS, RETIRE_REASONS, retireReasonLabel, CURRENCIES, GROUPS, GROUP_IDS, groupLabel, id, normName, newItem, newList, newEvent,
  TEMPLATE_DEFAULT_EMOJI, TEMPLATE_COLORS, listEmoji, listColor,
  isPhotoRef,
  ITEM_CONDITION_IDS, itemConditionLabel, sectionName, sortRowsBy, groupRowsBy,
  DEFAULT_ITEM_CONDITIONS, CONDITION_TONES, coerceCondition, newCondition, setItemConditions,
  itemCondition, conditionTone, conditionReplaces, careSections, MAINTENANCE_UPCOMING_DAYS,
  buildTotalEntries, regenerateEntries, entriesByPhase, groupByContainer, groupByCategory, groupBy, groupItemsBySection, newSection,
  progress, packSteps, totalListRows, applyReview, pruneSuggestions,
  effectiveQty, qtyNights, LAUNDRY_CAP_NIGHTS, bagLoads, containerLimits, packingFlags, daysUntil, countdownLabel, tripNudge, nightsBetween, endFromNights,
  buildTripBundle, encodeTripLink, fromBase64Url,
  deriveWeather, weatherSuggestions, weatherGear, WEATHER_CONDITIONS,
  placesVisited, eventsNeedingCoords, coerceGeo, tripPath, mostVisited,
  MAINTENANCE_INTERVALS, MAINTENANCE_SOON_DAYS, hasCare, maintenanceStatus, normalizeMaintenance, MAX_PHOTOS,
  maintenanceList, maintenanceSummary, maintenanceByDate, logMaintenance, addDays, daysBetween,
  newAction, coerceAction, ACTION_PRIORITIES, actionPriorityLabel, compareActions,
  newKit, coerceKit, kitEmoji, clusterByKit, KIT_DEFAULT_EMOJI,
  shoppingReason, shoppingSuggestions, openShoppingCount,
  PERSON_COLORS, coercePerson, newPerson, personColor, assignedPeople, DEFAULT_PEOPLE,
  SHARED_KINDS, sharedRowId, sharedRowsOfKind, sharedRowsFrom, isFactoryList,
  conditionsFromRows, peopleFromRows, namesFromRows, orderedNamesFromRows, ownersByUsage, namesToRows, presetsFromRows, presetsToRows,
  monthKey, shiftMonth, monthGrid, rangeCellState, orderRange,
  catalogRows, duplicateGroups, duplicateIds,
  backupCounts, backupShrinks, presetConfigFromEvent, applyPresetConfig,
  backupState, backupSnoozeDays, newestChangeAt, oldestCreatedAt, BACKUP_DUE_DAYS, BACKUP_URGENT_DAYS,
  linkFromResolved, itemFromEntry, templateDefaults, mapSectionAcrossTemplates,
  looksLikeEmail, ownerNameFromEmail,
} from './model.js';
import * as db from './db.js';
import * as weather from './weather.js';
import { buildWorkbook, XLSX_MIME } from './xlsx.js';
import { WORLD_PATH, MAP_W, MAP_H, project } from './worldmap.js';

const app = document.getElementById('app');
// Single source of truth for the shown release. Bump alongside the service-worker
// cache tag and the newest version-history entry.
const APP_VERSION = 'v128';
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const todayISO = () => new Date().toISOString().slice(0, 10);

// Read a picked image file, downscale it to a sensible max edge and re-encode as a
// compact JPEG data URL — so an item photo is a few tens of KB in IndexedDB, not
// several MB. Runs entirely on-device; the file never leaves the browser.
function readImageResized(file, maxEdge = 900, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const hgt = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = hgt;
      canvas.getContext('2d').drawImage(img, 0, 0, w, hgt);
      try { resolve(canvas.toDataURL('image/jpeg', quality)); }
      catch (err) { reject(err); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
    img.src = url;
  });
}

// Shrink an existing data URL. Used to make the small `thumb` an item carries for
// list rows — the full image stays in the photos store and is only loaded when
// you actually open the item or the lightbox.
const THUMB_EDGE = 140;
function resizeDataURL(dataURL, maxEdge = THUMB_EDGE, quality = 0.6) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const hgt = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = hgt;
      canvas.getContext('2d').drawImage(img, 0, 0, w, hgt);
      try { resolve(canvas.toDataURL('image/jpeg', quality)); }
      catch (err) { reject(err); }
    };
    img.onerror = () => reject(new Error('Could not read that image.'));
    img.src = dataURL;
  });
}
const makeThumb = (dataURL) => resizeDataURL(dataURL);

// Full-screen photo viewer: tap a thumbnail to enlarge, tap anywhere (or Esc) to close.
function openPhotoLightbox(src) {
  if (!src) return;
  const ov = h(`<div class="overlay photo-lightbox"><img src="${esc(src)}" alt=""></div>`);
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (ev) => { if (ev.key === 'Escape') close(); };
  ov.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.appendChild(ov);
}

// Storage locations powering every item's "Where it's stored" dropdown. The list
// is the user's saved set of places (falling back to DEFAULT_STORAGE_LOCATIONS)
// plus any place already in use on an item, so the wording stays consistent
// instead of being retyped slightly differently. The saved set is
// add/rename/remove-able in Settings and — since v120 — shared between devices.
let STORAGES = [];

// ---------- The five lists you author, shared between your devices ----------
//
// Conditions · Trip presets · People · Owners · Storage places. They live in one
// synced store, one row per entry; the shape and the reasoning are in model.js,
// the storage in db.js. THIS is the copy every screen reads.
//
// It has to be readable synchronously — `personColor()` runs once per row, and
// the Owner dropdown is built inside a template string — so the rows are cached
// here and re-read by `refreshShared()`: on every render, whenever the app comes
// back to the fore, and at the top of Settings. A device left open therefore
// cannot keep working from a list the other device has since changed.
let SHARED_ROWS = [];
// Which lists are really IN the store, as opposed to being shown from this
// device's pre-v120 copy or from the code's defaults. The distinction matters:
// see `sharedStored` below.
let SHARED_STORED = new Set();
// THE ONLY PLACE THE CACHE IS SET. Every read and every write comes through here,
// because what the store hands back is only part of the answer: a list it has no
// rows for still has to show this device's own copy. Assigning the store's rows
// straight to the cache would blank every list except the one just written.
function adoptSharedRows(stored) {
  SHARED_STORED = new Set(stored.map((r) => r.kind));
  SHARED_ROWS = withLegacyLists(stored);
  return SHARED_ROWS;
}
// 🚨 NEVER RE-RENDER OVER SOMEONE'S TYPING.
//
// v120 gave three things permission to redraw the whole screen on their own: the
// one-time re-download, the one-time adoption, and coming back to the app. Each is
// right to redraw — the lists may have changed — but each can also land seconds
// after launch, which is exactly when Martin was in an item editor typing a new
// storage place. The redraw took the open editor with it, and the half-finished
// edit was simply gone: he saved nothing and nothing reached the list.
//
// A background refresh is never urgent. If an editor is open or a field has focus,
// skip it — the next time the screen is drawn it reads the fresh lists anyway.
function busyEditing() {
  // `.dr-open` = the trip date picker is open. Its trigger is a button, so the
  // activeElement test below would miss it and a background refresh could redraw
  // the whole event form — and the half-typed trip name with it.
  if (document.querySelector('.editor, .act-editor, .overlay, .dr-open')) return true;
  const el = document.activeElement;
  return !!(el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}
// Redraw only when it cannot cost anything.
function renderIfIdle() { if (!busyEditing()) render(); }

async function refreshShared() {
  const stored = await db.getSharedRows().catch(() => null);
  if (stored) adoptSharedRows(stored);
  // The live condition list every screen and every save reads. Installed here so
  // one re-read keeps all of it in step.
  setItemConditions(loadConditions());
  return SHARED_ROWS;
}
// Until this device's own pre-v120 lists have been adopted into the account, keep
// showing them: a list with no stored rows falls back to what this device had in
// localStorage, and only then to the factory list in the code. This is IN MEMORY
// ONLY — actually adopting them is `db.migrateSharedLists()`, which waits until it
// has seen the account's copy so it can never write over it. A list the account
// already has always wins, so this can never resurrect anything.
function withLegacyLists(rows) {
  const out = rows.slice();
  for (const kind of SHARED_KINDS) {
    if (rows.some((r) => r.kind === kind)) continue;
    const legacy = db.legacySharedList(kind);
    if (!legacy || !legacy.length || isFactoryList(kind, legacy)) continue;
    out.push(...sharedRowsFrom(kind, legacy));
  }
  return out;
}
// Is the list in force something other than the factory one? Counts this device's
// pre-v120 copy, because that IS the user's list — it just hasn't been adopted
// yet. Drives the Settings summary lines and decides whether a backup carries the
// list at all (a backup must never plant the defaults as data).
const sharedCustomised = (kind) => sharedRowsOfKind(SHARED_ROWS, kind).length > 0;
// Is the list actually IN the store? Deliberately NOT the same question. Adding or
// removing one entry writes one row — but only once there are rows to add it to.
// While the list on screen is coming from the code's defaults or from this
// device's pre-v120 copy, the FIRST edit has to write the whole list down, or
// storing one entry would silently discard everything shown beside it.
const sharedStored = (kind) => SHARED_STORED.has(kind);

// --- The three ways to write. Each returns after the store is updated, and each
// keeps the cache exact; the cache is also updated up front so a redraw that does
// not wait still shows the right thing.
//
// Replace ONE WHOLE LIST — for reorders, resets and restores.
// `opts.remove` names the row ids this save is deliberately getting rid of (a
// rename's old row, a deleted entry); `opts.clear` empties the kind outright, for a
// reset. Anything not named survives — see the note in db.js for what omission used
// to cost.
async function writeSharedKind(kind, list, opts = {}) {
  const gone = new Set(opts.clear ? SHARED_ROWS.filter((r) => r.kind === kind).map((r) => r.id) : (opts.remove || []));
  const byId = new Map(SHARED_ROWS.filter((r) => !gone.has(r.id)).map((r) => [r.id, r]));
  for (const r of sharedRowsFrom(kind, list)) byId.set(r.id, r);
  SHARED_ROWS = [...byId.values()];
  return adoptSharedRows(await db.replaceSharedKind(kind, list, opts));
}
// Add or update SINGLE ENTRIES, touching nothing else. This is what an "add" and
// a "rename" use, so a screen holding a stale list can't delete an entry made on
// the other device just by saving what it happens to be holding.
async function putShared(rows) {
  const byId = new Map(SHARED_ROWS.map((r) => [r.id, r]));
  for (const r of rows) byId.set(r.id, r);
  SHARED_ROWS = [...byId.values()];
  return adoptSharedRows(await db.putSharedRows(rows));
}
// One past the end of a list, for a row being added ON ITS OWN.
//
// 🪤 `namesToRows`/`presetsToRows` number a list from 0, so a ONE-ENTRY list comes
// out as `order: 0` — and a single-row write therefore lands the new entry at the
// FRONT. That was invisible while every one of these lists was read back A–Z; the
// moment Storage places gained an order of its own (v125) it meant every place you
// typed on an item jumped to the top of everybody's dropdown. Any list that is read
// back in its stored order must number an appended row itself.
function nextSharedOrder(kind) {
  const rows = sharedRowsOfKind(SHARED_ROWS, kind);
  return rows.length ? Math.max(...rows.map((r) => r.order)) + 1 : 0;
}
// A row that is genuinely new goes on the end; one that already exists KEEPS the
// place it had. (Saving a trip preset under a name you already used is an update,
// and it should not jump to the bottom of the Home preset bar for it.)
function appendedShared(kind, rows) {
  const have = new Map(sharedRowsOfKind(SHARED_ROWS, kind).map((r) => [r.id, r.order]));
  let next = nextSharedOrder(kind);
  return rows.map((r) => (have.has(r.id) ? { ...r, order: have.get(r.id) } : { ...r, order: next++ }));
}

// Remove SINGLE ENTRIES. A real delete, so the removal reaches the other device
// instead of the two lists merging back together on the next sync.
async function deleteShared(ids) {
  const gone = new Set(ids);
  SHARED_ROWS = SHARED_ROWS.filter((r) => !gone.has(r.id));
  return adoptSharedRows(await db.deleteSharedRows(ids));
}

// --- Data safety: persistent storage + backup reminders ---
// All data lives in this device's IndexedDB (see db.js). Two guards:
//  (1) ask the browser to mark that storage "persistent" so it isn't evicted
//      under storage pressure or Safari's inactivity clean-up;
//  (2) keep track of when the user last exported a backup and nudge them when
//      it's been a while, since a saved file is the real insurance.
const LAST_BACKUP_KEY = 'ams-last-backup';        // YYYY-MM-DD of the last JSON export
const LAST_BACKUP_AT_KEY = 'ams-last-backup-at';  // full ISO timestamp of the same, so a same-day edit still counts as unsaved
const FIRST_USE_KEY = 'ams-first-use';            // YYYY-MM-DD first launch, so "never backed up" can escalate too
const BACKUP_NUDGE_SNOOZE_KEY = 'ams-backup-snooze'; // YYYY-MM-DD until which the home nudge stays hidden

// Ask the browser to protect our storage from automatic eviction. Safe to call
// every launch: it's a no-op once granted, and silently unsupported elsewhere.
async function ensurePersistentStorage() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (!(await navigator.storage.persisted())) await navigator.storage.persist();
    }
  } catch { /* unsupported — ignore */ }
}
async function storageProtected() {
  try { return !!(navigator.storage && navigator.storage.persisted && await navigator.storage.persisted()); }
  catch { return false; }
}
function lastBackupISO() { try { return localStorage.getItem(LAST_BACKUP_KEY) || ''; } catch { return ''; } }
// The precise moment of the last backup. Falls back to the older date-only key so
// an existing install doesn't suddenly look as if it has never backed up.
function lastBackupAt() {
  try { return localStorage.getItem(LAST_BACKUP_AT_KEY) || lastBackupISO(); } catch { return ''; }
}
function markBackedUp() {
  try {
    localStorage.setItem(LAST_BACKUP_KEY, todayISO());
    localStorage.setItem(LAST_BACKUP_AT_KEY, new Date().toISOString());
    localStorage.removeItem(BACKUP_NUDGE_SNOOZE_KEY); // a fresh file clears any snooze
  } catch { /* ignore */ }
}
// Remember when this device started being used, so someone who has never saved a
// file still sees the reminder escalate instead of sitting on a gentle amber for
// ever. On an install that predates this key, we date it from the OLDEST trip or
// template rather than today — otherwise a years-old unprotected catalogue would
// look brand new the day this version arrives, which is exactly backwards.
function firstUseAt(oldestKnown = '') {
  try {
    const stored = localStorage.getItem(FIRST_USE_KEY) || '';
    const seed = (oldestKnown && (!stored || oldestKnown < stored) ? oldestKnown : stored) || todayISO();
    const ymd = String(seed).slice(0, 10);
    if (ymd !== stored) localStorage.setItem(FIRST_USE_KEY, ymd);
    return ymd;
  } catch { return ''; }
}
// Whole days since the last backup, or null if one has never been made.
function daysSinceBackup() {
  const iso = lastBackupISO();
  if (!iso) return null;
  const ms = Date.now() - new Date(`${iso}T00:00:00`).getTime();
  return ms >= 0 ? Math.floor(ms / 86400000) : 0;
}
function snoozeBackupNudge(level) {
  const days = backupSnoozeDays(level);
  const until = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  try { localStorage.setItem(BACKUP_NUDGE_SNOOZE_KEY, until); } catch { /* ignore */ }
}
function backupNudgeSnoozed() {
  try { const u = localStorage.getItem(BACKUP_NUDGE_SNOOZE_KEY); return !!u && u > todayISO(); }
  catch { return false; }
}
// Where this device stands on backups, from the data already loaded for the screen.
// `hasData` is deliberately "at least one trip" — an empty install has nothing to lose.
function currentBackupState(events, lists, actions) {
  return backupState({
    lastBackupAt: lastBackupAt(),
    changedAt: newestChangeAt(events, lists, actions, ALL_KITS),
    firstUseAt: firstUseAt(oldestCreatedAt(events, lists)),
    hasData: !!(events && events.length),
  });
}

// Save a dated backup FILE, in one tap, from wherever the user is. This is the
// whole point of the reminder: Safari can't be handed a folder to write into, but
// it can put a file straight in Downloads with no dialog, which is just as good a
// safety net as long as it actually happens. Returns the filename, or '' on failure.
async function saveBackupFile({ quiet = false } = {}) {
  try {
    const json = await db.exportJSON({ prefs: collectPrefs() });
    const filename = `ams-packing-list-backup-${todayISO()}.json`;
    downloadBlob(new Blob([json], { type: 'application/json' }), filename);
    markBackedUp();  // note when we last backed up, to keep the reminder honest
    if (!quiet) showToast(`Backup saved — look in your Downloads folder for ${filename}`, 5000);
    return filename;
  } catch (err) {
    logDiag('backup-save-failed', err);
    if (!quiet) showToast('Could not save the backup — please try again from Settings.', 5000);
    return '';
  }
}

// A plain-language one-liner for a set of backup counts ({items,templates,events,actions}).
function countsSummary(c) {
  if (!c) return '';
  const parts = [
    `${c.items} item${c.items === 1 ? '' : 's'}`,
    `${c.templates} template${c.templates === 1 ? '' : 's'}`,
    `${c.events} trip${c.events === 1 ? '' : 's'}`,
  ];
  if (c.actions) parts.push(`${c.actions} to-do${c.actions === 1 ? '' : 's'}`);
  if (c.photos) parts.push(`${c.photos} photo${c.photos === 1 ? '' : 's'}`);
  return parts.join(' · ');
}
// Best-effort on-device storage used, for the data card. '' when unavailable.
async function storageUsedLabel() {
  try {
    const e = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
    const n = e && e.usage ? e.usage : 0;
    if (!n) return '';
    const mb = n / 1048576;
    return mb >= 1 ? `${mb.toFixed(mb >= 10 ? 0 : 1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
  } catch { return ''; }
}
// Friendly label + relative age for an automatic snapshot.
const SNAPSHOT_REASONS = { auto: 'Automatic', 'before-restore': 'Before a restore', manual: 'Saved by you' };
function snapshotWhen(iso) {
  const t = new Date(iso).getTime();
  if (!t) return '';
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString();
}

// --- Diagnostics: a tiny on-device log of errors, so a glitch on the phone can be
// seen (and copied for a fix) instead of vanishing. Newest-first, capped, and it
// only ever holds error text the app itself produced. ---
const DIAG_KEY = 'ams-diagnostics';
const DIAG_MAX = 30;
function loadDiag() {
  try { const raw = localStorage.getItem(DIAG_KEY); if (raw) { const a = JSON.parse(raw); if (Array.isArray(a)) return a; } } catch { /* ignore */ }
  return [];
}
function logDiag(context, err) {
  try {
    const entry = {
      t: new Date().toISOString(),
      ctx: String(context || ''),
      msg: String((err && err.message) || err || 'Unknown error').slice(0, 300),
      stack: err && err.stack ? String(err.stack).split('\n').slice(0, 4).join(' | ').slice(0, 500) : '',
    };
    localStorage.setItem(DIAG_KEY, JSON.stringify([entry, ...loadDiag()].slice(0, DIAG_MAX)));
  } catch { /* never let logging break anything */ }
}
function clearDiag() { try { localStorage.removeItem(DIAG_KEY); } catch { /* ignore */ } }
function diagAsText() {
  return loadDiag().map((e) => `[${e.t}] (${e.ctx}) ${e.msg}${e.stack ? `\n    ${e.stack}` : ''}`).join('\n\n')
    || 'No errors logged.';
}
// Catch anything uncaught, app-wide.
window.addEventListener('error', (e) => logDiag('window', (e && e.error) || (e && e.message)));
window.addEventListener('unhandledrejection', (e) => logDiag('promise', e && e.reason));
// The saved set of places. Nothing stored means the standard set from the code —
// so an untouched app behaves exactly as it always did, and no device ever plants
// the defaults into shared data for the other one to collide with.
// Since v125 the ORDER is yours: the rows come back in the order they are stored,
// not A–Z, so the places you reach for most can sit at the top of every dropdown.
function loadStorageLocs() {
  const names = orderedNamesFromRows(SHARED_ROWS, 'places');
  return names.length ? names : DEFAULT_STORAGE_LOCATIONS.slice();
}
// The whole list at once — for a reorder, a rename or a removal, where the point IS
// the list. The order it is given in is the order that is written down.
async function saveStorageLocs(arr, opts = {}) {
  // De-duplicate case-insensitively, keeping the first spelling. Deliberately NOT
  // sorted: this used to end `.sort()`, which would now quietly undo every reorder.
  const seen = new Map();
  for (const s of arr) { const t = (s || '').trim(); const k = t.toLowerCase(); if (t && !seen.has(k)) seen.set(k, t); }
  const clean = [...seen.values()];
  await writeSharedKind('places', clean, opts);
  return clean;
}
// Add a place to the saved set if it isn't already there (case-insensitive).
// Deliberately ONE ROW: this is called whenever an item is saved with a place the
// list hasn't got, and an item save must never rewrite the whole shared list.
async function rememberStorageLoc(name) {
  const t = (name || '').trim();
  if (!t) return;
  const locs = loadStorageLocs();
  if (locs.some((s) => s.toLowerCase() === t.toLowerCase())) return;
  // Never let this stop the item being saved. It is a side-effect of the save —
  // "the place you typed joins the list" — and the place is written on the item
  // either way. Letting a failure here throw would abort the whole save and lose
  // everything else the editor was holding.
  try {
    if (!sharedStored('places')) await saveStorageLocs([...locs, t]);
    else await putShared(appendedShared('places', namesToRows('places', [t])));
  } catch (err) {
    logDiag('storage-place', err);
  }
}
// Rename a saved place and carry the new spelling onto every item using the old
// one, so nothing is orphaned. Returns how many items were updated.
async function renameStorageLoc(oldName, newName) {
  const from = (oldName || '').trim();
  const to = (newName || '').trim();
  if (!from || !to || from.toLowerCase() === to.toLowerCase()) return 0;
  await saveStorageLocs(loadStorageLocs().map((s) => (s.toLowerCase() === from.toLowerCase() ? to : s)).concat(to),
    { remove: [sharedRowId('places', from)] });
  const lists = await db.getLists();
  let count = 0;
  for (const l of lists) {
    let changed = false;
    for (const it of l.items) if (it.storage && it.storage.trim().toLowerCase() === from.toLowerCase()) { it.storage = to; changed = true; count += 1; }
    if (changed) await db.saveList(l);
  }
  return count;
}
// Removing one place deletes one row — so the removal reaches the other device
// without this screen's copy of the rest of the list being written over it.
async function removeStorageLoc(name) {
  const t = (name || '').trim();
  if (!t) return;
  if (!sharedStored('places')) {
    await saveStorageLocs(loadStorageLocs().filter((s) => s.toLowerCase() !== t.toLowerCase()),
      { remove: [sharedRowId('places', t)] });
    return;
  }
  await deleteShared([sharedRowId('places', t)]);
}
// Every place a dropdown should offer: the list you keep in Settings, IN THE ORDER
// YOU ARRANGED IT, followed by anything an item mentions that the list hasn't got
// (a place typed on the other device, say), A–Z. Sorting the whole thing would
// throw your order away; interleaving the strays into it would be worse.
function collectStorages(lists) {
  const seen = new Map();   // lowercase key -> display spelling, your order
  const extra = new Map();  // in use on an item, but not on the list
  for (const s of loadStorageLocs()) { const t = s.trim(); if (t) seen.set(t.toLowerCase(), t); }
  for (const l of lists) for (const it of l.items) if (it.storage) {
    const t = it.storage.trim();
    if (t && !seen.has(t.toLowerCase())) extra.set(t.toLowerCase(), t);
  }
  return [...seen.values(), ...[...extra.values()].sort((a, b) => a.localeCompare(b))];
}

// The distinct values already used for a given item field (color / size /
// manufacturer…), across every item. Powers the "growing" dropdowns: the choices
// ARE whatever you've entered before, so the list fills itself as you use the app
// — no separate management needed. Case-insensitive de-dupe, keeps first spelling.
function collectItemValues(field, lists = ALL_LISTS) {
  const seen = new Map();
  for (const l of lists) for (const it of (l.items || [])) {
    const v = (it[field] || '').trim();
    if (v && !seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

// A small "condition" badge for an item row. Which conditions badge — and how
// loudly — is now yours to set in Settings: a condition with no tone stays silent,
// so healthy gear is quiet by default. A "needs replacing" condition gets the swap
// glyph, whatever you called it.
function conditionBadgeHTML(it) {
  const c = itemCondition(it.condition);
  if (!c || !c.tone) return '';
  const glyph = c.replace ? `${ic('swap','xs')} ` : '';
  return `<span class="badge cond ${esc(c.tone)}" title="Item condition: ${esc(c.label)}">${glyph}${esc(c.label)}</span>`;
}

// The options for a Condition picker. An item carrying a condition this device has
// no name for — set on your other device, or on one you since removed — keeps it as
// its own option, so simply opening and saving the item can never quietly erase it.
function conditionOpts(cur = '') {
  const opts = [{ value: '', label: '— not set —' }, ...ITEM_CONDITIONS.map((c) => ({ value: c.id, label: c.label }))];
  if (cur && !ITEM_CONDITION_IDS.includes(cur)) opts.push({ value: cur, label: `${cur} (not in your list)` });
  return opts;
}

// All building-block lists (resolved), kept so the item editor's "In these
// templates" matrix can show — by the item's stable catalog id — which templates
// it currently belongs to. Refreshed whenever a list opens.
let ALL_LISTS = [];

// Every stored action, cached so item rows can show a pending-action badge and the
// item editor can seed its action buffer synchronously. Refreshed on each render.
let ALL_ACTIONS = [];
async function refreshActions() { ALL_ACTIONS = await db.getActions(); return ALL_ACTIONS; }
const openActionsForItem = (itemId) => (itemId ? ALL_ACTIONS.filter((a) => a.itemId === itemId && !a.done).length : 0);

// Every stored kit, cached so the "Add a kit" pickers (template + trip) and the
// packing-list kit clusters can read them synchronously. Refreshed on each render.
let ALL_KITS = [];
async function refreshKits() { ALL_KITS = await db.getKits(); return ALL_KITS; }

// The "Loose items" bin — where items live before they belong to any template.
// It's a real list under the hood (so the editor, care, matrix all work) but
// carries role 'loose', which keeps it out of every trip and the activity picker.
const LOOSE_NAME = 'Loose items';
const LOOSE_OPT = '__loose__'; // sentinel value for the "No template" choice in the Care "New item" picker
async function getLooseList() {
  const lists = await db.getLists();
  let loose = lists.find((l) => l.role === 'loose');
  if (!loose) { loose = newList({ name: LOOSE_NAME, role: 'loose', builtin: true }); await db.saveList(loose); }
  return loose;
}
// The "Containers" catalogue — the bags/duffels/backpacks themselves, each a
// maintainable item (photos, colour, brand, capacity, storage, care). A real list
// under the hood with role 'container', so the item editor / care / backup all
// work; role 'container' keeps it out of trips, the activity picker and Templates.
async function getContainerList() {
  const lists = await db.getLists();
  let c = lists.find((l) => l.role === CONTAINER_ROLE);
  if (!c) { c = newList({ name: CONTAINER_LIST_NAME, role: CONTAINER_ROLE, builtin: true }); await db.saveList(c); }
  return c;
}
// The Containers screen (#/containers) — the bags catalogue, reached from the Care
// tab. It reuses the container-aware list renderer, so it's the same rich editor.
async function renderContainers() {
  const c = await getContainerList();
  return renderList(c.id);
}
// The ① "the item itself" columns of the All-items table, defined once so the
// user can reorder them. Each has a stable `key` (used for header, cell rendering
// and persistence) and a display `label`.
const GRID_ITEM_COLS = [
  { key: 'weight', label: 'Weight' },
  { key: 'storage', label: 'Storage' },
  { key: 'liquid', label: 'Liquid', icon: 'drop' },
  { key: 'charging', label: 'Charging', icon: 'bolt' },
  { key: 'restricted', label: 'Restricted', icon: 'warn' },
  { key: 'container', label: 'Container' },
  { key: 'color', label: 'Color' },
  { key: 'size', label: 'Size' },
  { key: 'manufacturer', label: 'Maker' },
  { key: 'model', label: 'Model' },
  { key: 'ownedBy', label: 'Owner' },
];
// The sort choices offered in the table's toolbar. `val` extracts the comparable
// value from a row; `num` marks numeric fields (compared arithmetically).
const GRID_SORTS = [
  { key: 'name', label: 'Name', val: (r) => (r.item.name || '').toLowerCase() },
  { key: 'weight', label: 'Weight', val: (r) => r.item.weight || 0, num: true },
  { key: 'storage', label: 'Storage', val: (r) => (r.item.storage || '').toLowerCase() },
  { key: 'container', label: 'Container', val: (r) => (r.item.container || '').toLowerCase() },
  { key: 'templates', label: 'In # lists', val: (r) => r.mems.length, num: true },
];
const GRID_SORT_KEY = 'ams.grid.sort';
const GRID_COLS_KEY = 'ams.grid.cols';

// Load the saved sort preference (field + direction), defaulting to A–Z by name.
function loadGridSort() {
  try { const s = JSON.parse(localStorage.getItem(GRID_SORT_KEY) || 'null');
    if (s && GRID_SORTS.some((x) => x.key === s.by)) return { by: s.by, dir: s.dir === 'desc' ? 'desc' : 'asc' };
  } catch { /* ignore */ }
  return { by: 'name', dir: 'asc' };
}
function saveGridSort(s) { try { localStorage.setItem(GRID_SORT_KEY, JSON.stringify(s)); } catch { /* ignore */ } }

// Load the saved column order. Unknown keys are dropped and any newly-added
// columns are appended, so the stored order stays valid across app updates.
function loadGridCols() {
  const all = GRID_ITEM_COLS.map((c) => c.key);
  try { const saved = JSON.parse(localStorage.getItem(GRID_COLS_KEY) || 'null');
    if (Array.isArray(saved)) {
      // 'owner' was renamed to 'ownedBy' in v117 (see model.js) — honour a column
      // order saved before that so the Owner column keeps its place.
      const known = saved.map((k) => (k === 'owner' ? 'ownedBy' : k)).filter((k) => all.includes(k));
      return [...known, ...all.filter((k) => !known.includes(k))];
    }
  } catch { /* ignore */ }
  return all;
}
function saveGridCols(order) { try { localStorage.setItem(GRID_COLS_KEY, JSON.stringify(order)); } catch { /* ignore */ } }

// A small modal to reorder the ① item columns with ▲▼ (mirrors manageSections).
// Resolves to the new order array on save, or null if cancelled.
function manageGridColumns(order) {
  return new Promise((resolve) => {
    let cols = order.slice();
    const overlay = h('<div class="overlay"></div>');
    const body = h('<div class="modal cols-modal"></div>');
    overlay.appendChild(body);
    document.body.appendChild(overlay);
    let settled = false;
    const finish = (res) => { if (settled) return; settled = true; overlay.remove(); document.removeEventListener('keydown', onKey); resolve(res); };
    const onKey = (e) => { if (e.key === 'Escape') finish(null); };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(null); });
    const labelOf = (k) => (GRID_ITEM_COLS.find((c) => c.key === k) || {}).label || k;
    const draw = () => {
      const rows = cols.map((k, i) => `<div class="col-row" data-i="${i}">
        <span class="col-name">${labelOf(k)}</span>
        <button class="iconbtn sm" data-m="up" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${ic('up','sm')}</button>
        <button class="iconbtn sm" data-m="down" ${i === cols.length - 1 ? 'disabled' : ''} aria-label="Move down">${ic('down','sm')}</button>
      </div>`).join('');
      body.innerHTML = `<h2>Column order</h2>
        <p class="modal-sub">Reorder the “① the item itself” columns. Your choice is remembered on this device.</p>
        <div class="col-rows">${rows}</div>
        <div class="modal-actions">
          <button class="btn primary lg" data-m="save">Save order</button>
          <button class="btn ghost lg" data-m="reset">Reset</button>
          <button class="btn ghost lg" data-m="cancel">Cancel</button>
        </div>`;
    };
    draw();
    body.addEventListener('click', (e) => {
      const m = e.target.closest('[data-m]')?.dataset.m;
      if (!m) return;
      if (m === 'cancel') { finish(null); return; }
      if (m === 'save') { finish(cols.slice()); return; }
      if (m === 'reset') { cols = GRID_ITEM_COLS.map((c) => c.key); draw(); return; }
      const row = e.target.closest('.col-row'); if (!row) return;
      const i = Number(row.dataset.i);
      if (m === 'up' && i > 0) { [cols[i - 1], cols[i]] = [cols[i], cols[i - 1]]; draw(); }
      else if (m === 'down' && i < cols.length - 1) { [cols[i + 1], cols[i]] = [cols[i], cols[i + 1]]; draw(); }
    });
  });
}

// The global "All items" TABLE (#/items) — every item as a row, with editable
// columns grouped like the item editor: ① the item itself (intrinsic — edits apply
// everywhere), ② in this list (qty/section — editable only when the item is in one
// template), and ③ a tick-matrix of template membership. Reached from the Care tab.
async function renderItemsGrid() {
  const wrap = h('<section class="screen screen-grid"></section>');
  wrap.appendChild(h(`<div class="topbar"><a class="iconbtn" href="#/maintenance" aria-label="Back">${IC.back}</a><h1 class="grow">All items · table</h1></div>`));
  wrap.appendChild(h('<p class="muted pad">Edit lots of items at once. Fields under <b>the item itself</b> (weight, storage, flags, colour…) update the item <b>everywhere</b> it’s used. Tap a template box to file the item in or out. <b>Qty/Section</b> are editable when an item is in a single template. Use the toolbar to <b>sort</b> the table and reorder columns with <b>Columns</b>; swipe sideways for more columns.</p>'));

  let lists = await db.getLists();
  let rowsById = new Map();
  let sort = loadGridSort();
  let colOrder = loadGridCols();

  // Toolbar: search on the left, sort controls and a "Columns" button on the right.
  const toolbar = h(`<div class="grid-toolbar">
    <label class="ai-searchbox">${IC.search}<input type="search" class="grid-search" placeholder="Search items…" autocomplete="off"></label>
    <div class="grid-controls">
      <label class="grid-sortby">Sort
        <select class="grid-sortsel">${GRID_SORTS.map((s) => `<option value="${s.key}"${s.key === sort.by ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}</select>
      </label>
      <button type="button" class="iconbtn sm grid-sortdir" aria-label="Toggle sort direction"></button>
      <button type="button" class="btn ghost sm grid-colsbtn">${IC.sheet}<span>Columns</span></button>
    </div>
  </div>`);
  wrap.appendChild(toolbar);
  const scroll = h('<div class="grid-scroll"></div>');
  wrap.appendChild(scroll);
  let query = '';
  const dirBtn = $('.grid-sortdir', toolbar);
  const paintDir = () => { dirBtn.textContent = sort.dir === 'desc' ? '▼' : '▲'; dirBtn.title = sort.dir === 'desc' ? 'Descending' : 'Ascending'; };
  paintDir();

  // Render a single ① "item itself" cell by column key. Container stays per-list:
  // it's an editable dropdown for single-template items, plain text otherwise.
  const cellFor = (key, row, single) => {
    const it = row.item;
    if (['liquid', 'charging', 'restricted'].includes(key)) return `<td class="g-check"><input type="checkbox" data-f="${key}"${it[key] ? ' checked' : ''}></td>`;
    if (key === 'weight') return `<td><input class="g-num" type="number" min="0" inputmode="numeric" data-f="weight" value="${it.weight || ''}"></td>`;
    if (key === 'storage') return `<td><input class="g-txt" list="grid-storages" data-f="storage" value="${esc(it.storage || '')}" autocomplete="off"></td>`;
    if (key === 'container') {
      if (single) return `<td><select class="g-sel" data-f="container" data-listid="${esc(single.listId)}">${containerOpts(single.container).map((c) => `<option value="${esc(c)}"${c === single.container ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></td>`;
      return `<td><span class="g-multi">${esc(it.container || '')}</span></td>`;
    }
    if (key === 'ownedBy') {
      // The very same Owners list as the item editor's picker, so the two always
      // agree — and it can be added to, renamed and pruned from right here.
      return `<td><select class="g-sel g-owner" data-f="ownedBy">${ownerOptsHTML(it.ownedBy, { empty: '—' })}</select></td>`;
    }
    return `<td><input class="g-txt" data-f="${key}" value="${esc(it[key] || '')}" autocomplete="off"></td>`; // color / size / maker / model
  };

  const rowHTML = (row, templates) => {
    const it = row.item;
    const memIds = new Set(row.mems.map((m) => m.listId));
    const single = row.mems.length === 1 ? row.mems[0] : null;
    const openLid = row.mems[0].listId;
    const itemCells = colOrder.map((k) => cellFor(k, row, single)).join('');
    // ② per-template columns — editable only for single-template items.
    let qtyCell; let sectionCell;
    if (single) {
      qtyCell = `<td><input class="g-num" type="number" min="0" inputmode="numeric" data-f="qty" data-listid="${esc(single.listId)}" value="${esc(single.qty || '')}"></td>`;
      const sl = lists.find((x) => x.id === single.listId);
      const secOpts = [{ value: '', label: '—' }].concat((sl && sl.sections || []).map((s) => ({ value: s.id, label: s.name })));
      sectionCell = `<td><select class="g-sel" data-f="section" data-listid="${esc(single.listId)}">${secOpts.map((o) => `<option value="${esc(o.value)}"${o.value === (single.section || '') ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select></td>`;
    } else {
      qtyCell = `<td><span class="g-multi" title="Set per list — open the item">${row.mems.length} lists</span></td>`;
      sectionCell = '<td><span class="g-multi">·</span></td>';
    }
    const matrix = templates.map((t) => `<td class="g-check"><input type="checkbox" data-tmpl="${esc(t.id)}"${memIds.has(t.id) ? ' checked' : ''}></td>`).join('');
    return `<tr data-id="${esc(row.id)}">
      <th class="cell-name" scope="row"><a href="#/list/${esc(openLid)}/item/${esc(row.id)}">${esc(it.name || '(unnamed)')}</a>${it.retired ? ` <span title="Not in use">${ic('ban','xs')}</span>` : ''}</th>
      ${itemCells}${qtyCell}${sectionCell}${matrix}
    </tr>`;
  };

  const build = () => {
    ALL_LISTS = lists;
    STORAGES = collectStorages(lists);
    const templates = lists.filter((l) => l.role !== 'loose' && l.role !== CONTAINER_ROLE).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    rowsById = new Map();
    for (const l of lists) {
      if (l.role === CONTAINER_ROLE) continue; // containers have their own screen
      for (const it of (l.items || [])) {
        const id = it._itemId; if (!id) continue;
        if (!rowsById.has(id)) rowsById.set(id, { id, item: it, mems: [] });
        rowsById.get(id).mems.push({ listId: l.id, listName: l.name, role: l.role, qty: it.qty, section: it.section, container: it.container });
      }
    }
    // Sort by the chosen field; ties fall back to name so the order is stable.
    const sd = GRID_SORTS.find((s) => s.key === sort.by) || GRID_SORTS[0];
    let rows = [...rowsById.values()].sort((a, b) => {
      const av = sd.val(a); const bv = sd.val(b);
      let c = sd.num ? (av - bv) : String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' });
      if (c === 0 && sd.key !== 'name') c = (a.item.name || '').localeCompare((b.item.name || ''), undefined, { sensitivity: 'base' });
      return sort.dir === 'desc' ? -c : c;
    });
    const q = query.trim().toLowerCase();
    if (q) rows = rows.filter((r) => (r.item.name || '').toLowerCase().includes(q));
    const colDef = (k) => GRID_ITEM_COLS.find((c) => c.key === k) || {};
    const colLabel = (k) => colDef(k).label || k;
    const colHead = (k) => { const c = colDef(k); return c.icon ? `<span title="${esc(c.label)}">${ic(c.icon, 'sm')}</span>` : esc(colLabel(k)); };
    const head = `<thead>
      <tr class="grp"><th class="cell-name" rowspan="2">Item <em>${rows.length}</em></th>
        <th colspan="${colOrder.length}">① The item itself</th><th colspan="2">② In this list</th><th colspan="${templates.length}">③ In these templates</th></tr>
      <tr class="col">${colOrder.map((k) => `<th>${colHead(k)}</th>`).join('')}
        <th>Qty</th><th>Section</th>${templates.map((t) => `<th class="tmpl-col"><span>${esc(t.name)}</span></th>`).join('')}</tr>
    </thead>`;
    const body = `<tbody>${rows.map((r) => rowHTML(r, templates)).join('') || '<tr><td class="g-empty" colspan="99">No items match your search.</td></tr>'}</tbody>`;
    const datalist = `<datalist id="grid-storages">${STORAGES.map((s) => `<option value="${esc(s)}"></option>`).join('')}</datalist>`;
    scroll.innerHTML = `<table class="grid">${head}${body}</table>${datalist}`;
  };

  const findItem = (lid, id) => { const l = lists.find((x) => x.id === lid); return { l, it: l && l.items.find((z) => z._itemId === id) }; };
  const ensureLoose = async () => {
    let loose = lists.find((x) => x.role === 'loose');
    if (!loose) { loose = newList({ name: 'Loose items', role: 'loose', builtin: true }); await db.saveList(loose); lists = await db.getLists(); loose = lists.find((x) => x.role === 'loose'); }
    return loose;
  };

  scroll.addEventListener('change', async (e) => {
    const el = e.target;
    const tr = el.closest('tr'); if (!tr) return;
    const id = tr.dataset.id; const row = rowsById.get(id); if (!row) return;

    if (el.dataset.tmpl) { // ③ membership matrix
      const lid = el.dataset.tmpl;
      const l = lists.find((x) => x.id === lid); if (!l) return;
      if (el.checked) {
        if (!l.items.some((z) => z._itemId === id)) l.items.unshift(linkFromResolved(row.item, id));
      } else {
        // Never orphan the item: if this was its only home, park it in Loose first.
        const others = row.mems.filter((m) => m.listId !== lid);
        if (!others.length) { const loose = await ensureLoose(); if (loose && !loose.items.some((z) => z._itemId === id)) { loose.items.unshift(linkFromResolved(row.item, id)); await db.saveList(loose); } }
        l.items = l.items.filter((z) => z._itemId !== id);
      }
      if (await saveGuard(db.saveList(l))) {
        lists = await db.getLists();
        // Auto-file: once in a real template, don't linger in Loose.
        const loose = lists.find((x) => x.role === 'loose');
        const inReal = lists.some((x) => x.role !== 'loose' && x.role !== CONTAINER_ROLE && x.items.some((z) => z._itemId === id));
        if (loose && inReal && loose.items.some((z) => z._itemId === id)) { loose.items = loose.items.filter((z) => z._itemId !== id); await db.saveList(loose); lists = await db.getLists(); }
        const sx = scroll.scrollLeft, sy = scroll.scrollTop; build(); scroll.scrollLeft = sx; scroll.scrollTop = sy;
        ALL_LISTS = lists;
      }
      return;
    }

    const f = el.dataset.f; if (!f) return;
    const { l, it } = findItem(el.dataset.listid || row.mems[0].listId, id);
    if (!it) return;
    if (f === 'ownedBy' && (el.value === '__new__' || el.value === '__manage__')) {
      if (el.value === '__manage__') {
        el.value = it.ownedBy || '';                      // put the picker back first
        const changes = await openOwnersManager();
        if (changes.size) { lists = await db.getLists(); ALL_LISTS = lists; }
        rebuild();                                        // every row's picker, and any moved names
        return;
      }
      const name = await addOwnerByName('');
      if (!name) { el.value = it.ownedBy || ''; return; } // cancelled — put the picker back
      it.ownedBy = name;
      await saveGuard(db.saveList(l));
      lists = await db.getLists(); ALL_LISTS = lists;
      rebuild();                                          // so the new name joins every other row's picker
      return;
    }
    if (['liquid', 'charging', 'restricted'].includes(f)) it[f] = el.checked;
    else if (f === 'weight') it.weight = Math.max(0, parseInt(el.value, 10) || 0);
    else if (f === 'qty' || f === 'container' || f === 'section') it[f] = f === 'qty' ? (el.value || '').trim() : el.value;
    else it[f] = (el.value || '').trim(); // storage / color / size / manufacturer / model
    await saveGuard(db.saveList(l));
    el.classList.add('g-saved'); setTimeout(() => el.classList.remove('g-saved'), 600);
  });

  // Rebuild while keeping the sideways/vertical scroll position steady.
  const rebuild = () => { const sx = scroll.scrollLeft, sy = scroll.scrollTop; build(); scroll.scrollLeft = sx; scroll.scrollTop = sy; };

  build();
  $('.grid-search', toolbar).addEventListener('input', (e) => { query = e.target.value; build(); });
  $('.grid-sortsel', toolbar).addEventListener('change', (e) => { sort.by = e.target.value; saveGridSort(sort); rebuild(); });
  dirBtn.addEventListener('click', () => { sort.dir = sort.dir === 'desc' ? 'asc' : 'desc'; saveGridSort(sort); paintDir(); rebuild(); });
  $('.grid-colsbtn', toolbar).addEventListener('click', async () => {
    const next = await manageGridColumns(colOrder);
    if (next) { colOrder = next; saveGridCols(colOrder); rebuild(); }
  });
  return wrap;
}

// Options for a "Container" (where a thing is packed) dropdown: the default names
// merged with the user's real container records, keeping the current value even if
// it's a one-off not in either set (so editing never silently drops it).
function containerOpts(cur) {
  const names = containerNames(ALL_LISTS || []);
  if (cur && !names.some((n) => n.toLowerCase() === cur.toLowerCase())) names.push(cur);
  return names;
}

// An item's name is "unfiled" when it appears in no real (non-loose) template.
function isUnfiled(name, lists = ALL_LISTS) {
  const key = (name || '').trim().toLowerCase();
  if (!key) return false;
  return !lists.some((l) => l.role !== 'loose' && (l.items || []).some((z) => (z.name || '').trim().toLowerCase() === key));
}

// Category quick-filters shared by the Care tab's "All items" index and each
// template's own item list: tap a chip to isolate a kind of thing (liquids to
// pack, chargeables, items with care info…). Chips are OR'd together.
const ITEM_FILTER_CATS = [
  { key: 'loose',      label: 'No template', icon: 'warn',     test: (it) => isUnfiled(it.name) },
  { key: 'liquid',     label: 'Liquids',     icon: 'drop',     test: (it) => !!it.liquid },
  { key: 'charge',     label: 'Charging',    icon: 'bolt',     test: (it) => !!it.charging },
  { key: 'restricted', label: 'Restricted',  icon: 'warn',     test: (it) => !!it.restricted },
  { key: 'consumable', label: 'Consumable',  icon: 'cart',     test: (it) => !!it.consumable },
  { key: 'care',       label: 'Has care',    icon: 'toolbox',  test: (it) => hasCare(it) },
  { key: 'photo',      label: 'Photo',       icon: 'camera',   test: (it) => (it.photos || []).length > 0 },
  { key: 'retired',    label: 'Not in use',  icon: 'ban',      test: (it) => !!it.retired },
];

// Chip-bar HTML for the given items and active filter Set. Only categories that
// actually occur are shown, each with a live count; a dashed "Show all" clears.
// `excludeLoose` drops the "No template" chip where it's meaningless (the Loose
// bin itself, where every item is unfiled). An ACTIVE chip is always kept even
// at zero, or a chip could disappear while still narrowing the list.
// `anyActive` decides whether "Show all" shows — the Care page passes its other
// filter groups in, so the clear button appears whatever kind of filter is on.
function itemFilterChipsHTML(items, filter, excludeLoose, anyActive = filter.size) {
  const cats = ITEM_FILTER_CATS.filter((c) => !(excludeLoose && c.key === 'loose'));
  const chips = cats.map((c) => ({ c, n: items.filter(c.test).length })).filter((x) => x.n || filter.has(x.c.key))
    .map(({ c, n }) => `<button class="fchip${filter.has(c.key) ? ' on' : ''}" type="button" data-cat="${c.key}">${c.icon ? ic(c.icon, 'sm') : ''}${c.label} <em>${n}</em></button>`)
    .join('');
  return chips ? `${chips}<button class="fchip clear" type="button" data-cat="__clear"${anyActive ? '' : ' hidden'}>Show all</button>` : '';
}

// Does an item pass the active category filter? (OR across the chosen chips.)
function itemMatchesFilter(it, filter) {
  if (!filter.size) return true;
  return [...filter].some((k) => { const c = ITEM_FILTER_CATS.find((x) => x.key === k); return c ? c.test(it) : false; });
}

// ---- Sorting & grouping for the Care tab's "All items" index ----------------
// A row there is { it, list, section } — a resolved item, the template it sits
// in, and that template's section name resolved for display. 545 rows is a lot
// to read as one alphabetical wall, so the index can be ordered and bucketed.

// The care state of an item, as a readable bucket name.
const AI_CARE_LABELS = { overdue: 'Overdue', soon: 'Due soon', ok: 'Upcoming', reference: 'Care notes only' };
const AI_CARE_ORDER = ['Overdue', 'Due soon', 'Upcoming', 'Care notes only'];
const aiCareLabel = (it) => { const s = maintenanceStatus(it); return s ? (AI_CARE_LABELS[s.state] || '') : ''; };

// Sort choices. `val(row)` pulls the comparable value; `num` compares
// arithmetically. Blanks always sink to the bottom (see sortRowsBy).
const AI_SORTS = [
  { key: 'name',         label: 'Alphabetically',    val: (r) => r.it.name || '' },
  { key: 'container',    label: 'Container',         val: (r) => r.it.container || '' },
  { key: 'storage',      label: 'Where it’s stored', val: (r) => r.it.storage || '' },
  { key: 'weight',       label: 'Weight',            val: (r) => r.it.weight || 0, num: true },
  { key: 'manufacturer', label: 'Manufacturer',      val: (r) => r.it.manufacturer || '' },
  { key: 'acquired',     label: 'Acquired',          val: (r) => r.it.acquired || '' },
  { key: 'warranty',     label: 'Warranty until',    val: (r) => r.it.warranty || '' },
  { key: 'section',      label: 'Section',           val: (r) => r.section || '' },
];

// ---- Which views may show one item on more than one line (v128) -------------
// A row on "All items" is one item AS IT SITS IN ONE TEMPLATE, so an item in Bike
// and Run has two. That is only ever WORTH seeing when the thing you are sorting
// or grouping by is itself per-template — because everything else a row draws
// (name, owner, storage, care, photo) belongs to the ITEM and is therefore
// identical on both lines. Grouped by "Whose it is", two "Sports bra" rows differ
// only by a template name: noise, not information. So outside these dimensions the
// rows COLLAPSE to one per item, listing its templates on the sub-line.
//
// Only three dimensions genuinely differ between templates:
//   container — a membership may override the bag for one list
//   section   — a section belongs to ONE template
//   template  — self-evidently
// Keep these two sets in step with AI_GROUPS / AI_SORTS if a per-template
// dimension is ever added, or that view will silently hide real differences.
const PER_TEMPLATE_GROUPS = new Set(['container', 'section', 'template']);
const PER_TEMPLATE_SORTS = new Set(['container', 'section']);

// Grouping choices. `of(row)` names the bucket ('' = not set, always shown last
// under `empty`); `order` pins the buckets that have a natural running order.
const AI_GROUPS = [
  { key: '',             label: 'No grouping' },
  { key: 'container',    label: 'Container',         of: (r) => r.it.container || '',    order: CONTAINERS,                          empty: 'No bag chosen' },
  { key: 'storage',      label: 'Where it’s stored', of: (r) => r.it.storage || '',                                                  empty: 'Storage place not set' },
  { key: 'section',      label: 'Section',           of: (r) => r.section || '',                                                     empty: 'No section' },
  { key: 'manufacturer', label: 'Manufacturer',      of: (r) => r.it.manufacturer || '',                                             empty: 'No maker recorded' },
  // `order` is a FUNCTION here because the condition list is editable and is
  // installed after this module is evaluated — a snapshot taken now would pin the
  // factory four forever and mis-sort anything you added.
  { key: 'condition',    label: 'Item condition',    of: (r) => itemConditionLabel(r.it.condition), order: () => ITEM_CONDITIONS.map((c) => c.label), empty: 'Not rated' },
  { key: 'template',     label: 'Template',          of: (r) => r.list.name || '',                                                   empty: 'No template' },
  { key: 'category',     label: 'Category',          of: (r) => r.it.category || '',     order: CATEGORIES,                          empty: 'No category' },
  { key: 'owner',        label: 'Whose it is',       of: (r) => r.it.ownedBy || '',                                                  empty: 'Nobody named' },
  { key: 'care',         label: 'Care status',       of: (r) => aiCareLabel(r.it),       order: AI_CARE_ORDER,                       empty: 'No care record' },
  { key: 'letter',       label: 'First letter',      of: (r) => (r.it.name || '').trim().charAt(0).toUpperCase() || '',              empty: 'Unnamed' },
];

const AI_SORT_KEY = 'ams.allitems.sort';
const AI_GROUP_KEY = 'ams.allitems.group';
// Sort and grouping are remembered on the device (unlike the filter chips, which
// start clear each visit): they hide nothing, they only rearrange.
function loadAiSort() {
  try { const s = JSON.parse(localStorage.getItem(AI_SORT_KEY) || 'null');
    if (s && AI_SORTS.some((x) => x.key === s.by)) return { by: s.by, dir: s.dir === 'desc' ? 'desc' : 'asc' };
  } catch { /* ignore */ }
  return { by: 'name', dir: 'asc' };
}
function saveAiSort(s) { try { localStorage.setItem(AI_SORT_KEY, JSON.stringify(s)); } catch { /* ignore */ } }
function loadAiGroup() {
  try { const g = localStorage.getItem(AI_GROUP_KEY) || ''; if (AI_GROUPS.some((x) => x.key === g)) return g; } catch { /* ignore */ }
  return '';
}
function saveAiGroup(g) { try { localStorage.setItem(AI_GROUP_KEY, g); } catch { /* ignore */ } }

// A resolved item shaped for another template — carries the packing-relevant
// attributes (so a new hat lands with its container, weight, flags, conditions
// and storage intact) but NOT the per-object care record: photos and the
// maintenance schedule belong to the shared catalog item, not the membership.
// This is a transient object: db.saveList decomposes it, merging it into the one
// catalog item (by name) and recording the per-template context as a membership —
// nothing is persisted as a duplicate.
// (Removed in v108.) There used to be a `copyItemForTemplate` here that hand-listed
// the fields to carry into another template. It carried about half of them, and the
// half-filled copy was then written over the SHARED item — silently erasing photos,
// the care record, purchase details and serial numbers everywhere at once. Putting
// an item into another template now uses `linkFromResolved`, which stores a link
// rather than a copy, so there is no second field list left to drift out of date.

// A human phrase for where an item's maintenance stands ("Overdue by 5 days", "in 12
// days", "Due today", "No schedule").
function dueLabel(status) {
  if (!status) return '';
  if (!status.scheduled) return 'No schedule';
  const d = status.days;
  if (d < 0) return `Overdue by ${-d} day${-d === 1 ? '' : 's'}`;
  if (d === 0) return status.neverDone ? 'Due now (never logged)' : 'Due today';
  if (d === 1) return 'Due tomorrow';
  return `Due in ${d} days`;
}
// Maintenance state glyph. The three due-states are the same filled dot, coloured
// by the state class that wraps them; a reference item shows the care toolbox.
// A function, not a map: `IC` is defined further down, so building the markup at
// module-evaluation time would read it inside its temporal dead zone.
const careIcon = (state) => ic(state === 'reference' ? 'toolbox' : 'dot', 'xs');
function prettyDate(ymd) {
  const t = Date.parse(`${ymd}T00:00:00Z`);
  if (Number.isNaN(t)) return ymd || '';
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
// A compact date range: shared month/year is written once ("12 – 19 Sept 2026",
// "28 Dec 2026 – 3 Jan 2027"). Falls back gracefully when one end is missing.
function prettyRange(a, b) {
  if (!a) return prettyDate(b);
  if (!b || a === b) return prettyDate(a);
  const da = new Date(Date.parse(`${a}T00:00:00Z`));
  const db = new Date(Date.parse(`${b}T00:00:00Z`));
  if (Number.isNaN(da) || Number.isNaN(db)) return `${prettyDate(a)} → ${prettyDate(b)}`;
  const opt = (o) => da.toLocaleDateString(undefined, { ...o, timeZone: 'UTC' });
  const sameYear = da.getUTCFullYear() === db.getUTCFullYear();
  const sameMonth = sameYear && da.getUTCMonth() === db.getUTCMonth();
  const left = sameMonth ? opt({ day: 'numeric' })
    : sameYear ? opt({ day: 'numeric', month: 'short' })
      : prettyDate(a);
  return `${left} – ${prettyDate(b)}`;
}

// Await a save; surface failures instead of failing silently.
async function saveGuard(promise) {
  try { await promise; return true; }
  catch (err) {
    console.error('AMS Packing List: save failed', err);
    logDiag('save', err);
    const quota = err && (err.name === 'QuotaExceededError' || /quota|exceeded/i.test(String((err && err.message) || err)));
    alert(quota
      ? 'This device is out of storage. Export a backup, remove some old events, and try again.'
      : 'Sorry — that could not be saved. Please try again.');
    return false;
  }
}

// The interface icon family. Every glyph is a single-stroke line drawing on the
// same 24×24 grid, stroked in `currentColor` so it inherits the section accent
// wherever it sits. The shared skeleton lives in `svgIcon()` so each entry below
// is just its path data — `w` overrides the stroke weight for the few glyphs
// that need a heavier or lighter line.
//
// These cover the app's OWN language: buttons, badges, flags, chips, nudges and
// status. Emoji are deliberately kept for things that identify the USER's stuff —
// category / container / phase group headers, template covers and kits — where a
// colourful, instantly recognisable glyph beats a monochrome outline.
const svgIcon = (d, w = 1.9) => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const svgSolid = (d) => `<svg class="ic" viewBox="0 0 24 24" fill="currentColor" stroke="none">${d}</svg>`;

const IC = {
  // --- navigation & actions ---
  bag: svgIcon('<path d="M6 8h12l-1 12H7Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>'),
  list: svgIcon('<path d="M8 6h11M8 12h11M8 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>'),
  plus: svgIcon('<path d="M12 6v12M6 12h12"/>', 2.3),
  gear: svgIcon('<polygon points="12,2.5 21.2,7.25 21.2,16.75 12,21.5 2.8,16.75 2.8,7.25"/><circle cx="12" cy="12" r="4"/>', 1.85),
  trash: svgIcon('<path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13"/>'),
  edit: svgIcon('<path d="M4 20h4L18 10l-4-4L4 16Z"/><path d="M13 7l4 4"/>'),
  back: svgIcon('<path d="M15 6l-6 6 6 6"/>', 2.1),
  more: svgSolid('<circle cx="5.4" cy="12" r="1.85"/><circle cx="12" cy="12" r="1.85"/><circle cx="18.6" cy="12" r="1.85"/>'),
  sheet: svgIcon('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M10 4v16"/>'),
  refresh: svgIcon('<path d="M4 12a8 8 0 0 1 13.7-5.7L20 8"/><path d="M20 4v4h-4"/><path d="M20 12a8 8 0 0 1-13.7 5.7L4 16"/><path d="M4 20v-4h4"/>'),
  fwd: svgIcon('<path d="M9 6l6 6-6 6"/>', 2.1),
  up: svgIcon('<path d="M6 15l6-6 6 6"/>', 2.1),
  down: svgIcon('<path d="M6 9l6 6 6-6"/>', 2.1),
  close: svgIcon('<path d="M6 6l12 12M18 6L6 18"/>', 2.1),
  check: svgIcon('<path d="M5 12.5l4.5 4.5L19 7"/>', 2.6),
  share: svgIcon('<path d="M12 15V4M8.5 7.5 12 4l3.5 3.5"/><path d="M6 12v6a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-6"/>'),
  link: svgIcon('<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>'),
  pin: svgIcon('<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/>'),
  wrench: svgIcon('<path d="M14.7 6.3a4 4 0 0 0-5.2 5.1L4 16.9 7.1 20l5.5-5.5a4 4 0 0 0 5.1-5.2l-2.4 2.4-2.1-.6-.6-2.1Z"/>'),
  camera: svgIcon('<path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.2"/>'),
  cal: svgIcon('<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M8 3.5v3M16 3.5v3"/>'),
  search: svgIcon('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/>'),
  globe: svgIcon('<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18"/>'),
  star: svgSolid('<path d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.79L12 16.77 6.8 19.5l.99-5.79-4.21-4.1 5.82-.85Z"/>'),

  // --- item flags & badges (was ⚠️ 💧 ⚡ 🚫 ♻️ 🛒 🧰 📷 👤 ☑ 🌙 ⭐ 🗒️ 🗂️) ---
  warn: svgIcon('<path d="M12 4.2 21 19.6H3Z"/><path d="M12 10v4.2"/><path d="M12 17.2h.01"/>'),
  drop: svgIcon('<path d="M12 3.4c3.5 4.3 5.4 7.1 5.4 9.6a5.4 5.4 0 0 1-10.8 0c0-2.5 1.9-5.3 5.4-9.6Z"/>'),
  bolt: svgIcon('<path d="M13.2 3 5.6 13.6h5.3l-1 7.4 7.5-10.6h-5.2Z"/>'),
  ban: svgIcon('<circle cx="12" cy="12" r="8.4"/><path d="M6.1 6.1l11.8 11.8"/>'),
  swap: svgIcon('<path d="M3.8 8.4h14.4l-3.6-3.6"/><path d="M20.2 15.6H5.8l3.6 3.6"/>'),
  cart: svgIcon('<path d="M2.8 4.2h2.4l2.4 10.6h9.3l2.3-7.7H6.3"/><circle cx="9.4" cy="19" r="1.5"/><circle cx="16.6" cy="19" r="1.5"/>'),
  toolbox: svgIcon('<rect x="3" y="8.4" width="18" height="11.2" rx="1.8"/><path d="M8.8 8.4V6.6a1.6 1.6 0 0 1 1.6-1.6h3.2a1.6 1.6 0 0 1 1.6 1.6v1.8"/><path d="M3 13.2h18"/><path d="M10.4 13.2v2.2h3.2v-2.2"/>'),
  person: svgIcon('<circle cx="12" cy="8" r="3.6"/><path d="M5.2 20a6.8 6.8 0 0 1 13.6 0"/>'),
  checkbox: svgIcon('<rect x="3.8" y="3.8" width="16.4" height="16.4" rx="3"/><path d="M8 12.4l2.6 2.6L16.2 9.4"/>'),
  moon: svgIcon('<path d="M20.2 14.6A8.6 8.6 0 0 1 9.4 3.8a8.6 8.6 0 1 0 10.8 10.8Z"/>'),
  note: svgIcon('<path d="M6 3.6h8.4L19 8.2v12.2H6Z"/><path d="M14.4 3.6v4.6H19"/><path d="M9 12.4h7M9 16.2h4.6"/>'),
  folder: svgIcon('<path d="M3.4 6.6A1.6 1.6 0 0 1 5 5h3.9l2 2.6H19a1.6 1.6 0 0 1 1.6 1.6v8.2A1.6 1.6 0 0 1 19 19H5a1.6 1.6 0 0 1-1.6-1.6Z"/>'),
  laundry: svgIcon('<path d="M4.4 8.6h15.2L18.2 20H5.8Z"/><path d="M3 8.6h18"/><path d="M8.8 11.8l.8 5M15.2 11.8l-.8 5M12 11.8v5"/>'),
  weight: svgIcon('<path d="M7 8.4h10l2 11.4H5Z"/><path d="M9.4 8.4V6.9a2.6 2.6 0 0 1 5.2 0v1.5"/>'),
  lock: svgIcon('<rect x="4.4" y="10" width="15.2" height="10.4" rx="2"/><path d="M8 10V7.6a4 4 0 0 1 8 0V10"/>'),
  save: svgIcon('<path d="M4.6 4.6h10.6l4.2 4.2v10.6H4.6Z"/><path d="M8.4 4.6v4.8h6.4V4.6"/><path d="M8 13.4h8v6H8Z"/>'),
  sparkle: svgIcon('<path d="M11 3.4l1.7 4.6 4.6 1.7-4.6 1.7L11 16l-1.7-4.6L4.7 9.7l4.6-1.7Z"/><path d="M17.8 15.2l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8Z"/>', 1.7),
  box: svgIcon('<path d="M3.6 8 12 3.6 20.4 8v8L12 20.4 3.6 16Z"/><path d="M3.6 8 12 12.4 20.4 8M12 12.4v8"/>'),
  clock: svgIcon('<circle cx="12" cy="13.4" r="7.4"/><path d="M12 9.6v3.8l2.6 1.8"/><path d="M9.6 3.2h4.8"/>'),
  suitcase: svgIcon('<rect x="3.4" y="7.6" width="17.2" height="12" rx="2"/><path d="M8.8 7.6V5.8A1.6 1.6 0 0 1 10.4 4.2h3.2a1.6 1.6 0 0 1 1.6 1.6v1.8"/><path d="M8.6 7.6v12M15.4 7.6v12"/>'),
  dot: svgSolid('<circle cx="12" cy="12" r="5.6"/>'),

  // --- trip-setup vocabulary (was 🚗 ✈️ 🚐 🏠 🌲 🏁 🎯 🏋️ 🎈 🍳 🍽️ 🥡) ---
  car: svgIcon('<path d="M4.4 16.4v-3.1l1.9-4.4A1.8 1.8 0 0 1 8 7.8h8a1.8 1.8 0 0 1 1.7 1.1l1.9 4.4v3.1"/><path d="M4.4 13.3h15.2"/><circle cx="8" cy="16.4" r="1.6"/><circle cx="16" cy="16.4" r="1.6"/>'),
  plane: svgIcon('<path d="M10.4 4.2a1.6 1.6 0 0 1 3.2 0v4.9l7 4.1v2.2l-7-1.9v3.6l2.3 1.7v1.6L12 19.5l-3.9.9v-1.6l2.3-1.7v-3.6l-7 1.9v-2.2l7-4.1Z"/>'),
  rv: svgIcon('<path d="M3 17V7.6a1.2 1.2 0 0 1 1.2-1.2h11.3L20.6 12v5"/><path d="M3 17h17.6"/><circle cx="7.6" cy="17.6" r="1.6"/><circle cx="16" cy="17.6" r="1.6"/><path d="M6 9.2h4.2v3.2H6Z"/>'),
  home: svgIcon('<path d="M4 10.4 12 4l8 6.4V20H4Z"/><path d="M9.6 20v-5.8h4.8V20"/>'),
  tree: svgIcon('<path d="M12 3.2 6.4 11h3.2l-4 6h12.8l-4-6h3.2Z"/><path d="M12 17v3.8"/>'),
  flag: svgIcon('<path d="M6 21V4M6 4h11l-2 4 2 4H6"/>'),
  target: svgIcon('<circle cx="12" cy="12" r="8.2"/><circle cx="12" cy="12" r="3.9"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>'),
  dumbbell: svgIcon('<path d="M6.6 8.6v6.8M3.8 10.4v3.2M17.4 8.6v6.8M20.2 10.4v3.2"/><path d="M6.6 12h10.8"/>'),
  balloon: svgIcon('<path d="M12 3.6a5.2 5.2 0 0 1 5.2 5.2c0 3.3-2.6 5.9-5.2 6.6-2.6-.7-5.2-3.3-5.2-6.6A5.2 5.2 0 0 1 12 3.6Z"/><path d="M12 15.4v2.2"/><path d="M10.6 20.6c1.2-.9 2.8-.9 1.4-3"/>'),
  pan: svgIcon('<circle cx="9.8" cy="12.8" r="5.6"/><path d="M15.4 12.8h5.4"/>'),
  cutlery: svgIcon('<path d="M7.8 3.4v6.8a2 2 0 0 0 2 2v8.4"/><path d="M5.8 3.4v4.4M9.8 3.4v4.4"/><path d="M16.6 3.4c1.8 0 2.6 2.2 2.6 4.4s-1 3.4-2.6 3.4v9.4"/>'),
  takeaway: svgIcon('<path d="M5.4 8.4h13.2L17.4 20H6.6Z"/><path d="M4.2 8.4 12 4.2l7.8 4.2"/><path d="M9.2 12.4h5.6"/>'),
};

// Renders an interface glyph at a chosen size. `size` is a CSS modifier class —
// 'xs' for badges, 'sm' for chips and sub-labels, 'md' for nudges; omit for the
// default 22px used in buttons and top bars.
function ic(name, size = '') {
  const raw = IC[name];
  if (!raw) return '';
  return size ? raw.replace('class="ic"', `class="ic ${size}"`) : raw;
}

// Weather glyphs, keyed by the symbolic icon keys model.js emits. Colours are
// baked in (not currentColor) so the sky reads at a glance — chosen to stay legible
// on both light and dark chips: gold sun, slate clouds, blue rain, cyan snow, amber bolt.
const WIC = {
  sun: '<svg class="wi" viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4" fill="#f9b62a" stroke="#f5a623"/><g stroke="#f5a623"><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></g></svg>',
  'sun-cloud': '<svg class="wi" viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><g stroke="#f5a623"><path d="M7 8a4 4 0 0 1 7.5-1.5"/><path d="M4 6.5l-.9-.9M8 3v1M12.5 5.5l.9-.9M2.5 10h1"/></g><path d="M7 18h10a3 3 0 0 0 0-6 4 4 0 0 0-7.7-1.3A3.2 3.2 0 0 0 7 18Z" stroke="#8b98a8"/></svg>',
  cloud: '<svg class="wi" viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18h10a3.2 3.2 0 0 0 .2-6.4A5 5 0 0 0 7.5 10 3.5 3.5 0 0 0 7 18Z" stroke="#8b98a8"/></svg>',
  fog: '<svg class="wi" viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><g stroke="#a0aab5"><path d="M6 9h11a3 3 0 0 0-5.7-1.3A3.4 3.4 0 0 0 6 9Z"/><path d="M4 13h13M6 16h12M8 19h9"/></g></svg>',
  rain: '<svg class="wi" viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 14h10a3.2 3.2 0 0 0 .2-6.4A5 5 0 0 0 7.5 6 3.5 3.5 0 0 0 7 14Z" stroke="#8b98a8"/><g stroke="#3b82f6" stroke-width="2"><path d="M8 18l-1 2M12 18l-1 2M16 18l-1 2"/></g></svg>',
  snow: '<svg class="wi" viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 13h10a3.2 3.2 0 0 0 .2-6.4A5 5 0 0 0 7.5 5 3.5 3.5 0 0 0 7 13Z" stroke="#8b98a8"/><g stroke="#38bdf8" stroke-width="2.3"><path d="M8 17h.01M12 19h.01M16 17h.01M10 20h.01M14 20h.01"/></g></svg>',
  storm: '<svg class="wi" viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 13h10a3.2 3.2 0 0 0 .2-6.4A5 5 0 0 0 7.5 5 3.5 3.5 0 0 0 7 13Z" stroke="#7f8b99"/><path d="M13 14l-3 4h3l-1 3" fill="#f59e0b" stroke="#f59e0b"/></svg>',
  // Conditions you can force-pack for, plus the two seasons. Same coloured
  // language as the forecast glyphs above: cyan for cold/snow, amber for heat,
  // slate for wind.
  snowflake: '<svg class="wi" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9"/><path d="M12 6.6 9.6 4.6M12 6.6l2.4-2M12 17.4l-2.4 2M12 17.4l2.4 2"/></svg>',
  cold: '<svg class="wi" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13.6V5.4a2.2 2.2 0 0 1 4.4 0v8.2a4 4 0 1 1-4.4 0Z"/><path d="M12.2 9.4v6"/></svg>',
  hot: '<svg class="wi" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.4c2.6 3 3.6 5 3.6 6.6 0 1.6-1.2 2.6-1.2 4.2a3 3 0 0 0 3 2.8c-.4 2.4-2.7 4-5.4 4a5.6 5.6 0 0 1-5.6-5.6c0-4 3.4-6.4 5.6-12Z"/></svg>',
  wind: '<svg class="wi" viewBox="0 0 24 24" fill="none" stroke="#8b98a8" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5h9a2.6 2.6 0 1 0-2.6-2.6"/><path d="M3.5 13h12a2.6 2.6 0 1 1-2.6 2.6"/><path d="M3.5 17.5h6"/></svg>',
};
const wIcon = (key) => WIC[key] || WIC.cloud;

// Travel/packing glyphs for the packing-list group headers. Keyed by the exact
// category / container / phase label so one lookup covers every group-by mode.
const CATEGORY_ICON = {
  'Clothing': '👕', 'Adventure clothing': '🧥', 'Footwear': '👟', 'Sport gear': '🎽',
  'Food & drink': '🥨', 'Toiletries': '🧴', 'Pharmacy / meds': '💊', 'Electronics': '🔌',
  'Documents & money': '🛂', 'Charging': '🔋', 'Comfort & misc': '🧸', 'Reminders': '🔔',
};
// A distinct hue per category, so a packing list scans by colour at a glance
// (shown as a small dot on each row). Values are readable on light and dark.
const CATEGORY_COLOR = {
  'Clothing': '#3b82f6', 'Adventure clothing': '#0ea5a2', 'Footwear': '#8b5cf6', 'Sport gear': '#ec4899',
  'Food & drink': '#f59e0b', 'Toiletries': '#14b8a6', 'Pharmacy / meds': '#ef4444', 'Electronics': '#6366f1',
  'Documents & money': '#0891b2', 'Charging': '#22c55e', 'Comfort & misc': '#a1a1aa', 'Reminders': '#eab308',
};
function categoryColor(cat) { return CATEGORY_COLOR[cat] || 'var(--muted)'; }
const CONTAINER_ICON = {
  'Toiletry bag': '👝', 'Carry-on / hand luggage': '💼', 'Checked luggage': '🧳',
  'Hiking backpack': '🎒', 'Climbing backpack': '🧗', 'Golf bag': '⛳', 'Triathlon bag': '🚴',
  'Swim bag': '🏊', 'Duffel bag': '👜', 'Day pack': '🥾', 'Bellroy backpack': '🎒',
  'Tech pouch': '🔌', 'Electronics bag': '💻', 'Cool box': '🧊', 'Handbag': '👛',
  'RV storage box': '📦', 'Other': '📦',
};
// The "When" choices, built fresh every time because the phase list is editable
// AND synced — a snapshot would go stale the moment the other device added one.
// Each option carries the phase's own emoji, so the picker reads like the packing
// list it produces. `cur` is always included, even when it is an id this device
// doesn't recognise, so a picker can never silently move an item's When.
function phaseOpts(cur = '') {
  const opts = PHASES.map((p) => ({ value: p.id, label: `${p.emoji} ${p.label}` }));
  if (cur && !opts.some((o) => o.value === cur)) {
    const p = phaseOrFallback(cur);
    opts.push({ value: cur, label: `${p.emoji} ${p.label}` });
  }
  return opts;
}
// Phases used to have a hardwired glyph per label here. They now carry their own
// emoji, chosen in Settings → When, so the icon is looked up on the live list.
const phaseIconByLabel = (label) => {
  const p = PHASES.find((x) => x.label === label);
  return p ? p.emoji : '';
};
// The glyph for a group/sub header, matched by its label across all three maps.
function groupIcon(label) {
  return CATEGORY_ICON[label] || CONTAINER_ICON[label] || phaseIconByLabel(label) || '';
}

// ---------- small render helpers ----------
function chip(text) { return `<span class="chip">${esc(text)}</span>`; }
function backBar(title, href = '#/') {
  return `<div class="topbar"><a class="iconbtn" href="${href}" aria-label="Back">${IC.back}</a><h1>${esc(title)}</h1></div>`;
}
function selectHtml(name, options, selected) {
  return `<select name="${name}">${options.map((o) => {
    const val = typeof o === 'object' ? o.value : o;
    const label = typeof o === 'object' ? o.label : o;
    return `<option value="${esc(val)}"${val === selected ? ' selected' : ''}>${esc(label)}</option>`;
  }).join('')}</select>`;
}
function radioRow(name, options, selected) {
  return `<div class="segmented">${options.map((o) => {
    const val = typeof o === 'object' ? o.value : o;
    const label = typeof o === 'object' ? o.label : o;
    return `<label class="seg${val === selected ? ' on' : ''}"><input type="radio" name="${name}" value="${esc(val)}"${val === selected ? ' checked' : ''}>${esc(label)}</label>`;
  }).join('')}</div>`;
}
function checkRow(name, options, selectedArr) {
  const set = new Set(selectedArr || []);
  return `<div class="checks">${options.map((o) => {
    const val = typeof o === 'object' ? o.value : o;
    const label = typeof o === 'object' ? o.label : o;
    return `<label class="check${set.has(val) ? ' on' : ''}"><input type="checkbox" name="${name}" value="${esc(val)}"${set.has(val) ? ' checked' : ''}>${esc(label)}</label>`;
  }).join('')}</div>`;
}

// The activity picker, grouped under GA / WET / OE (and any ungrouped lists last).
function activitiesPicker(lists, selected, contexts) {
  const set = new Set(selected || []);
  const byGroup = new Map(GROUP_IDS.map((g) => [g, []]));
  const ungrouped = [];
  // Base and transport lists are auto-included (common core + the transport radio),
  // so they're not shown here as tickable activities.
  for (const l of lists) {
    if (l.role === 'base' || l.role === 'transport' || l.role === 'loose' || l.role === CONTAINER_ROLE) continue;
    (byGroup.has(l.group) ? byGroup.get(l.group) : ungrouped).push(l);
  }
  const box = (l) => `<label class="check${set.has(l.id) ? ' on' : ''}"><input type="checkbox" name="activities" value="${esc(l.id)}"${set.has(l.id) ? ' checked' : ''}>${esc(l.name)}${l.items.length ? '' : ' <em>(empty)</em>'}</label>`;
  // Indoor / Outdoor / Race only ever qualify WET activities, so the choice belongs
  // inside the WET block rather than floating as a fieldset of its own.
  const extraFor = (gid) => (gid !== 'WET' ? '' : `<div class="grp-sub">
      <span class="grp-sub-t">WET options</span>
      ${checkRow('contexts', CONTEXTS, contexts)}
    </div>`);
  const section = (title, hint, gid, arr) => {
    if (!arr.length) return '';
    return `<div class="grp" data-grp="${esc(gid)}">
      <div class="grp-h"><span class="grp-t">${esc(gid ? `${gid} · ${title}` : title)}</span>${gid ? '<button type="button" class="linkbtn" data-selall="1">select all</button>' : ''}</div>
      ${hint ? `<p class="grp-hint">${esc(hint)}</p>` : ''}
      <div class="checks">${orderActivities(gid, arr).map(box).join('')}</div>
      ${extraFor(gid)}
    </div>`;
  };
  let html = GROUPS.map((g) => section(g.label, g.hint, g.id, byGroup.get(g.id))).join('');
  html += section('Other lists', '', '', ungrouped);
  return html || '<p class="muted">No packing lists yet — add some under the Lists tab first.</p>';
}

// ============================================================
// Events list (home)
// ============================================================
async function renderHome() {
  const [events, lists, actions] = await Promise.all([db.getEvents(), db.getLists(), db.getActions()]);
  ALL_ACTIONS = actions; // keep the module cache warm for item to-do badges
  const wrap = h('<section class="screen"></section>');
  wrap.appendChild(h(`<div class="topbar"><h1 class="grow">AMS Packing List</h1><a class="iconbtn" href="#/search" aria-label="Search">${IC.search}</a></div>`));

  // On-open reminder: the soonest trip that has items due to pack now.
  const nudges = events.map((e) => ({ e, n: tripNudge(e) })).filter((x) => x.n && x.n.dueCount > 0);
  nudges.sort((a, b) => a.n.daysToGo - b.n.daysToGo);
  if (nudges.length) {
    const { e, n } = nudges[0];
    wrap.appendChild(h(`<a class="nudge" href="#/event/${e.id}/pack">
      <span class="nudge-ic">${ic('clock','md')}</span>
      <span class="nudge-body"><b>${esc(e.name || 'Trip')} ${esc(n.label)}</b> — ${n.dueCount} item${n.dueCount === 1 ? '' : 's'} to pack now<span class="nudge-sub">${esc(n.focusLabel)}</span></span>
      <span class="nudge-go">${IC.fwd}</span>
    </a>`));
  }

  // Care reminder: gear that's overdue or due soon for maintenance.
  const care = maintenanceSummary(lists);
  if (care.due > 0) {
    const parts = [care.overdue ? `${care.overdue} overdue` : '', care.soon ? `${care.soon} due soon` : ''].filter(Boolean).join(' · ');
    wrap.appendChild(h(`<a class="nudge care" href="#/maintenance">
      <span class="nudge-ic">${ic('toolbox','md')}</span>
      <span class="nudge-body"><b>Maintenance due</b> — ${care.due} item${care.due === 1 ? ' needs' : 's need'} looking after<span class="nudge-sub">${esc(parts)}</span></span>
      <span class="nudge-go">${IC.fwd}</span>
    </a>`));
  }

  // Shopping reminder: things to buy / restock before a trip (built on the actions
  // store, kind 'shopping'), surfaced with the Care-side nudges.
  const openShopping = openShoppingCount(actions);
  if (openShopping) {
    wrap.appendChild(h(`<a class="nudge shop" href="#/shopping">
      <span class="nudge-ic">${ic('cart','md')}</span>
      <span class="nudge-body"><b>Shopping list</b> — ${openShopping} to buy<span class="nudge-sub">Restocks &amp; replacements before your trip</span></span>
      <span class="nudge-go">${IC.fwd}</span>
    </a>`));
  }

  // To-do reminder: open actions waiting on the Actions tab — a glanceable count
  // up here with the other nudges, rather than the full list buried down-page.
  const openActions = actions.filter((a) => !a.done && a.kind !== 'shopping');
  if (openActions.length) {
    const high = openActions.filter((a) => a.priority === 'high').length;
    const detail = `${openActions.length} open${high ? ` · ${high} high-priority` : ''}`;
    wrap.appendChild(h(`<a class="nudge todo" href="#/actions">
      <span class="nudge-ic">${ic('note','md')}</span>
      <span class="nudge-body"><b>To-dos to tackle</b> — ${detail}<span class="nudge-sub">Tap to open your Actions list</span></span>
      <span class="nudge-go">${IC.fwd}</span>
    </a>`));
  }

  // Backup reminder: a saved file is the real insurance for on-device data. It
  // escalates (amber -> red) and saves the file itself in one tap, because the
  // browser can't be trusted to do it silently — see saveBackupFile().
  const bstate = currentBackupState(events, lists, actions);
  if (bstate.level !== 'ok' && !backupNudgeSnoozed()) {
    const urgent = bstate.level === 'urgent';
    const d = bstate.days;
    const msg = bstate.never
      ? `you have never saved one — and you’ve been packing here for ${d} day${d === 1 ? '' : 's'}`
      : `it’s been ${d} day${d === 1 ? '' : 's'}, and you’ve made changes since`;
    const title = urgent ? 'Your data is not backed up' : 'Back up your data';
    const sub = urgent
      ? 'If this browser loses its data, everything since your last file goes with it. One tap saves it now.'
      : 'One tap saves a dated file to your Downloads folder.';
    const laterLabel = `Remind me ${backupSnoozeDays(bstate.level) === 1 ? 'tomorrow' : 'next week'}`;
    const nudge = h(`<div class="nudge backup${urgent ? ' urgent' : ''}">
      <span class="nudge-ic">${ic(urgent ? 'warn' : 'save','md')}</span>
      <span class="nudge-body"><b>${esc(title)}</b> — ${esc(msg)}<span class="nudge-sub">${esc(sub)}</span></span>
      <span class="nudge-acts">
        <button class="btn sm nudge-save" type="button">${ic('save','sm')}<span>Save backup now</span></button>
        <button class="nudge-x" type="button" aria-label="${esc(laterLabel)}" title="${esc(laterLabel)}">${ic('close','sm')}</button>
      </span>
    </div>`);
    nudge.querySelector('.nudge-save').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const saved = await saveBackupFile();
      if (saved) render(); else btn.disabled = false;
    });
    nudge.querySelector('.nudge-x').addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      snoozeBackupNudge(bstate.level);
      render();
    });
    wrap.appendChild(nudge);
  }

  wrap.appendChild(h('<p class="muted pad">Set your trip details — your common base and your transport’s kit come in automatically. Tick any extra activities, then press <b>Create Event</b> to build one combined <b>Packing List</b> to pack from.</p>'));

  // The builder card — a fresh event, generated on submit.
  const card = h('<div class="card builder"></div>');
  const ev = newEvent({ name: '', startDate: '' });
  const form = eventForm(ev, lists, false);

  card.appendChild(form);
  wrap.appendChild(card);

  // A compact preview of the most recent trips — the full set lives on the
  // Events tab. Events arrive from db already ordered nearest-upcoming first.
  if (events.length) {
    const header = h('<div class="section-h-row"><h2 class="section-h">Your events</h2></div>');
    if (events.length > HOME_EVENT_PREVIEW) header.appendChild(h(`<a class="see-all" href="#/events">See all ${events.length} ${IC.fwd}</a>`));
    wrap.appendChild(header);
    const list = h('<div class="cards"></div>');
    for (const e of events.slice(0, HOME_EVENT_PREVIEW)) list.appendChild(eventCard(e));
    wrap.appendChild(list);
  }

  // A very subtle build marker — findable when you go looking, ignorable otherwise.
  // Tapping it opens the full version history in Settings.
  wrap.appendChild(h(`<a class="app-version" href="#/settings" title="AMS Packing List ${APP_VERSION} — tap for version history">AMS Packing List · ${APP_VERSION}</a>`));
  return wrap;
}
const HOME_EVENT_PREVIEW = 3;
function cateringShort(id) { return id === 'self' ? 'Self-sufficient' : id === 'eatout' ? 'Eating out' : id === 'mixed' ? 'Mixed catering' : ''; }

// One saved-event card — shared by the Home preview and the Events tab.
function eventCardHTML(e) {
  const p = progress(e.entries);
  const quick = e.mode === 'quick';
  const meta = (quick
    ? ['⏱️ Quick', e.season, ...(e.contexts || [])]
    : [e.transport, e.season, cateringShort(e.catering), ...(e.contexts || [])]).filter(Boolean);
  const dToGo = daysUntil(e.startDate);
  const countdown = dToGo != null ? esc(countdownLabel(dToGo)) : '';
  const soon = dToGo != null && dToGo >= 0 && dToGo <= 7;
  // A boarding-pass style sub-line: destination + trip length when known.
  const endVal = e.endDate || endFromNights(e.startDate, e.nights);
  const n = nightsBetween(e.startDate, endVal);
  const nightsBit = n == null ? '' : n === 0 ? 'day trip' : `${n} night${n === 1 ? '' : 's'}`;
  const sub = [e.destination ? `${ic('pin','xs')}${esc(e.destination)}` : '', nightsBit].filter(Boolean).join(' · ');
  // Weather glyph + range, only when a forecast has actually been fetched for the trip.
  const dw = deriveWeather(e);
  const wx = dw ? `<span class="ev-wx">${wIcon(dw.days[0].icon)} ${esc(dw.rangeLabel)}</span>` : '';
  const done = p.total > 0 && p.done >= p.total;
  return `<a class="card ev ticket${done ? ' done' : ''}" href="#/event/${e.id}">
    <div class="ev-top">
      <div class="ev-title-wrap">
        <span class="ev-name">${esc(e.name || 'Untitled event')}</span>
        ${sub ? `<span class="ev-sub">${sub}</span>` : ''}
      </div>
      <div class="ev-badge">
        ${countdown ? `<span class="ev-countdown${soon ? ' soon' : ''}">${ic('cal','xs')}${countdown}</span>` : ''}
        ${wx}
      </div>
    </div>
    ${meta.length ? `<div class="chips">${meta.map(chip).join('')}</div>` : ''}
    <div class="ev-foot">
      <div class="bar"><span style="width:${p.pct}%"></span></div>
      <span class="ev-prog">${done ? `${ic('check','xs')}Packed` : `${p.done}/${p.total} · ${p.pct}%`}</span>
    </div>
  </a>`;
}

// ---- Quick actions on a trip (long-press / right-click / the ⋯ in its header) ----
// Two things had no home before: marking a whole trip packed in one go (for a list
// you actually packed off-app, or an old trip you just want to file at 100%), and
// deleting a trip at all. Both live here, in one menu reached the same way from the
// Events tab and from the trip itself.
function openEventMenu(ev, after = () => render()) {
  const p = progress(ev.entries);
  const allPacked = p.total > 0 && p.done >= p.total;
  const left = p.total - p.done;
  const body = h(`<div class="modal ev-menu">
    <h2>${esc(ev.name || 'Untitled event')}</h2>
    <p class="modal-sub">${p.total ? `${p.done} of ${p.total} packed · ${p.pct}%` : 'Nothing on this packing list yet'}</p>
    <div class="modal-actions">
      <a class="btn ghost lg" href="#/event/${ev.id}" data-m="go">${IC.fwd}<span>Open this trip</span></a>
      ${p.total && !allPacked ? `<button class="btn primary lg" data-m="packall">${IC.check}<span>Mark everything packed<em>${left} still unticked</em></span></button>` : ''}
      ${p.total && p.done ? `<button class="btn ghost lg" data-m="unpackall">${IC.swap}<span>Clear every tick</span></button>` : ''}
      <button class="btn ghost lg" data-m="rename">${IC.edit}<span>Rename</span></button>
      <a class="btn ghost lg" href="#/event/${ev.id}/edit" data-m="go">${IC.gear}<span>Trip settings</span></a>
      <button class="btn ghost lg" data-m="share">${IC.share}<span>Share</span></button>
      <button class="btn danger ghost lg" data-m="del">${IC.trash}<span>Delete this trip</span></button>
    </div>
    <button class="btn ghost" data-m="cancel">Cancel</button>
  </div>`);
  const overlay = h('<div class="overlay"></div>');
  overlay.appendChild(body);
  document.body.appendChild(overlay);
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  // Tick (or clear) the whole list at once. Kept as plain writes on the entries so
  // it behaves exactly like ticking them by hand — the readiness ring, the trip
  // card and Packing Mode all read the same flags.
  const setAll = async (checked) => {
    for (const e of ev.entries) e.checked = checked;
    if (!await saveGuard(db.saveEvent(ev))) return;
    close();
    showToast(checked ? `“${ev.name}” — all ${p.total} item${p.total === 1 ? '' : 's'} marked packed` : `“${ev.name}” — every tick cleared`);
    after();
  };

  body.addEventListener('click', async (e) => {
    const m = e.target.closest('[data-m]')?.dataset.m;
    if (!m) return;
    if (m === 'go') { close(); return; }              // the <a> navigates by itself
    if (m === 'cancel') { close(); return; }
    if (m === 'packall') { await setAll(true); return; }
    if (m === 'unpackall') {
      if (!confirm(`Clear every tick on “${ev.name}”? The list itself is untouched — you'd just be starting the packing again.`)) return;
      await setAll(false);
      return;
    }
    if (m === 'rename') {
      const name = (prompt('Rename trip:', ev.name) || '').trim();
      if (!name || name === ev.name) return;
      ev.name = name;
      if (await saveGuard(db.saveEvent(ev))) { close(); after(); }
      return;
    }
    if (m === 'share') { close(); shareTrip(ev); return; }
    if (m === 'del') {
      if (!confirm(`Delete “${ev.name}” and its packing list?\n\nThis can't be undone here, and the trip also disappears from your other synced devices. Your templates, items and to-dos are untouched.`)) return;
      if (!await saveGuard(db.deleteEvent(ev.id))) return;
      close();
      showToast(`Deleted “${ev.name}”`);
      if ((location.hash || '').startsWith(`#/event/${ev.id}`)) location.assign('#/events'); else after();
    }
  });
}

// Long-press (touch) or right-click (mouse/trackpad) a trip card for that menu.
// The long-press swallows the click that follows it, so the card doesn't also open.
function attachEventMenu(el, ev, after) {
  let timer = null;
  let longFired = false;
  const cancel = () => { clearTimeout(timer); timer = null; };
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); openEventMenu(ev, after); });
  el.addEventListener('touchstart', () => {
    longFired = false;
    timer = setTimeout(() => {
      longFired = true;
      try { if (navigator.vibrate) navigator.vibrate(14); } catch { /* ignore */ }
      openEventMenu(ev, after);
    }, 480);
  }, { passive: true });
  el.addEventListener('touchmove', cancel, { passive: true });
  el.addEventListener('touchend', cancel);
  el.addEventListener('touchcancel', cancel);
  el.addEventListener('click', (e) => { if (longFired) { e.preventDefault(); longFired = false; } });
}

// An event card wired up with its quick-actions menu.
function eventCard(e, after) {
  const el = h(eventCardHTML(e));
  attachEventMenu(el, e, after);
  return el;
}

// ============================================================
// Events tab — every saved event list, nearest upcoming first
// ============================================================
async function renderEvents() {
  const events = await db.getEvents();
  const wrap = h('<section class="screen"></section>');
  wrap.appendChild(h('<div class="topbar"><h1 class="grow">Events</h1><a class="iconbtn" href="#/search" aria-label="Search">' + IC.search + '</a><a class="btn ghost" href="#/map">' + IC.globe + '<span>Map</span></a><a class="btn primary" href="#/">' + IC.plus + '<span>New</span></a></div>'));
  if (!events.length) {
    wrap.appendChild(h('<div class="empty"><p class="empty-t">No events yet</p><p class="empty-s">Head to Home to build your first trip’s combined Packing List.</p></div>'));
    return wrap;
  }
  wrap.appendChild(h(`<p class="muted pad ev-hint">${ic('more','sm')}<b>Long-press</b> a trip (or right-click on a Mac) for quick actions — mark everything packed, rename, share, delete.</p>`));
  // Group headers make the nearest-first ordering legible at a glance.
  const groupOf = (e) => { const d = daysUntil(e.startDate); return d == null ? 'undated' : d >= 0 ? 'upcoming' : 'past'; };
  const labels = { upcoming: 'Upcoming', undated: 'No date set', past: 'Past trips' };
  let current = null;
  let list = null;
  for (const e of events) {
    const g = groupOf(e);
    if (g !== current) {
      current = g;
      wrap.appendChild(h(`<h2 class="section-h">${labels[g]}</h2>`));
      list = h('<div class="cards"></div>');
      wrap.appendChild(list);
    }
    list.appendChild(eventCard(e));
  }
  return wrap;
}

// ============================================================
// Places-visited world map (#/map) — one glowing pin per place, drawn from
// each trip's destination. The map itself is a plain offline SVG (see
// js/worldmap.js); pins sit in a percentage-positioned overlay so they stay a
// comfortable tap size at any width and align exactly with the land beneath.
// ============================================================
async function renderMap() {
  const events = await db.getEvents();
  const places = placesVisited(events);
  const pending = eventsNeedingCoords(events);
  const wrap = h('<section class="screen map-screen"></section>');
  wrap.appendChild(h(backBar('Places visited', '#/events')));

  const tripCount = places.reduce((n, p) => n + p.events.length, 0);

  // Nothing to plot yet — explain, in plain terms, how a pin gets on the map.
  if (!places.length && !pending.length) {
    wrap.appendChild(h(`<div class="empty">
      <p class="empty-t">No places on the map yet</p>
      <p class="empty-s">Give a trip a <b>destination</b> (open a trip → the settings gear → “Destination”). Once a place is looked up — for the weather, or with the button here — it appears as a pin.</p>
    </div>`));
    return wrap;
  }

  // Headline count, plus a little "most visited" badge once somewhere stands out.
  const top = mostVisited(places);
  const topHtml = top
    ? `<span class="map-top">${IC.star}<b>${esc(top.place || top.events[0]?.destination || 'Somewhere')}</b> · ${top.events.length} trips</span>`
    : '';
  const summary = h(`<div class="map-summary">
    <span class="map-count"><b>${places.length}</b> ${places.length === 1 ? 'place' : 'places'} · <b>${tripCount}</b> ${tripCount === 1 ? 'trip' : 'trips'}</span>
    ${topHtml}
  </div>`);
  wrap.appendChild(summary);

  if (pending.length) {
    const findBar = h(`<div class="map-find">
      <button class="btn primary" id="findPlaces">${IC.pin}<span>Find ${pending.length} ${pending.length === 1 ? 'place' : 'places'} on the map</span></button>
      <p class="map-find-note">${pending.length} ${pending.length === 1 ? 'trip has a destination' : 'trips have a destination'} we haven’t located yet. This looks ${pending.length === 1 ? 'it' : 'them'} up online, then remembers the spot so the map works offline.</p>
    </div>`);
    findBar.querySelector('#findPlaces').addEventListener('click', () => findMapPlaces(pending, findBar.querySelector('#findPlaces')));
    wrap.appendChild(findBar);
  }

  // A subtle line joining the trips in date order (oldest→newest) — drawn inside
  // the map (so it tracks the land) and beneath the pin overlay.
  const stops = tripPath(events);
  const routePts = stops.map((s) => { const { x, y } = project(s.lat, s.lon); return `${x.toFixed(2)},${y.toFixed(2)}`; }).join(' ');
  const routeSvg = stops.length >= 2 ? `<polyline class="worldmap-route" points="${routePts}"/>` : '';

  // The map + its pin overlay. The land, the route and the pins all live inside
  // one `.worldmap-view` layer, so a single zoom/pan transform moves them together
  // and the pins stay glued to the land (see the zoom setup further down). Pins are
  // real buttons for good tap targets.
  const mapWrap = h(`<div class="worldmap-wrap">
    <div class="worldmap-view">
      <svg class="worldmap" viewBox="0 0 ${MAP_W} ${MAP_H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <path class="worldmap-land" d="${WORLD_PATH}"/>
        ${routeSvg}
      </svg>
      <div class="pins"></div>
    </div>
    <div class="map-zoom" role="group" aria-label="Zoom the map">
      <button class="map-zoom-btn" type="button" data-z="in" aria-label="Zoom in">${IC.plus}</button>
      <button class="map-zoom-btn" type="button" data-z="out" aria-label="Zoom out"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><path d="M6 12h12"/></svg></button>
      <button class="map-zoom-btn" type="button" data-z="fit" aria-label="Fit all places"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>
    </div>
  </div>`);
  const view = mapWrap.querySelector('.worldmap-view');
  const pinsBox = mapWrap.querySelector('.pins');
  places.forEach((pl, idx) => {
    const { x, y } = project(pl.lat, pl.lon);
    const n = pl.events.length;
    const label = pl.place || pl.events[0]?.destination || 'Unknown place';
    const pin = h(`<button class="pin" type="button" data-idx="${idx}" style="left:${(x / MAP_W * 100).toFixed(3)}%;top:${(y / MAP_H * 100).toFixed(3)}%" aria-label="${esc(label)} — ${n} ${n === 1 ? 'trip' : 'trips'}" title="${esc(label)}">
      <span class="pin-dot"></span>${n > 1 ? `<span class="pin-badge">${n}</span>` : ''}
    </button>`);
    pinsBox.appendChild(pin);
  });
  wrap.appendChild(mapWrap);
  wrap.appendChild(h('<p class="map-hint">Zoom with the ＋ / − buttons, a trackpad pinch, or a double-click; drag to move around. Click a pin to jump to that place below.</p>'));

  // One card per place, newest visit first, each trip linking to its event.
  const list = h('<div class="place-list"></div>');
  places.forEach((pl, idx) => {
    const n = pl.events.length;
    const label = pl.place || pl.events[0]?.destination || 'Unknown place';
    const trips = pl.events.map((e) => {
      const when = e.startDate ? prettyDate(e.startDate) : 'No date set';
      return `<li><a href="#/event/${e.id}"><span class="place-trip-name">${esc(e.name || 'Untitled event')}</span><span class="place-trip-date">${esc(when)}</span></a></li>`;
    }).join('');
    const card = h(`<article class="place-card" id="place-${idx}" tabindex="-1">
      <div class="place-head"><span class="place-pin">${IC.pin}</span><h3 class="place-name">${esc(label)}</h3><span class="place-visits">${n} ${n === 1 ? 'visit' : 'visits'}</span></div>
      <ul class="place-trips">${trips}</ul>
    </article>`);
    list.appendChild(card);
  });
  wrap.appendChild(list);

  // ——— Zoom & pan ————————————————————————————————————————————————
  // Map and pins share the one transformed layer (`view`), so a single
  // scale + translate moves both and the pins stay glued to the land. Position is
  // kept as fractions of the frame (0..1), so nothing needs measuring in pixels
  // until a finger actually moves. `s` = zoom, `tx/ty` = pan.
  const MAX_S = 8;        // deepest zoom
  const MIN_SPAN = 0.14;  // a lone place still opens on a comfortable region, not max zoom
  let s = 1, tx = 0, ty = 0, dragged = false;

  const apply = () => {
    tx = Math.min(0, Math.max(1 - s, tx));   // keep the map covering the frame
    ty = Math.min(0, Math.max(1 - s, ty));
    view.style.transform = `translate(${(tx * 100).toFixed(4)}%, ${(ty * 100).toFixed(4)}%) scale(${s.toFixed(4)})`;
    view.style.setProperty('--pz', (1 / s).toFixed(4));   // counter-scale so pin dots keep their size
    mapWrap.classList.toggle('zoomed', s > 1.001);
  };
  // Zoom to scale `ns`, keeping the map point under (px,py) — fractions of the
  // frame — pinned where it is.
  const zoomTo = (ns, px = 0.5, py = 0.5) => {
    ns = Math.min(MAX_S, Math.max(1, ns));
    tx = px - (px - tx) * ns / s;
    ty = py - (py - ty) * ns / s;
    s = ns;
    apply();
  };
  // Frame the map on the places actually visited, so nearby pins separate at once.
  const fit = () => {
    if (!places.length) { s = 1; tx = 0; ty = 0; return apply(); }
    let minx = 1, maxx = 0, miny = 1, maxy = 0;
    places.forEach((pl) => {
      const { x, y } = project(pl.lat, pl.lon);
      const fx = x / MAP_W, fy = y / MAP_H;
      minx = Math.min(minx, fx); maxx = Math.max(maxx, fx);
      miny = Math.min(miny, fy); maxy = Math.max(maxy, fy);
    });
    const spanX = Math.max(MIN_SPAN, (maxx - minx) * 1.7);   // ×1.7 leaves breathing room
    const spanY = Math.max(MIN_SPAN, (maxy - miny) * 1.7);
    s = Math.min(MAX_S, Math.max(1, Math.min(1 / spanX, 1 / spanY)));
    tx = 0.5 - (minx + maxx) / 2 * s;
    ty = 0.5 - (miny + maxy) / 2 * s;
    apply();
  };
  fit();   // open already framed on the visited region

  // Pointer gestures: one finger pans (when zoomed in), two fingers pinch-zoom.
  // A tap that barely moves is left alone, so it still reaches the pin underneath.
  const pts = new Map();
  let startDist = 0, startS = 1, startMid = null;
  const frac = (e) => { const r = mapWrap.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; };
  view.addEventListener('pointerdown', (e) => {
    pts.set(e.pointerId, frac(e));
    dragged = false;
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      startDist = Math.hypot(a.x - b.x, a.y - b.y) || 1e-4;
      startS = s;
      startMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
  });
  view.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId);
    const cur = frac(e);
    pts.set(e.pointerId, cur);
    if (pts.size === 2 && startMid) {
      const [a, b] = [...pts.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1e-4;
      dragged = true;
      if (!view.hasPointerCapture(e.pointerId)) view.setPointerCapture(e.pointerId);
      zoomTo(startS * (dist / startDist), startMid.x, startMid.y);
    } else if (pts.size === 1 && s > 1.001) {
      if (Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y) > 0.004) {
        dragged = true;
        if (!view.hasPointerCapture(e.pointerId)) view.setPointerCapture(e.pointerId);
      }
      tx += cur.x - prev.x; ty += cur.y - prev.y;
      apply();
    }
  });
  const endPtr = (e) => { pts.delete(e.pointerId); if (pts.size < 2) startMid = null; };
  view.addEventListener('pointerup', endPtr);
  view.addEventListener('pointercancel', endPtr);

  // Double-tap / double-click steps the zoom in on the spot (and, once deep, back
  // out to the framed view). Mouse wheel / trackpad zooms on desktop.
  let lastTap = 0;
  view.addEventListener('pointerup', (e) => {
    if (dragged) return;
    const now = Date.now();
    if (now - lastTap < 320) { const p = frac(e); if (s < MAX_S - 0.01) zoomTo(s * 2, p.x, p.y); else fit(); lastTap = 0; }
    else lastTap = now;
  });
  // On a Mac a plain two-finger scroll should scroll the PAGE (not get trapped
  // zooming the map); a trackpad pinch (or ⌘/Ctrl + scroll) sends ctrlKey and
  // zooms. Scaling by the scroll amount keeps a pinch smooth and a wheel-notch sane.
  view.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;   // let the page scroll past the map
    e.preventDefault();
    const p = frac(e);
    zoomTo(s * Math.exp(-e.deltaY * 0.0025), p.x, p.y);
  }, { passive: false });

  // The +, − and fit buttons.
  mapWrap.querySelector('.map-zoom').addEventListener('click', (e) => {
    const b = e.target.closest('.map-zoom-btn'); if (!b) return;
    const z = b.getAttribute('data-z');
    if (z === 'in') zoomTo(s * 1.8);
    else if (z === 'out') zoomTo(s / 1.8);
    else fit();
  });

  // Tapping a pin highlights and scrolls to its place card (ignored right after a
  // pan/pinch, so dragging the map never fires a pin).
  pinsBox.addEventListener('click', (ev) => {
    if (dragged) { ev.preventDefault(); ev.stopPropagation(); return; }
    const btn = ev.target.closest('.pin');
    if (!btn) return;
    const idx = btn.getAttribute('data-idx');
    const card = list.querySelector(`#place-${idx}`);
    if (!card) return;
    list.querySelectorAll('.place-card.lit').forEach((c) => c.classList.remove('lit'));
    pinsBox.querySelectorAll('.pin.active').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    card.classList.add('lit');
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  return wrap;
}

// Geocode every trip that has a destination but no coordinates, cache the result
// on each event (as a lightweight `geo` fix), then redraw the map. Needs the
// internet just for this lookup; the pins are permanent afterwards.
async function findMapPlaces(pending, btn) {
  btn.disabled = true;
  const label = btn.querySelector('span');
  const original = label ? label.textContent : '';
  if (label) label.textContent = `Looking up ${pending.length}…`;
  const failed = [];
  for (const ev of pending) {
    try {
      const g = await weather.geocode(ev.destination);
      ev.geo = coerceGeo({ lat: g.lat, lon: g.lon, place: g.place });
      await db.saveEvent(ev);
    } catch (err) {
      console.error('AMS Packing List: geocode failed for', ev.destination, err);
      failed.push(ev.destination);
    }
  }
  if (failed.length) {
    alert(failed.length === pending.length
      ? 'Could not look up those places — check your internet connection and try again.'
      : `Located the rest, but couldn’t find: ${failed.join(', ')}. Check the spelling on those trips.`);
  }
  if (label) label.textContent = original;
  btn.disabled = false;
  render();   // redraw the map with the new pins
}

// ============================================================
// The trip date picker — one dropdown, both ends of the trip (v125)
// ============================================================
//
// It used to be two separate `<input type="date">` boxes, which meant two separate
// calendars that knew nothing about each other: you picked a departure in one,
// closed it, opened the other, and had to find the same month again with no sight
// of where the trip started or how long it had got. A date range is ONE idea, so
// it is now one control — open it, tap the day you leave, tap the day you come
// back, and it closes itself with the nights counted.
//
// Two deliberate decisions:
//   * The panel opens IN FLOW, not floating over the page. An absolutely-positioned
//     popover has to be kept in view against scrolling, a soft keyboard and the
//     card's own overflow; a panel that simply pushes the form down cannot be
//     clipped, and behaves the same on the Mac and the phone.
//   * The picked dates are written to HIDDEN INPUTS still named `startDate` and
//     `endDate`, and every pick fires a `change` on the wrapper. So the form's
//     FormData reading and the live nights readout below it are untouched —
//     nothing downstream of this control had to know it changed.
//
// All the date arithmetic is in model.js and all of it is UTC: build a grid from a
// local `new Date(y, m, d)` and a picker west of Greenwich hands back the day
// before the one that was tapped.
function tripDatesField(startISO = '', endISO = '') {
  let start = String(startISO || '').slice(0, 10);
  let end = String(endISO || '').slice(0, 10);
  let picking = 'start';         // which end the next tap sets
  let hover = '';                // the day under the cursor, for the live preview
  let view = monthKey(start) || monthKey(todayISO()) || '';
  const MONTHS_SHOWN = 2;        // side by side on the Mac, stacked on a phone

  const el = h(`<div class="daterange" data-daterange>
    <span class="dr-lbl">Trip dates <em>(optional — start, then end)</em></span>
    <button type="button" class="dr-trigger" aria-expanded="false"></button>
    <div class="dr-pop" hidden>
      <div class="dr-step" data-dr-step></div>
      <div class="dr-nav">
        <button type="button" class="iconbtn sm" data-dr-nav="-1" aria-label="Previous month" title="Previous month">${IC.back}</button>
        <span class="dr-span" data-dr-span></span>
        <button type="button" class="iconbtn sm" data-dr-nav="1" aria-label="Next month" title="Next month">${IC.fwd}</button>
      </div>
      <div class="dr-months" data-dr-months></div>
      <div class="dr-foot">
        <span class="dr-sum" data-dr-sum></span>
        <span class="dr-foot-btns">
          <button type="button" class="btn ghost sm" data-dr="today">Today</button>
          <button type="button" class="btn ghost sm" data-dr="clear">Clear</button>
          <button type="button" class="btn primary sm" data-dr="done">Done</button>
        </span>
      </div>
    </div>
    <input type="hidden" name="startDate" value="${esc(start)}">
    <input type="hidden" name="endDate" value="${esc(end)}">
  </div>`);

  const trigger = el.querySelector('.dr-trigger');
  const pop = el.querySelector('.dr-pop');
  const startInput = el.querySelector('input[name=startDate]');
  const endInput = el.querySelector('input[name=endDate]');

  // Weekday initials in the user's own language, taken from a week that really
  // starts on a Monday (1 Jan 2024 was one) rather than hard-coded English.
  const weekdayNames = () => Array.from({ length: 7 }, (_, i) =>
    new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' }));
  const monthName = (key) => {
    const m = /^(\d{4})-(\d{2})$/.exec(key || '');
    if (!m) return '';
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1))
      .toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  };

  // What the closed field says. Three honest states, never a bare "dd/mm/yyyy".
  function triggerHTML() {
    const n = nightsBetween(start, end);
    if (!start) return `${ic('cal', 'md')}<span class="dr-txt muted">Add dates</span>`;
    if (!end) return `${ic('cal', 'md')}<span class="dr-txt">${esc(prettyDate(start))}<em>no return day yet</em></span>`;
    return `${ic('cal', 'md')}<span class="dr-txt">${esc(prettyRange(start, end))}<em>${n === 0 ? 'day trip · 0 nights' : `${n + 1} days · ${n} night${n === 1 ? '' : 's'}`}</em></span>`;
  }

  // The range as it stands, including the day under the cursor while you are still
  // choosing the far end — so you can see how long the trip is before committing.
  function shownRange() {
    if (picking === 'end' && start && !end && hover) return orderRange(start, hover);
    return [start, end];
  }

  function drawPanel() {
    const [a, b] = shownRange();
    const today = todayISO();
    const names = weekdayNames();
    const months = Array.from({ length: MONTHS_SHOWN }, (_, i) => monthGrid(shiftMonth(view, i)));
    el.querySelector('[data-dr-months]').innerHTML = months.map((m) => `<div class="dr-month">
      <div class="dr-mname">${esc(monthName(m.key))}</div>
      <div class="dr-wdays">${names.map((n) => `<span>${esc(n.slice(0, 2))}</span>`).join('')}</div>
      <div class="dr-grid">${m.days.map((d) => {
      // Days belonging to a neighbouring month are drawn as empty cells, not as
      // faint numbers. With two months on screen at once the same day would
      // otherwise appear TWICE — 1–6 Sept sits in both the August and the
      // September grid — and a selected range would light up in both places,
      // which reads as two ranges. The blank keeps the 7×6 geometry so the
      // weeks still line up under their weekday headings.
      if (!d.inMonth) return '<span class="dr-day out" aria-hidden="true"></span>';
      const state = rangeCellState(d.iso, a, b);
      const cls = ['dr-day', state, d.iso === today ? 'today' : ''].filter(Boolean).join(' ');
      return `<button type="button" class="${cls}" data-d="${d.iso}" tabindex="-1">${Number(d.iso.slice(8, 10))}</button>`;
    }).join('')}</div>
    </div>`).join('');

    el.querySelector('[data-dr-span]').textContent = months.length > 1
      ? `${monthName(months[0].key)} – ${monthName(months[months.length - 1].key)}`
      : monthName(months[0].key);

    const step = el.querySelector('[data-dr-step]');
    step.textContent = picking === 'start' || !start
      ? 'Tap the day you leave'
      : 'Now tap the day you come back — or the same day for a day trip';

    const n = nightsBetween(a, b);
    el.querySelector('[data-dr-sum]').textContent = !a ? 'No dates yet'
      : !b ? prettyDate(a)
        : `${prettyRange(a, b)} · ${n === 0 ? '0 nights (day trip)' : `${n} night${n === 1 ? '' : 's'}`}`;
  }

  // The one place the value leaves this control. Everything downstream — the nights
  // hint, the submit handler — reads the hidden inputs, so they are written first
  // and the event goes out afterwards.
  function commit() {
    startInput.value = start;
    endInput.value = end;
    trigger.innerHTML = triggerHTML();
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function open() {
    view = monthKey(start) || monthKey(todayISO()) || view;
    picking = start && end ? 'start' : (start ? 'end' : 'start');
    hover = '';
    pop.hidden = false;
    // `busyEditing()` skips background re-renders while this class is on, so a
    // sync refresh arriving mid-pick cannot redraw the form out from under you.
    el.classList.add('dr-open');
    trigger.setAttribute('aria-expanded', 'true');
    drawPanel();
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('click', onOutside, true);
  }
  function close() {
    if (pop.hidden) return;
    pop.hidden = true;
    el.classList.remove('dr-open');
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('click', onOutside, true);
  }
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const onOutside = (e) => { if (!el.contains(e.target)) close(); };

  trigger.addEventListener('click', () => { if (pop.hidden) open(); else close(); });

  pop.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-dr-nav]');
    if (nav) { view = shiftMonth(view, Number(nav.dataset.drNav)); drawPanel(); return; }

    const act = e.target.closest('[data-dr]')?.dataset.dr;
    if (act === 'clear') { start = ''; end = ''; picking = 'start'; hover = ''; commit(); drawPanel(); return; }
    if (act === 'today') { view = monthKey(todayISO()); drawPanel(); return; }
    if (act === 'done') { close(); return; }

    const day = e.target.closest('[data-d]');
    if (!day) return;
    const iso = day.dataset.d;
    if (picking === 'start' || !start) {
      // A fresh range always starts here — including the second visit to a field
      // that already holds one, because "change these dates" nearly always means
      // "start again", not "nudge the return day".
      start = iso; end = ''; picking = 'end'; hover = '';
      commit(); drawPanel();
      return;
    }
    if (iso < start) {
      // Earlier than the start: a correction, not an error. Re-anchor rather than
      // refuse, which is what every date-range picker does and what people expect.
      start = iso; end = ''; picking = 'end'; hover = '';
      commit(); drawPanel();
      return;
    }
    end = iso; picking = 'start'; hover = '';
    commit(); drawPanel();
    close();          // both ends chosen — the flow is finished, so get out of the way
  });

  // Live preview of the range while the far end is still being chosen. Pointer
  // only; a touch has no hover, and there the tap itself is the feedback.
  pop.addEventListener('mouseover', (e) => {
    if (picking !== 'end' || !start || end) return;
    const day = e.target.closest('[data-d]');
    if (!day || day.dataset.d === hover) return;
    hover = day.dataset.d;
    drawPanel();
  });
  pop.addEventListener('mouseleave', () => { if (hover) { hover = ''; drawPanel(); } });

  trigger.innerHTML = triggerHTML();
  return el;
}

// ============================================================
// Event settings form (used inline on Home for new, and on the edit route)
// ============================================================
function eventForm(ev, lists, isEdit) {
  const form = h('<form class="form"></form>');
  // Older events stored only `nights`; show an end date derived from start + nights.
  const endVal = ev.endDate || endFromNights(ev.startDate, ev.nights);
  // What the list auto-includes (so the builder explains itself): the always-on
  // common base, plus which transports actually carry their own base list today.
  const baseNames = lists.filter((l) => l.role === 'base' && l.items.length).map((l) => l.name);
  const transportsWithKit = lists.filter((l) => l.role === 'transport' && l.items.length).map((l) => l.transport);
  const baseHint = baseNames.length
    ? `Always included: your <b>${esc(baseNames.join(' + '))}</b> base.`
    : '';
  const transportHint = transportsWithKit.length
    ? ` Choosing <b>${esc(transportsWithKit.join(' / '))}</b> also adds that transport’s own kit${transportsWithKit.includes('RV') ? ' (the full motorhome list)' : ''}.`
    : '';
  // On the Home builder (not the edit screen), offer any saved presets to fill
  // the form in one tap.
  const presets = !isEdit ? loadPresets() : [];
  const presetBar = presets.length ? `<div class="preset-bar" data-preset-bar>
    <span class="preset-lbl">${ic('bolt','sm')}Start from a preset</span>
    <div class="preset-chips">${presets.map((p) => `<button type="button" class="preset-chip" data-preset="${esc(p.id)}">${esc(p.name)}</button>`).join('')}</div>
  </div>` : '';
  form.innerHTML = `
    ${presetBar}
    <!-- Name first (v126): what the trip IS comes before how it is built. The
         List-type radio used to open the form, which asked you to classify a trip
         you hadn't named yet. -->
    <label class="field"><span>Event name</span>
      <input name="name" value="${esc(ev.name)}" placeholder="e.g. Dolomites road trip" autocomplete="off"></label>
    <div data-dates-slot></div>
    <p class="nights-hint muted" data-nights-hint></p>
    <label class="field"><span>Destination <em>(optional — for weather)</em></span>
      <input name="destination" value="${esc(ev.destination)}" placeholder="e.g. Chamonix" autocomplete="off"></label>

    <fieldset class="mode-pick"><legend>List type</legend>${radioRow('mode', [
    { value: 'trip', label: 'Full trip' },
    { value: 'quick', label: '⏱️ Quick activity' },
  ], ev.mode || 'trip')}
      <p class="grp-hint" data-mode-hint></p></fieldset>

    <!-- Activities sit right under List type (v127): the two answer the same
         question — what is this trip FOR — and everything below them (transport,
         season, weather, catering) is detail about the conditions. The legend is
         plain "Activities to pack for" in both modes now; the hint below it is
         what explains that a full trip already has its base and transport kit. -->
    <fieldset><legend>Activities to pack for</legend>
      <p class="grp-hint" data-activities-hint></p>
      ${activitiesPicker(lists, ev.activities, ev.contexts)}
    </fieldset>

    <fieldset data-trip-only><legend>Way of transport</legend>${radioRow('transport', TRANSPORTS, ev.transport)}
      ${baseHint || transportHint ? `<p class="grp-hint">${baseHint}${transportHint}</p>` : ''}</fieldset>
    <fieldset><legend>Time of year</legend>${radioRow('season', SEASONS, ev.season)}</fieldset>
    <fieldset><legend>Force-pack weather gear</legend>${checkRow('weatherOn', WEATHER_CONDITIONS.map((w) => ({ value: w.id, label: w.label })), ev.weatherOn)}
      <p class="grp-hint">Tick a condition to <b>force in</b> every item tagged for it — packed as a precaution <b>whatever the forecast or season</b>. Handy for cold-weather kit on a summer trip, or a rain layer just in case. Leave them all off and weather gear stays held back until a fetched forecast calls for it.</p></fieldset>
    <fieldset data-trip-only><legend>Catering</legend>${radioRow('catering', CATERING.map((c) => ({ value: c.id, label: c.label })), ev.catering)}</fieldset>
    <label class="field-check"><input type="checkbox" name="laundry"${ev.laundry ? ' checked' : ''}>
      <span class="fc-txt"><b>${ic('laundry','sm')}Laundry available on this trip</b><em>Caps per-night items (socks, underwear, tees) at ${LAUNDRY_CAP_NIGHTS} rather than one per night, so a long trip doesn’t demand a dozen. Short trips are unaffected.</em></span></label>

    <div class="actions">
      ${isEdit ? `<a class="btn lg" href="#/event/${ev.id}">Cancel</a>` : ''}
      <button type="submit" class="btn primary lg">${isEdit ? 'Save & regenerate' : 'Create Event'}</button>
    </div>`;

  // Full trip vs Quick activity: quick mode drops the base + transport kit, so hide
  // the trip-only choices and re-word the activity picker's HINT to match. The
  // legend itself is fixed at "Activities to pack for" in both modes (v127) — it
  // used to flip to "Extra activities…" for a full trip, and a heading that
  // renames itself under you is harder to read than a sentence that explains why.
  function syncMode() {
    const quick = form.querySelector('input[name=mode]:checked')?.value === 'quick';
    form.querySelectorAll('[data-trip-only]').forEach((el) => el.classList.toggle('hidden', quick));
    const aHint = form.querySelector('[data-activities-hint]');
    const mHint = form.querySelector('[data-mode-hint]');
    if (aHint) aHint.innerHTML = quick
      ? 'Just the gear for what you tick — set <b>Context</b> (Indoor / Outdoor) to trim it to the essentials.'
      : 'Your common base and transport kit are already in — tick only the extra activities you’ll do.';
    if (mHint) mHint.textContent = quick
      ? 'Just a bag for one or more activities — no base, no transport kit. Great for a swim or a run.'
      : 'Everything for a real trip: your common base + transport kit + the activities you tick.';
  }

  // Keep segmented/checkbox visual state in sync.
  form.addEventListener('change', (e) => {
    const t = e.target;
    if (t.type === 'radio') $$(`.seg`, t.closest('fieldset')).forEach((s) => s.classList.toggle('on', s.querySelector('input').checked));
    if (t.type === 'checkbox') t.closest('label')?.classList.toggle('on', t.checked);
    if (t.name === 'mode') syncMode();
  });
  syncMode();

  // Preset chips (Home builder): fill the whole form from a saved recipe.
  form.querySelector('[data-preset-bar]')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-preset]');
    if (!btn) return;
    const preset = loadPresets().find((p) => p.id === btn.dataset.preset);
    if (!preset) return;
    applyPresetToForm(form, preset.config);
    form.querySelectorAll('.preset-chip').forEach((c) => c.classList.toggle('applied', c === btn));
  });

  // Both ends of the trip come from ONE control (v125). It supplies the same two
  // hidden inputs the form has always read, so nothing below this line changed.
  const datesField = tripDatesField(ev.startDate, endVal);
  form.querySelector('[data-dates-slot]').replaceWith(datesField);

  // Live nights readout: the trip length is derived from start -> end, and still
  // shown explicitly because it drives per-night quantities.
  const startInput = form.querySelector('input[name=startDate]');
  const endInput = form.querySelector('input[name=endDate]');
  const nightsHint = form.querySelector('[data-nights-hint]');
  function refreshNights() {
    const n = nightsBetween(startInput.value, endInput.value);
    let msg;
    if (!startInput.value) msg = 'No dates yet — the nights between them scale per-night quantities (socks, underwear, tees).';
    else if (!endInput.value) msg = 'Add the day you come back to count the nights — they scale per-night quantities.';
    else {
      const days = n + 1;  // inclusive calendar days: start and end day both count
      msg = n === 0
        ? '1 day · 0 nights (day trip)'
        : `${days} days · ${n} night${n === 1 ? '' : 's'}`;
    }
    // The picker cannot produce an end before a start any more — an earlier tap
    // re-anchors the range — so the old "End date is before the start date"
    // warning has nothing left to warn about.
    nightsHint.textContent = msg;
  }
  datesField.addEventListener('change', refreshNights);
  refreshNights();

  // Per-group "select all / none" for the activity picker.
  form.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-selall]');
    if (!btn) return;
    e.preventDefault();
    const grp = btn.closest('.grp');
    // Activities only — the WET block also holds the Indoor/Outdoor/Race options,
    // and "select all" is about which activities to pack for, not those.
    const boxes = $$('input[name=activities]', grp);
    const turnOn = boxes.some((b) => !b.checked); // if any off, select all; else clear all
    boxes.forEach((b) => { b.checked = turnOn; b.closest('label')?.classList.toggle('on', turnOn); });
    btn.textContent = turnOn ? 'clear' : 'select all';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    ev.name = (fd.get('name') || '').toString().trim() || 'Untitled event';
    ev.mode = fd.get('mode') === 'quick' ? 'quick' : 'trip';
    ev.startDate = (fd.get('startDate') || '').toString();
    ev.endDate = (fd.get('endDate') || '').toString();
    const newDest = (fd.get('destination') || '').toString().trim();
    if (newDest !== ev.destination) ev.weather = null;  // place changed -> stale forecast
    ev.destination = newDest;
    ev.transport = fd.get('transport') || 'Car';
    ev.season = fd.get('season') || 'Summer';
    ev.catering = fd.get('catering') || 'mixed';
    ev.nights = nightsBetween(ev.startDate, ev.endDate) || 0;  // derived from start -> end date
    ev.laundry = !!fd.get('laundry');
    ev.contexts = fd.getAll('contexts');
    ev.weatherOn = fd.getAll('weatherOn');
    ev.activities = fd.getAll('activities');
    // In quick mode there's no base to fall back on, so no ticks means an empty list.
    if (ev.mode === 'quick' && !ev.activities.length
      && !confirm('No activities ticked — a Quick list needs at least one. Create an empty list anyway?')) return;

    const freshLists = await db.getLists();
    ev.entries = isEdit ? regenerateEntries(ev, freshLists) : buildTotalEntries(ev, freshLists);
    ev.generatedAt = new Date().toISOString();
    if (await saveGuard(db.saveEvent(ev))) location.assign(`#/event/${ev.id}`);
  });
  return form;
}

async function renderEventForm(existing) {
  const ev = existing || newEvent({});
  const lists = await db.getLists();
  const wrap = h('<section class="screen"></section>');
  wrap.appendChild(h(backBar('Event settings', `#/event/${ev.id}`)));
  wrap.appendChild(eventForm(ev, lists, true));
  return wrap;
}

// ============================================================
// Event Total List (the heart)
// ============================================================
const VIEW_KEY = 'ams-view';
const VIEW_MODES = ['when', 'container', 'category', 'ga', 'wet', 'section', 'stored'];
function totalView() { try { const v = localStorage.getItem(VIEW_KEY); return VIEW_MODES.includes(v) ? v : 'when'; } catch { return 'when'; } }
// Does this trip have any sectioned items? (The Section group-by only appears then.)
function tripHasSections(ev) { return (ev.entries || []).some((e) => (e.section || '').trim()); }
// Does this trip have any items with a storage place? (Gates the Stored group-by.)
function tripHasStorage(ev) { return (ev.entries || []).some((e) => (e.storage || '').trim()); }
// Map each template list's id to its group (GA/WET/…) and name, from the cache
// loaded on the event screen — so an entry can be traced back to the activity it
// came from for the GA / WET group-by.
function listInfoById() {
  const m = new Map();
  for (const l of (ALL_LISTS || [])) m.set(l.id, { group: l.group, name: l.name });
  return m;
}
// Does this trip pack anything from a GA (or WET) activity list? Gates those
// group-by buttons, so they only appear when there's an activity to group by.
function tripHasGroup(ev, gid) {
  const info = listInfoById();
  return (ev.entries || []).some((e) => info.get(e.sourceListId)?.group === gid);
}
// The effective group-by for a trip: fall back off any mode that would leave the
// list looking empty (no sections / storage / GA / WET items), so the toggle is safe.
function viewFor(ev) {
  const v = totalView();
  if (v === 'section' && !tripHasSections(ev)) return 'when';
  if (v === 'stored' && !tripHasStorage(ev)) return 'when';
  if (v === 'ga' && !tripHasGroup(ev, 'GA')) return 'when';
  if (v === 'wet' && !tripHasGroup(ev, 'WET')) return 'when';
  return v;
}
// Group entries by the ACTIVITY list they came from, within one group (GA or WET):
// each Golf / Hiking / Swim / Run list becomes its own bucket, so you can gather
// one activity's kit at once. Everything not from that group — the common base,
// the transport kit, other activities and manual adds — falls into a trailing
// "Everything else" bucket. (Shared gear lands in the base, so a bucket holds the
// kit that's specific to that activity.)
function groupByActivity(entries, gid) {
  const info = listInfoById();
  const buckets = new Map(); // list name -> entries
  const other = [];
  for (const e of entries) {
    const src = info.get(e.sourceListId);
    const name = src && src.group === gid ? (src.name || '').trim() : '';
    if (name) { if (!buckets.has(name)) buckets.set(name, []); buckets.get(name).push(e); }
    else other.push(e);
  }
  const out = [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, list]) => ({ label, entries: list }));
  if (other.length) out.push({ label: 'Everything else', entries: other });
  return out;
}
function setTotalView(v) { try { localStorage.setItem(VIEW_KEY, v); } catch {} }
let expandedEntry = null; // id of the entry whose inline editor is open
// When you reach the full item editor from somewhere that expects you back — today
// only Packing Mode — this holds the route to return to once you've saved (or backed
// out). It's consumed on use, so a later visit to the same item stays put as usual.
let itemEditorReturn = null;
let flagFilter = new Set(); // active "sort out" filters on the Total List: 'liquid' and/or 'charge'
let flagFilterFor = null;   // the event id the filter belongs to (cleared when you switch trips)
let weightSort = false;     // "Heaviest first" ordering toggle on the Total List
let personFilter = '';      // who-packs-what filter: '' = everyone, '__none__' = unassigned, else a person name
// Does an entry pass the current person filter? (Shared by the list + Packing Mode.)
function matchesPerson(entry) {
  if (!personFilter) return true;
  const pk = (entry.packer || '').trim();
  if (personFilter === '__none__') return !pk;
  return normName(pk) === normName(personFilter);
}
const collapsedGroups = new Set(); // group headings folded closed on the Total List (keyed `mode|label`)

async function renderEvent(eventId) {
  const ev = await db.getEvent(eventId);
  if (!ev) { location.assign('#/'); return h('<section></section>'); }
  ALL_LISTS = await db.getLists(); // so an entry can be traced back to its template item
  if (flagFilterFor !== eventId) { flagFilter = new Set(); weightSort = false; personFilter = ''; collapsedGroups.clear(); flagFilterFor = eventId; } // fresh per trip
  const p = progress(ev.entries);

  const wrap = h('<section class="screen"></section>');
  const topbar = h(`<div class="topbar">
    <a class="iconbtn" href="#/" aria-label="Back">${IC.back}</a>
    <h1 class="grow">${esc(ev.name)}</h1>
    <button class="iconbtn" type="button" data-rename aria-label="Rename event">${IC.edit}</button>
    <a class="iconbtn" href="#/event/${ev.id}/edit" aria-label="Event settings">${IC.gear}</a>
    <button class="iconbtn" type="button" data-evmenu aria-label="More actions for this trip" title="Mark everything packed, share, delete…">${IC.more}</button>
  </div>`);
  topbar.querySelector('[data-rename]').addEventListener('click', async () => {
    const name = (prompt('Rename event:', ev.name) || '').trim();
    if (!name || name === ev.name) return;
    ev.name = name;
    if (await saveGuard(db.saveEvent(ev))) render();
  });
  topbar.querySelector('[data-evmenu]').addEventListener('click', () => openEventMenu(ev));
  wrap.appendChild(topbar);

  const openTodos = (await db.getActions()).filter((a) => !a.done && a.kind !== 'shopping').length;
  const summary = h('<div class="ev-summary"></div>');
  summary.appendChild(readinessDashboard(ev, openTodos));
  wrap.appendChild(summary);

  wrap.appendChild(tripSetupCard(ev));

  const nudge = tripNudge(ev);
  if (nudge && nudge.dueCount > 0) {
    wrap.appendChild(h(`<a class="nudge" href="#/event/${ev.id}/pack">
      <span class="nudge-ic">${ic('clock','md')}</span>
      <span class="nudge-body"><b>${esc(nudge.label)}</b> — ${nudge.dueCount} item${nudge.dueCount === 1 ? '' : 's'} to pack now<span class="nudge-sub">${esc(nudge.focusLabel)}</span></span>
      <span class="nudge-go">${IC.fwd}</span>
    </a>`));
  }

  const wxLists = await db.getLists();
  const wx = weatherSection(ev, wxLists);
  if (wx) wrap.appendChild(wx);

  if (p.total) wrap.appendChild(logisticsSummary(ev));

  const view = viewFor(ev);
  const segBtn = (val, label) => `<label class="seg${view === val ? ' on' : ''}"><input type="radio" name="tview" value="${val}"${view === val ? ' checked' : ''}>${label}</label>`;
  const toolbar = h(`<div class="toolbar">
    <span class="toolbar-lbl">Group by</span>
    <div class="segmented small">
      ${segBtn('when', 'When')}${segBtn('container', 'Where')}${segBtn('category', 'Category')}${tripHasGroup(ev, 'GA') ? segBtn('ga', 'GA') : ''}${tripHasGroup(ev, 'WET') ? segBtn('wet', 'WET') : ''}${tripHasSections(ev) ? segBtn('section', 'Section') : ''}${tripHasStorage(ev) ? segBtn('stored', 'Stored') : ''}
    </div>
    <div class="spacer"></div>
    <button class="btn ghost" data-act="add">${IC.plus}<span>Item</span></button>
    <button class="btn ghost" data-act="kit">${ic('toolbox')}<span>Kit</span></button>
    <button class="btn ghost" data-act="regen">${IC.refresh}<span>Regenerate</span></button>
    <button class="btn ghost" data-act="preset">${IC.star}<span>Save as preset</span></button>
    <button class="btn ghost" data-act="review">${IC.check}<span>Trip review</span></button>
    <button class="btn ghost" data-act="share">${IC.share}<span>Share</span></button>
    <button class="btn ghost" data-act="xlsx">${IC.sheet}<span>Excel</span></button>
  </div>`);
  wrap.appendChild(toolbar);

  const body = h('<div class="total"></div>');
  wrap.appendChild(body);

  const rerender = () => { renderTotalBody(body, ev); };
  rerender();

  // "Sort out" quick filters: isolate all the liquids, or everything that charges
  // so they can be gathered — the wash bag, the cable pouch. Reuses the same rows.
  const liquidCount = ev.entries.filter((e) => e.liquid).length;
  const chargeCount = ev.entries.filter((e) => e.charging).length;
  const restrictedCount = ev.entries.filter((e) => e.restricted).length;
  const weightedCount = ev.entries.filter((e) => Number(e.weight) > 0).length;
  if (liquidCount || chargeCount || restrictedCount || weightedCount) {
    const fchip = (key, label, n) => `<button class="fchip${flagFilter.has(key) ? ' on' : ''}" data-filter="${key}">${label} <em>${n}</em></button>`;
    const filterbar = h(`<div class="filterbar">
      <span class="filterbar-lbl">Sort out</span>
      ${liquidCount ? fchip('liquid', `${ic('drop','sm')}Liquids`, liquidCount) : ''}
      ${chargeCount ? fchip('charge', `${ic('bolt','sm')}Charge`, chargeCount) : ''}
      ${restrictedCount ? fchip('restricted', `${ic('warn','sm')}Restricted`, restrictedCount) : ''}
      ${weightedCount ? `<button class="fchip${weightSort ? ' on' : ''}" data-filter="__weight">${ic('weight','sm')}Heaviest</button>` : ''}
      <button class="fchip clear" data-filter="__clear" hidden>Show all</button>
    </div>`);
    wrap.insertBefore(filterbar, body);
    const syncChips = () => {
      $$('.fchip[data-filter]', filterbar).forEach((c) => {
        const k = c.dataset.filter;
        if (k === '__clear') return;
        c.classList.toggle('on', k === '__weight' ? weightSort : flagFilter.has(k));
      });
      $('.fchip.clear', filterbar).hidden = flagFilter.size === 0 && !weightSort;
    };
    filterbar.addEventListener('click', (e) => {
      const key = e.target.closest('[data-filter]')?.dataset.filter;
      if (!key) return;
      if (key === '__clear') { flagFilter.clear(); weightSort = false; }
      else if (key === '__weight') weightSort = !weightSort;
      else if (flagFilter.has(key)) flagFilter.delete(key); else flagFilter.add(key);
      syncChips();
      rerender();
    });
    syncChips();
  }

  // Who-packs-what filter — shows once anything on this trip is assigned to someone.
  const tripPeople = assignedPeople(ev.entries);
  if (tripPeople.length) {
    const unassigned = ev.entries.filter((e) => !(e.packer || '').trim()).length;
    const pcount = (name) => ev.entries.filter((e) => normName(e.packer) === normName(name)).length;
    const pchip = (key, label, dot, n) => `<button class="pchip${personFilter === key ? ' on' : ''}" data-person-filter="${esc(key)}">${dot ? `<span class="person-dot" style="background:${esc(dot)}"></span>` : ''}${esc(label)}${n != null ? ` <em>${n}</em>` : ''}</button>`;
    const personbar = h(`<div class="filterbar personbar">
      <span class="filterbar-lbl">Who packs</span>
      ${pchip('', 'Everyone', '', null)}
      ${tripPeople.map((n) => pchip(n, n, peopleColor(n), pcount(n))).join('')}
      ${unassigned ? pchip('__none__', 'Unassigned', '', unassigned) : ''}
    </div>`);
    wrap.insertBefore(personbar, body);
    personbar.addEventListener('click', (e) => {
      const key = e.target.closest('[data-person-filter]')?.dataset.personFilter;
      if (key == null) return;
      personFilter = personFilter === key ? '' : key;
      $$('.pchip', personbar).forEach((c) => c.classList.toggle('on', c.dataset.personFilter === personFilter));
      rerender();
    });
  }

  toolbar.addEventListener('change', (e) => {
    if (e.target.name === 'tview') {
      setTotalView(e.target.value);
      $$('.segmented .seg', toolbar).forEach((s) => s.classList.toggle('on', s.querySelector('input').checked));
      rerender();
    }
  });
  toolbar.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'add') { addEntry(ev, body); }
    else if (act === 'kit') {
      const kit = await pickKit('Add a kit to this trip');
      if (!kit) return;
      const members = await kitCatalogItems(kit);
      if (!members.length) { alert(`“${kit.name}” has no items yet. Add some in Settings → Kits.`); return; }
      const { added, total } = addKitToTrip(ev, kit, members);
      if (await saveGuard(db.saveEvent(ev))) {
        showToast(added ? `Added ${kitEmoji(kit)} ${kit.name} — ${added} item${added === 1 ? '' : 's'}${added < total ? ` (${total - added} already on the list)` : ''}` : `All of ${kit.name} was already on the list — grouped it into the kit`);
        render();
      }
    }
    else if (act === 'regen') {
      if (!confirm('Regenerate from your packing lists? Your manual additions, edits and ticks are kept; new matching items are added.')) return;
      const lists = await db.getLists();
      ev.entries = regenerateEntries(ev, lists);
      if (await saveGuard(db.saveEvent(ev))) render();
    } else if (act === 'preset') {
      const name = (prompt('Save this trip’s setup — which activities are ticked plus its transport, season, catering, weather and laundry settings — as a preset you can reuse for a similar trip.\n\nIt saves no items and no dates: the gear still comes from your templates.\n\nPreset name:', ev.name || '') || '').trim();
      if (!name) return;
      if (loadPresets().some((p) => p.name.toLowerCase() === name.toLowerCase())
        && !confirm(`A preset called “${name}” already exists. Replace it?`)) return;
      await addPreset(name, ev);
      alert(`Saved “${name}” as a preset.\n\nStart a new trip from it on the Home screen — look for “Start from a preset”.`);
    } else if (act === 'review') { location.assign(`#/event/${ev.id}/review`); }
    else if (act === 'share') { shareTrip(ev); }
    else if (act === 'xlsx') { exportEventXlsx(ev); }
  });

  return wrap;
}

// A pretty, read-only recap of every choice made when the event was created —
// list type, dates, destination, transport, season, catering, WET contexts and
// the activities that were ticked. Collapsible so it never crowds the list.
// The app's own vocabulary for a trip's settings, drawn from the interface icon
// family (weather and seasons keep the coloured WIC glyphs, so the sky still
// reads at a glance the way it does on a trip card).
const TRANSPORT_ICON = { Car: 'car', Plane: 'plane', RV: 'rv' };
const CATERING_ICON = { self: 'pan', eatout: 'cutlery', mixed: 'takeaway' };
const CONTEXT_ICON = { Indoor: 'home', Outdoor: 'tree', Race: 'flag' };
const GROUP_ICON = { GA: 'target', WET: 'dumbbell', OE: 'balloon' };
const SEASON_WIC = { Summer: 'sun', Winter: 'snowflake' };
const WX_WIC = { rain: 'rain', cold: 'cold', hot: 'hot', wind: 'wind', snow: 'snow' };
function tripSetupCard(ev) {
  const quick = ev.mode === 'quick';

  // Single-value settings become tiles in a responsive grid.
  const tiles = [];
  const tile = (glyph, lbl, val) => tiles.push(
    `<div class="setup-tile"><span class="setup-ic">${glyph}</span>`
    + `<div class="setup-txt"><span class="setup-lbl">${esc(lbl)}</span>`
    + `<span class="setup-val">${val}</span></div></div>`);

  tile(ic(quick ? 'clock' : 'suitcase', 'md'), 'List type', quick ? 'Quick activity' : 'Full trip');

  const endVal = ev.endDate || endFromNights(ev.startDate, ev.nights);
  if (ev.startDate || endVal) {
    const n = nightsBetween(ev.startDate, endVal);
    const sub = n == null ? '' : n === 0 ? ' · day trip' : ` · ${n} night${n === 1 ? '' : 's'}`;
    tile(ic('cal', 'md'), 'Dates', `${esc(prettyRange(ev.startDate, endVal))}${sub}`);
  }
  if (ev.destination) tile(ic('pin', 'md'), 'Destination', esc(ev.destination));
  if (ev.laundry) tile(ic('laundry', 'md'), 'Laundry', ev.nights > LAUNDRY_CAP_NIGHTS ? `Yes · per-night capped at ${LAUNDRY_CAP_NIGHTS}` : 'Yes');
  if (!quick && ev.transport) tile(ic(TRANSPORT_ICON[ev.transport] || 'car', 'md'), 'Transport', esc(ev.transport));
  if (ev.season) tile(wIcon(SEASON_WIC[ev.season] || 'sun'), 'Time of year', esc(ev.season));
  if (!quick && ev.catering) tile(ic(CATERING_ICON[ev.catering] || 'cutlery', 'md'), 'Catering', esc(cateringLabel(ev.catering)));

  // Multi-value settings (ticked activities, WET contexts) become tag rows below.
  const blocks = [];
  // The WET options (Indoor / Outdoor / Race) only ever qualify the WET activities,
  // so they sit indented directly under that group — exactly as they do in the event
  // form (v110) — rather than floating in a box of their own further up.
  const contexts = ev.contexts || [];
  const contextTags = contexts.length
    ? `<div class="setup-tags">${contexts.map((c) => `<span class="setup-tag">${ic(CONTEXT_ICON[c] || 'box', 'sm')}${esc(c)}</span>`).join('')}</div>`
    : '';
  let contextsPlaced = false;
  const weatherOn = ev.weatherOn || [];
  if (weatherOn.length) {
    const tags = weatherOn.map((w) => {
      const def = WEATHER_CONDITIONS.find((x) => x.id === w);
      return `<span class="setup-tag">${wIcon(WX_WIC[w] || 'cloud')}${esc(def ? def.label : w)}</span>`;
    }).join('');
    blocks.push(`<div class="setup-block"><span class="setup-lbl">Force-packed weather gear</span><div class="setup-tags">${tags}</div></div>`);
  }

  const byId = new Map((ALL_LISTS || []).map((l) => [l.id, l]));
  const chosen = (ev.activities || []).map((id) => byId.get(id)).filter(Boolean);
  if (chosen.length) {
    let inner = '';
    for (const g of GROUPS) {
      const arr = orderActivities(g.id, chosen.filter((l) => l.group === g.id));
      if (!arr.length) continue;
      inner += `<div class="setup-grp-lbl">${esc(g.id)} · ${esc(g.label)}</div>`
        + `<div class="setup-tags">${arr.map((l) => `<span class="setup-tag">${ic(GROUP_ICON[g.id] || 'box', 'sm')}${esc(l.name)}</span>`).join('')}</div>`;
      if (g.id === 'WET' && contextTags) {
        inner += `<div class="setup-sub"><span class="setup-sub-t">WET options</span>${contextTags}</div>`;
        contextsPlaced = true;
      }
    }
    const ung = chosen.filter((l) => !GROUP_IDS.includes(l.group));
    if (ung.length) {
      inner += '<div class="setup-grp-lbl">Other lists</div>'
        + `<div class="setup-tags">${ung.map((l) => `<span class="setup-tag">${ic('box','sm')}${esc(l.name)}</span>`).join('')}</div>`;
    }
    // One label in both modes, matching the form's fixed "Activities to pack for".
    blocks.push(`<div class="setup-block"><span class="setup-lbl">Activities packed for</span>${inner}</div>`);
  }
  // No WET activities on this trip to nest them under — show them on their own,
  // still last, so a chosen option can never go missing from the recap.
  if (contextTags && !contextsPlaced) {
    blocks.push(`<div class="setup-block"><span class="setup-lbl">WET options</span>${contextTags}</div>`);
  }

  return h(`<details class="setup" open>
    <summary><span class="setup-title">${ic('sparkle','sm')}Trip setup</span><span class="setup-chev">${IC.fwd}</span></summary>
    <div class="setup-body">
      <div class="setup-grid">${tiles.join('')}</div>
      ${blocks.join('')}
    </div>
  </details>`);
}

// A glanceable "trip readiness" hero for the top of the event screen: a packed
// progress ring plus the three numbers you check before a trip — days to go,
// packed weight (flagged if a bag is over its limit) and open to-dos. Every value
// is composed from data the app already computes; it's presentation, not new state.
function readinessDashboard(ev, openTodos = 0) {
  const p = progress(ev.entries);
  const qn = qtyNights(ev);
  const f = packingFlags(ev.entries, qn);
  const overBags = bagLoads(ev.entries, qn, containerLimits(ALL_LISTS || [])).filter((b) => b.over).length;

  // Days to go — a big value plus a short label, "soon" when it's within a week.
  const d = daysUntil(ev.startDate);
  let daysVal, daysLbl, daysState = '';
  if (d == null) { daysVal = '—'; daysLbl = 'no date set'; }
  else if (d > 1) { daysVal = String(d); daysLbl = 'days to go'; if (d <= 7) daysState = 'soon'; }
  else if (d === 1) { daysVal = '1'; daysLbl = 'day to go'; daysState = 'soon'; }
  else if (d === 0) { daysVal = 'Today'; daysLbl = 'departure'; daysState = 'soon'; }
  else { daysVal = String(-d); daysLbl = `day${d === -1 ? '' : 's'} ago`; }

  // Packed weight — flagged when any bag is over its limit.
  let wtVal, wtLbl, wtState = '';
  if (f.totalKg > 0) {
    wtVal = `${f.totalKg}<small>kg</small>`;
    if (overBags) { wtLbl = `${overBags} bag${overBags === 1 ? '' : 's'} over`; wtState = 'over'; }
    else wtLbl = f.weighed < f.total ? `${f.weighed}/${f.total} weighed` : 'packed weight';
  } else { wtVal = '—'; wtLbl = 'no weights yet'; }

  // Open to-dos (across the app), matching the Home nudge — links to the Actions tab.
  const todoVal = openTodos > 0 ? String(openTodos) : ic('check', 'sm');
  const todoLbl = openTodos > 0 ? `open to-do${openTodos === 1 ? '' : 's'}` : 'all clear';

  const pct = p.pct;
  return h(`<div class="readiness">
    <div class="rd-main">
      <div class="rd-ring${pct >= 100 ? ' done' : ''}" style="--pct:${pct}" role="img" aria-label="${pct}% packed">
        <div class="rd-ring-in">
          <span class="rd-ring-num">${pct}<small>%</small></span>
          <span class="rd-ring-cap">${p.done}/${p.total}</span>
        </div>
      </div>
      <div class="rd-side">
        <div class="rd-stat ${daysState}"><span class="rd-val">${daysVal}</span><span class="rd-lbl">${daysLbl}</span></div>
        <div class="rd-stat ${wtState}"><span class="rd-val">${wtVal}</span><span class="rd-lbl">${wtLbl}</span></div>
        <a class="rd-stat rd-link" href="#/actions"><span class="rd-val">${todoVal}</span><span class="rd-lbl">${todoLbl}</span></a>
      </div>
    </div>
    ${p.total ? `<a class="btn primary lg pack-cta" href="#/event/${ev.id}/pack">${IC.bag}<span>${p.done >= p.total ? `All packed${ic('check','sm')}` : p.done ? 'Continue packing' : 'Start packing'}</span></a>` : ''}
  </div>`);
}

// A collapsible "Bags & weight" panel: per-bag weight vs airline limit, plus liquids/battery counts.
function logisticsSummary(ev) {
  const qn = qtyNights(ev);
  const f = packingFlags(ev.entries, qn);
  const loads = bagLoads(ev.entries, qn, containerLimits(ALL_LISTS || [])).filter((b) => b.grams > 0 || b.limitKg > 0);
  const overBags = loads.filter((b) => b.over);
  const bits = [];
  if (f.totalKg > 0) bits.push(`${f.totalKg} kg`);
  if (f.liquids) bits.push(`${f.liquids} liquid`);
  if (f.restricted) bits.push(`${f.restricted} restricted`);
  if (ev.nights) bits.push(`${ev.nights} night${ev.nights === 1 ? '' : 's'}`);
  if (ev.laundry && ev.nights > LAUNDRY_CAP_NIGHTS) bits.push('laundry');
  const head = bits.length ? bits.join(' · ') : 'Add weights & flags to items to track bag loads';

  const det = h(`<details class="logi"${overBags.length ? ' open' : ''}>
    <summary><span class="logi-h">Bags &amp; weight</span><span class="logi-sum">${esc(head)}${overBags.length ? ` · <b class="warn">${overBags.length} over limit</b>` : ''}</span></summary>
    <div class="logi-body">
      ${loads.length ? loads.map((b) => `<div class="logi-row${b.over ? ' over' : ''}">
        <span class="logi-bag">${esc(b.container)}</span>
        <span class="logi-wt">${b.kg > 0 ? `${b.kg} kg` : '—'}${b.limitKg ? ` <em>/ ${b.limitKg} kg</em>` : ''}</span>
      </div>`).join('') : '<p class="muted">No weights recorded yet. Add a weight to an item (its editor) to see bag totals and carry-on warnings.</p>'}
      ${f.weighed < f.total ? `<p class="muted logi-note">${f.weighed}/${f.total} items have a weight — totals cover only those.</p>` : ''}
    </div>
  </details>`);
  return det;
}

// Turn a weather item spec into an editable entry: custom so a later Regenerate
// keeps it, but with the source link intact so trip-review stats still fold in.
function entryFromWeatherSpec(spec) {
  return newItem({
    name: spec.name, swedish: spec.swedish || '', category: spec.category,
    container: spec.container || '', phase: spec.phase || 'week',
    itemType: spec.itemType || 'item', liquid: !!spec.liquid, weight: spec.weight || 0,
    custom: true, sourceListId: spec.sourceListId || null, sourceItemId: spec.sourceItemId || null,
  });
}

// Weather block: a "Get forecast" prompt, the daily strip, a forecast-driven
// suggestion banner, and a "pack anyway" list so any weather gear can be added
// regardless of (or without) a forecast.
function weatherSection(ev, lists = []) {
  const dw = deriveWeather(ev);
  const gear = weatherGear(ev, lists);            // all applicable, unpacked weather gear
  if (!ev.destination && !gear.length) return null;
  const sec = h('<div class="weather"></div>');
  const suggested = new Set();                    // names already offered by the forecast

  if (!dw && ev.destination) {
    sec.appendChild(h(`<div class="wx-fetch">
      <span class="wx-place">${IC.pin}<span>Weather for <b>${esc(ev.destination)}</b></span></span>
      <button class="btn ghost sm" data-wx="fetch">${IC.refresh}<span>Get forecast</span></button>
    </div>`));
  } else if (dw) {
    const days = dw.days.map((d) => `<div class="wx-day${d.rainy ? ' wet' : ''}">
      <span class="wx-dow">${esc(d.dow)}</span>
      <span class="wx-ic ${d.icon}">${wIcon(d.icon)}</span>
      <span class="wx-hi">${d.tmax}°</span>
      <span class="wx-lo">${d.tmin}°</span>
    </div>`).join('');
    sec.appendChild(h(`<div class="wx-panel">
      <div class="wx-head">
        <span class="wx-place">${IC.pin}<span>${esc(dw.place || ev.destination)}</span></span>
        <button class="iconbtn sm" data-wx="fetch" aria-label="Refresh forecast">${IC.refresh}</button>
      </div>
      <div class="wx-strip">${days}</div>
    </div>`));

    const sug = weatherSuggestions(ev, lists);
    for (const i of sug.items) suggested.add(i.name);
    if (sug.items.length) {
      const names = sug.items.map((i) => i.name).join(', ');
      sec.appendChild(h(`<div class="wx-sugg">
        <span class="wx-sugg-ic">${wIcon('rain')}</span>
        <div class="wx-sugg-body">
          <div class="wx-sugg-t">${esc(sug.summary || 'Weather-driven add-ons')}</div>
          <div class="wx-sugg-s">Suggests ${sug.items.length}: ${esc(names)}</div>
          <div class="wx-sugg-actions"><button class="btn primary sm" data-wx="addall">${IC.plus}<span>Add all</span></button></div>
        </div>
      </div>`));
    }
  }

  // "Pack anyway" — weather gear not already offered by the forecast, addable on
  // its own terms (e.g. a rain shell as a backup layer on a dry forecast).
  const anyway = gear.filter((g) => !suggested.has(g.name));
  if (anyway.length) {
    const rows = anyway.map((g, i) => `<div class="wx-any-row">
      <div class="wx-any-info"><b>${esc(g.name)}</b><span>${esc([g.container, g.category].filter(Boolean).join(' · '))}</span></div>
      <button class="btn ghost sm" data-wx="any-add" data-idx="${i}">${IC.plus}<span>Add</span></button>
    </div>`).join('');
    const noForecast = !dw && !ev.destination;
    sec.appendChild(h(`<details class="wx-any">
      <summary><span class="wx-any-h">${wIcon('cloud')} Pack weather gear anyway</span><span class="wx-any-sum">${anyway.length} item${anyway.length === 1 ? '' : 's'} · regardless of forecast</span></summary>
      <div class="wx-any-body">
        ${rows}
        <div class="wx-any-actions">
          <button class="btn sm" data-wx="any-all">${IC.plus}<span>Add all ${anyway.length}</span></button>
          ${noForecast ? `<a class="wx-any-more" href="#/event/${ev.id}/edit">Add a destination for a live forecast</a>` : ''}
        </div>
      </div>
    </details>`));
  }

  sec.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-wx]')?.dataset.wx;
    if (!act) return;
    if (act === 'fetch') {
      if (!navigator.onLine) { alert('You’re offline — connect to get the forecast. Your saved forecast still shows.'); return; }
      const btn = e.target.closest('[data-wx]');
      btn.disabled = true; btn.classList.add('busy');
      try {
        ev.weather = await weather.getWeather(ev.destination, { startDate: ev.startDate, nights: ev.nights });
        await db.saveEvent(ev);
        render();
      } catch (err) {
        alert(err.message || 'Could not get the forecast.');
        btn.disabled = false; btn.classList.remove('busy');
      }
    } else if (act === 'addall') {
      for (const spec of weatherSuggestions(ev, lists).items) ev.entries.push(entryFromWeatherSpec(spec));
      if (await saveGuard(db.saveEvent(ev))) render();
    } else if (act === 'any-add') {
      const idx = Number(e.target.closest('[data-wx]').dataset.idx);
      if (anyway[idx]) ev.entries.push(entryFromWeatherSpec(anyway[idx]));
      if (await saveGuard(db.saveEvent(ev))) render();
    } else if (act === 'any-all') {
      for (const spec of anyway) ev.entries.push(entryFromWeatherSpec(spec));
      if (await saveGuard(db.saveEvent(ev))) render();
    }
  });
  return sec;
}

function renderTotalBody(body, ev) {
  body.innerHTML = '';
  if (!ev.entries.length) {
    body.appendChild(h(`<div class="empty">
      <p class="empty-t">This list is empty</p>
      <p class="empty-s">Add items with the “Item” button, or open settings to pick activities and generate a list.</p>
    </div>`));
    return;
  }
  // Narrow to the chosen person first (keeping the item being edited visible).
  const pool = personFilter ? ev.entries.filter((e) => e.id === expandedEntry || matchesPerson(e)) : ev.entries;
  if (!pool.length) {
    const who = personFilter === '__none__' ? 'unassigned items' : `items for ${esc(personFilter)}`;
    body.appendChild(h(`<div class="empty">
      <p class="empty-t">No ${who}</p>
      <p class="empty-s">Tap <b>Everyone</b> above to see the whole list again.</p>
    </div>`));
    return;
  }
  // Apply the "sort out" filter; always keep the item being edited visible so a
  // freshly-added row still shows even when a filter is on.
  const entries = flagFilter.size
    ? pool.filter((e) => e.id === expandedEntry
        || (flagFilter.has('liquid') && e.liquid)
        || (flagFilter.has('charge') && e.charging)
        || (flagFilter.has('restricted') && e.restricted))
    : pool;
  if (!entries.length) {
    const labelFor = { liquid: 'liquids', charge: 'charge items', restricted: 'restricted items' };
    const labels = [...flagFilter].map((k) => labelFor[k] || k).join(' or ');
    body.appendChild(h(`<div class="empty">
      <p class="empty-t">No ${esc(labels)} in this list</p>
      <p class="empty-s">Tap “Show all” above to see every item again.</p>
    </div>`));
    return;
  }
  if (weightSort) { renderHeaviest(body, ev, entries); return; }
  const mode = viewFor(ev);
  // Secondary sub-grouping: When→by container; Where/Category/Section→by phase.
  const subOf = mode === 'when'
    ? (entries) => groupByContainer(entries).map((g) => ({ label: g.container || 'Unpacked', entries: g.entries }))
    : (entries) => entriesByPhase(entries).map((g) => ({ label: g.phase.label, entries: g.entries }));

  const groups = (mode === 'ga' || mode === 'wet')
    ? groupByActivity(entries, mode === 'ga' ? 'GA' : 'WET')
    : groupBy(mode, entries);
  for (const g of groups) {
    const key = `${mode}|${g.label}`;
    const collapsed = collapsedGroups.has(key);
    const done = g.entries.filter((e) => e.checked).length;
    const sec = h(`<div class="group${collapsed ? ' collapsed' : ''}">
      <div class="group-h clickable" role="button" tabindex="0" aria-expanded="${collapsed ? 'false' : 'true'}">
        <span class="group-caret" aria-hidden="true">▾</span>
        ${groupIcon(g.label) ? `<span class="grp-ic" aria-hidden="true">${groupIcon(g.label)}</span>` : ''}
        <span class="ph">${esc(g.label)}</span>
        ${g.hint ? `<span class="ph-hint">${esc(g.hint)}</span>` : ''}
        <span class="group-count">${done}/${g.entries.length}</span>
      </div>
      <div class="group-body"></div>
    </div>`);
    const gb = $('.group-body', sec);
    const subs = subOf(g.entries);
    const showSub = subs.length > 1; // only show sub-headers when they actually split the group
    for (const s of subs) {
      if (showSub) gb.appendChild(h(`<div class="sub">${groupIcon(s.label) ? `<span class="grp-ic" aria-hidden="true">${groupIcon(s.label)}</span>` : ''}${esc(s.label)}</div>`));
      appendEntriesWithKits(gb, ev, s.entries, body);
    }
    const head = $('.group-h', sec);
    const toggle = () => {
      const nowC = !collapsedGroups.has(key);
      if (nowC) collapsedGroups.add(key); else collapsedGroups.delete(key);
      sec.classList.toggle('collapsed', nowC);
      head.setAttribute('aria-expanded', String(!nowC));
    };
    head.addEventListener('click', toggle);
    head.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    body.appendChild(sec);
  }
}

// The total contribution of an entry to the load: per-unit weight × how many are
// actually taken (per-night items scale with the trip length).
function entryGrams(entry, nights) { return (Number(entry.weight) || 0) * effectiveQty(entry, nights); }
function formatGrams(g) { return g >= 1000 ? `${Math.round(g / 100) / 10} kg` : `${Math.round(g)} g`; }

// "Heaviest first": a flat, weight-ranked list (ignores Group by) with each item's
// weight shown, so the heavy things to reconsider are right at the top. Unweighed
// items fall to the bottom under their own sub-header.
function renderHeaviest(body, ev, entries) {
  const g = (e) => entryGrams(e, qtyNights(ev));
  const weighed = entries.filter((e) => g(e) > 0).sort((a, b) => g(b) - g(a) || a.name.localeCompare(b.name));
  const unweighed = entries.filter((e) => g(e) <= 0).sort((a, b) => a.name.localeCompare(b.name));
  const totalG = weighed.reduce((s, e) => s + g(e), 0);
  const hint = weighed.length
    ? `${formatGrams(totalG)} across ${weighed.length} weighed item${weighed.length === 1 ? '' : 's'}`
    : 'No weights recorded here yet';
  const sec = h(`<div class="group"><div class="group-h"><span class="ph">Heaviest first</span><span class="ph-hint">${esc(hint)}</span></div></div>`);
  for (const entry of weighed) sec.appendChild(entryRow(ev, entry, body, true));
  if (unweighed.length) {
    sec.appendChild(h(`<div class="sub">No weight recorded (${unweighed.length}) — add a weight in an item’s editor to rank it</div>`));
    for (const entry of unweighed) sec.appendChild(entryRow(ev, entry, body, true));
  }
  body.appendChild(sec);
}

// A little tactile reward when something gets packed: a gentle haptic tap (where
// supported) plus a one-shot "pop" on the row. The animation is CSS and self-guards
// against reduced-motion; vibrate is a no-op on devices without it.
function packFeedback(rowEl) {
  try { if (navigator.vibrate) navigator.vibrate(12); } catch { /* ignore */ }
  if (!rowEl) return;
  rowEl.classList.remove('just-packed');
  void rowEl.offsetWidth;           // restart the animation if re-triggered
  rowEl.classList.add('just-packed');
  setTimeout(() => rowEl.classList.remove('just-packed'), 360);
}
// Update the readiness ring in place after a tick (no full re-render). Returns the
// fresh progress, and briefly celebrates the moment everything is packed.
function updateReadinessProgress(ev, wasComplete) {
  const p = progress(ev.entries);
  const ring = document.querySelector('.readiness .rd-ring');
  if (ring) {
    ring.style.setProperty('--pct', p.pct);
    const nowComplete = p.total > 0 && p.done >= p.total;
    ring.classList.toggle('done', nowComplete);
    const num = ring.querySelector('.rd-ring-num'); if (num) num.innerHTML = `${p.pct}<small>%</small>`;
    const cap = ring.querySelector('.rd-ring-cap'); if (cap) cap.textContent = `${p.done}/${p.total}`;
    if (nowComplete && !wasComplete) {
      ring.classList.remove('celebrate'); void ring.offsetWidth; ring.classList.add('celebrate');
      try { if (navigator.vibrate) navigator.vibrate([18, 40, 28]); } catch { /* ignore */ }
    }
  }
  // Keep the pack button's label honest as the count changes.
  const ctaSpan = document.querySelector('.readiness .pack-cta span');
  // innerHTML, not textContent: the "all packed" state carries a tick glyph.
  if (ctaSpan) ctaSpan.innerHTML = p.total > 0 && p.done >= p.total ? `All packed${ic('check', 'sm')}` : (p.done ? 'Continue packing' : 'Start packing');
  return p;
}

function entryRow(ev, entry, body, showWeight = false) {
  const isRem = entry.itemType === 'reminder';
  const mode = viewFor(ev);
  // Show the dimensions NOT used as the current grouping, so the row stays informative.
  const subBits = [];
  if (mode !== 'stored' && entry.storage) subBits.push(`${ic('pin','xs')}${esc(entry.storage)}`);
  if (mode !== 'section' && entry.section) subBits.push(`${ic('folder','xs')}${esc(entry.section)}`);
  if (mode !== 'container' && entry.container) subBits.push(esc(entry.container));
  if (mode !== 'category' && entry.category) subBits.push(esc(entry.category));
  if (mode !== 'when') subBits.push(esc(phaseLabel(entry.phase)));
  if (showWeight && entry.kit) subBits.push(`${kitEmoji(null)} ${esc(entry.kit)}`); // flat views have no kit header
  if (entry.packer) subBits.push(personChipHTML(entry.packer));
  if (entry.note) subBits.push(esc(entry.note));
  if (entry.custom) subBits.push('added');
  // 🇸🇪 THE SWEDISH/IMPORT ALIAS IS NOT DRAWN ANYWHERE (v126). It is DATA, not a
  // label: it arrived with the original imported lists, there has never been a
  // field to edit it, and beside the English name it read as noise — sometimes
  // literally the same words ("Tooth pickers" / "Tooth pickers"). It is still
  // stored on every item and is still a SEARCH KEY, so typing "Kroppslotion"
  // still finds Body lotion. Six places used to print it: here, packRow,
  // renderReview, renderSearch, renderOverview and the kit picker.
  const chShort = entry.charging ? chargeTypeShort(entry.chargeType) : '';
  const chTitle = entry.charging ? `Needs charging${chShort ? ` — ${chargeTypeLabel(entry.chargeType)}` : ''}` : '';
  const badges = `${entry.charging ? `<span class="badge charge" title="${esc(chTitle)}">${ic('bolt','xs')}${chShort ? esc(chShort) : ''}</span>` : ''}`
    + `${entry.liquid ? `<span class="badge liquid" title="Liquid / 100 ml rule">${ic('drop','xs')}</span>` : ''}`
    + `${entry.restricted ? `<span class="badge restricted" title="Restricted — think before packing (battery / carry-on rules)">${ic('warn','xs')}</span>` : ''}`
    + `${isRem ? '<span class="badge rem">reminder</span>' : ''}`;
  // Scaled quantity: per-night items show × trip nights (capped when laundry is on);
  // otherwise the explicit qty.
  const qn = qtyNights(ev);
  const eq = effectiveQty(entry, qn);
  const qtyTitle = ev.laundry && ev.nights > LAUNDRY_CAP_NIGHTS ? `capped to ${qn} with laundry (trip is ${ev.nights} nights)` : `scaled to ${ev.nights} nights`;
  const qtyLabel = isRem ? '' : (entry.perNight && ev.nights ? ` <em title="${esc(qtyTitle)}">×${eq}${ev.laundry && ev.nights > LAUNDRY_CAP_NIGHTS ? ic('laundry','xs') : ''}</em>` : (entry.qty ? ` <em>×${esc(entry.qty)}</em>` : ''));
  const subItems = (entry.sub && entry.sub.length) ? `<span class="e-subitems">${entry.sub.map(esc).join(' · ')}</span>` : '';
  // In "Heaviest first" view, show each item's weight (— when none recorded).
  const g = showWeight ? entryGrams(entry, qn) : 0;
  const weightPill = showWeight ? `<span class="e-weight${g > 0 ? '' : ' none'}">${g > 0 ? esc(formatGrams(g)) : '—'}</span>` : '';
  const row = h(`<div class="entry${entry.checked ? ' done' : ''}${isRem ? ' reminder' : ''}">
    <label class="ck"><input type="checkbox"${entry.checked ? ' checked' : ''}><span class="box"></span></label>
    <button class="entry-main" type="button">
      <span class="e-name">${isRem ? '' : `<span class="e-cat" style="background:${categoryColor(entry.category)}" title="${esc(entry.category || '')}"></span>`}${esc(entry.name)}${qtyLabel} ${badges}</span>
      <span class="e-sub">${subBits.join(' · ')}</span>
      ${subItems}
    </button>
    ${weightPill}
    <button class="iconbtn sm" type="button" data-edit aria-label="Edit">${IC.edit}</button>
  </div>`);

  row.querySelector('input').addEventListener('change', async (e) => {
    const wasComplete = (() => { const p = progress(ev.entries); return p.total > 0 && p.done >= p.total; })();
    entry.checked = e.target.checked;
    row.classList.toggle('done', entry.checked);
    if (entry.checked) packFeedback(row);        // a small reward for packing something
    // Refresh the readiness ring in place (no full re-render).
    await saveGuard(db.saveEvent(ev));
    updateReadinessProgress(ev, wasComplete);
  });

  const openEditor = () => {
    if (expandedEntry === entry.id) { expandedEntry = null; renderTotalBody(body, ev); return; }
    expandedEntry = entry.id; renderTotalBody(body, ev);
  };
  row.querySelector('.entry-main').addEventListener('click', openEditor);
  row.querySelector('[data-edit]').addEventListener('click', openEditor);

  if (expandedEntry === entry.id) {
    const ed = entryEditor(ev, entry, body);
    const holder = h('<div class="entry-wrap"></div>');
    holder.appendChild(row); holder.appendChild(ed);
    return holder;
  }
  return row;
}

// Render a list of entries into `gb`, clustering kit-mates under a kit
// header with a one-tap "pack the whole kit" toggle. Loose (kit-less) entries
// render as normal rows in place. A kit's own emoji is used when the kit still
// exists; otherwise the default bundle glyph.
function appendEntriesWithKits(gb, ev, entries, body) {
  for (const cl of clusterByKit(entries)) {
    if (!cl.kit) { gb.appendChild(entryRow(ev, cl.entries[0], body)); continue; }
    const kitDef = (ALL_KITS || []).find((k) => k.name === cl.kit);
    const emoji = kitDef ? kitEmoji(kitDef) : KIT_DEFAULT_EMOJI;
    const done = cl.entries.filter((e) => e.checked).length;
    const allPacked = cl.entries.length > 0 && done >= cl.entries.length;
    const box = h(`<div class="kit-cluster${allPacked ? ' done' : ''}">
      <div class="kit-cluster-h">
        <span class="kit-cluster-ic" aria-hidden="true">${esc(emoji)}</span>
        <span class="kit-cluster-name">${esc(cl.kit)}</span>
        <span class="kit-cluster-count">${done}/${cl.entries.length}</span>
        <button type="button" class="kit-packall">${allPacked ? 'Unpack' : 'Pack all'}</button>
      </div>
      <div class="kit-cluster-body"></div>
    </div>`);
    const cbody = box.querySelector('.kit-cluster-body');
    for (const entry of cl.entries) cbody.appendChild(entryRow(ev, entry, body));
    box.querySelector('.kit-packall').addEventListener('click', async () => {
      const wasComplete = (() => { const p = progress(ev.entries); return p.total > 0 && p.done >= p.total; })();
      const target = !allPacked;
      for (const e of cl.entries) e.checked = target;
      if (await saveGuard(db.saveEvent(ev))) {
        renderTotalBody(body, ev);
        updateReadinessProgress(ev, wasComplete);
      }
    });
    gb.appendChild(box);
  }
}

// From a trip entry, find the template item it was built from — or, failing that,
// one linked by name (the app links items across templates by name). Lets the
// event's limited editor hand off to the full item editor for the deeper settings
// (conditions, template membership, storage & maintenance) it can't show itself.
function sourceItemForEntry(entry, lists = ALL_LISTS) {
  if (entry.sourceListId && entry.sourceItemId) {
    const l = lists.find((x) => x.id === entry.sourceListId);
    if (l && l.items.some((z) => z.id === entry.sourceItemId)) return { listId: l.id, itemId: entry.sourceItemId };
  }
  const key = (entry.name || '').trim().toLowerCase();
  if (key) {
    for (const l of lists) {
      const it = l.items.find((z) => (z.name || '').trim().toLowerCase() === key);
      if (it) return { listId: l.id, itemId: it.id };
    }
  }
  return null;
}

// A trip-only item has no template record to edit. Let the user pick a template
// to add it to (so it becomes reusable), create it there, link the entry to it,
// and resolve with { listId, itemId } — or null if they cancel.
function promoteEntryToTemplate(entry, lists) {
  return new Promise((resolve) => {
    // Loose items first (for "I don't know its template yet"), then real templates.
    const loose = lists.filter((l) => l.role === 'loose');
    const templates = lists.filter((l) => l.role !== 'loose' && l.role !== CONTAINER_ROLE);
    const opts = [...loose.map((l) => `<option value="${esc(l.id)}">${esc(l.name)} — no template yet</option>`),
      ...templates.map((l) => `<option value="${esc(l.id)}">${esc(l.name)}</option>`)].join('');
    const body = h(`<div class="modal">
      <h2>Save “${esc(entry.name || 'this item')}” to edit it fully</h2>
      <p class="modal-sub">This item is only in this trip. Save it to a template — or to <b>Loose items</b> if you’re not sure where it belongs yet — to edit its full settings (conditions, storage &amp; care) and reuse it later.</p>
      <label class="field"><span>Save to</span><select name="promote-list">${opts}</select></label>
      <div class="modal-actions">
        <button class="btn primary lg" data-p="add">${IC.wrench}<span>Save &amp; edit</span></button>
        <button class="btn ghost lg" data-p="cancel">Cancel</button>
      </div>
    </div>`);
    const overlay = h('<div class="overlay"></div>');
    overlay.appendChild(body);
    document.body.appendChild(overlay);
    let settled = false;
    const finish = (val) => { if (settled) return; settled = true; overlay.remove(); document.removeEventListener('keydown', onKey); resolve(val); };
    const onKey = (e) => { if (e.key === 'Escape') finish(null); };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(null); });
    body.addEventListener('click', async (e) => {
      const p = e.target.closest('[data-p]')?.dataset.p;
      if (!p) return;
      if (p === 'cancel') { finish(null); return; }
      if (p === 'add') {
        const list = lists.find((l) => l.id === $('select[name=promote-list]', body).value);
        if (!list) { finish(null); return; }
        const it = itemFromEntry(entry);   // a genuinely new item — carries everything, photos included
        list.items.unshift(it);
        if (!await saveGuard(db.saveList(list))) { finish(null); return; }
        entry.sourceListId = list.id; entry.sourceItemId = it.id; // link so it now resolves directly
        finish({ listId: list.id, itemId: it.id });
      }
    });
  });
}

// A small coloured "who packs it" chip (a dot in the person's colour + name).
function personChipHTML(name) {
  if (!name) return '';
  return `<span class="e-person"><span class="person-dot" style="background:${esc(peopleColor(name))}"></span>${esc(name)}</span>`;
}

// A "Packed by" <select>: — Anyone — plus the People roster. An assigned name not
// on the roster (e.g. from an imported trip) is kept as its own option so it stays.
function packerSelectHtml(current) {
  const people = loadPeople();
  const opts = [{ value: '', label: '— Anyone —' }, ...people.map((p) => ({ value: p.name, label: p.name }))];
  if (current && !people.some((p) => normName(p.name) === normName(current))) opts.push({ value: current, label: `${current} (not on your People list)` });
  return selectHtml('packer', opts, current || '');
}

// The quick, trip-level editor for one packed thing. `hooks` lets a second screen
// (Packing Mode) reuse it: the packing list's own close / re-render / navigate
// behaviour is the default, and Packing Mode supplies its own so Save drops you
// back exactly where you were instead of rebuilding the whole trip screen.
function entryEditor(ev, entry, body, hooks = null) {
  const H = hooks || {
    close: () => { expandedEntry = null; renderTotalBody(body, ev); },
    done: () => { expandedEntry = null; render(); },
    leave: (href) => { expandedEntry = null; location.assign(href); },
  };
  const ed = h('<div class="editor"></div>');
  const src = sourceItemForEntry(entry); // the template item behind this entry, if any
  // Existing section names on this trip, offered as suggestions so an item can be
  // moved into another section here (the choice sticks through Regenerate).
  const tripSecNames = [...new Set((ev.entries || []).map((e) => (e.section || '').trim()).filter(Boolean))];
  ed.innerHTML = `
    <label class="field"><span>Item</span><input name="name" value="${esc(entry.name)}"></label>
    <div class="row2">
      <label class="field"><span>Qty</span><input name="qty" value="${esc(entry.qty)}" placeholder="e.g. 2"></label>
      <label class="field"><span>Category</span>${selectHtml('category', CATEGORIES, entry.category)}</label>
    </div>
    <div class="row2">
      <label class="field"><span>Container</span>${selectHtml('container', containerOpts(entry.container), entry.container)}</label>
      <label class="field"><span>When</span>${selectHtml('phase', phaseOpts(entry.phase), entry.phase)}</label>
    </div>
    <label class="field"><span>Section <em>groups this item on the list</em></span><input name="section" value="${esc(entry.section)}" list="entry-sections" placeholder="optional" autocomplete="off"><datalist id="entry-sections">${tripSecNames.map((n) => `<option value="${esc(n)}"></option>`).join('')}</datalist></label>
    <label class="field"><span>Kit <em>pack this together as a unit</em></span><input name="kit" value="${esc(entry.kit)}" list="entry-kits" placeholder="optional — e.g. Charging kit" autocomplete="off"><datalist id="entry-kits">${[...new Set([...(ALL_KITS || []).map((k) => k.name), ...(ev.entries || []).map((e) => (e.kit || '').trim())].filter(Boolean))].map((n) => `<option value="${esc(n)}"></option>`).join('')}</datalist></label>
    <label class="field"><span>Packed by <em>who's responsible on this trip</em></span>${packerSelectHtml(entry.packer)}</label>
    <div class="row2">
      <label class="field"><span>Weight (g)</span><input type="number" name="weight" min="0" inputmode="numeric" value="${entry.weight || ''}" placeholder="0"></label>
      <div class="checks">
        <label class="check${entry.perNight ? ' on' : ''}"><input type="checkbox" name="perNight" ${entry.perNight ? 'checked' : ''}>Per night</label>
        <label class="check${entry.liquid ? ' on' : ''}"><input type="checkbox" name="liquid" ${entry.liquid ? 'checked' : ''}>${ic('drop','sm')}</label>
        <label class="check${entry.charging ? ' on' : ''}"><input type="checkbox" name="charging" ${entry.charging ? 'checked' : ''}>${ic('bolt','sm')}</label>
        <label class="check${entry.restricted ? ' on' : ''}"><input type="checkbox" name="restricted" ${entry.restricted ? 'checked' : ''}>${ic('warn','sm')}</label>
      </div>
    </div>
    <label class="field charge-type-field${entry.charging ? '' : ' hidden'}"><span>Charge type</span>${selectHtml('chargeType', CHARGE_TYPES.map((c) => ({ value: c.id, label: c.label })), entry.chargeType)}</label>
    <label class="field"><span>Stored at <em>(where to grab it)</em></span><input name="storage" value="${esc(entry.storage)}" placeholder="e.g. Garage shelf 3" autocomplete="off"></label>
    <label class="field"><span>Note</span><input name="note" value="${esc(entry.note)}"></label>
    <button type="button" class="btn ghost jump-full" data-x="full">${IC.wrench}<span>${src ? 'Edit the full item — conditions, templates &amp; care' : 'Save this item to edit it fully'}</span>${IC.fwd}</button>
    <div class="editor-actions">
      <button type="button" class="btn danger ghost" data-x="del">${IC.trash}<span>Remove</span></button>
      <div class="spacer"></div>
      <button type="button" class="btn" data-x="cancel">Cancel</button>
      <button type="button" class="btn primary" data-x="save">Save</button>
    </div>`;
  ed.addEventListener('change', (e) => {
    if (e.target.type === 'checkbox') e.target.closest('label')?.classList.toggle('on', e.target.checked);
    if (e.target.name === 'charging') $('.charge-type-field', ed)?.classList.toggle('hidden', !e.target.checked);
  });
  // Read the form into the entry — shared by Save and the "Edit the full item" jump,
  // so edits made here aren't lost on the way over.
  const applyForm = () => {
    entry.name = ($('input[name=name]', ed).value || '').trim() || entry.name;
    entry.qty = ($('input[name=qty]', ed).value || '').trim();
    entry.category = $('select[name=category]', ed).value;
    entry.container = $('select[name=container]', ed).value;
    entry.section = ($('input[name=section]', ed).value || '').trim();
    entry.kit = ($('input[name=kit]', ed).value || '').trim();
    entry.packer = ($('select[name=packer]', ed)?.value || '').trim();
    entry.phase = $('select[name=phase]', ed).value;
    entry.weight = Math.max(0, parseInt($('input[name=weight]', ed).value, 10) || 0);
    entry.perNight = $('input[name=perNight]', ed).checked;
    entry.liquid = $('input[name=liquid]', ed).checked;
    entry.charging = $('input[name=charging]', ed).checked;
    entry.chargeType = $('select[name=chargeType]', ed).value;
    entry.restricted = $('input[name=restricted]', ed).checked;
    entry.storage = ($('input[name=storage]', ed).value || '').trim();
    entry.note = ($('input[name=note]', ed).value || '').trim();
    entry._edited = true;
  };
  ed.addEventListener('click', async (e) => {
    const x = e.target.closest('[data-x]')?.dataset.x;
    if (!x) return;
    if (x === 'cancel') { H.close(); return; }
    if (x === 'del') {
      if (!confirm(`Remove “${entry.name}” from this list?`)) return;
      ev.entries = ev.entries.filter((it) => it.id !== entry.id);
      if (await saveGuard(db.saveEvent(ev))) H.done();
      return;
    }
    if (x === 'full') {
      applyForm(); // keep any edits made in this quick view
      const lists = await db.getLists(); // fresh, in case a source item moved or was renamed
      let target = sourceItemForEntry(entry, lists);
      if (!target) {
        // A trip-only item — add it to a template the user picks, then edit it there.
        target = await promoteEntryToTemplate(entry, lists);
        if (!target) return; // cancelled — leave the quick editor open
      }
      if (await saveGuard(db.saveEvent(ev))) H.leave(`#/list/${target.listId}/item/${target.itemId}`);
      return;
    }
    if (x === 'save') {
      applyForm();
      if (await saveGuard(db.saveEvent(ev))) H.done();
    }
  });
  return ed;
}

async function addEntry(ev, body) {
  const entry = newItem({ name: '', container: 'Carry-on / hand luggage', phase: 'week', custom: true, checked: false, sourceListId: null, sourceItemId: null });
  ev.entries.unshift(entry);
  expandedEntry = entry.id;
  renderTotalBody(body, ev);
  // focus the new editor's name field
  const inp = $('.editor input[name=name]', body); if (inp) inp.focus();
}

function exportEventXlsx(ev) {
  const rows = totalListRows(ev, null);
  const columns = [
    { header: 'Phase', width: 22 }, { header: 'Container', width: 20 }, { header: 'Item', width: 30 },
    { header: 'Qty', width: 8 }, { header: 'Packed', width: 10 }, { header: 'Note', width: 30 },
  ];
  const data = rows.map((r) => [r.Phase, r.Container, r.Item, r.Qty, r.Packed, r.Note]);
  const wb = buildWorkbook([{ name: 'Packing List', columns, rows: data }]);
  downloadBlob(new Blob([wb], { type: XLSX_MIME }), `${safeName(ev.name)}-packing-list.xlsx`);
}

// ---------- Share a trip (manual, backend-free) ----------
// Offer the receiver-friendly options this device actually supports: the native
// share sheet (iOS/Android), a copyable deep link, and a downloadable file.
function shareTrip(ev) {
  const json = JSON.stringify(buildTripBundle(ev), null, 2);
  const filename = `${safeName(ev.name)}-trip.json`;
  const link = encodeTripLink(ev);
  const fullLink = link ? location.origin + location.pathname + location.search + link : null;
  const file = new File([json], filename, { type: 'application/json' });
  const canShareFile = !!(navigator.canShare && navigator.canShare({ files: [file] }));

  const body = h(`<div class="modal">
    <h2>Share “${esc(ev.name)}”</h2>
    <p class="modal-sub">Send this whole trip — its full packing list travels inside. The other person imports it; nothing is uploaded anywhere.</p>
    <div class="modal-actions">
      ${canShareFile ? `<button class="btn primary lg" data-s="sheet">${IC.share}<span>Share…</span></button>` : ''}
      <button class="btn ghost lg" data-s="link"${fullLink ? '' : ' disabled'}>${IC.link}<span>${fullLink ? 'Copy link' : 'Link too large — use a file'}</span></button>
      <button class="btn ghost lg" data-s="file">${IC.sheet}<span>Save file</span></button>
    </div>
    <p class="modal-status" role="status"></p>
    <button class="btn ghost" data-s="close">Close</button>
  </div>`);
  const status = $('.modal-status', body);
  const say = (msg) => { status.textContent = msg; };

  body.addEventListener('click', async (e) => {
    const s = e.target.closest('[data-s]')?.dataset.s;
    if (!s) return;
    if (s === 'close') { close(); return; }
    if (s === 'file') { downloadBlob(new Blob([json], { type: 'application/json' }), filename); say('Saved. Send the file to whoever needs the trip.'); return; }
    if (s === 'link') {
      if (!fullLink) return;
      try { await navigator.clipboard.writeText(fullLink); say('Link copied. Paste it into a message — opening it imports the trip.'); }
      catch { say('Could not copy automatically — here is the link:'); showLinkFallback(body, fullLink); }
      return;
    }
    if (s === 'sheet') {
      try { await navigator.share({ files: [file], title: ev.name, text: `Packing list for ${ev.name}` }); close(); }
      catch (err) { if (err && err.name !== 'AbortError') say('Sharing was cancelled or unavailable — try a file or link.'); }
    }
  });

  const close = openModal(body);
}

function showLinkFallback(body, url) {
  if ($('.modal-link', body)) { $('.modal-link', body).value = url; return; }
  const ta = h(`<textarea class="modal-link" readonly rows="3"></textarea>`);
  ta.value = url;
  body.insertBefore(ta, $('.modal-status', body).nextSibling);
  ta.focus(); ta.select();
}

// A lightweight centred modal over a dimmed backdrop. Returns a close() fn;
// also closes on backdrop click and Escape.
function openModal(node) {
  const overlay = h('<div class="overlay"></div>');
  overlay.appendChild(node);
  document.body.appendChild(overlay);
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  return close;
}

// ---------- Template cover editor (emoji + colour) ----------
// Give a template a face on the Templates grid: pick an emoji and a colour.
// Both are optional — "Auto" clears the colour back to the stable hashed pick,
// and a blank emoji falls back to the default glyph. Saves the list and resolves
// true if anything changed, so the caller can re-render.
function openCoverEditor(list) {
  return new Promise((resolve) => {
    // Draft copy so Cancel/Esc leaves the real template untouched.
    let draftEmoji = typeof list.emoji === 'string' ? list.emoji : '';
    let draftColor = typeof list.color === 'string' ? list.color : '';  // '' = Auto (hashed)
    const swatches = TEMPLATE_COLORS
      .map((c) => `<button type="button" class="cover-swatch" data-swatch="${esc(c)}" style="background:${esc(c)}" aria-label="${esc(c)}"></button>`)
      .join('');
    const modal = h(`<div class="modal cover-editor">
      <h3>Cover for “${esc(list.name)}”</h3>
      <p class="modal-sub">Give this template an emoji and a colour so it stands out on the Templates grid. Leave the colour on <b>Auto</b> to let the app pick a consistent one for you.</p>
      <div class="cover-preview">
        <span class="cover-tile" data-tile><span class="cover-tile-emoji" data-tile-emoji></span></span>
        <span class="cover-tile-name">${esc(list.name)}</span>
      </div>
      <label class="cover-emoji-f"><span>Emoji</span>
        <input name="emoji" type="text" maxlength="4" placeholder="${TEMPLATE_DEFAULT_EMOJI}" value="${esc(draftEmoji)}" autocomplete="off">
      </label>
      <div class="cover-colors">
        <span class="cover-colors-lbl">Colour</span>
        <div class="cover-swatches">
          <button type="button" class="cover-swatch cover-auto${draftColor ? '' : ' on'}" data-swatch="" title="Auto (a consistent colour picked for you)">Auto</button>
          ${swatches}
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn" data-x="cancel">Cancel</button>
        <button type="button" class="btn primary" data-x="save">Save cover</button>
      </div>
    </div>`);

    const close = openModal(modal);
    const emojiIn = modal.querySelector('input[name=emoji]');
    const tile = modal.querySelector('[data-tile]');
    const tileEmoji = modal.querySelector('[data-tile-emoji]');

    const drawPreview = () => {
      const previewList = { ...list, emoji: draftEmoji, color: draftColor };
      tile.style.background = listColor(previewList);
      tileEmoji.textContent = listEmoji(previewList);
      modal.querySelectorAll('[data-swatch]').forEach((b) => {
        b.classList.toggle('on', (b.dataset.swatch || '') === draftColor);
      });
    };
    drawPreview();

    emojiIn.addEventListener('input', () => { draftEmoji = emojiIn.value; drawPreview(); });
    modal.querySelector('.cover-swatches').addEventListener('click', (e) => {
      const b = e.target.closest('[data-swatch]'); if (!b) return;
      draftColor = b.dataset.swatch || '';
      drawPreview();
    });
    modal.querySelector('[data-x="cancel"]').addEventListener('click', () => { close(); resolve(false); });
    modal.querySelector('[data-x="save"]').addEventListener('click', async () => {
      const nextEmoji = draftEmoji.trim().slice(0, 4);
      const changed = nextEmoji !== (list.emoji || '') || draftColor !== (list.color || '');
      if (changed) {
        list.emoji = nextEmoji;
        list.color = draftColor;
        if (!(await saveGuard(db.saveList(list)))) { resolve(false); return; }
      }
      close();
      resolve(changed);
    });
  });
}

// ---------- Kit editor (create / edit a reusable bundle) ----------
// Opens a modal to name a kit, give it an emoji, and pick its member items from
// the catalog (search-driven, since there are ~380 items). Saves to the `kits`
// store and calls onSaved(kit). Cancel / Esc / backdrop just closes.
async function openKitEditor(existing, onSaved) {
  const catalog = await db.getCatalogItems();
  const catById = new Map(catalog.map((i) => [i.id, i]));
  const kit = existing ? coerceKit({ ...existing, itemIds: existing.itemIds.slice() }) : newKit();
  // Ordered set of chosen catalog-item ids (only ones that still exist).
  const chosen = kit.itemIds.filter((iid) => catById.has(iid));

  const modal = h(`<div class="modal kit-editor">
    <h3>${existing ? 'Edit kit' : 'New kit'}</h3>
    <p class="modal-sub">A bundle of small things you always pack together — a charging kit, a wash bag, a first-aid pouch. Add it to a template or a trip and every item comes in at once, grouped so you can pack the whole kit in one go.</p>
    <div class="kit-meta">
      <label class="kit-emoji-f"><span>Icon</span><input name="emoji" type="text" maxlength="2" placeholder="${KIT_DEFAULT_EMOJI}" value="${esc(kit.emoji)}"></label>
      <label class="kit-name-f"><span>Name</span><input name="name" type="text" placeholder="e.g. Charging kit" value="${esc(kit.name)}"></label>
    </div>
    <label class="kit-note-f"><span>Note (optional)</span><input name="note" type="text" placeholder="anything worth remembering" value="${esc(kit.note)}"></label>
    <div class="kit-members">
      <div class="kit-chosen" data-chosen></div>
      <input class="kit-search" type="search" placeholder="Search items to add…" aria-label="Search items to add to the kit">
      <div class="kit-results" data-results></div>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn" data-x="cancel">Cancel</button>
      <button type="button" class="btn primary" data-x="save">${existing ? 'Save kit' : 'Create kit'}</button>
    </div>
  </div>`);

  const close = openModal(modal);
  const chosenBox = modal.querySelector('[data-chosen]');
  const resultsBox = modal.querySelector('[data-results]');
  const search = modal.querySelector('.kit-search');

  // Name only — the alias stays a search key below, but is not shown. See entryRow.
  const itemLabel = (it) => esc(it.name);
  const drawChosen = () => {
    chosenBox.innerHTML = chosen.length
      ? chosen.map((iid) => {
        const it = catById.get(iid);
        return `<button type="button" class="kit-chip" data-remove="${esc(iid)}" title="Remove">${itemLabel(it)} <span class="kit-chip-x" aria-hidden="true">×</span></button>`;
      }).join('')
      : '<p class="muted kit-empty">No items yet — search below and tap to add them.</p>';
  };
  const drawResults = () => {
    const q = normName(search.value);
    if (!q) { resultsBox.innerHTML = '<p class="muted kit-hint">Type to find items to add.</p>'; return; }
    const hits = catalog
      .filter((it) => normName(it.name).includes(q) || normName(it.swedish).includes(q))
      .slice(0, 40);
    resultsBox.innerHTML = hits.length
      ? hits.map((it) => {
        const on = chosen.includes(it.id);
        return `<button type="button" class="kit-hit${on ? ' on' : ''}" data-add="${esc(it.id)}">
          <span class="kit-hit-tick" aria-hidden="true">${on ? '✓' : '+'}</span>${itemLabel(it)}</button>`;
      }).join('')
      : '<p class="muted kit-hint">No items match — an item must exist in the catalog before it can join a kit.</p>';
  };
  drawChosen(); drawResults();

  search.addEventListener('input', drawResults);
  resultsBox.addEventListener('click', (e) => {
    const b = e.target.closest('[data-add]'); if (!b) return;
    const iid = b.dataset.add;
    const i = chosen.indexOf(iid);
    if (i >= 0) chosen.splice(i, 1); else chosen.push(iid);
    drawChosen(); drawResults();
  });
  chosenBox.addEventListener('click', (e) => {
    const b = e.target.closest('[data-remove]'); if (!b) return;
    const i = chosen.indexOf(b.dataset.remove);
    if (i >= 0) chosen.splice(i, 1);
    drawChosen(); drawResults();
  });

  modal.querySelector('[data-x="cancel"]').addEventListener('click', close);
  modal.querySelector('[data-x="save"]').addEventListener('click', async () => {
    const name = modal.querySelector('input[name=name]').value.trim();
    if (!name) { alert('Give the kit a name first.'); return; }
    if (!chosen.length && !confirm('This kit has no items yet. Save it anyway?')) return;
    kit.name = name;
    kit.emoji = modal.querySelector('input[name=emoji]').value.trim();
    kit.note = modal.querySelector('input[name=note]').value.trim();
    kit.itemIds = chosen.slice();
    await db.saveKit(kit);
    await refreshKits();
    close();
    if (onSaved) onSaved(kit);
  });
  setTimeout(() => modal.querySelector('input[name=name]').focus(), 30);
}

// Let the user pick one of their kits (to add to a template or a trip). Resolves to
// a kit or null. Points them at Settings → Kits when they have none yet.
function pickKit(title = 'Add a kit') {
  return new Promise((resolve) => {
    const kits = (ALL_KITS || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    if (!kits.length) {
      alert('You don’t have any kits yet.\n\nBuild one first in Settings → Kits — a bundle of items you always pack together — then add it here as one unit.');
      resolve(null); return;
    }
    const modal = h(`<div class="modal kit-pick">
      <h3>${esc(title)}</h3>
      <p class="modal-sub">Adds every item in the kit at once, grouped under the kit so you can pack it as one.</p>
      <div class="kit-pick-list">
        ${kits.map((k) => `<button type="button" class="kit-pick-row" data-kit="${esc(k.id)}">
          <span class="kit-row-ic" aria-hidden="true">${esc(kitEmoji(k))}</span>
          <span class="kit-row-info"><b class="kit-row-name">${esc(k.name)}</b><span class="kit-row-sub">${k.itemIds.length} item${k.itemIds.length === 1 ? '' : 's'}${k.note ? ` · ${esc(k.note)}` : ''}</span></span>
        </button>`).join('')}
      </div>
      <div class="modal-actions"><button type="button" class="btn" data-x="cancel">Cancel</button></div>
    </div>`);
    const close = openModal(modal);
    let picked = null;
    modal.addEventListener('click', (e) => {
      const row = e.target.closest('[data-kit]');
      const cancel = e.target.closest('[data-x="cancel"]');
      if (row) { picked = kits.find((k) => k.id === row.dataset.kit) || null; close(); resolve(picked); }
      else if (cancel) { close(); resolve(null); }
    });
  });
}

// Resolve a kit's members to fresh catalog items (dropping any that were deleted),
// in the kit's own order. Shared by the template + trip add paths.
async function kitCatalogItems(kit) {
  const catalog = await db.getCatalogItems();
  const byId = new Map(catalog.map((i) => [i.id, i]));
  return kit.itemIds.map((iid) => byId.get(iid)).filter(Boolean);
}

// Add a whole kit into a template: every member item joins the template (or, if
// already there, is tagged with the kit) so it packs as a unit. Returns how many
// were newly added.
async function addKitToTemplate(list, kit) {
  const members = await kitCatalogItems(kit);
  let added = 0;
  for (const cat of members) {
    const existing = (list.items || []).find((it) => (it._itemId && it._itemId === cat.id) || normName(it.name) === normName(cat.name));
    if (existing) { existing.kit = kit.name; }
    else {
      const copy = linkFromResolved(cat, cat.id);   // a link, never a copy — nothing of the item's can be lost
      copy.kit = kit.name;
      list.items.unshift(copy);
      added++;
    }
  }
  await db.saveList(list);
  return { added, total: members.length };
}

// Add a whole kit onto a specific trip: each member becomes a trip entry tagged
// with the kit (or an existing matching entry is tagged), so it clusters on the
// packing list. Returns how many were newly added.
function addKitToTrip(ev, kit, members) {
  let added = 0;
  for (const cat of members) {
    const existing = ev.entries.find((e) => normName(e.name) === normName(cat.name) && e.container === cat.container);
    if (existing) { existing.kit = kit.name; existing._edited = true; }
    else {
      const entry = newItem({
        name: cat.name, swedish: cat.swedish || '', qty: cat.qty || '',
        category: cat.category, container: cat.container, phase: cat.phase, itemType: cat.itemType,
        charging: cat.charging, chargeType: cat.chargeType, shortList: cat.shortList,
        weight: cat.weight || 0, liquid: cat.liquid, restricted: cat.restricted, perNight: cat.perNight,
        storage: cat.storage || '', sub: (cat.sub || []).slice(), note: cat.note || '',
        kit: kit.name, custom: true, checked: false,
        sourceListId: null, sourceItemId: cat.id,
      });
      ev.entries.unshift(entry);
      added++;
    }
  }
  return { added, total: members.length };
}

// ============================================================
// Packing Mode — a focused, one-phase-at-a-time flow to pack from.
// ============================================================
let packState = { eventId: null, idx: 0, showPacked: false, editId: null };

async function renderPackMode(eventId) {
  const ev = await db.getEvent(eventId);
  if (!ev || !ev.entries.length) { location.assign(`#/event/${eventId}`); return h('<section></section>'); }
  ALL_LISTS = await db.getLists(); // the quick editor needs bag names + the item behind an entry
  if (packState.eventId !== eventId) {
    // Open at the first phase that still has unpacked items.
    const steps = packSteps(ev.entries);
    const firstUnpacked = steps.findIndex((s) => s.remaining > 0);
    packState = { eventId, idx: firstUnpacked < 0 ? 0 : firstUnpacked, showPacked: false, editId: null };
    personFilter = ''; // start Packing Mode showing everyone
  }

  const wrap = h('<section class="screen pack"></section>');
  const body = h('<div></div>');
  wrap.appendChild(body);

  function draw() {
    const pool = ev.entries.filter(matchesPerson);  // who-packs-what filter (empty = everyone)
    const steps = packSteps(pool);                   // one per non-empty timeline phase
    const overall = progress(pool);
    body.innerHTML = '';

    // Header (close back to the list)
    body.appendChild(h(`<div class="topbar">
      <a class="iconbtn" href="#/event/${ev.id}" aria-label="Close packing mode">${IC.close}</a>
      <h1 class="grow">${esc(ev.name)}</h1>
    </div>`));

    // Who-packs-what selector — only when this trip has anyone assigned.
    const tripPeople = assignedPeople(ev.entries);
    if (tripPeople.length) {
      const unassigned = ev.entries.filter((e) => !(e.packer || '').trim()).length;
      const pchip = (key, label, dot) => `<button class="pchip${personFilter === key ? ' on' : ''}" data-person-filter="${esc(key)}">${dot ? `<span class="person-dot" style="background:${esc(dot)}"></span>` : ''}${esc(label)}</button>`;
      const bar = h(`<div class="filterbar personbar pack-personbar">
        ${pchip('', 'Everyone', '')}
        ${tripPeople.map((n) => pchip(n, n, peopleColor(n))).join('')}
        ${unassigned ? pchip('__none__', 'Unassigned', '') : ''}
      </div>`);
      bar.addEventListener('click', (e) => {
        const key = e.target.closest('[data-person-filter]')?.dataset.personFilter;
        if (key == null) return;
        personFilter = personFilter === key ? '' : key;
        packState.idx = 0;
        draw();
      });
      body.appendChild(bar);
    }

    if (overall.total === 0) { body.appendChild(h('<p class="muted pad">Nothing assigned to this person on the trip.</p>')); return; }
    if (overall.done >= overall.total) { body.appendChild(finishScreen(ev, overall)); return; }

    // Overall progress
    body.appendChild(h(`<div class="pack-overall"><div class="bar big"><span style="width:${overall.pct}%"></span></div><div class="ev-prog">${overall.done}/${overall.total} packed · ${overall.pct}%</div></div>`));

    // Clamp the phase index and grab the current step
    packState.idx = Math.max(0, Math.min(packState.idx, steps.length - 1));
    const step = steps[packState.idx];

    // The phase's own colour rides on the stepper, so each step of the pack is
    // recognisable before you've read the words.
    const stepper = h(`<div class="pack-stepper" style="--phase:${esc(step.phase.color || 'var(--brand)')}">
      <button class="iconbtn" data-nav="prev" ${packState.idx === 0 ? 'disabled' : ''} aria-label="Previous phase">${IC.back}</button>
      <div class="pack-phase">
        <div class="pack-phase-t">${step.phase.emoji ? `<span class="grp-ic" aria-hidden="true">${esc(step.phase.emoji)}</span> ` : ''}${esc(step.phase.label)}</div>
        <div class="pack-phase-n">Phase ${packState.idx + 1} of ${steps.length} · ${step.remaining} of ${step.total} left</div>
      </div>
      <button class="iconbtn" data-nav="next" ${packState.idx >= steps.length - 1 ? 'disabled' : ''} aria-label="Next phase">${IC.fwd}</button>
    </div>`);
    body.appendChild(stepper);
    if (step.phase.hint) body.appendChild(h(`<p class="pack-hint">${esc(step.phase.hint)}</p>`));

    // Items in this phase, grouped by container; hide packed unless toggled.
    const listEl = h('<div class="pack-list"></div>');
    let shown = 0;
    for (const cg of groupByContainer(step.entries)) {
      // A row you're editing stays put even once you tick it, so the editor can't
      // vanish out from under you.
      const items = cg.entries.filter((e) => packState.showPacked || !e.checked || packState.editId === e.id);
      if (!items.length) continue;
      if (cg.container) listEl.appendChild(h(`<div class="sub">${groupIcon(cg.container) ? `<span class="grp-ic" aria-hidden="true">${groupIcon(cg.container)}</span>` : ''}${esc(cg.container)}</div>`));
      for (const entry of items) { listEl.appendChild(packRow(ev, entry, draw)); shown++; }
    }
    if (step.remaining === 0) listEl.appendChild(h(`<div class="pack-phase-done">${IC.check}<span>${esc(step.phase.label)} — all packed</span></div>`));
    else if (!shown) listEl.appendChild(h('<p class="muted pad">Nothing left to show here.</p>'));
    body.appendChild(listEl);

    // Footer: show-packed toggle + advance
    const last = packState.idx >= steps.length - 1;
    const footer = h(`<div class="pack-footer">
      <label class="check${packState.showPacked ? ' on' : ''}"><input type="checkbox" data-showpacked ${packState.showPacked ? 'checked' : ''}>Show packed</label>
      <div class="spacer"></div>
      ${last ? `<a class="btn primary" href="#/event/${ev.id}">Done</a>` : `<button class="btn primary" data-nav="next">Next phase ${IC.fwd}</button>`}
    </div>`);
    body.appendChild(footer);

    $$('[data-nav]', body).forEach((b) => b.addEventListener('click', () => {
      if (b.disabled) return;
      packState.idx += (b.dataset.nav === 'next' ? 1 : -1);
      draw();
    }));
    const sp = $('[data-showpacked]', body);
    if (sp) sp.addEventListener('change', (e) => { packState.showPacked = e.target.checked; draw(); });
  }

  draw();
  return wrap;
}

// One thing to pack. The whole slab still toggles packed — that's the point of
// Packing Mode — so editing gets its own small pen beside it, opening the same
// quick editor the packing list uses, right here in place.
function packRow(ev, entry, redraw) {
  const meta = [entry.storage ? entry.storage : '', entry.container, entry.note].filter(Boolean).map(esc).join(' · ');
  const editing = packState.editId === entry.id;
  const row = h(`<div class="pack-row${editing ? ' editing' : ''}">
    <button class="pack-item${entry.checked ? ' done' : ''}" type="button">
      <span class="pack-box">${entry.checked ? IC.check : ''}</span>
      <span class="pack-body">
        <span class="pack-name">${esc(entry.name)}${entry.qty ? ` <em>×${esc(entry.qty)}</em>` : ''}${entry.charging ? ` <span class="badge charge" title="${esc('Needs charging' + (chargeTypeShort(entry.chargeType) ? ` — ${chargeTypeLabel(entry.chargeType)}` : ''))}">${ic('bolt','xs')}${chargeTypeShort(entry.chargeType) ? `${esc(chargeTypeShort(entry.chargeType))}` : ''}</span>` : ''}</span>
        ${meta ? `<span class="pack-meta">${meta}</span>` : ''}
      </span>
    </button>
    <button class="iconbtn pack-edit" type="button" data-edit aria-label="Edit ${esc(entry.name)}" title="Edit this item">${IC.edit}</button>
  </div>`);
  row.querySelector('.pack-item').addEventListener('click', async () => {
    entry.checked = !entry.checked;
    if (entry.checked) { try { if (navigator.vibrate) navigator.vibrate(12); } catch { /* ignore */ } }
    await saveGuard(db.saveEvent(ev));
    redraw();
  });
  row.querySelector('[data-edit]').addEventListener('click', () => {
    packState.editId = editing ? null : entry.id;
    redraw();
  });

  if (!editing) return row;
  // The quick editor, with Packing Mode's own close / save / hand-off behaviour so
  // it never rebuilds the trip screen underneath — and so the deeper "full item"
  // editor knows to bring you back here when you're done.
  const ed = entryEditor(ev, entry, null, {
    close: () => { packState.editId = null; redraw(); },
    done: () => { packState.editId = null; redraw(); },
    leave: (href) => { packState.editId = null; itemEditorReturn = `#/event/${ev.id}/pack`; location.assign(href); },
  });
  const holder = h('<div class="pack-editwrap"></div>');
  holder.appendChild(row); holder.appendChild(ed);
  return holder;
}

function finishScreen(ev, overall) {
  return h(`<div class="pack-finish empty">
    <p class="pack-finish-emoji">${ic('check')}</p>
    <p class="empty-t">All packed!</p>
    <p class="empty-s">${overall.total} item${overall.total === 1 ? '' : 's'} packed for ${esc(ev.name)}. Have a great trip.</p>
    <a class="btn primary lg" href="#/event/${ev.id}">Back to the list</a>
  </div>`);
}

// ============================================================
// Post-trip review — "did you use it?" — feeds the learn/prune engine.
// ============================================================
async function renderReview(eventId) {
  const ev = await db.getEvent(eventId);
  if (!ev || !ev.entries.length) { location.assign(`#/event/${eventId}`); return h('<section></section>'); }
  // Review physical gear only (skip reminders/tasks).
  const items = ev.entries.filter((e) => e.itemType !== 'reminder');
  // Default everything to "used"; the user just flips the few they didn't use.
  const used = new Map(items.map((e) => [e.id, e.used !== false]));

  const wrap = h('<section class="screen"></section>');
  wrap.appendChild(h(backBar('Trip review', `#/event/${ev.id}`)));
  wrap.appendChild(h(`<p class="muted pad">Tap anything you <b>didn’t use</b> on this trip. Everything is marked used by default — over a few trips the app learns what to trim.</p>`));

  const body = h('<div class="rev-list"></div>');
  const counter = h('<div class="rev-counter"></div>');
  wrap.appendChild(counter);
  wrap.appendChild(body);

  const updateCounter = () => {
    const notUsed = [...used.values()].filter((v) => !v).length;
    counter.textContent = notUsed ? `${notUsed} marked “didn’t use”` : 'All marked used — flip the ones you didn’t need';
  };
  for (const cg of groupByCategory(items)) {
    body.appendChild(h(`<div class="sub">${esc(cg.category)}</div>`));
    for (const e of cg.entries) {
      const row = h(`<button class="rev-item${used.get(e.id) ? '' : ' unused'}" type="button" data-id="${e.id}">
        <span class="rev-name">${esc(e.name)}</span>
        <span class="rev-tag">${used.get(e.id) ? 'Used' : 'Didn’t use'}</span>
      </button>`);
      row.addEventListener('click', () => {
        const v = !used.get(e.id); used.set(e.id, v);
        row.classList.toggle('unused', !v);
        row.querySelector('.rev-tag').textContent = v ? 'Used' : 'Didn’t use';
        updateCounter();
      });
      body.appendChild(row);
    }
  }
  updateCounter();

  const save = h(`<div class="pack-footer"><div class="spacer"></div><button class="btn primary lg" data-save>Save review</button></div>`);
  wrap.appendChild(save);
  save.querySelector('[data-save]').addEventListener('click', async () => {
    for (const e of items) e.used = !!used.get(e.id);
    const lists = await db.getLists();
    const changed = applyReview(ev, lists);
    for (const l of changed) await saveGuard(db.saveList(l));
    ev.status = 'done';
    ev.reviewedAt = new Date().toISOString();
    if (await saveGuard(db.saveEvent(ev))) location.assign('#/refine');
  });
  return wrap;
}

// ============================================================
// Refine — prune items you keep packing but never use.
// ============================================================
async function renderRefine() {
  const lists = await db.getLists();
  const suggestions = pruneSuggestions(lists, { minTrips: 1 });
  const wrap = h('<section class="screen"></section>');
  wrap.appendChild(h(backBar('Refine lists', '#/lists')));

  if (!suggestions.length) {
    wrap.appendChild(h(`<div class="empty">
      <p class="empty-t">Nothing to trim yet</p>
      <p class="empty-s">After a trip review, items you packed but never used show up here so you can drop them from a list.</p>
    </div>`));
    return wrap;
  }
  wrap.appendChild(h(`<p class="muted pad">You packed these but haven’t used them. Drop them from the list, or keep them.</p>`));
  const body = h('<div class="items"></div>');
  wrap.appendChild(body);

  const draw = () => {
    const cur = pruneSuggestions(lists, { minTrips: 1 });
    body.innerHTML = '';
    if (!cur.length) { body.appendChild(h('<div class="empty"><p class="empty-s">All done — nothing left to review.</p></div>')); return; }
    for (const s of cur) {
      const row = h(`<div class="entry">
        <span class="entry-main">
          <span class="e-name">${esc(s.item.name)}</span>
          <span class="e-sub">${esc(s.listName)} · packed ${s.stats.packed}× · used 0×</span>
        </span>
        <button class="btn ghost" data-keep>Keep</button>
        <button class="btn danger ghost" data-drop>${IC.trash}<span>Drop</span></button>
      </div>`);
      row.querySelector('[data-drop]').addEventListener('click', async () => {
        const list = lists.find((l) => l.id === s.listId);
        if (!list) return;
        list.items = list.items.filter((it) => it.id !== s.item.id);
        if (await saveGuard(db.saveList(list))) draw();
      });
      row.querySelector('[data-keep]').addEventListener('click', async () => {
        const list = lists.find((l) => l.id === s.listId);
        const it = list && list.items.find((x) => x.id === s.item.id);
        if (it) { it.keep = true; if (await saveGuard(db.saveList(list))) draw(); }
      });
      body.appendChild(row);
    }
  };
  draw();
  return wrap;
}

// ============================================================
// Building-block lists
// ============================================================
async function renderLists() {
  const lists = await db.getLists();
  const wrap = h('<section class="screen"></section>');
  wrap.appendChild(h(`<div class="topbar"><h1 class="grow">Templates</h1><a class="iconbtn" href="#/search" aria-label="Search">${IC.search}</a><a class="btn ghost" href="#/refine">Refine</a><button class="btn primary" data-new>${IC.plus}<span>New</span></button></div>`));
  wrap.appendChild(h(`<p class="muted pad">These are your reusable building blocks. An <b>Event</b> combines the ones you pick into a single <b>Packing List</b> to pack from.</p>`));

  // A visual cover card: a coloured tile with the template's emoji, its name and
  // an item count. Colour + emoji come from the template's cover (with sensible
  // hashed/default fallbacks), so the grid reads at a glance and by colour.
  const card = (l) => h(`<a class="tmpl-card" href="#/list/${l.id}" style="--cover:${esc(listColor(l))}">
      <span class="tmpl-cover"><span class="tmpl-emoji">${esc(listEmoji(l))}</span></span>
      <span class="tmpl-body">
        <span class="tmpl-name">${esc(l.name)}</span>
        <span class="tmpl-count">${l.items.length ? `${l.items.length} item${l.items.length === 1 ? '' : 's'}` : 'empty'}</span>
      </span>
    </a>`);

  // "Loose items" — the home for things not in any template yet. Always shown,
  // as its own card, kept out of the normal template groups.
  const loose = await getLooseList();
  const looseCount = loose.items.length;
  const looseCard = h(`<a class="card lst loose-card" href="#/list/${loose.id}">
      <span class="lst-name">${IC.wrench}<span>${esc(LOOSE_NAME)}</span></span>
      <span class="lst-count">${looseCount === 0 ? 'empty — add anything, file it later' : `${looseCount} item${looseCount === 1 ? '' : 's'} with no template yet`}</span>
    </a>`);
  wrap.appendChild(looseCard);

  const byGroup = new Map(GROUP_IDS.map((g) => [g, []]));
  const ungrouped = [];
  for (const l of lists) {
    if (l.role === 'loose') continue; // shown above as its own card
    if (l.role === CONTAINER_ROLE) continue; // the Containers catalogue has its own tab
    (byGroup.has(l.group) ? byGroup.get(l.group) : ungrouped).push(l);
  }
  for (const g of GROUPS) {
    const arr = byGroup.get(g.id);
    if (!arr.length) continue;
    wrap.appendChild(h(`<h2 class="section-h">${esc(g.id)} · ${esc(g.label)}</h2>`));
    const cards = h('<div class="tmpl-grid"></div>');
    // Same deliberate order as the event picker — a group should read the same way
    // wherever you meet it, or the two screens teach you different habits.
    orderActivities(g.id, arr).forEach((l) => cards.appendChild(card(l)));
    wrap.appendChild(cards);
  }
  if (ungrouped.length) {
    wrap.appendChild(h('<h2 class="section-h">Other templates</h2>'));
    const cards = h('<div class="tmpl-grid"></div>');
    ungrouped.forEach((l) => cards.appendChild(card(l)));
    wrap.appendChild(cards);
  }

  wrap.querySelector('[data-new]').addEventListener('click', async () => {
    const name = (prompt('Name for the new template:') || '').trim();
    if (!name) return;
    const l = newList({ name });
    if (await saveGuard(db.saveList(l))) location.assign(`#/list/${l.id}`);
  });
  return wrap;
}

async function renderList(listId, openItemId) {
  const list = await db.getList(listId);
  if (!list) { location.assign('#/lists'); return h('<section></section>'); }
  ALL_LISTS = await db.getLists();
  STORAGES = collectStorages(ALL_LISTS); // for the storage-location dropdown
  const isLoose = list.role === 'loose';
  const isContainer = list.role === CONTAINER_ROLE;
  // The Containers catalogue has its own tab, so it drops the template chrome
  // (group / sections / rename / delete-template) and points Back at that tab.
  const noTemplateChrome = isLoose || isContainer;
  const wrap = h('<section class="screen"></section>');
  wrap.appendChild(h(`<div class="topbar">
    <a class="iconbtn" href="${isContainer ? '#/maintenance' : '#/lists'}" aria-label="Back">${IC.back}</a>
    <h1 class="grow">${esc(list.name)}</h1>
    ${noTemplateChrome ? '' : `<button class="iconbtn" data-rename aria-label="Rename">${IC.edit}</button>
    <button class="iconbtn" data-del aria-label="Delete template">${IC.trash}</button>`}
  </div>`));
  if (isLoose) {
    wrap.appendChild(h(`<p class="muted pad">A holding place for things not in any template yet — add anything here, even if you don’t know where or when you’ll pack it. Open an item and tick a template under <b>In these templates</b> to file it; once it’s in a template it leaves this list.</p>`));
  } else if (isContainer) {
    wrap.appendChild(h(`<p class="muted pad">Your bags, duffels and backpacks as things in their own right — add photos, colour, brand, capacity, where each one lives and how to look after it. A container’s maintenance shows up on the <b>Care</b> tab, and every container here is offered when you pick where an item is packed.</p>`));
  }
  const groupOpts = [{ value: '', label: '— no group —' }, ...GROUPS.map((g) => ({ value: g.id, label: `${g.id} · ${g.label}` }))];
  wrap.appendChild(h(`<div class="toolbar">
    ${noTemplateChrome ? '' : `<label class="inline-field"><span>Group</span>${selectHtml('group', groupOpts, list.group)}</label>`}
    ${noTemplateChrome ? '' : `<label class="inline-field" title="One bag for everything in this template. Items can still differ one by one."><span>Default bag</span>${selectHtml('tpldefault', [{ value: '', label: '— each item decides —' }].concat(containerOpts(list.defaultContainer).map((c) => ({ value: c, label: c }))), list.defaultContainer)}</label>`}
    <div class="spacer"></div>
    ${noTemplateChrome ? '' : `<button class="btn ghost" data-cover><span class="cover-dot" style="background:${esc(listColor(list))}">${esc(listEmoji(list))}</span><span>Cover</span></button>`}
    ${noTemplateChrome ? '' : `<button class="btn ghost" data-sections>${IC.list}<span>Sections${list.sections.length ? ` (${list.sections.length})` : ''}</span></button>`}
    ${isLoose ? `<button class="btn ghost" data-batch>${IC.list}<span>Add several</span></button>` : ''}
    ${noTemplateChrome ? '' : `<button class="btn ghost" data-kit>${ic('toolbox')}<span>Add a kit</span></button>`}
    <button class="btn ghost" data-add>${IC.plus}<span>${isContainer ? 'Add container' : 'Add item'}</span></button>
  </div>`));

  const itemFilter = new Set();               // active category chips for this template's list
  const filterBar = h('<div class="item-filterbar"></div>');
  wrap.appendChild(filterBar);
  filterBar.addEventListener('click', (e) => {
    const key = e.target.closest('[data-cat]')?.dataset.cat;
    if (!key) return;
    if (key === '__clear') itemFilter.clear();
    else if (itemFilter.has(key)) itemFilter.delete(key); else itemFilter.add(key);
    draw();
  });

  const body = h('<div class="items"></div>');
  wrap.appendChild(body);

  if (!noTemplateChrome) wrap.querySelector('select[name=group]').addEventListener('change', async (e) => {
    list.group = e.target.value;
    await saveGuard(db.saveList(list));
  });
  // When arriving from the Care page's "All items" browser, open that item's
  // editor straight away (and expand its care panel).
  let openItem = (openItemId && list.items.some((x) => x.id === openItemId)) ? openItemId : null;
  if (openItem) careForceOpenItemId = openItem;
  const emptyMsg = isLoose
    ? 'Nothing loose right now. Use <b>Add several</b> to dump in a batch of new things, or <b>Add item</b> for one — you can sort out where they belong later.'
    : 'No items yet — add the things this template should contribute.';
  const draw = () => {
    // Chips reflect the current items (add/batch/delete keep the counts live);
    // the "No template" chip is dropped in the Loose bin where every item is loose.
    filterBar.innerHTML = itemFilterChipsHTML(list.items, itemFilter, isLoose);
    body.innerHTML = '';
    if (!list.items.length) { body.appendChild(h(`<div class="empty"><p class="empty-s">${emptyMsg}</p></div>`)); return; }
    const shown = list.items.filter((it) => itemMatchesFilter(it, itemFilter));
    if (!shown.length) { body.appendChild(h('<div class="empty"><p class="empty-s">No items match these filters.</p></div>')); return; }
    const rowFor = (it) => listItemRow(list, it, () => openItem, (v) => { openItem = v; }, draw);
    if (isLoose || !list.sections.length) {
      for (const it of shown) body.appendChild(rowFor(it));
    } else {
      // Grouped view: the template's sections in their chosen order, unsectioned last.
      for (const g of groupItemsBySection(shown, list.sections)) {
        const label = g.section ? g.section.name : 'Ungrouped';
        body.appendChild(h(`<div class="sec-h${g.section ? '' : ' loose'}"><span class="sec-name">${esc(label)}</span><span class="sec-count">${g.items.length}</span></div>`));
        for (const it of g.items) body.appendChild(rowFor(it));
      }
    }
  };
  draw();
  if (openItem) requestAnimationFrame(() => $('.item-editor', body)?.scrollIntoView({ block: 'center' }));

  wrap.querySelector('[data-add]').addEventListener('click', () => {
    const it = newItem({ name: '' });
    list.items.unshift(it); openItem = it.id; draw();
    const inp = $('.item-editor input[name=name]', body); if (inp) inp.focus();
  });
  wrap.querySelector('[data-kit]')?.addEventListener('click', async () => {
    const kit = await pickKit(`Add a kit to ${list.name}`);
    if (!kit) return;
    const members = await kitCatalogItems(kit);
    if (!members.length) { alert(`“${kit.name}” has no items yet. Add some in Settings → Kits.`); return; }
    const { added, total } = await addKitToTemplate(list, kit);
    showToast(added ? `Added ${kitEmoji(kit)} ${kit.name} — ${added} item${added === 1 ? '' : 's'}${added < total ? ` (${total - added} already here)` : ''}` : `All of ${kit.name} was already in this template — grouped it into the kit`);
    render();
  });
  wrap.querySelector('[data-batch]')?.addEventListener('click', () => {
    const added = batchAddItems(list);
    added.then((n) => { if (n > 0) { openItem = null; draw(); } });
  });
  wrap.querySelector('[data-cover]')?.addEventListener('click', async () => {
    const changed = await openCoverEditor(list);
    if (changed) render();
  });
  // One bag for the whole template. Items that already carry that exact bag as a
  // per-item exception are now saying the same thing twice, so offer to tidy them
  // away — otherwise the "differs here on purpose" mark would be meaningless.
  wrap.querySelector('select[name=tpldefault]')?.addEventListener('change', async (e) => {
    const want = e.target.value;
    list.defaultContainer = want;
    const redundant = want ? (list.items || []).filter((z) => z._ovContainer === want) : [];
    if (redundant.length && confirm(`“${list.name}” now packs everything into ${want}.\n\n${redundant.length} item${redundant.length === 1 ? '' : 's'} here already had ${want} set individually. Clear those so they simply follow the template?\n\nNothing moves either way — this only tidies up.`)) {
      for (const z of redundant) z._ovContainer = '';
    }
    if (await saveGuard(db.saveList(list))) { ALL_LISTS = await db.getLists(); render(); }
  });
  wrap.querySelector('[data-sections]')?.addEventListener('click', () => {
    manageSections(list).then((changed) => {
      if (!changed) return;
      // Refresh the "Sections (n)" button label and the grouped body.
      const btn = wrap.querySelector('[data-sections] span');
      if (btn) btn.textContent = `Sections${list.sections.length ? ` (${list.sections.length})` : ''}`;
      draw();
    });
  });
  wrap.querySelector('[data-rename]')?.addEventListener('click', async () => {
    const name = (prompt('Rename template:', list.name) || '').trim();
    if (!name) return; list.name = name;
    if (await saveGuard(db.saveList(list))) render();
  });
  wrap.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!confirm(`Delete the “${list.name}” template? This does not change events already generated.`)) return;
    if (await saveGuard(db.deleteList(list.id))) location.assign('#/lists');
  });
  return wrap;
}

// One-per-line batch add for the Loose items bin: paste or type a list, each
// non-blank line becomes a new item. Resolves with how many were added.
function batchAddItems(list) {
  return new Promise((resolve) => {
    const body = h(`<div class="modal">
      <h2>Add several items</h2>
      <p class="modal-sub">One item per line. Each becomes a new loose item — you can set where and when to pack it later, or file it into a template.</p>
      <textarea class="batch-ta" rows="8" placeholder="Sun hat&#10;Travel adapter&#10;Spare charging cable&#10;Ear plugs" autofocus></textarea>
      <div class="modal-actions">
        <button class="btn primary lg" data-b="add">${IC.plus}<span>Add items</span></button>
        <button class="btn ghost lg" data-b="cancel">Cancel</button>
      </div>
    </div>`);
    const overlay = h('<div class="overlay"></div>');
    overlay.appendChild(body);
    document.body.appendChild(overlay);
    let settled = false;
    const finish = (n) => { if (settled) return; settled = true; overlay.remove(); document.removeEventListener('keydown', onKey); resolve(n); };
    const onKey = (e) => { if (e.key === 'Escape') finish(0); };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(0); });
    setTimeout(() => $('.batch-ta', body)?.focus(), 30);
    body.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-b]')?.dataset.b;
      if (!b) return;
      if (b === 'cancel') { finish(0); return; }
      if (b === 'add') {
        const names = ($('.batch-ta', body).value || '').split('\n').map((s) => s.trim()).filter(Boolean);
        if (!names.length) { finish(0); return; }
        for (const name of names.reverse()) list.items.unshift(newItem({ name }));
        if (!await saveGuard(db.saveList(list))) { finish(0); return; }
        finish(names.length);
      }
    });
  });
}

// Manage a template's sections: add, rename, reorder and delete. Resolves true if
// anything was saved (so the caller can redraw). Deleting a section keeps its items
// — they simply fall back to "Ungrouped".
function manageSections(list) {
  return new Promise((resolve) => {
    let secs = (list.sections || []).map((s) => ({ ...s })); // working copy
    const overlay = h('<div class="overlay"></div>');
    const body = h('<div class="modal sections-modal"></div>');
    overlay.appendChild(body);
    document.body.appendChild(overlay);
    let settled = false;
    const finish = (changed) => { if (settled) return; settled = true; overlay.remove(); document.removeEventListener('keydown', onKey); resolve(changed); };
    const onKey = (e) => { if (e.key === 'Escape') finish(false); };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(false); });

    // Pull the current text-field values back into `secs` before any reorder/delete
    // re-render, so in-progress renames aren't lost.
    const syncFromDOM = () => {
      $$('.sec-row', body).forEach((row, i) => { if (secs[i]) secs[i].name = ($('input', row).value || '').trim(); });
    };
    const draw = () => {
      const rows = secs.map((s, i) => `<div class="sec-row" data-i="${i}">
        <input value="${esc(s.name)}" placeholder="Section name" aria-label="Section name">
        <button class="iconbtn sm" data-m="up" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${ic('up','sm')}</button>
        <button class="iconbtn sm" data-m="down" ${i === secs.length - 1 ? 'disabled' : ''} aria-label="Move down">${ic('down','sm')}</button>
        <button class="iconbtn sm" data-m="del" aria-label="Delete section">${IC.trash}</button>
      </div>`).join('');
      body.innerHTML = `<h2>Sections — ${esc(list.name)}</h2>
        <p class="modal-sub">Group this template's items (e.g. Lights, Rig, Regulators). Each item picks its section in its editor. Deleting a section keeps its items — they move to “Ungrouped”. Sections are specific to this template.</p>
        <div class="sec-rows">${rows || '<p class="muted">No sections yet — add the first one below.</p>'}</div>
        <div class="sec-add"><input class="sec-new" placeholder="New section name" aria-label="New section name"><button class="btn" data-m="add">${IC.plus}<span>Add</span></button></div>
        <div class="modal-actions">
          <button class="btn primary lg" data-m="save">Save sections</button>
          <button class="btn ghost lg" data-m="cancel">Cancel</button>
        </div>`;
    };
    draw();

    body.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.classList.contains('sec-new')) { e.preventDefault(); body.querySelector('[data-m=add]').click(); }
    });
    body.addEventListener('click', async (e) => {
      const m = e.target.closest('[data-m]')?.dataset.m;
      if (!m) return;
      if (m === 'cancel') { finish(false); return; }
      if (m === 'add') {
        syncFromDOM();
        const inp = $('.sec-new', body);
        const name = (inp.value || '').trim();
        if (name) secs.push(newSection(name));
        draw();
        $('.sec-new', body)?.focus();
        return;
      }
      const row = e.target.closest('.sec-row');
      if (row) {
        const i = Number(row.dataset.i);
        syncFromDOM();
        if (m === 'up' && i > 0) { [secs[i - 1], secs[i]] = [secs[i], secs[i - 1]]; draw(); return; }
        if (m === 'down' && i < secs.length - 1) { [secs[i + 1], secs[i]] = [secs[i], secs[i + 1]]; draw(); return; }
        if (m === 'del') { secs.splice(i, 1); draw(); return; }
      }
      if (m === 'save') {
        syncFromDOM();
        const kept = secs.filter((s) => s.name); // drop blank-named rows
        const validIds = new Set(kept.map((s) => s.id));
        // Items whose section was deleted fall back to Ungrouped.
        for (const it of list.items) if (it.section && !validIds.has(it.section)) it.section = '';
        list.sections = kept;
        if (await saveGuard(db.saveList(list))) finish(true); else finish(false);
      }
    });
    setTimeout(() => $('.sec-row input, .sec-new', body)?.focus(), 30);
  });
}

// ---- Actions (to-dos) shared helpers ----
// The "when" choices: any time, or one of the trip phases.
// A FUNCTION, not a constant: phases are editable, so a list snapshotted when this
// module loaded would pin the factory seven forever (the same trap the editable
// conditions hit — see the `order: () => …` note on the Care groupings).
const actionWhenOpts = () => [{ value: '', label: 'Any time' }, ...phaseOpts()];
function actionWhenSelectHtml(dataAttr, val) {
  const opts = actionWhenOpts();
  // A phase this device doesn't know (added on the other one, or since removed) is
  // added to the picker rather than silently reset to "Any time".
  if (val && !opts.some((o) => o.value === val)) opts.push({ value: val, label: phaseLabel(val) });
  return `<select ${dataAttr}>${opts.map((o) => `<option value="${esc(o.value)}"${o.value === (val || '') ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
}
// A short human phrase for an action's timing, for chips.
function actionWhenLabel(a) {
  if (a.whenDate) return prettyDate(a.whenDate);
  if (a.whenPhase) return phaseLabel(a.whenPhase);
  return '';
}
// The small chips shown after an action's text (priority + timing).
function actionChipsHtml(a) {
  const when = actionWhenLabel(a);
  return `${a.priority === 'high' ? '<span class="act-chip high">High</span>' : ''}${when ? `<span class="act-chip when">${IC.cal}${esc(when)}</span>` : ''}`;
}

function listItemRow(list, it, getOpen, setOpen, draw) {
  const tags = [it.ownedBy ? `${it.ownedBy}` : '', it.storage ? `${it.storage}` : '', it.container, ...(it.seasons || []), ...(it.contexts || []), ...(it.transports || [])].filter(Boolean);
  const chShort = it.charging ? chargeTypeShort(it.chargeType) : '';
  const care = maintenanceStatus(it);
  const badges = `${isUnfiled(it.name) ? `<span class="badge unfiled" title="Not in any template yet — still a loose item">${ic('warn','xs')}No template</span>` : ''}`
    + `${it.charging ? `<span class="badge charge" title="${esc('Needs charging' + (chShort ? ` — ${chargeTypeLabel(it.chargeType)}` : ''))}">${ic('bolt','xs')}${chShort ? esc(chShort) : ''}</span>` : ''}`
    + `${it.liquid ? `<span class="badge liquid" title="Liquid / 100 ml rule">${ic('drop','xs')}</span>` : ''}`
    + `${it.restricted ? `<span class="badge restricted" title="Restricted — think before packing (battery / carry-on rules)">${ic('warn','xs')}</span>` : ''}`
    + `${it.consumable ? `<span class="badge consumable" title="Consumable — offered for restocking on the shopping list">${ic('cart','xs')}</span>` : ''}`
    + `${(it.photos || []).length ? `<span class="badge photo" title="${esc((it.photos.length === 1 ? 'Has a photo' : `${it.photos.length} photos`))}">${ic('camera','xs')}${it.photos.length > 1 ? ` ${it.photos.length}` : ''}</span>` : ''}`
    + `${care ? `<span class="badge maint ${care.state}" title="${esc(`Maintenance: ${dueLabel(care)}`)}">${careIcon(care.state)}</span>` : ''}`
    + `${openActionsForItem(it._itemId) ? `<span class="badge act" title="${esc(`${openActionsForItem(it._itemId)} open to-do${openActionsForItem(it._itemId) === 1 ? '' : 's'}`)}">${ic('checkbox','xs')}${openActionsForItem(it._itemId)}</span>` : ''}`
    + `${it.retired ? `<span class="badge retired" title="${esc('Not in use' + (it.retiredReason ? ` — ${retireReasonLabel(it.retiredReason)}` : '') + ' — kept on record, never added to a trip')}">${ic('ban','xs')}Not in use</span>` : ''}`
    + conditionBadgeHTML(it);
  const thumb = it.thumb ? `<img class="row-thumb" src="${esc(it.thumb)}" alt="">` : '';
  const row = h(`<div class="entry${it.retired ? ' retired' : ''}">
    ${thumb}
    <button class="entry-main" type="button">
      <span class="e-name">${esc(it.name || '(unnamed)')}${it.qty ? ` <em>×${esc(it.qty)}</em>` : ''} ${badges}</span>
      <span class="e-sub">${esc(phaseLabel(it.phase))}${tags.length ? ' · ' + tags.map(esc).join(' · ') : ''}</span>
    </button>
    <button class="iconbtn sm" type="button" data-edit aria-label="Edit">${IC.edit}</button>
  </div>`);
  const toggle = () => { setOpen(getOpen() === it.id ? null : it.id); draw(); };
  row.querySelector('.entry-main').addEventListener('click', toggle);
  row.querySelector('[data-edit]').addEventListener('click', toggle);

  if (getOpen() === it.id) {
    const ed = itemEditor(list, it, setOpen, draw);
    const holder = h('<div class="entry-wrap"></div>');
    holder.appendChild(row); holder.appendChild(ed);
    return holder;
  }
  return row;
}

// The per-template Section picker for the item editor (layer 2): the template's
// sections, plus "— No section —" and "＋ New section…" which reveals a name field.
function sectionFieldHTML(list, it) {
  const opts = [{ value: '', label: '— No section —' }]
    .concat((list.sections || []).map((s) => ({ value: s.id, label: s.name })))
    .concat([{ value: '__new__', label: '＋ New section…' }]);
  const cur = (list.sections || []).some((s) => s.id === it.section) ? it.section : '';
  return `<label class="field"><span>Section <em>groups this item in the list</em></span>${selectHtml('section', opts, cur)}</label>
    <label class="field section-new-field hidden"><span>New section name</span><input name="section-new" value="" placeholder="e.g. Regulators" autocomplete="off"></label>`;
}

// Read the Section picker on Save. A chosen "＋ New section…" with a typed name is
// created on the template (reusing a same-named section if one already exists), and
// the item is pointed at its id. Returns the section id ('' = none). When the picker
// isn't shown (the Loose bin) the item's existing section is left untouched.
function readSectionFromEditor(ed, list, it) {
  const sel = $('select[name=section]', ed);
  if (!sel) return it.section || '';
  if (sel.value !== '__new__') return sel.value;
  const name = ($('input[name=section-new]', ed)?.value || '').trim();
  if (!name) return '';
  let existing = (list.sections || []).find((s) => s.name.toLowerCase() === name.toLowerCase());
  if (!existing) { existing = newSection(name); list.sections = [...(list.sections || []), existing]; }
  return existing.id;
}

function itemEditor(list, it, setOpen, draw) {
  const ed = h('<div class="editor item-editor"></div>');
  // A container (bag/duffel/backpack) is edited as an object in its own right: it
  // keeps the name / photos / capacity / storage / care / details fields, but drops
  // the packing-only ones (where it's packed, when, flags, conditions, sections,
  // template membership) that only make sense for things you put INTO a bag.
  const isContainer = list.role === CONTAINER_ROLE;
  STORAGES = collectStorages(ALL_LISTS); // freshest saved + in-use places for the dropdown
  // Care state that can't be read straight back from the DOM on save:
  //  - the photos are held here and only committed to the item on Save (so Cancel discards them),
  //  - the maintenance history log is edited via "Log done" and committed on Save.
  // Each entry is { id, data }: `id` is the photos-store key ('' for one just
  // added in this editor), `data` the full image. Existing photos start blank and
  // are loaded in the background — the editor is built synchronously, so it draws
  // once immediately and again when the images arrive.
  let photos = (it.photos || []).map((ref) => (isPhotoRef(ref) ? { id: ref, data: '' } : { id: '', data: ref }));
  const m = it.maintenance || { notes: '', link: '', intervalDays: 0, lastDone: '', log: [] };
  let careLog = (m.log || []).slice();
  // Actions (to-dos) tied to this item, buffered here and committed on Save (so
  // Cancel discards edits, like photos & the care log). Seeded from the cache by
  // the item's stable catalog id; a brand-new item starts empty and its actions
  // are written once the item earns its id on Save.
  let actions = ALL_ACTIONS.filter((a) => it._itemId && a.itemId === it._itemId).map((a) => ({ ...a }));
  const actionsOpen = actions.length > 0;
  const curInterval = m.intervalDays || 0;
  const intervalIsPreset = MAINTENANCE_INTERVALS.some((p) => p.days === curInterval);
  const intervalSel = intervalIsPreset ? String(curInterval) : (curInterval ? 'custom' : '0');
  const intervalOpts = [...MAINTENANCE_INTERVALS.map((p) => ({ value: String(p.days), label: p.label })), { value: 'custom', label: 'Custom…' }];
  const careOpen = hasCare(it) || !!it.storage || photos.length > 0 || careForceOpenItemId === it.id;
  if (careForceOpenItemId === it.id) careForceOpenItemId = null;

  // A tick-box matrix of every template: ticked = this item is in that template.
  // Membership is by the item's stable catalog id (_itemId), not its name. Tick to
  // add it there, untick to remove — applied on Save. The item's own template is
  // always ticked and locked (remove it with the Remove button). The list is built
  // from ALL_LISTS, so it grows on its own as templates are added. A brand-new item
  // has no id yet, so it starts in no other template.
  const curItemId = it._itemId;
  const memberIds = new Set(
    curItemId ? ALL_LISTS.filter((l) => (l.items || []).some((z) => z._itemId === curItemId)).map((l) => l.id) : [],
  );
  const inListsHTML = (() => {
    // Real templates only — the Loose items bin is where things start, not a
    // place you "file into", so it never appears as a tickable row.
    const rows = ALL_LISTS.filter((l) => l.role !== 'loose' && l.role !== CONTAINER_ROLE).map((l) => {
      const here = l.id === list.id;
      const on = here || memberIds.has(l.id);
      return `<label class="check tmpl-check${on ? ' on' : ''}${here ? ' cur' : ''}">
        <input type="checkbox" name="tmpl" value="${esc(l.id)}"${on ? ' checked' : ''}${here ? ' disabled' : ''}>
        <span>${esc(l.name)}${here ? ' <em>· here</em>' : ''}</span></label>`;
    }).join('');
    return rows || '<p class="inlists-empty">No templates yet.</p>';
  })();

  // A "growing" dropdown for a free-form item field (colour / size / manufacturer):
  // its options are the values already used across items, plus a "＋ Add new…" choice
  // that reveals an inline text box. New values need no saving — they reappear next
  // time because collectItemValues re-reads them from the items.
  const growField = (name, labelHtml, cur, addLabel, placeholder, seed = []) => {
    const vals = collectItemValues(name);
    // Extra values worth offering even before anything has been given them.
    for (const s of seed) if (s && !vals.some((v) => v.toLowerCase() === s.toLowerCase())) vals.push(s);
    vals.sort((a, b) => a.localeCompare(b));
    if (cur && !vals.some((v) => v.toLowerCase() === cur.toLowerCase())) vals.unshift(cur);
    const opts = [{ value: '', label: '— not set —' }]
      .concat(vals.map((v) => ({ value: v, label: v })))
      .concat([{ value: '__new__', label: addLabel }]);
    return `<label class="field"><span>${labelHtml}</span>
      ${selectHtml(`${name}-sel`, opts, cur || '')}
      <input class="grow-new hidden" data-grow-new="${name}" name="${name}-new" value="" placeholder="${esc(placeholder)}" autocomplete="off"></label>`;
  };
  // Open the details panel by default only when it already holds something — or
  // always for a container, whose colour & brand live there and are worth surfacing.
  const detailsOpen = isContainer || !!(it.color || it.size || it.manufacturer || it.model || it.ownedBy || it.acquired
    || it.price || it.currency || it.purchaseLink || it.expiry || it.condition || it.retired || it.serial || it.qtyOwned || it.warranty);

  // The three parts of "which bag", separated so the editor can show which one is
  // actually in force. `_defContainer` etc. are set by resolveMembership; an item
  // that has never been resolved (a brand-new one) falls back to its own values.
  const defContainer = it._defContainer !== undefined ? it._defContainer : (it.container || '');
  const defPhase = it._defPhase !== undefined ? it._defPhase : (it.phase || '');
  const ovContainer = it._ovContainer !== undefined ? it._ovContainer : '';
  const tplContainer = it._tplContainer !== undefined ? it._tplContainer : '';
  // What this item WOULD use here with no exception set — named in the dropdown so
  // "use the default" is never a mystery.
  const fallbackContainer = tplContainer || defContainer;
  const fallbackWhy = tplContainer ? `${tplContainer} — this template's default` : (defContainer || '— none —');

  ed.innerHTML = `
    <section class="layer layer-item">
      <label class="field item-name"><input name="name" value="${esc(it.name)}" placeholder="${isContainer ? 'Container name — e.g. Osprey Farpoint 40' : 'Item name'}" aria-label="${isContainer ? 'Container name' : 'Item name'}"></label>
      <div class="layer-h"><span class="layer-num">1</span><span class="layer-t">${isContainer ? 'The container itself' : 'The item itself'}</span><span class="layer-sub">${isContainer ? 'The bag / duffel / backpack itself — its photos, capacity, where it lives and how to look after it.' : 'The thing itself — these stay the same everywhere you use it.'}</span></div>
      <div class="item-head">
        <div class="item-photos" data-photos></div>
      </div>
      <input type="file" accept="image/*" hidden data-care-file multiple>
      ${isContainer ? `
      <div class="row2">
        <label class="field"><span>Capacity <em>litres</em></span><input type="number" name="capacityL" min="0" step="0.1" inputmode="decimal" value="${it.capacityL || ''}" placeholder="e.g. 40"></label>
        <label class="field"><span>Max weight <em>kg</em></span><input type="number" name="maxKg" min="0" step="0.1" inputmode="decimal" value="${it.maxKg || ''}" placeholder="e.g. 23"></label>
      </div>
      <label class="field"><span>Weight empty <em>grams</em></span><input type="number" name="weight" min="0" inputmode="numeric" value="${it.weight || ''}" placeholder="0"></label>` : `
      <div class="row2">
        <label class="field"><span>Container <em>everywhere</em></span>${selectHtml('container', ['', ...containerOpts(defContainer)].map((c) => ({ value: c, label: c || '— none (task) —' })), defContainer)}</label>
        <label class="field"><span>When <em>everywhere</em></span>${selectHtml('phase', phaseOpts(defPhase), defPhase)}</label>
      </div>
      <p class="layer-note">Change these and every list that uses this item follows. To differ in <b>${esc(list.name)}</b> only, set the exception under <b>② In this list</b>.</p>
      <label class="field"><span>Weight (g) <em>per unit</em></span><input type="number" name="weight" min="0" inputmode="numeric" value="${it.weight || ''}" placeholder="0"></label>
      <div class="checks">
        <label class="check${it.charging ? ' on' : ''}"><input type="checkbox" name="charging" ${it.charging ? 'checked' : ''}>${ic('bolt','sm')}Charging</label>
        <label class="check${it.liquid ? ' on' : ''}"><input type="checkbox" name="liquid" ${it.liquid ? 'checked' : ''}>${ic('drop','sm')}Liquid</label>
        <label class="check${it.restricted ? ' on' : ''}"><input type="checkbox" name="restricted" ${it.restricted ? 'checked' : ''}>${ic('warn','sm')}Restricted</label>
        <label class="check${it.consumable ? ' on' : ''}" title="Something you use up — offered for restocking on the pre-trip shopping list"><input type="checkbox" name="consumable" ${it.consumable ? 'checked' : ''}>${ic('cart','sm')}Consumable</label>
      </div>
      <label class="field charge-type-field${it.charging ? '' : ' hidden'}"><span>Charge type</span>${selectHtml('chargeType', CHARGE_TYPES.map((c) => ({ value: c.id, label: c.label })), it.chargeType)}</label>`}

      <details class="care"${careOpen ? ' open' : ''}>
        <summary><span class="care-h">Storage &amp; maintenance</span><span class="care-sum">Where it lives, and how &amp; when to look after it</span></summary>
        <div class="care-body">
          <label class="field"><span>Where it's stored</span>
            <select name="storage-sel">
              <option value=""${it.storage ? '' : ' selected'}>— not set —</option>
              ${STORAGES.map((s) => `<option value="${esc(s)}"${s === it.storage ? ' selected' : ''}>${esc(s)}</option>`).join('')}
              <option value="__new__">＋ Add a new place…</option>
            </select></label>
          <label class="field care-newstorage hidden"><span>New place</span>
            <input name="storage-new" value="" placeholder="e.g. Garage shelf 3 · RV box · Hall closet" autocomplete="off"></label>

          <div class="care-maint">
            <label class="field"><span>Maintenance cadence</span>${selectHtml('interval', intervalOpts, intervalSel)}</label>
            <label class="field care-lastdone"><span>Last done</span><input type="date" name="lastDone" value="${esc(m.lastDone)}" max="${todayISO()}"></label>
            <button type="button" class="btn sm care-logbtn" data-care="donetoday" title="Log maintenance done today">${IC.check}<span>Log done today</span></button>
          </div>
          <label class="field care-custom${intervalSel === 'custom' ? '' : ' hidden'}"><span>Custom interval (days)</span>
            <input type="number" name="customDays" min="1" inputmode="numeric" value="${curInterval && !intervalIsPreset ? curInterval : ''}" placeholder="e.g. 120"></label>

          <label class="field"><span>How to maintain <em>(steps, products, settings)</em></span>
            <textarea name="mnotes" rows="3" placeholder="e.g. Rinse in fresh water, dry inside-out, re-wax zip yearly.">${esc(m.notes)}</textarea></label>
          <label class="field"><span>How-to link</span>
            <input type="url" name="mlink" value="${esc(m.link)}" placeholder="https://…" autocomplete="off"></label>

          <div class="care-history" data-history></div>
        </div>
      </details>

      <details class="care actions-panel"${actionsOpen ? ' open' : ''}>
        <summary><span class="care-h">Actions <em>to-dos</em></span><span class="care-sum">Things to do for this item — they also show on the Actions tab</span></summary>
        <div class="care-body">
          <div class="act-list" data-act-list></div>
          <div class="act-add">
            <input class="act-add-text" data-act-new placeholder="Add a to-do… e.g. Replace foam tips" autocomplete="off">
            <button type="button" class="btn sm" data-act-addbtn>${IC.plus}<span>Add</span></button>
          </div>
        </div>
      </details>

      <details class="care details-panel"${detailsOpen ? ' open' : ''}>
        <summary><span class="care-h">Details &amp; ownership</span><span class="care-sum">Make, colour, size, value, owner &amp; lifecycle — all optional</span></summary>
        <div class="care-body">
          <div class="row2">
            ${growField('color', 'Colour', it.color, '＋ Add a colour…', 'e.g. Black · Navy · Red')}
            ${growField('size', 'Size', it.size, '＋ Add a size…', 'e.g. M · 42 · One size')}
          </div>
          <div class="row2">
            ${growField('manufacturer', 'Manufacturer', it.manufacturer, '＋ Add a manufacturer…', 'e.g. Patagonia · Apple')}
            <label class="field"><span>Model <em>product name</em></span><input name="model" value="${esc(it.model)}" placeholder="e.g. Atmos AG 65" autocomplete="off"></label>
          </div>
          <label class="field"><span>Owner <em>whose it is</em></span>
            <select name="ownedBy-sel" data-was="${esc(it.ownedBy || '')}">${ownerOptsHTML(it.ownedBy)}</select></label>
          <div class="row2">
            <label class="field"><span>Item condition <em>how worn it is</em></span>${selectHtml('condition', conditionOpts(it.condition), it.condition)}</label>
            <label class="field"><span>Quantity owned</span><input type="number" name="qtyOwned" min="0" inputmode="numeric" value="${it.qtyOwned || ''}" placeholder="e.g. 3"></label>
          </div>
          <div class="lifecycle${it.retired ? ' is-retired' : ''}">
            <label class="check${it.retired ? ' on' : ''}"><input type="checkbox" name="retired" ${it.retired ? 'checked' : ''}>${ic('ban','sm')}Not in use <em>kept on record, but never added to a trip</em></label>
            <label class="field retire-reason-field${it.retired ? '' : ' hidden'}"><span>Reason</span>${selectHtml('retiredReason', [{ value: '', label: '— not set —' }, ...RETIRE_REASONS.map((r) => ({ value: r.id, label: r.label }))], it.retiredReason)}</label>
          </div>
          <div class="row2">
            <label class="field"><span>Price <em>per unit</em></span><input type="number" name="price" min="0" step="0.01" inputmode="decimal" value="${it.price || ''}" placeholder="0"></label>
            <label class="field"><span>Currency</span>${selectHtml('currency', [{ value: '', label: '—' }, ...CURRENCIES.map((c) => ({ value: c, label: c }))], it.currency)}</label>
          </div>
          <label class="field"><span>Purchase / reorder link</span><input type="url" name="purchaseLink" value="${esc(it.purchaseLink)}" placeholder="https://…" autocomplete="off"></label>
          <div class="row2">
            <label class="field"><span>Acquired</span><input type="date" name="acquired" value="${esc(it.acquired)}" max="${todayISO()}"></label>
            <label class="field"><span>Serial number</span><input name="serial" value="${esc(it.serial)}" placeholder="optional" autocomplete="off"></label>
          </div>
          <div class="row2">
            <label class="field"><span>Warranty until</span><input type="date" name="warranty" value="${esc(it.warranty)}"></label>
            <label class="field"><span>Expiry / replace by</span><input type="date" name="expiry" value="${esc(it.expiry)}"></label>
          </div>
        </div>
      </details>
    </section>

    ${isContainer ? '' : `<section class="layer layer-membership">
      <div class="layer-h"><span class="layer-num">2</span><span class="layer-t">In this list · ${esc(list.name)}</span><span class="layer-sub">Just for this template — changing these here doesn't touch the item in other lists.</span></div>
      <label class="field"><span>Qty</span><input name="qty" value="${esc(it.qty)}" placeholder="optional"></label>
      ${list.role === 'loose' ? '' : `<label class="field"><span>Container <em>in this list only</em></span>
        ${selectHtml('ovContainer', [{ value: '', label: `— use the default (${fallbackWhy}) —` }]
          .concat(containerOpts(ovContainer).map((c) => ({ value: c, label: c }))), ovContainer)}
        ${ovContainer ? `<em class="field-note">This list differs on purpose. Choose “use the default” to bring it back in line.</em>` : ''}</label>`}
      ${list.role === 'loose' ? '' : sectionFieldHTML(list, it)}
      <div class="checks">
        <label class="check${it.perNight ? ' on' : ''}"><input type="checkbox" name="perNight" ${it.perNight ? 'checked' : ''}>Per night (scales qty)</label>
      </div>
      <div class="cond-group">
        <div class="cond-head">Only include this item when…<em>Leave a row untouched and it always applies. Tick options to narrow when this item is added.</em></div>
        <fieldset class="mini"><legend>Season</legend>${checkRow('seasons', SEASONS, it.seasons)}</fieldset>
        <fieldset class="mini"><legend>Context</legend>${checkRow('contexts', CONTEXTS, it.contexts)}</fieldset>
        <fieldset class="mini"><legend>Transport</legend>${checkRow('transports', TRANSPORTS, it.transports)}</fieldset>
        <fieldset class="mini"><legend>Catering</legend>${checkRow('catering', CATERING.map((c) => ({ value: c.id, label: c.label })), it.catering)}</fieldset>
        <fieldset class="mini"><legend>Weather</legend>${checkRow('weather', WEATHER_CONDITIONS.map((w) => ({ value: w.id, label: w.label })), it.weather)}
          <p class="cond-note">Tick a condition and this item is <b>held back until the trip’s forecast calls for it</b> — e.g. tick <b>Rain</b> and it’s only added when rain is forecast. You can also <b>force it into any trip</b> whatever the forecast or season, using <b>Force-pack weather gear</b> in the event settings. Leave them all unticked and the item is <b>always included</b>, like the rest of the list.</p>
        </fieldset>
      </div>
      <label class="field"><span>Note</span><input name="note" value="${esc(it.note)}"></label>
    </section>

    <section class="layer layer-templates">
      <div class="layer-h"><span class="layer-num">3</span><span class="layer-t">In these templates</span><span class="layer-sub">Which reusable lists this one item belongs to.</span></div>
      <div class="inlists">
        <p class="inlists-hint">Tick a template to add this item to it, untick to remove it. Changes apply when you <b>Save</b>.</p>
        <div class="inlists-matrix">${inListsHTML}</div>
      </div>
    </section>`}

    <div class="editor-actions">
      <button type="button" class="btn danger ghost" data-x="del">${IC.trash}<span>${isContainer ? 'Delete' : 'Remove'}</span></button>
      <div class="spacer"></div>
      <button type="button" class="btn" data-x="cancel">Cancel</button>
      <button type="button" class="btn primary" data-x="save">Save</button>
    </div>`;

  const fileInput = $('[data-care-file]', ed);
  const drawPhotos = () => {
    const box = $('[data-photos]', ed);
    const tiles = photos.map((p, i) => `
      <div class="care-photo-tile${p.data ? '' : ' loading'}">
        ${p.data ? `<img src="${esc(p.data)}" alt="Photo ${i + 1}" data-photo-view="${i}">` : '<span class="care-photo-wait" aria-label="Loading photo"></span>'}
        <button type="button" class="care-photo-rm" data-photo-rm="${i}" title="Remove photo" aria-label="Remove photo ${i + 1}">${IC.close}</button>
      </div>`).join('');
    const addTile = photos.length < MAX_PHOTOS
      ? `<button type="button" class="care-photo-add" data-care="pick" title="Add photo" aria-label="Add photo">${IC.camera}<span>Photo</span></button>`
      : '';
    box.innerHTML = tiles + addTile;
  };
  drawPhotos();
  // Pull the full images in for the tiles above. Fire-and-forget: a failure just
  // leaves the placeholder, and the ids on the item are untouched either way.
  {
    const needed = photos.filter((p) => p.id && !p.data).map((p) => p.id);
    if (needed.length) {
      db.getPhotoMap(needed).then((map) => {
        let got = false;
        for (const p of photos) if (p.id && !p.data && map.has(p.id)) { p.data = map.get(p.id); got = true; }
        if (got) drawPhotos();
      }).catch((err) => logDiag('photo-load', err));
    }
  }
  const drawHistory = () => {
    const box = $('[data-history]', ed);
    if (!careLog.length) { box.innerHTML = ''; return; }
    const rows = careLog.slice().reverse().map((e) => `<div class="care-hrow"><span class="care-hdate">${esc(prettyDate(e.date))}</span>${e.note ? `<span class="care-hnote">${esc(e.note)}</span>` : ''}</div>`).join('');
    box.innerHTML = `<div class="care-hhead">Maintenance history</div>${rows}`;
  };
  drawHistory();
  // Read the current on-screen action rows back into the buffer (text / when /
  // priority / done live in the DOM; add & delete mutate the buffer directly).
  const syncActionsFromDOM = () => {
    $$('.act-row', ed).forEach((row) => {
      const a = actions[+row.dataset.actI];
      if (!a) return;
      a.text = ($('[data-act-text]', row).value || '').trim();
      a.whenPhase = $('[data-act-when]', row).value || '';
      a.priority = $('[data-act-flag]', row).classList.contains('on') ? 'high' : 'normal';
      const wasDone = a.done;
      a.done = $('[data-act-done]', row).checked;
      if (a.done && !wasDone) a.doneAt = new Date().toISOString();
      if (!a.done) a.doneAt = '';
    });
  };
  const drawActions = () => {
    const box = $('[data-act-list]', ed);
    if (!box) return;
    if (!actions.length) { box.innerHTML = '<p class="act-empty">No to-dos yet — add one below.</p>'; return; }
    box.innerHTML = actions.map((a, i) => `
      <div class="act-row${a.done ? ' done' : ''}" data-act-i="${i}">
        <label class="act-check"><input type="checkbox" data-act-done ${a.done ? 'checked' : ''}><span class="act-box">${IC.check}</span></label>
        <input class="act-text" data-act-text value="${esc(a.text)}" placeholder="To-do">
        <div class="act-controls">
          ${actionWhenSelectHtml('data-act-when', a.whenPhase)}
          <button type="button" class="act-flag${a.priority === 'high' ? ' on' : ''}" data-act-flag title="High priority">${IC.flag}</button>
          <button type="button" class="iconbtn sm act-del" data-act-del aria-label="Delete to-do">${IC.trash}</button>
        </div>
      </div>`).join('');
  };
  drawActions();
  const addAction = () => {
    const input = $('[data-act-new]', ed);
    const text = (input.value || '').trim();
    if (!text) { input.focus(); return; }
    syncActionsFromDOM();            // keep any in-progress edits to existing rows
    actions.push(newAction({ text }));
    input.value = '';
    drawActions();
    input.focus();
  };

  ed.addEventListener('change', async (e) => {
    if (e.target.matches('[data-act-done]')) e.target.closest('.act-row')?.classList.toggle('done', e.target.checked);
    if (e.target.type === 'checkbox' && !e.target.matches('[data-act-done]')) e.target.closest('label')?.classList.toggle('on', e.target.checked);
    if (e.target.name === 'charging') $('.charge-type-field', ed)?.classList.toggle('hidden', !e.target.checked);
    if (e.target.name === 'retired') {
      $('.retire-reason-field', ed)?.classList.toggle('hidden', !e.target.checked);
      $('.lifecycle', ed)?.classList.toggle('is-retired', e.target.checked);
    }
    if (e.target.name === 'interval') $('.care-custom', ed)?.classList.toggle('hidden', e.target.value !== 'custom');
    if (e.target.name === 'section') {
      const isNew = e.target.value === '__new__';
      $('.section-new-field', ed)?.classList.toggle('hidden', !isNew);
      if (isNew) $('input[name=section-new]', ed)?.focus();
    }
    if (e.target.name === 'storage-sel') {
      const isNew = e.target.value === '__new__';
      $('.care-newstorage', ed)?.classList.toggle('hidden', !isNew);
      if (isNew) $('input[name=storage-new]', ed)?.focus();
    }
    // Owner is a managed list, not a "growing" free-text field: ＋ names one on the
    // spot, ⚙ opens the manager, and either way the picker is rebuilt in place so
    // the change is there immediately, without losing anything else being edited.
    if (e.target.name === 'ownedBy-sel') {
      const sel = e.target;
      const before = sel.dataset.was || '';
      if (sel.value === '__new__') {
        const keep = (await addOwnerByName('')) || before;
        sel.innerHTML = ownerOptsHTML(keep);
        sel.value = keep;
      } else if (sel.value === '__manage__') {
        const changes = await openOwnersManager();
        // CRITICAL. This editor holds the whole template in memory and writes all of
        // it back on Save. The manager has just changed the owner of items in the
        // database — quite possibly OTHER items in this very template — so carry
        // those changes into the copy being edited. Without this, saving one item
        // silently puts the old owner back on every other item in the template.
        applyOwnerChanges(list, changes);
        // Follow what the manager did to the name this item was showing: renamed,
        // it keeps up; removed and re-assigned, it moves with its things.
        const keep = changes.has(normName(before)) ? changes.get(normName(before)) : before;
        sel.innerHTML = ownerOptsHTML(keep);
        sel.value = keep;
      }
      sel.dataset.was = sel.value;
      return;
    }
    if (['color-sel', 'size-sel', 'manufacturer-sel'].includes(e.target.name)) {
      const key = e.target.name.replace('-sel', '');
      const isNew = e.target.value === '__new__';
      $(`.grow-new[data-grow-new="${key}"]`, ed)?.classList.toggle('hidden', !isNew);
      if (isNew) $(`input[name="${key}-new"]`, ed)?.focus();
    }
    if (e.target === fileInput) {
      const files = Array.from(fileInput.files || []);
      fileInput.value = '';
      if (!files.length) return;
      let hitCap = false;
      for (const f of files) {
        if (photos.length >= MAX_PHOTOS) { hitCap = true; break; }
        try { photos.push({ id: '', data: await readImageResized(f) }); }
        catch { alert('Sorry — that image could not be read.'); }
      }
      drawPhotos();
      if (hitCap) alert(`You can add up to ${MAX_PHOTOS} photos per item.`);
    }
  });

  ed.addEventListener('keydown', (e) => {
    if (e.target.matches('[data-act-new]') && e.key === 'Enter') { e.preventDefault(); addAction(); }
  });

  ed.addEventListener('click', async (e) => {
    if (e.target.closest('[data-act-addbtn]')) { e.preventDefault(); addAction(); return; }
    const flag = e.target.closest('[data-act-flag]');
    if (flag) { flag.classList.toggle('on'); return; }
    const delRow = e.target.closest('[data-act-del]')?.closest('.act-row');
    if (delRow) { syncActionsFromDOM(); actions.splice(+delRow.dataset.actI, 1); drawActions(); return; }
    const viewIdx = e.target.closest('[data-photo-view]')?.dataset.photoView;
    if (viewIdx != null) { const p = photos[+viewIdx]; if (p && p.data) openPhotoLightbox(p.data); return; }
    const rmIdx = e.target.closest('[data-photo-rm]')?.dataset.photoRm;
    if (rmIdx != null) { photos.splice(+rmIdx, 1); drawPhotos(); return; }
    const care = e.target.closest('[data-care]')?.dataset.care;
    if (care === 'pick') { fileInput.click(); return; }
    if (care === 'donetoday') {
      const today = todayISO();
      careLog = [...careLog, { date: today, note: '' }];
      $('input[name=lastDone]', ed).value = today;
      drawHistory();
      return;
    }
    const x = e.target.closest('[data-x]')?.dataset.x;
    if (!x) return;
    if (x === 'cancel') { setOpen(null); if (takeItemEditorReturn()) return; draw(); return; }
    if (x === 'del') {
      const msg = isContainer
        ? `Delete the container “${it.name || 'this container'}”? Items already set to this container keep the name.`
        : `Remove “${it.name || 'this item'}” from the ${list.name} template?`;
      if (!confirm(msg)) return;
      list.items = list.items.filter((z) => z.id !== it.id);
      setOpen(null);
      if (await saveGuard(db.saveList(list))) { if (takeItemEditorReturn()) return; draw(); }
      return;
    }
    if (x === 'save') {
      it.name = ($('input[name=name]', ed).value || '').trim();
      it.weight = Math.max(0, parseInt($('input[name=weight]', ed).value, 10) || 0);
      // Packing-only fields — absent in container mode, so read them only then.
      if (!isContainer) {
        it.qty = ($('input[name=qty]', ed).value || '').trim();
        it.section = readSectionFromEditor(ed, list, it);
        // "Which bag" is three separate answers, so read them into three separate
        // channels and derive the effective value from them. Writing only
        // `it.container` is what used to freeze the shared default forever.
        it._defContainer = $('select[name=container]', ed).value;   // ① true everywhere
        it._defPhase = $('select[name=phase]', ed).value;
        const ovSel = $('select[name=ovContainer]', ed);            // ② this list only ('' = none)
        it._ovContainer = ovSel ? ovSel.value : (it._ovContainer || '');
        it.container = it._ovContainer || it._tplContainer || it._defContainer;
        it.phase = it._ovPhase || it._defPhase;
        it.perNight = $('input[name=perNight]', ed).checked;
        it.charging = $('input[name=charging]', ed).checked;
        it.chargeType = $('select[name=chargeType]', ed).value;
        it.liquid = $('input[name=liquid]', ed).checked;
        it.restricted = $('input[name=restricted]', ed).checked;
        it.consumable = $('input[name=consumable]', ed).checked;
        it.note = ($('input[name=note]', ed).value || '').trim();
        it.seasons = $$('input[name=seasons]:checked', ed).map((n) => n.value);
        it.contexts = $$('input[name=contexts]:checked', ed).map((n) => n.value);
        it.transports = $$('input[name=transports]:checked', ed).map((n) => n.value);
        it.catering = $$('input[name=catering]:checked', ed).map((n) => n.value);
        it.weather = $$('input[name=weather]:checked', ed).map((n) => n.value);
      } else {
        it.capacityL = Math.max(0, parseFloat($('input[name=capacityL]', ed).value) || 0);
        it.maxKg = Math.max(0, parseFloat($('input[name=maxKg]', ed).value) || 0);
      }
      // Care & storage
      const storageSel = $('select[name=storage-sel]', ed).value;
      it.storage = storageSel === '__new__'
        ? ($('input[name=storage-new]', ed).value || '').trim()
        : storageSel;
      if (it.storage) await rememberStorageLoc(it.storage); // a new place joins the saved set
      // Commit photos: anything new is written to the photos store and becomes an
      // id, existing ones keep theirs. The item then holds only ids, plus a small
      // thumbnail of the first for list rows.
      const photoIds = [];
      for (const p of photos) {
        if (p.id) { photoIds.push(p.id); continue; }
        if (!p.data) continue;
        photoIds.push(await db.savePhoto(p.data));
      }
      it.photos = photoIds;
      const firstData = photos.length ? (photos[0].data || await db.getPhoto(photos[0].id)) : '';
      it.thumb = firstData ? await makeThumb(firstData).catch(() => '') : '';
      const isel = $('select[name=interval]', ed).value;
      const intervalDays = isel === 'custom' ? Math.max(0, parseInt($('input[name=customDays]', ed).value, 10) || 0) : (parseInt(isel, 10) || 0);
      it.maintenance = normalizeMaintenance({
        notes: ($('textarea[name=mnotes]', ed).value || '').trim(),
        link: ($('input[name=mlink]', ed).value || '').trim(),
        intervalDays,
        lastDone: $('input[name=lastDone]', ed).value || '',
        log: careLog,
      });
      // Details & ownership metadata (all intrinsic to the item)
      const growVal = (key) => {
        const sel = $(`select[name="${key}-sel"]`, ed).value;
        return sel === '__new__' ? (($(`input[name="${key}-new"]`, ed).value || '').trim()) : sel;
      };
      it.color = growVal('color');
      it.size = growVal('size');
      it.manufacturer = growVal('manufacturer');
      it.model = ($('input[name=model]', ed).value || '').trim();
      it.ownedBy = ($('select[name="ownedBy-sel"]', ed)?.value || '').trim();
      it.condition = $('select[name=condition]', ed).value;
      it.retired = $('input[name=retired]', ed).checked;
      it.retiredReason = it.retired ? $('select[name=retiredReason]', ed).value : '';
      it.qtyOwned = Math.max(0, parseInt($('input[name=qtyOwned]', ed).value, 10) || 0);
      it.price = Math.max(0, parseFloat($('input[name=price]', ed).value) || 0);
      it.currency = $('select[name=currency]', ed).value;
      it.purchaseLink = ($('input[name=purchaseLink]', ed).value || '').trim();
      it.acquired = $('input[name=acquired]', ed).value || '';
      it.serial = ($('input[name=serial]', ed).value || '').trim();
      it.warranty = $('input[name=warranty]', ed).value || '';
      it.expiry = $('input[name=expiry]', ed).value || '';
      // Read the "In these templates" matrix and the action rows now, before the
      // editor is torn down.
      const nameKey = it.name.trim().toLowerCase();
      const wanted = nameKey ? $$('input[name=tmpl]:not([disabled])', ed).map((b) => ({ id: b.value, checked: b.checked })) : [];
      syncActionsFromDOM();
      const actionsToSave = actions.filter((a) => (a.text || '').trim());
      setOpen(null);
      const ok = await saveGuard((async () => {
        await db.saveList(list); // this template: the item's shared edits + its membership here
        if (!nameKey) return;
        // The item's stable catalog id. A brand-new item earns its id from the save
        // just done, so look it up by name in the freshly-resolved template.
        let itemId = it._itemId
          || (await db.getList(list.id))?.items.find((z) => (z.name || '').trim().toLowerCase() === nameKey)?._itemId;
        if (!itemId) return;
        // Commit this item's to-dos (tied by the stable catalog id).
        await db.replaceItemActions(itemId, it.name, actionsToSave);
        // Reconcile the OTHER templates by that id: a tick adds a membership, an
        // untick removes it. No name-matching, and a rename needs no special handling
        // because every template shares the one catalog item — the new name shows
        // everywhere the moment saveList propagates it above.
        const all = await db.getLists();
        for (const l of all) {
          if (l.id === list.id) continue;
          const w = wanted.find((x) => x.id === l.id);
          if (!w) continue;
          const here = (l.items || []).some((z) => z._itemId === itemId);
          if (w.checked && !here) {
            // A LINK: adds a membership, never rewrites the shared item. The section
            // travels by NAME — if this template has a section called the same thing
            // the item lands in it, otherwise it arrives Ungrouped, ready to file.
            l.items.unshift(linkFromResolved(it, itemId, { section: mapSectionAcrossTemplates(it.section, list, l) }));
            await db.saveList(l);
          } else if (!w.checked && here) {
            l.items = l.items.filter((z) => z._itemId !== itemId); // drop this template's membership
            await db.saveList(l);
          }
        }
        // Auto-file: once an item is in at least one real template, it shouldn't
        // linger in the Loose items bin — pull it out.
        const fresh = await db.getLists();
        const filed = fresh.some((l) => l.role !== 'loose' && l.items.some((z) => z._itemId === itemId));
        if (filed) {
          const loose = fresh.find((l) => l.role === 'loose');
          if (loose && loose.items.some((z) => z._itemId === itemId)) {
            loose.items = loose.items.filter((z) => z._itemId !== itemId);
            await db.saveList(loose);
            if (list.role === 'loose') list.items = list.items.filter((z) => z._itemId !== itemId);
          }
        }
      })());
      if (ok) {
        ALL_LISTS = await db.getLists(); await refreshActions();
        if (takeItemEditorReturn()) return;   // came from Packing Mode — go straight back
        draw();
      }
    }
  });
  return ed;
}

// If something sent us here expecting us back (Packing Mode), navigate there and
// say so. Consumed on use, so it can never strand a later, ordinary visit.
function takeItemEditorReturn() {
  if (!itemEditorReturn) return false;
  const to = itemEditorReturn;
  itemEditorReturn = null;
  location.assign(to);
  return true;
}

// ============================================================
// Care & maintenance — one place to see what needs looking after,
// as an urgency-ordered list or a month calendar.
// ============================================================
let careView = 'list';            // 'list' | 'calendar'
let careExpanded = null;          // item id whose detail panel is open (list mode)
let careMonth = null;             // 'YYYY-MM' shown in the calendar (defaults to this month)
let careForceOpenItemId = null;   // when set, the item's editor opens with its care panel expanded
let careItemSearch = '';          // current text in the "All items" search box on the Care page
const careItemFilter = new Set();  // active category chips on the Care page ('loose','liquid','charge','restricted','care','photo') — OR'd together
const careCondFilter = new Set();  // active Condition chips ('new','good','worn','retire','' = not rated) — OR'd within, AND'd with the other groups
const careSecFilter = new Set();   // active Section chips (section NAMES; '' = no section) — same rule
let careItemSort = loadAiSort();   // { by, dir } for the All-items index — remembered on this device
let careItemGroup = loadAiGroup(); // '' = flat, else an AI_GROUPS key — remembered too
const careItemFolds = new Set();   // collapsed grouping buckets, keyed `${groupKey}|${bucketKey}`
const careChipsOpen = new Set();   // filter rows showing all their chips rather than the first few ('cond' / 'sec')
const monthOf = (ymd) => ymd.slice(0, 7);

async function renderMaintenance() {
  const wrap = h('<section class="screen"></section>');
  wrap.appendChild(h(`<div class="topbar"><h1 class="grow">Care &amp; maintenance</h1><a class="iconbtn" href="#/search" aria-label="Search">${IC.search}</a></div>`));

  const lists = await db.getLists();
  // Entry point to the Containers catalogue (bags/duffels/backpacks as objects).
  const containerCount = (lists.find((l) => l.role === CONTAINER_ROLE)?.items || []).length;
  wrap.appendChild(h(`<a class="care-link" href="#/containers">
    <span class="care-link-ic">${ic('bag','md')}</span>
    <span class="care-link-body"><b>Containers</b><span class="care-link-sub">Your bags, duffels &amp; backpacks — photos, capacity, storage &amp; care${containerCount ? ` · ${containerCount}` : ''}</span></span>
    <span class="care-link-go">${IC.fwd}</span>
  </a>`));
  wrap.appendChild(h(`<a class="care-link" href="#/items">
    <span class="care-link-ic">${ic('sheet','md')}</span>
    <span class="care-link-body"><b>All items · table</b><span class="care-link-sub">Every item as a spreadsheet — edit weight, storage, flags &amp; template membership in bulk</span></span>
    <span class="care-link-go">${IC.fwd}</span>
  </a>`));
  // Shopping list — consumables to restock + gear that needs replacing before a trip.
  const [shopActions, shopCatalog] = await Promise.all([db.getActions(), db.getCatalogItems()]);
  const buyCount = openShoppingCount(shopActions);
  const sugCount = shoppingSuggestions(shopCatalog, shopActions, todayISO()).length;
  const shopSub = ['Restock &amp; replace before a trip', buyCount ? `${buyCount} to buy` : '', sugCount ? `${sugCount} suggested` : ''].filter(Boolean).join(' · ');
  wrap.appendChild(h(`<a class="care-link" href="#/shopping">
    <span class="care-link-ic">${ic('cart','md')}</span>
    <span class="care-link-body"><b>Shopping list</b><span class="care-link-sub">${shopSub}</span></span>
    <span class="care-link-go">${IC.fwd}</span>
  </a>`));
  ALL_LISTS = lists; // so isUnfiled() in the All-items rows reflects the current data
  const listById = new Map(lists.map((l) => [l.id, l]));
  const rows = maintenanceList(lists);
  const summary = maintenanceSummary(lists);

  // ---- Top: what needs looking after (list / calendar) --------------------
  // The list used to begin with no heading at all: after three navigation cards it
  // simply started at "OVERDUE", so there was nothing on screen telling you what you
  // were looking at — or what to search for. It gets the same heading treatment as
  // the "All items" browser below, so the two read as siblings. Outside the
  // rows-length check on purpose, so the empty state is labelled too.
  // (Two elements, so two appends — `h()` returns only the first element it finds.)
  wrap.appendChild(h(`<div class="ai-head care-head"><h2>${ic('wrench')}<span>Maintenance list</span></h2></div>`));
  wrap.appendChild(h('<p class="ai-hint">Everything you’ve given a care schedule or care notes, from every template, with whatever needs doing first at the top.</p>'));

  // One frame around the whole list — its counts, its List/Calendar toggle and every
  // row — so it reads as a single bounded section rather than trailing off into the
  // "All items" browser underneath it.
  const panel = h('<div class="care-panel"></div>');
  wrap.appendChild(panel);

  if (rows.length) {
    // Headline: overdue / due-soon counts.
    const sc = [];
    if (summary.overdue) sc.push(`<span class="care-stat overdue">${ic('dot','xs')}${summary.overdue} overdue</span>`);
    if (summary.soon) sc.push(`<span class="care-stat soon">${ic('dot','xs')}${summary.soon} due soon</span>`);
    if (!summary.due) sc.push(`<span class="care-stat ok">${ic('dot','xs')}All up to date</span>`);
    panel.appendChild(h(`<div class="care-stats">${sc.join('')}</div>`));

    // List / Calendar toggle.
    const seg = (val, label) => `<label class="seg${careView === val ? ' on' : ''}"><input type="radio" name="careview" value="${val}"${careView === val ? ' checked' : ''}>${label}</label>`;
    const toolbar = h(`<div class="toolbar"><div class="segmented small">${seg('list', 'List')}${seg('calendar', 'Calendar')}</div></div>`);
    panel.appendChild(toolbar);

    const body = h('<div class="care-wrap"></div>');
    panel.appendChild(body);

    // Mark an item maintained today, from any view.
    const markDone = async (listId, itemId) => {
      const list = listById.get(listId);
      const item = list && list.items.find((x) => x.id === itemId);
      if (!item) return;
      logMaintenance(item, todayISO());
      if (await saveGuard(db.saveList(list))) render();
    };

    const draw = () => {
      body.innerHTML = '';
      if (careView === 'calendar') drawCareCalendar(body, rows, markDone);
      else drawCareList(body, rows, markDone);
    };
    draw();

    toolbar.addEventListener('change', (e) => {
      if (e.target.name !== 'careview') return;
      careView = e.target.value;
      $$('.segmented .seg', toolbar).forEach((s) => s.classList.toggle('on', s.querySelector('input').checked));
      draw();
    });
    body.addEventListener('click', async (e) => {
      const done = e.target.closest('[data-done]');
      if (done) { e.preventDefault(); await markDone(done.dataset.list, done.dataset.done); return; }
    });
  } else {
    panel.appendChild(h(`<div class="care-none">
      <p class="empty-s">Nothing is scheduled for upkeep yet. Find an item below, open it, and fill in its <b>Storage &amp; maintenance</b> panel — a service interval or care notes will bring it here with reminders.</p>
    </div>`));
  }

  // ---- Below: browse every item and jump straight to its editor ----------
  wrap.appendChild(allItemsSection(lists));

  return wrap;
}

// The "All items" browser on the Care page: search all items across every
// list, tap one to jump to its editor (with the care panel expanded), or
// add a brand-new item to any list and edit it right away.
function allItemsSection(lists) {
  const sec = h('<div class="allitems"></div>');
  // A row is an item AS IT SITS IN ONE TEMPLATE — the same thing in three
  // templates is three rows — so `section` (which belongs to the template, not
  // the item) is resolved to its display name here, once.
  const flat = [];
  for (const l of lists) for (const it of (l.items || [])) flat.push({ it, list: l, section: sectionName(l, it.section) });
  flat.sort((a, b) => (a.it.name || '').localeCompare(b.it.name || '', undefined, { sensitivity: 'base' }));

  // One item keeps the SAME id in every template it is resolved into, so this is
  // what makes "how many actual things" answerable at all (`_itemId` covers the
  // paths that carry the catalog id separately).
  const itemKey = (r) => r.it._itemId || r.it.id;

  // Every template an item is in, by item — built once from the UNFILTERED set so
  // a collapsed row tells the whole truth ("Bike, Run") even when a search matched
  // only one of them.
  const tplsByItem = new Map();
  for (const r of flat) {
    const k = itemKey(r);
    if (!tplsByItem.has(k)) tplsByItem.set(k, []);
    const names = tplsByItem.get(k);
    if (r.list.name && !names.includes(r.list.name)) names.push(r.list.name);
  }

  // Fold the per-template rows down to one row per item, keeping the first as the
  // representative. Safe for every non-per-template sort and grouping, because
  // those read only fields that live on the item itself.
  const collapseRows = (rows) => {
    const seen = new Set();
    const out = [];
    for (const r of rows) {
      const k = itemKey(r);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(r);
    }
    return out;
  };

  sec.innerHTML = `
    <div class="ai-head">
      <h2>${IC.list}<span>All items</span></h2>
      <button class="btn ghost sm" type="button" data-ai-add>${IC.plus}<span>New item</span></button>
    </div>
    <p class="ai-hint">Jump to any item to set where it’s stored, add a photo, or plan its maintenance. An item in <b>several templates</b> is shown <b>once</b>, with its templates named on the line. Sort or group by <b>Container</b>, <b>Section</b> or <b>Template</b> and it splits into a line per template instead — those three are the only things that can differ between them. Either way it is <b>one item</b>: edit it anywhere and every template follows.</p>
    <form class="ai-addform hidden" data-ai-form>
      <div class="row2">
        <label class="field"><span>Add to</span>${selectHtml('ai-list', [
          ...lists.filter((l) => l.role !== 'loose' && l.role !== CONTAINER_ROLE).map((l) => ({ value: l.id, label: l.name })),
          { value: LOOSE_OPT, label: '— No template · keep as a loose item —' },
        ], (lists.find((l) => l.role !== 'loose' && l.role !== CONTAINER_ROLE) || {}).id || LOOSE_OPT)}</label>
        <label class="field"><span>Item name</span><input name="ai-name" placeholder="e.g. Wetsuit" autocomplete="off"></label>
      </div>
      <div class="ai-addactions">
        <button type="button" class="btn" data-ai-cancel>Cancel</button>
        <button type="submit" class="btn primary">Create &amp; edit</button>
      </div>
    </form>
    <label class="ai-searchbox">${IC.search}<input type="search" class="ai-search" placeholder="Search all items…" value="${esc(careItemSearch)}" autocomplete="off"></label>
    <div class="ai-filterbar"></div>
    <div class="ai-filtergroups"></div>
    <div class="ai-arrange">
      <label class="ai-arr"><span>Sort</span>
        <select class="ai-sortsel">${AI_SORTS.map((s) => `<option value="${s.key}"${s.key === careItemSort.by ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}</select>
      </label>
      <button type="button" class="iconbtn sm ai-sortdir" aria-label="Toggle sort direction"></button>
      <label class="ai-arr"><span>Group</span>
        <select class="ai-groupsel">${AI_GROUPS.map((g) => `<option value="${g.key}"${g.key === careItemGroup ? ' selected' : ''}>${esc(g.label)}</option>`).join('')}</select>
      </label>
    </div>
    <div class="ai-count"></div>
    <div class="ai-list"></div>`;

  const listEl = $('.ai-list', sec);
  const countEl = $('.ai-count', sec);
  const searchEl = $('.ai-search', sec);
  const filterEl = $('.ai-filterbar', sec);
  const groupsEl = $('.ai-filtergroups', sec);
  const sortSel = $('.ai-sortsel', sec);
  const dirBtn = $('.ai-sortdir', sec);
  const groupSel = $('.ai-groupsel', sec);
  const form = $('[data-ai-form]', sec);

  // ---- Filtering ---------------------------------------------------------
  // Three independent groups: the category chips (liquids, charging…), Condition
  // and Section. Chips WITHIN a group are OR'd ("either of these"); the groups
  // are AND'ed together ("…and worn …and in Tech & devices"), which is the only
  // reading that makes "Liquids + Needs replacing" mean what you'd expect.
  const textOf = (row) => `${row.it.name || ''}\n${row.it.storage || ''}\n${row.list.name || ''}`.toLowerCase();
  const passText = (row, q) => !q || textOf(row).includes(q);
  const passCats = (row) => itemMatchesFilter(row.it, careItemFilter);
  const passCond = (row) => !careCondFilter.size || careCondFilter.has(row.it.condition || '');
  const passSec = (row) => !careSecFilter.size || careSecFilter.has(row.section || '');
  const anyFilter = () => careItemFilter.size || careCondFilter.size || careSecFilter.size;

  // Chip counts are honest: each group is counted against the rows that already
  // pass the OTHER groups and the search, so a count says how many you'd get.
  // Long rows (a section chip per section name) are capped so the filters can't
  // push the list itself off the screen on a phone; the rest are one tap away.
  const CHIP_CAP = 10;
  const chipRow = (title, defs, active, attr, rowKey) => {
    const live = defs.filter((d) => d.n || active.has(d.value));
    const open = careChipsOpen.has(rowKey);
    const capped = !open && live.length > CHIP_CAP;
    const shown = capped ? live.filter((d, i) => i < CHIP_CAP - 1 || active.has(d.value)) : live;
    const chips = shown
      .map((d) => `<button class="fchip${active.has(d.value) ? ' on' : ''}" type="button" ${attr}="${esc(d.value)}">${d.icon ? ic(d.icon, 'sm') : ''}${esc(d.label)} <em>${d.n}</em></button>`).join('');
    const more = capped
      ? `<button class="fchip more" type="button" data-more="${rowKey}">+${live.length - shown.length} more</button>`
      : (open && live.length > CHIP_CAP ? `<button class="fchip more" type="button" data-more="${rowKey}">Fewer</button>` : '');
    return chips ? `<div class="ai-fgroup"><span class="ai-flabel">${esc(title)}</span><div class="ai-fchips">${chips}${more}</div></div>` : '';
  };

  const drawChips = () => {
    const q = careItemSearch.trim().toLowerCase();
    // Pools: everything except the group being counted.
    const catPool = flat.filter((r) => passText(r, q) && passCond(r) && passSec(r));
    const condPool = flat.filter((r) => passText(r, q) && passCats(r) && passSec(r));
    const secPool = flat.filter((r) => passText(r, q) && passCats(r) && passCond(r));
    // If a Condition/Section filter has narrowed things so far that no category
    // chip is left, keep a bare "Show all" so there's always a way back out.
    filterEl.innerHTML = itemFilterChipsHTML(catPool.map((r) => r.it), careItemFilter, false, anyFilter())
      || (anyFilter() ? '<button class="fchip clear" type="button" data-cat="__clear">Show all</button>' : '');

    const condDefs = [...ITEM_CONDITIONS.map((c) => ({ value: c.id, label: c.label })), { value: '', label: 'Not rated' }]
      .map((d) => ({ ...d, icon: 'sparkle', n: condPool.filter((r) => (r.it.condition || '') === d.value).length }));
    const secNames = [...new Set(flat.map((r) => r.section).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const secDefs = [...secNames.map((s) => ({ value: s, label: s })), { value: '', label: 'No section' }]
      .map((d) => ({ ...d, icon: 'folder', n: secPool.filter((r) => (r.section || '') === d.value).length }));
    // Only offer a group when it actually splits the collection in two or more.
    const useful = (defs) => defs.filter((d) => d.n).length > 1;
    groupsEl.innerHTML = (useful(condDefs) ? chipRow('Item condition', condDefs, careCondFilter, 'data-cond', 'cond') : '')
      + (useful(secDefs) ? chipRow('Section', secDefs, careSecFilter, 'data-sec', 'sec') : '');
  };

  // ---- Sorting & grouping -------------------------------------------------
  const paintDir = () => {
    const desc = careItemSort.dir === 'desc';
    dirBtn.textContent = desc ? '▼' : '▲';
    dirBtn.title = desc ? 'Z–A / largest first' : 'A–Z / smallest first';
  };
  paintDir();

  const groupHead = (label, n, collapsed) => `<div class="group-h clickable" role="button" tabindex="0" aria-expanded="${collapsed ? 'false' : 'true'}">
      <span class="group-caret" aria-hidden="true">▾</span>
      ${groupIcon(label) ? `<span class="grp-ic" aria-hidden="true">${groupIcon(label)}</span>` : ''}
      <span class="ph">${esc(label)}</span>
      <span class="group-count">${n}</span>
    </div>`;

  const drawItems = () => {
    const q = careItemSearch.trim().toLowerCase();
    const shown = flat.filter((r) => passCats(r) && passCond(r) && passSec(r) && passText(r, q));
    const sd = AI_SORTS.find((s) => s.key === careItemSort.by) || AI_SORTS[0];
    const gd = AI_GROUPS.find((g) => g.key === careItemGroup) || AI_GROUPS[0];
    // Split one item across several lines ONLY where the dimension in play really
    // is per-template; everywhere else fold it back to one line. See the note on
    // PER_TEMPLATE_GROUPS. Filter first, THEN collapse, so an item still surfaces
    // when only one of its memberships matches the search or a section chip.
    const splitByTemplate = PER_TEMPLATE_GROUPS.has(gd.key) || PER_TEMPLATE_SORTS.has(sd.key);
    const rows = splitByTemplate ? shown : collapseRows(shown);
    const byName = (a, b) => (a.it.name || '').localeCompare(b.it.name || '', undefined, { sensitivity: 'base' });
    const sorted = sortRowsBy(rows, sd.val, { dir: careItemSort.dir, num: !!sd.num, tie: byName });

    listEl.innerHTML = '';
    if (!shown.length) {
      countEl.textContent = flat.length
        ? `0 of ${new Set(flat.map((r) => r.it._itemId || r.it.id)).size} items`
        : 'No items yet';
      listEl.appendChild(h(`<div class="empty"><p class="empty-s">${flat.length ? 'No items match your search.' : 'Nothing here yet — add an item to a template and it will appear.'}</p></div>`));
      return;
    }
    // Rows are not items. A row is one item AS IT SITS IN ONE TEMPLATE, so an item in
    // Bike and Run has two — which reads as a duplicate unless the count says
    // otherwise. Martin reported "several instances of the same item" once before
    // (v108) and his catalogue was clean then too; the wording was what misled him.
    const distinct = (rs) => new Set(rs.map(itemKey)).size;
    const nAll = distinct(flat);
    const nShown = distinct(sorted);
    const lines = (n) => `${n} line${n === 1 ? '' : 's'}`;
    // "· N lines" is only honest — and only needed — while an item may occupy more
    // than one row. Once the rows are collapsed the two numbers are the same, and
    // printing both was what read as "my catalogue has duplicates in it".
    const multi = splitByTemplate && sorted.length !== nShown;
    const head = (q || anyFilter())
      ? `${nShown} of ${nAll} items${multi ? ` · ${lines(sorted.length)}` : ''}`
      : `${nAll} items${multi ? ` · ${lines(sorted.length)}` : ''}`;

    if (!gd.key) {
      countEl.textContent = head;
      for (const row of sorted) listEl.appendChild(aiRow(row.it, row.list, splitByTemplate ? null : tplsByItem.get(itemKey(row))));
      return;
    }
    const gOrder = typeof gd.order === 'function' ? gd.order() : (gd.order || []);
    const buckets = groupRowsBy(sorted, gd.of, { order: gOrder, emptyLabel: gd.empty || 'Not set' });
    countEl.textContent = `${head} · ${buckets.length} group${buckets.length === 1 ? '' : 's'} by ${gd.label}`;
    for (const b of buckets) {
      const foldKey = `${gd.key}|${b.key}`;
      const collapsed = careItemFolds.has(foldKey);
      const box = h(`<div class="group ai-group${collapsed ? ' collapsed' : ''}">${groupHead(b.label, b.rows.length, collapsed)}<div class="group-body"></div></div>`);
      const body = $('.group-body', box);
      for (const row of b.rows) body.appendChild(aiRow(row.it, row.list, splitByTemplate ? null : tplsByItem.get(itemKey(row))));
      const hd = $('.group-h', box);
      const toggle = () => {
        const nowC = !careItemFolds.has(foldKey);
        if (nowC) careItemFolds.add(foldKey); else careItemFolds.delete(foldKey);
        box.classList.toggle('collapsed', nowC);
        hd.setAttribute('aria-expanded', String(!nowC));
      };
      hd.addEventListener('click', toggle);
      hd.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
      listEl.appendChild(box);
    }
  };
  const redraw = () => { drawChips(); drawItems(); };
  redraw();

  searchEl.addEventListener('input', () => { careItemSearch = searchEl.value; redraw(); });
  const toggleIn = (set, key) => { if (set.has(key)) set.delete(key); else set.add(key); };
  filterEl.addEventListener('click', (e) => {
    const key = e.target.closest('[data-cat]')?.dataset.cat;
    if (key === undefined) return;
    // "Show all" clears every group, not just the chips it sits among.
    if (key === '__clear') { careItemFilter.clear(); careCondFilter.clear(); careSecFilter.clear(); }
    else toggleIn(careItemFilter, key);
    redraw();
  });
  groupsEl.addEventListener('click', (e) => {
    const more = e.target.closest('[data-more]');
    if (more) { toggleIn(careChipsOpen, more.dataset.more); drawChips(); return; }
    const cond = e.target.closest('[data-cond]');
    const sect = e.target.closest('[data-sec]');
    if (cond) toggleIn(careCondFilter, cond.dataset.cond);
    else if (sect) toggleIn(careSecFilter, sect.dataset.sec);
    else return;
    redraw();
  });
  sortSel.addEventListener('change', () => { careItemSort = { ...careItemSort, by: sortSel.value }; saveAiSort(careItemSort); drawItems(); });
  dirBtn.addEventListener('click', () => {
    careItemSort = { ...careItemSort, dir: careItemSort.dir === 'desc' ? 'asc' : 'desc' };
    saveAiSort(careItemSort); paintDir(); drawItems();
  });
  groupSel.addEventListener('change', () => { careItemGroup = groupSel.value; saveAiGroup(careItemGroup); careItemFolds.clear(); drawItems(); });

  $('[data-ai-add]', sec).addEventListener('click', () => {
    form.classList.toggle('hidden');
    if (!form.classList.contains('hidden')) $('input[name=ai-name]', form).focus();
  });
  $('[data-ai-cancel]', sec).addEventListener('click', () => form.classList.add('hidden'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const listId = $('select[name=ai-list]', form).value;
    // "No template" → the item goes into the Loose items bin (created on demand).
    const list = listId === LOOSE_OPT ? await getLooseList() : lists.find((l) => l.id === listId);
    if (!list) return;
    const name = ($('input[name=ai-name]', form).value || '').trim();
    const it = newItem({ name });
    list.items.unshift(it);
    careForceOpenItemId = it.id;
    careItemSearch = '';
    if (await saveGuard(db.saveList(list))) location.assign(`#/list/${list.id}/item/${it.id}`);
  });

  return sec;
}

// `tpls` (v128) is every template the item is in. On a collapsed row that is the
// whole set, so one line can say "Bike, Run" instead of the app showing the item
// twice; when the rows are deliberately split per template it is just this one.
// Capped so an item in nine templates cannot push the owner and storage off a
// phone — the item's editor lists them all.
function aiRow(it, list, tpls = null) {
  const care = maintenanceStatus(it);
  const nPhotos = (it.photos || []).length;
  const thumb = (nPhotos && it.thumb)
    ? `<span class="ai-thumb"><img src="${esc(it.thumb)}" alt="">${nPhotos > 1 ? `<span class="thumb-count">${nPhotos}</span>` : ''}</span>`
    : `<span class="ai-thumb ph">${IC.wrench}</span>`;
  const TPL_CAP = 3;
  const names = (tpls && tpls.length) ? tpls : [list.name];
  const tplLabel = names.length > TPL_CAP
    ? `${names.slice(0, TPL_CAP).map(esc).join(', ')} +${names.length - TPL_CAP}`
    : names.map(esc).join(', ');
  const bits = [`<span class="ai-tpl"${names.length > 1 ? ` title="${esc(names.join(' · '))}"` : ''}>${tplLabel}</span>`];
  if (it.ownedBy) bits.push(`${ic('person','xs')}${esc(it.ownedBy)}`);
  if (it.storage) bits.push(`${ic('pin','xs')}${esc(it.storage)}`);
  const unfiledBadge = isUnfiled(it.name) ? `<span class="ai-badge unfiled" title="Not in any template yet — still a loose item">${ic('warn','xs')}</span>` : '';
  const badge = care
    ? `<span class="ai-badge ${care.state}" title="${esc('Maintenance: ' + dueLabel(care))}">${careIcon(care.state)}</span>`
    : (nPhotos ? `<span class="ai-badge" title="${esc(nPhotos === 1 ? 'Has a photo' : `${nPhotos} photos`)}">${ic('camera','xs')}${nPhotos > 1 ? `${nPhotos}` : ''}</span>` : '');
  return h(`<a class="ai-item" href="#/list/${esc(list.id)}/item/${esc(it.id)}">
    ${thumb}
    <span class="ai-main">
      <span class="ai-name">${esc(it.name || '(unnamed)')}</span>
      <span class="ai-sub">${bits.join(' · ')}</span>
    </span>
    ${unfiledBadge}${badge}${IC.fwd}
  </a>`);
}

// Which folded Care sections you left open, remembered on this device — so ticking
// something inside "Later" doesn't slam the fold shut on the redraw.
const CARE_FOLD_KEY = 'ams-care-folds';
function loadCareFolds() {
  try { const a = JSON.parse(localStorage.getItem(CARE_FOLD_KEY) || '[]'); return new Set(Array.isArray(a) ? a : []); }
  catch { return new Set(); }
}
function saveCareFolds(set) {
  try { localStorage.setItem(CARE_FOLD_KEY, JSON.stringify([...set])); } catch { /* ignore */ }
}

// The Care list. Overdue and Due soon are what you act on, so they stay open;
// anything more than a couple of months out, and everything with care notes but no
// schedule, folds away — that's most of the rows on a full catalogue, and it was
// all you scrolled past to reach the things that actually needed doing.
function drawCareList(body, rows, markDone) {
  const open = loadCareFolds();
  for (const sec of careSections(rows, MAINTENANCE_UPCOMING_DAYS)) {
    if (!sec.rows.length) continue;
    const head = `<span class="care-sech ${sec.state}">${careIcon(sec.state)} ${esc(sec.label)} <em>${sec.rows.length}</em></span>`;
    if (!sec.fold) {
      body.appendChild(h(`<div class="care-sech-wrap">${head}</div>`));
      for (const row of sec.rows) body.appendChild(careRow(row, markDone));
      continue;
    }
    const det = h(`<details class="care-fold"${open.has(sec.key) ? ' open' : ''}>
      <summary>${head}<span class="care-fold-chev">${IC.fwd}</span></summary>
      <div class="care-fold-body"></div>
    </details>`);
    const inner = det.querySelector('.care-fold-body');
    for (const row of sec.rows) inner.appendChild(careRow(row, markDone));
    det.addEventListener('toggle', () => {           // `toggle` does NOT bubble — bind per <details>
      const s = loadCareFolds();
      if (det.open) s.add(sec.key); else s.delete(sec.key);
      saveCareFolds(s);
    });
    body.appendChild(det);
  }
}

function careRow(row, markDone) {
  const { item, listId, listName, status } = row;
  const m = item.maintenance || {};
  const nPhotos = (item.photos || []).length;
  const thumb = (nPhotos && item.thumb)
    ? `<span class="care-thumb"><img src="${esc(item.thumb)}" alt="">${nPhotos > 1 ? `<span class="thumb-count">${nPhotos}</span>` : ''}</span>`
    : `<span class="care-thumb ph ${status.state}">${careIcon(status.state)}</span>`;
  const bits = [esc(listName)];
  if (item.storage) bits.push(`${ic('pin','xs')}${esc(item.storage)}`);
  const nextBit = status.scheduled && status.nextDue ? ` · next ${esc(prettyDate(status.nextDue))}` : '';
  const wrapEl = h(`<div class="care-item ${status.state}${careExpanded === item.id ? ' open' : ''}">
    <div class="care-row">
      ${thumb}
      <button class="care-main" type="button" data-expand>
        <span class="care-name">${esc(item.name || '(unnamed)')}</span>
        <span class="care-sub">${bits.join(' · ')}</span>
        <span class="care-due ${status.state}">${esc(dueLabel(status))}${nextBit}</span>
      </button>
      ${status.scheduled ? `<button class="btn sm care-donebtn" data-done="${esc(item.id)}" data-list="${esc(listId)}">${IC.check}<span>Done</span></button>` : ''}
    </div>
  </div>`);

  if (careExpanded === item.id) {
    const link = m.link ? `<a class="care-link" href="${esc(m.link)}" target="_blank" rel="noopener noreferrer">${IC.link}<span>How-to link</span></a>` : '';
    const notes = m.notes ? `<div class="care-notes">${esc(m.notes)}</div>` : '';
    const sched = status.scheduled
      ? `<div class="care-fact">Every ${status.intervalDays} days${status.lastDone ? ` · last done ${esc(prettyDate(status.lastDone))}` : ' · never logged'}</div>`
      : '';
    const hist = (m.log && m.log.length)
      ? `<div class="care-hist"><div class="care-hhead">History</div>${m.log.slice().reverse().map((e) => `<div class="care-hrow"><span class="care-hdate">${esc(prettyDate(e.date))}</span>${e.note ? `<span class="care-hnote">${esc(e.note)}</span>` : ''}</div>`).join('')}</div>`
      : '';
    const detail = h(`<div class="care-detail">
      ${sched}${notes}${link}${hist}
      <a class="care-edit" href="#/list/${esc(listId)}">Edit “${esc(item.name || 'item')}” in ${esc(listName)} ${IC.fwd}</a>
    </div>`);
    wrapEl.appendChild(detail);
  }

  wrapEl.querySelector('[data-expand]').addEventListener('click', () => {
    careExpanded = careExpanded === item.id ? null : item.id;
    render();
  });
  return wrapEl;
}

function drawCareCalendar(body, rows, markDone) {
  const today = todayISO();
  if (!careMonth) careMonth = monthOf(today);
  const [y, mo] = careMonth.split('-').map(Number);
  const byDate = new Map();
  for (const r of rows) {
    if (!r.status.scheduled || !r.status.nextDue) continue;
    if (!byDate.has(r.status.nextDue)) byDate.set(r.status.nextDue, []);
    byDate.get(r.status.nextDue).push(r);
  }

  const monthLabel = new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const head = h(`<div class="cal-head">
    <button class="iconbtn" data-cal="prev" aria-label="Previous month">${IC.back}</button>
    <div class="cal-title">${esc(monthLabel)}</div>
    <button class="iconbtn" data-cal="next" aria-label="Next month">${IC.fwd}</button>
  </div>`);
  body.appendChild(head);

  const overdue = rows.filter((r) => r.status.state === 'overdue');
  if (overdue.length) {
    body.appendChild(h(`<div class="cal-overdue">${ic('dot','xs')}${overdue.length} item${overdue.length === 1 ? '' : 's'} overdue — see the <b>List</b> view to catch up.</div>`));
  }

  const dows = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const grid = h('<div class="cal-grid"></div>');
  for (const d of dows) grid.appendChild(h(`<div class="cal-dow">${d}</div>`));
  const firstDow = (new Date(Date.UTC(y, mo - 1, 1)).getUTCDay() + 6) % 7; // Mon = 0
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  for (let i = 0; i < firstDow; i++) grid.appendChild(h('<div class="cal-cell blank"></div>'));
  let selected = null;
  for (let d = 1; d <= daysInMonth; d++) {
    const ymd = `${careMonth}-${String(d).padStart(2, '0')}`;
    const items = byDate.get(ymd) || [];
    const isToday = ymd === today;
    const worst = items.some((r) => r.status.state === 'overdue') ? 'overdue' : items.length ? 'soon-or-ok' : '';
    const state = items.length ? (items.some((r) => r.status.state === 'overdue') ? 'overdue' : items.some((r) => r.status.state === 'soon') ? 'soon' : 'ok') : '';
    void worst;
    const cell = h(`<button class="cal-cell${isToday ? ' today' : ''}${items.length ? ' has' : ''}${state ? ' ' + state : ''}" type="button"${items.length ? ` data-day="${ymd}"` : ' disabled'}>
      <span class="cal-num">${d}</span>
      ${items.length ? `<span class="cal-dot">${items.length}</span>` : ''}
    </button>`);
    grid.appendChild(cell);
  }
  body.appendChild(grid);

  const dayList = h('<div class="cal-daylist"></div>');
  body.appendChild(dayList);
  const showDay = (ymd) => {
    const items = byDate.get(ymd) || [];
    dayList.innerHTML = `<div class="care-sech">${esc(prettyDate(ymd))} <em>${items.length}</em></div>`;
    for (const r of items) dayList.appendChild(careRow(r, markDone));
    selected = ymd;
    $$('.cal-cell', grid).forEach((c) => c.classList.toggle('sel', c.dataset.day === ymd));
  };
  // Default: today if it has items, else the first day that does.
  const firstWithItems = [...byDate.keys()].filter((k) => monthOf(k) === careMonth).sort()[0];
  if (byDate.has(today) && monthOf(today) === careMonth) showDay(today);
  else if (firstWithItems) showDay(firstWithItems);

  head.addEventListener('click', (e) => {
    const dir = e.target.closest('[data-cal]')?.dataset.cal;
    if (!dir) return;
    const base = new Date(Date.UTC(y, mo - 1, 1));
    base.setUTCMonth(base.getUTCMonth() + (dir === 'next' ? 1 : -1));
    careMonth = base.toISOString().slice(0, 7);
    render();
  });
  grid.addEventListener('click', (e) => {
    const day = e.target.closest('[data-day]')?.dataset.day;
    if (day) showDay(day);
  });
  void selected;
}

// A deep, collapsible "How it works" — the full manual for the app, kept in sync
// as features grow. Reference material, so it lives collapsed by default.
function howtoCard() {
  return h(`<div class="card block">
    <details class="howto">
      <summary><span class="howto-h">How it works</span><span class="howto-sum">The full guide — every feature, tap to open</span></summary>
      <div class="howto-body">

        <h3>The idea</h3>
        <p>Everything here exists to surface <b>the exact packing list for whatever you're about to do</b> — one activity or a combination (a city trip + a run + a hike), under the specific conditions of that trip. You keep small, reusable <b>templates</b>; an <b>Event</b> composes the ones you pick into a single <b>Packing List</b> for a trip and filters it down to what actually applies. Category, where it's packed and when to pack it are just how that result is organised.</p>
        <p class="hint">Four words to keep straight: a <b>Template</b> is a reusable building block that holds <em>gear</em> (Swim, Run, Travel, Golf…); an <b>Event</b> is one specific trip that combines templates; the <b>Packing List</b> is the single merged list that Event produces — the one you actually pack from; and a <b>Trip preset</b> holds no gear at all — it is a saved set of <em>answers</em> to the Home form, so a trip you take often can be set up in one tap. There's a section on the difference between a Template and a Trip preset further down.</p>

        <h3>Quick start (the whole app in four steps)</h3>
        <p>If you remember nothing else, remember this loop:</p>
        <ol>
          <li><b>Templates hold your gear.</b> The app comes pre-filled with reusable lists (Travel, Golf, Run, Diving…). Edit them in the <b>Templates</b> tab whenever your kit changes — it's a one-time-ish setup you tweak over the years.</li>
 <li><b>Home builds a trip.</b> On <b>Home</b>, pick your transport and season, tick any <b>extra activities</b> you'll do, add a name and dates, and press <b>Create Event</b>. (Take a similar trip often? Tap a saved <b>preset</b> to fill it all in at once.)</li>
          <li><b>The trip gives you one Packing List.</b> Open the new trip (under <b>Events</b>) to see a single, tidy list combined from everything above — organised by when to pack and which bag it goes in.</li>
          <li><b>Pack it off.</b> Tap <b>Start packing</b> and tick things phase by phase. That's it — the readiness ring at the top fills up as you go.</li>
        </ol>
        <p>Everything else in this guide is detail on top of that loop — you can ignore most of it until you need it.</p>

        <h3>Building blocks: templates</h3>
        <p>Under the <b>Templates</b> tab your reusable templates are grouped three ways:</p>
        <ul>
          <li><b>GA — Goal Activity:</b> the activities that matter — Travel, Golf, Hiking, Diving…</li>
          <li><b>WET — Workout, Exercise &amp; Training:</b> Swim, Bike, Run, Strength, Mobility, Breath work.</li>
          <li><b>OE — Other Events:</b> small nice things (a coffee, a winter bath, a walk).</li>
        </ul>
        <p><b>Covers.</b> Each template shows as a <b>cover card</b> in the grid — a coloured tile with an emoji — so you can pick out Golf, Diving or Travel by look alone. Every template gets a distinct colour automatically; to choose your own, open a template and tap the <b>Cover</b> button in its toolbar, then set an <b>emoji</b> and a <b>colour</b> (or leave the colour on <b>Auto</b>). A live preview shows the card before you save. It’s purely visual — it doesn’t change what the template holds.</p>
 <p>Open a template to add or edit its items. (Items imported from your original Swedish lists still carry that wording underneath — it is <b>no longer shown</b> anywhere, since it only repeated what the English name already said, but it is kept, and <b>search still finds an item by it</b>.) At the top of a template’s item list sit <b>quick-filter chips</b> — <b>Liquids</b>, <b>Charging</b>, <b>Restricted</b>, <b>Has care</b>, <b>Photo</b> — so you can isolate one kind of thing within that list (tap several to combine; <b>Show all</b> clears). Only the categories present in that template appear, each with a count. The same chips are on the Care tab’s <b>All items</b> index for filtering across every template at once.</p>
        <p><b>Sections.</b> A template can be split into named <b>sections</b> to give a clear overview — for a Diving list, say <b>Lights</b>, <b>Rig</b>, <b>Drysuit-related</b>, <b>Regulators</b>. Use the <b>Sections</b> button on a template to add, rename, reorder or delete them, then set an item’s section in its editor under <b>“② In this list”</b>. The list then shows counted section blocks in your chosen order, with anything unassigned under <b>Ungrouped</b>. A section is remembered <b>per template</b>, so the same item can sit in different sections in different lists. When you <b>add an item to another template</b>, its section comes along <b>by name</b> — if that template has a section called the same thing the item lands in it, otherwise it arrives under <b>Ungrouped</b> for you to file (it never creates a section in a list you’ve arranged yourself). Sections also flow onto a trip’s Packing List — pick <b>Section</b> in the trip’s <b>Group by</b> row (it appears once a trip has any sectioned items); same-named sections from different lists merge, and unsectioned items gather under <b>Everything else</b>.</p>

        <h3>Which bag an item goes in</h3>
        <p>You own <b>one</b> of each thing, so the app stores it once and every template points at that one item. But the <b>bag</b> it travels in genuinely does depend on the trip — on a hike everything goes in the hiking backpack, on a flight in the checked luggage. So “which bag” is answered in <b>three places</b>, and the most specific one wins:</p>
        <ol>
          <li><b>The item’s own default</b> — set under <b>① The item itself</b>. This is the honest answer for that object, and it applies <b>everywhere</b>. Change it here and every template that uses the item follows.</li>
          <li><b>The template’s default bag</b> — the <b>Default bag</b> dropdown in a template’s toolbar. Sets one bag for <b>everything in that template</b>, which saves setting the same bag on dozens of items. Leave it on <b>“each item decides”</b> and it stays out of the way.</li>
          <li><b>A per-list exception</b> — the <b>Container</b> setting under <b>② In this list</b>. Use it when this one item, in this one template, really does belong somewhere else. The dropdown names the default it would otherwise use, so you always know what you’re overriding, and the editor marks the item as differing <b>on purpose</b>.</li>
        </ol>
        <p>The same three-step idea applies to <b>When</b> (the packing phase), minus the template-wide step. If you ever wonder why an item is in a particular bag, open it: ② tells you whether this list is overriding anything, and ① tells you what it would use otherwise.</p>

        <h3>Anatomy of an item</h3>
        <p>Every item has three organising dimensions and a set of flags &amp; conditions:</p>
        <ul>
          <li><b>Category</b> (what it is), <b>Container</b> (which bag it goes in), <b>Phase</b> (when to pack it — see the timeline below).</li>
          <li><b>Reminder</b> vs item: a reminder is a to-do prompt (e.g. “charge the Garmin”), not a physical thing to tick off.</li>
 <li><b>Flags:</b> needs charging (with an optional <b>charge type</b> — USB-C, USB-A, Lightning, special charger… shown on the badge, e.g. USB-C, so you know which cables to bring), short-home-list, liquid/gel (100 ml rule), restricted — think before packing (battery / carry-on rules), <b>per-night</b> (quantity scales with trip length), and a <b>weight</b> in grams.</li>
          <li><b>Inclusion rules</b> — the “only include this item when…” block: Season, Context (Indoor/Outdoor/Race — applies to <b>Workout / Exercise (WET)</b> lists only), Transport (Car/Plane/RV), Catering, and <b>Weather</b> (see below). A row left untouched means “always applies”. (These are nothing to do with an item’s <b>Item condition</b>, which grades how worn it is — see below.)</li>
          <li><b>Sub-items:</b> optional nested things bundled under one line.</li>
 <li><b>In these templates</b> — a tick-box list of <b>every template</b>. Ticking one <b>adds this item to it</b> and unticking <b>removes it</b> (applied when you Save), so a new hat can join Travel, Golf and Hiking in a few taps. The template you’re editing in stays ticked and locked. Each item lives <b>once</b> and every template simply points to it — so <b>everything under “① The item itself” updates in every template it belongs to</b>: its name, category, weight, flags, photos, care record, purchase details, <b>and its default bag and when</b>. It still appears just once in <b>Care</b>. What stays separate per template is only what you deliberately make separate: its <b>quantity</b>, <b>section</b>, <b>note</b>, <b>conditions</b>, and a <b>per-list bag exception</b> if you set one. Items that are in <b>no</b> template show a <b>No template</b> flag.</li>
        </ul>

        <h3>Loose items — things not in a template yet</h3>
 <p>You don’t have to file an item into a template just to keep it. At the top of the <b>Templates</b> tab there’s a <b>Loose items</b> card — a holding place for anything you want to jot down before you’ve decided where or when to pack it. Open it and use <b>Add several</b> to type or paste a whole batch (<b>one item per line</b>), or <b>Add item</b> for a single one. Loose items are <b>never</b> added to a trip and never appear in the activity picker; they simply wait. When you’re ready, open a loose item and tick a template under <b>In these templates</b> — it’s filed there and <b>automatically drops out</b> of the Loose items list. Anything still loose (here or in the Care tab’s <b>All items</b>) carries a <b>No template</b> flag so it’s never quietly forgotten.</p>

        <h3>Containers — your bags as objects</h3>
 <p>Your <b>bags, duffels and backpacks</b> live in their own catalogue, reached from the <b>Care</b> tab → <b>Containers</b>. Each one is edited like any item — photos, colour, brand, where it’s stored and its care record — plus <b>Capacity</b> (litres) and <b>Max weight</b> (kg). Containers never appear as packing items or activities; instead they power two things: every container is offered when you choose <b>where an item is packed</b>, and a trip’s <b>Bags &amp; weight</b> panel warns you against <b>each bag’s own max weight</b>. Their upkeep shows on the Care tab like anything else. The list comes pre-seeded with your usual bags — all editable.</p>

        <h3>All items · table (the spreadsheet)</h3>
        <p>For fast bulk edits, the <b>Care</b> tab → <b>All items · table</b> shows every item as a row in a wide, editable grid, with columns grouped like an item’s editor: <b>the item itself</b> (weight, storage, flags, colour, <b>owner</b>…), <b>in this list</b> (qty/section), and a <b>tick-box per template</b>. <b>Owner</b> is the same dropdown as in the item editor — the one <b>Owners</b> list — so you can go down the column assigning things without typing a name twice, and <b>⚙ Manage owners…</b> in the dropdown lets you add, rename or remove one without leaving the table. Edit a cell and the item updates <b>everywhere</b>; tick a template box to file the item in or out. Qty/Section are editable when an item is in one template. The name column stays pinned as you swipe sideways; a search box narrows the rows. Great on a bigger screen.</p>
        <p>A toolbar above the grid bends the table to how you work: <b>Sort</b> the whole thing by <b>Name</b>, <b>Weight</b>, <b>Storage</b>, <b>Container</b> or <b>how many lists</b> an item is in, with a <b>▲/▼</b> button to flip the direction; and a <b>Columns</b> button opens a panel to <b>reorder the “item itself” columns</b> into the order you like. Both your <b>sort choice</b> and your <b>column order</b> are remembered on this device, so the table opens just how you left it.</p>

        <h3>Places visited (the world map)</h3>
 <p>The <b>Events</b> tab → <b>Map</b> button opens a <b>world map of everywhere you’ve been</b>. Every trip that has a <b>destination</b> set becomes a pin; <b>repeat visits to the same place merge into one pin</b> with a small count, and pins are ordered most-recent-first in the list beneath. <b>Tap a pin</b> to highlight and scroll to that place in the list, where each visit links to its trip. The map <b>opens framed on the places you’ve visited</b> (rather than the whole globe), and you can <b>zoom</b> for a closer look — use the small <b>＋ / − / ⤢</b> buttons in the corner (the <b>⤢</b> re-frames everything), a <b>trackpad pinch</b> or <b>⌘-scroll</b>, or a <b>double-click</b> (pinch and double-tap work on a phone too) — then <b>drag</b> to move around; this keeps trips that sit close together from overlapping into one dot. A place is pinned automatically once its <b>weather</b> has been looked up; for trips whose destination hasn’t been located yet, the <b>“Find places on the map”</b> button geocodes them all at once (this needs the internet) and caches each spot so the map then works fully <b>offline</b>. The map is drawn inside the app from open geographic data — no outside map service, and nothing about your trips leaves the device.</p>
 <p>Two finishing touches: your trips are joined by a <b>subtle dotted line in date order</b> (oldest → newest) so you can trace your travels over time — undated trips keep their pin but sit off the line — and a small <b>“most visited” badge</b> at the top names the place you’ve been most, appearing once anywhere has more than one visit.</p>

        <h3>The timeline (phases)</h3>
        <p>Items are packed in stages, in this order: <b>Preparations</b> (book/cancel/charge, done ahead) → <b>≥1 week ahead</b> (things you don't use at home) → <b>Day before</b> (stage / move to the RV) → <b>Morning of</b> → <b>At the front door</b> (last check as you leave) → <b>Wear / carry</b> on the day → <b>After / recovery</b> (shower, change, recovery).</p>

        <h3>Getting around</h3>
        <p>Six tabs along the bottom:</p>
        <ul>
          <li><b>Home</b> — the builder for starting a new trip, plus a compact preview of your few most recent events.</li>
 <li><b>Events</b> — every event you've made, grouped <b>Upcoming</b> → <b>No date set</b> → <b>Past trips</b>, with the nearest trip on top. Home's “See all” link lands here. The <b>Map</b> button up top opens the <b>Places visited</b> world map (see below). <b>Long-press</b> (or <b>right-click</b>) a trip card for its quick-actions menu — see <b>Quick actions on a trip</b> below.</li>
          <li><b>Templates</b> — your reusable templates (the building blocks).</li>
          <li><b>Care</b> — everything that needs looking after, as an urgency-ordered list or a month calendar (see <b>Care, storage &amp; maintenance</b> below).</li>
          <li><b>Actions</b> — your to-do list (the red tab): everything you need to <em>do</em>, not just pack, whether it belongs to a specific item or stands on its own (see <b>Actions — your to-do list</b> below).</li>
          <li><b>Settings</b> — <b>Maintenance mode</b> (the whole-database overview), backup/restore, trip import, this guide and the version history.</li>
        </ul>
 <p><b>Search.</b> A <b></b> button in the top bar of Home, Events, Templates, Care and Actions opens one search box that looks across <b>everything at once</b> — items (by name, <em>and</em> by the original Swedish wording even though that is no longer displayed), templates, trips (by name or destination) and to-dos. Results are grouped and update as you type; tap one to jump straight to it. It's the quickest way to reach a specific thing without remembering which template it's in.</p>

        <h3>Colour tells you where you are</h3>
        <p>Each of the six tabs has its <b>own colour</b>, and that colour flows through the whole screen — the page heading, the buttons, the chips and progress bars, the back/edit icons, and the tab itself. In the bottom bar <b>every tab always shows its colour</b>, and the one you're currently on fills in solid and goes bold — so a single glance tells you which part of the app you're in:</p>
        <ul>
          <li><b><span class="sec-swatch" style="--c:#2f6fe0"></span>Blue — Home:</b> building a new trip.</li>
          <li><b><span class="sec-swatch" style="--c:#2f9e63"></span>Green — Events:</b> your trips — including a trip's packing list and the focused <b>Packing Mode</b>.</li>
          <li><b><span class="sec-swatch" style="--c:#7c5cd6"></span>Purple — Templates:</b> your reusable building blocks, and any <b>item editor</b> opened from them.</li>
          <li><b><span class="sec-swatch" style="--c:#dd7324"></span>Amber — Care:</b> storage, maintenance, containers and the all-items views.</li>
          <li><b><span class="sec-swatch" style="--c:#dc3d43"></span>Red — Actions:</b> your to-do list.</li>
          <li><b><span class="sec-swatch" style="--c:#64748b"></span>Grey — Settings:</b> backups, presets, storage places, this guide and the version history.</li>
        </ul>
        <p>When you open a detail screen (an item, a trip), it keeps the colour of the tab you came from and shows a <b>← Back</b> arrow to return.</p>

        <h3>Syncing your devices</h3>
        <p>Your catalogue can be kept in step across every device you use. Open <b>Settings \u2192 Sync your devices</b> and tap <b>Sign in to sync</b>: you type your e-mail, a <b>one-time code</b> arrives, and that's it \u2014 there is no password. Do the same on your other device and from then on the two match each other automatically.</p>
        <ul>
          <li><b>What travels:</b> your templates, items, trips, to-dos and kits \u2014 everything that makes up the catalogue \u2014 plus the <b>lists you make in Settings</b>: your <b>When</b> timeline, <b>Item conditions</b>, <b>Trip presets</b>, <b>People</b>, <b>Owners</b> and <b>Storage places</b>.</li>
          <li><b>What stays on the device:</b> your <b>photos</b>, the <b>automatic backups</b> (both below) \u2014 and how each device <b>looks and behaves</b>: the theme, the view you last used, which Settings sections you left open, and this device's own backup dates. You may well want dark on the phone and light on the Mac.</li>
          <li><b>Offline is fine.</b> Changes you make with no signal are queued and sent the moment you're back online.</li>
          <li><b>You are never locked out.</b> The app works fully without signing in \u2014 signing in only starts the sharing. Signing out on a device stops it syncing but leaves everything on it untouched.</li>
        </ul>

        <h4>The lists you make in Settings</h4>
        <p>The rule is <b>lists you author travel; how a device looks does not</b>. Six lists travel: the <b>When</b> timeline, <b>Item conditions</b>, <b>Trip presets</b>, <b>People</b> (names <em>and</em> their colours), <b>Owners</b> and <b>Storage places</b>. Change any of them anywhere and every signed-in device follows.</p>
        <p><b>The first time each device runs this version</b> it offers up the lists you had already made on it, and they are <b>merged</b> \u2014 an entry your account already has is left exactly as it is, and anything only one device had is added. So the first time round you may see the combined set. <b>Go through the six lists once afterwards and remove anything you don't want</b>: from then on a removal travels too.</p>
        <p>Two things are deliberately never written into your shared data: the <b>standard</b> versions of these lists (the four conditions, Martin &amp; Anna, the standard storage places) live in the app itself, so no device can ever plant them over yours \u2014 and a device <b>waits until it has actually seen your account's copy</b> before offering anything up.</p>

        <h4>Photos stay on the device that took them \u2014 on purpose</h4>
        <p>This is a deliberate decision, not a limitation, and it is worth understanding because it is the one place where your two devices are <em>meant</em> to differ.</p>
        <p>When you photograph an item, the picture is stored on <b>that</b> device and stays there. It is never uploaded, and it will not appear on your other device.</p>
        <p><b>What you do see everywhere:</b> every item carries a small <b>thumbnail</b> of its first photo, and that thumbnail <em>does</em> travel. So your lists, your Care screen and your item rows look exactly the same on both devices \u2014 you still see the little picture that tells you which jacket or which torch this is. What you cannot do is open the <b>full-size</b> photo on a device that did not take it.</p>
        <p><b>Why it works this way:</b></p>
        <ul>
          <li><b>Size.</b> Photos are far larger than everything else put together. The whole rest of your catalogue \u2014 hundreds of items, every template, trip, to-do and kit \u2014 is around a megabyte. Your photos can be twenty or thirty times that. Syncing them would make every sync slow and would consume the storage allowance many times over, for pictures you can already identify from the thumbnail.</li>
          <li><b>They rarely need to be shared.</b> A photo is usually taken to remind <em>you</em> what a thing looks like or where it lives. The thumbnail already does that job on the other device.</li>
          <li><b>Nothing is lost.</b> Photos are still included in full in your <b>exported backup file</b>, so they are backed up properly \u2014 they simply do not travel over the wire between devices.</li>
        </ul>
        <p>The same reasoning applies to the <b>automatic backups</b>: those are each device's private safety net, and copying every device's backups onto every other device would help nobody.</p>
        <p>If you want a photo on both devices, take it on both \u2014 or restore a backup file onto the second device, which does carry them.</p>

        <h4>What the syncing actually is</h4>
        <p>For future reference, since this is the one part of the app that is not entirely self-contained: syncing is provided by <b>Dexie Cloud</b> (<b>dexie.org/cloud</b>), a small hosted service built for exactly this kind of offline-first app. Your app database is <b>Dexie</b>, and Dexie Cloud is its own sync add-on \u2014 so the two fit together natively rather than being bolted on.</p>
        <ul>
          <li>The account is tied to <b>your e-mail address</b>, and signing in uses a one-time code rather than a password.</li>
          <li>You are on the <b>free tier</b>, which covers a handful of users and a modest amount of storage \u2014 comfortably more than one person with two devices needs, especially with photos staying local.</li>
          <li>Management, if it is ever needed, is at <b>manager.dexie.cloud</b>.</li>
          <li><b>Nothing depends on it continuing to exist.</b> The app is local-first: your data lives on your devices and works offline whether or not the service is reachable. If Dexie Cloud ever went away, the app would carry on exactly as it does now \u2014 you would simply be back to moving a backup file between devices by hand.</li>
        </ul>

        <p><b>None of this replaces your backup file.</b> Syncing keeps two devices matched \u2014 which means a deletion travels too: delete something on the Mac and it goes on the iPhone as well. An exported backup is still the only thing that lets you go back to how it was.</p>

        <h3>Icons: the app's language vs your gear</h3>
        <p>There are two kinds of symbol in the app, and the difference is deliberate.</p>
        <ul>
          <li><b>Line icons</b> — everything the <em>app</em> says. Buttons, flags and badges (charging, liquid, restricted, consumable, not-in-use), the trip-setup tiles, the Care states and the nudges are all drawn in <b>one hand-drawn family</b>, in a single line weight. They're drawn in the current section's colour, so they shift from blue to green to purple as you move around, and they look identical on your Mac, your iPhone and anyone else's device.</li>
          <li><b>Emoji</b> — everything that identifies <em>your stuff</em>. The group headings on a packing list (Clothing, Checked luggage, Golf bag, Morning list), your <b>template covers</b> and your <b>kits</b> stay as colourful emoji, because they name real things and you pick them yourself.</li>
        </ul>
        <p>So a quick rule: <b>a line icon is the app talking; an emoji is your gear.</b> The weather keeps its own coloured glyphs (gold sun, blue rain, cyan snow) wherever a forecast or a forced condition is shown.</p>

        <h3>Creating a trip</h3>
        <p>The <b>Home</b> tab is the builder. Set the trip's conditions, tick any <b>extra activities</b> you're doing, and press <b>Create Event</b> — it generates an editable Event (with its own Packing List) that then lives under the <b>Events</b> tab.</p>
 <p><b>Trip presets.</b> For trips you take often, save the whole setup and reuse it. On any trip, tap <b>Save as preset</b> to remember its recipe — the activities plus every trip setting (trip/quick, transport, season, WET options, forced weather gear, laundry), but not the dates, destination or packed items. Back on <b>Home</b>, a <b>Start from a preset</b> row lets you fill the whole builder in one tap, then just add this trip's name and dates. Manage them under <b>Settings → Trip presets</b>; they ride along in your backups.</p>

        <h3>Template vs Trip preset — what each one actually is</h3>
        <p>They sound alike and they are not alike at all. The one-line version: <b>a Template holds your gear; a Trip preset holds your answers.</b></p>
        <ul>
          <li><b>A Template is a box of things.</b> “Diving”, “Run”, “Travel”, “Golf” — each holds actual <b>items</b>, and each item carries its own detail: quantity, section, which bag it goes in, when to pack it, whether it is a liquid or needs charging. Templates are what the app is <em>made of</em>; they live in the <b>Templates</b> tab and you edit them over the years as your kit changes. Strictly speaking the box holds a <b>link</b> to each item rather than a copy of it — see <em>One item, many templates</em> just below.</li>
          <li><b>A Trip preset is a filled-in form.</b> It contains <b>no items whatsoever</b> — there is nowhere in a preset to put one. What it remembers is the answers you gave on the <b>Home</b> builder. It lives in <b>Settings → Trip presets</b>.</li>
        </ul>
        <p>When you tap <b>Save as preset</b>, exactly <b>eight</b> things are remembered:</p>
        <ol>
          <li>Full trip or quick activity</li>
          <li><b>Which activities you ticked</b> — which is to say, which templates get combined</li>
          <li>Transport</li>
          <li>Time of year</li>
          <li>Context</li>
          <li>Catering</li>
          <li>Any <b>forced weather gear</b> (the WET options you switched on)</li>
          <li>Laundry on or off</li>
        </ol>
        <p>And that is the whole list. The trip's <b>name, dates, destination and everything you had packed are deliberately not saved</b> — those belong to one particular trip, not to a kind of trip.</p>
        <p>So they work at different moments. A preset is <b>spent the instant you press Create Event</b> — it fills the form, the form builds the trip, and the trip has no further connection to the preset. Templates keep working after that: the trip's Packing List <em>is</em> your templates merged, and <b>Save &amp; regenerate</b> on a trip rebuilds it from them again.</p>
        <div class="vs-wrap"><table class="vs-table">
          <thead><tr><th></th><th>Template</th><th>Trip preset</th></tr></thead>
          <tbody>
            <tr><th>Holds items</th><td>Yes — that is the point</td><td><b>None, ever</b></td></tr>
            <tr><th>Lives in</th><td>Templates tab</td><td>Settings → Trip presets</td></tr>
            <tr><th>Still connected after the trip is made</th><td>Yes — regenerate pulls from it</td><td>No — the link ends at Create Event</td></tr>
            <tr><th>Change it</th><td>Every future trip changes</td><td>Nothing changes, anywhere</td></tr>
            <tr><th>Delete it</th><td>The gear list itself is gone</td><td>Only a shortcut is gone</td></tr>
          </tbody>
        </table></div>
        <p>Which explains everything that follows from it:</p>
        <ul>
          <li><b>Add a new head torch</b> to your Diving template and every future dive trip has it. Put it in a preset — you can't; a preset has nowhere to put an item.</li>
          <li><b>Change a preset</b> (or delete it) and <b>nothing anywhere changes</b> — not one existing trip, not one item. You have only changed a shortcut. <b>Delete a template</b> and you have thrown away the gear list itself.</li>
          <li>A preset points at activities <b>by name</b>. Rename or empty a template and the preset still ticks that box — it just brings in whatever that template holds <em>now</em>. So a preset can never go stale in the sense of holding old gear: it has no gear to be old.</li>
          <li><b>Saving a preset under a name you already used replaces it</b> rather than quietly making a second one — the app matches on the name, and asks first.</li>
          <li>You can happily have <b>none</b> of either: no presets at all (fill the form each time), or a trip built from a single template.</li>
        </ul>
        <p><b>A worked example.</b> You have templates called <b>Travel</b>, <b>Diving</b> and <b>Swim</b> — three boxes of gear. You take a Red Sea dive week most winters, so once you've set a trip up the way you like it (transport Plane, season Winter, Diving + Swim ticked, catering half-board, laundry on) you tap <b>Save as preset</b> and call it “Dive week”. Next winter you tap <b>Dive week</b> on Home, type the name and the dates, and press Create Event. The preset supplied the <em>answers</em>; the three <b>templates</b> supplied every single <em>item</em> on the list that comes out.</p>
        <p class="hint">Rule of thumb: if you're thinking about <b>a thing you own</b>, you want a Template. If you're thinking about <b>a kind of trip you take</b>, you want a Trip preset. Both travel between your devices, and both are in your backups.</p>

        <h3>One item, many templates — there is only ever <em>one</em> of it</h3>
        <p>Calling a template “a box of things” is the right picture for what it is <em>for</em>, but it can mislead in one way, so it is worth being exact. An item that belongs to several templates is <b>not several copies</b>. You own <b>one</b> head torch, so the app stores <b>one</b> head torch, and each template holds a <b>link</b> to it. There is no second copy anywhere to drift out of step.</p>
        <p>What that means in practice is a clean split — <b>what the thing IS</b> is shared, <b>how it is packed HERE</b> is local:</p>
        <ul>
          <li><b>Shared everywhere (the object itself).</b> Its name, category, <b>weight</b>, <b>photos</b>, where it is <b>stored</b>, its <b>care / maintenance record</b>, <b>owner</b>, condition, and all the purchase details — brand, model, serial, price, warranty, expiry — plus its flags (liquid, restricted, charging, per-night, consumable). Change any of these on <b>any</b> line, in <b>any</b> template, and every other template shows the change at once. This is the <b>① The item itself</b> panel in its editor, and its heading means exactly what it says.</li>
          <li><b>Local to one template (how it is packed there).</b> Its <b>section</b>, its <b>kit</b>, a per-list <b>bag</b> exception, its <b>“When”</b>, its <b>quantity</b> and <b>note</b>, and the <b>conditions</b> that decide whether it comes on a given trip. These genuinely do differ — the same sports bra can go in the duffel for Run and a pannier for Bike — so they are remembered per template. This is the <b>② In this list</b> panel.</li>
        </ul>
        <p>Which is what decides how <b>Care → All items</b> lists things. An item is shown <b>once</b>, with its templates named on the line — “Sports bra · <em>Bike, Run</em>”. It splits into <b>a line per template</b> only when you sort or group by <b>Container</b>, <b>Section</b> or <b>Template</b>, because those are the only three things that can differ between them, and there the second line is the whole point: it is how you reach the Run half and the Bike half separately. Group by <b>Whose it is</b> or <b>Where it's stored</b> and a second line could only repeat the first, so there isn't one. The count says <b>“431 items”</b>, and mentions lines only in the views that actually have them.</p>
        <p class="hint">A quick way to hold it: <b>an item is a thing you own; a membership is that thing's place in one list.</b> You have one of the first and as many of the second as you have templates it belongs to. Ticking an item into another template adds a link — it never duplicates the item, and it never touches its photos or its care history.</p>
 <p><b>Kits.</b> A <b>kit</b> is a bundle of small things you always pack together — a <b>charging kit</b> (cables, plug, power bank), a <b>wash bag</b>, a <b>first-aid pouch</b>. Build your kits under <b>Settings → Kits</b>: give each a name and an emoji, then search your catalogue to pick its members. Once a kit exists you can add it <b>as one unit</b> in two places — from a <b>template</b> (its <b>Add a kit</b> button, so every trip built from that template includes the whole bundle) or straight onto a single <b>trip</b> (the <b>Kit</b> button on the trip’s toolbar). On the Packing List the kit’s items <b>cluster together</b> under a <b>kit header</b> with a <b>Pack all</b> button, so you tick the whole pouch off in one tap. Need to tweak one trip? Open any item on a trip and use its <b>Kit</b> field to add it to, move it between, or clear it from a kit just for that trip. Kits are included in your backups and automatic snapshots. (Deleting a kit only removes the bundle — items you already added to templates or trips stay put.)</p>
        <ul>
          <li><b>Name, trip dates, destination</b> (the dates and the destination are both optional). <b>Trip dates is one dropdown for the whole trip.</b> Tap it and a calendar opens showing <b>two months side by side</b> (stacked on a phone); tap the day you <b>leave</b>, then the day you <b>come back</b>, and it closes itself. The days in between fill in as you go — on the Mac the range even previews under the mouse — so you can see how long the trip is before you commit. Tapping a day <em>earlier</em> than the start simply begins the range again there, and tapping the <b>same day twice</b> gives you a <b>day trip</b> (0 nights). <b>Clear</b> empties both ends; <b>Today</b> brings the calendar back to this month. You never count nights yourself — the app does it and shows the total live, both in the field and under it.</li>
 <li><b>Time of year, catering, context</b> narrow the list; the <b>nights between your start and end date</b> drive per-night quantities (e.g. socks ×6 for six nights). Tick <b>Laundry available</b> to cap those per-night items at ${LAUNDRY_CAP_NIGHTS} — so a long trip doesn’t demand a dozen (short trips are unaffected); capped items show a small by their ×count.</li>
          <li>The <b>start date</b> also decides where a trip sorts on Home and the Events tab — nearest upcoming first, then undated drafts, then past trips.</li>
        </ul>

        <h3>Where the packing list comes from <em>(three sources)</em></h3>
        <p>Every trip's list is built from three sources — you never start from a blank page, and you never have to remember the basics:</p>
        <ul>
          <li><b>1. Your common base — always included.</b> There's one always-on base template (currently named <b>“Travel”</b>) holding everything you need on <em>any</em> trip: clothes, toiletries, documents, everyday electronics and chargers. It's added to every Packing List automatically, so you can't forget your underwear because you picked the wrong option. You never tick it; to change what's in it, edit the <b>Travel</b> template in the <b>Templates</b> tab.</li>
          <li><b>2. Your transport's own kit — added by the “Way of transport” radio.</b> Each of <b>Car / Plane / RV</b> has its own base template, and picking one <b>automatically pulls its whole kit in</b>. Choose <b>RV</b> and the full motorhome kit (levelling chocks, water hose, gas, awning, kitchen…) comes along — no extra step, no separate tick. <b>Plane</b> adds the carry-on-rules stuff (liquids bag, travel documents, power bank / spare batteries that must fly in the cabin); <b>Car</b> adds a few road extras (car charger, phone mount, snacks). Each is editable in the <b>Templates</b> tab, so you can grow them over time. This replaces the old “Start from” shortcut: the transport radio <em>is</em> the shortcut now.</li>
          <li><b>3. The activities you tick.</b> Under <b>Activities to pack for</b> — which sits directly under <b>List type</b>, since the two together are what the trip is <em>for</em> — you tick your <b>GA</b> (Goal Activity — Golf, Hiking, Diving…) and <b>WET</b> (Workout, Exercise &amp; Training — Swim, Bike, Run…) templates. Only these need ticking; the base and transport templates are already in, which is why they don't appear in that picker.</li>
        </ul>
        <p>So a plain RV holiday needs <em>zero</em> ticks — just pick <b>RV</b> — and you get the common base + the whole RV kit. Add a round of golf by ticking <b>Golf</b>, and its clubs and shoes join the same list.</p>

        <h3>Full trip vs. Quick activity</h3>
        <p>At the top of the builder is a <b>List type</b> switch, because sometimes you don't want a whole trip — you just want to grab a bag for one activity:</p>
        <ul>
 <li><b>Full trip</b> <em>(default)</em> — the three sources above: common base + transport kit + the activities you tick. For real trips.</li>
 <li><b>⏱ Quick activity</b> — <b>only the activities you tick</b>, with <b>no common base and no transport kit</b>. The transport and catering choices disappear because they don't apply. Tick <b>Swim</b> (or <b>Run</b>, or both) and you get just those 5–20 items — perfect for “I'm off for a swim.” Set <b>Context</b> to <b>Indoor</b> or <b>Outdoor</b> to trim it further (e.g. an outdoor run adds a headlamp and sunscreen; indoor doesn't). Quick events show a small <b>⏱ Quick</b> tag on their card.</li>
        </ul>

        <h3>How the Packing List is composed</h3>
        <p>The Event takes the union of every item from the sources for your chosen <b>List type</b> — a <b>Full trip</b> uses common base + transport template + ticked activities; a <b>Quick activity</b> uses only the ticked activities — then drops anything whose conditions (season, catering, context) don't match the trip, and de-duplicates by name + container (earlier sources win a clash, so the common base takes priority). Weather-conditional items are held back (see below). The result is your editable <b>Packing List</b> — add, edit, tick, or remove any line.</p>

        <h3>Opening a trip — the readiness dashboard</h3>
        <p>Every trip opens with a small <b>readiness</b> summary at the very top, so you can see how ready you are at a glance before you scroll into the list:</p>
        <ul>
          <li>A <b>progress ring</b> showing how much is packed — e.g. <b>43% · 3/8</b> — filling up as you tick items and turning <b>green</b> when everything's in.</li>
          <li><b>Days to go</b> — the countdown to your start date (it highlights when the trip is within a week; it shows “no date set” if you haven't given one).</li>
          <li><b>Weight</b> — the total packed weight; it turns <b>red</b> and tells you how many bags are <b>over limit</b> if any bag is too heavy. (Add weights to items to make this exact — see <b>Bags &amp; weight</b>.)</li>
          <li><b>Open to-dos</b> — how many <b>Actions</b> are still open; tap it to jump to the Actions tab.</li>
        </ul>
 <p>The big <b>Start / Continue packing</b> button sits right underneath, opening <b>Packing Mode</b> at the first phase that still has unpacked things. Below the dashboard is a <b>Trip setup</b> panel that recaps every choice you made when creating the trip (type, dates, destination, transport, season, catering, laundry, forced weather and the activities you ticked) — a read-only reminder of what this list was built from. The <b>WET options</b> (Indoor / Outdoor / Race) sit indented under the WET activities they qualify, at the foot of that panel, exactly as they do on the Create Event form.</p>

        <h3>Quick actions on a trip</h3>
 <p>Some things you only want to do to a <em>whole</em> trip. <b>Long-press</b> a trip card on the <b>Events</b> tab (or <b>right-click</b> it on the Mac), or tap the <b>⋯</b> button in a trip's own header, and a short menu appears:</p>
        <ul>
 <li><b>Mark everything packed</b> — takes the list straight to <b>100%</b> in one tap. Use it for a trip you actually packed away from the app, or an old trip you simply want on record as done rather than sitting there half-ticked forever. The list itself is untouched, so it stays fully readable afterwards.</li>
          <li><b>Clear every tick</b> — the opposite, for starting the packing again (it asks first).</li>
          <li><b>Rename</b>, <b>Trip settings</b> and <b>Share</b> — the same actions as in the trip's header, gathered in one place.</li>
 <li><b>Delete this trip</b> — removes the trip and its packing list. It asks first, it cannot be undone here, and if you're signed in to sync the trip disappears from your other devices too. Your <b>templates, items and to-dos are untouched</b> — only this trip's list goes.</li>
        </ul>

        <h3>Reading &amp; organising the list</h3>
        <ul>
          <li><b>Group by</b> When / Where / Category — same list, several lenses — plus <b>GA</b> and <b>WET</b> (each appears once a trip packs for that kind of activity), which group the list by the <em>activity each item came from</em>: pick <b>GA</b> to see <b>Golf, Hiking, Diving…</b> each in their own block, or <b>WET</b> for <b>Swim, Bike, Run…</b>, so you can round up one activity's kit at once — everything not specific to that activity (your common base, transport kit, other activities and hand-added items) gathers under <b>Everything else</b>. There's also <b>Section</b> (once a trip has sectioned items) and <b>Stored</b> (once items have a storage place), which groups by <em>where each thing lives at home</em> so you can empty one cupboard at a time. <b>Tap any group heading to fold it shut</b> (and again to reopen) — handy for hiding a bag you've finished packing; each heading shows a <b>packed/total</b> count.</li>
 <li><b>Sort out</b> — quick filters above the list isolate all <b>Liquids</b> (for the wash bag / 100 ml rule) or all <b>Charge</b> items (to round up cables and chargers). Tap a chip to show only those; tap <b>Show all</b> to bring the full list back. Ticking and editing work the same in the filtered view. Mark an item as a liquid or charge item with the / toggles in its editor.</li>
 <li><b>Heaviest</b> — reorders the list heaviest-first with each item’s weight shown, so when a bag is over its limit you can see at a glance what to leave behind. It uses the real load (weight × quantity, including per-night scaling); items without a weight sit at the bottom. Combine it with a Liquids/Charge filter to rank just those. Add a weight to an item in its editor to make it count.</li>
          <li><b>Tap an item</b> to open a quick editor for this trip’s bits (Qty, Category, Container, When, weight, flags, note). For the item’s deeper settings — conditions, which templates it’s in, storage &amp; maintenance — tap <b>Edit the full item</b> to jump straight into the full item editor, then use Back to return to your trip. If the item was only added to this one trip, the same button offers to <b>add it to a template first</b> (you pick which) so it’s saved for reuse — then opens its full editor.</li>
          <li>A small <b>colour dot</b> before each item marks its <b>category</b> (clothing, electronics, toiletries…), so a long list scans by hue. Badges show flags at a glance; quantities marked per-night show the scaled count (e.g. Socks ×6 for a 6-night trip). Ticking an item gives a small pop and a gentle buzz, and the readiness ring fills in as you go.</li>
          <li><b>Regenerate</b> refreshes the Packing List from your templates while keeping your ticks, edits and manually-added items.</li>
        </ul>

        <h3>Bags &amp; weight</h3>
 <p>The <b>Bags &amp; weight</b> panel totals each container's weight against typical airline limits (carry-on 8 kg, checked 23 kg…), warns when a bag is over, and counts liquids and restricted items. Totals only cover items you've given a weight.</p>

        <h3>Care, storage &amp; maintenance</h3>
        <p>Every item can carry a few extra things about the <em>physical object</em>, set in its editor (in the <b>Templates</b> tab) — its <b>photos sit right beside the item name</b>, while where it's stored and how to look after it live in the <b>Storage &amp; maintenance</b> panel below:</p>
        <ul>
 <li><b>Where it's stored</b> — pick the item's home from a <b>dropdown</b> of places (Bedroom wardrobe, Garage, Loft / attic, Storage box, RV / camper…), or choose <b>＋ Add a new place…</b> to type your own. It shows on the item, travels onto any trip it lands in, and appears in <b>Packing Mode</b> with a pin so you know exactly where to grab it. Manage the whole list — add, <b>rename</b>, remove or <b>reorder</b> places — under <b>Storage places</b> in <b>Settings</b>. <b>The order you put them in there is the order in this dropdown</b>, so the two or three places you actually use can sit at the top instead of wherever the alphabet puts them.</li>
 <li><b>Photos</b> (beside the name) — snap or pick <b>up to ${MAX_PHOTOS} pictures</b> of the item; each is shrunk and stored <b>on your device</b> (never uploaded). Tap a thumbnail to enlarge it, or the to remove it. Handy to recognise the right gear — the first one shows as a thumbnail in the Care list, with a small count when there's more than one. Pictures are kept in their own place and the item just points at them, so your lists and backups stay quick; if you ever want to reclaim space, <b>Settings → Your data → Tidy up photos</b> frees any picture nothing uses any more.</li>
          <li><b>Maintenance</b> — how and how often to look after it: a <b>maintenance cadence</b> (monthly … every 2 years, or a custom number of days), when it was <b>last done</b>, free-text <b>how-to notes</b> (steps, products, settings), and a <b>how-to link</b>. Tap <b>Log done today</b> to record a service — it resets the schedule and adds a dated entry to the item's maintenance history.</li>
          <li><b>Details &amp; ownership</b> (a second panel, all optional) — record what the thing <em>is</em> and who owns it: <b>colour</b>, <b>size</b> and <b>manufacturer</b> (dropdowns that grow as you use them, or “＋ Add new…”), <b>model</b>, <b>owner</b> (a dropdown of your <b>Owners</b> list — see <b>Settings → Owners</b> — with <b>＋ Add an owner…</b> to name a new one on the spot and <b>⚙ Manage owners…</b> to rename or remove one without leaving the item; an owner is <em>not</em> a Person, so “Shared” or “The kids” can own things without appearing in every “Packed by” picker), <b>condition</b>, <b>quantity owned</b>, <b>price</b> + <b>currency</b>, a <b>purchase / reorder link</b>, and the <b>acquired</b>, <b>warranty-until</b> and <b>expiry / replace-by</b> dates. Since each item lives once in the catalog, these belong to the item itself — set once, the same everywhere it appears.</li>
 <li><b>Not in use</b> (in the same panel) — tick this to <b>retire</b> an item you no longer pack (sold, broken, destroyed, replaced or lost — pick the <b>reason</b> from the dropdown). The item is <b>kept exactly as it is</b> — photos, care record, history and template memberships all stay — but it is <b>never added to a new trip</b>, so old gear stops cluttering your packing lists. It still appears in your template and Care lists, <b>greyed out</b> with a <b>Not in use</b> tag, and the new <b>Not in use</b> filter chip rounds them all up. (This is different from <b>Item condition</b>: “Needs replacing” is a thing you still pack; “Not in use” is one you’ve stopped packing.) Trips you’ve already built are left untouched.</li>
        </ul>
        <p>The <b>Care</b> tab then gathers everything with care info across all your lists, under the heading <b>Maintenance list</b> (below the Containers / All items / Shopping links at the top, and above the <b>All items</b> browser at the bottom). It shows two ways:</p>
        <ul>
 <li><b>List</b> — grouped by urgency: <b>Overdue</b>, <b>Due soon</b> (within ${MAINTENANCE_SOON_DAYS} days), <b>Upcoming</b> (the next ${MAINTENANCE_UPCOMING_DAYS} days), then two <b>folded</b> groups — <b>Later</b> (anything further out) and <b>Reference only</b> (care notes but no schedule). The two folds are what stops a big catalogue burying the handful of things that actually need doing: tap a fold to open it, and it stays as you left it next time. Each row shows the photo, where it's stored and when it's next due; tap it to read the how-to notes, open the how-to link, and see its maintenance history. Hit <b>Done</b> to log a service in one tap.</li>
          <li><b>Calendar</b> — a month view with each scheduled service on its due date, colour-coded by urgency and dotted with a count; tap a day to see (and tick off) what's due. Overdue items are flagged above the grid.</li>
        </ul>
 <p>Only items you give care info to appear in those two views — your everyday clothes and toiletries stay out of it. When something's overdue or due soon, a <b>reminder</b> also shows on the <b>Home</b> screen.</p>
 <p>Below that sits <b>All items</b> — a searchable index of <b>every item in every template</b>. Type a name (or a storage place) to filter, then tap a result to jump <b>straight into that item's editor</b> with its <b>Storage &amp; maintenance</b> panel already open — the quickest way to add or update care info without hunting through the Templates tab. Under the search box, <b>quick-filter chips</b> let you isolate a whole category at once — <b>No template</b> (loose items), <b>Liquids</b>, <b>Charging</b>, <b>Restricted</b>, <b>Has care</b>, <b>Photo</b> and <b>Not in use</b>; tap several to combine them, and keep typing to narrow further. The <b>＋ New item</b> button creates an item in any template you pick — or choose <b>“No template · keep as a loose item”</b> to drop it straight into the Loose items bin — and takes you into editing it right away.</p>
 <p>Below the category chips sit two more filter rows, <b>Item condition</b> and <b>Section</b>, which appear whenever they’d actually split the collection. The rule is worth knowing: chips <b>in the same row</b> mean “either of these”, and the <b>rows combine</b> — so <b>Liquids</b> with <b>Worn</b> gives you liquids that are worn, not liquids plus worn things. Each chip’s number is what you’d get if you tapped it, counted against the filters already on, and <b>Show all</b> clears every row at once. (One item that lives in three templates is three rows here — that’s why a section, which belongs to a template, can be filtered at all.)</p>
 <p><b>Sort</b> reorders the whole index — <b>Alphabetically</b>, <b>Container</b>, <b>Where it’s stored</b>, <b>Weight</b>, <b>Manufacturer</b>, <b>Acquired</b>, <b>Warranty until</b> or <b>Section</b> — and <b>▲/▼</b> flips the direction. Anything with that field left blank <b>always sinks to the bottom</b>, whichever direction you choose, so “Manufacturer, Z–A” shows you makers rather than three hundred blanks. <b>Group</b> then breaks the list into headed, <b>collapsible</b> sections — by <b>Container</b>, <b>Where it’s stored</b>, <b>Section</b>, <b>Manufacturer</b>, <b>Item condition</b>, <b>Template</b>, <b>Category</b>, <b>Whose it is</b>, <b>Care status</b> or <b>First letter</b> — each showing how many it holds, with your sort still applying inside each one and the “not set” bucket always last. Tap a group’s header to fold it away. Sort and grouping are <b>remembered on this device</b>; the filter chips deliberately are not, so the index always opens showing everything.</p>

        <h3>Actions — your to-do list</h3>
        <p>The <b>Actions</b> tab (the red one in the bottom bar) is a proper <b>to-do list</b> for the things you need to <em>do</em>, not pack. Actions come in two kinds:</p>
        <ul>
 <li><b>Tied to an item</b> — open any item’s editor (in the <b>Templates</b> tab) and use its <b>Actions · to-dos</b> panel to jot things to do for it: “replace foam tips”, “re-wax the zip”, “charge before the trip”. Because each item lives once in the catalogue, its actions follow it everywhere, and the item’s row shows a small <b>count</b> of its open to-dos.</li>
          <li><b>General (loose)</b> — on the Actions tab tap <b>New</b> to add a to-do that isn’t about any one item (you can still tie it to an item later from that item’s editor).</li>
        </ul>
 <p>Every action can carry a <b>priority</b> (High / Normal), a <b>when</b> (a trip phase like “≥1 week ahead”, or a specific <b>date</b>), and a tick to mark it <b>done</b>. The Actions tab gathers them all in one place — open ones first (High before Normal, soonest first) — with completed ones tucked into a collapsible <b>Done</b> group. Ticking an item’s action done is <b>permanent on that item</b>; it doesn’t reset each trip. Actions live on-device and travel in your <b>JSON backup</b>, and whenever anything is open a <b>“To-dos to tackle”</b> card appears on the <b>Home</b> screen.</p>

        <h3>Shopping list</h3>
 <p>A separate <b>Shopping list</b> (on the <b>Care</b> tab) rounds up what to <b>buy or restock before a trip</b>. It suggests three kinds of thing automatically: items you flag as a <b>Consumable</b> in their editor (things you use up — sunscreen, toothpaste, energy gels, a gas canister), items whose <b>Item condition</b> you’ve set to <b>Needs replacing</b>, and anything past or within a month of its <b>replace-by / expiry date</b>. Tap <b>＋ Add</b> beside a suggestion to move it onto your buy-list, or the <b>Add</b> button for a one-off like “travel adapter”. <b>Tick</b> a line once you’ve bought it — bought things drop into a collapsible group. It’s built on the same store as your to-dos (so it’s in every backup), and a <b>“Shopping list — N to buy”</b> nudge shows on <b>Home</b> whenever something’s waiting. Your <b>Actions</b> tab stays purely to-dos; shopping keeps its own screen.</p>

        <h3>Countdown &amp; “pack now” nudges</h3>
 <p>With a start date set, each event shows a countdown, and a ⏰ banner surfaces the earliest phase that's due (based on how many days each phase is normally packed before departure). The <b>Home</b> screen also gathers a small set of reminder cards whenever they apply: the trip <b>⏰</b> pack-now nudge, a <b></b> maintenance nudge when gear is overdue or due soon, a <b>shopping</b> nudge when you’ve things to buy, a <b>“To-dos to tackle”</b> card counting your open actions (and calling out how many are high-priority), and a <b></b> backup reminder when it’s been a while since your last export. These are on-open reminders — the app can't push background notifications.</p>

        <h3>Packing Mode</h3>
 <p>A focused, full-screen flow that walks you through one phase at a time with big tap-to-pack rows, live counters, and an “All packed” finish. It opens at the first phase that still has unpacked items and shares tick state with the Packing List.</p>
 <p><b>Fixing something mid-pack.</b> Tapping the row itself always means “packed” — that's the whole point of this screen — so editing has its own small <b>pen</b> at the right-hand end of each row. Tap it and the quick editor opens in place: quantity, which bag, when, section, kit, who packs it, weight, the flags and a note. <b>Save</b> and you're back in Packing Mode at the same phase, right where you were. Need more than that? The editor's <b>Edit the full item</b> button opens the item's full editor (conditions, templates, storage &amp; care, photos) — and saving <em>there</em> also brings you straight back here, so a detour never costs you your place. A row you're editing stays on screen even if you tick it.</p>

        <h3>Who packs what</h3>
        <p>Packing with someone? First set up your <b>People</b> in <b>Settings → People</b> — each with a name and a colour (Martin &amp; Anna are there to start; add, rename or recolour anyone). Then on a trip, open an item and choose <b>Packed by</b>. Assigned items carry a little <b>colour dot</b>, and a <b>“Who packs”</b> chip row appears at the top of the packing list so you can show <b>Everyone</b>, just one person, or the still-<b>Unassigned</b> items (each with a count). The same filter sits atop <b>Packing Mode</b>, so each of you can pack only your own things. It’s per-trip, and it <b>travels inside a shared trip</b> — send the trip to someone and the items you gave them arrive marked as theirs (a name that isn’t on their People list still shows, just with an auto-picked colour). Renaming a person carries the new name onto every trip they’re already on.</p>

        <h3>When — the stages of a pack</h3>
        <p>Every item carries a <b>When</b>: the stage of the pack it belongs to. It is what your packing list is grouped by, and what <b>Packing Mode</b> walks you through one step at a time. The app starts with seven — <b>Preparations</b>, <b>≥1 week ahead</b>, <b>Day before</b>, <b>Morning list</b>, <b>At the front door</b>, <b>Wear / carry on the day</b> and <b>After / recovery</b> — but the list is <b>yours</b>, in <b>Settings → When</b>. Rename them by typing straight over the name, give each one an <b>emoji</b> and a <b>colour</b>, move them up and down the timeline with <b>▲ ▼</b>, remove ones you never use, or add your own — “Load the car”, “Night before the flight”.</p>
        <p><b>Days ahead</b> is when that stage starts nudging you: set it to 7 and the app begins asking you to pack it a week before you leave. <b>-1</b> means after the trip, which is what <b>After / recovery</b> uses. The <b>to-dos</b> tick marks a stage that holds things to <em>do</em> rather than things to pack — that is what makes <b>Preparations</b> behave differently from the rest.</p>
        <p><b>Nothing can be lost by any of this.</b> Renaming keeps every item exactly where it was — the app remembers a phase by a hidden name that never changes, so only the words you read are different. Removing a stage that things are filed under makes you say <b>when those things get packed instead</b>, and tells you how many there are — counting your items, the lines on trips you have already built, and your to-dos. There is a <b>Reset to the standard seven</b> if you want the original timeline back.</p>
        <p><b>This list syncs between your devices</b> — it was the first of the Settings lists to do so, and since v120 your Item conditions, Trip presets, People, Owners and Storage places travel with it. A stage is stamped on every item, so one that existed on only a single device would make the same item read as a different “When” there. Change the timeline on the Mac and the iPhone follows. While one device is still on an older version, anything it doesn't recognise is shown as-is and <b>never quietly moved</b>.</p>

        <h3>Whose things are whose</h3>
        <p><b>Owner</b> — on an item, under <b>Details &amp; ownership</b> — is a dropdown of a list you keep in <b>Settings → Owners</b>. <b>Add</b> a name, <b>rename</b> one (every item that is theirs follows, in one go) or <b>remove</b> one — and if things are theirs, the app asks <b>who they go to</b> first, so an item is never left pointing at somebody who no longer exists. Each name shows how many items are theirs, and the list is ordered <b>biggest owner first</b> so you can see at a glance whose most of the kit is (the dropdowns stay A–Z — there you already know the name you're after). You never have to go to Settings to do it: the same two choices, <b>＋ Add an owner…</b> and <b>⚙ Manage owners…</b>, sit at the bottom of the Owner dropdown itself — in the item editor and in <b>Care → All items · table</b>, where you can assign owners down a whole column.</p>
        <p><b>Owners are not People.</b> <b>People</b> is who <em>packs</em> on a trip; <b>Owners</b> is who <em>owns</em> the thing at home. Keeping them apart means “Shared”, “The kids” or “The RV” can own gear without ever appearing in a “Packed by” picker. Your People are offered as owners to start with, but naming an owner never creates a person.</p>
        <p><b>The Owners list travels between your devices</b> (since v120), along with People, Storage places, Item conditions and Trip presets — add a name on the Mac and the iPhone has it. The owner <em>on an item</em> has always travelled with your data, which is why this list could heal itself even before that: a name given on the other device is offered in the dropdown as a name in use, whether or not the roster itself has caught up yet.</p>

        <h3>Weather (optional, per trip)</h3>
        <p>Add a <b>destination</b> to a trip, then tap <b>Get forecast</b>. The forecast comes from Open-Meteo (free, no account), is cached on the trip so it still shows offline, and only fetches when you ask and you're online.</p>
        <ul>
          <li>A <b>temperature chip</b> in the trip header and a <b>7-day strip</b> with icons and highs/lows; rainy days are highlighted.</li>
          <li><b>Weather-conditional gear:</b> tag an item (in its editor) with Rain / Cold / Heat / Wind / Snow to make it “conditional”. Conditional items are kept <i>out</i> of the normal list and only offered when the forecast calls for them — so your rain suit stops cluttering every trip.</li>
          <li><b>Force-pack weather gear (per trip):</b> in an event’s settings, tick a condition under <b>Force-pack weather gear</b> to pull in <i>all</i> gear tagged for it straight away — no forecast or destination needed, and regardless of the season. This is the “just in case” switch: force in your cold-weather kit for a summer high-altitude hike, or a rain layer as a precaution on a sunny trip.</li>
          <li>When the forecast triggers a condition, a <b>suggestion banner</b> offers matching gear — <i>your own</i> tagged items first (with their real bag and category), then a few generic add-ons — with <b>Add all</b>.</li>
          <li><b>Pack weather gear anyway:</b> a panel that lets you add any of the trip's weather gear regardless of (or without) a forecast — e.g. a rain shell as a backup layer on a dry day. Items added this way keep their bag/category and fold into trip-review stats.</li>
        </ul>

        <h3>Trip review &amp; Refine (learning)</h3>
        <p>After a trip, open <b>Trip review</b> and mark what you didn't use. The app remembers, per item, how often it was packed vs actually used. <b>Refine</b> (from the Templates tab) then suggests dropping items you keep packing but never use — you decide Keep or Drop.</p>

        <h3>Sharing a trip</h3>
        <p>From a trip, tap <b>Share</b>. The whole trip — its full packing list — travels inside a file or a link; nothing is uploaded. The other person opens the link (it imports on its own) or imports the file from Settings. Every import becomes a fresh, unpacked copy.</p>

        <h3>Spreadsheet export</h3>
        <p><b>Excel</b> exports a trip as an .xlsx (phase, container, item, qty, packed, note). Settings can export every event at once.</p>

        <h3>Item conditions — grading the gear you own</h3>
 <p>Every item can carry an <b>item condition</b>, set in its editor under <b>Details &amp; ownership</b>. The app starts with four — <b>New</b>, <b>Good</b>, <b>Worn</b>, <b>Needs replacing</b> — but the list is <b>yours to change</b>, in <b>Settings → Item conditions</b>. Rename them, drag them into the order you want (that order is the order in every dropdown, and the order the Care tab groups by), remove ones you never use, or add your own — “Failing”, “Borrowed, must return”, “Being repaired”.</p>
 <p class="hint"><b>Why the longer name?</b> The app uses the word “condition” for two different things, and they’re easy to mix up. An <b>item condition</b> says <b>how worn a thing is</b> — it never affects what gets packed. An item’s <b>“only include this item when…”</b> rules (season, transport, catering, weather) decide <b>whether the thing comes on a trip at all</b>. Same word, opposite jobs, so the grading one is spelled out in full wherever it appears.</p>
        <p>Two things make a condition do work rather than just sit there, and both are yours to set per condition:</p>
        <ul>
 <li><b>Badge</b> — whether the rating shows on item rows, and how loudly: <b>no badge</b> (quiet, which is right for New and Good), an <b>amber</b> one, or a <b>red</b> one. Healthy gear stays unbadged so the ones that need attention stand out.</li>
 <li><b>Needs replacing</b> — tick this and the condition means “this wants replacing”: items on it get the replace prompt and are <b>offered on the shopping list</b>. It starts on <b>Needs replacing</b>, but it isn’t tied to that name — tick it on a condition you invented and that one feeds the shopping list too. Tick it on more than one if that’s what you mean.</li>
        </ul>
 <p><b>Renaming is always safe</b> — your items keep their rating, they just call it something new. <b>Removing</b> one asks first: if any items are using it, the app tells you how many and makes you say what they become (another condition, or unrated) before it removes anything. Nothing is ever silently unrated. <b>Reset to the standard four</b> puts the original list back.</p>
 <p>If you use both your Mac and your iPhone: <b>since v120 the condition list travels between them</b>, so a condition you invent on the Mac is on the iPhone with its proper name. Before that it did not, and this was the list it hurt most — an item carries the condition’s internal name and that always travelled, but only the list holds the readable one, so “Failing” arrived as unreadable text. Even then nothing was ever lost: the app deliberately <b>never rewrites a rating it doesn’t recognise</b>, which is also what lets a device still on an older version sit alongside one that isn’t.</p>

        <h3>Finding your way round Settings</h3>
        <p>Settings is an <b>index</b>: every section is one line showing what’s inside it — <em>People: Martin, Anna</em>, <em>Storage places: 12 places</em>, <em>Backed up today — still current</em> — so you can see the state of everything without opening a thing. Tap a line to unfold it. Whatever you leave open <b>stays open next time you come back</b>, so the sections you use often can simply live open.</p>
        <p>Each section has its <b>own colour and icon</b>, fixed for good, so you come to know them by sight rather than by reading. Closed, the colour sits in the little icon tile; <b>open, it takes over the panel</b> — the tile fills in, and the heading, the edge and a faint wash of the background all follow — so you always know which section you are inside. The colour is an <em>identity</em>, not a warning light: it never changes to tell you something is wrong. When something does need attention, the app says so in words, and on the Home screen.</p>
        <p>It runs in the order you actually need it. <b>Your packing setup</b> comes first — <b>Kits</b>, <b>People</b>, <b>Owners</b>, <b>When</b>, <b>Storage places</b>, <b>Item conditions</b>, <b>Trip presets</b> and <b>Shared trips</b> — because that is what you come here to change. Then <b>Appearance</b>. Then <b>Your data</b>: <b>Sync your devices</b>, <b>Backup &amp; restore</b> and the <b>Automatic backups</b> — as important as anything in the app, but things you set up once and rarely touch, which is why they sit low rather than first. Finally <b>Help &amp; about</b>, holding this guide, the version history, the diagnostics log and the About note. The <b>database overview</b> stays pinned at the very top.</p>

        <h3>Your data &amp; privacy</h3>
        <p>Everything lives <b>on this device</b> (IndexedDB) and the app works fully offline as an installed PWA. The only thing that ever leaves your device is the weather lookup: when you tap Get forecast, the destination and its coordinates go to Open-Meteo to fetch the forecast — nothing else, and only then.</p>
 <p><b>Keeping it safe.</b> Because the data lives in the browser, protect it three ways: <b>(1) Install the app</b> — iPhone: Share → <b>Add to Home Screen</b>; Mac: File → <b>Add to Dock</b> — installed apps get protected storage that isn’t auto-deleted. <b>(2)</b> The app also asks the browser to mark its storage <b>persistent</b> on launch, and shows in <b>Settings → Your data</b> whether that’s active. <b>(3) Back up regularly</b> — <b>Settings → Save backup file</b> saves a file you own; keep it in Files / iCloud Drive, and use <b>Import backup</b> to restore. The file is <b>complete</b>: every item detail and <b>photo</b>, all templates and trips, and your custom <b>Storage places</b>. A backup file is the real insurance if a browser ever clears its data, and it’s also how you move your data to another device or web address.</p>
        <p><b>The backup reminder, and why it nags.</b> Other browsers let an app write a backup file into a folder on your Mac by itself, silently, for ever. <b>Safari does not</b> — and Safari is where your packing list lives. So the app does the next best thing: instead of saving quietly behind your back, it <b>asks, and gets more insistent until you do it</b>. On the Home screen you’ll see an amber <b>Back up your data</b> card once you have unsaved changes and your last file is more than <b>${BACKUP_DUE_DAYS} days</b> old; past <b>${BACKUP_URGENT_DAYS} days</b> it turns <b>red</b> and says so plainly. Its <b>Save backup now</b> button does the whole job on the spot — no trip to Settings — and drops a dated file straight into your <b>Downloads</b> folder. The <b>×</b> hides it for a week while it’s amber, but only until <b>tomorrow</b> once it’s red, so a badly out-of-date backup can’t be waved away indefinitely.</p>
        <p>Two things make the reminder honest rather than annoying. It counts <b>changes, not days</b>: if you haven’t touched anything since your last file, it stays silent however long that was — and it speaks up after a busy fortnight even though that feels recent. And <b>Settings → Your data</b> now tells you which of the two you are, saying either “nothing has changed since, so it’s still current” or “you’ve made changes since”. A date on its own was misleading: “3 days ago” looks perfectly safe even when you’ve built a whole trip since.</p>
        <p><b>Automatic backups.</b> On top of the file backups, the app quietly keeps recent <b>copies of your data on this device</b> — about one a day, and always one <b>just before any restore</b> — so a mistaken edit, an accidental delete or a wrong import is easy to undo. They’re in <b>Settings → Your data → Automatic backups</b>, each labelled with when it was taken and what it holds; tap <b>Restore</b> on any copy, or <b>Save a copy now</b> whenever you like. This safety net is careful never to record an empty database over real data and never to clear your richest copy. And when you tap <b>Import backup</b>, the app now <b>shows exactly what’s in the file</b> — items, templates, trips, photos and the date — before changing anything, warning you first if a Replace would wipe most of your data. These on-device copies protect against mistakes; a saved backup <b>file</b> is still your insurance against losing the device itself.</p>

        <h3>Maintenance mode — the whole-database overview</h3>
 <p>At the top of <b>Settings</b>, <b>Maintenance mode — database overview</b> opens a single <b>one-line-per-item</b> table of your <b>entire catalogue</b> — the quickest way to keep everything current without hopping between templates. Each row shows the <b>item</b> and its category, <b>which templates it belongs to</b> (tap a template name to jump there), its <b>flags</b> — <b></b> charging (and the plug type), <b></b> liquid, <b></b> restricted, <b></b> per-night, <b></b> short list, <b></b> care, <b></b> photo, <b></b> not in use — plus its <b>weight</b> and <b>where it’s stored</b>. <b>Tap any row</b> to open that item’s editor. <b>Search</b> by item, template or storage; use the same <b>category chips</b> from the Care tab to narrow; and <b>sort</b> by <b>A–Z</b>, <b>Heaviest</b>, <b>Most used</b> (in the most templates) or <b>Category</b>. The page also <b>finds probable duplicates</b> — same or very similar names (e.g. “Sunglasses” and “Sun glasses”) — listing them in a <b>Possible duplicates</b> panel and highlighting them in the table; it never merges anything for you, so you can open each and rename or remove as you see fit. <b>Export (Excel)</b> saves the whole overview as a spreadsheet for review on a computer.</p>

      </div>
    </details>
  </div>`);
}

// Extensive version history. Versions are the app's internal release tags (the
// offline-cache version). Times are UTC; only v15 onward is exact — earlier
// build times weren't logged, so they're marked approximate.
function versionHistoryCard() {
  const v = (ver, when, approx, title, desc, benefit) => `<div class="vh-item">
    <div class="vh-head"><span class="vh-ver">${ver}</span><span class="vh-when">${when}${approx ? ' <em>(approx.)</em>' : ''}</span></div>
    <div class="vh-title">${title}</div>
    <p>${desc}</p>
    <p class="vh-benefit"><b>Main benefit:</b> ${benefit}</p>
  </div>`;
  const items = [
    v('v128', '2026-08-26 · 18:00 UTC', false, 'An item shows once on All items — and the guide explains why it ever showed twice',
      '<b>The duplicate lines are gone.</b> On <b>Care → All items</b>, an item in several templates was drawn <b>once per template</b> — “Sports bra” twice, marked Bike and Run. Nothing was ever duplicated in your data, but the screen made it look that way, and you have now said so three times (v108, v121 and again today). v121 fixed the <em>counter</em> to read “431 items · 538 lines”; that explained the extra lines rather than removing the ones that should never have been there. Now an item appears <b>once</b>, with its templates named on the line — <b>“Bike, Run”</b> — and the count simply says <b>“431 items”</b>.<br><br>The second line was not <em>always</em> pointless, so it has been kept exactly where it earns its place. <b>Only three things about an item can differ between templates</b>: which <b>bag</b> it goes in (a template may override it), its <b>section</b> (a section belongs to one template), and the <b>template</b> itself. Sort or group by any of those three and the item still splits into a line per template — that is how you reach the Run half and the Bike half separately, and the count says how many lines. Group by <b>Whose it is</b>, <b>Where it’s stored</b>, <b>Item condition</b>, <b>Category</b>, <b>Care status</b>, <b>Manufacturer</b> or <b>First letter</b> and you get one line each, because those belong to the <em>object</em> — a second line could only ever repeat the first, word for word but the template name. That was the whole problem: you were grouping by <b>Whose it is</b>, where the two rows were identical. An item in more than three templates shows the first three and a <b>+2</b>; the full list is in its editor. <b>Nothing about your data changed</b>, and editing an item on any line still updates it everywhere.<br><br>Two guide sections went in alongside it. <b>(1) Template vs Trip preset</b> — the section added in v125 now says exactly what a preset holds instead of describing it in prose. When you tap <b>Save as preset</b>, <b>eight</b> things are remembered and they are now listed one by one: trip or quick, <b>which activities you ticked</b>, transport, time of year, context, catering, forced weather gear, and laundry. That is the whole list — the trip’s <b>name, dates, destination and packed items are deliberately not saved</b>, because they belong to one particular trip rather than to a kind of trip. A <b>side-by-side table</b> now settles the five questions people actually ask — does it hold items, where does it live, is it still connected after the trip is made, what happens if you change it, what happens if you delete it — and it is spelled out that <b>saving a preset under a name you already used replaces it</b> rather than quietly making a second one. <b>(2) One item, many templates</b> — a brand-new section on something the app has always done but the guide only mentioned in passing, inside the paragraph about bags. Calling a template “a box of things” is the right picture for what it is <em>for</em>, but it can read as though an item in three templates is three copies. It is not. You own <b>one</b> head torch, the app stores <b>one</b> head torch, and each template holds a <b>link</b> to it. The section draws the line plainly: <b>what the thing IS</b> is shared — name, weight, photos, storage, care record, owner, condition, brand, model, serial, price, warranty, and the liquid / restricted / charging flags — so editing it on <b>any</b> line in <b>any</b> template changes it everywhere at once; while <b>how it is packed HERE</b> is local to one template — its section, kit, bag exception, “When”, quantity, note and the conditions that decide whether it comes along. That is also why <b>Care → All items</b> gives an item one line per template and counts “431 items · 538 lines”: two lines reading “Sports bra” are one sports bra shown twice, not two.',
      'All items stops looking like it holds duplicates, while keeping the split line-per-template exactly where it tells you something.'),
    v('v127', '2026-08-26 · 16:30 UTC', false, 'Activities move up the trip form, and lose the word “Extra”',
      'Following on from v126’s reshuffle: <b>Activities to pack for</b> now sits <b>directly under List type</b>, instead of at the very bottom past transport, season, weather, catering and laundry. Those two questions belong together — <b>List type</b> and <b>the activities you tick</b> are what the trip is <em>for</em>, and everything below them (how you travel, what time of year, the weather, the catering) is detail about the <em>conditions</em>. In practice it means the two things you always change are both at the top, and the settings you often leave alone have moved out of the way. It is also just called <b>Activities to pack for</b> now, in both modes. It used to rename itself to <b>“Extra</b> activities to pack for” whenever you were building a full trip — a heading that changes under you is harder to read than one that stays put, and the line underneath already explains the point far better: <em>“Your common base and transport kit are already in — tick only the extra activities you’ll do.”</em> The trip-setup card on a trip now uses the same wording, so the two agree. <b>Nothing about what gets packed has changed</b> — same picker, same templates, same list.',
      'The two questions you actually answer on every trip are now the first two on the form.'),
    v('v126', '2026-08-26 · 14:00 UTC', false, 'The trip’s name comes first, and the Swedish import wording is off your lists',
      '<b>(1) Event name is the first thing on the form.</b> Creating a trip used to open with <b>List type</b> — asking you to classify a trip before you had even said what it was. The form now runs in the order you actually think in: <b>name</b>, <b>dates</b>, <b>destination</b>, and only then <b>List type</b> and the rest of the settings. Nothing was added or removed; the same choices are all there, in a sensible order. <b>(2) The Swedish / import wording is no longer shown.</b> Every item imported from your original lists carried a second name underneath it — <b>Kroppslotion</b> under Body lotion, <b>Ansiktsprodukter</b> under Face products, and in a fair few cases the very same words twice (<b>Tooth pickers</b> under Tooth pickers). It was useful while the lists were being translated; now it is just a second line of noise on every row. It has been taken off <b>all six places it appeared</b>: your trip’s <b>Packing List</b>, <b>Packing Mode</b>, the <b>trip review</b>, <b>search results</b>, the <b>Maintenance-mode overview</b> and the <b>kit</b> member picker. <b>Nothing is deleted.</b> The wording is still stored on every item and is still a <b>search key</b> — type “Kroppslotion” into search and Body lotion still comes up — and it is still a column in the <b>Excel export</b>. It simply isn’t drawn on screen any more. (There was never a field to edit or clear it yourself, which is exactly why it needed doing in the app.)',
      'The trip form asks the obvious question first, and every item list is one line shorter and easier to read.'),
    v('v125', '2026-08-26 · 09:30 UTC', false, 'One date picker for the whole trip — and four smaller things',
      '<b>(1) The dates are now one control.</b> A trip’s <b>start</b> and <b>end</b> were two separate date boxes, which meant two separate calendars that knew nothing about each other: you picked a departure in one, closed it, opened the other, and had to find the same month all over again with no sight of where the trip began or how long it had got. A date range is <b>one idea</b>, so it is now <b>one dropdown</b>. Tap <b>Trip dates</b>, tap the day you leave, tap the day you come back — and it closes itself, having counted the nights. <b>Two months are shown side by side</b> (stacked on the phone) so a trip that crosses a month boundary needs no paging at all, the <b>whole range fills in as you move the mouse</b> so you can see the length before you commit, and picking a day <em>earlier</em> than your start simply starts the range again there rather than refusing. The closed field reads properly too — <b>“12 – 19 Sept 2026 · 8 days · 7 nights”</b> instead of two grey dd/mm/yyyy boxes. <b>Clear</b> empties both ends and <b>Today</b> jumps the calendar back to this month. Same day twice = a <b>0-night day trip</b>. <b>(2) Your Owners list is ordered by who owns most.</b> <b>Settings → Owners</b> used to be alphabetical, which told you nothing; it now puts <b>whoever owns the most items at the top</b>, counts still beside each name, ties settled A–Z. The Owner <em>dropdowns</em> stay alphabetical on purpose — you go there knowing the name you want. <b>(3) Storage places can be put in your own order.</b> <b>Settings → Storage places</b> was locked to A–Z, so “Bedroom wardrobe” always came before the garage whether or not that is where your things are. Each place now has <b>▲▼ buttons</b>, and <b>the order you set is the order in every “Where it’s stored” dropdown</b> in the app — put the two or three you actually use at the top and stop scrolling past the loft. Anything an item mentions that isn’t on your list still follows underneath, alphabetically. <b>(4) “Conditions” is now “Item conditions”.</b> The app was using one word for two unrelated things: how <b>worn</b> a thing is (New / Good / Worn / Needs replacing), and an item’s <b>“only include this item when…”</b> rules that decide whether it comes on a trip at all. The grading one is now spelled out in full everywhere it appears — the Settings section, the field in an item’s editor, the filter row and the grouping on <b>All items</b> — and the guide has a short note on the difference. Nothing about how either works has changed; only what they are called. <b>(5) The guide explains Template vs Trip preset.</b> A new section spells out what has only ever been implied: <b>a Template holds your gear, a Trip preset holds your answers.</b> A preset contains no items at all — it is a saved fill-in of the Home form (transport, season, catering, weather, laundry and which activities are ticked), spent the moment you press Create Event, so changing or deleting one can never touch a trip or an item. Worked example included.',
      'Setting a trip’s dates is one gesture instead of two hunts through a calendar; the two Settings lists you use most are in an order that suits you rather than the alphabet; and two things that were easy to confuse now say plainly what they are.'),
    v('v124', '2026-08-25 · 20:30 UTC', false, 'The repair that actually reaches your iPhone',
      '<b>v121’s repair did not work.</b> Your iPhone still showed one condition out of six, and two storage places out of seventeen — the two being exactly the ones you had just changed on the Mac. That is the whole diagnosis in one sentence: <b>a row you CHANGE reaches the other device reliably; a row that merely already exists does not.</b> v121 tried to make the iPhone re-download the list from scratch, which depended on how the syncing library keeps its own internal notes. It did not do what its source code led me to believe, and I should not have bet your evening on it. <b>v124 bets on nothing.</b> The device that has the lists simply <b>writes them again</b> — every entry becomes an ordinary change, and ordinary changes are the one thing that has demonstrably worked all along. It happens by itself, once, on each device. And because relying on an automatic thing is what went wrong last time, there is now also a button: <b>Settings → Sync your devices → Re-send my lists to my other devices</b>. Press it on whichever device is <b>right</b>, and it sends its lists again. It only ever <b>adds</b> to the other device — since v121 nothing is deleted just for being absent from the list a device happens to be holding — so it is safe to press whenever something looks short, and safe to press twice.',
      'Your iPhone gets the lists it should have had, and if anything ever looks short again you can fix it yourself with one button instead of waiting for me.'),
    v('v123', '2026-08-25 · 19:15 UTC', false, 'Typing in an editor can no longer be wiped out from under you',
      '<b>What went wrong.</b> Adding a storage place from inside an item’s editor — pick <b>＋ Add a new place…</b>, type the name, Save — did nothing on the Mac. The place never appeared and the item was left without one. <b>Why.</b> v120 gave three things permission to redraw the screen on their own: the one-time list re-download, the one-time adoption of your old lists, and returning to the app. Each is right to redraw, because the lists genuinely may have changed. What none of them checked was whether <b>you were in the middle of something</b>. Both of the one-time jobs run a few seconds after launch — which is exactly when you were in an item editor typing. The redraw rebuilt the editor and <b>emptied the box you had just typed into</b>, so Save recorded a blank place and, quite correctly, added nothing to the list. Nothing was corrupted; the edit simply never happened. <b>The fix:</b> a background refresh now <b>skips the redraw whenever an editor is open or a field has focus</b>, and picks it up the next time the screen is drawn anyway. It was never urgent — it was only ever tidying. This applies to every editor in the app, not just this one, so no background job can take your typing again.',
      'What you type stays typed. The bug was invisible and looked like the feature was simply broken.'),
    v('v122', '2026-08-25 · 18:00 UTC', false, 'The All items list stops looking as if you had duplicates',
      'From your v121 field check: grouping <b>Care → All items</b> by <b>Whose it is</b> showed <b>“Sports bra.”</b> twice — once marked <b>Bike</b>, once <b>Run</b>. Nothing is duplicated. That list shows <b>one line per template an item belongs to</b>, because what an item packs into can differ from one template to the next — the same sports bra might go in the duffel for Run and a pannier for Bike, and you need to see and set both. It is <b>one item</b>: edit it on either line and every template follows. What was actually wrong was the <b>counting</b>. The header said <b>“538 items”</b> when you have <b>431</b> — 538 was the number of <em>lines</em>. So it now says <b>“431 items · 538 lines”</b>, and the note above the list explains that an item in several templates gets a line for each, with the template’s name on the line. You raised exactly this once before, in v108 (“it seems as if several instances of the same item is stored”) — your catalogue was clean then too, and the wording was what misled you both times. This time the wording is fixed.',
      'The list no longer suggests you have hundreds of duplicates to clean up. You do not.'),
    v('v121', '2026-08-25 · 16:30 UTC', false, 'Fixes v120: the iPhone was only getting the newest entry',
      '<b>What went wrong.</b> After v120 your iPhone showed <b>one</b> storage place and <b>one</b> condition — in each case the one you had just added on the Mac — while the Mac still showed everything. Nothing was lost: your account held the full set the whole time (I checked: 6 conditions, 16 places, 3 owners, 2 people), and so did the Mac. Only the iPhone’s own copy was short. <b>Why.</b> The syncing system keeps a note of which tables it has already done a first, complete download of. v120 added a new table for these lists, and a device that was <em>already</em> syncing does that first download the next time it connects — but your iPhone got there before the Mac had put anything in it. So it downloaded nothing, ticked the table off as done, and from then on only ever received <b>changes</b>. The two entries you made during the field check were changes; the twenty-five that already existed were not. (The same trap cost you the When list in v118: “in sync” describes the database as a whole, never a table that was made seconds ago.) <b>The fix</b> is in two parts. First, each device now <b>forgets that this table was ever synced and downloads it again from scratch, once</b> — sending anything it holds up first, so nothing can be lost either way. Second, and more important: <b>a save can no longer delete an entry just because it wasn’t on the list it was holding.</b> Removal is now something the app has to name explicitly — this rename, this deletion, this reset. That matters because the short list on your iPhone was one edit away from becoming the real one: had you changed anything there, the missing five conditions would have been deleted for both devices. Now they could not have been.',
      'Both devices end up with the full set — and a device that has an incomplete picture can no longer impose it on the other one.'),
    v('v120', '2026-08-25 · 14:00 UTC', false, 'The lists you make now belong to you, not to one device',
      'Five lists in Settings were only ever kept on the device you made them on: <b>Conditions</b>, <b>Trip presets</b>, <b>People</b>, <b>Owners</b> and <b>Storage places</b>. They now live in your account and reach every device you are signed in on — make a change on the Mac and the iPhone has it, and the other way round. <b>What that fixes, list by list.</b> A <b>condition</b> you invented was genuinely broken across devices: an item carries the condition\'s internal name and that always travelled, but only the list holds the readable one — so “Failing”, set on the Mac, arrived on the iPhone as unreadable text. A <b>trip preset</b> could not repair itself at all: nothing else in your data refers to one, so a preset saved on the Mac simply did not exist on the iPhone, with nothing to hint that it was missing. <b>People</b> travelled by name but not by <b>colour</b>, so Anna could be blue on one device and green on the other. <b>Owners</b> and <b>storage places</b> already healed themselves — both are written on the item as plain words — but “Bedroom wardrobe” describes one house, not one device. <b>What deliberately does NOT sync:</b> how a device looks and behaves. The <b>theme</b>, the view you last used, which Settings sections you left open, and each device\'s own backup dates all stay put — you may well want dark on the phone and light on the Mac. <b>Your existing lists are not disturbed.</b> The first time each device runs this version it offers up the lists you had made there, and they are <b>merged</b>: an entry that already exists in your account is left exactly as it is, and anything only one device had is added. So expect the combined set on both devices the first time round — <b>have a look through the five lists afterwards and remove anything you don\'t want</b>, because from then on a removal reaches both devices too. Two safeguards learned from the v118 mishap are built in: <b>nothing standard is ever written into your data</b> (the four standard conditions, Martin &amp; Anna, and the standard storage places live in the app, so a device can never plant them over yours), and a device <b>waits until it has actually seen your account\'s copy</b> before offering anything up. Adding or removing one entry now writes just that entry, so a screen you left open cannot delete something added on the other device.',
      'Set a condition, a preset, a person, an owner or a storage place once — on whichever device you happen to be holding — and both devices have it.'),
    v('v119', '2026-08-25 · 09:00 UTC', false, 'Fixes the bug that reset your When list',
      '<b>What went wrong.</b> You edited the timeline — names, emoji, colours — and later found the seven built-in stages back at their factory settings, with only the stage you had <b>added</b> still as you left it. Here is why. v118 wrote the seven standard stages into your shared data the first time a device found none. Each has a fixed internal name, which was meant to stop two devices creating two separate lists — and it did. What it also meant was that writing a standard stage landed <b>exactly on top of</b> the same stage on the other device and replaced it. Your second device found its own newly-created (therefore empty) timeline, waited for your account\'s copy, and gave up a moment too early: the app reports “in sync” about the database as a whole, and a table created seconds earlier can still be empty at that point. So it concluded the account had no timeline and wrote seven factory stages over your edited ones. The stage you had added survived because its name collided with nothing. <b>The fix.</b> The standard seven are <b>no longer written into your data at all</b> — they now live only in the app, exactly as the standard conditions do. An account that has never edited the timeline stores nothing, both devices show the same seven from the code, and <b>the first change you make is what creates the stored list</b>. There is no longer any moment at which one device can write over another\'s. Two smaller repairs came with it: the app now <b>re-reads the timeline before showing or changing it</b> (and when you switch back to the app), so a device left open can\'t save an out-of-date list back over a newer one; and when two stages end up sharing a position, both devices now settle on the <b>same</b> order instead of each picking their own.',
      'Your timeline stays the way you set it. Worth re-doing your names and colours now — this time they will hold.'),
    v('v118b', '2026-08-25 · 08:00 UTC', false, 'You can actually see which stage you are in',
      'From your v118 field check: in <b>Packing Mode</b>, the stage\'s colour was there but you couldn\'t see it. Fair — it was a <b>6% tint</b> of the card and an edge that had itself been mixed most of the way to grey, which on a white background is close to nothing. The colour is now spent on <b>solid blocks instead of a wash</b>: a <b>full-width band across the top</b> of the phase bar, and a ringed <b>disc behind the emoji</b> that travels with you as you step through the pack. The background tint is stronger too. The <b>words</b> deliberately did <em>not</em> get more colourful — at the stronger tint two of the seven stage colours (amber and green) dropped to <b>4.2:1</b> against the card in the light theme, under the 4.5:1 readable minimum, so the band and the disc carry the colour and the text just stays readable. All seven colours were re-measured in both themes; the worst is now <b>4.54:1</b>.',
      'A glance at the top of the screen tells you which stage you are packing, without reading a word.'),
    v('v118', '2026-08-25 · 06:00 UTC', false, 'The When list is yours — and it syncs',
      'The seven stages of a pack — <b>Preparations</b>, <b>≥1 week ahead</b>, <b>Day before</b>, <b>Morning list</b>, <b>At the front door</b>, <b>Wear / carry</b>, <b>After / recovery</b> — were baked into the app. They are now a list you own, in <b>Settings → When</b>. <b>Rename</b> one by typing over it; give each an <b>emoji</b> and a <b>colour</b>; move them up and down the timeline; <b>remove</b> ones you never use; <b>add your own</b>. Your emoji and colour then show up where you actually pack: on the group headings of every packing list, and on the step you are standing in inside <b>Packing Mode</b>, which now wears that stage\'s colour. Two behaviours came out of the code and became settings: <b>Days ahead</b> decides when a stage starts nudging you (7 = a week before you leave; -1 = after the trip), and a <b>to-dos</b> tick marks a stage that holds things to <em>do</em> rather than things to pack, which is what makes Preparations different. <b>Nothing can be lost:</b> renaming keeps every item where it was, because the app remembers a stage by a hidden name that never changes; and removing one makes you say <b>when its things get packed instead</b>, counting your items, the lines on trips you have already built, <em>and</em> your to-dos before it will do anything. There is a <b>Reset to the standard seven</b>. <b>The big difference from Conditions and Owners: this list SYNCS.</b> It is the first of these lists to live in your data rather than on one device, because a stage is stamped on every single item — one that existed only on the Mac would make the same item read as a different “When” on the iPhone. Change the timeline anywhere and both devices follow. While one device is still on an older version, anything it doesn\'t recognise is shown as-is and <b>never quietly moved</b> — a fix that had to go in first, because until now the app silently reset any “When” it didn\'t recognise to “≥1 week ahead”.',
      'The packing order is now the one in your head, not the one I guessed — and because it syncs, both devices agree on it without you setting anything up twice.'),
    v('v117', '2026-08-25 · 00:30 UTC', false, 'Owners are a proper list — and your e-mail address is off every item',
      '<b>(1) The e-mail address is gone.</b> Nearly every item in the catalogue was showing <b>martin.schabbauer@icloud.com</b> as its owner — on the item rows, in the Care list, in the All-items table and in the “Whose it is” grouping. It was never typed: <b>the syncing system reserves a hidden field called “owner”</b> for its own bookkeeping and stamps the signed-in account into it on every save, and the app happened to use the very same name for <b>whose thing it is</b>. The two collided, and the address won — on <b>422 of 431 items</b>. The app’s own answer now lives under a <b>different name entirely</b>, so the two can never collide again, and a one-time repair on first launch turns that stamped address into <b>Martin</b> while leaving every name you actually typed (<b>Anna</b>, <b>Shared</b>) exactly as it was. <b>Settings → Sync your devices</b> now says <b>Syncing as Martin</b> too — the address is how you sign in, but the app says who you are. <b>(2) Owner is a list you manage.</b> <b>Settings → Owners</b> is a new section beside People: <b>add</b> an owner, <b>rename</b> one — every item that is theirs follows, in one go — and <b>remove</b> one, which first asks <b>who its things go to</b> (or nobody), so nothing is ever orphaned. Each name shows how many items are theirs. The same list is the dropdown <b>everywhere Owner appears</b> — the item editor and the <b>All items · table</b> — and both offer <b>＋ Add an owner…</b> and <b>⚙ Manage owners…</b> right in the dropdown, so you never have to go to Settings to fix a name. Owners stay deliberately <b>separate from People</b>: People is who <em>packs</em>, so “Shared” can own things without turning up in every “Packed by” picker.',
      'Whose things are whose is now something you set from a short list you control — instead of a free-text box holding an e-mail address you never typed.'),
    v('v116b', '2026-08-24 · 22:00 UTC', false, 'Every word in the app measured for readability',
      'Rather than keep fixing faint text one complaint at a time, <b>every piece of text on every screen was measured</b> — its size, and its contrast against the exact colour behind it — in <b>both</b> the light and dark themes. Nearly <b>60,000 elements</b> were checked against the standard readability threshold (4.5:1 for ordinary text). <b>Fifty-one</b> things failed. They are all fixed. The worst were not small print: the <b>trip name</b> on an event card, the <b>page title</b> at the top of every tab, the <b>label under the active tab</b>, the <b>“1 due soon” counts</b> on Care, the <b>due dates</b> on every care row, the chips on <b>Shopping</b> and <b>Actions</b>, and — in dark mode — <b>every grey chip in the app</b>, which had been left with a colour only ever defined for the light theme and was sitting at <b>2:1</b>. Nothing changed shape, moved, or was recoloured beyond recognition: red still reads red and amber still reads amber. Two general rules now hold everywhere. <b>Nothing is smaller than 12.5 pixels</b> — thirty-odd labels were below that, some as small as 8. And a colour used as <b>text</b> is now mixed toward the page’s own ink, which <b>darkens it on white and lightens it on black</b>, so one setting stays readable in both themes instead of working in one and failing in the other. The guide’s list of section colours now shows each colour as a <b>dot</b> beside ordinary text, rather than setting the words themselves in a tint that only worked on white.',
      'The app can be read — at arm’s length, in either theme — without hunting for the thing you were told to look at.'),
    v('v116', '2026-08-24 · 20:30 UTC', false, 'The Care headings are actually readable',
      'The group headings inside the Maintenance list — <b>Overdue</b>, <b>Due soon</b>, <b>Upcoming</b>, <b>Later</b>, <b>Reference only</b> — were set at <b>13 pixels</b>, and two of them were failing plain readability: measured against the background they sit on, <b>Due soon</b> came out at <b>2.9:1</b> in the light theme and <b>Overdue</b> at <b>3.6:1</b> in the dark one, where <b>4.5:1</b> is the threshold for text this size. In other words the two headings that matter most were the two hardest to see. They are now <b>15 pixels</b>, and each colour is mixed toward the text colour of whichever theme you are in — so it darkens on white and lightens on black. Every heading now measures <b>4.6:1 or better in both themes</b>, while still reading as red for overdue and amber for due soon. This is the fourth heading in the app to turn out too faint to find, so it was measured rather than eyeballed.',
      'You can see where each group starts without hunting for it.'),
    v('v115', '2026-08-24 · 19:00 UTC', false, 'The Maintenance list now has edges',
      'Following on from the heading in v114: the maintenance list is now drawn inside a <b>single frame</b> — its overdue/due-soon counts, its <b>List / Calendar</b> switch and every row, all within one bordered panel. Before, the list simply <b>ran out</b> somewhere above the <b>All items</b> browser with nothing marking where one ended and the other began. Now the section has a visible top and bottom, so you can see at a glance how much of the screen belongs to it. The frame is deliberately left <b>unfilled</b> rather than made into a solid card, because the rows inside are already cards and a card inside a card reads flat. The “nothing scheduled yet” message sits inside the same frame, so the section looks the same whether or not you have anything in it.',
      'The Care tab reads as two clearly separated halves — what needs looking after, and everything you own — instead of one continuous scroll.'),
    v('v115b', '2026-08-24 · 19:10 UTC', false, 'Settings’ group labels are findable',
      'Shipped alongside the frame above, for the same reason. The four labels that divide Settings — <b>Your packing setup</b>, <b>Appearance</b>, <b>Your data</b>, <b>Help &amp; about</b> — were set at about <b>11 pixels</b> in a washed-out tint, and were being <b>missed entirely</b> when scanning the page for one of them. They are now a size and a contrast you can actually find, without becoming headlines. Nothing moved; they are just legible.',
      'You can find your way around Settings by its own signposts.'),
    v('v114', '2026-08-24 · 17:00 UTC', false, 'The Care tab says what its list is',
      'A small fix, from trying to follow instructions that named a thing the screen never did. The <b>Care</b> tab opens with three navigation cards — Containers, All items · table, Shopping list — and then the maintenance list simply <b>started</b>, with no heading: the first words you met were “OVERDUE”. There was nothing telling you what you were looking at, and nothing to search the page for. It now carries a proper <b>Maintenance list</b> heading with a one-line explanation, matching the <b>All items</b> heading further down so the two read as the two halves of the tab that they are. The heading shows even when nothing is scheduled yet, so the empty state is labelled too. Nothing moved and nothing else changed.',
      'You can tell at a glance — and by searching the page — which part of the Care tab you are in.'),
    v('v113', '2026-08-24 · 15:00 UTC', false, 'Conditions are yours to set, and the Care list stops burying the urgent stuff',
      '<b>(1) The condition list is now editable.</b> <b>New / Good / Worn / Needs replacing</b> was a fixed list baked into the app. It is now yours, in <b>Settings → Conditions</b> (in <em>Your packing setup</em>, alongside Kits, People and Storage places): <b>rename</b> them, <b>reorder</b> them — that order is the order in every dropdown — <b>remove</b> ones you never use, and <b>add your own</b>, like “Failing” or “Being repaired”. Two behaviours that used to be welded to the single condition called “Needs replacing” are now settings you point wherever you like: <b>Badge</b> decides whether a condition shows on item rows and whether it does so in <b>amber</b> or <b>red</b> (or stays quiet, which is right for New and Good), and <b>needs replacing</b> makes a condition raise the replace prompt and <b>feed the shopping list</b> — so a condition you invented can do that job too, and more than one can. <b>Nothing can be lost by any of this:</b> renaming keeps every item’s rating; removing a condition that items are using makes you say <b>what those items become</b> first, naming how many there are; and an item carrying a rating this device doesn’t recognise is shown as-is and <b>never quietly rewritten</b>. There’s a <b>Reset to the standard four</b> if you want the original list back. One caveat worth knowing: the condition <b>list</b> lives on each device (like People and Storage places) while an item’s <b>rating</b> travels with your data — so set up a new condition on both devices, or carry it across in a backup file. <b>(2) The Care list folds.</b> Opening the Care tab meant scrolling past every service due in the next two years to reach the three that were actually overdue. Now <b>Overdue</b> and <b>Due soon</b> stay open where you can see them, <b>Upcoming</b> shows the next couple of months, and everything further out folds into a single tappable <b>Later</b> line — as does <b>Reference only</b>, the things with care notes but no schedule. Nothing is hidden and no counts changed; a fold tells you how many are inside, and stays open once you open it. <b>Due soon</b> is also tightened from three weeks to <b>two</b>, so amber now means genuinely soon — which also means the Home care reminder speaks up a little later, and about fewer things.',
      'Your gear gets graded the way you actually think about it rather than the four words the app happened to ship with — and the Care tab opens on what needs doing instead of a wall of things that don’t.'),
    v('v112', '2026-08-24 · 11:00 UTC', false, 'Four small things you asked for',
      '<b>(1) Edit while you pack.</b> In <b>Packing Mode</b> the big slab still marks a thing packed with one tap — that stays — but each row now has a small <b>pen</b> beside it. Tap it and the quick editor opens right there: quantity, which bag, when, the note, who packs it, weight and the flags. Save and you drop <b>straight back into Packing Mode</b>, at the same phase, without losing your place. If you need the deeper settings, the editor’s <b>Edit the full item</b> button takes you to the full item editor — and when you save <b>there</b>, the app brings you back to Packing Mode too. <b>(2) Owner is now a dropdown.</b> In an item’s <b>Details &amp; ownership</b> panel, <b>Owner</b> has stopped being a free-text box you had to spell the same way every time. It now lists every owner you’ve already used, plus everyone on your <b>Settings → People</b> list, with <b>＋ Add an owner…</b> to name a new one — which then appears in the list from then on. Names like <b>Shared</b> work fine and, deliberately, do <b>not</b> turn into People, so your “Packed by” pickers stay a list of actual packers. The same dropdown is now a column in <b>Care → All items · table</b>, so you can set owners down a whole column. <b>(3) WET options moved.</b> On a trip’s <b>Trip setup</b> card, the <b>Indoor / Outdoor / Race</b> options no longer sit in a box of their own near the top; they’re indented directly <b>under the WET activities</b> they qualify, at the bottom of the card — matching where they already sit in the Create Event form. <b>(4) Quick actions on a trip.</b> <b>Long-press</b> a trip card (or <b>right-click</b> it on the Mac), or tap the new <b>⋯</b> in a trip’s own header, and a menu offers: <b>Mark everything packed</b> — one tap to take a list to 100% and keep it on record, for a trip you packed off-app or an old one you just want filed — <b>Clear every tick</b>, <b>Rename</b>, <b>Trip settings</b>, <b>Share</b>, and <b>Delete this trip</b>, which the app had no way to do at all until now.',
      'Fewer dead ends: you can fix an item mid-pack without losing your place, owners stop being typed twice three different ways, and a finished — or unwanted — trip can finally be closed off in one gesture.'),
    v('v111', '2026-08-23 · 18:30 UTC', false, 'All items — filter, sort and group your whole catalogue',
      'The <b>All items</b> index on the <b>Care</b> tab now bends to what you’re looking for. <b>Two new filter groups</b> join the category chips: <b>Condition</b> (New / Good / Worn / Needs replacing / Not rated) and <b>Section</b> (Clothing, Tech &amp; devices…). Chips <b>within</b> a row still mean “either of these”; the <b>rows combine</b>, so <b>Liquids</b> + <b>Worn</b> means liquids <i>that are</i> worn — and every count tells you how many you’d actually get. <b>Show all</b> clears the lot. A new <b>Sort</b> control orders the whole index by <b>Alphabetically, Container, Where it’s stored, Weight, Manufacturer, Acquired, Warranty until</b> or <b>Section</b>, with <b>▲/▼</b> to flip the direction; anything with that field <b>blank always sinks to the bottom</b>, in both directions, so a sort never buries what you can see under what you haven’t filled in. And a new <b>Group</b> control breaks the list into readable, <b>collapsible</b> sections — by <b>Container, Where it’s stored, Section, Manufacturer, Condition, Template, Category, Whose it is, Care status</b> or <b>First letter</b> — each with its own count, the sort still applying inside each group, and the “not set” bucket always last. Your sort and grouping are <b>remembered on this device</b>; the filter chips still start clear each visit.',
      'Five hundred rows stop being a wall of names: round up everything worn, everything from the garage, or everything by one maker in two taps.'),
    v('v110', '2026-08-23 · 16:30 UTC', false, 'The New Event form, tidied',
      'Four changes to the shape of the <b>Create Event</b> form, so related choices sit together. <b>(1)</b> <b>Laundry available on this trip</b> has moved down to sit under <b>Catering</b>, with the other trip-wide practicalities, instead of interrupting the run of name, dates and destination. <b>(2)</b> The <b>WET options</b> — Indoor / Outdoor / Race — no longer float as their own box further down; they now sit <b>inside the WET · Workout, Exercise &amp; Training block</b>, indented under its activities, because that is the only thing they ever qualify. (The block’s <b>select all</b> still ticks activities only, not the options.) <b>(3)</b> <b>Yoga / Mobility</b> is now simply <b>Mobility</b> — renamed <b>in place</b>, so its items, sections and history are untouched. <b>(4)</b> The WET activities are offered in a <b>deliberate order — Swim, Bike, Run, Strength, Mobility, Breath work</b> — rather than alphabetically: race order first, then the gentler things. This applies <b>everywhere they appear grouped</b>: the event form, the <b>Templates</b> tab and a trip’s <b>Trip setup</b> card, so the group reads the same way wherever you meet it. Any activity you add yourself follows on after those, alphabetically, so nothing can go missing. Other groups are unchanged and stay alphabetical.',
      'The form reads in the order you actually think in, and the training activities are no longer shuffled into an order nobody wanted.'),
    v('v109', '2026-08-23 · 15:00 UTC', false, 'Sections now travel with an item into another template',
      'A fix on top of v108, spotted straight away. When you add an item to another template, its <b>section</b> — “Tech &amp; devices”, “Clothing” — now comes with it. A section belongs to <b>one</b> template (your Travel “Tech &amp; devices” and your Hiking “Tech &amp; devices” are two separate things that happen to share a name), so it travels <b>by name</b>: if the destination has a section called the same thing the item lands in it, and if it doesn’t the item arrives under <b>Ungrouped</b>, ready for you to file. It will never invent a new section in a list you have arranged by hand. Your Travel and Hiking templates share <b>all nine</b> section names, so in practice items simply land where you expect. This applies to items added <b>from now on</b> — anything already added to a second template stays put and needs its section set once by hand.',
      'Adding an item to another template no longer dumps it at the bottom of the list for you to re-file.'),
    v('v108', '2026-08-23 · 12:00 UTC', false, 'One item, everywhere — the shared-item promise finally kept',
      'Your camera is <b>one camera</b>, however many lists it appears in. That has always been true of the database underneath, but two flaws above it broke the promise. <b>(1) “Container” and “When” were lying.</b> They sat under <b>① The item itself</b>, whose whole heading reads “these stay the same everywhere you use it” — but they were the only two fields in that box that <b>didn’t</b>. Worse, an item’s default bag was fixed at the moment it was created and <b>no screen in the app could ever change it again</b>: changing the bag in Travel quietly wrote a private note saying “in Travel, use the camera bag” and left the real default untouched, so Hiking never heard about it. Now ① genuinely means everywhere — change the bag there and every list follows. <b>(2) Adding an item to a second template could erase it.</b> Ticking an item into another list ran it through a copier that carried only about half its fields, and that half-filled copy was then written <b>over the shared item</b> — silently blanking its <b>photos</b>, its whole <b>maintenance record</b>, and its brand, model, serial, price, warranty and condition, <b>in every list at once</b>. Nothing warned you; you would only find out weeks later when a photo was missing. Putting an item into another template now stores a <b>link</b> rather than a copy, so there is no half-filled copy left to overwrite anything with. <b>(3) A deliberate exception, clearly marked.</b> Because the bag often genuinely does depend on the trip — on a hike everything goes in the hiking backpack, on a flight in the checked luggage — <b>② In this list</b> now has its own <b>Container</b> setting, which names the default it is overriding and says outright that this list differs on purpose. <b>(4) A default bag per template.</b> Most templates are near-uniform — everything on a run goes in the duffel — so a template can now set <b>one bag for everything in it</b>, saving you from setting the same bag on eighty-four items. It sits between the item’s own default and the per-list exception. <b>Nothing on any of your lists moved:</b> every item was checked, and each one kept the exact bag it already had.',
      'Editing an item now genuinely changes it everywhere, and adding it to another list can no longer destroy its photos and care history behind your back.'),
    v('v107', '2026-08-20 · 12:00 UTC', false, 'Settings tidied — a colour-coded index instead of a long stack',
      'Settings had quietly grown to <b>thirteen cards</b>, and the three you touch least — syncing, backup files and the automatic on-device copies — sat right at the <b>top</b>, pushing Kits, People and Storage places below the fold. Two changes. <b>(1) Everything folds.</b> Each section is now a single line with a <b>summary of what’s inside</b> — “People: Martin, Anna”, “Storage places: 12 places”, “Backed up today — still current” — so you can take in the whole tab at a glance and open only what you need. Whatever you leave open <b>stays open next time</b>, so the sections you use often settle where you want them. The whole tab is now about <b>a page and a half instead of thirty</b>. <b>(2) A sensible running order.</b> Four groups: <b>Your packing setup</b> (Kits, People, Storage places, Trip presets, Shared trips) first because that is what you actually come here to change; then <b>Appearance</b>; then <b>Your data</b> (syncing, backup &amp; restore, automatic backups) — as important as ever, but touched about twice a year; and finally <b>Help &amp; about</b>. The database overview stays pinned at the top where it was. Nothing was removed and nothing moved out of Settings — every button is exactly where it was, one tap deeper. <b>(3) A colour each.</b> Every section has its own <b>signature colour</b> and its own hand-drawn icon — violet Kits, blue People, teal Storage places, amber Trip presets, green Shared trips, and so on down. Closed, it shows as a tinted icon; <b>open, the colour takes over the whole panel</b> — the icon fills in solid, the heading and edge take the colour, and the panel itself carries a faint wash of it — so there is never any doubt which section you are inside, however far you have scrolled. The colours are fixed identities, not status lights: a section is the same colour whatever state it is in, so you learn it by sight.',
      'You can see the whole of Settings at once again, the things you actually change are at the top instead of buried under the things you don’t, and each section is recognisable by colour before you have read a word.'),
    v('v106', '2026-08-20 · 09:00 UTC', false, 'A backup reminder that won’t let you forget — and saves the file in one tap',
      'Your data lives in the browser, so a saved backup <b>file</b> is the one thing that survives losing it. Other browsers let an app write that file into a folder on your Mac by itself; <b>Safari does not</b>, and Safari is where your packing list lives. So rather than a silent backup that would never actually run, this release makes the <b>reminder</b> do the work. <b>(1) One tap, wherever you see it.</b> The Home reminder now carries its own <b>Save backup now</b> button — no more opening Settings and hunting for the export. The dated file lands straight in your <b>Downloads</b> folder. <b>(2) It escalates.</b> Amber once you have unsaved changes and no file for a fortnight; <b>red</b>, and worded plainly, past six weeks. Dismissing it buys a week while it is amber, but only until tomorrow once it is red — so an old backup can no longer be waved away month after month. <b>(3) It counts changes, not days.</b> If you have not touched anything since your last file, the app stays quiet however long it has been; if you have built a trip since this morning, it says so. <b>(4) Settings tells you the truth.</b> The data card no longer just prints a date — it says either “nothing has changed since, so it’s still current” or “you’ve made changes since”. A bare date was misleading: “3 days ago” looks perfectly safe even when a whole trip has been added since.',
      'The backup that actually protects you is the one you remember to take — so the app now remembers for you, and makes it a single tap.'),
    v('v105', '2026-08-19 · 23:30 UTC', false, 'Photos stay on their own device — and the guide explains why',
      'A decision, now settled and written down. <b>Photos stay on the device that took them</b> and are never uploaded. What travels instead is the small <b>thumbnail</b> each item carries \u2014 so your lists, your Care screen and your item rows look identical on both devices; you just cannot open a full-size photo on a device that did not take it. The reason is size: your entire catalogue \u2014 hundreds of items with every template, trip, to-do and kit \u2014 is about a megabyte, while the photos can be twenty or thirty times that. Syncing them would make every sync slow and eat the storage allowance many times over, to show you a picture the thumbnail already identifies. Photos are still saved in full inside your <b>exported backup file</b>, so they remain properly backed up. The <b>How it works</b> guide now covers all of this in its own section, and \u2014 for future reference \u2014 records what the syncing actually <em>is</em>: <b>Dexie Cloud</b>, a small hosted service built for offline-first apps, tied to your e-mail address, on its free tier. It also notes the reassuring part: the app is local-first, so if that service ever disappeared, everything would keep working exactly as it does now.',
      'The one place your devices deliberately differ is now explained properly \u2014 and a future you will be able to find out what the sync service is without having to go digging.'),
    v('v104', '2026-08-19 · 22:30 UTC', false, 'Reset now works with the app open twice',
      'On the iPhone, <b>Replace this device with the account copy</b> could fail with "another tab or window still has the app open" — because emptying a browser database outright requires <b>exclusive</b> access, and on iOS the app is very often open in two places at once (a Safari tab <em>and</em> the Home Screen app). Rather than asking you to hunt down every open copy, the app now simply empties everything itself instead, which needs no exclusivity: your data, the sync bookkeeping, and any changes still queued to upload \u2014 so the next sign-in downloads a clean copy from your account. Your <b>automatic backups are deliberately kept</b>, since they live only on that device and are its own safety net.',
      'Starting a device fresh from your account now works first time, without having to close other windows.'),
    v('v103', '2026-08-19 · 21:30 UTC', false, 'Finishing the sync safety net',
      'A follow-up to v102. <b>Replace this device with the account copy</b> empties the device and then reloads it \u2014 at which point the app saw an empty database and helpfully filled it with the starter templates again, which would then have been uploaded as a second catalogue the next time you signed in. The app now remembers that the device is <b>deliberately</b> waiting for the account\u2019s copy, and will not put anything in its place: it stays empty until you sign in and your real catalogue arrives. Nothing else changed.',
      'The "start this device again from the account" button now actually leaves you with the account\u2019s catalogue, instead of quietly recreating the one you just cleared.'),
    v('v102', '2026-08-19 · 20:00 UTC', false, 'Sync: no more duplicate catalogues',
      'Two fixes that matter before you switch syncing on. <b>(1) A device no longer seeds over what is arriving.</b> The app fills a brand-new, empty database with the starter templates \u2014 sensible on a new device, but on a device that is <b>signed in to sync</b>, "empty" only means the account\u2019s catalogue has not landed yet. Seeding into that gap left the device holding the starter set <em>and</em> everything that synced down, i.e. two of everything. A signed-in device now waits for the first sync before deciding it is empty, and if the sync cannot be reached it shows nothing rather than inventing a second catalogue. <b>(2) A way to clean up a device that took the wrong copy.</b> <b>Settings \u2192 Sync your devices</b> gains <b>Replace this device with the account copy</b>: it erases what is on that device and downloads the account\u2019s copy instead \u2014 for a phone or a second browser that seeded itself before it ever synced. It asks twice, and it signs out before erasing, so the wipe is purely local and is never mistaken for you deleting everything on all your devices.',
      'Turning on sync across several devices no longer risks ending up with two of everything \u2014 and there is now a clean way to point a stray device back at the right catalogue.'),
    v('v101', '2026-08-19 · 18:30 UTC', false, 'Urgent fix: v100 hid your data',
      'If you installed <b>v100</b> and it looked like your <b>trips, to-dos and kits had vanished</b> — they had not. <b>Nothing was ever lost.</b> The syncing library quietly renames the app\u2019s local database when sync is switched on, so v100 opened a <b>brand-new, empty</b> one, filled it with the starter templates, and showed you that instead. Your real catalogue was sitting untouched the whole time in the original database, which is why the templates looked right but your trips were missing. This release pins the database name back, so the app opens <b>your</b> data again, exactly as it was. It also tidies away the empty database v100 left behind \u2014 carefully: it only ever removes the empty one, and only once your real data is confirmed present, so it can never be the thing that deletes a last copy. Apologies \u2014 this was my mistake, and the kind that is frightening to see even when nothing is actually gone.',
      'Your trips, to-dos and kits are back where they belong, and the flaw that hid them is fixed and covered by a test.'),
    v('v100', '2026-08-19 · 17:00 UTC', false, 'Sync between your iPhone and your Mac',
      'The big one: your <b>templates, items, trips, to-dos and kits</b> can now stay in step across every device you sign in on. Open <b>Settings → Sync your devices</b> and tap <b>Sign in to sync</b>. You enter your e-mail and get a <b>one-time code</b> back — there is no password to invent or remember. Do the same on your other device and the two keep themselves matched from then on. Edits made while you are <b>offline</b> are queued and sent the moment you are back, so a plane or a tunnel changes nothing. <b>You are never locked out of your own data:</b> the app works exactly as before without signing in — signing in is only what starts sharing between devices, and signing out on a device leaves everything on it intact. Two things deliberately <b>stay on the device that made them</b>: your <b>photos</b> (they are far larger than everything else put together, and each item still carries its small thumbnail, which does travel — so your lists look right everywhere) and the <b>automatic backups</b> (those are each device\u2019s own safety net; copying them between devices would help nobody). Your JSON backup still contains everything, as always.',
      'Add a jacket to a template on the Mac and it is on your iPhone before you have put the kettle on — with no password, no accounts to manage, and everything still working offline.'),
    v('v99', '2026-08-19 · 15:00 UTC', false, 'New engine room (groundwork for syncing your devices)',
      'Nothing you can see changed in this release — but underneath, the part of the app that stores your data has been rebuilt on <b>Dexie</b>, a well-established database library. Your data itself was <b>not touched, moved or converted</b>: the app simply took over the database already on your device, exactly as it was. Every screen, every button and every backup behaves identically. <b>Why bother?</b> Because this is the foundation that makes <b>syncing your iPhone and your Mac</b> possible. The old hand-written storage code had no way to reconcile changes made in two places; Dexie does, and it is what the sync service builds on. Doing it as its own release — with <b>no syncing switched on yet and nothing leaving your device</b> — means the risky part (changing where your data lives) is proven on its own, before anything touches the internet. It was verified by taking a complete fingerprint of a full catalogue before the change and confirming it came back <b>identical</b> afterwards, down to every item, template, membership, trip, to-do, kit, snapshot and photograph.',
      'The last piece of groundwork before your two devices can share a catalogue — done as an isolated, provable step so your data is never riding on two big changes at once.'),
    v('v98', '2026-08-19 · 12:00 UTC', false, 'Photos moved out of your items — and a real bug fixed',
      'Groundwork for syncing your iPhone and Mac, plus a genuine fix. <b>(1) Photos now live in their own place.</b> Until now every picture was stored <em>inside</em> the item that owned it, which meant the whole image was dragged along every time the app read your catalogue, saved a backup or took an automatic snapshot. Pictures are now kept once, on their own, and each item simply points at them — with a small thumbnail kept on the item so your lists still show a picture instantly. Nothing changes for you: photos look and work exactly as before. But an item is now roughly <b>eight times smaller</b>, and the automatic snapshots no longer carry a full copy of every photograph — which is what made them so big. The change happens by itself the first time you open this version. <b>(2) A real bug, fixed.</b> While testing the above I found that <b>restoring a backup or a snapshot silently threw away every item photo and every maintenance record</b>. The pictures and care schedules vanished with no warning, and it has been that way for a long time. Restores now keep both — with tests to make sure it stays fixed. <b>(3) Tidy up photos.</b> A new button in <b>Settings → Your data</b> frees any picture no item (and no snapshot) still needs — what gets left behind when you delete a photo or an item. Your data count now shows how many photos you have.',
      'Your catalogue got dramatically lighter — and a long-standing flaw that quietly stripped photos and care schedules out of every restore is now fixed and tested.'),
    v('v97', '2026-08-18 · 20:00 UTC', false, 'One unified icon set',
      'The app now speaks in <b>one visual language</b>. Every symbol that belongs to the <em>interface</em> — the item flags (charging, liquid, restricted, consumable, not-in-use, photo, owner, per-night), the badges, the quick-filter chips, the Home nudges, the Care states, the trip-setup tiles, the search results and the buttons — has been redrawn as a <b>hand-drawn line icon</b> in a single consistent weight, replacing the mixed bag of emoji that had built up over 96 versions. Because they’re drawn rather than typed, they <b>take on the colour of whatever section you’re in</b> (blue on Home, green on Events, purple on Templates…) and they look <b>exactly the same on every device</b> — no more Apple-vs-Android emoji roulette, and no more glyphs that sat slightly too high or too low next to their label. Around <b>45 new icons</b> were drawn for this. What deliberately <b>stays</b> as emoji is anything that identifies <b>your things</b>: the group headings on a packing list (Clothing, Checked luggage, Golf bag, Morning list), your <b>template covers</b> and your <b>kits</b> — those are colourful, instantly recognisable, and you choose them yourself. The rule is simple: <b>a line icon is the app talking; an emoji is your gear.</b> Weather keeps its own coloured glyphs. The <b>How it works</b> guide gains a short section explaining the distinction, and its wording no longer quotes icons that might change. Nothing about how the app works changed — it just looks like one designed thing now.',
      'The interface finally looks like a single designed product rather than 96 versions of accumulated emoji — and every icon renders identically on your Mac and your iPhone, in the colour of the section you’re in.'),
    v('v96', '2026-08-18 · 18:00 UTC', false, 'Template covers — a colourful Templates grid',
      'The <b>Templates</b> tab just got a face-lift. Instead of a plain list, your templates now appear as a <b>visual grid of cover cards</b>, each with a <b>coloured tile and an emoji</b>, so you can spot <b>Golf</b>, <b>Diving</b> or <b>Travel</b> by look alone. Every template gets a distinct colour automatically, but you can pick your own: open any template and tap the new <b>Cover</b> button in its toolbar to choose an <b>emoji</b> (⛳ 🤿 🏃 🎿…) and a <b>colour</b> — or leave the colour on <b>Auto</b> to let the app keep it consistent for you. A live preview shows exactly how the card will look before you save. The chosen emoji also shows up next to the template in <b>Search</b>. Purely visual — nothing about what a template holds or how trips are built changed; the grid just makes the tab quicker to scan and a lot nicer to look at.',
      'Your templates are now instantly recognisable at a glance — pick a colour and an emoji for each, and the Templates tab turns from a grey list into a bright, scannable grid.'),
    v('v95', '2026-08-18 · 16:00 UTC', false, 'Who packs what — split a trip between people',
      'Packing with someone? You can now say <b>who packs each thing</b> and see just your own share. Set up your <b>People</b> in <b>Settings → People</b> — each with a name and a colour (Martin &amp; Anna are there to start) — then, on any trip, open an item and pick <b>Packed by</b>. Assigned items show a small <b>colour dot</b>, and a new <b>“Who packs”</b> row of chips at the top of the packing list lets you filter to <b>Everyone</b>, one person, or <b>Unassigned</b> — with a live count each. The same person filter sits at the top of <b>Packing Mode</b>, so each of you can step through only your own items, phase by phase. Best of all, the split <b>travels inside a shared trip</b>: send the trip to Anna and everything you assigned to her arrives already marked as hers. Your <b>Actions</b> and lists are untouched — this is purely about dividing the packing.',
      'No more packing each other’s things twice or forgetting whose is whose: assign items to a person and each of you gets a clean, filtered list — on screen and in Packing Mode — that even survives sharing the trip.'),
    v('v94', '2026-08-18 · 14:00 UTC', false, 'Shopping list — know what to buy before you go',
      'A new <b>🛒 Shopping list</b> gathers everything worth buying or restocking before a trip, in one place on the <b>Care</b> tab. Three kinds of thing show up as <b>suggestions</b> automatically: items you tick as a <b>🛒 Consumable</b> in their editor (things you use up — sunscreen, toothpaste, energy gels), items whose <b>Condition</b> is set to <b>Needs replacing</b>, and anything past (or within a month of) its <b>replace-by / expiry date</b>. Tap <b>＋ Add</b> on a suggestion to drop it onto your buy-list — or add a one-off (“Buy travel adapter”) with the <b>Add</b> button. Tick an item once you’ve <b>bought</b> it; bought things tuck into a collapsible group. The buy-list is built on the same store as your to-dos, so it’s backed up with everything else, and whenever anything’s waiting a <b>🛒 “Shopping list — N to buy”</b> nudge appears on <b>Home</b>. Your <b>Actions</b> tab stays just your to-dos — shopping lives on its own screen. Find it under <b>Care → 🛒 Shopping list</b>.',
      'No more realising at the airport that the sunscreen ran out: the app quietly rounds up what needs restocking or replacing, so your pre-trip shopping is a ready-made list.'),
    v('v93', '2026-08-18 · 12:00 UTC', false, 'Kits — bundle the things you always pack together',
      'You can now build a <b>Kit</b>: a reusable bundle of small things that always travel together — a <b>charging kit</b> (cables, plug, power bank), a <b>wash bag</b>, a <b>first-aid pouch</b>. Create and name your kits (each gets its own emoji) under <b>Settings → Kits</b>, picking their members from your item catalogue. Then add a whole kit <b>as one unit</b>: from a <b>template</b> (tap <b>🧰 Add a kit</b> — every item joins, and every trip using that template gets them), or straight onto a <b>trip</b> (the 🧰 <b>Kit</b> button on a trip’s toolbar). On the packing list the kit’s items <b>cluster together</b> under a <b>🧰 kit header</b> with a <b>Pack all</b> button, so you can tick the whole pouch packed in one tap instead of hunting its pieces one by one. You can also set or clear an item’s kit for a single trip from its editor’s new <b>Kit</b> field. Kits are saved in your backups and automatic snapshots.',
      'Stop re-adding and re-finding the same little clusters of gear: define a kit once, drop it in as a unit, and pack it as one — nothing in the bundle gets forgotten.'),
    v('v92', '2026-08-17 · 22:00 UTC', false, 'Search — find anything from one box',
      'A new <b>🔍 Search</b> button now sits in the top bar of <b>Home, Events, Templates, Care and Actions</b>, opening one search box that looks <b>across everything at once</b> — your <b>items</b> (by name or Swedish wording), your <b>templates</b>, your <b>trips</b> (by name or destination) and your <b>to-dos</b>. Results appear grouped and update as you type; tap any result to jump straight to it — an item opens in its editor, a template or trip opens itself, a to-do opens the Actions tab. As your catalogue grows past a few hundred items, this is the fastest way to reach a specific thing without remembering which template it’s in. Everything is searched <b>on your device</b>, instantly, offline.',
      'No more hunting through templates: type a few letters and jump straight to any item, list, trip or to-do in the whole app.'),
    v('v91', '2026-08-17 · 21:00 UTC', false, 'Diagnostics — see what went wrong',
      'A quiet safety-and-support feature: the app now keeps a small, private <b>Diagnostics</b> log of any errors it runs into, <b>on your device</b>. Find it at the bottom of <b>Settings → Diagnostics</b>. If something ever misbehaves — a screen fails to load, a save doesn’t go through — the details are recorded there instead of vanishing, so you (or I) can see the real cause rather than guessing. You can <b>Copy log</b> to share it, or <b>Clear</b> it any time, and it shows “all healthy” when there’s nothing to report. The log never leaves your device unless you copy and send it yourself. Most of the time you’ll never need it — it’s there for the rare occasion when you do.',
      'If the app ever hiccups on your phone, there’s now a real record of what happened — easy to copy and share for a quick fix, instead of an error that disappears.'),
    v('v90', '2026-08-17 · 20:00 UTC', false, 'The app tells you when an update is ready',
      'No more wondering whether you’re on the latest version. When a new version has been published and your device has quietly fetched it in the background, a small <b>“🎉 A new version is ready”</b> bar now slides up above the tab bar with an <b>Update now</b> button — one tap reloads straight into the new version. It only appears for a genuine update (never on a first install), and it never reloads on its own, so it won’t interrupt you mid-pack. The app checks for a new version when it opens and again each time you switch back to it. Combined with the little <b>version marker</b> in the bottom-right corner, you can always tell exactly which version you’re running and update the moment a new one lands.',
      'Publishing an update now reaches you reliably: reopen the app, tap “Update now” when the bar appears, and you’re current — no guessing, no repeated force-quitting.'),
    v('v89', '2026-08-17 · 19:00 UTC', false, 'A more polished, satisfying feel',
      'A visual and tactile polish across the app. <b>(1) Boarding-pass trip cards:</b> your events on Home and the Events tab now look like travel tickets — a coloured stub down the side, the trip name with its <b>destination and length</b> beneath, a <b>countdown badge</b> (highlighted when the trip is within a week), the day’s <b>weather glyph</b> when a forecast has been fetched, and a slim progress rail along the bottom that reads <b>✓ Packed</b> once you’re done. <b>(2) Colour-coded packing rows:</b> every item on a packing list now carries a small <b>dot in its category’s colour</b> — clothing, electronics, toiletries and so on each get their own hue — so a long list is far quicker to scan by eye. <b>(3) Satisfying packing:</b> ticking an item gives a little <b>pop</b> and a gentle <b>haptic tap</b> (on phones that support it), the readiness ring now fills in <b>live</b> as you tick (it previously only refreshed on reopening), and finishing a trip gives the ring a small celebratory <b>bounce</b>. All the motion respects your device’s “reduce motion” setting. Nothing about how packing works changed — it just feels nicer to use.',
      'The app is more pleasant to look at and to use: trips read like tickets at a glance, lists scan by colour, and packing each thing off gives a small, satisfying bit of feedback.'),
    v('v88', '2026-08-17 · 17:00 UTC', false, 'A fuller “How it works” guide',
      'The in-app <b>How it works</b> guide (here in Settings) got a thorough pass so it explains everything the app now does. It opens with a new <b>Quick start</b> — the whole app in four steps — for when you just need reminding of the loop. A new section describes the <b>readiness dashboard</b> that greets you at the top of every trip (the packed ring, days-to-go, weight and open-to-dos). The <b>colour</b> section was rewritten to match how the app actually looks today — the six coloured tabs (Home blue, Events green, Templates purple, Care amber, Actions red, Settings grey) and how each colour flows through its screens — replacing the older description. And the recent additions (<b>presets</b> and <b>laundry-aware quantities</b>) are woven in throughout. Nothing about the app changed — it’s purely a better explanation.',
      'When you can’t remember how something works, the built-in guide now covers it — start with the new Quick start, then dip into any section for the detail.'),
    v('v87', '2026-08-17 · 16:00 UTC', false, 'Trip presets — spin up a familiar trip in one tap',
      'If you take the same kinds of trips again and again — a weekend dive, a business trip with a run, an RV weekend — you can now save that whole setup as a <b>preset</b> and reuse it. Open any trip and tap <b>⭐ Save as preset</b> (in its toolbar), give it a name, and the app remembers the <b>recipe</b>: the activities you ticked plus every condition — full-trip vs quick, transport, season, WET options, forced weather gear and the laundry setting. It deliberately does <b>not</b> save the dates, destination or the packed items, since those change every trip. Then, on the <b>Home</b> builder, a new <b>⚡ Start from a preset</b> row appears — tap a preset and the whole form fills itself in, ready for you to add this trip’s name and dates and press Create Event. Manage or remove presets under <b>Settings → Trip presets</b>, and they’re included in your backups and automatic snapshots so you won’t lose them. A real time-saver for the trips you take often.',
      'Your regular trips are one tap away: save a trip’s setup once, then start the next one just like it without re-picking every activity and condition.'),
    v('v86', '2026-08-17 · 14:00 UTC', false, 'Laundry-aware quantities — no more twelve pairs of socks',
      'When you’ll have <b>laundry</b> on a trip, you don’t need one of everything per night — you wash and re-wear. The trip form (and a trip’s settings) now has a <b>🧺 “Laundry available on this trip”</b> toggle. Turn it on and the <b>per-night items</b> — socks, underwear, t-shirts and anything marked to scale with nights — are <b>capped at ' + LAUNDRY_CAP_NIGHTS + '</b> instead of stretching to one per night, so a two-week trip stops demanding a dozen pairs. <b>Short trips are never affected</b> (the cap only ever lowers a count, never raises it), and it changes only the <b>quantities</b> — your real trip length, dates and countdown stay exactly as they are. On the packing list a capped item shows a small <b>🧺</b> next to its ×count, and the <b>Bags &amp; weight</b> panel and the readiness <b>weight</b> tile update to match, so your load reflects what you’ll actually carry.',
      'Long trips pack realistically: flick on “Laundry available” and per-night basics stop multiplying to absurd numbers, while short trips and everything else are untouched.'),
    v('v85', '2026-08-17 · 12:00 UTC', false, 'A trip-readiness dashboard at the top of every trip',
      'Opening a trip now greets you with a clean <b>readiness hero</b> instead of a plain progress bar: a big <b>packed-progress ring</b> (filling up as you tick items, turning green at 100%) sitting beside three at-a-glance tiles — <b>days to go</b> (highlighted when the trip is within a week), <b>packed weight</b> (which turns red and calls it out if a bag is over its limit), and your <b>open to-dos</b> (tap to jump to the Actions tab). It’s the same information the app already tracked, now surfaced the moment you open a trip so you can see where things stand in a single glance. The <b>Start / Continue packing</b> button sits right underneath as before. Nothing about how packing works changed — this is purely a clearer, nicer summary.',
      'You see exactly how ready a trip is the instant you open it — how much is packed, how long you’ve got, whether a bag is overweight and what’s still on your to-do list — without hunting through the screen.'),
    v('v84', '2026-08-17 · 10:00 UTC', false, 'Automatic backups — a safety net you don’t have to think about',
      'Your data lives <b>only on this device</b>, so this release adds a quiet safety net. <b>(1) Automatic on-device backups:</b> the app now keeps recent full copies of everything (about one a day, and always one <b>just before any restore</b>), so a mistaken edit, an accidental delete or a wrong import is easy to undo. Find them in <b>Settings → Your data → Automatic backups</b>, each labelled with when it was taken and what it holds (“383 items · 14 templates · 5 trips”); tap <b>Restore</b> on any of them, or <b>Save a copy now</b> any time. It’s built to be safe even from itself — it will never record an empty database over your real data, and it always protects the richest copy from being cleared. <b>(2) A clear preview before importing:</b> choosing <b>Import backup</b> now first shows exactly what’s in the file — items, templates, trips, photos and the date it was saved — before anything is changed, and if a <b>Replace</b> would wipe most of your data it warns you loudly (and still saves a copy of your current data first). <b>(3) Your data at a glance:</b> the Your-data card now shows how much you have and the space it uses. Nothing about packing changed — this is all about never losing your work.',
      'A mistake or a bad import is no longer scary: the app keeps recent copies of your data by itself, shows you exactly what any backup contains before it touches anything, and always keeps a copy before a restore — so your work is genuinely hard to lose.'),
    v('v83', '2026-08-12 · 21:00 UTC', false, 'The whole tab bar is in colour now',
      'A visual lift for the bottom navigation. Before, only the <b>active</b> tab showed colour and the rest were grey. Now <b>every tab wears its own section’s colour all the time</b> — <b>Home</b> blue, <b>Events</b> green, <b>Templates</b> purple, <b>Care</b> amber, <b>Actions</b> red, <b>Settings</b> grey — each with a soft tinted circle behind its icon. The tab you’re currently on still stands out clearly: its circle fills in solid and its label goes bold. It makes the bar (and the Home screen) look brighter and more finished, and each tab is easier to pick out at a glance by colour. Purely visual; nothing about how the app works changed.',
      'The navigation bar looks much nicer — every tab is colour-coded and instantly recognisable, while the one you’re on is still obvious at a glance.'),
    v('v82', '2026-08-12 · 20:00 UTC', false, 'Updates now arrive reliably on iPhone',
      'A behind-the-scenes fix: previously, after publishing an update, your phone could keep running an old cached copy of the app even after fully quitting and reopening it — because the piece of code responsible for checking for updates was itself being cached, so it never noticed anything had changed. The update-check now includes the version number directly in its own request, which forces your phone to always fetch the latest copy. From now on, a normal quit-and-reopen after publishing is enough to get the newest version.',
      'You can trust that closing and reopening the app after an update actually gets you the new version, every time — no more repeated force-quitting or wondering if something worked.'),
    v('v81', '2026-08-12 · 10:00 UTC', false, 'Each page heading now wears its tab’s colour',
      'A small polish: the <b>heading at the top of each tab</b> now takes on that section’s <b>accent colour</b>, instead of being plain black everywhere. So <b>“AMS Packing List”</b> on <b>Home</b> is <b>blue</b>, <b>Events</b> is <b>green</b>, <b>Templates</b> is <b>purple</b>, <b>Care</b> is <b>amber</b>, <b>Actions</b> is <b>red</b> and <b>Settings</b> is <b>grey</b> — matching the lit tab in the bottom bar. It makes it instantly obvious which section you’re in. Purely visual; nothing about how the app works changed.',
      'You can tell which tab you’re on at a glance — the page title and the highlighted tab now share the same colour.'),
    v('v80', '2026-08-12 · 09:00 UTC', false, 'Icons that travel — colour on the weather, glyphs on every group',
      'A visual refresh so the app reads more like travel and packing, and its colours pop. <b>(1) The weather is now in colour.</b> The forecast strip and the little temperature chip up top show a <b>gold sun</b>, <b>slate clouds</b>, <b>blue rain</b>, <b>cyan snow</b> and an <b>amber lightning bolt</b> — so a glance tells you the sky, instead of everything being the same grey. <b>(2) Every packing-list group now has a glyph.</b> Whichever way you <b>Group by</b> — When, Where (your bags) or Category — each heading gets a small travel/packing icon: 👕 Clothing, 👟 Footwear, 🔌 Electronics, 🧳 Checked luggage, 🎒 Hiking backpack, 🌅 Morning, 🚪 At the front door, and so on. The same glyphs show in <b>Packing Mode</b>. It makes the list far quicker to scan by shape and colour. <b>(3) The interface icons pick up each area’s colour.</b> The little back/edit/settings icons now take on the <b>section’s accent</b> — teal on Care… actually, see the next point — so the app feels colour-coded by where you are. <b>(4) The two flat teals now pop.</b> The overall <b>brand teal</b> is brighter and cleaner, and the <b>Care</b> area moves from a dull teal to a warm <b>amber</b> — a classic teal-and-amber travel pairing that gives the app some warmth. <b>(5) The Home tab is now a suitcase</b>, so the very first icon says “trip”. Nothing about how the app works changed — it’s purely how it looks.',
      'The app looks the part now — the weather reads at a glance in real colour, every list group carries a travel glyph you can scan by, and the palette finally pops.'),
    v('v79', '2026-08-11 · 18:00 UTC', false, 'Force-pack weather gear — a “just in case” switch per trip',
      'A new way to <b>deliberately pack weather gear</b>, even when the forecast (or the season) says you won’t need it. Open a trip’s settings and you’ll find a new <b>Force-pack weather gear</b> box, right under <b>Time of year</b>, with a tick for <b>Rain / Cold / Heat / Wind / Snow</b>. Tick one and <b>every item you’ve tagged for that condition is pulled straight into the packing list</b> — no destination, no forecast, no internet needed. This is the switch you wanted for the classic cases: heading <b>high into the mountains on a summer trip</b>, so you <b>force in your cold-weather kit</b> (gloves, hat, warm layers) even though it’s July; or packing a <b>rain layer as a precaution</b> on a trip the forecast calls dry. It works hand-in-hand with the existing weather tags: an item still needs to be <b>tagged</b> (in its editor, under <b>Weather</b>) as Rain / Cold / etc. to be eligible — this new toggle just decides whether that tagged gear is <b>held back for the forecast</b> (the default) or <b>forced in for this particular trip</b>. Your choices show up in the <b>✨ Trip setup</b> recap at the top of the event, and editing them and re-saving regenerates the list. Leave every box unticked and nothing changes — weather gear stays held back until a fetched forecast asks for it, exactly as before. To get you started, ready-tagged cold items now come built in: <b>Warm gloves</b>, <b>Warm beanie</b> and <b>Warm hat</b> in your <b>Travel</b> base list, plus <b>Insulated gloves</b>, <b>Insulated beanie</b>, a <b>Balaclava</b> and a packable <b>Rain jacket</b> in your <b>Hiking</b> list (so forcing Cold or Rain works even on a quick hiking activity with no base). All are already marked for <b>Cold</b>, so ticking <b>Cold</b> on a summer trip pulls them straight in with nothing to set up; tag your own gear the same way in any item’s <b>Weather</b> box. <em>(This refreshes the built-in starter templates, so any tweak you’d made to a built-in list is reset to the seed — your own templates are untouched.)</em>',
      'Pack for conditions you know are coming even when the forecast can’t see them yet — force your cold-weather or rain gear into a specific trip in one tick, whatever the season or the weather report.'),
    v('v78', '2026-08-11 · 09:00 UTC', false, 'Places visited — zoom in on the map',
      'The <b>Places visited</b> map can now <b>zoom</b>, so trips that sit close together stop overlapping into a single blob. Two things changed. <b>(1) It opens already framed on where you’ve been.</b> Instead of always showing the whole globe, the map now <b>fits itself to your pins</b> the moment it opens — so two trips in, say, Scandinavia appear as <b>two separate pins</b> you can actually tell apart and tap, not one dot on top of another. <b>(2) You can zoom and move around freely.</b> There’s a small <b>＋ / − / ⤢ (fit)</b> button stack in the map’s top-right corner — the <b>⤢</b> re-frames everything at any time. You can also <b>pinch on a trackpad</b> (or hold <b>⌘</b> and scroll) to zoom, <b>double-click</b> a spot to zoom in (double-click again once you’re deep in to pop back out to the fitted view), and <b>drag</b> to move around once you’re zoomed in. A plain two-finger <b>scroll still scrolls the page</b> — the map only zooms on a deliberate pinch or ⌘-scroll, so it never traps your scrolling. (Pinch and double-tap work on a phone too.) The pins keep their neat size as you zoom (they don’t balloon), the coastline stays crisp, and a gentle drag never accidentally fires the pin underneath. It’s all still drawn <b>inside the app</b> — fully offline, no outside map service.',
      'Nearby trips no longer merge into one dot — the map opens framed on your travels and you can zoom right in to separate and tap places that sit close together.'),
    v('v77', '2026-08-10 · 21:30 UTC', false, 'Group by GA / WET — pack one activity at a time',
      'The <b>Group by</b> toolbar on an event gains two new views: <b>GA</b> and <b>WET</b>. Tap <b>GA</b> and the list reorganises so each <b>Goal Activity</b> you packed for — <b>Golf, Hiking, Diving…</b> — becomes its own group, and tapping <b>WET</b> does the same for your <b>Workout / Exercise</b> lists — <b>Swim, Bike, Run…</b>. So you can round up <b>all your golf kit</b>, or <b>everything for your runs</b>, in one place instead of hunting through the whole list. Anything that isn’t specific to that activity — your <b>common base</b>, the <b>transport kit</b>, other activities and items you added by hand — gathers into a tidy <b>“Everything else”</b> group you can collapse out of the way. (Shared gear lives in the base, so each activity group holds the kit that’s special to it.) The two buttons only appear when a trip actually packs for that kind of activity, and — like the other views — your choice is remembered.',
      'Pack activity-by-activity — gather every golf or running item at a glance, so nothing activity-specific gets left behind.'),
    v('v76', '2026-08-10 · 20:00 UTC', false, 'Trip setup — a pretty recap of every choice on the event screen',
      'Open any event and you now see a tidy <b>✨ Trip setup</b> card at the top, laying out <b>everything you chose when you created it</b>. Each single choice — <b>List type</b> (Full trip / Quick activity), <b>Dates</b> (with the night count), <b>Destination</b>, <b>Way of transport</b>, <b>Time of year</b> and <b>Catering</b> — gets its own little tile with an icon, so it reads at a glance. Below those, your <b>WET options</b> (Indoor / Outdoor / Race) and every <b>activity you ticked</b> appear as neat pills, <b>grouped under GA / WET / OE</b> just like the picker. The card is <b>collapsible</b> (tap the header) so it never crowds the packing list, and it recolours for light and dark themes. Trip-only choices (transport, catering) are hidden on Quick-activity events, since they don’t apply. Behind the scenes the small summary chips that used to sit up top moved into this card, leaving just the countdown and weather chips for a cleaner header.',
      'Remember at a glance why a list looks the way it does — every setting behind the trip is now shown clearly in one good-looking place, instead of only living in the settings form.'),
    v('v75', '2026-08-07 · 08:04 UTC', false, 'How-it-works guide caught up with the Actions tab',
      'A documentation refresh so the in-app <b>How it works</b> guide covers everything the app now does. Three gaps were closed. <b>(1)</b> The whole <b>Actions</b> tab — the to-do list (item-tied and general to-dos, priority, a phase-or-date “when”, the Done group, and the ☑ open-to-do count on item rows) — now has its own chapter; the “Getting around” list is corrected from <b>five tabs to six</b> and names the red <b>Actions</b> tab. <b>(2)</b> The Home-screen reminder cards are now spelled out together — the trip <b>⏰</b>, maintenance <b>🧰</b>, the new <b>🗒️ “To-dos to tackle”</b> card, and the backup <b>💾</b> nudge. <b>(3)</b> The <b>All items · table</b> chapter now describes the toolbar’s custom <b>sort</b> and <b>reorderable columns</b> (both remembered on the device). Nothing about how the app works changed — only the guide.',
      'The built-in guide is complete again — the Actions to-do list and the latest table controls are documented, so nothing the app does is left unexplained.'),
    v('v74', '2026-08-06 · 18:00 UTC', false, 'World map — a journey line and a “most visited” badge',
      'Two small touches for the new <b>Places visited</b> map. <b>(1) A journey line.</b> Your trips are now joined by a <b>subtle dotted line in date order</b> (oldest to newest), gently flowing across the map — so you can trace the path your travels have taken over time. Trips <b>without a date</b> still get their pin but sit off the line, since there’s no way to place them in the sequence. <b>(2) A “most visited” badge.</b> Up next to the place/trip count sits a little <b>★ badge naming the place you’ve been most</b> (e.g. “★ Stockholm, SE · 3 trips”). It appears only once somewhere has been visited <b>more than once</b> — until then, nothing stands out to highlight. Both are drawn inside the app, so the map stays fully offline.',
      'See your travels as a story, not just dots — follow the line to relive the order you went, and spot your favourite haunt at a glance.'),
    v('v73', '2026-08-06 · 17:00 UTC', false, 'Places visited — a world map of your trips',
      'A brand-new <b>world map</b> that pins <b>everywhere you’ve been</b>. Open the <b>Events</b> tab and tap the new <b>🌍 Map</b> button up top. Every trip that has a <b>destination</b> becomes a glowing pin on a clean, hand-drawn map — and <b>repeat visits to the same place merge into one pin</b> (with a little number showing how many trips), so a city you keep coming back to shows once, not ten times. <b>Tap a pin</b> to jump to that place in the list below, where each visit links straight to its trip. If a place has already had its <b>weather</b> looked up, it’s pinned automatically; for any trip whose destination hasn’t been located yet, a one-tap <b>“Find places on the map”</b> button looks them all up at once (that part needs the internet) and then <b>remembers the spot forever</b>, so the map keeps working offline. The whole map is drawn <b>inside the app</b> — no outside map service, no tracking, nothing leaves your phone — and it recolours to match the app’s light and dark themes.',
      'See your travels at a glance — a single at-a-glance picture of everywhere your trips have taken you, built straight from the destinations you already type in.'),
    v('v72', '2026-08-06 · 15:00 UTC', false, 'All items · table — your sort & column order',
      'The <b>All items · table</b> now bends to how <b>you</b> like to work. A tidier <b>toolbar</b> sits above the grid: <b>Sort</b> the whole table by <b>Name, Weight, Storage, Container</b> or <b>how many lists</b> an item is in, and tap the <b>▲/▼</b> button to flip between ascending and descending. Next to it, a <b>Columns</b> button opens a little panel where you can <b>reorder the “① the item itself” columns</b> (weight, storage, flags, container, colour…) with ▲▼ — put the ones you care about first. Both your <b>sort choice</b> and your <b>column order</b> are <b>remembered on this device</b>, so the table opens just how you left it. We also <b>polished the header</b> — the ①②③ group titles now line up and stand out more — and <b>removed the little up/down spinner arrows</b> from the <b>Weight</b> cells for a cleaner look (just type the number).',
      'Make the spreadsheet fit your habits — sort by what matters, arrange the columns in your own order, and have it stick every time you come back.'),
    v('v71', '2026-08-06 · 13:00 UTC', false, 'All items · table — edit everything in one spreadsheet',
      'A new <b>spreadsheet view</b> of every item, reached from the <b>Care</b> tab → <b>All items · table</b>. Each row is an item; the columns are grouped just like an item’s editor: <b>① the item itself</b> (weight, storage, 💧/⚡/⚠️ flags, container, colour, size, maker, model), <b>② in this list</b> (qty, section), and <b>③ a tick-box per template</b> showing which lists the item is in. <b>Edit right in the grid:</b> type a weight or storage place, tick a flag, and it updates the item <b>everywhere it’s used</b>; tick or untick a template box to <b>file the item in or out</b> of that list on the spot (unticking an item’s last list parks it safely in <b>Loose items</b> rather than deleting it). The <b>qty</b> and <b>section</b> columns are per-list, so they’re editable when an item lives in a single template and show “<b>N lists</b>” (tap the name to open it) when it’s shared. There’s a <b>search box</b> to filter to a few rows, the <b>item name stays pinned</b> on the left, and you <b>swipe sideways</b> for the rest of the columns — so it works on the phone and really shines on an iPad or Mac. Nothing new to learn: it’s the same data as the per-item editor, just all at once for fast bulk tidying.',
      'See and fix your whole kit at a glance — weights, storage places, flags and which templates each thing belongs to — editing many items far faster than opening them one by one.'),
    v('v70', '2026-08-06 · 12:00 UTC', false, 'Maintenance mode — a whole-database overview, with duplicate spotting',
      'A new <b>Maintenance mode</b> in <b>Settings</b> (tap <b>🗂️ Maintenance mode — database overview</b> at the top) gives you a single, <b>one-line-per-item</b> table of your <b>entire catalogue</b> — the fastest way to keep everything current in one place. Each row shows the <b>item</b> (with its category and any Swedish wording), <b>which templates it’s in</b> (tap a template name to jump straight there), its <b>flags</b> at a glance — <b>⚡ charging</b> (with the plug type), <b>💧 liquid</b>, <b>⚠️ restricted</b>, <b>🌙 per-night</b>, <b>⭐ short list</b>, <b>🧰 has care</b>, <b>📷 photo</b>, <b>🚫 not in use</b> — plus its <b>weight</b> and <b>where it’s stored</b>. <b>Tap any row</b> to open that item’s editor. A <b>search box</b> filters by item, template or storage; the same <b>category chips</b> from the Care tab narrow it further; and you can <b>sort</b> by <b>A–Z</b>, <b>Heaviest</b>, <b>Most used</b> (in the most templates) or <b>Category</b>. <b>The bonus:</b> the app now <b>hunts for probable duplicates</b> — items with the same or very similar names (it treats “Sunglasses” and “Sun glasses” as a pair) — and surfaces them in a <b>⚠️ Possible duplicates</b> panel at the top, with each highlighted <span style="color:var(--warn-txt)">in amber</span> in the table too. Nothing is ever merged automatically — it just <b>flags</b> look-alikes so you can open each, then rename one or remove the copy you don’t need. There’s also an <b>Export (Excel)</b> button that saves the whole overview as a spreadsheet (one row per item, every flag as a column) for reviewing away from the phone.',
      'One screen to keep your whole item database honest — see every item, its flags, weight, storage and templates at a glance, jump straight to anything that needs a tweak, and catch accidental duplicates before they multiply.'),
    v('v69', '2026-08-05 · 22:15 UTC', false, 'Every item now has a “stored” place — the Stored view works out of the box',
      'Following on from the new <b>Stored</b> grouping, every item in the built-in templates now comes with a sensible <b>“Where it’s stored”</b> place already filled in, so you can group a trip by <b>Stored</b> and immediately pack place-by-place. The rough scheme: everyday <b>clothes</b> in the <b>Bedroom wardrobe</b> (smaller items — socks, underwear, tees — in the <b>Chest of drawers</b>), <b>toiletries &amp; meds</b> in the <b>Bathroom cabinet</b>, <b>shoes</b> and grab-on-the-way-out things (sunglasses, wallet, passport) in the <b>Hall closet</b>, <b>food</b> in the <b>Kitchen cupboard</b>, and <b>sport/adventure gear</b> in the <b>Basement / cellar</b> — with <b>seasonal bulk</b> (skis, crampons, spare pillows) up in the <b>Loft / attic</b>. As you asked, <b>nothing is filed under “Garage”</b> — those things live in the attic or basement. Your bags in <b>Containers</b> got the same treatment. It’s all a <b>starting point</b> — open any item’s <b>Storage &amp; maintenance</b> panel to set its real spot. <b>Note:</b> this refreshes the built-in starter templates, so a storage place you’d set yourself on a built-in item is replaced by this default (just re-enter it); your own templates are untouched.',
      'Group any trip by <b>Stored</b> and it just works — walk to the cupboard, the attic or the basement and grab everything from that one place in a single sweep.'),
    v('v68', '2026-08-05 · 21:30 UTC', false, 'Collapsible groups + a “Stored” view + a clearer “Show all”',
      'Three improvements to the trip Packing List, from your suggestions. <b>(1) Fold any group shut.</b> In the grouped list, <b>tap a group heading</b> to collapse it (tap again to reopen) — perfect for hiding a bag or a room you’ve already packed so you can focus on what’s left. Each heading now also shows a small <b>packed / total</b> count, so you can see a group’s progress at a glance even when it’s folded. <b>(2) A new “Stored” grouping.</b> The <b>Group by</b> row gains a <b>Stored</b> option that groups items by <b>where they live at home</b> (each item’s “Where it’s stored” place) — so you can walk to the garage, or the hall closet, and grab everything from that one spot in a single trip. It appears once at least one item on the trip has a storage place set (set it in an item’s editor, under <b>Storage &amp; maintenance</b>); anything without a place gathers under <b>No place set</b>. <b>(3) A clearer “Show all”.</b> The dashed <b>Show all</b> button in the <b>Sort out</b> row now has a bolder outline so it’s easier to spot.',
      'Pack room-by-room or bag-by-bag: group by where things are stored, then fold away each group as you clear it — with a packed/total count keeping score.'),
    v('v67', '2026-08-05 · 20:30 UTC', false, 'Every item now has a weight',
      'Every packable item in the built-in templates now carries a <b>sensible weight estimate</b> (in grams), so the <b>Bags &amp; weight</b> panel and the <b>Heaviest-first</b> view work properly from the start — no more “add a weight to see totals”. The figures are honest guesses based on each item’s type (a t-shirt ~150 g, running shoes ~300 g, a drysuit ~3.5 kg, a phone ~200 g, and so on); <b>to-dos/reminders</b> carry no weight, as they’re not packed. They’re all <b>fully editable</b> — open any item and set its real weight to make your bag totals exact. Combined with the new <b>Containers</b> (each bag’s own max weight), your trips now show a realistic <b>total load</b> and a reliable <b>over-limit</b> warning per bag straight away. <b>Note:</b> this arrives as a refresh of the built-in starter templates, so any weight you’d set yourself on a built-in item is replaced by the estimate — just re-enter it. Your own templates are untouched.',
      'Bag totals and the over-weight warnings are useful immediately — the whole trip has real weights out of the box, ready for you to fine-tune.'),
    v('v66', '2026-08-05 · 19:30 UTC', false, 'Containers — your bags as things in their own right',
      'Your <b>bags, duffels and backpacks</b> are now proper records, not just names in a dropdown. Open the <b>Care</b> tab and tap <b>🎒 Containers</b> to find them. Each container is edited like any item — <b>photos</b>, <b>colour</b>, <b>brand</b>, where it’s <b>stored</b>, and its full <b>care/maintenance</b> record — plus two container-specific fields: <b>Capacity</b> (litres) and <b>Max weight</b> (kg). Because a container is a maintainable object, its upkeep (proof a rain cover, oil a zip, service a wheeled case) shows up on the <b>Care</b> tab alongside everything else, and it’s all included in your <b>JSON backup</b>. Two nice knock-ons: every container you add is offered when you pick <b>where an item is packed</b>, and — the big one — the trip <b>Bags &amp; weight</b> panel now warns you against <b>each bag’s own max weight</b> (not just a generic carry-on/checked guess), so “over limit” is finally accurate for the specific bag you’re using. Your list comes <b>pre-seeded</b> with your usual bags (carry-on, checked case, Bellroy, hiking pack, duffel, golf bag, toiletry bag…) and sensible capacities — all editable, so tweak, add or remove to match your real kit.',
      'A single home for your bags — what they are, how big, how heavy they’re allowed to be, where they live and how to look after them — and accurate over-weight warnings per bag when you pack.'),
    v('v65', '2026-08-05 · 18:00 UTC', false, 'Context now applies to Workout / Exercise lists only',
      'Two tidy-ups to the <b>Context</b> choice when you create an event. First, the <b>Training</b> option is <b>gone</b> — the choices are now just <b>Indoor</b>, <b>Outdoor</b> and <b>Race</b>. Second, and more importantly, Context now <b>only affects your Workout / Exercise &amp; Training (WET) lists</b> — Swim, Bike, Run and the like — where “indoor vs outdoor vs race” genuinely changes the kit. It <b>no longer touches</b> your Goal-Activity lists (Golf, Hiking, Diving…), the common Travel base, or the transport lists: those are always included in full regardless of the Context you pick. So choosing <b>Outdoor</b> for a trip narrows your <b>Run</b> gear to the outdoor set without hiding anything from, say, your Hiking or Travel packing.',
      'The Context switch does exactly what you’d expect — it fine-tunes your workout kit — without silently dropping items from your other lists.'),
    v('v64', '2026-08-05 · 17:00 UTC', false, 'Every built-in template now starts with sections',
      'All of the built-in starter templates now arrive <b>pre-organised into sections</b>, so the new Sections feature is working for you from the off. <b>Diving</b> is fully detailed as a showcase — <b>Drysuit &amp; exposure</b>, <b>Rig / BCD</b>, <b>Regulators</b>, <b>Lights</b>, <b>Mask &amp; fins</b>, <b>Instruments &amp; deco</b>, <b>Accessories</b>, <b>Documents &amp; certification</b>, each pre-loaded with the usual gear. Every other populated list (Travel, RV, Golf, Hiking, Swim, Bike, Run and the transport bases) is grouped into a clean, consistent set — typically <b>Clothing</b>, <b>Footwear</b>, <b>Gear &amp; equipment</b>, <b>Tech &amp; devices</b>, <b>Toiletries &amp; body care</b>, <b>Food &amp; drink</b>, <b>Documents &amp; money</b>, <b>Comfort &amp; misc</b> and <b>Reminders</b> (only the ones a list actually needs). The empty activity scaffolds (Freediving, Strength, Yoga / Mobility, Breath work) come with a small <b>starter skeleton</b> of sections, ready to fill. It’s all just a <b>starting point</b> — rename, reorder, delete or add sections, and move items between them, however suits you. <b>Note:</b> this arrives as a refresh of the built-in starter templates, so anything you had already added to a <b>built-in</b> list is replaced by these pre-filled versions. Your own templates and everything in them are untouched.',
      'Open any template and it already reads as a tidy, sectioned overview — and those groupings flow straight onto your trip packing lists, with no setup on your part.'),
    v('v63', '2026-08-05 · 16:00 UTC', false, 'Sections — group a template’s items, and see them on the trip',
      'You can now split any <b>template</b> into named <b>sections</b> and see those groupings carry all the way through to a trip’s <b>Packing List</b>. On a template, tap the new <b>Sections</b> button to add, rename, reorder or delete sections — for a Diving list that might be <b>Lights</b>, <b>Rig</b>, <b>Drysuit-related</b>, <b>Regulators</b>. Then open any item and, under <b>“② In this list”</b>, pick its <b>Section</b> (or <b>＋ New section…</b> to make one on the spot). The template view then shows tidy, counted section blocks in the order you chose, with anything unassigned under <b>Ungrouped</b>. Crucially, a section is remembered <b>per template</b>: the same head torch can sit in <b>Lights</b> in your Diving list and a different section in your Running list, with neither affecting the other. On a <b>trip</b>, a new <b>Section</b> option appears in the <b>Group by</b> row (only when the trip actually has sections); items keep the section from the list they came from, same-named sections from different lists merge under one heading, and everything without a section falls under <b>Everything else</b>. You can also re-file an item’s section right on the trip from its quick editor, and that choice sticks. Deleting a section never deletes items — they simply move to Ungrouped. Sections are saved on-device and travel in your <b>JSON backup</b> and shared trips.',
      'A long template becomes a clear, sectioned overview — and, for the first time, those same groupings show up on the actual packing list for a trip, so related gear (all your regulators, all your lights) stays together right where you pack.'),
    v('v62', '2026-08-05 · 14:00 UTC', false, 'Open to-dos surface on the Home screen',
      'The <b>Home</b> screen now shows a small <b>to-dos reminder</b> up top, alongside the trip ⏰, maintenance 🧰 and backup 💾 nudges — a red-tinted <b>🗒️ “To-dos to tackle”</b> card that counts your <b>open actions</b> (and calls out how many are <b>high-priority</b>), tapping through to the <b>Actions</b> tab. It only appears when something is actually open, so a clear list keeps Home clean. Nothing else on Home moved — the reminder sits with the other nudges, above the <b>Create Event</b> builder.',
      'You see what still needs <i>doing</i> the moment you open the app, without hunting for the Actions tab — the urgent, high-priority items are called out right where your eye already lands.'),
    v('v61', '2026-08-05 · 13:00 UTC', false, 'Tiny version marker in the tab-bar corner',
      'A very small <b>build-version label</b> (e.g. “v61”) now sits in the <b>far bottom-right corner</b> of the navigation bar, just past the Settings tab — a quiet reference so you can tell at a glance which version is running on any device. It’s deliberately faint and doesn’t get in the way of tapping Settings. The fuller “AMS Packing List · v61” line at the bottom of the Home screen is unchanged.',
      'You can confirm the running version instantly, from any screen, without opening Settings.'),
    v('v60', '2026-08-05 · 12:00 UTC', false, 'Actions — a to-do list, per item and central',
      'A new <b>Actions</b> tab (the red one in the bottom bar) gives you a proper <b>to-do list</b>. Actions come in two kinds. <b>Tied to an item:</b> open any item’s editor (Templates tab) and use the new <b>Actions</b> panel to jot things to do for it — “replace foam tips”, “re-wax the zip”, “charge before the trip”. Because each item lives once in the catalog, its actions follow it everywhere, and the item’s row shows a small <b>☑ count</b> of open to-dos. <b>General (loose):</b> on the Actions tab tap <b>New</b> to add a to-do that isn’t about any one item — you can still tie it to an item later from the same editor. Every action can carry a <b>priority</b> (High / Normal), a <b>when</b> (a trip phase like “≥1 week ahead”, or a specific <b>date</b>), and a tick to mark it <b>done</b>. The <b>Actions</b> tab gathers them all in one place, open ones first (High before Normal, soonest first), with completed ones tucked into a collapsible <b>Done</b> group. Ticking an item’s action done is <b>permanent on that item</b> — it doesn’t reset each trip. Actions are stored on-device like everything else and are <b>included in your JSON backup</b>. Also in this release: an item’s big <b>name</b> now sits at the very top of its editor, above the “① The item itself” heading, with the redundant “Item name” label removed.',
      'One place to track everything you need to <i>do</i> — not just pack — whether it belongs to a specific piece of gear or stands on its own, sorted so the urgent, soonest things rise to the top.'),
    v('v59', '2026-08-05 · 08:00 UTC', false, 'Backups now include your Storage places too',
      'A follow-up so a <b>JSON backup is a truly complete restore point</b>. Your <b>photos, care records and every item detail were already saved</b> in the backup (they live inside each item), and so were all your templates and trips. The one thing that lived <b>outside</b> the main store was the custom <b>Storage places</b> list you manage in Settings — plus your theme and list-view choice. Those are now <b>included in Export backup (JSON)</b> and <b>restored on Import</b>. Storage places are <b>merged</b> on import (you never lose a place you already had). Older backup files still import fine — they simply have no places to add. Nothing about the data itself changed; the backup is just now 100% complete.',
      'Export/Import is now a full, faithful copy of everything you’ve set up — including your custom storage places — so moving to a new device or recovering after a browser wipe leaves nothing behind.'),
    v('v58', '2026-08-04 · 19:30 UTC', false, 'Keep your data safe — storage protection + backup reminders',
      'Two safeguards for the work you put into your lists, since everything lives <b>on this device</b> (in the browser) and nothing is uploaded. <b>(1) Storage protection:</b> on launch the app now asks the browser to mark its storage as <b>persistent</b>, so your data isn’t auto-deleted under storage pressure or by Safari’s clean-up of sites left unused. <b>(2) Backup reminders:</b> the app remembers when you last saved a backup and shows a gentle <b>💾 Back up your data</b> reminder on the Home screen when you have trips and it’s been a while (or you’ve never backed up) — tap it to jump to the export, or ✕ to be reminded later. <b>Settings → Your data</b> now also shows, at a glance, whether your storage is <b>🔒 protected</b> and <b>when you last backed up</b>. Nothing about your data changed — these just make it harder to lose. The strongest protection is still to <b>install the app</b> (iPhone: Share → Add to Home Screen; Mac: File → Add to Dock) and keep an <b>exported backup</b> in Files / iCloud Drive.',
      'Your hard-entered lists are far less likely to vanish: the browser is asked to protect them, and the app nudges you to keep a backup file — the real insurance if a browser ever clears its data.'),
    v('v57', '2026-08-04 · 17:00 UTC', false, 'Mark an item “Not in use” instead of deleting it',
      'Items you no longer pack — <b>sold, broken, destroyed, replaced, lost</b> — can now be set to <b>“Not in use”</b> without losing the record. In an item’s editor, open <b>Details &amp; ownership</b> and tick <b>🚫 Not in use</b>; a small <b>Reason</b> dropdown then lets you note why (Sold / Broken / Destroyed / Replaced / Lost / Other). A “Not in use” item is <b>kept exactly as it was</b> — its photos, care record, history and template memberships all stay — but it is <b>never added to a new trip’s packing list</b>, so retired gear stops cluttering what you actually pack. In your template and Care lists it stays visible but <b>greyed out</b> with a <b>🚫 Not in use</b> tag, and a new <b>🚫 Not in use</b> filter chip lets you round up everything you’ve retired. Existing trips already built are untouched. This is different from the <b>Condition</b> field (New / Good / Worn / Needs replacing), which grades a thing you still own and pack — an item usually goes <b>Needs replacing</b> first, then <b>Not in use</b> once you’ve actually replaced it.',
      'Retire gear you no longer use — sold, broken or replaced — and it drops out of every future packing list while its full record stays on file, so nothing’s lost and nothing irrelevant clutters your trips.'),
    v('v56', '2026-08-03 · 17:30 UTC', false, 'Record more about each item — a “Details & ownership” panel',
      'Every item can now carry a lot more about the <b>physical object</b>, in a new collapsible <b>Details &amp; ownership</b> panel in its editor (Templates tab), tucked below Storage &amp; maintenance so the everyday packing view stays clean. New optional fields: <b>colour</b>, <b>size</b> and <b>manufacturer</b> (dropdowns that <b>grow as you use them</b> — pick a value you\'ve entered before, or “＋ Add new…”), <b>model / product name</b>, <b>owner</b> (whose it is), <b>condition</b> (New / Good / Worn / Needs replacing), <b>quantity owned</b>, <b>price</b> with a selectable <b>currency</b>, a <b>purchase / reorder link</b>, <b>acquired</b> date, <b>serial number</b>, and <b>warranty-until</b> and <b>expiry / replace-by</b> dates. Because each item now lives once in the catalog (the earlier “Endeavour 2” rebuild), every one of these is a property of the item itself — fill it in once and it\'s the same everywhere the item appears. Everything is optional; leave a field blank and nothing changes. Two of these fields also show <b>at a glance</b> on the item rows (in a template and in the Care tab): the <b>owner</b> as a 👤 tag, and the <b>condition</b> as a small badge — but only when it needs attention (<b>Worn</b> or <b>♻️ Replace</b>), so healthy gear stays quiet.',
      'The app quietly becomes a proper record of your gear — what it is, what it cost, whose it is, and when it needs replacing — without cluttering the packing flow, since it\'s all tucked in one optional panel, with just the owner and a “needs replacing” flag surfaced on the item rows.'),
    v('v55', '2026-08-03 · 16:50 UTC', false, 'Settings icon changed from a sun to a nut',
      'The Settings icon — in the bottom nav bar and on the "Event settings" button — was a circle with radiating rays that looked like a sun and could be confused with the weather-forecast sun. It\'s now a <b>hexagonal nut</b> (the nuts-and-bolts kind), which is a more conventional symbol for settings and clearly distinct from the weather icons.',
      'The Settings icon is now unmistakably a settings icon, with no chance of being mistaken for the weather sun.'),
    v('v54', '2026-08-03 · 16:15 UTC', false, 'Retired the last of the old copy-based plumbing',
      'The final step of the “Endeavour 2” rebuild, and a purely <b>under-the-floor</b> one — nothing you can see or do has changed. Since v52 each item has really lived <b>once</b> in the catalog, but the item editor’s <b>In these templates</b> panel still worked the old way, matching items <b>by name</b> across lists and carrying a hidden rename-fixing routine from the copy era. That’s now gone: ticking a template adds or removes this <b>one</b> item by its <b>stable id</b>, straight to a membership, and renaming needs no special handling because every template already points at the same item. The result is simpler, sturdier code with no reliance on names as the glue — the whole point of the rebuild. Add-to-many-templates, renaming, promoting a trip-only item and the auto-tidy of the Loose bin all behave exactly as before.',
      'The name is no longer the glue: which templates an item belongs to is tracked by its permanent id, so links can’t be broken by a rename or a same-named item — a sturdier base with no change to how anything works.'),
    v('v53', '2026-08-03 · 15:30 UTC', false, 'The item editor now shows its three layers',
      'The first <b>visible</b> step of the “Endeavour 2” rebuild. The item editor is the same fields as before, just <b>grouped into three clearly-labelled sections</b> so it’s obvious what each choice affects: <b>① The item itself</b> — name, weight, ⚡/💧/⚠️ flags, its default container &amp; when, and storage &amp; maintenance — the things that are <b>true everywhere</b> you use the item; <b>② In this list</b> — the qty, per-night scaling, the “only include when…” conditions and note — the choices that are <b>just for this template</b> and don’t touch the same item in other lists; and <b>③ In these templates</b> — the tick-list of which lists this one item belongs to. Nothing you can do has changed — it’s the same editor, now laid out so the shared-vs-per-list distinction is plain at a glance.',
      'The editor now reads at a glance: what’s part of the item everywhere, what’s specific to this one list, and where the item is filed — so you always know which lists an edit will affect.'),
    v('v52', '2026-08-03 · 13:09 UTC', false, 'New foundation: every item lives in one place',
      'A big <b>under-the-floor rebuild</b> (“Endeavour 2”, step 3 of the plan). Until now, an item that appeared in several templates was actually stored as several separate copies that only shared a name. From this version each item lives <b>once</b> in a single catalog, and every template simply <b>refers</b> to it — the same item, not a copy. Two things you can notice: (1) <b>edit an item once and the change shows everywhere</b> it appears (its name, category, weight, flags, care…), while (2) list-specific choices like <b>which bag it goes in</b> stay per-template, so changing the bag in one list doesn’t disturb the others. Nothing about how the app looks or the trips you build has changed — this is the sturdy base the app will grow on. Your data moves across automatically the first time this version loads.',
      'One tidy source of truth for every item: edit it once and it’s right everywhere, with no drifting duplicates — so the app can grow far beyond today.'),
    v('v51', '2026-08-01 · 09:00 UTC', false, 'Add a loose item straight from the Care tab',
      'Two fixes to the Care tab’s <b>All items</b> tool. First, <b>＋ New item</b> now lets you choose <b>“— No template · keep as a loose item —”</b> in the <b>Add to</b> picker, so you can jot something down from here without forcing it into a template — it lands in the <b>Loose items</b> bin and opens ready to edit. (Before, you had to pick a template.) Second, once you have loose items, the <b>⚠️ No template</b> filter chip appears alongside 💧/⚡/⚠️/🧰/📷, so you can round up everything not yet filed. The chip only shows when loose items actually exist — the same rule every category chip follows — which is why it was missing when nothing was loose yet.',
      'Capture a thought as a loose item without leaving the Care tab, then filter the list down to everything still needing a home.'),
    v('v50', '2026-07-31 · 21:00 UTC', false, 'Category filter chips inside each template too',
      'The same <b>quick-filter chips</b> added to the Care tab now sit at the top of <b>every template’s own item list</b> (and the <b>Loose items</b> bin). Open a template and tap <b>💧 Liquids</b>, <b>⚡ Charging</b>, <b>⚠️ Restricted</b>, <b>🧰 Has care</b> or <b>📷 Photo</b> to see just those items within that list; tap several to combine them (it shows items matching <b>any</b> chosen category). Only categories that actually occur in that template show up, each with a count, and <b>Show all</b> clears them. The counts stay live as you add, batch-add or remove items. (The <b>⚠️ No template</b> chip is left off inside the Loose bin, where every item is loose anyway.)',
      'Zero in on one kind of thing inside a single template — every liquid in your wash-bag list, every chargeable in the tech list — without scrolling the whole thing.'),
    v('v49', '2026-07-31 · 20:00 UTC', false, 'Filter the Care tab’s item index by category',
      'The <b>All items</b> search on the <b>Care</b> tab gains a row of <b>quick-filter chips</b> under the search box. Tap one to see just that kind of thing across every template at once: <b>⚠️ No template</b> (loose items not yet filed), <b>💧 Liquids</b>, <b>⚡ Charging</b>, <b>⚠️ Restricted</b>, <b>🧰 Has care</b> (anything with storage, a photo, notes or a maintenance schedule) and <b>📷 Photo</b>. Tap several to combine them (it shows items matching <b>any</b> of the picked categories), and keep typing in the search box to narrow further. Only categories that actually occur show up, each with a count, and <b>Show all</b> clears them. It’s the fast way to round up, say, every loose item still needing a home, or every liquid before a flight.',
      'Round up a whole category of gear in one tap — all your loose items, liquids or chargeables — without scrolling the full list or knowing each name.'),
    v('v48', '2026-07-31 · 19:00 UTC', false, 'Items can live without a template — “Loose items”',
      'You no longer have to put an item into a template just to keep it. A new <b>Loose items</b> card sits at the top of the <b>Templates</b> tab — a holding place for anything not filed into a template yet. Add things freely, even if you don’t yet know where or when you’ll pack them; use <b>Add several</b> to type or paste a whole batch, <b>one per line</b>. Any item with no template shows a <b>⚠️ No template</b> flag (in the list and in the Care tab’s <b>All items</b>), so nothing gets quietly forgotten. When you’re ready, open an item and tick a template under <b>In these templates</b> to file it — and once it’s in a real template it <b>automatically leaves</b> the Loose items list. Loose items are never added to a trip and never appear in the activity picker; they just wait until you file them. You can also <b>Save</b> a one-off trip item to Loose items from the “Save this item to edit it fully” button.',
      'Capture anything the moment you think of it — a whole batch at once if you like — and sort out which template it belongs to (or whether it needs one) whenever you get to it.'),
    v('v47', '2026-07-31 · 18:00 UTC', false, 'Edit any trip item fully — even a one-off',
      'A follow-up to the previous change. The <b>“Edit the full item”</b> button on a trip item now appears for <b>every</b> item — including a one-off you added just for this trip. If the item isn’t in any template yet, the button first asks <b>which template to add it to</b>, saves it there (so it’s reusable next time), and then opens its full editor — conditions, template membership, storage &amp; care and all. Reasoning: you should always be able to adjust an item, and a trip-only thing you’re fussing over is often exactly the one you’ll want again later. Anything you’d already typed in the quick view carries across; the item keeps its packing details (photos and any care schedule are set up fresh in the full editor).',
      'Nothing is a dead end — any item on a trip can be opened, adjusted in full, and promoted into a template for reuse in one flow.'),
    v('v46', '2026-07-31 · 17:00 UTC', false, 'Jump from a trip item to its full settings',
      'Opening an item from an <b>Event</b> gives you a quick editor for the trip-specific bits — Qty, Category, Container, When, weight, flags, note. It doesn’t show the deeper item settings (<b>“Only include when…”</b> conditions, <b>In these templates</b>, <b>Storage &amp; maintenance</b>) because those belong to the item itself, not to this one trip. Now that quick editor has an <b>“Edit the full item — conditions, templates &amp; care”</b> button that jumps you <b>straight into the full item editor</b>, with its care panel already open, so you can change all of that in one hop and come back. Any edits you’d already made in the quick view are saved before the jump. (The button appears only for items that live in a template; a one-off item you added just for this trip has no template settings to edit.)',
      'Reach every setting of an item without hunting for it in the Templates tab — one tap from the trip takes you to the full editor.'),
    v('v45', '2026-07-31 · 16:00 UTC', false, 'Rename an item once, and it renames everywhere',
      'When an item lives in several templates, <b>renaming it in one now renames it in all of them</b>. Change your “Hat” to “Sun hat” in the Travel template and every linked copy — in Golf, Hiking, wherever it sits — follows to the new name automatically when you <b>Save</b>. It builds on the tick-box matrix: the same items are linked <b>by name</b> across templates, so the app keeps that link intact through a rename instead of leaving stale copies behind under the old name. (This tidies templates; items already materialised into a specific trip keep the name they had when you built that trip’s list.)',
      'One rename updates the item across every template it belongs to — no hunting through each list to fix the old name by hand.'),
    v('v44', '2026-07-31 · 15:00 UTC', false, 'Add an item to several templates at once',
      'The <b>In these templates</b> panel in an item’s editor is now a <b>tick-box list of every template</b>, not just a read-out of where the item already is. Ticking a template <b>adds this item to it</b>; unticking <b>removes it</b> — the changes apply when you <b>Save</b>. So a new hat you want in Travel, Golf and Hiking is three taps and a Save, instead of re-creating it in each template by hand. The item’s own template stays ticked and locked (use <b>Remove</b> to take it out of that one). The copies carry the packing details — container, weight, ⚡/💧/⚠️ flags, conditions and storage place — but not the photos or maintenance schedule, so the <b>Care</b> tab still lists the thing once. The list grows on its own as you add more templates.',
      'Fan one item out to every template it belongs to in seconds — tick, tick, Save — instead of rebuilding it in each list.'),
    v('v43', '2026-07-31 · 14:00 UTC', false, 'A ready-made list of storage places',
      'The <b>Where it’s stored</b> dropdown comes pre-filled again with a <b>standard set of places</b> — Bedroom wardrobe, Hall closet, Garage, Loft / attic, Storage box, RV / camper and more — so you can pick one in a tap on a fresh setup instead of starting from nothing. You’re still free to add your own from the same dropdown (<b>＋ Add a new place…</b>), and there’s a new <b>Storage places</b> section in <b>Settings</b> where you can <b>rename</b> or <b>remove</b> any place. Renaming a place carries the new wording onto every item already stored there, so nothing is left with the old name. Any places you’d already used are kept and merged in.',
      'Sensible storage places are there from the start, and you stay in full control — add, rename or tidy the list whenever you like.'),
    v('v42', '2026-07-31 · 13:00 UTC', false, 'Photos beside the name + a cleaner care panel',
      'A layout tidy-up in the item editor. An item’s <b>photos now sit right beside its name</b> at the top — where you’d expect a picture of the thing — instead of being tucked inside the care panel. The <b>Storage &amp; maintenance</b> panel below is decluttered: the little suitcase icon is gone from its heading, and the <b>Maintenance cadence · Last done · Log done today</b> controls now line up neatly as one row with matching heights. Separately, you can now <b>rename an event</b> straight from its screen — tap the <b>✏️ pencil</b> next to the ⚙️ gear in the top bar, type a new name, done (the gear still opens full Event settings).',
      'The editor reads top-to-bottom the way you’d expect — picture with the name, care details below — and renaming a trip is now one obvious tap.'),
    v('v41', '2026-07-31 · 12:00 UTC', false, 'Several photos per item',
      'An item can now hold <b>up to 5 photos</b> instead of just one — useful for showing a thing from different angles, or its serial number and accessories alongside it. The care panel shows them as a row of thumbnails, each with a small <b>✕</b> to remove it and a dashed <b>Add</b> tile to pick more (you can select several at once). <b>Tap any photo to view it full-screen.</b> In the <b>Care</b> list and <b>All items</b>, the first photo is the thumbnail with a little <b>count badge</b> when there’s more than one. Any single photo you’d already saved is carried over automatically as the first in its set.',
      'Capture gear from every angle — angles, labels, accessories — not just one picture per item.'),
    v('v40', '2026-07-31 · 11:00 UTC', false, 'Tidier Storage &amp; maintenance panel',
      'A cleaner layout for an item’s care panel. The heading is now just <b>🧰 Storage &amp; maintenance</b>. <b>Maintain</b> is renamed to the clearer <b>Maintenance cadence</b>, and the <b>Log done today</b> button now sits right beside the cadence and last-done fields — one tidy, aligned block instead of being stranded lower down. The photo’s <b>Add</b> and <b>Remove</b> controls are now compact icons (and the Remove icon only appears once there’s actually a photo). The <b>How-to link</b> field lost its wordy “Manufacturer /” prefix, and the service log is now clearly headed <b>MAINTENANCE HISTORY</b>.',
      'Less clutter and clearer labels — the care panel is quicker to scan and the “log it done” action is right where you need it.'),
    v('v39', '2026-07-31 · 10:00 UTC', false, 'Each section now has its own colour',
      'Every one of the five sections is now colour-coded, and that colour flows through the <b>whole page</b> — buttons, headings, the “＋ New” button, selection pills, links, icons and the lit tab all take on the section’s colour. <b>Home is blue</b>, <b>Events is green</b>, <b>Templates is violet</b>, <b>Care is teal</b>, and <b>Settings is slate grey</b>. The colour changes with a gentle fade as you move between sections, and it always matches the highlighted tab at the bottom, so a single glance tells you where you are. (Status colours that carry meaning — red for overdue, green for upcoming — are left alone.)',
      'Instant orientation: the colour of everything on screen tells you which section you’re in, with no need to read the header.'),
    v('v38', '2026-07-31 · 09:00 UTC', false, 'The active tab really stands out now',
      'A small visual polish to the bottom navigation. Whichever screen you’re on — <b>Home, Events, Templates, Care or Settings</b> — now shows a filled, brand-coloured <b>pill behind its icon</b> with a soft glow, and its label goes bold and fully saturated. The other tabs stay quiet and grey. Before, the current tab was only tinted a slightly different colour, which was easy to miss at a glance.',
      'You can tell instantly which section you’re in — the current tab genuinely pops instead of being a faint tint.'),
    v('v37', '2026-07-30 · 18:30 UTC', false, 'Clearer names: Templates, Events, Packing List',
      'A vocabulary tidy-up so the app names each thing for what it really is. The reusable building blocks (Swim, Run, Travel, Golf…) are now called <b>Templates</b> — the bottom tab and its screen are renamed to match. A specific trip that combines templates is an <b>Event</b> (unchanged). And the single merged list an Event produces — the one you actually pack from — is now called the <b>Packing List</b> (it used to be the “Total List”). So the flow reads plainly: <em>pick Templates → an Event combines them → you get a Packing List</em>. The Home button is now <b>Create Event</b>, and the “How it works” guide has been rewritten throughout to use the new words. Nothing about your data or how anything works changed — only the labels.',
      'The words now match the mental model: reusable Templates, a per-trip Event, and the Packing List you pack from.'),
    v('v36', '2026-07-30 · 17:30 UTC', false, 'Clearer item editor',
      'Four touches to make editing an item easier to read. <b>(1)</b> The <b>item name</b> is now big and bold so you always know what you’re editing. <b>(2)</b> The five condition rows (Season, Context, Transport, Catering, Weather) are wrapped in a <b>boxed group</b> under one heading — <em>“Only include this item when…”</em> — so it’s obvious the heading governs those rows and nothing else. <b>(3)</b> A plain-language <b>note under the Weather boxes</b> explains the rule: tick a condition and the item is held back until the trip’s forecast calls for it (tick Rain → only added when rain is forecast); leave them unticked and it’s always included. <b>(4)</b> A new <b>“In these lists”</b> panel shows every packing list that already contains this item (by name) as tap-through chips — it grows on its own as you add the item to more lists.',
      'You can see at a glance what you’re editing, what the condition rows do, and everywhere the item is already used.'),
    v('v35', '2026-07-30 · 16:30 UTC', false, 'Storage is now a dropdown',
      'In an item’s <b>🧰 Storage, photo &amp; maintenance</b> panel, <b>Where it’s stored</b> is now a proper <b>dropdown</b> that lists every place you’ve used before — tap and pick, instead of retyping “Garage shelf 3” each time (and no more accidental duplicates like “Garage” vs “garage”). Need somewhere new? Choose <b>＋ Add a new place…</b> and a box appears to type it; it then joins the dropdown for every other item. This also replaces the old type-to-suggest box that barely showed up on iPhone. <b>Also fixed:</b> a couple of editor fields that should only appear when relevant — <b>Charge type</b> (only with ⚡ Charging ticked) and <b>Custom interval (days)</b> (only when the interval is “Custom”) — had been showing all the time; they now hide until you need them.',
      'Pick a storage place from a tidy list in one tap — consistent names, no retyping, and still free to add new spots.'),
    v('v34', '2026-07-30 · 15:30 UTC', false, 'Care page: browse & add any item',
      'The <b>Care</b> tab gains a second section below the reminders: <b>All items</b>. It lists <b>every item across every list</b> with a <b>search box</b>, so you can type “wetsuit”, “drone”, “tent”… and jump <b>straight into that item’s editor</b> with its <b>🧰 Storage, photo &amp; maintenance</b> panel already open — no more hunting through Lists to add care info. Each row shows where it lives (📍) and a maintenance dot if it has a schedule. There’s also a <b>＋ New item</b> button: pick a list, give it a name, and you’re dropped straight into editing it. This makes the Care tab the one place to set up and look after all your gear.',
      'Add or update storage, photos and maintenance for any item in seconds — search, tap, done — without digging through your lists.'),
    v('v33', '2026-07-30 · 14:00 UTC', false, 'Quick activity gets its own icon',
      'Small polish: the <b>⏱️ Quick activity</b> list type had been sharing the ⚡ lightning bolt with the <b>⚡ Charging</b> flag, which was confusing at a glance. Quick activity now uses a <b>⏱️ stopwatch</b> everywhere — in the “List type” switch and on the small <b>⏱️ Quick</b> tag on a trip’s card — so the two are never mixed up. Nothing else changed.',
      'One glance tells Quick-activity lists and charging items apart — no more double-duty lightning bolt.'),
    v('v32', '2026-07-30 · 12:00 UTC', false, 'Care, storage &amp; maintenance',
      'A new dimension for the <em>physical things</em> you own. Each item now has a <b>🧰 Storage, photo &amp; maintenance</b> section in its editor: <b>(1) where it’s stored</b> at home (free text with autocomplete) — it travels onto trips and shows with a 📍 pin in Packing Mode so you know where to grab it; <b>(2) a photo</b> of the item, shrunk and kept on-device (never uploaded); and <b>(3) maintenance</b> — a service interval (monthly … every 2 years, or custom days), a last-done date, how-to notes, and a manufacturer/how-to link, with a one-tap <b>Log maintenance done</b> that keeps a dated history. A new <b>Care</b> tab gathers everything needing upkeep across all lists, as an urgency-ordered <b>list</b> (🔴 overdue / 🟡 due soon / 🟢 upcoming / 🧰 reference) with tap-to-read how-tos and ✓ Done, or a month <b>calendar</b> with each service on its due date. Overdue or due-soon gear also raises a 🧰 reminder on Home. Everyday items you don’t tag stay out of it entirely.',
      'Your gear now looks after itself: the app remembers where each thing lives, what it looks like, and reminds you — with the how-to right there — when the wetsuit, bike or tent is due for a service.'),
    v('v31', '2026-07-29 · 20:30 UTC', false, 'Quick activity lists + Car / Plane kits',
      'Two additions. <b>(1) A “List type” switch</b> at the top of the builder: <b>🧳 Full trip</b> (the usual common base + transport kit + activities) or <b>⚡ Quick activity</b> — <b>just the activities you tick, with no base and no transport kit</b>. Tick Swim or Run, set Context to Indoor/Outdoor, and you get the 5–20 items for that one bag instead of a whole trip’s worth; the transport and catering choices hide because they don’t apply, and quick lists carry a small ⚡ Quick tag. <b>(2) The Car and Plane transport lists are now filled in</b>: Plane brings the carry-on-rules items (liquids bag, travel documents, power bank &amp; spare batteries flagged carry-on-only), Car brings road extras (car charger, phone mount, sunglasses, snacks) — both still fully editable in the Lists tab.',
      'Pack a single swim or run bag in seconds without the full trip list — and flights and road trips now start with their obvious extras already in.'),
    v('v30', '2026-07-29 · 19:45 UTC', false, 'Transport now builds the list — “Start from” removed',
      'Big simplification of how a trip’s list is generated, from three clear sources: <b>(1) a common base that’s always included</b> (the “Travel” list — clothes, toiletries, documents, everyday electronics), <b>(2) your transport’s own kit, added automatically by the “Way of transport” radio</b> — pick <b>RV</b> and the full motorhome list comes with it, no separate step — and <b>(3) the extra GA/WET activities you tick</b>. The old <b>“Start from”</b> templates and the RV prompt are gone: the transport radio <em>is</em> the shortcut now, so a plain RV trip needs zero ticks. The base and transport lists no longer clutter the activity picker (they’re automatic), and each still lives in the <b>Lists</b> tab for editing. <b>Car</b> and <b>Plane</b> base lists are created but left empty for you to fill; the <b>How it works</b> guide is rewritten to explain the three sources.',
      'Pick how you travel and you already have the right kit — the RV list can’t be forgotten, and there’s no redundant “Start from” step to second-guess.'),
    v('v29', '2026-07-29 · 19:10 UTC', false, 'RV transport & the “full kit” template made clearer',
      'Two controls named the same trip types (Car / Plane / RV) but did different jobs, which was confusing. Now: the <b>“Start from”</b> template buttons read <b>“… — full kit”</b> so it’s clear they load a whole packing list, not just set a mode; and <b>choosing “RV” in the “Way of transport” radio offers to add the full “RV Granden (base)” motorhome list</b> for you (say yes to tick it, no to just tag the trip). The <b>How it works</b> guide gains a section spelling out the difference: the transport radio is a <em>filter</em> that only touches items with a transport condition, while the template is a <em>starter preset</em> that ticks the RV base + Travel lists and sets sensible defaults.',
      'The transport setting and the RV template now lead to the same place, so you can’t accidentally pick “RV” and end up without the motorhome gear.'),
    v('v28', '2026-07-29 · 18:40 UTC', false, 'Charging + charge type on your saved items',
      'The <b>⚡ Charging</b> flag and its <b>Charge type</b> (USB-C, USB-A, Lightning, special charger…) can now be set on a <b>building-block item</b> in your <b>Lists</b>, not just on a trip’s Total List. Set it once on, say, your head-torch or Garmin, and every trip that item lands in already carries the charging flag and connector — no re-tagging per trip. The Lists view now shows the same ⚡/💧/⚠️ badges on each item so you can see the flags at a glance, and the ⚡ badge includes the connector (e.g. ⚡ USB-C).',
      'Tag how a gadget charges once, on the item itself, and it follows the item into every packing list automatically.'),
    v('v27', '2026-07-29 · 18:34 UTC', false, 'Charge type on charge items',
      'A ⚡ charge item can now record <b>how it charges</b> — USB-C, USB-A, Micro-USB, Lightning, a special charger, or a wall plug. Tick <b>⚡</b> in an item’s editor and a <b>Charge type</b> dropdown appears; pick the connector and it shows right on the badge in the list, e.g. <b>⚡ USB-C</b>. Now when you round up your chargeables with the ⚡ Charge filter you can see at a glance which cables and bricks you actually need to bring — no more packing three cables to be safe. Leave it “Unspecified” and the badge stays the plain ⚡ as before.',
      'You can tell which cables and chargers a trip needs from the list itself, instead of guessing at the drawer.'),
    v('v26', '2026-07-29 · 18:25 UTC', false, '🪨 New “Heaviest” icon',
      'Swapped the <b>Sort out → Heaviest</b> chip icon from the balance scale to a <b>🪨 rock</b> — a plainer, more immediate “this is the heavy stuff” cue. Same behaviour as before: tap it to reorder the list heaviest-first with each item’s weight shown.',
      'The weight sort reads at a glance without a fussy little scale symbol.'),
    v('v25', '2026-07-29 · 18:11 UTC', false, '⚠️ Restricted icon &amp; “Sort out” filter',
      'The restricted-item flag now shows a red <b>⚠️ warning triangle</b> instead of the battery symbol — a clearer “stop and think before you pack this” cue for anything with carry-on rules (power banks, drones, spare batteries). And <b>Sort out</b> gains a matching <b>⚠️ Restricted</b> chip alongside 💧 Liquids and ⚡ Charge: tap it to isolate just the restricted items with their count, so you can review everything that needs a second thought in one place. The chip only appears when a trip actually has restricted items.',
      'The items that can get held up at security stand out at a glance, and you can round them all up in one tap before a flight.'),
    v('v24', '2026-07-29 · 10:59 UTC', false, '“Heaviest first” weight sort',
      'Added a third <b>Sort out</b> chip: <b>⚖️ Heaviest</b>. Tap it and the list reorders heaviest-first, ignoring the usual grouping, with each item’s <b>weight shown on its row</b> and a running total in the header — so when a bag is over its limit you can see straight away what’s worth leaving behind. It ranks by the real load (weight × quantity, including per-night scaling), and items without a weight drop to the bottom under their own heading. It combines with the 💧/⚡ filters to rank just those, and resets when you switch trips. Weights are set per item in its editor.',
      'When you need to shed grams, the biggest offenders are right at the top instead of scattered through the list.'),
    v('v23', '2026-07-29 · 10:51 UTC', false, '“Sort out” liquids &amp; charge items',
      'Added quick filters above a trip’s list: <b>💧 Liquids</b> and <b>⚡ Charge</b>, each showing a count. Tap one to isolate just those items — all your liquids together for the wash bag and the 100 ml rule, or everything that needs a cable/charger rounded up in one place — and <b>Show all</b> to return to the full list. Ticking and editing behave exactly as normal in the filtered view, and an item you’re editing stays visible even while a filter is on. The item editor now also has a <b>⚡</b> toggle (next to 💧 and 🔋) so you can mark anything as a charge item. Filters reset when you switch trips.',
      'When it’s time to pack, you can gather every liquid or every chargeable in one tap instead of hunting through the whole list.'),
    v('v22', '2026-07-29 · 10:42 UTC', false, 'Version marker on the Home screen',
      'Added a very subtle build marker at the very bottom of the <b>Home</b> screen — “AMS Packing List · v22” in small, faint text. It stays out of the way day-to-day but is easy to find when you want to know exactly which version you’re running (handy after an update). Tapping it jumps straight to this version history in Settings.',
      'You can always confirm at a glance which release is live, without it cluttering the screen.'),
    v('v21', '2026-07-29 · 10:34 UTC', false, 'Show days as well as nights',
      'The live trip-length readout under the dates now shows the <b>number of days</b> alongside the nights — e.g. “🗓 8 days · 🌙 7 nights” for a 2–9 Aug trip, or “1 day · 0 nights (day trip)” for a same-day outing. Days count both the start and end day (inclusive), so it matches how you’d say the trip out loud, while nights still drives per-night quantities.',
      'You can see the trip length the way you think of it — total days — without losing the nights count that scales quantities.'),
    v('v20', '2026-07-29 · 10:20 UTC', false, 'Set the end date, not the night count',
      'The trip builder now asks for an <b>end date</b> (your return day) instead of a number of nights — because you usually know when you’re coming home, not the night count off the top of your head. The app derives the <b>nights</b> from your start and end dates and shows them live right under the fields (“🌙 7 nights”, or “Day trip” for same-day), so the number that scales per-night quantities is always visible. It warns if the end date is before the start, and older trips that only stored a night count still open correctly — their end date is filled in from start + nights.',
      'You enter the date you already know (going-home day) and still see exactly how many nights the packing quantities are based on.'),
    v('v19', '2026-07-29 · 10:20 UTC', false, 'Clearer builder button & a Cancel on edit',
      'Renamed the Home builder’s main button from <b>Create Total List</b> to <b>Create Event List</b>, so it names exactly what you get — a new entry under the <b>Events</b> tab — and matches the app’s language for reusable <b>packing lists</b> vs. per-trip <b>event lists</b>. (The composed list inside a trip is still called the Total List.) Separately, the trip <b>settings/edit</b> screen now has a <b>Cancel</b> button beside <b>Save &amp; regenerate list</b>, so backing out without changing anything is obvious — not just the small back-arrow. The Home builder has no Cancel by design: Home <em>is</em> the builder and resets itself when you leave.',
      'The build button says what it makes, and editing a trip’s settings has a clear, safe way to back out unchanged.'),
    v('v18', '2026-07-29 · 09:25 UTC', false, 'Colour-coded workflow stages',
      'The whole interface now shifts accent colour to signal which stage of the packing flow you’re in, so a glance tells you what you’re doing: <b>indigo</b> while <b>defining</b> a trip (Home builder &amp; trip settings), <b>teal</b> while <b>looking</b> at a trip’s list, <b>amber</b> while <b>adding/editing</b> an item, and <b>green</b> during focused <b>Packing Mode</b>. Buttons, tabs, chips and progress bars all retint together, in both light and dark themes, with a soft transition on the switch. Implemented by tinting two brand variables per mode; every other colour derives from them automatically.',
      'You always know at a glance which stage you’re in — planning, viewing, editing, or packing.'),
    v('v17', '2026-07-29 · 03:56 UTC', false, 'Events tab & smarter ordering',
      'Split navigation into four tabs by giving event lists their own <b>Events</b> tab (calendar icon), separate from the reusable <b>Lists</b>. The Events tab groups trips into Upcoming / No date set / Past, newest-relevant first. Home now shows just a compact preview of your most recent trips with a “See all” link, so the builder stays front-and-centre. Event ordering everywhere changed to <b>nearest upcoming first</b> (then undated drafts, then past trips) instead of furthest-future-date first.',
      'The trip you’re packing for next is always on top, and Home stays focused on starting a trip.'),
    v('v16', '2026-07-29 · 03:31 UTC', false, 'Version history',
      'Added this version history to Settings — every release newest-first, each with a date and UTC time, an extensive description, and a one-line main benefit. Like the “How it works” guide, it’s kept in sync as the app grows.',
      'A clear, dated record of how the app has evolved and what each release changed.'),
    v('v15', '2026-07-29 · 03:29 UTC', false, 'In-app “How it works” guide',
      'Added a deep, collapsible manual to Settings — 15 chapters covering the core idea, activity lists and the GA/WET/OE groups, item anatomy, the packing timeline, trip creation, how the Total List is composed and filtered, the grouping views, bags &amp; weight, countdown nudges, Packing Mode, the full weather system, trip review and refine, sharing, Excel export, and data &amp; privacy. Collapsed by default and written to stay in sync as the app grows.',
      'One always-current place to understand everything the app does — nothing hidden or undocumented.'),
    v('v14', '2026-07-29 · 02:50 UTC', true, 'Pack weather gear anyway',
      'Added a control in a trip’s weather section that lists all of the trip’s weather-conditional gear and lets you add any of it regardless of — or entirely without — a forecast. It shows only gear the forecast hasn’t already suggested, so nothing is duplicated, and anything added keeps its real bag and category and still feeds trip-review stats. Replaced the interim v13 hint.',
      'You can pack the rain shell as a backup layer even on a dry day — conditional gear is never truly locked away.'),
    v('v13', '2026-07-29 · 02:15 UTC', true, 'Weather “waiting” hint (interim)',
      'Added a subtle hint when a trip’s lists held weather-conditional gear but no forecast had been fetched, nudging you to add a destination. Superseded the same day by v14’s fuller “pack anyway” panel.',
      'Made hidden conditional gear discoverable — soon improved into a full add-anytime control.'),
    v('v12', '2026-07-29 · 01:30 UTC', true, 'Weather tags on items, plus data fixes',
      'Added a per-item Weather flag (Rain / Cold / Heat / Wind / Snow). A tagged item becomes “conditional gear”: kept out of the normal list and surfaced only when the forecast calls for it. The forecast suggestion banner now offers your own tagged gear first (with its real bag, category and a source link for review stats), then generic add-ons. Also corrected two real-data items — the Bike “Efter” (After) block is now reminders, and “Kolja” is Body massage oil.',
      'Weather suggestions draw on your own gear, not just generic items — and your encoded lists are more accurate.'),
    v('v11', '2026-07-28 · 17:00 UTC', true, 'Weather-aware trips',
      'Added optional per-trip weather via Open-Meteo (free, no account). Set a destination, tap Get forecast, and see a temperature chip in the trip header plus a 7-day strip with icons and highs/lows (rainy days highlighted). The forecast is cached on the trip so it still shows offline, and only fetches when you ask and you’re online.',
      'Your list adapts to the actual conditions you’ll face, not just the season you picked.'),
    v('v10', '2026-07-28 · 14:00 UTC', true, 'Manual trip share (no backend)',
      'Added the ability to share a whole trip — the full packing list travels inside a file, a copyable deep link, or the native share sheet; nothing is uploaded. The recipient opens the link (it imports itself) or imports the file from Settings, and every import becomes a fresh, unpacked copy with new IDs. Links are kept compact enough to send in a message.',
      'Share a trip with a partner, or move it between devices — fully offline and server-free.'),
    v('v9', '2026-07-27 · 20:00 UTC', true, 'Countdown &amp; “pack now” nudges',
      'Trips with a start date now show a live countdown, and a banner surfaces the earliest packing phase that’s due, based on how far ahead each phase is normally packed. Packing Mode opens at the first phase with unpacked items. These are on-open reminders — an installed web app can’t push true background notifications.',
      'You pack the right things at the right time, without missing an early-prep window.'),
    v('v8', '2026-07-27 · 18:00 UTC', true, 'Offline reliability fix',
      'Reworked the service worker so a new version always fetches fresh files, bypassing the browser cache, ending a class of “my edits don’t show” staleness. Later refined so a failed cross-origin call (such as the weather API) rejects cleanly instead of returning the app shell.',
      'Updates land reliably and the offline cache never serves a half-old app.'),
    v('v6–v7', '2026-07-27 · 16:00 UTC', true, 'Weight, bags &amp; smart quantities',
      'Added per-item weight and flags (💧 liquid, 🔋 restricted, per-night), a trip “nights” field, and a Bags &amp; weight panel that totals each container against typical airline limits, warns when a bag is over, and counts liquids and restricted items. Per-night items scale their quantity to the trip length (e.g. socks ×6 for six nights).',
      'Pack within airline limits and get quantities right for the trip length automatically.'),
    v('v5', '2026-07-27 · 13:00 UTC', true, 'Trip review &amp; Refine (learning)',
      'After a trip, mark what you didn’t use; the app tracks, per item, how often it was packed versus actually used. Refine then suggests dropping items you keep packing but never use, with a Keep or Drop choice.',
      'Your lists get leaner and more accurate the more you use them.'),
    v('v4', '2026-07-27 · 10:00 UTC', true, 'Packing Mode',
      'A focused, full-screen flow that walks you through one timeline phase at a time with big tap-to-pack rows, live counters, and an “All packed” finish. It opens at the first phase with unpacked items and shares tick state with the Total List.',
      'A calm, guided way to actually pack, instead of scanning one long list.'),
    v('v3', '2026-07-24 · 15:00 UTC', true, 'Activity groups &amp; start-from templates',
      'Organised activity lists under GA (Goal Activity), WET (Workout, Exercise &amp; Training) and OE (Other Events), with grouped pickers and per-group select-all. Added start-from templates (Travel, RV “Granden”) that pre-fill the builder.',
      'Faster trip setup and an organisation that mirrors how you actually think about activities.'),
    v('v2', '2026-07-24 · 12:00 UTC', true, 'Your real lists, encoded',
      'Encoded your real Swedish packing lists (translated to English, with the Swedish kept as a subtitle) into the app’s data model: every item tagged with category, container and phase, plus reminders, charging and short-list flags, and nested sub-items. Added the three-way Group by (When / Where / Category).',
      'The app is populated with your actual gear from day one, viewable however suits the moment.'),
    v('v1', '2026-07-24 · 09:00 UTC', true, 'Foundation',
      'The first working app: a no-build, offline PWA with the Home builder (pick activities and conditions → generate a Total List), reusable lists and events stored on-device (IndexedDB), a dependency-free Excel export, and a service worker for full offline use.',
      'A private, installable, offline packing-list builder — the base everything else is built on.'),
  ].join('');
  return h(`<div class="card block">
    <details class="howto vhist">
      <summary><span class="howto-h">Version history</span><span class="howto-sum">Every release, newest first — tap to open</span></summary>
      <div class="howto-body">
        <p class="muted">Versions are the app’s internal release tags. Times are UTC; the latest two (v15, v16) are exact — earlier build times weren’t logged precisely and are marked approximate.</p>
        ${items}
      </div>
    </details>
  </div>`);
}

// ============================================================
// Actions — the central to-do list. Every action shows here, whether it's tied
// to an item (and so also shown on that item) or "General" (loose). New loose
// actions are added here too.
// ============================================================
let actionEditId = null;       // id of the action whose inline editor is open ('__new__' = the add form)
let actionShowDone = false;    // whether the collapsed "Done" group is expanded

async function renderActions() {
  const wrap = h('<section class="screen"></section>');
  wrap.appendChild(h(`<div class="topbar"><h1 class="grow">Actions</h1><a class="iconbtn" href="#/search" aria-label="Search">${IC.search}</a><button class="btn primary" data-new>${IC.plus}<span>New</span></button></div>`));
  wrap.appendChild(h('<p class="screen-intro">Your to-do list. An action tied to an item also shows on that item; “General” ones live only here.</p>'));

  const [actionsAll, catalog] = await Promise.all([db.getActions(), db.getCatalogItems()]);
  ALL_ACTIONS = actionsAll;
  const nameById = new Map(catalog.map((i) => [i.id, i.name]));
  const itemLabelFor = (a) => (a.itemId ? (nameById.get(a.itemId) || a.itemName || '(item)') : '');
  // Item picker for the inline editor: General + every catalog item, by name.
  const itemOpts = [{ value: '', label: '— General (not tied to an item) —' }]
    .concat(catalog.slice().sort((x, y) => (x.name || '').localeCompare(y.name || '')).map((i) => ({ value: i.id, label: i.name || '(unnamed)' })));

  const body = h('<div class="act-screen"></div>');
  wrap.appendChild(body);

  // A read-only row; tap the body to open its editor, tick the box to complete.
  function actionRow(a) {
    const itemName = itemLabelFor(a);
    const row = h(`<div class="act-brow${a.done ? ' done' : ''}">
      <label class="act-check"><input type="checkbox" ${a.done ? 'checked' : ''}><span class="act-box">${IC.check}</span></label>
      <button class="act-body" type="button">
        <span class="act-btext">${esc(a.text || '(empty)')}</span>
        <span class="act-bsub">${itemName ? `<span class="act-item">${esc(itemName)}</span>` : '<span class="act-item general">General</span>'}${actionChipsHtml(a)}</span>
      </button>
    </div>`);
    $('input', row).addEventListener('change', async (e) => {
      a.done = e.target.checked; a.doneAt = a.done ? new Date().toISOString() : '';
      await db.saveAction(a); await refreshActions(); draw();
    });
    $('.act-body', row).addEventListener('click', () => { actionEditId = a.id; draw(); });
    return row;
  }

  // The inline editor for one action (existing or brand-new).
  function actionEditor(a, isNew) {
    const withData = (html, attr) => html.replace('<select', `<select ${attr}`);
    const ed = h(`<div class="act-editor">
      <label class="field"><span>To-do</span><input data-f="text" value="${esc(a.text)}" placeholder="e.g. Replace foam tips" autocomplete="off"></label>
      <label class="field"><span>Tied to</span>${withData(selectHtml('actitem', itemOpts, a.itemId), 'data-f="item"')}</label>
      <div class="row2">
        <label class="field"><span>Priority</span>${withData(selectHtml('actprio', ACTION_PRIORITIES.map((p) => ({ value: p.id, label: p.label })), a.priority), 'data-f="prio"')}</label>
        <label class="field"><span>When <em>trip phase</em></span>${actionWhenSelectHtml('data-f="phase"', a.whenPhase)}</label>
      </div>
      <label class="field"><span>Or a specific date</span><input type="date" data-f="date" value="${esc(a.whenDate)}"></label>
      <div class="editor-actions">
        ${isNew ? '' : `<button type="button" class="btn danger ghost" data-a="del">${IC.trash}<span>Delete</span></button>`}
        <div class="spacer"></div>
        <button type="button" class="btn" data-a="cancel">Cancel</button>
        <button type="button" class="btn primary" data-a="save">Save</button>
      </div>
    </div>`);
    ed.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-a]')?.dataset.a;
      if (!act) return;
      if (act === 'cancel') { actionEditId = null; draw(); return; }
      if (act === 'del') {
        if (!confirm('Delete this to-do?')) return;
        await db.deleteAction(a.id); await refreshActions(); actionEditId = null; draw(); return;
      }
      if (act === 'save') {
        const text = ($('[data-f=text]', ed).value || '').trim();
        if (!text) { $('[data-f=text]', ed).focus(); return; }
        const itemId = $('[data-f=item]', ed).value;
        a.text = text;
        a.itemId = itemId;
        a.itemName = itemId ? (nameById.get(itemId) || '') : '';
        a.priority = $('[data-f=prio]', ed).value;
        a.whenPhase = $('[data-f=phase]', ed).value;
        a.whenDate = $('[data-f=date]', ed).value || '';
        await db.saveAction(a); await refreshActions();
        actionEditId = null; draw();
      }
    });
    setTimeout(() => $('[data-f=text]', ed)?.focus(), 20);
    return ed;
  }

  function draw() {
    const list = ALL_ACTIONS.filter((a) => a.kind !== 'shopping').slice().sort(compareActions);
    const open = list.filter((a) => !a.done);
    const done = list.filter((a) => a.done);
    body.innerHTML = '';

    if (actionEditId === '__new__') body.appendChild(actionEditor(newAction(), true));

    if (!open.length && !done.length && actionEditId !== '__new__') {
      body.appendChild(h('<div class="empty"><p class="empty-t">No actions yet</p><p class="empty-s">Tap “New” to add a to-do, or add one from any item’s editor.</p></div>'));
      return;
    }

    const openWrap = h('<div class="act-group"></div>');
    open.forEach((a) => openWrap.appendChild(a.id === actionEditId ? actionEditor(a, false) : actionRow(a)));
    if (open.length) body.appendChild(openWrap);

    if (done.length) {
      const det = h(`<details class="act-done"${actionShowDone ? ' open' : ''}><summary>Done <span class="act-done-n">${done.length}</span></summary></details>`);
      const dWrap = h('<div class="act-group"></div>');
      done.forEach((a) => dWrap.appendChild(a.id === actionEditId ? actionEditor(a, false) : actionRow(a)));
      det.appendChild(dWrap);
      det.addEventListener('toggle', () => { actionShowDone = det.open; });
      body.appendChild(det);
    }
  }

  $('[data-new]', wrap).addEventListener('click', () => { actionEditId = '__new__'; draw(); });
  draw();
  return wrap;
}

// ============================================================
// Shopping list — pre-trip restock & replace, built on the actions store
// (kind 'shopping'). Reached from the Care tab and the Home 🛒 nudge.
// ============================================================
let shopEditId = null;      // id of the buy-item being edited inline, or '__new__'
let shopShowDone = false;   // whether the "Bought" group is expanded

async function renderShopping() {
  const wrap = h('<section class="screen"></section>');
  wrap.appendChild(h(`<div class="topbar"><a class="iconbtn" href="#/maintenance" aria-label="Back">${IC.back}</a><h1 class="grow">Shopping list</h1><button class="btn primary" data-new>${IC.plus}<span>Add</span></button></div>`));
  wrap.appendChild(h('<p class="screen-intro">Things to buy before a trip — consumables to restock and gear that needs replacing. Tick one off once you’ve bought it.</p>'));

  const [actionsAll, catalog] = await Promise.all([db.getActions(), db.getCatalogItems()]);
  ALL_ACTIONS = actionsAll;
  const catById = new Map(catalog.map((i) => [i.id, i]));
  const nameById = new Map(catalog.map((i) => [i.id, i.name]));
  const itemOpts = [{ value: '', label: '— Not tied to an item —' }]
    .concat(catalog.slice().sort((x, y) => (x.name || '').localeCompare(y.name || '')).map((i) => ({ value: i.id, label: i.name || '(unnamed)' })));

  const body = h('<div class="act-screen shop-screen"></div>');
  wrap.appendChild(body);

  const reasonChip = (r) => (r ? `<span class="shop-reason ${reasonClass(r)}">${esc(r)}</span>` : '');

  // A buy-list row: tick = bought, tap the body to edit.
  function buyRow(a) {
    const tiedItem = a.itemId ? catById.get(a.itemId) : null;
    const itemName = a.itemId ? (nameById.get(a.itemId) || a.itemName || '(item)') : '';
    const reason = tiedItem ? shoppingReason(tiedItem, todayISO()) : '';
    const row = h(`<div class="act-brow${a.done ? ' done' : ''}">
      <label class="act-check"><input type="checkbox" ${a.done ? 'checked' : ''}><span class="act-box">${IC.check}</span></label>
      <button class="act-body" type="button">
        <span class="act-btext">${esc(a.text || '(empty)')}</span>
        <span class="act-bsub">${itemName ? `<span class="act-item">${esc(itemName)}</span>` : ''}${reasonChip(reason)}${a.whenDate ? `<span class="act-chip">${ic('cal','xs')}${esc(a.whenDate)}</span>` : ''}</span>
      </button>
    </div>`);
    $('input', row).addEventListener('change', async (e) => {
      a.done = e.target.checked; a.doneAt = a.done ? new Date().toISOString() : '';
      await db.saveAction(a); await refreshActions(); draw();
    });
    $('.act-body', row).addEventListener('click', () => { shopEditId = a.id; draw(); });
    return row;
  }

  // Inline editor for a buy item (existing or new).
  function buyEditor(a, isNew) {
    const withData = (html, attr) => html.replace('<select', `<select ${attr}`);
    const ed = h(`<div class="act-editor">
      <label class="field"><span>Buy</span><input data-f="text" value="${esc(a.text)}" placeholder="e.g. Sunscreen SPF50" autocomplete="off"></label>
      <label class="field"><span>For an item <em>(optional)</em></span>${withData(selectHtml('shopitem', itemOpts, a.itemId), 'data-f="item"')}</label>
      <label class="field"><span>Get it by <em>(optional date)</em></span><input type="date" data-f="date" value="${esc(a.whenDate)}"></label>
      <div class="editor-actions">
        ${isNew ? '' : `<button type="button" class="btn danger ghost" data-a="del">${IC.trash}<span>Remove</span></button>`}
        <div class="spacer"></div>
        <button type="button" class="btn" data-a="cancel">Cancel</button>
        <button type="button" class="btn primary" data-a="save">Save</button>
      </div>
    </div>`);
    ed.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-a]')?.dataset.a;
      if (!act) return;
      if (act === 'cancel') { shopEditId = null; draw(); return; }
      if (act === 'del') {
        if (!confirm('Remove this from the shopping list?')) return;
        await db.deleteAction(a.id); await refreshActions(); shopEditId = null; draw(); return;
      }
      if (act === 'save') {
        const text = ($('[data-f=text]', ed).value || '').trim();
        if (!text) { $('[data-f=text]', ed).focus(); return; }
        const itemId = $('[data-f=item]', ed).value;
        a.kind = 'shopping';
        a.text = text;
        a.itemId = itemId;
        a.itemName = itemId ? (nameById.get(itemId) || '') : '';
        a.whenDate = $('[data-f=date]', ed).value || '';
        await db.saveAction(a); await refreshActions();
        shopEditId = null; draw();
      }
    });
    setTimeout(() => $('[data-f=text]', ed)?.focus(), 20);
    return ed;
  }

  function draw() {
    const shopping = ALL_ACTIONS.filter((a) => a.kind === 'shopping').slice().sort(compareActions);
    const open = shopping.filter((a) => !a.done);
    const done = shopping.filter((a) => a.done);
    const suggestions = shoppingSuggestions(catalog, ALL_ACTIONS, todayISO());
    body.innerHTML = '';

    if (shopEditId === '__new__') body.appendChild(buyEditor(newAction({ kind: 'shopping' }), true));

    // --- To buy ---
    if (open.length) {
      const openWrap = h('<div class="act-group"></div>');
      open.forEach((a) => openWrap.appendChild(a.id === shopEditId ? buyEditor(a, false) : buyRow(a)));
      body.appendChild(openWrap);
    } else if (shopEditId !== '__new__' && !done.length && !suggestions.length) {
      body.appendChild(h('<div class="empty"><p class="empty-t">Nothing to buy</p><p class="empty-s">Tap “Add” for a one-off, or flag an item as a <b>Consumable</b> (or set its condition to <b>Needs replacing</b> / a replace-by date) and it’ll be suggested here.</p></div>'));
    }

    // --- Suggested (from your items) ---
    if (suggestions.length) {
      const sec = h(`<div class="shop-suggest"><h2 class="section-h">Suggested — from your items · ${suggestions.length}</h2></div>`);
      const sWrap = h('<div class="act-group"></div>');
      for (const { item, reason } of suggestions) {
        const r = h(`<div class="shop-sug-row">
          <span class="shop-sug-body"><span class="shop-sug-name">${esc(item.name || '(unnamed)')}</span>${reasonChip(reason)}</span>
          <button type="button" class="btn ghost sm" data-add="${esc(item.id)}">${IC.plus}<span>Add</span></button>
        </div>`);
        r.querySelector('[data-add]').addEventListener('click', async () => {
          await db.saveAction(newAction({ kind: 'shopping', text: `Buy ${item.name}`, itemId: item.id, itemName: item.name }));
          await refreshActions(); draw();
        });
        sWrap.appendChild(r);
      }
      sec.appendChild(sWrap);
      body.appendChild(sec);
    }

    // --- Bought ---
    if (done.length) {
      const det = h(`<details class="act-done"${shopShowDone ? ' open' : ''}><summary>Bought <span class="act-done-n">${done.length}</span></summary></details>`);
      const dWrap = h('<div class="act-group"></div>');
      done.forEach((a) => dWrap.appendChild(a.id === shopEditId ? buyEditor(a, false) : buyRow(a)));
      det.appendChild(dWrap);
      det.addEventListener('toggle', () => { shopShowDone = det.open; });
      body.appendChild(det);
    }
  }

  $('[data-new]', wrap).addEventListener('click', () => { shopEditId = '__new__'; draw(); });
  draw();
  return wrap;
}
// A CSS class for a shopping reason, so each urgency reads differently.
function reasonClass(r) {
  return r === 'Needs replacing' ? 'replace' : r === 'Expired' ? 'expired' : r === 'Replace soon' ? 'soon' : 'restock';
}

// ============================================================
// Global search — find any item, template, trip or to-do from one box
// ============================================================
let searchQuery = '';
async function renderSearch() {
  const [items, lists, events, actions] = await Promise.all([
    db.getCatalogItems(), db.getLists(), db.getEvents(), db.getActions(),
  ]);
  // Map each catalog item to a template it lives in, so a hit can open its editor.
  const itemToList = new Map();
  for (const l of lists) {
    if (l.role === CONTAINER_ROLE) continue;
    for (const it of (l.items || [])) if (it._itemId && !itemToList.has(it._itemId)) itemToList.set(it._itemId, l.id);
  }

  const wrap = h('<section class="screen"></section>');
  wrap.appendChild(h(`<div class="topbar"><a class="iconbtn" href="#/" aria-label="Back">${IC.back}</a><h1>Search</h1></div>`));
  const boxEl = h(`<div class="search-box">${IC.search}<input type="search" placeholder="Search items, templates, trips, to-dos…" autocomplete="off" spellcheck="false" value="${esc(searchQuery)}"></div>`);
  wrap.appendChild(boxEl);
  const results = h('<div class="search-results"></div>');
  wrap.appendChild(results);
  const input = boxEl.querySelector('input');

  const sectionHead = (title, n) => `<h2 class="section-h">${esc(title)} · ${n}</h2>`;
  const row = (href, icon, main, sub) => `<a class="search-row" href="${href}">
    <span class="sr-ic">${icon}</span>
    <span class="sr-body"><span class="sr-main">${main}</span>${sub ? `<span class="sr-sub">${sub}</span>` : ''}</span>
    <span class="sr-go">${IC.fwd}</span></a>`;

  const draw = () => {
    const raw = searchQuery.trim();
    const q = raw.toLowerCase();
    results.innerHTML = '';
    if (!q) { results.appendChild(h('<p class="muted pad">Type to search across everything — your items, templates, trips and to-dos.</p>')); return; }
    const has = (s) => String(s || '').toLowerCase().includes(q);

    const itemHits = items.filter((it) => has(it.name) || has(it.swedish)).slice(0, 30);
    const tmplHits = lists.filter((l) => l.role !== CONTAINER_ROLE && l.role !== 'loose' && has(l.name));
    const eventHits = events.filter((e) => has(e.name) || has(e.destination));
    const allActionHits = actions.filter((a) => has(a.text) || has(a.itemName));
    const actionHits = allActionHits.filter((a) => a.kind !== 'shopping');
    const shopHits = allActionHits.filter((a) => a.kind === 'shopping');

    if (!(itemHits.length + tmplHits.length + eventHits.length + actionHits.length + shopHits.length)) {
      results.appendChild(h(`<p class="muted pad">No matches for “${esc(raw)}”.</p>`));
      return;
    }

    let html = '';
    if (itemHits.length) {
      html += sectionHead('Items', itemHits.length) + '<div class="search-list">';
      for (const it of itemHits) {
        const tid = itemToList.get(it.id);
        const href = tid ? `#/list/${encodeURIComponent(tid)}/item/${encodeURIComponent(it.id)}` : '#/maintenance';
        const dot = `<span class="e-cat" style="background:${categoryColor(it.category)}"></span>`;
        const sub = [it.category].filter(Boolean).map(esc).join(' · ');
        html += row(href, CATEGORY_ICON[it.category] || '📦', dot + esc(it.name), sub);
      }
      html += '</div>';
    }
    if (tmplHits.length) {
      html += sectionHead('Templates', tmplHits.length) + '<div class="search-list">';
      for (const l of tmplHits) html += row(`#/list/${encodeURIComponent(l.id)}`, listEmoji(l), esc(l.name), `${(l.items || []).length} item${(l.items || []).length === 1 ? '' : 's'}`);
      html += '</div>';
    }
    if (eventHits.length) {
      html += sectionHead('Trips', eventHits.length) + '<div class="search-list">';
      for (const e of eventHits) {
        const d = daysUntil(e.startDate);
        const sub = [e.destination ? esc(e.destination) : '', d != null ? esc(countdownLabel(d)) : ''].filter(Boolean).join(' · ');
        html += row(`#/event/${encodeURIComponent(e.id)}`, ic('suitcase','md'), esc(e.name || 'Untitled trip'), sub);
      }
      html += '</div>';
    }
    if (actionHits.length) {
      html += sectionHead('To-dos', actionHits.length) + '<div class="search-list">';
      for (const a of actionHits) {
        const sub = [a.done ? 'done' : 'open', a.itemName ? esc(a.itemName) : 'General'].filter(Boolean).join(' · ');
        html += row('#/actions', ic('note','md'), esc(a.text || '(untitled)'), sub);
      }
      html += '</div>';
    }
    if (shopHits.length) {
      html += sectionHead('Shopping list', shopHits.length) + '<div class="search-list">';
      for (const a of shopHits) {
        const sub = [a.done ? 'bought' : 'to buy', a.itemName ? esc(a.itemName) : ''].filter(Boolean).join(' · ');
        html += row('#/shopping', ic('cart','md'), esc(a.text || '(untitled)'), sub);
      }
      html += '</div>';
    }
    results.innerHTML = html;
  };

  input.addEventListener('input', () => { searchQuery = input.value; draw(); });
  draw();
  setTimeout(() => { input.focus(); }, 40);
  return wrap;
}

// ============================================================
// Settings
// ============================================================
// The signed-in account, said as a NAME rather than an address:
// "martin.schabbauer@icloud.com" → "Martin". An address is how you sign in; a
// name is what you want to read when the app tells you who this device is
// syncing as. A name already on your People roster wins, so the spelling matches
// the one you use everywhere else. Anything that isn't an address is left alone.
function accountName(user) {
  const raw = String(user || '').trim();
  if (!raw || !looksLikeEmail(raw)) return raw;
  const guess = ownerNameFromEmail(raw);
  const known = [...loadPeople().map((p) => p.name), ...loadOwners()]
    .find((n) => normName(n) === normName(guess));
  return known || guess;
}

// The "Sync your devices" card. Shows where this device stands, and offers the
// one action that matters (sign in / sign out). Dexie Cloud supplies its own
// e-mail-code dialog, so there is no password to invent or remember here.
async function syncCard() {
  const st = await db.syncStatus().catch(() => ({ enabled: true, signedIn: false, user: '', state: 'error' }));
  const body = st.signedIn
    ? `<p class="data-status">${ic('check', 'sm')}<b>Syncing as ${esc(accountName(st.user))}</b></p>
       <p class="muted">Your templates, items, trips, to-dos and kits are kept in step across every device you sign in on — and so are the lists you make here: <b>When</b>, <b>Item conditions</b>, <b>Trip presets</b>, <b>People</b>, <b>Owners</b> and <b>Storage places</b>. Changes made offline are sent as soon as you're back online.</p>
       <p class="muted sync-note">Photos, the automatic backups, and how each device looks — theme, view, which sections are open — deliberately stay on the device they belong to.</p>`
    : `<p class="data-status">${ic('warn', 'sm')}<b>Not syncing on this device</b></p>
       <p class="muted">Sign in with your e-mail to keep this device in step with your others. You'll get a one-time code by e-mail — there's no password. Everything here keeps working offline either way.</p>`;
  const el = h(`<div class="card block sync-card">
    <h2>Sync your devices</h2>
    ${body}
    <div class="btnrow">
      ${st.signedIn
        ? '<button class="btn ghost" data-sync="out">Sign out of this device</button>'
        : '<button class="btn primary" data-sync="in">Sign in to sync</button>'}
      ${st.signedIn ? '<button class="btn ghost" data-sync="resend">Re-send my lists to my other devices</button>' : ''}
      <button class="btn ghost danger-txt" data-sync="reset">Replace this device with the account copy</button>
    </div>
    ${st.signedIn ? '<p class="muted sync-note"><b>Re-send my lists</b> is for when your <b>When</b>, Item conditions, Trip presets, People, Owners or Storage places look short on your <em>other</em> device. Press it on the device whose lists are <b>right</b> — it sends them again, and adds to the other device without removing anything.</p>' : ''}
    <p class="muted sync-note">Use <b>Replace this device</b> only on a device holding the <em>wrong</em> catalogue — it erases what is on this one and takes the account's copy instead. The device with your real catalogue should <b>sign in</b>, not this.</p>
  </div>`);
  el.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-sync]')?.dataset.sync;
    if (!act) return;
    try {
      if (act === 'reset') {
        const counts = await db.currentCounts();
        if (!confirm(`Replace THIS device's data with the account copy?\n\nThis erases what is on this device right now (${countsSummary(counts)}) and downloads the account's copy instead.\n\nOnly do this on a device holding the wrong catalogue. If this is the device with your real data, press Cancel and use "Sign in to sync" instead.`)) return;
        if (!confirm('Last check — this cannot be undone on this device.\n\nErase this device and take the account copy?')) return;
        const cleared = await db.resetFromCloud();
        if (!cleared) {
          alert('Could not finish clearing this device — another tab or window still has the app open.\n\nClose any other copies of the app and try again.');
          return;
        }
        alert('This device has been cleared.\n\nThe app will reload. Sign in and the account copy will download.');
        location.reload();
        return;
      }
      if (act === 'resend') {
        const r = await db.republishSharedLists();
        showToast(r.sent
          ? `Sent ${r.sent} entr${r.sent === 1 ? 'y' : 'ies'} — open the app on your other device to pull them in.`
          : 'Nothing to send yet — this device has no lists of its own.');
        return;
      }
      if (act === 'in') { await db.signIn(); showToast('Signed in — syncing now.'); }
      else {
        if (!confirm('Sign out of syncing on this device?\n\nYour data stays here — it just stops being kept in step with your other devices.')) return;
        await db.signOut();
        showToast('Signed out. This device no longer syncs.');
      }
    } catch (err) {
      logDiag('sync', err);
      alert(`Could not ${act === 'in' ? 'sign in' : 'sign out'}: ${err && err.message ? err.message : 'unknown error'}`);
    }
    render();
  });
  return el;
}

// --- Settings sections (#crowding) -------------------------------------------
// Settings grew to thirteen cards, with the three you touch least — sync, backup
// file, automatic backups — sitting at the very top. Every card is now a fold with
// a one-line summary, so the tab reads as an index you can take in at a glance,
// and whichever sections you leave open stay open next time.
const SETTINGS_OPEN_KEY = 'ams-settings-open';
function loadSettingsOpen() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_OPEN_KEY) || '{}') || {}; }
  catch { return {}; }
}
function settingsOpen(id, dflt = false) {
  const m = loadSettingsOpen();
  return id in m ? !!m[id] : dflt;
}
// `toggle` does not bubble, so this is wired per-fold rather than delegated. The
// card also gets an `.on` class while open — the colour treatment hangs off that
// rather than off `:has()`, which keeps it working on older Safari.
function rememberFold(det, id) {
  const card = det.closest('.sset-card');
  const sync = () => { if (card) card.classList.toggle('on', det.open); };
  sync();
  det.addEventListener('toggle', () => {
    sync();
    try {
      const m = loadSettingsOpen();
      m[id] = det.open;
      localStorage.setItem(SETTINGS_OPEN_KEY, JSON.stringify(m));
    } catch { /* ignore */ }
  });
  return det;
}
// Every fold has its OWN signature colour — a fixed identity, not a status light,
// so a section is recognisable by colour before you have read a word of it. The
// colour is set once on the card as `--tone` and everything downstream reads it:
// the icon chip, the card when open, and the panel inside it. Group headings take
// the colour of the first section beneath them so the runs read as blocks.
const SETTINGS_TONES = {
  kits:        '#7c5cd6',  // violet
  people:      '#2f6fe0',  // blue
  places:      '#0a92a6',  // teal (the app's brand)
  owners:      '#5b7f2a',  // olive — whose the gear is (distinct from People's blue beside it)
  phases:      '#8a3ffc',  // electric violet — the timeline of a pack
  conditions:  '#b45309',  // burnt amber — wear and lifecycle
  presets:     '#c9821a',  // amber
  sharedtrips: '#2f9e63',  // green
  theme:       '#d9459b',  // magenta
  sync:        '#0ea5e9',  // sky
  data:        '#dd7324',  // orange
  snapshots:   '#0d9488',  // deep turquoise
  howto:       '#4f46e5',  // indigo
  vhist:       '#9333ea',  // purple
  diag:        '#e11d48',  // rose
  about:       '#64748b',  // slate
};
const toneOf = (t) => SETTINGS_TONES[t] || t || '#64748b';

// The summary line shared by every fold: coloured icon chip, title + one-line
// state, and a chevron that turns as it opens.
function foldSummary(title, summaryText, icon) {
  return `<summary>
    <span class="sset-ic">${ic(icon || 'dot', 'md')}</span>
    <span class="sset-txt">
      <span class="howto-h">${esc(title)}</span>
      <span class="howto-sum">${esc(summaryText || '')}</span>
    </span>
    <span class="sset-chev">${IC.fwd}</span>
  </summary>`;
}

// Wrap an existing settings card in a fold WITHOUT moving its children: the card
// element keeps every child (and therefore every handler already bound to it) and
// simply becomes the fold's body. Its <h2> is lifted into the summary.
function foldCard(id, cardEl, summaryText, { icon = 'dot', tone = null, open = false } = {}) {
  const h2 = cardEl.querySelector(':scope > h2');
  const title = h2 ? h2.textContent.trim() : id;
  if (h2) h2.remove();
  cardEl.classList.remove('card', 'block');
  cardEl.classList.add('howto-body');
  const outer = h(`<div class="card block sset-card" style="--tone:${toneOf(tone || id)}">
    <details class="howto sset" data-sset="${esc(id)}"${settingsOpen(id, open) ? ' open' : ''}>
      ${foldSummary(title, summaryText, icon)}
    </details></div>`);
  const det = outer.querySelector('details');
  det.appendChild(cardEl);
  rememberFold(det, id);
  return outer;
}
// One of the already-folded cards (the guide, version history, diagnostics) — they
// carry their own <details>, so their summary is rebuilt in place to match.
function adoptFold(cardEl, id, { icon = 'dot', tone = null, open = false } = {}) {
  const det = cardEl.querySelector('details');
  if (!det) return cardEl;
  cardEl.classList.add('sset-card');
  cardEl.style.setProperty('--tone', toneOf(tone || id));
  det.classList.add('sset');
  det.dataset.sset = id;
  const old = det.querySelector('summary');
  const title = old?.querySelector('.howto-h')?.textContent.trim() || id;
  const sum = old?.querySelector('.howto-sum')?.textContent.trim() || '';
  if (old) old.outerHTML = foldSummary(title, sum, icon);
  det.open = settingsOpen(id, open);
  rememberFold(det, id);
  return cardEl;
}
const settingsGroup = (label, tone) => h(`<h3 class="set-group" style="--tone:${toneOf(tone)}">${esc(label)}</h3>`);

async function renderSettings() {
  const wrap = h('<section class="screen"></section>');
  wrap.appendChild(h('<div class="topbar"><h1>Settings</h1></div>'));

  const protectedNow = await storageProtected();
  const [curCounts, usedLabel, snapshots, bEvents, bLists, bActions] = await Promise.all([
    db.currentCounts(), storageUsedLabel(), db.listSnapshots(),
    db.getEvents(), db.getLists(), db.getActions(),
  ]);
  // Settings can be opened as the very first screen of a session, before any list
  // screen has run — and the Owners section needs the catalogue to say how many
  // items each owner has, and to offer a name given on the other device.
  ALL_LISTS = bLists;
  // The timeline and the five author-made lists are shared between devices, so
  // re-read them rather than drawing the copy this session started with — the
  // other device may have changed them since. This is also what stops an edit made
  // here from writing a stale list back over a newer one.
  await db.refreshPhases().catch(() => {});
  await refreshShared();
  const dsb = daysSinceBackup();
  const bstate = currentBackupState(bEvents, bLists, bActions);
  // Say plainly whether the saved file still matches what's in the app — "3 days
  // ago" reads as safe even when a whole trip has been built since.
  const backupStatus = dsb === null
    ? `${ic('warn','sm')}<b class="warn-txt">No backup file saved yet</b> — save one and keep it somewhere safe (Files / iCloud Drive).`
    : bstate.unsaved
      ? `${ic('warn','sm')}Last backup: <b>${dsb === 0 ? 'today' : `${dsb} day${dsb === 1 ? '' : 's'} ago`}</b> — <b class="warn-txt">you’ve made changes since</b>, so save a fresh one.`
      : `${ic('lock','sm')}Last backup: <b>${dsb === 0 ? 'today' : `${dsb} day${dsb === 1 ? '' : 's'} ago`}</b> — nothing has changed since, so it’s still current.`;
  const protectStatus = protectedNow
    ? `${ic('lock','sm')}<b>Storage protected</b> — the browser has been asked not to auto-delete your data.`
    : `${ic('warn','sm')}<b>Storage not yet protected</b> — <b>install</b> the app (iPhone: Share → Add to Home Screen; Mac: File → Add to Dock) so your data isn’t auto-deleted, and take regular backups.`;

  const overviewLink = h(`<a class="care-link" href="#/overview">
    <span class="care-link-ic">${ic('folder','md')}</span>
    <span class="care-link-body"><b>Maintenance mode — database overview</b><span class="care-link-sub">Every item on one line, the templates it’s in, its flags &amp; storage — with look-alikes flagged, so you can keep the whole catalog tidy</span></span>
    <span class="care-link-go">${IC.fwd}</span>
  </a>`);

  // --- Sync between your devices (only shown when this build is wired to a
  // cloud database; with none, the whole card is absent and nothing is uploaded).
  const syncSt = db.cloudConfigured()
    ? await db.syncStatus().catch(() => ({ signedIn: false, user: '' }))
    : null;
  const syncEl = db.cloudConfigured() ? await syncCard() : null;

  const card = h(`<div class="card block">
    <h2>Backup &amp; restore</h2>
    <p class="muted">Everything is stored <b>on this device</b>. Because it lives in the browser, a saved backup file is your real safety net.</p>
    <p class="data-status">${ic('box','sm')}<b>${esc(countsSummary(curCounts))}</b>${usedLabel ? ` · ${esc(usedLabel)} used` : ''}</p>
    <p class="data-status">${protectStatus}</p>
    <p class="data-status">${backupStatus}</p>
    <p class="muted small">Safari can’t be given a folder to save into automatically, so the app asks instead — the reminder on Home gets more insistent the longer your file is out of date, and saves it in one tap. The file lands in your <b>Downloads</b> folder; keep a copy in iCloud Drive.</p>
    <div class="btnrow">
      <button class="btn" data-x="export">${ic('save','sm')}<span>Save backup file</span></button>
      <button class="btn" data-x="import">Import backup</button>
      <button class="btn" data-x="xlsxall">Export all events (Excel)</button>
      <button class="btn ghost" data-x="tidyphotos">Tidy up photos</button>
    </div>
    <input type="file" accept="application/json,.json" hidden>
  </div>`);

  // Automatic on-device safety net — the app keeps recent full copies here.
  const snapCard = h(`<div class="card block">
    <h2>Automatic backups</h2>
    <p class="muted">The app quietly keeps recent copies of your data <b>on this device</b>, so a mistaken edit, delete or import is easy to undo. A copy is also taken automatically <b>before</b> any restore. These live on this device — a saved backup <b>file</b> is still your insurance against losing the device itself.</p>
    <div class="snap-list" data-snaps></div>
    <div class="btnrow"><button class="btn" data-snap="save">${IC.plus}<span>Save a copy now</span></button></div>
  </div>`);
  const drawSnaps = (list) => {
    const box = snapCard.querySelector('[data-snaps]');
    if (!list.length) { box.innerHTML = '<p class="muted">No automatic backups yet — one is saved as you use the app (about once a day).</p>'; return; }
    box.innerHTML = list.map((s) => `<div class="snap-row">
      <span class="snap-info">
        <b class="snap-when">${esc(snapshotWhen(s.createdAt))}</b>
        <span class="snap-sub">${esc(SNAPSHOT_REASONS[s.reason] || 'Backup')} · ${esc(countsSummary(s.counts))}</span>
      </span>
      <span class="snap-acts">
        <button type="button" class="btn sm" data-snap-restore="${esc(s.id)}">Restore</button>
        <button type="button" class="iconbtn sm" data-snap-del="${esc(s.id)}" aria-label="Delete this backup" title="Delete">${IC.trash}</button>
      </span></div>`).join('');
  };
  drawSnaps(snapshots);
  snapCard.addEventListener('click', async (e) => {
    const save = e.target.closest('[data-snap="save"]');
    const restore = e.target.closest('[data-snap-restore]');
    const del = e.target.closest('[data-snap-del]');
    if (save) {
      const snap = await db.saveSnapshot({ reason: 'manual', prefs: collectPrefs(), force: true });
      drawSnaps(await db.listSnapshots());
      if (snap) alert(`Saved a copy: ${countsSummary(snap.counts)}.`);
    } else if (restore) {
      const id = restore.dataset.snapRestore;
      const snap = (await db.listSnapshots()).find((s) => s.id === id);
      if (!snap) { alert('That backup is no longer available.'); drawSnaps(await db.listSnapshots()); return; }
      const cur = await db.currentCounts();
      let warn = `Restore this backup?\n\n  ${countsSummary(snap.counts)}\n  (${snapshotWhen(snap.createdAt)})\n\nThis REPLACES everything currently in the app. Your current data (${countsSummary(cur)}) is saved as a fresh automatic backup first, so this is undoable.`;
      if (!confirm(warn)) return;
      try {
        const res = await db.restoreSnapshot(id);
        if (res.prefs) await applyPrefs(res.prefs);
        alert(`Restored: ${countsSummary(res.counts)}.`);
        render();
      } catch (err) { alert(err.message || 'Could not restore that backup.'); }
    } else if (del) {
      const id = del.dataset.snapDel;
      if (!confirm('Delete this automatic backup? This only removes this on-device copy.')) return;
      await db.deleteSnapshot(id);
      drawSnaps(await db.listSnapshots());
    }
  });

  const trips = h(`<div class="card block">
    <h2>Shared trips</h2>
    <p class="muted">Someone shared a trip file with you? Import it here to add it as your own event. (Shared links open and import on their own.)</p>
    <div class="btnrow">
      <button class="btn" data-t="importtrip">Import a trip file</button>
    </div>
    <input type="file" accept="application/json,.json" hidden>
  </div>`);

  const places = h(`<div class="card block">
    <h2>Storage places</h2>
    <p class="muted">The set of places offered in every item’s <b>Where it’s stored</b> dropdown. Add your own, rename them, or remove ones you don’t use. Renaming carries over to every item already kept there. <b>The order here is the order in every dropdown</b> — move the places you reach for most to the top.</p>
    <div class="places-list" data-places></div>
    <div class="btnrow"><button class="btn" data-place="add">${IC.plus}<span>Add a place</span></button></div>
  </div>`);
  const drawPlaces = () => {
    const box = places.querySelector('[data-places]');
    // In YOUR order, not A–Z: the arrows below are what sets it.
    const locs = loadStorageLocs();
    box.innerHTML = locs.length
      ? locs.map((s, i) => `<div class="place-row">
          <span class="place-name">${esc(s)}</span>
          <span class="place-acts">
            <button type="button" class="iconbtn sm" data-place-up="${esc(s)}" aria-label="Move ${esc(s)} up" title="Move up"${i === 0 ? ' disabled' : ''}>${IC.up}</button>
            <button type="button" class="iconbtn sm" data-place-down="${esc(s)}" aria-label="Move ${esc(s)} down" title="Move down"${i === locs.length - 1 ? ' disabled' : ''}>${IC.down}</button>
            <button type="button" class="iconbtn sm" data-place-edit="${esc(s)}" aria-label="Rename ${esc(s)}" title="Rename">${IC.edit}</button>
            <button type="button" class="iconbtn sm" data-place-del="${esc(s)}" aria-label="Remove ${esc(s)}" title="Remove">${IC.trash}</button>
          </span></div>`).join('')
      : '<p class="muted">No places yet — add one below.</p>';
  };
  drawPlaces();
  places.addEventListener('click', async (e) => {
    const add = e.target.closest('[data-place="add"]');
    const edit = e.target.closest('[data-place-edit]');
    const del = e.target.closest('[data-place-del]');
    const up = e.target.closest('[data-place-up]');
    const down = e.target.closest('[data-place-down]');
    if (!add && !edit && !del && !up && !down) return;
      // Re-read before changing anything. A list is shared, so this screen may have
      // been open while the other device added to it — and an edit that started
      // from a stale copy would write that copy back and delete what it never saw.
    await refreshShared();
    drawPlaces();
    if (add) {
      const name = (prompt('Name of the new storage place:', '') || '').trim();
      if (!name) return;
      if (loadStorageLocs().some((s) => s.toLowerCase() === name.toLowerCase())) { alert(`“${name}” is already in the list.`); return; }
      await rememberStorageLoc(name);
      drawPlaces();
    } else if (edit) {
      const old = edit.dataset.placeEdit;
      const name = (prompt('Rename this storage place:', old) || '').trim();
      if (!name || name === old) return;
      if (loadStorageLocs().some((s) => s.toLowerCase() === name.toLowerCase() && s.toLowerCase() !== old.toLowerCase())) { alert(`“${name}” is already in the list.`); return; }
      const n = await renameStorageLoc(old, name);
      drawPlaces();
      if (n) render(); // refresh any open item rows showing the old place
    } else if (del) {
      const name = del.dataset.placeDel;
      if (!confirm(`Remove “${name}” from the list of places?\n\nItems already stored there keep their label; this just takes it off the standard list.`)) return;
      await removeStorageLoc(name);
      drawPlaces();
    } else if (up || down) {
      // A reorder is the one edit here that IS the whole list, so it writes the
      // whole list — after the re-read above, so a place added on the other device
      // is carried along rather than deleted by this screen's older copy.
      const name = (up || down).dataset.placeUp || (up || down).dataset.placeDown;
      const list = loadStorageLocs();
      const i = list.findIndex((s) => s.toLowerCase() === (name || '').toLowerCase());
      const to = i + (up ? -1 : 1);
      if (i < 0 || to < 0 || to >= list.length) return;
      const [row] = list.splice(i, 1);
      list.splice(to, 0, row);
      await saveStorageLocs(list);
      drawPlaces();   // no render(): nothing else on this screen shows the order, and
                      // re-rendering Settings would throw away the scroll position
    }
  });

  // Trip presets — saved event recipes, with delete. Save one from any trip's
  // The "Save as preset" button; start a new trip from one on Home.
  const presetCard = h(`<div class="card block">
    <h2>Trip presets</h2>
    <p class="muted">A preset is a <b>saved answer sheet for the Home builder</b> — which activities you tick plus every trip setting (transport, season, catering, weather, laundry). It holds <b>no items</b>: the gear still comes from your <b>templates</b>. Start a new trip from one on the <b>Home</b> screen; save a new one from any trip via its <b>Save as preset</b> button. Changing or deleting a preset never touches a trip you already made.</p>
    <div class="snap-list" data-presets></div>
  </div>`);
  const drawPresets = () => {
    const box = presetCard.querySelector('[data-presets]');
    const list = loadPresets().sort((a, b) => a.name.localeCompare(b.name));
    box.innerHTML = list.length
      ? list.map((p) => `<div class="snap-row">
          <span class="snap-info"><b class="snap-when">${esc(p.name)}</b><span class="snap-sub">${esc(presetSummary(p.config))}</span></span>
          <span class="snap-acts"><button type="button" class="iconbtn sm" data-preset-del="${esc(p.id)}" aria-label="Delete preset ${esc(p.name)}" title="Delete">${IC.trash}</button></span>
        </div>`).join('')
      : '<p class="muted">No presets yet — open a trip and tap Save as preset to make your first.</p>';
  };
  drawPresets();
  presetCard.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-preset-del]');
    if (!del) return;
    const p = loadPresets().find((x) => x.id === del.dataset.presetDel);
    if (p && confirm(`Delete the preset “${p.name}”? This won’t affect any trips you already made from it.`)) {
      await deletePreset(p.id);
      drawPresets();
    }
  });

  // Kits — reusable bundles of items always packed together. Build them here; add
  // a whole kit as one unit from a template's or a trip's "Kit" button.
  const kitCard = h(`<div class="card block">
    <h2>Kits</h2>
    <p class="muted">Bundles of small things you always pack together — a charging kit, a wash bag, a first-aid pouch. Build one here, then add the whole kit as a single unit from any <b>template</b> or <b>trip</b>. On the packing list its items cluster under the kit so you can pack it all in one go.</p>
    <div class="kit-list" data-kits></div>
    <div class="btnrow"><button class="btn" data-kit="add">${IC.plus}<span>New kit</span></button></div>
  </div>`);
  const drawKits = () => {
    const box = kitCard.querySelector('[data-kits]');
    const kits = (ALL_KITS || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    box.innerHTML = kits.length
      ? kits.map((k) => `<div class="kit-row">
          <span class="kit-row-ic" aria-hidden="true">${esc(kitEmoji(k))}</span>
          <span class="kit-row-info"><b class="kit-row-name">${esc(k.name)}</b><span class="kit-row-sub">${k.itemIds.length} item${k.itemIds.length === 1 ? '' : 's'}${k.note ? ` · ${esc(k.note)}` : ''}</span></span>
          <span class="kit-row-acts">
            <button type="button" class="iconbtn sm" data-kit-edit="${esc(k.id)}" aria-label="Edit ${esc(k.name)}" title="Edit">${IC.edit}</button>
            <button type="button" class="iconbtn sm" data-kit-del="${esc(k.id)}" aria-label="Delete ${esc(k.name)}" title="Delete">${IC.trash}</button>
          </span></div>`).join('')
      : '<p class="muted">No kits yet — tap <b>New kit</b> to build your first bundle.</p>';
  };
  drawKits();
  kitCard.addEventListener('click', async (e) => {
    const add = e.target.closest('[data-kit="add"]');
    const edit = e.target.closest('[data-kit-edit]');
    const del = e.target.closest('[data-kit-del]');
    if (add) {
      await openKitEditor(null, () => drawKits());
    } else if (edit) {
      const k = ALL_KITS.find((x) => x.id === edit.dataset.kitEdit);
      if (k) await openKitEditor(k, () => drawKits());
    } else if (del) {
      const k = ALL_KITS.find((x) => x.id === del.dataset.kitDel);
      if (!k) return;
      if (!confirm(`Delete the kit “${k.name}”?\n\nThis only removes the bundle. Items already added to a template or trip from it stay put.`)) return;
      await db.deleteKit(k.id);
      await refreshKits();
      drawKits();
    }
  });

  // People — the roster for "who packs what" on a trip.
  const peopleCard = h(`<div class="card block">
    <h2>People</h2>
    <p class="muted">Who you pack with. Assign an item to a person on a trip (in its editor), then filter the packing list — and <b>Packing Mode</b> — by person, so each of you sees just your things. Names travel with a <b>shared trip</b>, so the split survives when you send it to someone.</p>
    <div class="people-list" data-people></div>
    <div class="btnrow"><button class="btn" data-person="add">${IC.plus}<span>Add person</span></button></div>
  </div>`);
  const drawPeople = () => {
    const box = peopleCard.querySelector('[data-people]');
    const people = loadPeople();
    box.innerHTML = people.length
      ? people.map((p) => `<div class="person-row">
          <input type="color" class="person-color" data-person-color="${esc(p.id)}" value="${esc(p.color)}" aria-label="Colour for ${esc(p.name)}">
          <span class="person-name">${esc(p.name)}</span>
          <span class="person-acts">
            <button type="button" class="iconbtn sm" data-person-edit="${esc(p.id)}" aria-label="Rename ${esc(p.name)}" title="Rename">${IC.edit}</button>
            <button type="button" class="iconbtn sm" data-person-del="${esc(p.id)}" aria-label="Remove ${esc(p.name)}" title="Remove">${IC.trash}</button>
          </span></div>`).join('')
      : '<p class="muted">No people yet — add one to start splitting who packs what.</p>';
  };
  drawPeople();
  peopleCard.addEventListener('change', async (e) => {
    const col = e.target.closest('[data-person-color]');
    if (!col) return;
    await refreshShared();
    const people = loadPeople();
    const p = people.find((x) => x.id === col.dataset.personColor);
    if (p) { p.color = col.value; await savePeople(people); }
  });
  peopleCard.addEventListener('click', async (e) => {
    const add = e.target.closest('[data-person="add"]');
    const edit = e.target.closest('[data-person-edit]');
    const del = e.target.closest('[data-person-del]');
    if (!add && !edit && !del) return;
      // Re-read before changing anything. A list is shared, so this screen may have
      // been open while the other device added to it — and an edit that started
      // from a stale copy would write that copy back and delete what it never saw.
    await refreshShared();
    drawPeople();
    if (add) {
      const name = (prompt('Name of the person:', '') || '').trim();
      if (!name) return;
      const people = loadPeople();
      if (people.some((p) => p.name.toLowerCase() === name.toLowerCase())) { alert(`“${name}” is already on the list.`); return; }
      const color = PERSON_COLORS[people.length % PERSON_COLORS.length];
      people.push(newPerson({ name, color }));
      await savePeople(people);
      drawPeople();
    } else if (edit) {
      const people = loadPeople();
      const p = people.find((x) => x.id === edit.dataset.personEdit);
      if (!p) return;
      const name = (prompt('Rename this person:', p.name) || '').trim();
      if (!name || name === p.name) return;
      if (people.some((x) => x.id !== p.id && x.name.toLowerCase() === name.toLowerCase())) { alert(`“${name}” is already on the list.`); return; }
      const old = p.name;
      p.name = name;
      // The roster is keyed by the NAME, so a rename creates a new row — say so, or
      // the person would end up on the list twice under both spellings.
      await savePeople(people, { remove: [sharedRowId('people', old)] });
      // Carry the new name onto every trip entry assigned to the old name.
      const moved = await renamePackerEverywhere(old, name);
      drawPeople();
      if (moved) render();
    } else if (del) {
      const people = loadPeople();
      const p = people.find((x) => x.id === del.dataset.personDel);
      if (!p) return;
      if (!confirm(`Remove “${p.name}” from the People list?\n\nItems already assigned to them on a trip keep the name; this just takes them off the roster.`)) return;
      if (sharedStored('people')) await deleteShared([p.id]);
      else await savePeople(people.filter((x) => x.id !== p.id), { remove: [p.id] });
      drawPeople();
    }
  });

  // ---- Owners: whose each thing is ----
  const ownerCard = h(`<div class="card block">
    <h2>Owners</h2>
    <p class="muted">Whose things are whose — set on an item under <b>Details &amp; ownership</b>, and shown as a tag on its row. This is the same list every <b>Owner</b> dropdown offers, so a name is spelled once and picked everywhere. <b>Rename</b> one and every item that is theirs follows; <b>remove</b> one and you say who its things go to first. Separate from <b>People</b> on purpose: People is who <em>packs</em>, so “Shared” can own things without joining every “Packed by” picker.</p>
  </div>`);
  const ownersEditor = buildOwnersEditor({
    onChanged: () => {
      // Keep the fold's own summary line honest without re-rendering all of Settings.
      const sum = ownerCard.closest('.sset')?.querySelector('.howto-sum');
      if (sum) sum.textContent = ownersSummary();
    },
  });
  ownerCard.appendChild(ownersEditor.el);

  // ---- When: the phases of a pack, in timeline order ----
  const phaseCard = h(`<div class="card block">
    <h2>When</h2>
    <p class="muted">The stages of a pack, in the order they happen — set on an item as its <b>When</b>, and the headings your packing list and <b>Packing Mode</b> are built from. Give each one an <b>emoji</b> and a <b>colour</b>, rename it, drag it up or down the timeline, or add your own. <b>Days ahead</b> is when the app starts nudging you to pack it. Unlike your People, Owners and Item conditions, <b>this list syncs</b> between your devices — it has to, because every item points into it.</p>
    <div class="phase-list" data-phases></div>
    <div class="btnrow">
      <button class="btn" data-phase="add">${IC.plus}<span>Add phase</span></button>
      <button class="btn ghost" data-phase="reset">${IC.refresh}<span>Reset to the standard seven</span></button>
    </div>
  </div>`);

  const drawPhases = () => {
    const sum = phaseCard.closest('.sset')?.querySelector('.howto-sum');
    if (sum) sum.textContent = phasesSummary();
    const box = phaseCard.querySelector('[data-phases]');
    const list = PHASES;
    // The name is an ordinary text box rather than a pen-and-dialog: it is the
    // thing you are most likely to change, it saves a button on a phone-width row,
    // and it behaves like the emoji and colour beside it.
    box.innerHTML = list.map((p, i) => `<div class="phase-row" data-phase-id="${esc(p.id)}" style="--phase:${esc(p.color)}">
      <div class="phase-head">
        <input class="phase-emoji" data-phase-emoji="${esc(p.id)}" value="${esc(p.emoji)}" maxlength="4" aria-label="Emoji for ${esc(p.label)}" autocomplete="off">
        <input type="color" class="phase-color" data-phase-color="${esc(p.id)}" value="${esc(p.color)}" aria-label="Colour for ${esc(p.label)}">
        <input class="phase-name" data-phase-name="${esc(p.id)}" value="${esc(p.label)}" maxlength="60" aria-label="Name of this phase" autocomplete="off">
      </div>
      <div class="phase-controls">
        <label class="phase-lead" title="How many days before you leave this stage starts nudging you. -1 means after the trip."><span>Days</span>
          <input type="number" min="-1" max="365" inputmode="numeric" data-phase-lead="${esc(p.id)}" value="${p.leadDays}"></label>
        <label class="check phase-task${p.task ? ' on' : ''}" title="A to-do phase holds things to DO, not things to pack"><input type="checkbox" data-phase-task="${esc(p.id)}"${p.task ? ' checked' : ''}>to-dos</label>
        <span class="phase-acts">
          <button type="button" class="iconbtn sm" data-phase-up="${esc(p.id)}" aria-label="Move ${esc(p.label)} earlier" title="Earlier"${i === 0 ? ' disabled' : ''}>${IC.up}</button>
          <button type="button" class="iconbtn sm" data-phase-down="${esc(p.id)}" aria-label="Move ${esc(p.label)} later" title="Later"${i === list.length - 1 ? ' disabled' : ''}>${IC.down}</button>
          <button type="button" class="iconbtn sm" data-phase-del="${esc(p.id)}" aria-label="Remove ${esc(p.label)}" title="Remove">${IC.trash}</button>
        </span>
      </div>
    </div>`).join('');
  };
  drawPhases();

  // The things you can change without a dialog: name, emoji, colour, lead time and
  // the to-do switch. Each writes the whole list, which is what syncs.
  //
  // EVERY handler starts from a FRESH read of the database, never from the copy in
  // memory. This list is shared between devices: if the other one added a phase
  // while this screen was open, writing a stale copy back would delete it, because
  // a save is "here is the whole list" — the only way a removal can propagate.
  phaseCard.addEventListener('change', async (e) => {
    const el = e.target;
    const id = el.dataset.phaseEmoji || el.dataset.phaseColor || el.dataset.phaseLead
      || el.dataset.phaseTask || el.dataset.phaseName;
    if (!id) return;
    const list = await db.getPhases();
    const p = list.find((x) => x.id === id);
    if (!p) return;
    if (el.dataset.phaseName) {
      const label = (el.value || '').trim();
      if (!label) { el.value = p.label; return; }                       // never let a phase go nameless
      if (list.some((x) => x.id !== p.id && normName(x.label) === normName(label))) {
        alert(`“${label}” is already on the timeline.`);
        el.value = p.label; return;
      }
      p.label = label;                                                  // the id never changes, so nothing has to move
    } else if (el.dataset.phaseEmoji) p.emoji = (el.value || '').trim() || PHASE_DEFAULT_EMOJI;
    else if (el.dataset.phaseColor) p.color = el.value;
    else if (el.dataset.phaseLead) p.leadDays = Math.max(-1, Math.min(365, parseInt(el.value, 10) || 0));
    else p.task = el.checked;
    await db.savePhases(list);
    drawPhases();
  });

  phaseCard.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-phase], [data-phase-up], [data-phase-down], [data-phase-del]');
    if (!btn) return;
    const list = await db.getPhases();     // fresh, for the reason above
    const act = btn.dataset.phase;

    if (act === 'add') {
      const label = (prompt('Name the phase — e.g. “Night before the flight”, “Load the car”:', '') || '').trim();
      if (!label) return;
      if (list.some((p) => normName(p.label) === normName(label))) { alert(`“${label}” is already on the timeline.`); return; }
      list.push(newPhase(label, list.map((p) => p.id), { order: list.length }));
      await db.savePhases(list);
      drawPhases(); return;
    }
    if (act === 'reset') {
      if (!confirm('Put the timeline back to the standard seven?\n\nAnything you added is removed from the list — but nothing filed under it is deleted, and you will be asked where those things go. Items on a standard phase are untouched.')) return;
      // Removing the added phases one at a time, so each still asks where its
      // things go — a reset must not be able to strand anything either.
      for (const p of list.filter((x) => !DEFAULT_PHASES.some((d) => d.id === x.id))) {
        const used = await countPhaseUsers(p.id);
        if (used.total) {
          const to = await pickReplacementPhase(p, used, list.filter((x) => x.id !== p.id));
          if (to === null) return;                       // cancelled — leave the whole reset alone
          await movePhaseEverywhere(p.id, to);
        }
      }
      await db.savePhases(DEFAULT_PHASES.map((p) => ({ ...p })));
      drawPhases(); render(); return;
    }

    const idOf = (k) => btn.dataset[k];
    const move = async (from, to) => {
      const [row] = list.splice(from, 1);
      list.splice(to, 0, row);
      await db.savePhases(list.map((p, i) => ({ ...p, order: i })));
      drawPhases(); render();
    };
    if (idOf('phaseUp')) { const i = list.findIndex((p) => p.id === idOf('phaseUp')); if (i > 0) await move(i, i - 1); return; }
    if (idOf('phaseDown')) { const i = list.findIndex((p) => p.id === idOf('phaseDown')); if (i >= 0 && i < list.length - 1) await move(i, i + 1); return; }

    if (idOf('phaseDel')) {
      const p = list.find((x) => x.id === idOf('phaseDel'));
      if (!p) return;
      if (list.length <= 1) { alert('Keep at least one phase — otherwise your things have nowhere to be packed.'); return; }
      const used = await countPhaseUsers(p.id);
      let moveTo = '';
      if (used.total) {
        moveTo = await pickReplacementPhase(p, used, list.filter((x) => x.id !== p.id));
        if (moveTo === null) return;      // cancelled
      } else if (!confirm(`Remove the phase “${p.label}”? Nothing is filed under it.`)) return;
      if (used.total) {
        const n = await movePhaseEverywhere(p.id, moveTo);
        showToast(`Removed “${p.label}” — ${n} thing${n === 1 ? '' : 's'} moved to “${phaseLabel(moveTo)}”`);
      }
      await db.savePhases(list.filter((x) => x.id !== p.id));
      drawPhases(); render(); return;
    }
  });

  // ---- Item conditions: the wear/lifecycle ratings an item can carry ----
  //
  // Called "Item conditions" on screen since v125, not "Conditions": the app uses
  // the word twice — this list grades how worn a thing is, while an item's
  // "only include this item when…" rules are conditions too. The longer name says
  // which one you are looking at without having to read the paragraph under it.
  const condCard = h(`<div class="card block">
    <h2>Item conditions</h2>
    <p class="muted">How you grade the gear you own — set on an item under <b>Details &amp; ownership</b> as its <b>Item condition</b>. Rename them, reorder them (the order here is the order in every dropdown), or add your own. <b>Badge</b> decides whether the rating shows on item rows and how loudly; <b>needs replacing</b> makes it feed the <b>shopping list</b> and show the replace prompt, so a condition you invent can do that job too. <em>(Not to be confused with an item’s “only include this item when…” rules — those decide whether a thing comes on a trip at all.)</em></p>
    <div class="cond-list" data-conds></div>
    <div class="btnrow">
      <button class="btn" data-cond="add">${IC.plus}<span>Add condition</span></button>
      <button class="btn ghost" data-cond="reset">${IC.refresh}<span>Reset to the standard four</span></button>
    </div>
  </div>`);

  const drawConds = () => {
    // Keep the fold's own summary line honest without re-rendering all of Settings.
    const sum = condCard.closest('.sset')?.querySelector('.howto-sum');
    if (sum) sum.textContent = `${ITEM_CONDITIONS.length} ${ITEM_CONDITIONS.length === 1 ? 'condition' : 'conditions'} · ${ITEM_CONDITIONS.map((c) => c.label).join(', ')}${conditionsCustomised() ? '' : ' (standard)'}`;
    const box = condCard.querySelector('[data-conds]');
    const list = ITEM_CONDITIONS;
    box.innerHTML = list.map((c, i) => `<div class="cond-row" data-cond-id="${esc(c.id)}">
      <span class="cond-main">
        <span class="cond-name">
          <span class="cond-swatch ${esc(c.tone || 'none')}" title="${c.tone ? `Badges ${c.tone === 'warn' ? 'amber' : 'red'} on item rows` : 'No badge — stays quiet on item rows'}">${c.replace ? ic('swap','xs') : ''}</span>
          ${esc(c.label)}
        </span>
        <span class="cond-controls">
          <label class="cond-tone"><span>Badge</span>
            <select data-cond-tone="${esc(c.id)}">${CONDITION_TONES.map((t) => `<option value="${esc(t.id)}"${t.id === c.tone ? ' selected' : ''}>${esc(t.label)}</option>`).join('')}</select>
          </label>
          <label class="check cond-replace${c.replace ? ' on' : ''}"><input type="checkbox" data-cond-replace="${esc(c.id)}"${c.replace ? ' checked' : ''}>needs replacing</label>
        </span>
      </span>
      <span class="cond-acts">
        <button type="button" class="iconbtn sm" data-cond-up="${esc(c.id)}" aria-label="Move ${esc(c.label)} up" title="Move up"${i === 0 ? ' disabled' : ''}>${IC.up}</button>
        <button type="button" class="iconbtn sm" data-cond-down="${esc(c.id)}" aria-label="Move ${esc(c.label)} down" title="Move down"${i === list.length - 1 ? ' disabled' : ''}>${IC.down}</button>
        <button type="button" class="iconbtn sm" data-cond-edit="${esc(c.id)}" aria-label="Rename ${esc(c.label)}" title="Rename">${IC.edit}</button>
        <button type="button" class="iconbtn sm" data-cond-del="${esc(c.id)}" aria-label="Remove ${esc(c.label)}" title="Remove">${IC.trash}</button>
      </span>
    </div>`).join('');
  };
  drawConds();

  condCard.addEventListener('change', async (e) => {
    const tone = e.target.closest('[data-cond-tone]');
    const rep = e.target.closest('[data-cond-replace]');
    if (!tone && !rep) return;
    await refreshShared();
    const list = ITEM_CONDITIONS.map((c) => ({ ...c }));
    if (tone) {
      const c = list.find((x) => x.id === tone.dataset.condTone);
      if (c) c.tone = tone.value;
    } else {
      const c = list.find((x) => x.id === rep.dataset.condReplace);
      if (c) c.replace = rep.checked;
    }
    await saveConditions(list);
    drawConds();
  });

  condCard.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-cond], [data-cond-up], [data-cond-down], [data-cond-edit], [data-cond-del]');
    if (!btn) return;
      // Re-read before changing anything. A list is shared, so this screen may have
      // been open while the other device added to it — and an edit that started
      // from a stale copy would write that copy back and delete what it never saw.
    await refreshShared();
    const list = ITEM_CONDITIONS.map((c) => ({ ...c }));
    const act = btn.dataset.cond;

    if (act === 'add') {
      const label = (prompt('Name the condition — e.g. “Failing”, “Borrowed”, “Being repaired”:', '') || '').trim();
      if (!label) return;
      if (list.some((c) => c.label.toLowerCase() === label.toLowerCase())) { alert(`“${label}” is already on the list.`); return; }
      list.push(newCondition(label, list.map((c) => c.id)));
      await saveConditions(list); drawConds(); return;
    }
    if (act === 'reset') {
      if (!confirm('Put the conditions back to New / Good / Worn / Needs replacing?\n\nAnything you added is removed from the list. Items already set to one of them keep it — they just show the raw name until you add it back.')) return;
      await resetConditions(); drawConds(); render(); return;
    }

    const idOf = (k) => btn.dataset[k];
    const move = async (from, to) => { const [row] = list.splice(from, 1); list.splice(to, 0, row); await saveConditions(list); drawConds(); };
    if (idOf('condUp')) { const i = list.findIndex((c) => c.id === idOf('condUp')); if (i > 0) await move(i, i - 1); return; }
    if (idOf('condDown')) { const i = list.findIndex((c) => c.id === idOf('condDown')); if (i >= 0 && i < list.length - 1) await move(i, i + 1); return; }

    if (idOf('condEdit')) {
      const c = list.find((x) => x.id === idOf('condEdit'));
      if (!c) return;
      const label = (prompt('Rename this condition:', c.label) || '').trim();
      if (!label || label === c.label) return;
      if (list.some((x) => x.id !== c.id && x.label.toLowerCase() === label.toLowerCase())) { alert(`“${label}” is already on the list.`); return; }
      c.label = label;                    // the id is untouched, so every item keeps its rating
      await saveConditions(list); drawConds(); render(); return;
    }

    if (idOf('condDel')) {
      const c = list.find((x) => x.id === idOf('condDel'));
      if (!c) return;
      if (list.length <= 1) { alert('Keep at least one condition — otherwise there is nothing to grade an item with.'); return; }
      // Never orphan an item: count what uses it, and let the user say where those go.
      const used = await countItemsWithCondition(c.id);
      let moveTo = '';
      if (used) {
        moveTo = await pickReplacementCondition(c, used, list.filter((x) => x.id !== c.id));
        if (moveTo === null) return;      // cancelled
      } else if (!confirm(`Remove the condition “${c.label}”? Nothing is using it.`)) return;
      const remaining = list.filter((x) => x.id !== c.id);
      if (used) {
        const n = await reassignCondition(c.id, moveTo);
        showToast(moveTo
          ? `Removed “${c.label}” — ${n} item${n === 1 ? '' : 's'} moved to “${itemConditionLabel(moveTo) || moveTo}”`
          : `Removed “${c.label}” — ${n} item${n === 1 ? '' : 's'} are now unrated`);
      }
      await saveConditions(remaining, { remove: [sharedRowId('conditions', c.id)] });
      ALL_LISTS = await db.getLists();
      drawConds(); render();
    }
  });

  const theme = h(`<div class="card block">
    <h2>Appearance</h2>
    ${radioRow('theme', [{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }], currentTheme())}
  </div>`);
  const howtoEl = howtoCard();
  const vhistEl = versionHistoryCard();

  // Diagnostics — a private on-device error log for troubleshooting.
  const diag = loadDiag();
  const diagCard = h(`<div class="card block">
    <details class="diag">
      <summary><span class="howto-h">Diagnostics</span><span class="howto-sum">${diag.length ? `${diag.length} logged issue${diag.length === 1 ? '' : 's'} — for troubleshooting` : 'No issues logged — all healthy'}</span></summary>
      <div class="diag-body">
        <p class="muted">A private log of any errors the app ran into, kept <b>on this device</b> so a glitch can be diagnosed. Nothing here leaves your device unless you copy it and share it yourself.</p>
        <div class="btnrow">
          <button class="btn" data-diag="copy"${diag.length ? '' : ' disabled'}>Copy log</button>
          <button class="btn" data-diag="clear"${diag.length ? '' : ' disabled'}>Clear</button>
        </div>
        <pre class="diag-log">${esc(diagAsText())}</pre>
      </div>
    </details>
  </div>`);
  diagCard.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-diag]')?.dataset.diag;
    if (!act) return;
    if (act === 'copy') {
      const text = diagAsText();
      try { await navigator.clipboard.writeText(text); alert('Diagnostics copied to the clipboard.'); }
      catch { alert('Could not copy automatically — the log is shown below; select and copy it.'); }
    } else if (act === 'clear') {
      if (!confirm('Clear the diagnostics log?')) return;
      clearDiag();
      render();
    }
  });

  const about = h(`<div class="card block">
    <h2>About</h2>
    <p class="muted">AMS Packing List — a private, offline packing-list builder. Combine reusable templates into one Packing List per event, organised by when to pack and where it goes.</p>
  </div>`);

  const file = card.querySelector('input[type=file]');
  card.addEventListener('click', async (e) => {
    const x = e.target.closest('[data-x]')?.dataset.x; if (!x) return;
    if (x === 'export') {
      await saveBackupFile();
      render();             // refresh the "Last backup" status shown below
    } else if (x === 'import') { file.click(); }
    else if (x === 'xlsxall') { await exportAllEventsXlsx(); }
    else if (x === 'tidyphotos') {
      // Free images no item (and no snapshot) points at any more — what's left
      // behind when you remove a photo or delete an item.
      const freed = await db.pruneOrphanPhotos();
      showToast(freed ? `Tidied up — ${freed} unused photo${freed === 1 ? '' : 's'} removed.` : 'Nothing to tidy — every photo is still in use.');
      render();
    }
  });
  file.addEventListener('change', async () => {
    const f = file.files[0]; if (!f) return;
    const text = await f.text();
    try {
      // 1) Validate + read the file WITHOUT touching the database, and show what's inside.
      const info = db.inspectBackup(text);
      const when = info.exportedAt ? new Date(info.exportedAt).toLocaleDateString() : 'an unknown date';
      const contents = `This backup contains:\n\n  • ${info.counts.items} items\n  • ${info.counts.templates} templates\n  • ${info.counts.events} trips`
        + (info.counts.actions ? `\n  • ${info.counts.actions} to-dos` : '')
        + (info.photos ? `\n  • ${info.photos} photos` : '')
        + `\n\nExported: ${when}\n\nContinue?`;
      if (!confirm(contents)) { file.value = ''; return; }
      // 2) Merge vs replace.
      const merge = confirm('Import as a MERGE — keep your current data too?\n\nOK = Merge   ·   Cancel = REPLACE everything with this backup.');
      // 3) Guard a shrinking replace: warn loudly if it would wipe most of the data.
      if (!merge) {
        const cur = await db.currentCounts();
        if (backupShrinks(cur, info.counts)
          && !confirm(`This REPLACES your current data\n( ${countsSummary(cur)} )\nwith a much smaller backup\n( ${countsSummary(info.counts)} ).\n\nYour current data is saved as an automatic backup first, so it's undoable — but continue only if you're sure.\n\nReplace anyway?`)) {
          file.value = ''; return;
        }
      }
      const res = await db.importJSON(text, { merge });
      if (res.prefs) await applyPrefs(res.prefs); // restore the five shared lists / theme / view too
      alert(`Imported ${res.lists} template(s) and ${res.events} trip(s)${res.actions ? ` and ${res.actions} to-do(s)` : ''}.`
        + (merge ? '' : '\n\nYour previous data was saved under Settings → Automatic backups, in case you want it back.'));
      render();
    } catch (err) { alert(err.message || 'Could not import that file.'); }
    file.value = '';
  });
  const tripFile = trips.querySelector('input[type=file]');
  trips.addEventListener('click', (e) => {
    if (e.target.closest('[data-t="importtrip"]')) tripFile.click();
  });
  tripFile.addEventListener('change', async () => {
    const f = tripFile.files[0]; if (!f) return;
    try {
      const ev = await db.importTrip(await f.text());
      location.assign(`#/event/${ev.id}`);
    } catch (err) { alert(err.message || 'Could not import that trip.'); }
    tripFile.value = '';
  });
  theme.addEventListener('change', (e) => { if (e.target.name === 'theme') setTheme(e.target.value); });

  // --- Assemble, most-used first -------------------------------------------
  // Everything above only BUILT its card; the running order lives here, in one
  // readable place. Sync/backup deliberately sit near the bottom: they matter
  // enormously and are touched about twice a year.
  const people = loadPeople();
  const places2 = loadStorageLocs();
  const presets2 = loadPresets();
  const kits2 = ALL_KITS || [];
  const themeLabel = { system: 'Auto (follows your Mac)', light: 'Light', dark: 'Dark' }[currentTheme()] || 'Auto';
  const nOf = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  wrap.appendChild(overviewLink);

  wrap.appendChild(settingsGroup('Your packing setup', 'kits'));
  wrap.appendChild(foldCard('kits', kitCard,
    kits2.length ? nOf(kits2.length, 'kit', 'kits') : 'None yet — bundles you pack as one',
    { icon: 'toolbox' }));
  wrap.appendChild(foldCard('people', peopleCard,
    people.length ? people.map((p) => p.name).join(', ') : 'None yet — for splitting who packs what',
    { icon: 'person' }));
  wrap.appendChild(foldCard('owners', ownerCard, ownersSummary(), { icon: 'person' }));
  wrap.appendChild(foldCard('phases', phaseCard, phasesSummary(), { icon: 'clock' }));
  wrap.appendChild(foldCard('places', places, places2.length
    ? `${nOf(places2.length, 'place', 'places')} · ${places2.slice(0, 3).join(', ')}${places2.length > 3 ? '…' : ''}`
    : 'None yet', { icon: 'box' }));
  wrap.appendChild(foldCard('conditions', condCard,
    `${nOf(ITEM_CONDITIONS.length, 'condition', 'conditions')} · ${ITEM_CONDITIONS.map((c) => c.label).join(', ')}${conditionsCustomised() ? '' : ' (standard)'}`,
    { icon: 'swap' }));
  wrap.appendChild(foldCard('presets', presetCard,
    presets2.length ? nOf(presets2.length, 'preset', 'presets') : 'None yet — save a trip’s setup to reuse',
    { icon: 'star' }));
  wrap.appendChild(foldCard('sharedtrips', trips, 'Import a trip someone sent you', { icon: 'share' }));

  wrap.appendChild(settingsGroup('Appearance', 'theme'));
  wrap.appendChild(foldCard('theme', theme, themeLabel, { icon: 'moon' }));

  wrap.appendChild(settingsGroup('Your data', 'sync'));
  if (syncEl) {
    const syncSum = syncSt && syncSt.signedIn
      ? `Syncing as ${accountName(syncSt.user)}`
      : 'Not syncing on this device';
    wrap.appendChild(foldCard('sync', syncEl, syncSum, { icon: 'refresh' }));
  }
  wrap.appendChild(foldCard('data', card, dsb === null
    ? 'No backup file saved yet'
    : bstate.unsaved
      ? `Last backup ${dsb === 0 ? 'today' : `${nOf(dsb, 'day', 'days')} ago`} — changes since`
      : `Backed up ${dsb === 0 ? 'today' : `${nOf(dsb, 'day', 'days')} ago`} — still current`,
    { icon: 'save' }));
  wrap.appendChild(foldCard('snapshots', snapCard,
    snapshots.length ? `${nOf(snapshots.length, 'copy', 'copies')} on this device` : 'None yet',
    { icon: 'clock' }));

  wrap.appendChild(settingsGroup('Help & about', 'howto'));
  wrap.appendChild(adoptFold(howtoEl, 'howto', { icon: 'list' }));
  wrap.appendChild(adoptFold(vhistEl, 'vhist', { icon: 'sparkle' }));
  wrap.appendChild(adoptFold(diagCard, 'diag', { icon: 'wrench' }));
  wrap.appendChild(foldCard('about', about, `AMS Packing List · ${APP_VERSION}`, { icon: 'globe' }));

  return wrap;
}

// ---------- Maintenance mode: the whole-database overview ----------
// A dense, one-line-per-item table across every template, for keeping the catalog
// current in one place: what each item is, which templates it's in, its flags,
// weight and storage — with probable duplicates surfaced and highlighted.
let overviewSearch = '';
const overviewFilter = new Set();       // reuses the shared item category chips (liquid/charge/…)
let overviewSort = 'name';              // 'name' | 'weight' | 'templates' | 'category'
let overviewDupesOnly = false;

function fmtWeight(g) {
  const n = Number(g) || 0;
  if (n <= 0) return '';
  return n >= 1000 ? `${(Math.round(n / 100) / 10)} kg` : `${Math.round(n)} g`;
}

// The small flag badges shown for one item in the overview (and reused nowhere else).
function ovFlagBadges(it) {
  const b = [];
  if (it.itemType === 'reminder') b.push(`<span class="ov-fl" title="A reminder / to-do, not a packed thing">${ic('note','xs')}</span>`);
  if (it.charging) { const s = chargeTypeShort(it.chargeType); b.push(`<span class="ov-fl" title="Needs charging${s ? ' · ' + esc(s) : ''}">${ic('bolt','xs')}${s ? `<em>${esc(s)}</em>` : ''}</span>`); }
  if (it.liquid) b.push(`<span class="ov-fl" title="Liquid / gel — 100 ml hand-luggage rule">${ic('drop','xs')}</span>`);
  if (it.restricted) b.push(`<span class="ov-fl" title="Battery / restricted — carry-on rules">${ic('warn','xs')}</span>`);
  if (it.perNight) b.push(`<span class="ov-fl" title="Quantity scales with the number of nights">${ic('moon','xs')}</span>`);
  if (it.shortList) b.push(`<span class="ov-fl" title="On the minimal short list">${ic('star','xs')}</span>`);
  if (hasCare(it)) b.push(`<span class="ov-fl" title="Has care / maintenance info">${ic('toolbox','xs')}</span>`);
  if ((it.photos || []).length) b.push(`<span class="ov-fl" title="${(it.photos || []).length} photo(s)">${ic('camera','xs')}</span>`);
  if (it.retired) b.push(`<span class="ov-fl" title="Not in use — kept on record but never packed">${ic('ban','xs')}</span>`);
  return b.join('');
}

// Where a row jumps to when tapped: its item editor, opened through the first
// real template it belongs to (else its loose / container home).
function ovEditHref(row) {
  const real = row.templates.find((t) => t.role !== 'loose' && t.role !== CONTAINER_ROLE);
  const t = real || row.templates[0];
  return t ? `#/list/${encodeURIComponent(t.id)}/item/${encodeURIComponent(row.item.id)}` : '#/lists';
}

// Chips naming the templates an item is in (real templates as links; the loose /
// container homes shown as a plain tag, since they aren't tickable templates).
function ovTemplateChips(row) {
  if (!row.templates.length) return `<span class="ov-tpl none">${ic('warn','xs')}No template</span>`;
  return row.templates.map((t) => {
    if (t.role === 'loose') return `<span class="ov-tpl none">${ic('warn','xs')}No template</span>`;
    if (t.role === CONTAINER_ROLE) return `<span class="ov-tpl bag">${ic('bag','xs')}${esc(t.name)}</span>`;
    return `<a class="ov-tpl" href="#/list/${esc(t.id)}">${esc(t.name)}</a>`;
  }).join('');
}

async function renderOverview() {
  const wrap = h('<section class="screen ov-screen"></section>');
  wrap.appendChild(h(backBar('Maintenance mode', '#/settings')));

  const lists = await db.getLists();
  ALL_LISTS = lists;                       // so isUnfiled() in the filter chips is accurate
  const rows = catalogRows(lists);
  const dupeGroups = duplicateGroups(rows);
  const dupIds = duplicateIds(rows);
  const realTemplates = lists.filter((l) => !l.role).length;

  wrap.appendChild(h(`<p class="ov-intro">One line per item across your whole catalogue — the templates it’s in, its flags, weight and where it’s stored. Tap any row to open that item; tap a template name to jump to the template. Use it to keep everything tidy and spot anything that’s drifted.</p>`));

  // Headline stats.
  const stat = (n, label) => `<span class="ov-stat"><b>${n}</b> ${label}</span>`;
  wrap.appendChild(h(`<div class="ov-stats">
    ${stat(rows.length, rows.length === 1 ? 'item' : 'items')}
    ${stat(realTemplates, realTemplates === 1 ? 'template' : 'templates')}
    ${dupeGroups.length ? `<span class="ov-stat warn"><b>${dupeGroups.length}</b> possible duplicate${dupeGroups.length === 1 ? '' : 's'}</span>` : stat(0, 'duplicates found')}
    <button class="btn ghost sm" type="button" data-ov="xlsx">${IC.sheet}<span>Export (Excel)</span></button>
  </div>`));

  // Duplicate finder — the bonus: surface look-alikes for a human to merge/rename.
  if (dupeGroups.length) {
    const groupHtml = dupeGroups.map((g) => {
      const items = g.rows.map((r) => {
        const where = r.templates.length
          ? r.templates.map((t) => t.role === 'loose' ? 'No template' : t.name).filter(Boolean).join(', ')
          : 'No template';
        return `<a class="ov-dupitem" href="${ovEditHref(r)}"><span class="ov-dupname">${esc(r.name)}</span><span class="ov-dupwhere">${esc(where)}</span>${IC.fwd}</a>`;
      }).join('');
      return `<div class="ov-dupgroup">
        <div class="ov-duphead">${g.exact ? `${ic('dot','xs')}Same name` : `${ic('dot','xs')}Look-alike`} <em>${g.rows.length}</em></div>
        ${items}
      </div>`;
    }).join('');
    wrap.appendChild(h(`<details class="card block ov-dupes" open>
      <summary><span class="ov-dupes-h">${ic('warn','sm')}Possible duplicates (${dupeGroups.length})</span><span class="ov-dupes-sub">Tap each to compare — then rename one, or remove the copy you don’t need</span></summary>
      <p class="ov-dupes-note">These items look alike (same or very similar names). They’re only <b>flagged</b>, never merged automatically — open each and decide. Rows below are highlighted in <span class="ov-dupmark">amber</span>.</p>
      ${groupHtml}
    </details>`));
  }

  // Toolbar: search, sort, duplicates-only, category chips.
  const sortSeg = (val, label) => `<label class="seg${overviewSort === val ? ' on' : ''}"><input type="radio" name="ovsort" value="${val}"${overviewSort === val ? ' checked' : ''}>${label}</label>`;
  const toolbar = h(`<div class="ov-toolbar">
    <label class="ai-searchbox">${IC.search}<input type="search" class="ov-search" placeholder="Search items, templates, storage…" value="${esc(overviewSearch)}" autocomplete="off"></label>
    <div class="ov-controls">
      <div class="segmented small ov-sortseg">${sortSeg('name', 'A–Z')}${sortSeg('weight', 'Heaviest')}${sortSeg('templates', 'Most used')}${sortSeg('category', 'Category')}</div>
      ${dupeGroups.length ? `<label class="ov-dupetoggle"><input type="checkbox" class="ov-dupeonly"${overviewDupesOnly ? ' checked' : ''}> Duplicates only</label>` : ''}
    </div>
    <div class="ov-filterbar"></div>
  </div>`);
  wrap.appendChild(toolbar);

  const filterEl = $('.ov-filterbar', toolbar);
  const searchEl = $('.ov-search', toolbar);
  const countEl = h('<div class="ov-count"></div>');
  wrap.appendChild(countEl);

  const scroll = h('<div class="ov-scroll"></div>');
  const table = h(`<div class="ov-table">
    <div class="ov-head">
      <span>Item</span><span>In templates</span><span>Flags</span><span class="ov-num">Weight</span><span>Stored</span>
    </div>
    <div class="ov-body"></div>
  </div>`);
  scroll.appendChild(table);
  wrap.appendChild(scroll);
  const body = $('.ov-body', table);

  const drawChips = () => { filterEl.innerHTML = itemFilterChipsHTML(rows.map((r) => r.item), overviewFilter, false); };

  const drawRows = () => {
    const q = overviewSearch.trim().toLowerCase();
    const cmp = {
      name: (a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }),
      weight: (a, b) => (Number(b.item.weight) || 0) - (Number(a.item.weight) || 0) || (a.name || '').localeCompare(b.name || ''),
      templates: (a, b) => b.templates.length - a.templates.length || (a.name || '').localeCompare(b.name || ''),
      category: (a, b) => (a.item.category || '').localeCompare(b.item.category || '') || (a.name || '').localeCompare(b.name || ''),
    }[overviewSort] || undefined;
    const shown = rows.filter((r) => {
      if (overviewDupesOnly && !dupIds.has(r.id)) return false;
      if (!itemMatchesFilter(r.item, overviewFilter)) return false;
      if (!q) return true;
      return (r.name || '').toLowerCase().includes(q)
        || (r.item.storage || '').toLowerCase().includes(q)
        || (r.item.category || '').toLowerCase().includes(q)
        || r.templates.some((t) => (t.name || '').toLowerCase().includes(q));
    }).slice().sort(cmp);

    const filtered = q || overviewFilter.size || overviewDupesOnly;
    countEl.textContent = filtered ? `${shown.length} of ${rows.length} items` : `${rows.length} items`;
    body.innerHTML = '';
    if (!shown.length) { body.appendChild(h('<div class="empty"><p class="empty-s">No items match.</p></div>')); return; }
    for (const r of shown) {
      const it = r.item;
      const dup = dupIds.has(r.id);
      const cat = it.category ? `<span class="ov-cat">${esc(it.category)}</span>` : '';
      const rowEl = h(`<div class="ov-row${dup ? ' dupe' : ''}${it.retired ? ' retired' : ''}" data-href="${ovEditHref(r)}">
        <span class="ov-cell ov-item">
          <span class="ov-name">${dup ? `<span class="ov-dupmark" title="Possible duplicate">${ic('warn','xs')}</span> ` : ''}${esc(it.name || '(unnamed)')}</span>
          <span class="ov-meta">${cat}</span>
        </span>
        <span class="ov-cell ov-tpls">${ovTemplateChips(r)}</span>
        <span class="ov-cell ov-flags">${ovFlagBadges(it) || '<span class="ov-dash">—</span>'}</span>
        <span class="ov-cell ov-num ov-weight">${fmtWeight(it.weight) || '<span class="ov-dash">—</span>'}</span>
        <span class="ov-cell ov-stored">${it.storage ? `${ic('pin','xs')}${esc(it.storage)}` : '<span class="ov-dash">—</span>'}</span>
      </div>`);
      body.appendChild(rowEl);
    }
  };
  drawChips();
  drawRows();

  searchEl.addEventListener('input', () => { overviewSearch = searchEl.value; drawRows(); });
  toolbar.addEventListener('change', (e) => {
    if (e.target.name === 'ovsort') {
      overviewSort = e.target.value;
      $$('.ov-sortseg .seg', toolbar).forEach((s) => s.classList.toggle('on', s.querySelector('input').checked));
      drawRows();
    } else if (e.target.classList.contains('ov-dupeonly')) {
      overviewDupesOnly = e.target.checked;
      drawRows();
    }
  });
  filterEl.addEventListener('click', (e) => {
    const key = e.target.closest('[data-cat]')?.dataset.cat;
    if (!key) return;
    if (key === '__clear') overviewFilter.clear();
    else if (overviewFilter.has(key)) overviewFilter.delete(key); else overviewFilter.add(key);
    drawChips();
    drawRows();
  });
  // Row tap → open the item editor, unless a template link inside was tapped.
  body.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const row = e.target.closest('.ov-row');
    if (row && row.dataset.href) location.assign(row.dataset.href);
  });
  wrap.querySelector('[data-ov="xlsx"]').addEventListener('click', () => exportOverviewXlsx(rows, dupIds));

  return wrap;
}

// A one-row-per-item spreadsheet of the whole catalogue — the maintenance overview
// as an Excel file, so the database can be reviewed or tidied away from the phone.
function exportOverviewXlsx(rows, dupIds) {
  if (!rows.length) { alert('No items to export yet.'); return; }
  const columns = [
    { header: 'Item', width: 28 }, { header: 'Swedish', width: 18 }, { header: 'Category', width: 18 },
    { header: 'Templates', width: 30 }, { header: 'Weight (g)', width: 11 }, { header: 'Stored', width: 20 },
    { header: 'Charging', width: 10 }, { header: 'Liquid', width: 8 }, { header: 'Restricted', width: 11 },
    { header: 'Per-night', width: 10 }, { header: 'Short list', width: 10 }, { header: 'Care', width: 8 },
    { header: 'Photos', width: 8 }, { header: 'Not in use', width: 11 }, { header: 'Possible duplicate', width: 16 },
  ];
  const yn = (v) => (v ? 'yes' : '');
  const dataRows = rows.map((r) => {
    const it = r.item;
    const tpls = r.templates.map((t) => t.role === 'loose' ? 'No template' : t.name).filter(Boolean).join(', ');
    return [
      it.name || '', it.swedish || '', it.category || '', tpls, Number(it.weight) || 0, it.storage || '',
      it.charging ? (chargeTypeShort(it.chargeType) || 'yes') : '', yn(it.liquid), yn(it.restricted),
      yn(it.perNight), yn(it.shortList), yn(hasCare(it)), (it.photos || []).length || '', yn(it.retired),
      dupIds.has(r.id) ? 'yes' : '',
    ];
  });
  const wb = buildWorkbook([{ name: 'All items', columns, rows: dataRows }]);
  downloadBlob(new Blob([wb], { type: XLSX_MIME }), `ams-packing-database-${todayISO()}.xlsx`);
}

// Import a trip carried in a deep link (#/t/<base64url>). Decodes, saves it as a
// new event, and jumps to it; shows a friendly error if the link is malformed.
async function renderImportTrip(data) {
  try {
    const ev = await db.importTrip(fromBase64Url(data));
    location.replace(`#/event/${ev.id}`);
    return h('<section class="screen"><div class="empty"><p class="empty-t">Trip imported</p><p class="empty-s">Opening it now…</p></div></section>');
  } catch (err) {
    return h(`<section class="screen"><div class="empty"><p class="empty-t">That trip link didn’t work</p><p class="empty-s">${esc(err.message || 'The link may be incomplete or damaged.')}</p><a class="btn primary" href="#/">Go home</a></div></section>`);
  }
}

async function exportAllEventsXlsx() {
  const events = await db.getEvents();
  if (!events.length) { alert('No events to export yet.'); return; }
  const columns = [
    { header: 'Phase', width: 22 }, { header: 'Container', width: 20 }, { header: 'Item', width: 30 },
    { header: 'Qty', width: 8 }, { header: 'Packed', width: 10 }, { header: 'Note', width: 30 },
  ];
  const sheets = events.map((ev) => ({
    name: sheetName(ev.name),
    columns,
    rows: totalListRows(ev, null).map((r) => [r.Phase, r.Container, r.Item, r.Qty, r.Packed, r.Note]),
  }));
  const wb = buildWorkbook(sheets);
  downloadBlob(new Blob([wb], { type: XLSX_MIME }), `ams-packing-lists-${todayISO()}.xlsx`);
}

// ---------- theme ----------
const THEME_KEY = 'ams-theme';
function currentTheme() { try { return localStorage.getItem(THEME_KEY) || 'system'; } catch { return 'system'; } }
function setTheme(v) {
  try { localStorage.setItem(THEME_KEY, v); } catch {}
  if (v === 'light' || v === 'dark') document.documentElement.setAttribute('data-theme', v);
  else document.documentElement.removeAttribute('data-theme');
  $$('.card.block .seg').forEach((s) => s.classList.toggle('on', s.querySelector('input')?.checked));
}

// --- Preferences in a backup ---
// The small settings kept in localStorage (not IndexedDB), gathered so a JSON
// export is a truly complete restore point. Operational keys (last-backup date,
// reminder snooze, seed version) are intentionally excluded — they describe this
// device's state, not your data, and shouldn't travel to another device.
// --- Trip presets (saved event recipes) — shared between your devices since
// v120, and still folded into `prefs` so they travel in every JSON backup and
// automatic snapshot too.
//
// A preset is the one list here that CANNOT heal itself: nothing else in your data
// refers to a preset, so one saved on the Mac simply did not exist on the iPhone,
// with nothing to hint that it was missing. (What is inside one — the activities —
// are template ids, which have always synced.)
function loadPresets() { return presetsFromRows(SHARED_ROWS); }
async function savePresets(arr, opts = {}) { await writeSharedKind('presets', arr, opts); return arr; }
// Save the current event's setup as a named preset (replacing any same-name one).
// One row: the name IS the key, so re-saving under a name you have used lands on
// the same row and replaces it, exactly as it always did.
async function addPreset(name, ev) {
  const preset = {
    id: sharedRowId('presets', name), name: String(name).trim(),
    createdAt: new Date().toISOString(), config: presetConfigFromEvent(ev),
  };
  if (!sharedStored('presets')) await savePresets([...loadPresets().filter((p) => p.id !== preset.id), preset]);
  else await putShared(appendedShared('presets', presetsToRows([preset])));
  return preset;
}
async function deletePreset(pid) {
  if (!sharedStored('presets')) { await savePresets(loadPresets().filter((p) => p.id !== pid), { remove: [pid] }); return; }
  await deleteShared([pid]);
}

// Condition list (New / Good / Worn / Needs replacing, and anything you add).
// SHARED between your devices since v120; nothing is stored until you actually
// change something, so an untouched app runs on the factory four from the code.
//
// This is the list that was ACTUALLY BROKEN before it synced: an item's condition
// is an ID stored on the item, and the item does sync — but only the list holds
// the readable name. A condition invented on the Mac therefore arrived on the
// iPhone as a raw id it had no name for. (It was at least never rewritten — see
// coerceItem — so nothing was ever lost, it just read as gibberish.)
//
// It is also the one list here where ORDER is something you set, which is why its
// edits write the list whole rather than a row at a time.
function loadConditions() {
  const list = conditionsFromRows(SHARED_ROWS);
  return list.length ? list : DEFAULT_ITEM_CONDITIONS.map((c) => ({ ...c }));
}
async function saveConditions(arr, opts = {}) {
  const applied = setItemConditions(arr);          // the live list every screen reads, immediately
  await writeSharedKind('conditions', applied, opts);
  return applied;
}
// Back to the factory four, forgetting anything customised. Storing NO rows is
// what "the standard four" means, so the reset is a removal, not a re-seed.
async function resetConditions() {
  await writeSharedKind('conditions', [], { clear: true });   // storing nothing IS the factory four
  return setItemConditions(DEFAULT_ITEM_CONDITIONS.map((c) => ({ ...c })));
}
// Have the conditions been customised at all? (Drives the Settings summary line.)
function conditionsCustomised() { return sharedCustomised('conditions'); }

// How many catalogue items currently carry this condition? Counted by the stable
// item id, so an item in five templates counts once.
async function countItemsWithCondition(condId) {
  const lists = await db.getLists();
  const seen = new Set();
  for (const l of lists) for (const it of (l.items || [])) {
    if (it.condition === condId) seen.add(it._itemId || it.id);
  }
  return seen.size;
}
// Move every item on `fromId` to `toId` ('' = leave it unrated). Condition is an
// intrinsic field, so writing it on any one template propagates to the shared item;
// we still walk every template so nothing is missed. Returns how many items moved.
async function reassignCondition(fromId, toId) {
  const lists = await db.getLists();
  const moved = new Set();
  for (const l of lists) {
    let touched = false;
    for (const it of (l.items || [])) {
      if (it.condition !== fromId) continue;
      it.condition = toId || '';
      moved.add(it._itemId || it.id);
      touched = true;
    }
    if (touched) await saveGuard(db.saveList(l));
  }
  return moved.size;
}
// Ask what happens to the items on a condition that's being removed. Resolves with
// the target condition id, '' for "leave them unrated", or null if cancelled.
function pickReplacementCondition(cond, used, others) {
  return new Promise((resolve) => {
    const opts = [...others.map((c) => `<option value="${esc(c.id)}">${esc(c.label)}</option>`),
      '<option value="">— leave them unrated —</option>'].join('');
    const body = h(`<div class="modal">
      <h2>Remove “${esc(cond.label)}”?</h2>
      <p class="modal-sub"><b>${used}</b> item${used === 1 ? ' is' : 's are'} set to it. Choose what ${used === 1 ? 'it becomes' : 'they become'} — nothing is deleted, only re-rated.</p>
      <label class="field"><span>Move ${used === 1 ? 'it' : 'them'} to</span><select name="cond-move">${opts}</select></label>
      <div class="modal-actions">
        <button class="btn danger lg" data-c="ok">${IC.trash}<span>Remove and move</span></button>
        <button class="btn ghost lg" data-c="cancel">Keep it</button>
      </div>
    </div>`);
    const overlay = h('<div class="overlay"></div>');
    overlay.appendChild(body);
    document.body.appendChild(overlay);
    let settled = false;
    const finish = (v) => { if (settled) return; settled = true; overlay.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') finish(null); };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(null); });
    body.addEventListener('click', (e) => {
      const c = e.target.closest('[data-c]')?.dataset.c;
      if (!c) return;
      finish(c === 'ok' ? ($('select[name=cond-move]', body).value || '') : null);
    });
  });
}

// People roster (who packs what). SHARED between your devices since v120, and
// included in backups via collectPrefs.
//
// Why it had to move: an assignment stores the packer's NAME on the trip line, and
// that syncs — but the roster holds the COLOUR, so `personColor()` fell back to a
// hash of the name on the device without the roster and the same person could be
// blue here and green there.
//
// Martin & Anna are the starter roster and they live in the CODE. They are never
// written into shared data: an account that has never edited People stores no rows
// at all, and both devices read the same two from `DEFAULT_PEOPLE`. Seeding them
// would give the second device two rows to land on top of the first device's.
function loadPeople() {
  const list = peopleFromRows(SHARED_ROWS);
  if (list.length) return list;
  return DEFAULT_PEOPLE.map((p) => coercePerson({ id: sharedRowId('people', p.name), name: p.name, color: p.color }));
}
async function savePeople(arr, opts = {}) {
  await writeSharedKind('people', asPeople(arr), opts);
  return arr;
}
// Has the roster been edited, or is it still the two the app ships with?
function peopleCustomised() { return sharedCustomised('people'); }
// ---------- Owners: the "whose is it" roster ----------
//
// A real, editable list — like People, Storage places and Conditions — rather than
// a set of names scraped from whatever had been typed before. It is the SAME list
// everywhere Owner appears (the item editor, the All-items table), and it can be
// added to, renamed and pruned from any of them.
//
// Deliberately separate from People: People is who PACKS, Owners is who OWNS, and
// "Shared" or "The kids" should own things without turning up in every "Packed by"
// picker. Naming an owner therefore never creates a person, and vice versa.
//
// SHARED between your devices since v120, and carried in backups. The owner ON an
// item has always travelled with your data — which is why this list, unlike the
// conditions, could heal itself — so a name given on the other device is offered
// even before the roster itself has caught up.

// Trim, drop blanks, de-duplicate case-insensitively (first spelling wins) and
// sort A–Z, which is the order every Owner dropdown and the manager both use.
function tidyOwnerNames(arr) {
  const seen = new Map();
  for (const v of (Array.isArray(arr) ? arr : [])) {
    const name = String(typeof v === 'string' ? v : (v && v.name) || '').trim();
    if (name && !seen.has(normName(name))) seen.set(normName(name), name);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
// The roster. With nothing stored it is DERIVED — your People plus every owner
// already given to something — and writes nothing down: both devices work that out
// identically from data that does sync, so there is no reason to plant it. The
// first real edit is what turns it into a list you own.
function loadOwners() {
  const names = namesFromRows(SHARED_ROWS, 'owners');
  if (names.length) return names;
  return tidyOwnerNames([...loadPeople().map((p) => p.name), ...collectItemValues('ownedBy')]);
}
// The whole list at once — for a rename or a removal, where the point IS the list.
async function saveOwners(names, opts = {}) {
  const clean = tidyOwnerNames(names);
  await writeSharedKind('owners', clean, opts);
  return clean;
}
// The one-line state for the When fold: the timeline, in order.
function phasesSummary() {
  const names = PHASES.map((p) => `${p.emoji} ${p.label}`);
  if (!names.length) return 'None yet';
  const shown = names.slice(0, 3).join(' → ');
  return `${PHASES.length} phases · ${shown}${names.length > 3 ? ' → …' : ''}${phasesCustomised() ? '' : ' (standard)'}`;
}

// Is the roster a real list yet, or still being derived from what's in use?
function ownersCustomised() { return sharedCustomised('owners'); }
// The one-line state for the Settings fold: who is on the list, biggest owner
// first — the same order as the list inside, so the summary previews it honestly.
function ownersSummary() {
  const names = ownersByUsage(ownerNames(), ownerUsage());
  if (!names.length) return 'None yet — whose each thing is';
  const shown = names.slice(0, 4).join(', ');
  return names.length > 4 ? `${names.length} owners · ${shown}…` : shown;
}
// Every name the pickers offer: the roster, plus any owner actually in use that
// this device's roster hasn't got (a name added on the other device — the owner on
// an item syncs, the roster doesn't), plus `cur`, so a picker can never silently
// drop the value it was opened with.
function ownerNames(cur = '') {
  return tidyOwnerNames([...loadOwners(), ...collectItemValues('ownedBy'), (cur || '').trim()]);
}
// The Owner picker's <option>s — the same list, and the same two actions at the
// bottom, wherever Owner is editable.
function ownerOptsHTML(cur = '', { empty = '— not set —' } = {}) {
  const opts = [{ value: '', label: empty },
    ...ownerNames(cur).map((n) => ({ value: n, label: n })),
    { value: '__new__', label: '＋ Add an owner…' },
    { value: '__manage__', label: '⚙ Manage owners…' }];
  return opts.map((o) => `<option value="${esc(o.value)}"${o.value === (cur || '') ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
}
// Ask for a new owner's name and put it on the roster. Returns the name to select,
// or '' if cancelled. A name that is already there simply wins — same spelling,
// no duplicate.
async function addOwnerByName(suggest = '') {
  const name = (prompt('Whose is it? Type the owner’s name — e.g. Martin · Anna · Shared:', suggest) || '').trim();
  if (!name) return '';
  const existing = ownerNames().find((n) => normName(n) === normName(name));
  if (existing) return existing;
  if (!sharedStored('owners')) await saveOwners([...loadOwners(), name]);
  else await putShared(appendedShared('owners', namesToRows('owners', [name])));
  return name;
}
// How many items each owner has, counted by the stable item id so an item in five
// templates counts once. Read from the loaded catalogue, so it is instant.
function ownerUsage(lists = ALL_LISTS) {
  const seen = new Map();                     // normalised name → Set of item ids
  for (const l of (lists || [])) for (const it of (l.items || [])) {
    const key = normName(it.ownedBy);
    if (!key) continue;
    if (!seen.has(key)) seen.set(key, new Set());
    seen.get(key).add(it._itemId || it.id);
  }
  return new Map([...seen].map(([k, set]) => [k, set.size]));
}
// Move every item owned by `fromName` to `toName` ('' = nobody). `ownedBy` is an
// intrinsic field, so writing it on any one template propagates to the shared item;
// we still walk every template so nothing is missed. Returns how many items moved.
async function setOwnerEverywhere(fromName, toName) {
  const key = normName(fromName);
  if (!key) return 0;
  const lists = await db.getLists();
  const moved = new Set();
  for (const l of lists) {
    let touched = false;
    for (const it of (l.items || [])) {
      if (normName(it.ownedBy) !== key) continue;
      it.ownedBy = toName || '';
      moved.add(it._itemId || it.id);
      touched = true;
    }
    if (touched) await saveGuard(db.saveList(l));
  }
  if (moved.size) ALL_LISTS = await db.getLists();
  return moved.size;
}
// Ask what happens to the items owned by an owner being removed. Resolves with the
// name to move them to, '' for "nobody owns them", or null if cancelled.
function pickReplacementOwner(name, used, others) {
  return new Promise((resolve) => {
    const opts = [...others.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`),
      '<option value="">— nobody owns them —</option>'].join('');
    const body = h(`<div class="modal">
      <h2>Remove “${esc(name)}”?</h2>
      <p class="modal-sub"><b>${used}</b> item${used === 1 ? ' is' : 's are'} theirs. Choose who ${used === 1 ? 'it goes' : 'they go'} to — nothing is deleted, only re-assigned.</p>
      <label class="field"><span>Give ${used === 1 ? 'it' : 'them'} to</span><select name="owner-move">${opts}</select></label>
      <div class="modal-actions">
        <button class="btn danger lg" data-c="ok">${IC.trash}<span>Remove and move</span></button>
        <button class="btn ghost lg" data-c="cancel">Keep them</button>
      </div>
    </div>`);
    const overlay = h('<div class="overlay"></div>');
    overlay.appendChild(body);
    document.body.appendChild(overlay);
    let settled = false;
    const finish = (v) => { if (settled) return; settled = true; overlay.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    // Capture phase + stopPropagation: this can open ON TOP of the Owners manager,
    // and Escape must close only the top one.
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); finish(null); } };
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(null); });
    body.addEventListener('click', (e) => {
      const c = e.target.closest('[data-c]')?.dataset.c;
      if (!c) return;
      finish(c === 'ok' ? ($('select[name=owner-move]', body).value || '') : null);
    });
  });
}
// ---------- Phases: the editable, SYNCED "When" timeline ----------
//
// A phase id is stamped in four places, and removing one has to deal with all of
// them or something ends up filed under a "When" that no longer exists:
//   • items         — the item's own default phase
//   • memberships   — a per-template exception ("in Hiking, pack this earlier")
//   • trip entries  — the phase a already-built packing list froze in
//   • actions       — a to-do's optional "when" (whenPhase)
// Counted by the stable item id, so an item in five templates counts once.
async function countPhaseUsers(phaseId) {
  if (!phaseId) return { items: 0, entries: 0, actions: 0, total: 0 };
  const [lists, events, actions] = await Promise.all([db.getLists(), db.getEvents(), db.getActions()]);
  const items = new Set();
  for (const l of lists) for (const it of (l.items || [])) {
    if (it.phase === phaseId || it._defPhase === phaseId) items.add(it._itemId || it.id);
  }
  let entries = 0;
  for (const ev of events) for (const e of (ev.entries || [])) if (e.phase === phaseId) entries++;
  const acts = actions.filter((a) => a.whenPhase === phaseId).length;
  return { items: items.size, entries, actions: acts, total: items.size + entries + acts };
}
// Move everything on `fromId` to `toId`. Used by "remove a phase" — never by
// rename, which keeps the id and therefore needs no data change at all.
async function movePhaseEverywhere(fromId, toId) {
  if (!fromId) return 0;
  const target = toId || defaultPhaseId();
  let moved = 0;
  const lists = await db.getLists();
  for (const l of lists) {
    let touched = false;
    for (const it of (l.items || [])) {
      // THREE separate channels carry a phase, and all three have to move or the
      // change half-lands. Writing only the resolved value is silently useless:
      // membershipFromResolved takes the per-list exception from `_ovPhase`
      // VERBATIM when it is set — which it always is after a resolve — so the old
      // id would simply be written straight back.
      //   it.phase     the RESOLVED value (what this template actually uses)
      //   it._defPhase the item's own default, shared by every template
      //   it._ovPhase  this template's exception ('' = no exception)
      if (it.phase === fromId) { it.phase = target; touched = true; moved++; }
      if (it._defPhase === fromId) { it._defPhase = target; touched = true; }
      if (it._ovPhase === fromId) { it._ovPhase = target; touched = true; }
    }
    if (touched) await saveGuard(db.saveList(l));
  }
  const events = await db.getEvents();
  for (const ev of events) {
    let touched = false;
    for (const e of (ev.entries || [])) if (e.phase === fromId) { e.phase = target; touched = true; moved++; }
    if (touched) await db.saveEvent(ev);
  }
  const actions = await db.getActions();
  for (const a of actions) {
    if (a.whenPhase !== fromId) continue;
    a.whenPhase = toId || '';        // a to-do may legitimately go back to "Any time"
    await db.saveAction(a);
    moved++;
  }
  ALL_LISTS = await db.getLists();
  return moved;
}
// Ask what happens to everything on a phase being removed. Resolves with the id to
// move them to, or null if cancelled. Unlike conditions there is no "leave them
// unset" — everything has to be packed at SOME point — so the list is the other
// phases only.
function pickReplacementPhase(ph, used, others) {
  return new Promise((resolve) => {
    const opts = others.map((p) => `<option value="${esc(p.id)}">${esc(p.emoji)} ${esc(p.label)}</option>`).join('');
    const bits = [
      used.items ? `<b>${used.items}</b> item${used.items === 1 ? '' : 's'}` : '',
      used.entries ? `<b>${used.entries}</b> line${used.entries === 1 ? '' : 's'} on a trip you've already built` : '',
      used.actions ? `<b>${used.actions}</b> to-do${used.actions === 1 ? '' : 's'}` : '',
    ].filter(Boolean).join(' · ');
    const body = h(`<div class="modal">
      <h2>Remove “${esc(ph.label)}”?</h2>
      <p class="modal-sub">${bits} ${used.total === 1 ? 'is' : 'are'} filed under it. Choose when ${used.total === 1 ? 'it gets' : 'they get'} packed instead — nothing is deleted, only re-timed.</p>
      <label class="field"><span>Move ${used.total === 1 ? 'it' : 'them'} to</span><select name="phase-move">${opts}</select></label>
      <div class="modal-actions">
        <button class="btn danger lg" data-c="ok">${IC.trash}<span>Remove and move</span></button>
        <button class="btn ghost lg" data-c="cancel">Keep it</button>
      </div>
    </div>`);
    const overlay = h('<div class="overlay"></div>');
    overlay.appendChild(body);
    document.body.appendChild(overlay);
    let settled = false;
    const finish = (v) => { if (settled) return; settled = true; overlay.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); finish(null); } };
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(null); });
    body.addEventListener('click', (e) => {
      const c = e.target.closest('[data-c]')?.dataset.c;
      if (!c) return;
      finish(c === 'ok' ? ($('select[name=phase-move]', body).value || '') : null);
    });
  });
}

// The Owners editor itself — one implementation, used in two places: the Settings
// card and the ⚙ Manage owners… modal that every Owner dropdown can open.
//
// `changes` records what happened (old name → what it is now, '' when the items
// were left ownerless) so a caller holding an open item editor can follow a rename
// instead of losing the value.
function buildOwnersEditor({ onChanged } = {}) {
  const el = h(`<div class="owner-mgr">
    <div class="owner-list" data-owners></div>
    <div class="btnrow"><button class="btn" data-owner="add">${IC.plus}<span>Add owner</span></button></div>
  </div>`);
  const changes = new Map();
  const box = el.querySelector('[data-owners]');
  const draw = () => {
    const use = ownerUsage();
    // Most-owned first (v125). The dropdowns stay A–Z — you go there knowing the
    // name you want — but this list is where you come to see whose most of it is,
    // so it ranks by how many items each name actually holds, ties A–Z.
    const names = ownersByUsage(ownerNames(), use);
    box.innerHTML = names.length ? names.map((n) => {
      const c = use.get(normName(n)) || 0;
      return `<div class="owner-row" data-owner-name="${esc(n)}">
        <span class="owner-ic" aria-hidden="true">${ic('person', 'sm')}</span>
        <span class="owner-info"><b class="owner-name">${esc(n)}</b><span class="owner-sub">${c ? `${c} item${c === 1 ? '' : 's'}` : 'nothing yet'}</span></span>
        <span class="owner-acts">
          <button type="button" class="iconbtn sm" data-owner-edit="${esc(n)}" aria-label="Rename ${esc(n)}" title="Rename">${IC.edit}</button>
          <button type="button" class="iconbtn sm" data-owner-del="${esc(n)}" aria-label="Remove ${esc(n)}" title="Remove">${IC.trash}</button>
        </span></div>`;
    }).join('') : '<p class="muted">No owners yet — add one to start recording whose things are whose.</p>';
  };
  draw();
  // Record what happened to a name. Chains collapse — rename A→B and then B→C in
  // one sitting and A is recorded as C, so a caller replaying this map never lands
  // on the intermediate name.
  const changed = (from, to) => {
    const key = normName(from);
    for (const [k, v] of changes) if (normName(v) === key) changes.set(k, to);
    changes.set(key, to);
    draw();
    onChanged?.(changes);
  };

  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-owner], [data-owner-edit], [data-owner-del]');
    if (!btn) return;
      // Re-read before changing anything. A list is shared, so this screen may have
      // been open while the other device added to it — and an edit that started
      // from a stale copy would write that copy back and delete what it never saw.
    await refreshShared();
    draw();
    if (btn.dataset.owner === 'add') {
      const name = await addOwnerByName('');
      if (name) { draw(); onChanged?.(changes); }
      return;
    }
    const old = btn.dataset.ownerEdit || btn.dataset.ownerDel;
    if (!old) return;

    if (btn.dataset.ownerEdit) {
      const name = (prompt('Rename this owner:', old) || '').trim();
      if (!name || name === old) return;
      if (ownerNames().some((n) => normName(n) !== normName(old) && normName(n) === normName(name))) {
        alert(`“${name}” is already on the list. To merge the two, remove this one and give its things to “${name}”.`);
        return;
      }
      await saveOwners([...loadOwners().filter((n) => normName(n) !== normName(old)), name],
        { remove: [sharedRowId('owners', old)] });
      const moved = await setOwnerEverywhere(old, name);
      changed(old, name);
      if (moved) showToast(`Renamed to “${name}” — ${moved} item${moved === 1 ? '' : 's'} updated`);
      return;
    }

    // Remove. Nothing may be orphaned: if things are theirs, say whose they become.
    const used = ownerUsage().get(normName(old)) || 0;
    let moveTo = '';
    if (used) {
      moveTo = await pickReplacementOwner(old, used, ownerNames().filter((n) => normName(n) !== normName(old)));
      if (moveTo === null) return;                       // cancelled
    } else if (!confirm(`Remove “${old}” from the Owners list?\n\nNothing is theirs, so nothing else changes.`)) return;
    await saveOwners(loadOwners().filter((n) => normName(n) !== normName(old)),
      { remove: [sharedRowId('owners', old)] });
    if (used) {
      const n = await setOwnerEverywhere(old, moveTo);
      showToast(moveTo
        ? `Removed “${old}” — ${n} item${n === 1 ? '' : 's'} now ${moveTo}’s`
        : `Removed “${old}” — ${n} item${n === 1 ? '' : 's'} have no owner`);
    }
    changed(old, moveTo || '');
  });

  return { el, draw, changes };
}
// Replay the manager's changes onto a template held in memory by an open editor,
// so what that editor writes back agrees with what the manager put in the
// database. See the call site in the item editor for why this matters.
function applyOwnerChanges(list, changes) {
  if (!changes || !changes.size) return 0;
  let n = 0;
  for (const it of ((list && list.items) || [])) {
    const key = normName(it.ownedBy);
    if (key && changes.has(key)) { it.ownedBy = changes.get(key); n++; }
  }
  return n;
}
// The ⚙ Manage owners… modal, openable from any Owner dropdown. Resolves with the
// map of what changed (empty when nothing did), so the caller can follow a rename.
function openOwnersManager() {
  return new Promise((resolve) => {
    const mgr = buildOwnersEditor();
    const body = h(`<div class="modal owners-modal">
      <h2>Owners</h2>
      <p class="modal-sub">Whose things are whose. This is the same list every <b>Owner</b> dropdown offers — rename one and every item follows.</p>
      <div class="modal-actions"><button class="btn primary lg" data-c="done">Done</button></div>
    </div>`);
    body.insertBefore(mgr.el, body.querySelector('.modal-actions'));
    const overlay = h('<div class="overlay"></div>');
    overlay.appendChild(body);
    document.body.appendChild(overlay);
    let settled = false;
    const finish = () => { if (settled) return; settled = true; overlay.remove(); document.removeEventListener('keydown', onKey); resolve(mgr.changes); };
    const onKey = (e) => { if (e.key === 'Escape') finish(); };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(); });
    body.addEventListener('click', (e) => { if (e.target.closest('[data-c="done"]')) finish(); });
  });
}
const asPeople = (arr) => (Array.isArray(arr) ? arr.map(coercePerson).filter((p) => p.name) : []);
// The display colour for a packer name, honouring the roster (hash fallback for
// names not on it — e.g. from a shared trip).
const peopleColor = (name) => personColor(name, loadPeople());

// Rename a packer across every trip so a renamed person doesn't strand their
// assignments under the old name. Returns how many events changed.
async function renamePackerEverywhere(oldName, newName) {
  const key = String(oldName || '').trim().toLowerCase();
  if (!key || !newName) return 0;
  const events = await db.getEvents();
  let changed = 0;
  for (const ev of events) {
    let touched = false;
    for (const e of (ev.entries || [])) {
      if ((e.packer || '').trim().toLowerCase() === key) { e.packer = newName; touched = true; }
    }
    if (touched) { await db.saveEvent(ev); changed++; }
  }
  return changed;
}
// A short one-line description of what a preset packs, for the Settings list.
function presetSummary(config = {}) {
  const bits = [config.mode === 'quick' ? 'Quick activity' : 'Full trip'];
  if (config.mode !== 'quick' && config.transport) bits.push(config.transport);
  if (config.season) bits.push(config.season);
  const na = (config.activities || []).length;
  if (na) bits.push(`${na} activit${na === 1 ? 'y' : 'ies'}`);
  if ((config.weatherOn || []).length) bits.push(`force ${config.weatherOn.length} weather`);
  if (config.laundry) bits.push('laundry');
  return bits.join(' · ');
}

// Fill an OPEN event form from a preset's config, reusing the form's own change
// handlers to keep the segmented/checkbox visuals in sync. The typed name and
// dates are left alone.
function applyPresetToForm(form, config) {
  const fire = (el) => el.dispatchEvent(new Event('change', { bubbles: true }));
  const setRadio = (name, val) => {
    if (val == null) return;
    const el = form.querySelector(`input[name="${name}"][value="${(window.CSS && CSS.escape) ? CSS.escape(val) : val}"]`);
    if (el) { el.checked = true; fire(el); }
  };
  const setChecks = (name, vals) => {
    const set = new Set(vals || []);
    form.querySelectorAll(`input[name="${name}"]`).forEach((el) => { el.checked = set.has(el.value); fire(el); });
  };
  setRadio('mode', config.mode || 'trip');
  setRadio('transport', config.transport);
  setRadio('season', config.season);
  setRadio('catering', config.catering);
  setChecks('contexts', config.contexts);
  setChecks('weatherOn', config.weatherOn);
  setChecks('activities', config.activities);
  const laundry = form.querySelector('input[name="laundry"]');
  if (laundry) laundry.checked = !!config.laundry;
}

function collectPrefs() {
  const prefs = { theme: currentTheme() };
  try { const v = localStorage.getItem(VIEW_KEY); if (v) prefs.view = v; } catch { /* ignore */ }
  // Each of the five is carried only once it is a list you actually authored. An
  // untouched app runs on the code's defaults, and a backup must never plant those
  // defaults as data on the device it is restored onto — that is the whole lesson
  // of v118, and it applies to a restore exactly as it applies to a seed.
  if (sharedCustomised('places')) prefs.storageLocations = loadStorageLocs();
  if (sharedCustomised('presets')) prefs.presets = loadPresets();
  if (peopleCustomised()) prefs.people = loadPeople();
  if (ownersCustomised()) prefs.owners = loadOwners();
  if (conditionsCustomised()) prefs.conditions = ITEM_CONDITIONS.map((c) => ({ ...c }));
  return prefs;
}
// Apply prefs from an imported backup or a restored snapshot.
//
// Four of the five UNION with what is already here — rows the store hasn't got are
// added, rows it has are left exactly as they are — so a restore can never quietly
// take away a place, a person or an owner this device is still using. Conditions
// are the exception and come across whole: they are an ordered list and the order
// is the point.
//
// The `meaningful` guard stops a backup taken before v120 — which always carried
// the storage places and the roster, customised or not — from writing the factory
// defaults into shared data as if they were something you had authored.
async function applyPrefs(prefs) {
  if (!prefs || typeof prefs !== 'object') return;
  const meaningful = (kind, list) => Array.isArray(list) && list.length
    && !(isFactoryList(kind, list) && !sharedCustomised(kind));

  if (typeof prefs.theme === 'string') setTheme(prefs.theme);
  try { if (typeof prefs.view === 'string' && VIEW_MODES.includes(prefs.view)) localStorage.setItem(VIEW_KEY, prefs.view); } catch { /* ignore */ }

  if (meaningful('places', prefs.storageLocations)) {
    adoptSharedRows(await db.addSharedRowsIfAbsent(namesToRows('places', prefs.storageLocations)));
    STORAGES = loadStorageLocs();
  }
  if (meaningful('presets', prefs.presets)) {
    adoptSharedRows(await db.addSharedRowsIfAbsent(presetsToRows(prefs.presets)));
  }
  if (meaningful('people', prefs.people)) {
    adoptSharedRows(await db.addSharedRowsIfAbsent(sharedRowsFrom('people', prefs.people.map((p) => coercePerson({ ...p })))));
  }
  if (meaningful('owners', prefs.owners)) {
    adoptSharedRows(await db.addSharedRowsIfAbsent(namesToRows('owners', prefs.owners)));
  }
  if (meaningful('conditions', prefs.conditions)) {
    await saveConditions(prefs.conditions);
  }
  await refreshShared();
}

// ---------- utilities ----------
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function safeName(name) { return String(name || 'event').replace(/[^\w\-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'event'; }
function sheetName(name) {
  // Excel sheet names: ≤31 chars, none of []:*?/\
  const s = String(name || 'Event').replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31);
  return s || 'Event';
}

// ============================================================
// Router
// ============================================================
async function renderRoute() {
  const hash = location.hash || '#/';
  const m = (re) => (hash.match(re) || [])[1];
  // A pending "come back here" only survives while you're actually in the item
  // editor it was set for. Leave by any other door (the back arrow, a tab) and it
  // is dropped, so a later Save somewhere else can't teleport you.
  if (itemEditorReturn && !/^#\/list\/[^/]+\/item\/[^/]+$/.test(hash)) itemEditorReturn = null;
  if (hash === '#/' || hash === '') return renderHome();
  if (hash === '#/new') { location.replace('#/'); return renderHome(); }
  if (hash === '#/events') return renderEvents();
  if (hash === '#/map') return renderMap();
  if (hash === '#/lists') return renderLists();
  if (hash === '#/maintenance') return renderMaintenance();
  if (hash === '#/containers') return renderContainers();
  if (hash === '#/items') return renderItemsGrid();
  if (hash === '#/actions') return renderActions();
  if (hash === '#/shopping') return renderShopping();
  if (hash === '#/search') return renderSearch();
  if (hash === '#/refine') return renderRefine();
  if (hash === '#/settings') return renderSettings();
  if (hash === '#/overview') return renderOverview();
  const tripLink = m(/^#\/t\/(.+)$/);
  if (tripLink) return renderImportTrip(tripLink);
  const eventEdit = m(/^#\/event\/([^/]+)\/edit$/);
  if (eventEdit) { const ev = await db.getEvent(eventEdit); return renderEventForm(ev); }
  const eventReview = m(/^#\/event\/([^/]+)\/review$/);
  if (eventReview) return renderReview(eventReview);
  const eventPack = m(/^#\/event\/([^/]+)\/pack$/);
  if (eventPack) return renderPackMode(eventPack);
  const eventId = m(/^#\/event\/([^/]+)$/);
  if (eventId) return renderEvent(eventId);
  const listItem = location.hash.match(/^#\/list\/([^/]+)\/item\/([^/]+)$/);
  if (listItem) return renderList(listItem[1], listItem[2]);
  const listId = m(/^#\/list\/([^/]+)$/);
  if (listId) return renderList(listId);
  return renderEvents();
}

let rendering = false;
async function render() {
  if (rendering) return; rendering = true;
  try {
    await refreshActions();     // fresh action data for badges, the editor buffer & the Actions screen
    await refreshKits();        // fresh kits for the add-a-kit pickers & packing-list clusters
    await refreshShared();      // the five lists you author — the other device may have changed them
    const node = await renderRoute();
    app.innerHTML = '';
    app.appendChild(node);
    setActiveTab();
    applyMode();
    window.scrollTo(0, 0);
  } catch (err) {
    console.error('AMS Packing List: render failed', err);
    logDiag(`render ${location.hash || '#/'}`, err);
    app.innerHTML = '';
    app.appendChild(h(`<section class="screen"><div class="empty"><p class="empty-t">Something went wrong</p><p class="empty-s">${esc(err.message || err)}</p><p class="empty-s muted">The details were saved to Settings → Diagnostics.</p></div></section>`));
  } finally { rendering = false; }
}

function setActiveTab() {
  const hash = location.hash || '#/';
  const base = hash.startsWith('#/events') || hash.startsWith('#/event/') || hash === '#/map' ? '#/events'
    : hash.startsWith('#/list') || hash === '#/refine' ? '#/lists'
    : hash.startsWith('#/maintenance') || hash.startsWith('#/containers') || hash.startsWith('#/items') || hash.startsWith('#/shopping') ? '#/maintenance'
    : hash.startsWith('#/actions') ? '#/actions'
    : hash.startsWith('#/settings') || hash.startsWith('#/overview') ? '#/settings' : '#/';
  $$('.tabbar a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === base));
}

// Which section we're in — drives the UI accent colour for the whole page.
// Matches the active-tab mapping so the colour and the lit tab always agree.
function currentSection() {
  const hash = location.hash || '#/';
  if (hash.startsWith('#/events') || hash.startsWith('#/event/') || hash === '#/map') return 'events';
  if (hash.startsWith('#/list') || hash === '#/refine') return 'templates';
  if (hash.startsWith('#/maintenance') || hash.startsWith('#/containers') || hash.startsWith('#/items') || hash.startsWith('#/shopping')) return 'care';
  if (hash.startsWith('#/actions')) return 'actions';
  if (hash.startsWith('#/settings') || hash.startsWith('#/overview')) return 'settings';
  return 'home';
}
function applyMode() {
  const s = currentSection();
  if (document.documentElement.dataset.section !== s) document.documentElement.dataset.section = s;
}

window.addEventListener('hashchange', render);

// The timeline and the five lists you author all live in shared data, so a device
// left open can fall behind the other one. Re-read them whenever the app comes
// back to the fore, and redraw if anything actually changed — otherwise this
// device would keep showing an old list, and its next save would write that old
// list back over the new one.
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') return;
  const before = JSON.stringify([PHASES, SHARED_ROWS]);
  await db.refreshPhases().catch(() => {});
  await refreshShared();
  if (JSON.stringify([PHASES, SHARED_ROWS]) !== before) renderIfIdle();
});

// When a newer published version installs in the background, offer a one-tap
// refresh instead of silently leaving the app on the old copy. We only prompt on
// an actual UPDATE (a controller already exists — not the very first install),
// and never auto-reload; the user taps when they're ready.
// A small, transient confirmation banner (non-blocking). Auto-dismisses; a new
// toast replaces any showing one.
let toastTimer = null;
function showToast(msg, ms = 2800) {
  document.querySelector('.ams-toast')?.remove();
  clearTimeout(toastTimer);
  const toast = h(`<div class="ams-toast" role="status">${esc(msg)}</div>`);
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('in'));
  toastTimer = setTimeout(() => {
    toast.classList.remove('in');
    setTimeout(() => toast.remove(), 260);
  }, ms);
}

let updateToastShown = false;
function showUpdateToast() {
  if (updateToastShown) return;
  updateToastShown = true;
  const toast = h(`<div class="update-toast" role="status">
    <span class="ut-txt">${ic('sparkle','sm')}A new version is ready</span>
    <button type="button" class="ut-btn">Update now</button>
  </div>`);
  toast.querySelector('.ut-btn').addEventListener('click', () => location.reload());
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('in'));
}
function watchForUpdate(reg) {
  if (!reg) return;
  const offer = (worker) => {
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateToast();
    });
  };
  if (reg.waiting && navigator.serviceWorker.controller) showUpdateToast();
  reg.addEventListener('updatefound', () => offer(reg.installing));
  // Check for a new version now, and again whenever the app returns to the fore.
  reg.update().catch(() => {});
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reg.update().catch(() => {});
  });
}

(async function init() {
  // Show the build version in the tab-bar corner marker.
  const verEl = document.querySelector('[data-app-version]');
  if (verEl) verEl.textContent = APP_VERSION;
  // apply saved theme (also handled inline in index.html to avoid a flash)
  const t = currentTheme();
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  await db.ensureSeeded();
  // Read the five lists you author, and install the condition list, before the
  // first render. (An item's condition no longer has to be on the list to survive
  // a save — coerceItem keeps any id it doesn't recognise — so this can happily
  // come after the catalogue is open.)
  await refreshShared();
  ensurePersistentStorage(); // ask the browser to protect our data (non-blocking)
  // Move any still-inline item photos into the photos store (one-time, resumable).
  // Awaited BEFORE the first render so lists draw with their thumbnails already in
  // place; it is a no-op on every load after the first, and a failure here must
  // never stop the app from opening.
  try {
    const moved = await db.migrateInlinePhotos({ makeThumb });
    if (moved.photos) logDiag('photos', { migrated: moved });
  } catch (err) { logDiag('photo-migration', err); }
  // Remove the empty database v100 accidentally created (see cleanupStrayCloudDb).
  db.cleanupStrayCloudDb().then((r) => { if (r && r.removed) logDiag('cleanup', r); }).catch(() => {});
  // Quietly keep an automatic on-device backup (roughly one a day), so a bad edit
  // or accidental delete is always recoverable. Non-blocking and self-guarded.
  db.maybeAutoSnapshot(collectPrefs()).catch(() => {});
  await render();
  // Move this device's own pre-v120 lists into the account — once, in the
  // background. Deliberately AFTER the first render: on a signed-in device it
  // waits until the account's copy has actually arrived before writing anything
  // (never migrate blind), and that wait must not sit in front of the app opening.
  // Meanwhile the screens still show this device's lists — `withLegacyLists` keeps
  // them in the read-only cache until the real adoption lands.
  // ...but FIRST make sure this device has actually downloaded the whole shared
  // table. On a device that was already syncing when v120 added it, the addon can
  // record the table as "first download done" from a moment when it was still
  // empty, and only ever apply changes after that — which is how the iPhone ended
  // up with one condition out of six. Adoption has to run against the real account
  // copy, so it waits for this.
  // Re-send this device's lists once, so the other device actually receives them.
  // This is the repair that does not depend on the sync addon's internals — see
  // `republishSharedLists` in db.js for why the earlier one could not be trusted.
  db.republishSharedListsOnce()
    .then((r) => { if (r && r.sent) logDiag('shared-republish', { sent: r.sent }); })
    .catch((err) => logDiag('shared-republish', err));
  db.repairSharedSync()
    .then(async (r) => {
      if (r && r.repaired && r.after !== r.before) {
        logDiag('shared-resync', { before: r.before, after: r.after });
        await refreshShared();
        renderIfIdle();
      }
      return db.migrateSharedLists();
    })
    .then(async (r) => {
      if (!r || !r.added) return;
      logDiag('shared-lists', { adopted: r.kinds, rows: r.added });
      await refreshShared();
      renderIfIdle();
    })
    .catch((err) => logDiag('shared-lists', err));
  // Item editors open via partial re-renders (not the router), so watch the
  // app subtree and re-evaluate the accent mode whenever the DOM changes.
  new MutationObserver(applyMode).observe(app, { childList: true, subtree: true });
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.register('./service-worker.js?v=' + APP_VERSION);
      watchForUpdate(reg);
    } catch { /* offline still works via cache on next load */ }
  }
})();
