// db.js — on-device persistence via IndexedDB.
// Two object stores: building-block packing `lists`, and `events` (each event
// carries its own materialised, editable Total-List entries). All data stays on
// this device; export/import moves it as JSON, CSV or Excel.
import { coerceList, coerceEvent, buildTripBundle, parseTripBundle, sortEventsForList } from './model.js';
import { seedLists } from './seed.js';

const DB_NAME = 'ams-packing-list';
const DB_VERSION = 1;
const LISTS = 'lists';
const EVENTS = 'events';
// Bump when the built-in seed data changes, to refresh the built-in lists on next load.
const SEED_VERSION = 8;
const SEED_KEY = 'ams-seed-version';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Additive migrations — existing data is preserved.
      if (!db.objectStoreNames.contains(LISTS)) db.createObjectStore(LISTS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(EVENTS)) db.createObjectStore(EVENTS, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode, store) {
  return db.transaction(store, mode).objectStore(store);
}
function getAll(store, coerce) {
  return open().then((db) => new Promise((resolve, reject) => {
    const req = tx(db, 'readonly', store).getAll();
    req.onsuccess = () => resolve((req.result || []).map(coerce));
    req.onerror = () => reject(req.error);
  }));
}
function getOne(store, key, coerce) {
  return open().then((db) => new Promise((resolve, reject) => {
    const req = tx(db, 'readonly', store).get(key);
    req.onsuccess = () => resolve(req.result ? coerce(req.result) : null);
    req.onerror = () => reject(req.error);
  }));
}
function put(store, value) {
  return open().then((db) => new Promise((resolve, reject) => {
    const req = tx(db, 'readwrite', store).put(value);
    req.onsuccess = () => resolve(value);
    req.onerror = () => reject(req.error);
  }));
}
function del(store, key) {
  return open().then((db) => new Promise((resolve, reject) => {
    const req = tx(db, 'readwrite', store).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  }));
}
function replaceStore(store, items) {
  return open().then((db) => new Promise((resolve, reject) => {
    const s = tx(db, 'readwrite', store);
    s.clear();
    for (const it of items) s.put(it);
    s.transaction.oncomplete = () => resolve();
    s.transaction.onerror = () => reject(s.transaction.error);
  }));
}
function putAll(store, items) {
  return open().then((db) => new Promise((resolve, reject) => {
    const s = tx(db, 'readwrite', store);
    for (const it of items) s.put(it);
    s.transaction.oncomplete = () => resolve();
    s.transaction.onerror = () => reject(s.transaction.error);
  }));
}

// --- Lists (building blocks) ---

export async function getLists() {
  const lists = await getAll(LISTS, coerceList);
  return lists.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}
export function getList(id) { return getOne(LISTS, id, coerceList); }
export function saveList(list) { list.updatedAt = new Date().toISOString(); return put(LISTS, list); }
export function deleteList(id) { return del(LISTS, id); }

// --- Events ---

export async function getEvents() {
  const events = await getAll(EVENTS, coerceEvent);
  return sortEventsForList(events);
}
export function getEvent(id) { return getOne(EVENTS, id, coerceEvent); }
export function saveEvent(event) { event.updatedAt = new Date().toISOString(); return put(EVENTS, event); }
export function deleteEvent(id) { return del(EVENTS, id); }

// --- First-run seeding ---
// Populate the building-block lists so the app is usable immediately. When the
// bundled seed data changes (SEED_VERSION bumps), refresh the built-in lists while
// preserving the user's own lists and all events.
export async function ensureSeeded() {
  const existing = await getLists();
  let seededVersion = 0;
  try { seededVersion = Number(localStorage.getItem(SEED_KEY)) || 0; } catch { /* ignore */ }

  if (!existing.length) {
    await putAll(LISTS, seedLists());
  } else if (seededVersion < SEED_VERSION) {
    // Replace built-in lists with the fresh seed; keep any user-created lists.
    const userLists = existing.filter((l) => !l.builtin);
    await replaceStore(LISTS, [...seedLists(), ...userLists]);
  }
  try { localStorage.setItem(SEED_KEY, String(SEED_VERSION)); } catch { /* ignore */ }
  return getLists();
}

// --- Backup (Export / Import) ---

export async function exportJSON() {
  const [lists, events] = await Promise.all([getLists(), getEvents()]);
  return JSON.stringify(
    { app: 'ams-packing-list', version: 1, exportedAt: new Date().toISOString(), lists, events },
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
  if (merge) {
    if (lists.length) await putAll(LISTS, lists);
    if (events.length) await putAll(EVENTS, events);
  } else {
    await replaceStore(LISTS, lists);
    await replaceStore(EVENTS, events);
  }
  return { lists: lists.length, events: events.length };
}

// --- Trip sharing (one event, backend-free) ---

// Serialise a single event as a shareable trip bundle (JSON string).
export async function exportTrip(eventId) {
  const event = await getEvent(eventId);
  if (!event) throw new Error('Trip not found.');
  return JSON.stringify(buildTripBundle(event));
}

// Import a shared trip (from a file's text or a decoded link) as a NEW event.
// Returns the saved event so the caller can navigate straight to it.
export async function importTrip(data) {
  const event = parseTripBundle(data);
  await saveEvent(event);
  return event;
}
