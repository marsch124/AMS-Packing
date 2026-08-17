// app.js — screens, navigation and wiring for AMS Packing List.
import {
  CATEGORIES, CONTAINERS, CONTAINER_ROLE, CONTAINER_LIST_NAME, containerNames, PHASES, PHASE_IDS, phase, phaseLabel, SEASONS, TRANSPORTS, CONTEXTS, DEFAULT_STORAGE_LOCATIONS,
  CATERING, cateringLabel, CHARGE_TYPES, chargeTypeShort, chargeTypeLabel, ITEM_CONDITIONS, RETIRE_REASONS, retireReasonLabel, CURRENCIES, GROUPS, GROUP_IDS, groupLabel, id, newItem, newList, newEvent,
  buildTotalEntries, regenerateEntries, entriesByPhase, groupByContainer, groupByCategory, groupBy, groupItemsBySection, newSection,
  progress, packSteps, totalListRows, applyReview, pruneSuggestions,
  effectiveQty, bagLoads, containerLimits, packingFlags, daysUntil, countdownLabel, tripNudge, nightsBetween, endFromNights,
  buildTripBundle, encodeTripLink, fromBase64Url,
  deriveWeather, weatherSuggestions, weatherGear, WEATHER_CONDITIONS,
  placesVisited, eventsNeedingCoords, coerceGeo, tripPath, mostVisited,
  MAINTENANCE_INTERVALS, MAINTENANCE_SOON_DAYS, hasCare, maintenanceStatus, normalizeMaintenance, MAX_PHOTOS,
  maintenanceList, maintenanceSummary, maintenanceByDate, logMaintenance, addDays, daysBetween,
  newAction, coerceAction, ACTION_PRIORITIES, actionPriorityLabel, compareActions,
  catalogRows, duplicateGroups, duplicateIds,
} from './model.js';
import * as db from './db.js';
import * as weather from './weather.js';
import { buildWorkbook, XLSX_MIME } from './xlsx.js';
import { WORLD_PATH, MAP_W, MAP_H, project } from './worldmap.js';

const app = document.getElementById('app');
// Single source of truth for the shown release. Bump alongside the service-worker
// cache tag and the newest version-history entry.
const APP_VERSION = 'v83';
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
// is the user's saved set of places (seeded with DEFAULT_STORAGE_LOCATIONS) plus
// any place already in use on an item, so the wording stays consistent instead of
// being retyped slightly differently. The saved set is add/rename/remove-able in
// Settings and persisted in localStorage.
let STORAGES = [];
const STORAGE_LOC_KEY = 'ams-storage-locations';

// --- Data safety: persistent storage + backup reminders ---
// All data lives in this device's IndexedDB (see db.js). Two guards:
//  (1) ask the browser to mark that storage "persistent" so it isn't evicted
//      under storage pressure or Safari's inactivity clean-up;
//  (2) keep track of when the user last exported a backup and nudge them when
//      it's been a while, since a saved file is the real insurance.
const LAST_BACKUP_KEY = 'ams-last-backup';        // YYYY-MM-DD of the last JSON export
const BACKUP_NUDGE_SNOOZE_KEY = 'ams-backup-snooze'; // YYYY-MM-DD until which the home nudge stays hidden
const BACKUP_STALE_DAYS = 30;                     // remind if the last backup is older than this
const BACKUP_SNOOZE_DAYS = 7;                     // after "remind me later", stay quiet this long

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
function markBackedUp() { try { localStorage.setItem(LAST_BACKUP_KEY, todayISO()); } catch { /* ignore */ } }
// Whole days since the last backup, or null if one has never been made.
function daysSinceBackup() {
  const iso = lastBackupISO();
  if (!iso) return null;
  const ms = Date.now() - new Date(`${iso}T00:00:00`).getTime();
  return ms >= 0 ? Math.floor(ms / 86400000) : 0;
}
function snoozeBackupNudge() {
  const until = new Date(Date.now() + BACKUP_SNOOZE_DAYS * 86400000).toISOString().slice(0, 10);
  try { localStorage.setItem(BACKUP_NUDGE_SNOOZE_KEY, until); } catch { /* ignore */ }
}
function backupNudgeSnoozed() {
  try { const u = localStorage.getItem(BACKUP_NUDGE_SNOOZE_KEY); return !!u && u > todayISO(); }
  catch { return false; }
}
// Show the home reminder only when there's real work to lose (at least one event)
// and either no backup exists yet or it's gone stale — and it isn't snoozed.
function shouldRemindBackup(events) {
  if (!events || !events.length) return false;
  if (backupNudgeSnoozed()) return false;
  const d = daysSinceBackup();
  return d === null || d >= BACKUP_STALE_DAYS;
}
function loadStorageLocs() {
  try {
    const raw = localStorage.getItem(STORAGE_LOC_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim());
    }
  } catch { /* ignore */ }
  return DEFAULT_STORAGE_LOCATIONS.slice();
}
function saveStorageLocs(arr) {
  // De-duplicate case-insensitively, keeping first spelling, then sort.
  const seen = new Map();
  for (const s of arr) { const t = (s || '').trim(); const k = t.toLowerCase(); if (t && !seen.has(k)) seen.set(k, t); }
  const clean = [...seen.values()].sort((a, b) => a.localeCompare(b));
  try { localStorage.setItem(STORAGE_LOC_KEY, JSON.stringify(clean)); } catch { /* ignore */ }
  return clean;
}
// Add a place to the saved set if it isn't already there (case-insensitive).
function rememberStorageLoc(name) {
  const t = (name || '').trim();
  if (!t) return;
  const locs = loadStorageLocs();
  if (!locs.some((s) => s.toLowerCase() === t.toLowerCase())) saveStorageLocs([...locs, t]);
}
// Rename a saved place and carry the new spelling onto every item using the old
// one, so nothing is orphaned. Returns how many items were updated.
async function renameStorageLoc(oldName, newName) {
  const from = (oldName || '').trim();
  const to = (newName || '').trim();
  if (!from || !to || from.toLowerCase() === to.toLowerCase()) return 0;
  saveStorageLocs(loadStorageLocs().map((s) => (s.toLowerCase() === from.toLowerCase() ? to : s)).concat(to));
  const lists = await db.getLists();
  let count = 0;
  for (const l of lists) {
    let changed = false;
    for (const it of l.items) if (it.storage && it.storage.trim().toLowerCase() === from.toLowerCase()) { it.storage = to; changed = true; count += 1; }
    if (changed) await db.saveList(l);
  }
  return count;
}
function removeStorageLoc(name) {
  saveStorageLocs(loadStorageLocs().filter((s) => s.toLowerCase() !== (name || '').trim().toLowerCase()));
}
function collectStorages(lists) {
  const seen = new Map(); // lowercase key -> display spelling
  for (const s of loadStorageLocs()) { const t = s.trim(); if (t) seen.set(t.toLowerCase(), t); }
  for (const l of lists) for (const it of l.items) if (it.storage) { const t = it.storage.trim(); if (t) seen.set(t.toLowerCase(), t); }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
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

// A small "condition" badge for an item row — shown ONLY for the states that need
// attention (worn / needs-replacing), so healthy gear stays unbadged and quiet.
function conditionBadgeHTML(it) {
  if (it.condition === 'retire') return '<span class="badge cond retire" title="Condition: Needs replacing">♻️ Replace</span>';
  if (it.condition === 'worn') return '<span class="badge cond worn" title="Condition: Worn">Worn</span>';
  return '';
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
  { key: 'liquid', label: '💧' },
  { key: 'charging', label: '⚡' },
  { key: 'restricted', label: '⚠️' },
  { key: 'container', label: 'Container' },
  { key: 'color', label: 'Color' },
  { key: 'size', label: 'Size' },
  { key: 'manufacturer', label: 'Maker' },
  { key: 'model', label: 'Model' },
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
      const known = saved.filter((k) => all.includes(k));
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
        <button class="iconbtn sm" data-m="up" ${i === 0 ? 'disabled' : ''} aria-label="Move up">▲</button>
        <button class="iconbtn sm" data-m="down" ${i === cols.length - 1 ? 'disabled' : ''} aria-label="Move down">▼</button>
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
      <th class="cell-name" scope="row"><a href="#/list/${esc(openLid)}/item/${esc(row.id)}">${esc(it.name || '(unnamed)')}</a>${it.retired ? ' <span title="Not in use">🚫</span>' : ''}</th>
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
    const colLabel = (k) => (GRID_ITEM_COLS.find((c) => c.key === k) || {}).label || k;
    const head = `<thead>
      <tr class="grp"><th class="cell-name" rowspan="2">Item <em>${rows.length}</em></th>
        <th colspan="${colOrder.length}">① The item itself</th><th colspan="2">② In this list</th><th colspan="${templates.length}">③ In these templates</th></tr>
      <tr class="col">${colOrder.map((k) => `<th>${esc(colLabel(k))}</th>`).join('')}
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
        if (!l.items.some((z) => z._itemId === id)) l.items.unshift(copyItemForTemplate(row.item, row.item.name));
      } else {
        // Never orphan the item: if this was its only home, park it in Loose first.
        const others = row.mems.filter((m) => m.listId !== lid);
        if (!others.length) { const loose = await ensureLoose(); if (loose && !loose.items.some((z) => z._itemId === id)) { loose.items.unshift(copyItemForTemplate(row.item, row.item.name)); await db.saveList(loose); } }
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
  { key: 'loose',      label: '⚠️ No template', test: (it) => isUnfiled(it.name) },
  { key: 'liquid',     label: '💧 Liquids',     test: (it) => !!it.liquid },
  { key: 'charge',     label: '⚡ Charging',     test: (it) => !!it.charging },
  { key: 'restricted', label: '⚠️ Restricted',  test: (it) => !!it.restricted },
  { key: 'care',       label: '🧰 Has care',    test: (it) => hasCare(it) },
  { key: 'photo',      label: '📷 Photo',        test: (it) => (it.photos || []).length > 0 },
  { key: 'retired',    label: '🚫 Not in use',   test: (it) => !!it.retired },
];

// Chip-bar HTML for the given items and active filter Set. Only categories that
// actually occur are shown, each with a live count; a dashed "Show all" clears.
// `excludeLoose` drops the "No template" chip where it's meaningless (the Loose
// bin itself, where every item is unfiled).
function itemFilterChipsHTML(items, filter, excludeLoose) {
  const cats = ITEM_FILTER_CATS.filter((c) => !(excludeLoose && c.key === 'loose'));
  const chips = cats.map((c) => ({ c, n: items.filter(c.test).length })).filter((x) => x.n)
    .map(({ c, n }) => `<button class="fchip${filter.has(c.key) ? ' on' : ''}" type="button" data-cat="${c.key}">${c.label} <em>${n}</em></button>`)
    .join('');
  return chips ? `${chips}<button class="fchip clear" type="button" data-cat="__clear"${filter.size ? '' : ' hidden'}>Show all</button>` : '';
}

// Does an item pass the active category filter? (OR across the chosen chips.)
function itemMatchesFilter(it, filter) {
  if (!filter.size) return true;
  return [...filter].some((k) => { const c = ITEM_FILTER_CATS.find((x) => x.key === k); return c ? c.test(it) : false; });
}

// A resolved item shaped for another template — carries the packing-relevant
// attributes (so a new hat lands with its container, weight, flags, conditions
// and storage intact) but NOT the per-object care record: photos and the
// maintenance schedule belong to the shared catalog item, not the membership.
// This is a transient object: db.saveList decomposes it, merging it into the one
// catalog item (by name) and recording the per-template context as a membership —
// nothing is persisted as a duplicate.
function copyItemForTemplate(src, name) {
  return newItem({
    name,
    swedish: src.swedish || '',
    qty: src.qty || '',
    category: src.category,
    container: src.container,
    phase: src.phase,
    itemType: src.itemType,
    charging: src.charging, chargeType: src.chargeType,
    shortList: src.shortList,
    seasons: (src.seasons || []).slice(),
    contexts: (src.contexts || []).slice(),
    transports: (src.transports || []).slice(),
    catering: (src.catering || []).slice(),
    weather: (src.weather || []).slice(),
    sub: (src.sub || []).slice(),
    note: src.note || '',
    weight: src.weight || 0,
    liquid: src.liquid, restricted: src.restricted, perNight: src.perNight,
    storage: src.storage || '',
  });
}

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
const CARE_EMOJI = { overdue: '🔴', soon: '🟡', ok: '🟢', reference: '🧰' };
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
    const quota = err && (err.name === 'QuotaExceededError' || /quota|exceeded/i.test(String((err && err.message) || err)));
    alert(quota
      ? 'This device is out of storage. Export a backup, remove some old events, and try again.'
      : 'Sorry — that could not be saved. Please try again.');
    return false;
  }
}

const IC = {
  bag: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8h12l-1 12H7Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>',
  list: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h11M8 12h11M8 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/></svg>',
  plus: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><path d="M12 6v12M6 12h12"/></svg>',
  gear: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><polygon points="12,2.5 21.2,7.25 21.2,16.75 12,21.5 2.8,16.75 2.8,7.25"/><circle cx="12" cy="12" r="4"/></svg>',
  trash: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13"/></svg>',
  edit: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L18 10l-4-4L4 16Z"/><path d="M13 7l4 4"/></svg>',
  back: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
  sheet: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M10 4v16"/></svg>',
  refresh: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 0 1 13.7-5.7L20 8"/><path d="M20 4v4h-4"/><path d="M20 12a8 8 0 0 1-13.7 5.7L4 16"/><path d="M4 20v-4h4"/></svg>',
  fwd: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  close: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  check: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
  share: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4M8.5 7.5 12 4l3.5 3.5"/><path d="M6 12v6a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-6"/></svg>',
  link: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/></svg>',
  pin: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/></svg>',
  wrench: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.2 5.1L4 16.9 7.1 20l5.5-5.5a4 4 0 0 0 5.1-5.2l-2.4 2.4-2.1-.6-.6-2.1Z"/></svg>',
  camera: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.2"/></svg>',
  cal: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M8 3.5v3M16 3.5v3"/></svg>',
  search: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/></svg>',
  globe: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18"/></svg>',
  star: '<svg class="ic" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.79L12 16.77 6.8 19.5l.99-5.79-4.21-4.1 5.82-.85Z"/></svg>',
};

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
};
const wIcon = (key) => WIC[key] || WIC.cloud;

// Travel/packing glyphs for the packing-list group headers. Keyed by the exact
// category / container / phase label so one lookup covers every group-by mode.
const CATEGORY_ICON = {
  'Clothing': '👕', 'Adventure clothing': '🧥', 'Footwear': '👟', 'Sport gear': '🎽',
  'Food & drink': '🥨', 'Toiletries': '🧴', 'Pharmacy / meds': '💊', 'Electronics': '🔌',
  'Documents & money': '🛂', 'Charging': '🔋', 'Comfort & misc': '🧸', 'Reminders': '🔔',
};
const CONTAINER_ICON = {
  'Toiletry bag': '👝', 'Carry-on / hand luggage': '💼', 'Checked luggage': '🧳',
  'Hiking backpack': '🎒', 'Climbing backpack': '🧗', 'Golf bag': '⛳', 'Triathlon bag': '🚴',
  'Swim bag': '🏊', 'Duffel bag': '👜', 'Day pack': '🥾', 'Bellroy backpack': '🎒',
  'Tech pouch': '🔌', 'Electronics bag': '💻', 'Cool box': '🧊', 'Handbag': '👛',
  'RV storage box': '📦', 'Other': '📦',
};
const PHASE_ICON = {
  'Preparations': '📋', '≥1 week ahead': '🗓️', 'Day before (stage / move to RV)': '📦',
  'Morning list': '🌅', 'At the front door': '🚪', 'Wear / carry on the day': '🚶',
  'After / recovery': '🛁',
};
// The glyph for a group/sub header, matched by its label across all three maps.
function groupIcon(label) {
  return CATEGORY_ICON[label] || CONTAINER_ICON[label] || PHASE_ICON[label] || '';
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
function activitiesPicker(lists, selected) {
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
  const section = (title, hint, gid, arr) => {
    if (!arr.length) return '';
    return `<div class="grp" data-grp="${esc(gid)}">
      <div class="grp-h"><span class="grp-t">${esc(gid ? `${gid} · ${title}` : title)}</span>${gid ? '<button type="button" class="linkbtn" data-selall="1">select all</button>' : ''}</div>
      ${hint ? `<p class="grp-hint">${esc(hint)}</p>` : ''}
      <div class="checks">${arr.map(box).join('')}</div>
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
  wrap.appendChild(h('<div class="topbar"><h1>AMS Packing List</h1></div>'));

  // On-open reminder: the soonest trip that has items due to pack now.
  const nudges = events.map((e) => ({ e, n: tripNudge(e) })).filter((x) => x.n && x.n.dueCount > 0);
  nudges.sort((a, b) => a.n.daysToGo - b.n.daysToGo);
  if (nudges.length) {
    const { e, n } = nudges[0];
    wrap.appendChild(h(`<a class="nudge" href="#/event/${e.id}/pack">
      <span class="nudge-ic">⏰</span>
      <span class="nudge-body"><b>${esc(e.name || 'Trip')} ${esc(n.label)}</b> — ${n.dueCount} item${n.dueCount === 1 ? '' : 's'} to pack now<span class="nudge-sub">${esc(n.focusLabel)}</span></span>
      <span class="nudge-go">${IC.fwd}</span>
    </a>`));
  }

  // Care reminder: gear that's overdue or due soon for maintenance.
  const care = maintenanceSummary(lists);
  if (care.due > 0) {
    const parts = [care.overdue ? `${care.overdue} overdue` : '', care.soon ? `${care.soon} due soon` : ''].filter(Boolean).join(' · ');
    wrap.appendChild(h(`<a class="nudge care" href="#/maintenance">
      <span class="nudge-ic">🧰</span>
      <span class="nudge-body"><b>Maintenance due</b> — ${care.due} item${care.due === 1 ? ' needs' : 's need'} looking after<span class="nudge-sub">${esc(parts)}</span></span>
      <span class="nudge-go">${IC.fwd}</span>
    </a>`));
  }

  // To-do reminder: open actions waiting on the Actions tab — a glanceable count
  // up here with the other nudges, rather than the full list buried down-page.
  const openActions = actions.filter((a) => !a.done);
  if (openActions.length) {
    const high = openActions.filter((a) => a.priority === 'high').length;
    const detail = `${openActions.length} open${high ? ` · ${high} high-priority` : ''}`;
    wrap.appendChild(h(`<a class="nudge todo" href="#/actions">
      <span class="nudge-ic">🗒️</span>
      <span class="nudge-body"><b>To-dos to tackle</b> — ${detail}<span class="nudge-sub">Tap to open your Actions list</span></span>
      <span class="nudge-go">${IC.fwd}</span>
    </a>`));
  }

  // Backup reminder: a saved file is the real insurance for on-device data.
  if (shouldRemindBackup(events)) {
    const d = daysSinceBackup();
    const msg = d === null ? 'you haven’t saved a backup yet' : `it’s been ${d} day${d === 1 ? '' : 's'} since your last one`;
    const nudge = h(`<div class="nudge backup">
      <span class="nudge-ic">💾</span>
      <a class="nudge-body" href="#/settings"><b>Back up your data</b> — ${esc(msg)}<span class="nudge-sub">Tap to open Settings → Export backup</span></a>
      <button class="nudge-x" type="button" aria-label="Remind me later" title="Remind me later">✕</button>
    </div>`);
    nudge.querySelector('.nudge-x').addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); snoozeBackupNudge(); render(); });
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
    for (const e of events.slice(0, HOME_EVENT_PREVIEW)) list.appendChild(h(eventCardHTML(e)));
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
  const meta = (e.mode === 'quick'
    ? ['⏱️ Quick', e.season, ...(e.contexts || [])]
    : [e.transport, e.season, cateringShort(e.catering), ...(e.contexts || [])]).filter(Boolean);
  const dToGo = daysUntil(e.startDate);
  const dateLabel = dToGo != null ? `🗓 ${esc(countdownLabel(dToGo))}` : '';
  return `<a class="card ev" href="#/event/${e.id}">
    <div class="ev-h"><span class="ev-name">${esc(e.name || 'Untitled event')}</span>${dateLabel ? `<span class="ev-date">${dateLabel}</span>` : ''}</div>
    <div class="chips">${meta.map(chip).join('')}</div>
    <div class="bar"><span style="width:${p.pct}%"></span></div>
    <div class="ev-prog">${p.done}/${p.total} packed · ${p.pct}%</div>
  </a>`;
}

// ============================================================
// Events tab — every saved event list, nearest upcoming first
// ============================================================
async function renderEvents() {
  const events = await db.getEvents();
  const wrap = h('<section class="screen"></section>');
  wrap.appendChild(h('<div class="topbar"><h1>Events</h1><a class="btn ghost" href="#/map">' + IC.globe + '<span>Map</span></a><a class="btn primary" href="#/">' + IC.plus + '<span>New</span></a></div>'));
  if (!events.length) {
    wrap.appendChild(h('<div class="empty"><p class="empty-t">No events yet</p><p class="empty-s">Head to Home to build your first trip’s combined Packing List.</p></div>'));
    return wrap;
  }
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
    list.appendChild(h(eventCardHTML(e)));
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
  form.innerHTML = `
    <fieldset class="mode-pick"><legend>List type</legend>${radioRow('mode', [
    { value: 'trip', label: '🧳 Full trip' },
    { value: 'quick', label: '⏱️ Quick activity' },
  ], ev.mode || 'trip')}
      <p class="grp-hint" data-mode-hint></p></fieldset>

    <label class="field"><span>Event name</span>
      <input name="name" value="${esc(ev.name)}" placeholder="e.g. Dolomites road trip" autocomplete="off"></label>
    <div class="row2">
      <label class="field"><span>Start date <em>(optional)</em></span>
        <input type="date" name="startDate" value="${esc(ev.startDate)}"></label>
      <label class="field"><span>End date <em>(optional)</em></span>
        <input type="date" name="endDate" value="${esc(endVal)}" min="${esc(ev.startDate || '')}"></label>
    </div>
    <p class="nights-hint muted" data-nights-hint></p>
    <label class="field"><span>Destination <em>(optional — for weather)</em></span>
      <input name="destination" value="${esc(ev.destination)}" placeholder="e.g. Chamonix" autocomplete="off"></label>

    <fieldset data-trip-only><legend>Way of transport</legend>${radioRow('transport', TRANSPORTS, ev.transport)}
      ${baseHint || transportHint ? `<p class="grp-hint">${baseHint}${transportHint}</p>` : ''}</fieldset>
    <fieldset><legend>Time of year</legend>${radioRow('season', SEASONS, ev.season)}</fieldset>
    <fieldset><legend>Force-pack weather gear</legend>${checkRow('weatherOn', WEATHER_CONDITIONS.map((w) => ({ value: w.id, label: w.label })), ev.weatherOn)}
      <p class="grp-hint">Tick a condition to <b>force in</b> every item tagged for it — packed as a precaution <b>whatever the forecast or season</b>. Handy for cold-weather kit on a summer trip, or a rain layer just in case. Leave them all off and weather gear stays held back until a fetched forecast calls for it.</p></fieldset>
    <fieldset data-trip-only><legend>Catering</legend>${radioRow('catering', CATERING.map((c) => ({ value: c.id, label: c.label })), ev.catering)}</fieldset>
    <fieldset><legend>WET Options</legend>${checkRow('contexts', CONTEXTS, ev.contexts)}</fieldset>

    <fieldset><legend data-activities-legend>Extra activities to pack for</legend>
      <p class="grp-hint" data-activities-hint></p>
      ${activitiesPicker(lists, ev.activities)}
    </fieldset>

    <div class="actions">
      ${isEdit ? `<a class="btn lg" href="#/event/${ev.id}">Cancel</a>` : ''}
      <button type="submit" class="btn primary lg">${isEdit ? 'Save & regenerate' : 'Create Event'}</button>
    </div>`;

  // Full trip vs Quick activity: quick mode drops the base + transport kit, so hide
  // the trip-only choices and re-word the activity picker to match.
  function syncMode() {
    const quick = form.querySelector('input[name=mode]:checked')?.value === 'quick';
    form.querySelectorAll('[data-trip-only]').forEach((el) => el.classList.toggle('hidden', quick));
    const legend = form.querySelector('[data-activities-legend]');
    const aHint = form.querySelector('[data-activities-hint]');
    const mHint = form.querySelector('[data-mode-hint]');
    if (legend) legend.textContent = quick ? 'Activities to pack for' : 'Extra activities to pack for';
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

  // Live nights readout: the trip length is derived from start -> end, and still
  // shown explicitly because it drives per-night quantities.
  const startInput = form.querySelector('input[name=startDate]');
  const endInput = form.querySelector('input[name=endDate]');
  const nightsHint = form.querySelector('[data-nights-hint]');
  function refreshNights() {
    if (startInput.value) endInput.min = startInput.value;  // can't come home before you leave
    const n = nightsBetween(startInput.value, endInput.value);
    let msg; let warn = false;
    if (!startInput.value || !endInput.value) msg = 'Add an end date to count the days — nights scale per-night quantities.';
    else if (n == null) { msg = '⚠ End date is before the start date.'; warn = true; }
    else {
      const days = n + 1;  // inclusive calendar days: start and end day both count
      msg = n === 0
        ? '🗓 1 day · 🌙 0 nights (day trip)'
        : `🗓 ${days} days · 🌙 ${n} night${n === 1 ? '' : 's'}`;
    }
    nightsHint.textContent = msg;
    nightsHint.classList.toggle('warn', warn);
  }
  startInput.addEventListener('change', refreshNights);
  endInput.addEventListener('change', refreshNights);
  refreshNights();

  // Per-group "select all / none" for the activity picker.
  form.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-selall]');
    if (!btn) return;
    e.preventDefault();
    const grp = btn.closest('.grp');
    const boxes = $$('input[type=checkbox]', grp);
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
let flagFilter = new Set(); // active "sort out" filters on the Total List: 'liquid' and/or 'charge'
let flagFilterFor = null;   // the event id the filter belongs to (cleared when you switch trips)
let weightSort = false;     // "Heaviest first" ordering toggle on the Total List
const collapsedGroups = new Set(); // group headings folded closed on the Total List (keyed `mode|label`)

async function renderEvent(eventId) {
  const ev = await db.getEvent(eventId);
  if (!ev) { location.assign('#/'); return h('<section></section>'); }
  ALL_LISTS = await db.getLists(); // so an entry can be traced back to its template item
  if (flagFilterFor !== eventId) { flagFilter = new Set(); weightSort = false; collapsedGroups.clear(); flagFilterFor = eventId; } // fresh per trip
  const p = progress(ev.entries);

  const wrap = h('<section class="screen"></section>');
  const topbar = h(`<div class="topbar">
    <a class="iconbtn" href="#/" aria-label="Back">${IC.back}</a>
    <h1 class="grow">${esc(ev.name)}</h1>
    <button class="iconbtn" type="button" data-rename aria-label="Rename event">${IC.edit}</button>
    <a class="iconbtn" href="#/event/${ev.id}/edit" aria-label="Event settings">${IC.gear}</a>
  </div>`);
  topbar.querySelector('[data-rename]').addEventListener('click', async () => {
    const name = (prompt('Rename event:', ev.name) || '').trim();
    if (!name || name === ev.name) return;
    ev.name = name;
    if (await saveGuard(db.saveEvent(ev))) render();
  });
  wrap.appendChild(topbar);

  const dToGo = daysUntil(ev.startDate);
  const countChip = dToGo != null ? `<span class="chip count">🗓 ${esc(countdownLabel(dToGo))}</span>` : '';
  const dw = deriveWeather(ev);
  const tempChip = dw ? `<span class="chip count">${wIcon(dw.days[0].icon)} ${esc(dw.rangeLabel)}</span>` : '';
  wrap.appendChild(h(`<div class="ev-summary">
    <div class="chips">${countChip}${tempChip}</div>
    <div class="bar big"><span style="width:${p.pct}%"></span></div>
    <div class="ev-prog">${p.done}/${p.total} packed · ${p.pct}%</div>
    ${p.total ? `<a class="btn primary lg pack-cta" href="#/event/${ev.id}/pack">${IC.bag}<span>${p.done >= p.total ? 'All packed ✓' : p.done ? 'Continue packing' : 'Start packing'}</span></a>` : ''}
  </div>`));

  wrap.appendChild(tripSetupCard(ev));

  const nudge = tripNudge(ev);
  if (nudge && nudge.dueCount > 0) {
    wrap.appendChild(h(`<a class="nudge" href="#/event/${ev.id}/pack">
      <span class="nudge-ic">⏰</span>
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
    <button class="btn ghost" data-act="regen">${IC.refresh}<span>Regenerate</span></button>
    <button class="btn ghost" data-act="review">${IC.check}<span>Trip review</span></button>
    <button class="btn ghost" data-act="share">${IC.share}<span>Share</span></button>
    <button class="btn ghost" data-act="xlsx">${IC.sheet}<span>Excel</span></button>
  </div>`);
  wrap.appendChild(toolbar);

  const body = h('<div class="total"></div>');
  wrap.appendChild(body);

  const rerender = () => { renderTotalBody(body, ev); };
  rerender();

  // "Sort out" quick filters: isolate all liquids (💧) or all chargeables (⚡)
  // so they can be gathered — the wash bag, the cable pouch. Reuses the same rows.
  const liquidCount = ev.entries.filter((e) => e.liquid).length;
  const chargeCount = ev.entries.filter((e) => e.charging).length;
  const restrictedCount = ev.entries.filter((e) => e.restricted).length;
  const weightedCount = ev.entries.filter((e) => Number(e.weight) > 0).length;
  if (liquidCount || chargeCount || restrictedCount || weightedCount) {
    const fchip = (key, label, n) => `<button class="fchip${flagFilter.has(key) ? ' on' : ''}" data-filter="${key}">${label} <em>${n}</em></button>`;
    const filterbar = h(`<div class="filterbar">
      <span class="filterbar-lbl">Sort out</span>
      ${liquidCount ? fchip('liquid', '💧 Liquids', liquidCount) : ''}
      ${chargeCount ? fchip('charge', '⚡ Charge', chargeCount) : ''}
      ${restrictedCount ? fchip('restricted', '⚠️ Restricted', restrictedCount) : ''}
      ${weightedCount ? `<button class="fchip${weightSort ? ' on' : ''}" data-filter="__weight">🪨 Heaviest</button>` : ''}
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
    else if (act === 'regen') {
      if (!confirm('Regenerate from your packing lists? Your manual additions, edits and ticks are kept; new matching items are added.')) return;
      const lists = await db.getLists();
      ev.entries = regenerateEntries(ev, lists);
      if (await saveGuard(db.saveEvent(ev))) render();
    } else if (act === 'review') { location.assign(`#/event/${ev.id}/review`); }
    else if (act === 'share') { shareTrip(ev); }
    else if (act === 'xlsx') { exportEventXlsx(ev); }
  });

  return wrap;
}

// A pretty, read-only recap of every choice made when the event was created —
// list type, dates, destination, transport, season, catering, WET contexts and
// the activities that were ticked. Collapsible so it never crowds the list.
const TRANSPORT_EMOJI = { Car: '🚗', Plane: '✈️', RV: '🚐' };
const SEASON_EMOJI = { Summer: '☀️', Winter: '❄️' };
const CATERING_EMOJI = { self: '🍳', eatout: '🍽️', mixed: '🥡' };
const CONTEXT_EMOJI = { Indoor: '🏠', Outdoor: '🌲', Race: '🏁' };
const GROUP_EMOJI = { GA: '🎯', WET: '🏋️', OE: '🎈' };
function tripSetupCard(ev) {
  const quick = ev.mode === 'quick';

  // Single-value settings become tiles in a responsive grid.
  const tiles = [];
  const tile = (ic, lbl, val) => tiles.push(
    `<div class="setup-tile"><span class="setup-ic">${ic}</span>`
    + `<div class="setup-txt"><span class="setup-lbl">${esc(lbl)}</span>`
    + `<span class="setup-val">${val}</span></div></div>`);

  tile(quick ? '⏱️' : '🧳', 'List type', quick ? 'Quick activity' : 'Full trip');

  const endVal = ev.endDate || endFromNights(ev.startDate, ev.nights);
  if (ev.startDate || endVal) {
    const n = nightsBetween(ev.startDate, endVal);
    const sub = n == null ? '' : n === 0 ? ' · day trip' : ` · ${n} night${n === 1 ? '' : 's'}`;
    tile('🗓', 'Dates', `${esc(prettyRange(ev.startDate, endVal))}${sub}`);
  }
  if (ev.destination) tile('📍', 'Destination', esc(ev.destination));
  if (!quick && ev.transport) tile(TRANSPORT_EMOJI[ev.transport] || '🧭', 'Transport', esc(ev.transport));
  if (ev.season) tile(SEASON_EMOJI[ev.season] || '📅', 'Time of year', esc(ev.season));
  if (!quick && ev.catering) tile(CATERING_EMOJI[ev.catering] || '🍴', 'Catering', esc(cateringLabel(ev.catering)));

  // Multi-value settings (WET contexts, ticked activities) become tag rows below.
  const blocks = [];
  const contexts = ev.contexts || [];
  if (contexts.length) {
    const tags = contexts.map((c) => `<span class="setup-tag">${CONTEXT_EMOJI[c] || '•'} ${esc(c)}</span>`).join('');
    blocks.push(`<div class="setup-block"><span class="setup-lbl">WET options</span><div class="setup-tags">${tags}</div></div>`);
  }
  const weatherOn = ev.weatherOn || [];
  if (weatherOn.length) {
    const WX_EMOJI = { rain: '🌧', cold: '🥶', hot: '🔥', wind: '💨', snow: '❄️' };
    const tags = weatherOn.map((w) => {
      const def = WEATHER_CONDITIONS.find((x) => x.id === w);
      return `<span class="setup-tag">${WX_EMOJI[w] || '•'} ${esc(def ? def.label : w)}</span>`;
    }).join('');
    blocks.push(`<div class="setup-block"><span class="setup-lbl">Force-packed weather gear</span><div class="setup-tags">${tags}</div></div>`);
  }

  const byId = new Map((ALL_LISTS || []).map((l) => [l.id, l]));
  const chosen = (ev.activities || []).map((id) => byId.get(id)).filter(Boolean);
  if (chosen.length) {
    let inner = '';
    for (const g of GROUPS) {
      const arr = chosen.filter((l) => l.group === g.id);
      if (!arr.length) continue;
      inner += `<div class="setup-grp-lbl">${esc(g.id)} · ${esc(g.label)}</div>`
        + `<div class="setup-tags">${arr.map((l) => `<span class="setup-tag">${GROUP_EMOJI[g.id] || '•'} ${esc(l.name)}</span>`).join('')}</div>`;
    }
    const ung = chosen.filter((l) => !GROUP_IDS.includes(l.group));
    if (ung.length) {
      inner += '<div class="setup-grp-lbl">Other lists</div>'
        + `<div class="setup-tags">${ung.map((l) => `<span class="setup-tag">📦 ${esc(l.name)}</span>`).join('')}</div>`;
    }
    blocks.push(`<div class="setup-block"><span class="setup-lbl">${quick ? 'Activities packed for' : 'Extra activities'}</span>${inner}</div>`);
  }

  return h(`<details class="setup" open>
    <summary><span class="setup-title">✨ Trip setup</span><span class="setup-chev">${IC.fwd}</span></summary>
    <div class="setup-body">
      <div class="setup-grid">${tiles.join('')}</div>
      ${blocks.join('')}
    </div>
  </details>`);
}

// A collapsible "Bags & weight" panel: per-bag weight vs airline limit, plus liquids/battery counts.
function logisticsSummary(ev) {
  const f = packingFlags(ev.entries, ev.nights);
  const loads = bagLoads(ev.entries, ev.nights, containerLimits(ALL_LISTS || [])).filter((b) => b.grams > 0 || b.limitKg > 0);
  const overBags = loads.filter((b) => b.over);
  const bits = [];
  if (f.totalKg > 0) bits.push(`${f.totalKg} kg`);
  if (f.liquids) bits.push(`💧 ${f.liquids} liquid`);
  if (f.restricted) bits.push(`⚠️ ${f.restricted} restricted`);
  if (ev.nights) bits.push(`${ev.nights} night${ev.nights === 1 ? '' : 's'}`);
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
  // Apply the "sort out" filter; always keep the item being edited visible so a
  // freshly-added row still shows even when a filter is on.
  const entries = flagFilter.size
    ? ev.entries.filter((e) => e.id === expandedEntry
        || (flagFilter.has('liquid') && e.liquid)
        || (flagFilter.has('charge') && e.charging)
        || (flagFilter.has('restricted') && e.restricted))
    : ev.entries;
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
      for (const entry of s.entries) gb.appendChild(entryRow(ev, entry, body));
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
  const g = (e) => entryGrams(e, ev.nights);
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

function entryRow(ev, entry, body, showWeight = false) {
  const isRem = entry.itemType === 'reminder';
  const mode = viewFor(ev);
  // Show the dimensions NOT used as the current grouping, so the row stays informative.
  const subBits = [];
  if (mode !== 'stored' && entry.storage) subBits.push(`📍 ${esc(entry.storage)}`);
  if (mode !== 'section' && entry.section) subBits.push(`🗂 ${esc(entry.section)}`);
  if (mode !== 'container' && entry.container) subBits.push(esc(entry.container));
  if (mode !== 'category' && entry.category) subBits.push(esc(entry.category));
  if (mode !== 'when') subBits.push(esc(phaseLabel(entry.phase)));
  if (entry.note) subBits.push(esc(entry.note));
  if (entry.custom) subBits.push('added');
  const subLine = entry.swedish ? `<span class="e-sv">${esc(entry.swedish)}</span> · ` : '';
  const chShort = entry.charging ? chargeTypeShort(entry.chargeType) : '';
  const chTitle = entry.charging ? `Needs charging${chShort ? ` — ${chargeTypeLabel(entry.chargeType)}` : ''}` : '';
  const badges = `${entry.charging ? `<span class="badge charge" title="${esc(chTitle)}">⚡${chShort ? ` ${esc(chShort)}` : ''}</span>` : ''}`
    + `${entry.liquid ? '<span class="badge liquid" title="Liquid / 100 ml rule">💧</span>' : ''}`
    + `${entry.restricted ? '<span class="badge restricted" title="Restricted — think before packing (battery / carry-on rules)">⚠️</span>' : ''}`
    + `${isRem ? '<span class="badge rem">reminder</span>' : ''}`;
  // Scaled quantity: per-night items show × trip nights; otherwise the explicit qty.
  const eq = effectiveQty(entry, ev.nights);
  const qtyLabel = isRem ? '' : (entry.perNight && ev.nights ? ` <em title="scaled to ${ev.nights} nights">×${eq}</em>` : (entry.qty ? ` <em>×${esc(entry.qty)}</em>` : ''));
  const subItems = (entry.sub && entry.sub.length) ? `<span class="e-subitems">${entry.sub.map(esc).join(' · ')}</span>` : '';
  // In "Heaviest first" view, show each item's weight (— when none recorded).
  const g = showWeight ? entryGrams(entry, ev.nights) : 0;
  const weightPill = showWeight ? `<span class="e-weight${g > 0 ? '' : ' none'}">${g > 0 ? esc(formatGrams(g)) : '—'}</span>` : '';
  const row = h(`<div class="entry${entry.checked ? ' done' : ''}${isRem ? ' reminder' : ''}">
    <label class="ck"><input type="checkbox"${entry.checked ? ' checked' : ''}><span class="box"></span></label>
    <button class="entry-main" type="button">
      <span class="e-name">${esc(entry.name)}${qtyLabel} ${badges}</span>
      <span class="e-sub">${subLine}${subBits.join(' · ')}</span>
      ${subItems}
    </button>
    ${weightPill}
    <button class="iconbtn sm" type="button" data-edit aria-label="Edit">${IC.edit}</button>
  </div>`);

  row.querySelector('input').addEventListener('change', async (e) => {
    entry.checked = e.target.checked;
    row.classList.toggle('done', entry.checked);
    // update the progress bar without a full re-render
    await saveGuard(db.saveEvent(ev));
    const p = progress(ev.entries);
    const barSpan = $('.ev-summary .bar span'); const prog = $('.ev-summary .ev-prog');
    if (barSpan) barSpan.style.width = `${p.pct}%`;
    if (prog) prog.textContent = `${p.done}/${p.total} packed · ${p.pct}%`;
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
        const it = copyItemForTemplate(entry, entry.name || ''); // reuse the field-copier (no photos/care)
        list.items.unshift(it);
        if (!await saveGuard(db.saveList(list))) { finish(null); return; }
        entry.sourceListId = list.id; entry.sourceItemId = it.id; // link so it now resolves directly
        finish({ listId: list.id, itemId: it.id });
      }
    });
  });
}

function entryEditor(ev, entry, body) {
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
      <label class="field"><span>When</span>${selectHtml('phase', PHASES.map((p) => ({ value: p.id, label: p.label })), entry.phase)}</label>
    </div>
    <label class="field"><span>Section <em>groups this item on the list</em></span><input name="section" value="${esc(entry.section)}" list="entry-sections" placeholder="optional" autocomplete="off"><datalist id="entry-sections">${tripSecNames.map((n) => `<option value="${esc(n)}"></option>`).join('')}</datalist></label>
    <div class="row2">
      <label class="field"><span>Weight (g)</span><input type="number" name="weight" min="0" inputmode="numeric" value="${entry.weight || ''}" placeholder="0"></label>
      <div class="checks">
        <label class="check${entry.perNight ? ' on' : ''}"><input type="checkbox" name="perNight" ${entry.perNight ? 'checked' : ''}>Per night</label>
        <label class="check${entry.liquid ? ' on' : ''}"><input type="checkbox" name="liquid" ${entry.liquid ? 'checked' : ''}>💧</label>
        <label class="check${entry.charging ? ' on' : ''}"><input type="checkbox" name="charging" ${entry.charging ? 'checked' : ''}>⚡</label>
        <label class="check${entry.restricted ? ' on' : ''}"><input type="checkbox" name="restricted" ${entry.restricted ? 'checked' : ''}>⚠️</label>
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
    if (x === 'cancel') { expandedEntry = null; renderTotalBody(body, ev); return; }
    if (x === 'del') {
      if (!confirm(`Remove “${entry.name}” from this list?`)) return;
      ev.entries = ev.entries.filter((it) => it.id !== entry.id);
      expandedEntry = null;
      if (await saveGuard(db.saveEvent(ev))) render();
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
      expandedEntry = null;
      if (await saveGuard(db.saveEvent(ev))) location.assign(`#/list/${target.listId}/item/${target.itemId}`);
      return;
    }
    if (x === 'save') {
      applyForm();
      expandedEntry = null;
      if (await saveGuard(db.saveEvent(ev))) render();
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

// ============================================================
// Packing Mode — a focused, one-phase-at-a-time flow to pack from.
// ============================================================
let packState = { eventId: null, idx: 0, showPacked: false };

async function renderPackMode(eventId) {
  const ev = await db.getEvent(eventId);
  if (!ev || !ev.entries.length) { location.assign(`#/event/${eventId}`); return h('<section></section>'); }
  if (packState.eventId !== eventId) {
    // Open at the first phase that still has unpacked items.
    const steps = packSteps(ev.entries);
    const firstUnpacked = steps.findIndex((s) => s.remaining > 0);
    packState = { eventId, idx: firstUnpacked < 0 ? 0 : firstUnpacked, showPacked: false };
  }

  const wrap = h('<section class="screen pack"></section>');
  const body = h('<div></div>');
  wrap.appendChild(body);

  function draw() {
    const steps = packSteps(ev.entries);          // one per non-empty timeline phase
    const overall = progress(ev.entries);
    body.innerHTML = '';

    // Header (close back to the list)
    body.appendChild(h(`<div class="topbar">
      <a class="iconbtn" href="#/event/${ev.id}" aria-label="Close packing mode">${IC.close}</a>
      <h1 class="grow">${esc(ev.name)}</h1>
    </div>`));

    if (overall.done >= overall.total) { body.appendChild(finishScreen(ev, overall)); return; }

    // Overall progress
    body.appendChild(h(`<div class="pack-overall"><div class="bar big"><span style="width:${overall.pct}%"></span></div><div class="ev-prog">${overall.done}/${overall.total} packed · ${overall.pct}%</div></div>`));

    // Clamp the phase index and grab the current step
    packState.idx = Math.max(0, Math.min(packState.idx, steps.length - 1));
    const step = steps[packState.idx];

    const stepper = h(`<div class="pack-stepper">
      <button class="iconbtn" data-nav="prev" ${packState.idx === 0 ? 'disabled' : ''} aria-label="Previous phase">${IC.back}</button>
      <div class="pack-phase">
        <div class="pack-phase-t">${groupIcon(step.phase.label) ? `<span class="grp-ic" aria-hidden="true">${groupIcon(step.phase.label)}</span> ` : ''}${esc(step.phase.label)}</div>
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
      const items = cg.entries.filter((e) => packState.showPacked || !e.checked);
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

function packRow(ev, entry, redraw) {
  const meta = [entry.swedish, entry.storage ? `📍 ${entry.storage}` : '', entry.container, entry.note].filter(Boolean).map(esc).join(' · ');
  const row = h(`<button class="pack-item${entry.checked ? ' done' : ''}" type="button">
    <span class="pack-box">${entry.checked ? IC.check : ''}</span>
    <span class="pack-body">
      <span class="pack-name">${esc(entry.name)}${entry.qty ? ` <em>×${esc(entry.qty)}</em>` : ''}${entry.charging ? ` <span class="badge charge" title="${esc('Needs charging' + (chargeTypeShort(entry.chargeType) ? ` — ${chargeTypeLabel(entry.chargeType)}` : ''))}">⚡${chargeTypeShort(entry.chargeType) ? ` ${esc(chargeTypeShort(entry.chargeType))}` : ''}</span>` : ''}</span>
      ${meta ? `<span class="pack-meta">${meta}</span>` : ''}
    </span>
  </button>`);
  row.addEventListener('click', async () => {
    entry.checked = !entry.checked;
    await saveGuard(db.saveEvent(ev));
    redraw();
  });
  return row;
}

function finishScreen(ev, overall) {
  return h(`<div class="pack-finish empty">
    <p class="pack-finish-emoji">🎒</p>
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
        <span class="rev-name">${esc(e.name)}${e.swedish ? ` <span class="e-sv">${esc(e.swedish)}</span>` : ''}</span>
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
  wrap.appendChild(h(`<div class="topbar"><h1>Templates</h1><a class="btn ghost" href="#/refine">Refine</a><button class="btn primary" data-new>${IC.plus}<span>New</span></button></div>`));
  wrap.appendChild(h(`<p class="muted pad">These are your reusable building blocks. An <b>Event</b> combines the ones you pick into a single <b>Packing List</b> to pack from.</p>`));

  const card = (l) => h(`<a class="card lst" href="#/list/${l.id}">
      <span class="lst-name">${esc(l.name)}${l.items.length ? '' : ' <em>(empty)</em>'}</span>
      <span class="lst-count">${l.items.length} item${l.items.length === 1 ? '' : 's'}</span>
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
    const cards = h('<div class="cards"></div>');
    arr.forEach((l) => cards.appendChild(card(l)));
    wrap.appendChild(cards);
  }
  if (ungrouped.length) {
    wrap.appendChild(h('<h2 class="section-h">Other templates</h2>'));
    const cards = h('<div class="cards"></div>');
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
    <div class="spacer"></div>
    ${noTemplateChrome ? '' : `<button class="btn ghost" data-sections>${IC.list}<span>Sections${list.sections.length ? ` (${list.sections.length})` : ''}</span></button>`}
    ${isLoose ? `<button class="btn ghost" data-batch>${IC.list}<span>Add several</span></button>` : ''}
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
  // editor straight away (and expand its 🧰 care panel).
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
  wrap.querySelector('[data-batch]')?.addEventListener('click', () => {
    const added = batchAddItems(list);
    added.then((n) => { if (n > 0) { openItem = null; draw(); } });
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
        <button class="iconbtn sm" data-m="up" ${i === 0 ? 'disabled' : ''} aria-label="Move up">▲</button>
        <button class="iconbtn sm" data-m="down" ${i === secs.length - 1 ? 'disabled' : ''} aria-label="Move down">▼</button>
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
const IC_FLAG = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 21V4M6 4h11l-2 4 2 4H6"/></svg>';
// The "when" choices: any time, or one of the trip phases.
const ACTION_WHEN_OPTS = [{ value: '', label: 'Any time' }, ...PHASES.map((p) => ({ value: p.id, label: p.label }))];
function actionWhenSelectHtml(dataAttr, val) {
  return `<select ${dataAttr}>${ACTION_WHEN_OPTS.map((o) => `<option value="${esc(o.value)}"${o.value === (val || '') ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
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
  const tags = [it.owner ? `👤 ${it.owner}` : '', it.storage ? `📍 ${it.storage}` : '', it.container, ...(it.seasons || []), ...(it.contexts || []), ...(it.transports || [])].filter(Boolean);
  const chShort = it.charging ? chargeTypeShort(it.chargeType) : '';
  const care = maintenanceStatus(it);
  const badges = `${isUnfiled(it.name) ? '<span class="badge unfiled" title="Not in any template yet — still a loose item">⚠️ No template</span>' : ''}`
    + `${it.charging ? `<span class="badge charge" title="${esc('Needs charging' + (chShort ? ` — ${chargeTypeLabel(it.chargeType)}` : ''))}">⚡${chShort ? ` ${esc(chShort)}` : ''}</span>` : ''}`
    + `${it.liquid ? '<span class="badge liquid" title="Liquid / 100 ml rule">💧</span>' : ''}`
    + `${it.restricted ? '<span class="badge restricted" title="Restricted — think before packing (battery / carry-on rules)">⚠️</span>' : ''}`
    + `${(it.photos || []).length ? `<span class="badge photo" title="${esc((it.photos.length === 1 ? 'Has a photo' : `${it.photos.length} photos`))}">📷${it.photos.length > 1 ? ` ${it.photos.length}` : ''}</span>` : ''}`
    + `${care ? `<span class="badge maint ${care.state}" title="${esc(`Maintenance: ${dueLabel(care)}`)}">${CARE_EMOJI[care.state]}</span>` : ''}`
    + `${openActionsForItem(it._itemId) ? `<span class="badge act" title="${esc(`${openActionsForItem(it._itemId)} open to-do${openActionsForItem(it._itemId) === 1 ? '' : 's'}`)}">☑ ${openActionsForItem(it._itemId)}</span>` : ''}`
    + `${it.retired ? `<span class="badge retired" title="${esc('Not in use' + (it.retiredReason ? ` — ${retireReasonLabel(it.retiredReason)}` : '') + ' — kept on record, never added to a trip')}">🚫 Not in use</span>` : ''}`
    + conditionBadgeHTML(it);
  const thumb = (it.photos || []).length ? `<img class="row-thumb" src="${esc(it.photos[0])}" alt="">` : '';
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
  let photos = (it.photos || []).slice();
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
  const growField = (name, labelHtml, cur, addLabel, placeholder) => {
    const vals = collectItemValues(name);
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
  const detailsOpen = isContainer || !!(it.color || it.size || it.manufacturer || it.model || it.owner || it.acquired
    || it.price || it.currency || it.purchaseLink || it.expiry || it.condition || it.retired || it.serial || it.qtyOwned || it.warranty);

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
        <label class="field"><span>Container <em>default</em></span>${selectHtml('container', ['', ...containerOpts(it.container)].map((c) => ({ value: c, label: c || '— none (task) —' })), it.container)}</label>
        <label class="field"><span>When <em>default phase</em></span>${selectHtml('phase', PHASES.map((p) => ({ value: p.id, label: p.label })), it.phase)}</label>
      </div>
      <label class="field"><span>Weight (g) <em>per unit</em></span><input type="number" name="weight" min="0" inputmode="numeric" value="${it.weight || ''}" placeholder="0"></label>
      <div class="checks">
        <label class="check${it.charging ? ' on' : ''}"><input type="checkbox" name="charging" ${it.charging ? 'checked' : ''}>⚡ Charging</label>
        <label class="check${it.liquid ? ' on' : ''}"><input type="checkbox" name="liquid" ${it.liquid ? 'checked' : ''}>💧 Liquid</label>
        <label class="check${it.restricted ? ' on' : ''}"><input type="checkbox" name="restricted" ${it.restricted ? 'checked' : ''}>⚠️ Restricted</label>
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
          <label class="field"><span>Owner <em>whose it is</em></span><input name="owner" value="${esc(it.owner)}" placeholder="e.g. Martin · Anna · Shared" autocomplete="off"></label>
          <div class="row2">
            <label class="field"><span>Condition</span>${selectHtml('condition', [{ value: '', label: '— not set —' }, ...ITEM_CONDITIONS.map((c) => ({ value: c.id, label: c.label }))], it.condition)}</label>
            <label class="field"><span>Quantity owned</span><input type="number" name="qtyOwned" min="0" inputmode="numeric" value="${it.qtyOwned || ''}" placeholder="e.g. 3"></label>
          </div>
          <div class="lifecycle${it.retired ? ' is-retired' : ''}">
            <label class="check${it.retired ? ' on' : ''}"><input type="checkbox" name="retired" ${it.retired ? 'checked' : ''}>🚫 Not in use <em>kept on record, but never added to a trip</em></label>
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
      <div class="care-photo-tile">
        <img src="${esc(p)}" alt="Photo ${i + 1}" data-photo-view="${i}">
        <button type="button" class="care-photo-rm" data-photo-rm="${i}" title="Remove photo" aria-label="Remove photo ${i + 1}">${IC.close}</button>
      </div>`).join('');
    const addTile = photos.length < MAX_PHOTOS
      ? `<button type="button" class="care-photo-add" data-care="pick" title="Add photo" aria-label="Add photo">${IC.camera}<span>Photo</span></button>`
      : '';
    box.innerHTML = tiles + addTile;
  };
  drawPhotos();
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
          <button type="button" class="act-flag${a.priority === 'high' ? ' on' : ''}" data-act-flag title="High priority">${IC_FLAG}</button>
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
        try { photos.push(await readImageResized(f)); }
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
    if (viewIdx != null) { openPhotoLightbox(photos[+viewIdx]); return; }
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
    if (x === 'cancel') { setOpen(null); draw(); return; }
    if (x === 'del') {
      const msg = isContainer
        ? `Delete the container “${it.name || 'this container'}”? Items already set to this container keep the name.`
        : `Remove “${it.name || 'this item'}” from the ${list.name} template?`;
      if (!confirm(msg)) return;
      list.items = list.items.filter((z) => z.id !== it.id);
      setOpen(null);
      if (await saveGuard(db.saveList(list))) draw();
      return;
    }
    if (x === 'save') {
      it.name = ($('input[name=name]', ed).value || '').trim();
      it.weight = Math.max(0, parseInt($('input[name=weight]', ed).value, 10) || 0);
      // Packing-only fields — absent in container mode, so read them only then.
      if (!isContainer) {
        it.qty = ($('input[name=qty]', ed).value || '').trim();
        it.section = readSectionFromEditor(ed, list, it);
        it.container = $('select[name=container]', ed).value;
        it.phase = $('select[name=phase]', ed).value;
        it.perNight = $('input[name=perNight]', ed).checked;
        it.charging = $('input[name=charging]', ed).checked;
        it.chargeType = $('select[name=chargeType]', ed).value;
        it.liquid = $('input[name=liquid]', ed).checked;
        it.restricted = $('input[name=restricted]', ed).checked;
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
      if (it.storage) rememberStorageLoc(it.storage); // a new place joins the saved set
      it.photos = photos.slice();
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
      it.owner = ($('input[name=owner]', ed).value || '').trim();
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
            l.items.unshift(copyItemForTemplate(it, it.name)); // saveList merges it into the shared item, adding a membership
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
      if (ok) { ALL_LISTS = await db.getLists(); await refreshActions(); draw(); }
    }
  });
  return ed;
}

// ============================================================
// Care & maintenance — one place to see what needs looking after,
// as an urgency-ordered list or a month calendar.
// ============================================================
let careView = 'list';            // 'list' | 'calendar'
let careExpanded = null;          // item id whose detail panel is open (list mode)
let careMonth = null;             // 'YYYY-MM' shown in the calendar (defaults to this month)
let careForceOpenItemId = null;   // when set, the item's editor opens with its 🧰 care panel expanded
let careItemSearch = '';          // current text in the "All items" search box on the Care page
const careItemFilter = new Set();  // active category chips on the Care page ('loose','liquid','charge','restricted','care','photo') — OR'd together
const monthOf = (ymd) => ymd.slice(0, 7);

async function renderMaintenance() {
  const wrap = h('<section class="screen"></section>');
  wrap.appendChild(h('<div class="topbar"><h1>Care &amp; maintenance</h1></div>'));

  const lists = await db.getLists();
  // Entry point to the Containers catalogue (bags/duffels/backpacks as objects).
  const containerCount = (lists.find((l) => l.role === CONTAINER_ROLE)?.items || []).length;
  wrap.appendChild(h(`<a class="care-link" href="#/containers">
    <span class="care-link-ic">🎒</span>
    <span class="care-link-body"><b>Containers</b><span class="care-link-sub">Your bags, duffels &amp; backpacks — photos, capacity, storage &amp; care${containerCount ? ` · ${containerCount}` : ''}</span></span>
    <span class="care-link-go">${IC.fwd}</span>
  </a>`));
  wrap.appendChild(h(`<a class="care-link" href="#/items">
    <span class="care-link-ic">▦</span>
    <span class="care-link-body"><b>All items · table</b><span class="care-link-sub">Every item as a spreadsheet — edit weight, storage, flags &amp; template membership in bulk</span></span>
    <span class="care-link-go">${IC.fwd}</span>
  </a>`));
  ALL_LISTS = lists; // so isUnfiled() in the All-items rows reflects the current data
  const listById = new Map(lists.map((l) => [l.id, l]));
  const rows = maintenanceList(lists);
  const summary = maintenanceSummary(lists);

  // ---- Top: what needs looking after (list / calendar) --------------------
  if (rows.length) {
    // Headline: overdue / due-soon counts.
    const sc = [];
    if (summary.overdue) sc.push(`<span class="care-stat overdue">🔴 ${summary.overdue} overdue</span>`);
    if (summary.soon) sc.push(`<span class="care-stat soon">🟡 ${summary.soon} due soon</span>`);
    if (!summary.due) sc.push(`<span class="care-stat ok">🟢 All up to date</span>`);
    wrap.appendChild(h(`<div class="care-stats">${sc.join('')}</div>`));

    // List / Calendar toggle.
    const seg = (val, label) => `<label class="seg${careView === val ? ' on' : ''}"><input type="radio" name="careview" value="${val}"${careView === val ? ' checked' : ''}>${label}</label>`;
    const toolbar = h(`<div class="toolbar"><div class="segmented small">${seg('list', 'List')}${seg('calendar', 'Calendar')}</div></div>`);
    wrap.appendChild(toolbar);

    const body = h('<div class="care-wrap"></div>');
    wrap.appendChild(body);

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
    wrap.appendChild(h(`<div class="care-none">
      <p class="empty-s">Nothing is scheduled for upkeep yet. Find an item below, open it, and fill in its <b>Storage &amp; maintenance</b> panel — a service interval or care notes will bring it here with reminders.</p>
    </div>`));
  }

  // ---- Below: browse every item and jump straight to its editor ----------
  wrap.appendChild(allItemsSection(lists));

  return wrap;
}

// The "All items" browser on the Care page: search all items across every
// list, tap one to jump to its editor (with the 🧰 care panel expanded), or
// add a brand-new item to any list and edit it right away.
function allItemsSection(lists) {
  const sec = h('<div class="allitems"></div>');
  const flat = [];
  for (const l of lists) for (const it of (l.items || [])) flat.push({ it, list: l });
  flat.sort((a, b) => (a.it.name || '').localeCompare(b.it.name || '', undefined, { sensitivity: 'base' }));
  const listOpts = lists.map((l) => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('');

  sec.innerHTML = `
    <div class="ai-head">
      <h2>${IC.list}<span>All items</span></h2>
      <button class="btn ghost sm" type="button" data-ai-add>${IC.plus}<span>New item</span></button>
    </div>
    <p class="ai-hint">Jump to any item to set where it’s stored, add a photo, or plan its maintenance.</p>
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
    <div class="ai-count"></div>
    <div class="ai-list"></div>`;

  const listEl = $('.ai-list', sec);
  const countEl = $('.ai-count', sec);
  const searchEl = $('.ai-search', sec);
  const filterEl = $('.ai-filterbar', sec);
  const form = $('[data-ai-form]', sec);

  // Category quick-filters for the whole item index (shared with each template's
  // own list). Picking chips shows items matching ANY chosen category (OR), then
  // narrowed by the text box.
  const drawChips = () => { filterEl.innerHTML = itemFilterChipsHTML(flat.map((r) => r.it), careItemFilter, false); };

  const drawItems = () => {
    const q = careItemSearch.trim().toLowerCase();
    const shown = flat.filter((row) => {
      const { it, list } = row;
      if (!itemMatchesFilter(it, careItemFilter)) return false;
      if (!q) return true;
      return (it.name || '').toLowerCase().includes(q)
        || (it.storage || '').toLowerCase().includes(q)
        || (list.name || '').toLowerCase().includes(q);
    });
    const filtered = q || careItemFilter.size;
    countEl.textContent = filtered ? `${shown.length} of ${flat.length} items` : `${flat.length} items`;
    listEl.innerHTML = '';
    if (!shown.length) { listEl.appendChild(h('<div class="empty"><p class="empty-s">No items match your search.</p></div>')); return; }
    for (const { it, list } of shown) listEl.appendChild(aiRow(it, list));
  };
  drawChips();
  drawItems();

  searchEl.addEventListener('input', () => { careItemSearch = searchEl.value; drawItems(); });
  filterEl.addEventListener('click', (e) => {
    const key = e.target.closest('[data-cat]')?.dataset.cat;
    if (!key) return;
    if (key === '__clear') careItemFilter.clear();
    else if (careItemFilter.has(key)) careItemFilter.delete(key); else careItemFilter.add(key);
    drawChips();
    drawItems();
  });

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

function aiRow(it, list) {
  const care = maintenanceStatus(it);
  const nPhotos = (it.photos || []).length;
  const thumb = nPhotos
    ? `<span class="ai-thumb"><img src="${esc(it.photos[0])}" alt="">${nPhotos > 1 ? `<span class="thumb-count">${nPhotos}</span>` : ''}</span>`
    : `<span class="ai-thumb ph">${IC.wrench}</span>`;
  const bits = [esc(list.name)];
  if (it.owner) bits.push(`👤 ${esc(it.owner)}`);
  if (it.storage) bits.push(`📍 ${esc(it.storage)}`);
  const unfiledBadge = isUnfiled(it.name) ? '<span class="ai-badge unfiled" title="Not in any template yet — still a loose item">⚠️</span>' : '';
  const badge = care
    ? `<span class="ai-badge ${care.state}" title="${esc('Maintenance: ' + dueLabel(care))}">${CARE_EMOJI[care.state]}</span>`
    : (nPhotos ? `<span class="ai-badge" title="${esc(nPhotos === 1 ? 'Has a photo' : `${nPhotos} photos`)}">📷${nPhotos > 1 ? ` ${nPhotos}` : ''}</span>` : '');
  return h(`<a class="ai-item" href="#/list/${esc(list.id)}/item/${esc(it.id)}">
    ${thumb}
    <span class="ai-main">
      <span class="ai-name">${esc(it.name || '(unnamed)')}</span>
      <span class="ai-sub">${bits.join(' · ')}</span>
    </span>
    ${unfiledBadge}${badge}${IC.fwd}
  </a>`);
}

const CARE_SECTIONS = [
  { state: 'overdue', label: 'Overdue' },
  { state: 'soon', label: 'Due soon' },
  { state: 'ok', label: 'Upcoming' },
  { state: 'reference', label: 'Reference only (no schedule)' },
];

function drawCareList(body, rows, markDone) {
  for (const { state, label } of CARE_SECTIONS) {
    const group = rows.filter((r) => r.status.state === state);
    if (!group.length) continue;
    body.appendChild(h(`<div class="care-sech ${state}">${CARE_EMOJI[state]} ${esc(label)} <em>${group.length}</em></div>`));
    for (const row of group) body.appendChild(careRow(row, markDone));
  }
}

function careRow(row, markDone) {
  const { item, listId, listName, status } = row;
  const m = item.maintenance || {};
  const nPhotos = (item.photos || []).length;
  const thumb = nPhotos
    ? `<span class="care-thumb"><img src="${esc(item.photos[0])}" alt="">${nPhotos > 1 ? `<span class="thumb-count">${nPhotos}</span>` : ''}</span>`
    : `<span class="care-thumb ph ${status.state}">${CARE_EMOJI[status.state]}</span>`;
  const bits = [esc(listName)];
  if (item.storage) bits.push(`📍 ${esc(item.storage)}`);
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
    body.appendChild(h(`<div class="cal-overdue">🔴 ${overdue.length} item${overdue.length === 1 ? '' : 's'} overdue — see the <b>List</b> view to catch up.</div>`));
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
        <p class="hint">Three words to keep straight: a <b>Template</b> is a reusable building block (Swim, Run, Travel, Golf…); an <b>Event</b> is one specific trip that combines templates; the <b>Packing List</b> is the single merged list that Event produces — the one you actually pack from.</p>

        <h3>Building blocks: templates</h3>
        <p>Under the <b>Templates</b> tab your reusable templates are grouped three ways:</p>
        <ul>
          <li><b>GA — Goal Activity:</b> the activities that matter — Travel, Golf, Hiking, Diving…</li>
          <li><b>WET — Workout, Exercise &amp; Training:</b> Swim, Bike, Run, Strength, Yoga/Mobility, Breath work.</li>
          <li><b>OE — Other Events:</b> small nice things (a coffee, a winter bath, a walk).</li>
        </ul>
        <p>Open a template to add or edit its items. Each item carries a Swedish alias shown as a subtitle, so your original wording is never lost. At the top of a template’s item list sit <b>quick-filter chips</b> — <b>💧 Liquids</b>, <b>⚡ Charging</b>, <b>⚠️ Restricted</b>, <b>🧰 Has care</b>, <b>📷 Photo</b> — so you can isolate one kind of thing within that list (tap several to combine; <b>Show all</b> clears). Only the categories present in that template appear, each with a count. The same chips are on the Care tab’s <b>All items</b> index for filtering across every template at once.</p>
        <p><b>Sections.</b> A template can be split into named <b>sections</b> to give a clear overview — for a Diving list, say <b>Lights</b>, <b>Rig</b>, <b>Drysuit-related</b>, <b>Regulators</b>. Use the <b>Sections</b> button on a template to add, rename, reorder or delete them, then set an item’s section in its editor under <b>“② In this list”</b>. The list then shows counted section blocks in your chosen order, with anything unassigned under <b>Ungrouped</b>. A section is remembered <b>per template</b>, so the same item can sit in different sections in different lists. Sections also flow onto a trip’s Packing List — pick <b>Section</b> in the trip’s <b>Group by</b> row (it appears once a trip has any sectioned items); same-named sections from different lists merge, and unsectioned items gather under <b>Everything else</b>.</p>

        <h3>Anatomy of an item</h3>
        <p>Every item has three organising dimensions and a set of flags &amp; conditions:</p>
        <ul>
          <li><b>Category</b> (what it is), <b>Container</b> (which bag it goes in), <b>Phase</b> (when to pack it — see the timeline below).</li>
          <li><b>Reminder</b> vs item: a reminder is a to-do prompt (e.g. “charge the Garmin”), not a physical thing to tick off.</li>
          <li><b>Flags:</b> ⚡ needs charging (with an optional <b>charge type</b> — USB-C, USB-A, Lightning, special charger… shown on the badge, e.g. ⚡ USB-C, so you know which cables to bring), short-home-list, 💧 liquid/gel (100 ml rule), ⚠️ restricted — think before packing (battery / carry-on rules), <b>per-night</b> (quantity scales with trip length), and a <b>weight</b> in grams.</li>
          <li><b>Conditions</b> — “only include when…”: Season, Context (Indoor/Outdoor/Race — applies to <b>Workout / Exercise (WET)</b> lists only), Transport (Car/Plane/RV), Catering, and <b>Weather</b> (see below). A blank condition means “always applies”.</li>
          <li><b>Sub-items:</b> optional nested things bundled under one line.</li>
          <li><b>In these templates</b> — a tick-box list of <b>every template</b>. Ticking one <b>adds this item to it</b> and unticking <b>removes it</b> (applied when you Save), so a new hat can join Travel, Golf and Hiking in a few taps. The template you’re editing in stays ticked and locked. Each item lives <b>once</b> and every template simply points to it — so <b>editing an item (its name, category, weight, flags or care) updates it in every template it belongs to</b>, and it still appears just once in <b>Care</b>. Only the <b>list-specific</b> choices stay separate per template: which <b>bag</b> it goes in, <b>when</b> to pack it, and its <b>conditions</b>. Items that are in <b>no</b> template show a <b>⚠️ No template</b> flag.</li>
        </ul>

        <h3>Loose items — things not in a template yet</h3>
        <p>You don’t have to file an item into a template just to keep it. At the top of the <b>Templates</b> tab there’s a <b>Loose items</b> card — a holding place for anything you want to jot down before you’ve decided where or when to pack it. Open it and use <b>Add several</b> to type or paste a whole batch (<b>one item per line</b>), or <b>Add item</b> for a single one. Loose items are <b>never</b> added to a trip and never appear in the activity picker; they simply wait. When you’re ready, open a loose item and tick a template under <b>In these templates</b> — it’s filed there and <b>automatically drops out</b> of the Loose items list. Anything still loose (here or in the Care tab’s <b>All items</b>) carries a <b>⚠️ No template</b> flag so it’s never quietly forgotten.</p>

        <h3>Containers — your bags as objects</h3>
        <p>Your <b>bags, duffels and backpacks</b> live in their own catalogue, reached from the <b>Care</b> tab → <b>🎒 Containers</b>. Each one is edited like any item — photos, colour, brand, where it’s stored and its care record — plus <b>Capacity</b> (litres) and <b>Max weight</b> (kg). Containers never appear as packing items or activities; instead they power two things: every container is offered when you choose <b>where an item is packed</b>, and a trip’s <b>Bags &amp; weight</b> panel warns you against <b>each bag’s own max weight</b>. Their upkeep shows on the Care tab like anything else. The list comes pre-seeded with your usual bags — all editable.</p>

        <h3>All items · table (the spreadsheet)</h3>
        <p>For fast bulk edits, the <b>Care</b> tab → <b>▦ All items · table</b> shows every item as a row in a wide, editable grid, with columns grouped like an item’s editor: <b>the item itself</b> (weight, storage, flags, colour…), <b>in this list</b> (qty/section), and a <b>tick-box per template</b>. Edit a cell and the item updates <b>everywhere</b>; tick a template box to file the item in or out. Qty/Section are editable when an item is in one template. The name column stays pinned as you swipe sideways; a search box narrows the rows. Great on a bigger screen.</p>
        <p>A toolbar above the grid bends the table to how you work: <b>Sort</b> the whole thing by <b>Name</b>, <b>Weight</b>, <b>Storage</b>, <b>Container</b> or <b>how many lists</b> an item is in, with a <b>▲/▼</b> button to flip the direction; and a <b>Columns</b> button opens a panel to <b>reorder the “item itself” columns</b> into the order you like. Both your <b>sort choice</b> and your <b>column order</b> are remembered on this device, so the table opens just how you left it.</p>

        <h3>Places visited (the world map)</h3>
        <p>The <b>Events</b> tab → <b>🌍 Map</b> button opens a <b>world map of everywhere you’ve been</b>. Every trip that has a <b>destination</b> set becomes a pin; <b>repeat visits to the same place merge into one pin</b> with a small count, and pins are ordered most-recent-first in the list beneath. <b>Tap a pin</b> to highlight and scroll to that place in the list, where each visit links to its trip. The map <b>opens framed on the places you’ve visited</b> (rather than the whole globe), and you can <b>zoom</b> for a closer look — use the small <b>＋ / − / ⤢</b> buttons in the corner (the <b>⤢</b> re-frames everything), a <b>trackpad pinch</b> or <b>⌘-scroll</b>, or a <b>double-click</b> (pinch and double-tap work on a phone too) — then <b>drag</b> to move around; this keeps trips that sit close together from overlapping into one dot. A place is pinned automatically once its <b>weather</b> has been looked up; for trips whose destination hasn’t been located yet, the <b>“Find places on the map”</b> button geocodes them all at once (this needs the internet) and caches each spot so the map then works fully <b>offline</b>. The map is drawn inside the app from open geographic data — no outside map service, and nothing about your trips leaves the device.</p>
        <p>Two finishing touches: your trips are joined by a <b>subtle dotted line in date order</b> (oldest → newest) so you can trace your travels over time — undated trips keep their pin but sit off the line — and a small <b>★ “most visited” badge</b> at the top names the place you’ve been most, appearing once anywhere has more than one visit.</p>

        <h3>The timeline (phases)</h3>
        <p>Items are packed in stages, in this order: <b>Preparations</b> (book/cancel/charge, done ahead) → <b>≥1 week ahead</b> (things you don't use at home) → <b>Day before</b> (stage / move to the RV) → <b>Morning of</b> → <b>At the front door</b> (last check as you leave) → <b>Wear / carry</b> on the day → <b>After / recovery</b> (shower, change, recovery).</p>

        <h3>Getting around</h3>
        <p>Six tabs along the bottom:</p>
        <ul>
          <li><b>Home</b> — the builder for starting a new trip, plus a compact preview of your few most recent events.</li>
          <li><b>Events</b> — every event you've made, grouped <b>Upcoming</b> → <b>No date set</b> → <b>Past trips</b>, with the nearest trip on top. Home's “See all” link lands here. The <b>🌍 Map</b> button up top opens the <b>Places visited</b> world map (see below).</li>
          <li><b>Templates</b> — your reusable templates (the building blocks).</li>
          <li><b>Care</b> — everything that needs looking after, as an urgency-ordered list or a month calendar (see <b>Care, storage &amp; maintenance</b> below).</li>
          <li><b>Actions</b> — your to-do list (the red tab): everything you need to <em>do</em>, not just pack, whether it belongs to a specific item or stands on its own (see <b>Actions — your to-do list</b> below).</li>
          <li><b>Settings</b> — <b>Maintenance mode</b> (the whole-database overview), backup/restore, trip import, this guide and the version history.</li>
        </ul>

        <h3>Colour tells you where you are</h3>
        <p>The whole interface — buttons, tabs, chips, progress bars — shifts colour to signal which stage of the flow you're in, so a glance tells you what you're doing:</p>
        <ul>
          <li><b style="color:#4f68d0">Indigo — Defining:</b> building a trip on Home, or editing a trip's settings.</li>
          <li><b style="color:#127a8a">Teal — Looking:</b> viewing a trip's packing list (the default).</li>
          <li><b style="color:#c07d1e">Amber — Adding:</b> whenever an item editor is open.</li>
          <li><b style="color:#2f9e63">Green — Packing:</b> the focused Packing Mode.</li>
        </ul>

        <h3>Creating a trip</h3>
        <p>The <b>Home</b> tab is the builder. Set the trip's conditions, tick any <b>extra activities</b> you're doing, and press <b>Create Event</b> — it generates an editable Event (with its own Packing List) that then lives under the <b>Events</b> tab.</p>
        <ul>
          <li><b>Name, start date, end date, destination</b> (end date and destination are optional). You give the <b>end date</b> — the return day — rather than counting nights yourself; the app works out the nights and shows them live below the dates.</li>
          <li><b>Time of year, catering, context</b> narrow the list; the <b>nights between your start and end date</b> drive per-night quantities (e.g. socks ×6 for six nights).</li>
          <li>The <b>start date</b> also decides where a trip sorts on Home and the Events tab — nearest upcoming first, then undated drafts, then past trips.</li>
        </ul>

        <h3>Where the packing list comes from <em>(three sources)</em></h3>
        <p>Every trip's list is built from three sources — you never start from a blank page, and you never have to remember the basics:</p>
        <ul>
          <li><b>1. Your common base — always included.</b> There's one always-on base template (currently named <b>“Travel”</b>) holding everything you need on <em>any</em> trip: clothes, toiletries, documents, everyday electronics and chargers. It's added to every Packing List automatically, so you can't forget your underwear because you picked the wrong option. You never tick it; to change what's in it, edit the <b>Travel</b> template in the <b>Templates</b> tab.</li>
          <li><b>2. Your transport's own kit — added by the “Way of transport” radio.</b> Each of <b>Car / Plane / RV</b> has its own base template, and picking one <b>automatically pulls its whole kit in</b>. Choose <b>RV</b> and the full motorhome kit (levelling chocks, water hose, gas, awning, kitchen…) comes along — no extra step, no separate tick. <b>Plane</b> adds the carry-on-rules stuff (liquids bag, travel documents, power bank / spare batteries that must fly in the cabin); <b>Car</b> adds a few road extras (car charger, phone mount, snacks). Each is editable in the <b>Templates</b> tab, so you can grow them over time. This replaces the old “Start from” shortcut: the transport radio <em>is</em> the shortcut now.</li>
          <li><b>3. The extra activities you tick.</b> Under <b>Extra activities to pack for</b> you tick your <b>GA</b> (Goal Activity — Golf, Hiking, Diving…) and <b>WET</b> (Workout, Exercise &amp; Training — Swim, Bike, Run…) templates. Only these need ticking; the base and transport templates are already in, which is why they don't appear in that picker.</li>
        </ul>
        <p>So a plain RV holiday needs <em>zero</em> ticks — just pick <b>RV</b> — and you get the common base + the whole RV kit. Add a round of golf by ticking <b>Golf</b>, and its clubs and shoes join the same list.</p>

        <h3>Full trip vs. Quick activity</h3>
        <p>At the top of the builder is a <b>List type</b> switch, because sometimes you don't want a whole trip — you just want to grab a bag for one activity:</p>
        <ul>
          <li><b>🧳 Full trip</b> <em>(default)</em> — the three sources above: common base + transport kit + the activities you tick. For real trips.</li>
          <li><b>⏱️ Quick activity</b> — <b>only the activities you tick</b>, with <b>no common base and no transport kit</b>. The transport and catering choices disappear because they don't apply. Tick <b>Swim</b> (or <b>Run</b>, or both) and you get just those 5–20 items — perfect for “I'm off for a swim.” Set <b>Context</b> to <b>Indoor</b> or <b>Outdoor</b> to trim it further (e.g. an outdoor run adds a headlamp and sunscreen; indoor doesn't). Quick events show a small <b>⏱️ Quick</b> tag on their card.</li>
        </ul>

        <h3>How the Packing List is composed</h3>
        <p>The Event takes the union of every item from the sources for your chosen <b>List type</b> — a <b>Full trip</b> uses common base + transport template + ticked activities; a <b>Quick activity</b> uses only the ticked activities — then drops anything whose conditions (season, catering, context) don't match the trip, and de-duplicates by name + container (earlier sources win a clash, so the common base takes priority). Weather-conditional items are held back (see below). The result is your editable <b>Packing List</b> — add, edit, tick, or remove any line.</p>

        <h3>Reading &amp; organising the list</h3>
        <ul>
          <li><b>Group by</b> When / Where / Category — same list, several lenses — plus <b>GA</b> and <b>WET</b> (each appears once a trip packs for that kind of activity), which group the list by the <em>activity each item came from</em>: pick <b>GA</b> to see <b>Golf, Hiking, Diving…</b> each in their own block, or <b>WET</b> for <b>Swim, Bike, Run…</b>, so you can round up one activity's kit at once — everything not specific to that activity (your common base, transport kit, other activities and hand-added items) gathers under <b>Everything else</b>. There's also <b>Section</b> (once a trip has sectioned items) and <b>Stored</b> (once items have a storage place), which groups by <em>where each thing lives at home</em> so you can empty one cupboard at a time. <b>Tap any group heading to fold it shut</b> (and again to reopen) — handy for hiding a bag you've finished packing; each heading shows a <b>packed/total</b> count.</li>
          <li><b>Sort out</b> — quick filters above the list isolate all <b>💧 Liquids</b> (for the wash bag / 100 ml rule) or all <b>⚡ Charge</b> items (to round up cables and chargers). Tap a chip to show only those; tap <b>Show all</b> to bring the full list back. Ticking and editing work the same in the filtered view. Mark an item as a liquid or charge item with the 💧 / ⚡ toggles in its editor.</li>
          <li><b>🪨 Heaviest</b> — reorders the list heaviest-first with each item’s weight shown, so when a bag is over its limit you can see at a glance what to leave behind. It uses the real load (weight × quantity, including per-night scaling); items without a weight sit at the bottom. Combine it with a Liquids/Charge filter to rank just those. Add a weight to an item in its editor to make it count.</li>
          <li><b>Tap an item</b> to open a quick editor for this trip’s bits (Qty, Category, Container, When, weight, flags, note). For the item’s deeper settings — conditions, which templates it’s in, storage &amp; maintenance — tap <b>Edit the full item</b> to jump straight into the full item editor, then use Back to return to your trip. If the item was only added to this one trip, the same button offers to <b>add it to a template first</b> (you pick which) so it’s saved for reuse — then opens its full editor.</li>
          <li>Badges show flags at a glance; quantities marked per-night show the scaled count (e.g. Socks ×6 for a 6-night trip).</li>
          <li><b>Regenerate</b> refreshes the Packing List from your templates while keeping your ticks, edits and manually-added items.</li>
        </ul>

        <h3>Bags &amp; weight</h3>
        <p>The <b>Bags &amp; weight</b> panel totals each container's weight against typical airline limits (carry-on 8 kg, checked 23 kg…), warns when a bag is over, and counts 💧 liquids and ⚠️ restricted items. Totals only cover items you've given a weight.</p>

        <h3>Care, storage &amp; maintenance</h3>
        <p>Every item can carry a few extra things about the <em>physical object</em>, set in its editor (in the <b>Templates</b> tab) — its <b>photos sit right beside the item name</b>, while where it's stored and how to look after it live in the <b>Storage &amp; maintenance</b> panel below:</p>
        <ul>
          <li><b>Where it's stored</b> — pick the item's home from a <b>dropdown</b> of places (Bedroom wardrobe, Garage, Loft / attic, Storage box, RV / camper…), or choose <b>＋ Add a new place…</b> to type your own. It shows on the item, travels onto any trip it lands in, and appears in <b>Packing Mode</b> with a 📍 pin so you know exactly where to grab it. Manage the whole list — add, <b>rename</b> or remove places — under <b>Storage places</b> in <b>Settings</b>.</li>
          <li><b>Photos</b> (beside the name) — snap or pick <b>up to ${MAX_PHOTOS} pictures</b> of the item; each is shrunk and stored <b>on your device</b> (never uploaded). Tap a thumbnail to enlarge it, or the ✕ to remove it. Handy to recognise the right gear — the first one shows as a thumbnail in the Care list, with a small count when there's more than one.</li>
          <li><b>Maintenance</b> — how and how often to look after it: a <b>maintenance cadence</b> (monthly … every 2 years, or a custom number of days), when it was <b>last done</b>, free-text <b>how-to notes</b> (steps, products, settings), and a <b>how-to link</b>. Tap <b>Log done today</b> to record a service — it resets the schedule and adds a dated entry to the item's maintenance history.</li>
          <li><b>Details &amp; ownership</b> (a second panel, all optional) — record what the thing <em>is</em> and who owns it: <b>colour</b>, <b>size</b> and <b>manufacturer</b> (dropdowns that grow as you use them, or “＋ Add new…”), <b>model</b>, <b>owner</b>, <b>condition</b>, <b>quantity owned</b>, <b>price</b> + <b>currency</b>, a <b>purchase / reorder link</b>, and the <b>acquired</b>, <b>warranty-until</b> and <b>expiry / replace-by</b> dates. Since each item lives once in the catalog, these belong to the item itself — set once, the same everywhere it appears.</li>
          <li><b>🚫 Not in use</b> (in the same panel) — tick this to <b>retire</b> an item you no longer pack (sold, broken, destroyed, replaced or lost — pick the <b>reason</b> from the dropdown). The item is <b>kept exactly as it is</b> — photos, care record, history and template memberships all stay — but it is <b>never added to a new trip</b>, so old gear stops cluttering your packing lists. It still appears in your template and Care lists, <b>greyed out</b> with a <b>🚫 Not in use</b> tag, and the new <b>🚫 Not in use</b> filter chip rounds them all up. (This is different from <b>Condition</b>: “Needs replacing” is a thing you still pack; “Not in use” is one you’ve stopped packing.) Trips you’ve already built are left untouched.</li>
        </ul>
        <p>The <b>Care</b> tab then gathers everything with care info across all your lists, two ways:</p>
        <ul>
          <li><b>List</b> — grouped by urgency: <b>🔴 Overdue</b>, <b>🟡 Due soon</b> (within three weeks), <b>🟢 Upcoming</b>, and <b>🧰 Reference only</b> (care notes but no schedule). Each row shows the photo, where it's stored and when it's next due; tap it to read the how-to notes, open the how-to link, and see its maintenance history. Hit <b>✓ Done</b> to log a service in one tap.</li>
          <li><b>Calendar</b> — a month view with each scheduled service on its due date, colour-coded by urgency and dotted with a count; tap a day to see (and tick off) what's due. Overdue items are flagged above the grid.</li>
        </ul>
        <p>Only items you give care info to appear in those two views — your everyday clothes and toiletries stay out of it. When something's overdue or due soon, a <b>🧰 reminder</b> also shows on the <b>Home</b> screen.</p>
        <p>Below that sits <b>All items</b> — a searchable index of <b>every item in every template</b>. Type a name (or a storage place) to filter, then tap a result to jump <b>straight into that item's editor</b> with its <b>Storage &amp; maintenance</b> panel already open — the quickest way to add or update care info without hunting through the Templates tab. Under the search box, <b>quick-filter chips</b> let you isolate a whole category at once — <b>⚠️ No template</b> (loose items), <b>💧 Liquids</b>, <b>⚡ Charging</b>, <b>⚠️ Restricted</b>, <b>🧰 Has care</b>, <b>📷 Photo</b> and <b>🚫 Not in use</b>; tap several to combine them, and keep typing to narrow further. The <b>＋ New item</b> button creates an item in any template you pick — or choose <b>“No template · keep as a loose item”</b> to drop it straight into the Loose items bin — and takes you into editing it right away.</p>

        <h3>Actions — your to-do list</h3>
        <p>The <b>Actions</b> tab (the red one in the bottom bar) is a proper <b>to-do list</b> for the things you need to <em>do</em>, not pack. Actions come in two kinds:</p>
        <ul>
          <li><b>Tied to an item</b> — open any item’s editor (in the <b>Templates</b> tab) and use its <b>Actions · to-dos</b> panel to jot things to do for it: “replace foam tips”, “re-wax the zip”, “charge before the trip”. Because each item lives once in the catalogue, its actions follow it everywhere, and the item’s row shows a small <b>☑ count</b> of its open to-dos.</li>
          <li><b>General (loose)</b> — on the Actions tab tap <b>New</b> to add a to-do that isn’t about any one item (you can still tie it to an item later from that item’s editor).</li>
        </ul>
        <p>Every action can carry a <b>priority</b> (High / Normal), a <b>when</b> (a trip phase like “≥1 week ahead”, or a specific <b>date</b>), and a tick to mark it <b>done</b>. The Actions tab gathers them all in one place — open ones first (High before Normal, soonest first) — with completed ones tucked into a collapsible <b>Done</b> group. Ticking an item’s action done is <b>permanent on that item</b>; it doesn’t reset each trip. Actions live on-device and travel in your <b>JSON backup</b>, and whenever anything is open a <b>🗒️ “To-dos to tackle”</b> card appears on the <b>Home</b> screen.</p>

        <h3>Countdown &amp; “pack now” nudges</h3>
        <p>With a start date set, each event shows a countdown, and a ⏰ banner surfaces the earliest phase that's due (based on how many days each phase is normally packed before departure). The <b>Home</b> screen also gathers a small set of reminder cards whenever they apply: the trip <b>⏰</b> pack-now nudge, a <b>🧰</b> maintenance nudge when gear is overdue or due soon, a <b>🗒️ “To-dos to tackle”</b> card counting your open actions (and calling out how many are high-priority), and a <b>💾</b> backup reminder when it’s been a while since your last export. These are on-open reminders — the app can't push background notifications.</p>

        <h3>Packing Mode</h3>
        <p>A focused, full-screen flow that walks you through one phase at a time with big tap-to-pack rows, live counters, and an “All packed 🎒” finish. It opens at the first phase that still has unpacked items and shares tick state with the Packing List.</p>

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

        <h3>Your data &amp; privacy</h3>
        <p>Everything lives <b>on this device</b> (IndexedDB) and the app works fully offline as an installed PWA. The only thing that ever leaves your device is the weather lookup: when you tap Get forecast, the destination and its coordinates go to Open-Meteo to fetch the forecast — nothing else, and only then.</p>
        <p><b>Keeping it safe.</b> Because the data lives in the browser, protect it three ways: <b>(1) Install the app</b> — iPhone: Share → <b>Add to Home Screen</b>; Mac: File → <b>Add to Dock</b> — installed apps get protected storage that isn’t auto-deleted. <b>(2)</b> The app also asks the browser to mark its storage <b>persistent</b> on launch, and shows in <b>Settings → Your data</b> whether that’s active. <b>(3) Back up regularly</b> — <b>Settings → Export backup (JSON)</b> saves a file you own; keep it in Files / iCloud Drive, and use <b>Import backup</b> to restore. The file is <b>complete</b>: every item detail and <b>photo</b>, all templates and trips, and your custom <b>Storage places</b>. The app remembers your last backup and gives a gentle <b>💾</b> reminder on the Home screen when it’s been a while. A backup file is the real insurance if a browser ever clears its data, and it’s also how you move your data to another device or web address.</p>

        <h3>Maintenance mode — the whole-database overview</h3>
        <p>At the top of <b>Settings</b>, <b>🗂️ Maintenance mode — database overview</b> opens a single <b>one-line-per-item</b> table of your <b>entire catalogue</b> — the quickest way to keep everything current without hopping between templates. Each row shows the <b>item</b> (with its category and any Swedish wording), <b>which templates it belongs to</b> (tap a template name to jump there), its <b>flags</b> — <b>⚡</b> charging (and the plug type), <b>💧</b> liquid, <b>⚠️</b> restricted, <b>🌙</b> per-night, <b>⭐</b> short list, <b>🧰</b> care, <b>📷</b> photo, <b>🚫</b> not in use — plus its <b>weight</b> and <b>where it’s stored</b>. <b>Tap any row</b> to open that item’s editor. <b>Search</b> by item, template or storage; use the same <b>category chips</b> from the Care tab to narrow; and <b>sort</b> by <b>A–Z</b>, <b>Heaviest</b>, <b>Most used</b> (in the most templates) or <b>Category</b>. The page also <b>finds probable duplicates</b> — same or very similar names (e.g. “Sunglasses” and “Sun glasses”) — listing them in a <b>⚠️ Possible duplicates</b> panel and highlighting them in the table; it never merges anything for you, so you can open each and rename or remove as you see fit. <b>Export (Excel)</b> saves the whole overview as a spreadsheet for review on a computer.</p>

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
      'A new <b>spreadsheet view</b> of every item, reached from the <b>Care</b> tab → <b>▦ All items · table</b>. Each row is an item; the columns are grouped just like an item’s editor: <b>① the item itself</b> (weight, storage, 💧/⚡/⚠️ flags, container, colour, size, maker, model), <b>② in this list</b> (qty, section), and <b>③ a tick-box per template</b> showing which lists the item is in. <b>Edit right in the grid:</b> type a weight or storage place, tick a flag, and it updates the item <b>everywhere it’s used</b>; tick or untick a template box to <b>file the item in or out</b> of that list on the spot (unticking an item’s last list parks it safely in <b>Loose items</b> rather than deleting it). The <b>qty</b> and <b>section</b> columns are per-list, so they’re editable when an item lives in a single template and show “<b>N lists</b>” (tap the name to open it) when it’s shared. There’s a <b>search box</b> to filter to a few rows, the <b>item name stays pinned</b> on the left, and you <b>swipe sideways</b> for the rest of the columns — so it works on the phone and really shines on an iPad or Mac. Nothing new to learn: it’s the same data as the per-item editor, just all at once for fast bulk tidying.',
      'See and fix your whole kit at a glance — weights, storage places, flags and which templates each thing belongs to — editing many items far faster than opening them one by one.'),
    v('v70', '2026-08-06 · 12:00 UTC', false, 'Maintenance mode — a whole-database overview, with duplicate spotting',
      'A new <b>Maintenance mode</b> in <b>Settings</b> (tap <b>🗂️ Maintenance mode — database overview</b> at the top) gives you a single, <b>one-line-per-item</b> table of your <b>entire catalogue</b> — the fastest way to keep everything current in one place. Each row shows the <b>item</b> (with its category and any Swedish wording), <b>which templates it’s in</b> (tap a template name to jump straight there), its <b>flags</b> at a glance — <b>⚡ charging</b> (with the plug type), <b>💧 liquid</b>, <b>⚠️ restricted</b>, <b>🌙 per-night</b>, <b>⭐ short list</b>, <b>🧰 has care</b>, <b>📷 photo</b>, <b>🚫 not in use</b> — plus its <b>weight</b> and <b>where it’s stored</b>. <b>Tap any row</b> to open that item’s editor. A <b>search box</b> filters by item, template or storage; the same <b>category chips</b> from the Care tab narrow it further; and you can <b>sort</b> by <b>A–Z</b>, <b>Heaviest</b>, <b>Most used</b> (in the most templates) or <b>Category</b>. <b>The bonus:</b> the app now <b>hunts for probable duplicates</b> — items with the same or very similar names (it treats “Sunglasses” and “Sun glasses” as a pair) — and surfaces them in a <b>⚠️ Possible duplicates</b> panel at the top, with each highlighted <span style="color:var(--warn)">in amber</span> in the table too. Nothing is ever merged automatically — it just <b>flags</b> look-alikes so you can open each, then rename one or remove the copy you don’t need. There’s also an <b>Export (Excel)</b> button that saves the whole overview as a spreadsheet (one row per item, every flag as a column) for reviewing away from the phone.',
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
  wrap.appendChild(h(`<div class="topbar"><h1>Actions</h1><button class="btn primary" data-new>${IC.plus}<span>New</span></button></div>`));
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
    const list = ALL_ACTIONS.slice().sort(compareActions);
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
// Settings
// ============================================================
async function renderSettings() {
  const wrap = h('<section class="screen"></section>');
  wrap.appendChild(h('<div class="topbar"><h1>Settings</h1></div>'));

  const protectedNow = await storageProtected();
  const dsb = daysSinceBackup();
  const backupStatus = dsb === null
    ? '<b class="warn-txt">No backup saved yet</b> — export one and keep it somewhere safe (Files / iCloud Drive).'
    : dsb === 0 ? 'Last backup: <b>today</b>.'
    : `Last backup: <b>${dsb} day${dsb === 1 ? '' : 's'} ago</b>${dsb >= BACKUP_STALE_DAYS ? ' — <b class="warn-txt">time for a fresh one</b>.' : '.'}`;
  const protectStatus = protectedNow
    ? '🔒 <b>Storage protected</b> — the browser has been asked not to auto-delete your data.'
    : '⚠️ <b>Storage not yet protected</b> — <b>install</b> the app (iPhone: Share → Add to Home Screen; Mac: File → Add to Dock) so your data isn’t auto-deleted, and take regular backups.';

  wrap.appendChild(h(`<a class="care-link" href="#/overview">
    <span class="care-link-ic">🗂️</span>
    <span class="care-link-body"><b>Maintenance mode — database overview</b><span class="care-link-sub">Every item on one line, the templates it’s in, its flags &amp; storage — with look-alikes flagged, so you can keep the whole catalog tidy</span></span>
    <span class="care-link-go">${IC.fwd}</span>
  </a>`));

  const card = h(`<div class="card block">
    <h2>Your data</h2>
    <p class="muted">Everything is stored <b>on this device only</b> — nothing is uploaded. Because it lives in the browser, a saved backup file is your real safety net.</p>
    <p class="data-status">${protectStatus}</p>
    <p class="data-status">${backupStatus}</p>
    <div class="btnrow">
      <button class="btn" data-x="export">Export backup (JSON)</button>
      <button class="btn" data-x="import">Import backup</button>
      <button class="btn" data-x="xlsxall">Export all events (Excel)</button>
    </div>
    <input type="file" accept="application/json,.json" hidden>
  </div>`);
  wrap.appendChild(card);

  const trips = h(`<div class="card block">
    <h2>Shared trips</h2>
    <p class="muted">Someone shared a trip file with you? Import it here to add it as your own event. (Shared links open and import on their own.)</p>
    <div class="btnrow">
      <button class="btn" data-t="importtrip">Import a trip file</button>
    </div>
    <input type="file" accept="application/json,.json" hidden>
  </div>`);
  wrap.appendChild(trips);

  const places = h(`<div class="card block">
    <h2>Storage places</h2>
    <p class="muted">The set of places offered in every item’s <b>Where it’s stored</b> dropdown. Add your own, rename them, or remove ones you don’t use. Renaming carries over to every item already kept there.</p>
    <div class="places-list" data-places></div>
    <div class="btnrow"><button class="btn" data-place="add">${IC.plus}<span>Add a place</span></button></div>
  </div>`);
  wrap.appendChild(places);
  const drawPlaces = () => {
    const box = places.querySelector('[data-places]');
    const locs = loadStorageLocs().sort((a, b) => a.localeCompare(b));
    box.innerHTML = locs.length
      ? locs.map((s) => `<div class="place-row">
          <span class="place-name">${esc(s)}</span>
          <span class="place-acts">
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
    if (add) {
      const name = (prompt('Name of the new storage place:', '') || '').trim();
      if (!name) return;
      if (loadStorageLocs().some((s) => s.toLowerCase() === name.toLowerCase())) { alert(`“${name}” is already in the list.`); return; }
      rememberStorageLoc(name);
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
      removeStorageLoc(name);
      drawPlaces();
    }
  });

  const theme = h(`<div class="card block">
    <h2>Appearance</h2>
    ${radioRow('theme', [{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }], currentTheme())}
  </div>`);
  wrap.appendChild(theme);

  wrap.appendChild(howtoCard());
  wrap.appendChild(versionHistoryCard());

  const about = h(`<div class="card block">
    <h2>About</h2>
    <p class="muted">AMS Packing List — a private, offline packing-list builder. Combine reusable templates into one Packing List per event, organised by when to pack and where it goes.</p>
  </div>`);
  wrap.appendChild(about);

  const file = card.querySelector('input[type=file]');
  card.addEventListener('click', async (e) => {
    const x = e.target.closest('[data-x]')?.dataset.x; if (!x) return;
    if (x === 'export') {
      const json = await db.exportJSON({ prefs: collectPrefs() });
      downloadBlob(new Blob([json], { type: 'application/json' }), `ams-packing-list-backup-${todayISO()}.json`);
      markBackedUp();       // note when we last backed up, to keep the reminder honest
      render();             // refresh the "Last backup" status shown below
    } else if (x === 'import') { file.click(); }
    else if (x === 'xlsxall') { await exportAllEventsXlsx(); }
  });
  file.addEventListener('change', async () => {
    const f = file.files[0]; if (!f) return;
    const text = await f.text();
    const merge = confirm('Import as a MERGE (keep existing data)? Cancel = replace everything.');
    try {
      const res = await db.importJSON(text, { merge });
      if (res.prefs) applyPrefs(res.prefs); // restore storage places / theme / view too
      alert(`Imported ${res.lists} list(s) and ${res.events} event(s).`);
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
  if (it.itemType === 'reminder') b.push('<span class="ov-fl" title="A reminder / to-do, not a packed thing">🗒️</span>');
  if (it.charging) { const s = chargeTypeShort(it.chargeType); b.push(`<span class="ov-fl" title="Needs charging${s ? ' · ' + esc(s) : ''}">⚡${s ? `<em>${esc(s)}</em>` : ''}</span>`); }
  if (it.liquid) b.push('<span class="ov-fl" title="Liquid / gel — 100 ml hand-luggage rule">💧</span>');
  if (it.restricted) b.push('<span class="ov-fl" title="Battery / restricted — carry-on rules">⚠️</span>');
  if (it.perNight) b.push('<span class="ov-fl" title="Quantity scales with the number of nights">🌙</span>');
  if (it.shortList) b.push('<span class="ov-fl" title="On the minimal short list">⭐</span>');
  if (hasCare(it)) b.push('<span class="ov-fl" title="Has care / maintenance info">🧰</span>');
  if ((it.photos || []).length) b.push(`<span class="ov-fl" title="${(it.photos || []).length} photo(s)">📷</span>`);
  if (it.retired) b.push('<span class="ov-fl" title="Not in use — kept on record but never packed">🚫</span>');
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
  if (!row.templates.length) return '<span class="ov-tpl none">⚠️ No template</span>';
  return row.templates.map((t) => {
    if (t.role === 'loose') return '<span class="ov-tpl none">⚠️ No template</span>';
    if (t.role === CONTAINER_ROLE) return `<span class="ov-tpl bag">🎒 ${esc(t.name)}</span>`;
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
        <div class="ov-duphead">${g.exact ? '🔴 Same name' : '🟠 Look-alike'} <em>${g.rows.length}</em></div>
        ${items}
      </div>`;
    }).join('');
    wrap.appendChild(h(`<details class="card block ov-dupes" open>
      <summary><span class="ov-dupes-h">⚠️ Possible duplicates (${dupeGroups.length})</span><span class="ov-dupes-sub">Tap each to compare — then rename one, or remove the copy you don’t need</span></summary>
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
      const swed = it.swedish ? `<span class="ov-swed">${esc(it.swedish)}</span>` : '';
      const rowEl = h(`<div class="ov-row${dup ? ' dupe' : ''}${it.retired ? ' retired' : ''}" data-href="${ovEditHref(r)}">
        <span class="ov-cell ov-item">
          <span class="ov-name">${dup ? '<span class="ov-dupmark" title="Possible duplicate">⚠️</span> ' : ''}${esc(it.name || '(unnamed)')}</span>
          <span class="ov-meta">${cat}${swed}</span>
        </span>
        <span class="ov-cell ov-tpls">${ovTemplateChips(r)}</span>
        <span class="ov-cell ov-flags">${ovFlagBadges(it) || '<span class="ov-dash">—</span>'}</span>
        <span class="ov-cell ov-num ov-weight">${fmtWeight(it.weight) || '<span class="ov-dash">—</span>'}</span>
        <span class="ov-cell ov-stored">${it.storage ? `📍 ${esc(it.storage)}` : '<span class="ov-dash">—</span>'}</span>
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
    return h('<section class="screen"><div class="empty"><p class="empty-t">Trip imported ✓</p><p class="empty-s">Opening it now…</p></div></section>');
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
function collectPrefs() {
  const prefs = { storageLocations: loadStorageLocs(), theme: currentTheme() };
  try { const v = localStorage.getItem(VIEW_KEY); if (v) prefs.view = v; } catch { /* ignore */ }
  return prefs;
}
// Apply prefs from an imported backup. Storage places are UNIONed with what's
// already here, so an import never drops a place you already had.
function applyPrefs(prefs) {
  if (!prefs || typeof prefs !== 'object') return;
  if (Array.isArray(prefs.storageLocations)) {
    saveStorageLocs([...loadStorageLocs(), ...prefs.storageLocations]);
    STORAGES = loadStorageLocs();
  }
  if (typeof prefs.theme === 'string') setTheme(prefs.theme);
  try { if (typeof prefs.view === 'string' && VIEW_MODES.includes(prefs.view)) localStorage.setItem(VIEW_KEY, prefs.view); } catch { /* ignore */ }
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
  if (hash === '#/' || hash === '') return renderHome();
  if (hash === '#/new') { location.replace('#/'); return renderHome(); }
  if (hash === '#/events') return renderEvents();
  if (hash === '#/map') return renderMap();
  if (hash === '#/lists') return renderLists();
  if (hash === '#/maintenance') return renderMaintenance();
  if (hash === '#/containers') return renderContainers();
  if (hash === '#/items') return renderItemsGrid();
  if (hash === '#/actions') return renderActions();
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
    const node = await renderRoute();
    app.innerHTML = '';
    app.appendChild(node);
    setActiveTab();
    applyMode();
    window.scrollTo(0, 0);
  } catch (err) {
    console.error('AMS Packing List: render failed', err);
    app.innerHTML = '';
    app.appendChild(h(`<section class="screen"><div class="empty"><p class="empty-t">Something went wrong</p><p class="empty-s">${esc(err.message || err)}</p></div></section>`));
  } finally { rendering = false; }
}

function setActiveTab() {
  const hash = location.hash || '#/';
  const base = hash.startsWith('#/events') || hash.startsWith('#/event/') || hash === '#/map' ? '#/events'
    : hash.startsWith('#/list') || hash === '#/refine' ? '#/lists'
    : hash.startsWith('#/maintenance') || hash.startsWith('#/containers') || hash.startsWith('#/items') ? '#/maintenance'
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
  if (hash.startsWith('#/maintenance') || hash.startsWith('#/containers') || hash.startsWith('#/items')) return 'care';
  if (hash.startsWith('#/actions')) return 'actions';
  if (hash.startsWith('#/settings') || hash.startsWith('#/overview')) return 'settings';
  return 'home';
}
function applyMode() {
  const s = currentSection();
  if (document.documentElement.dataset.section !== s) document.documentElement.dataset.section = s;
}

window.addEventListener('hashchange', render);

(async function init() {
  // Show the build version in the tab-bar corner marker.
  const verEl = document.querySelector('[data-app-version]');
  if (verEl) verEl.textContent = APP_VERSION;
  // apply saved theme (also handled inline in index.html to avoid a flash)
  const t = currentTheme();
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  await db.ensureSeeded();
  ensurePersistentStorage(); // ask the browser to protect our data (non-blocking)
  await render();
  // Item editors open via partial re-renders (not the router), so watch the
  // app subtree and re-evaluate the accent mode whenever the DOM changes.
  new MutationObserver(applyMode).observe(app, { childList: true, subtree: true });
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('./service-worker.js?v=' + APP_VERSION); } catch { /* offline still works via cache on next load */ }
  }
})();
