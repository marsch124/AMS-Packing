// app.js — screens, navigation and wiring for AMS Packing List.
import {
  CATEGORIES, CONTAINERS, PHASES, PHASE_IDS, phase, phaseLabel, SEASONS, TRANSPORTS, CONTEXTS, DEFAULT_STORAGE_LOCATIONS,
  CATERING, cateringLabel, CHARGE_TYPES, chargeTypeShort, chargeTypeLabel, GROUPS, GROUP_IDS, groupLabel, id, newItem, newList, newEvent,
  buildTotalEntries, regenerateEntries, entriesByPhase, groupByContainer, groupByCategory, groupBy,
  progress, packSteps, totalListRows, applyReview, pruneSuggestions,
  effectiveQty, bagLoads, packingFlags, daysUntil, countdownLabel, tripNudge, nightsBetween, endFromNights,
  buildTripBundle, encodeTripLink, fromBase64Url,
  deriveWeather, weatherSuggestions, weatherGear, WEATHER_CONDITIONS,
  MAINTENANCE_INTERVALS, MAINTENANCE_SOON_DAYS, hasCare, maintenanceStatus, normalizeMaintenance, MAX_PHOTOS,
  maintenanceList, maintenanceSummary, maintenanceByDate, logMaintenance, addDays, daysBetween,
} from './model.js';
import * as db from './db.js';
import * as weather from './weather.js';
import { buildWorkbook, XLSX_MIME } from './xlsx.js';

const app = document.getElementById('app');
// Single source of truth for the shown release. Bump alongside the service-worker
// cache tag and the newest version-history entry.
const APP_VERSION = 'v51';
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

// All building-block lists, kept so the item editor can show which lists an
// item (matched by name) currently appears in. Refreshed whenever a list opens.
let ALL_LISTS = [];
function listsWithItemNamed(name) {
  const key = (name || '').trim().toLowerCase();
  if (!key) return [];
  return ALL_LISTS
    .filter((l) => (l.items || []).some((it) => (it.name || '').trim().toLowerCase() === key))
    .map((l) => ({ id: l.id, name: l.name }));
}

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

// A fresh copy of an item for another template — carries the packing-relevant
// attributes (so a new hat lands with its container, weight, flags, conditions
// and storage intact) but NOT the per-object care record: photos and the
// maintenance schedule stay on the item's home copy so the Care tab doesn't list
// the same thing several times over.
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
  gear: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.1"/><path d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7"/></svg>',
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
};

// Weather glyphs, keyed by the symbolic icon keys model.js emits.
const WIC = {
  sun: '<svg class="wi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>',
  'sun-cloud': '<svg class="wi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 8a4 4 0 0 1 7.5-1.5"/><path d="M4 6.5l-.9-.9M8 3v1M12.5 5.5l.9-.9M2.5 10h1"/><path d="M7 18h10a3 3 0 0 0 0-6 4 4 0 0 0-7.7-1.3A3.2 3.2 0 0 0 7 18Z"/></svg>',
  cloud: '<svg class="wi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18h10a3.2 3.2 0 0 0 .2-6.4A5 5 0 0 0 7.5 10 3.5 3.5 0 0 0 7 18Z"/></svg>',
  fog: '<svg class="wi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9h11a3 3 0 0 0-5.7-1.3A3.4 3.4 0 0 0 6 9Z"/><path d="M4 13h13M6 16h12M8 19h9"/></svg>',
  rain: '<svg class="wi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 14h10a3.2 3.2 0 0 0 .2-6.4A5 5 0 0 0 7.5 6 3.5 3.5 0 0 0 7 14Z"/><path d="M8 18l-1 2M12 18l-1 2M16 18l-1 2"/></svg>',
  snow: '<svg class="wi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 13h10a3.2 3.2 0 0 0 .2-6.4A5 5 0 0 0 7.5 5 3.5 3.5 0 0 0 7 13Z"/><path d="M8 17h.01M12 19h.01M16 17h.01M10 20h.01M14 20h.01"/></svg>',
  storm: '<svg class="wi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 13h10a3.2 3.2 0 0 0 .2-6.4A5 5 0 0 0 7.5 5 3.5 3.5 0 0 0 7 13Z"/><path d="M13 14l-3 4h3l-1 3"/></svg>',
};
const wIcon = (key) => WIC[key] || WIC.cloud;

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
    if (l.role === 'base' || l.role === 'transport' || l.role === 'loose') continue;
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
  const [events, lists] = await Promise.all([db.getEvents(), db.getLists()]);
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
  wrap.appendChild(h('<div class="topbar"><h1>Events</h1><a class="btn primary" href="#/">' + IC.plus + '<span>New</span></a></div>'));
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
    <fieldset data-trip-only><legend>Catering</legend>${radioRow('catering', CATERING.map((c) => ({ value: c.id, label: c.label })), ev.catering)}</fieldset>
    <fieldset><legend>Context <em>(optional — narrows the list)</em></legend>${checkRow('contexts', CONTEXTS, ev.contexts)}</fieldset>

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
const VIEW_MODES = ['when', 'container', 'category'];
function totalView() { try { const v = localStorage.getItem(VIEW_KEY); return VIEW_MODES.includes(v) ? v : 'when'; } catch { return 'when'; } }
function setTotalView(v) { try { localStorage.setItem(VIEW_KEY, v); } catch {} }
let expandedEntry = null; // id of the entry whose inline editor is open
let flagFilter = new Set(); // active "sort out" filters on the Total List: 'liquid' and/or 'charge'
let flagFilterFor = null;   // the event id the filter belongs to (cleared when you switch trips)
let weightSort = false;     // "Heaviest first" ordering toggle on the Total List

async function renderEvent(eventId) {
  const ev = await db.getEvent(eventId);
  if (!ev) { location.assign('#/'); return h('<section></section>'); }
  ALL_LISTS = await db.getLists(); // so an entry can be traced back to its template item
  if (flagFilterFor !== eventId) { flagFilter = new Set(); weightSort = false; flagFilterFor = eventId; } // fresh per trip
  const p = progress(ev.entries);
  const meta = (ev.mode === 'quick'
    ? ['⏱️ Quick', ev.season, ...(ev.contexts || [])]
    : [ev.transport, ev.season, cateringShort(ev.catering), ...(ev.contexts || [])]).filter(Boolean);

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
    <div class="chips">${countChip}${tempChip}${meta.map(chip).join('')}</div>
    <div class="bar big"><span style="width:${p.pct}%"></span></div>
    <div class="ev-prog">${p.done}/${p.total} packed · ${p.pct}%</div>
    ${p.total ? `<a class="btn primary lg pack-cta" href="#/event/${ev.id}/pack">${IC.bag}<span>${p.done >= p.total ? 'All packed ✓' : p.done ? 'Continue packing' : 'Start packing'}</span></a>` : ''}
  </div>`));

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

  const view = totalView();
  const segBtn = (val, label) => `<label class="seg${view === val ? ' on' : ''}"><input type="radio" name="tview" value="${val}"${view === val ? ' checked' : ''}>${label}</label>`;
  const toolbar = h(`<div class="toolbar">
    <span class="toolbar-lbl">Group by</span>
    <div class="segmented small">
      ${segBtn('when', 'When')}${segBtn('container', 'Where')}${segBtn('category', 'Category')}
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

// A collapsible "Bags & weight" panel: per-bag weight vs airline limit, plus liquids/battery counts.
function logisticsSummary(ev) {
  const f = packingFlags(ev.entries, ev.nights);
  const loads = bagLoads(ev.entries, ev.nights).filter((b) => b.grams > 0 || b.limitKg > 0);
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
  const mode = totalView();
  // Secondary sub-grouping: When→by container, Where→by phase, Category→by phase.
  const subOf = mode === 'when'
    ? (entries) => groupByContainer(entries).map((g) => ({ label: g.container || 'Unpacked', entries: g.entries }))
    : (entries) => entriesByPhase(entries).map((g) => ({ label: g.phase.label, entries: g.entries }));

  for (const g of groupBy(mode, entries)) {
    const sec = h(`<div class="group"><div class="group-h"><span class="ph">${esc(g.label)}</span>${g.hint ? `<span class="ph-hint">${esc(g.hint)}</span>` : ''}</div></div>`);
    const subs = subOf(g.entries);
    const showSub = subs.length > 1; // only show sub-headers when they actually split the group
    for (const s of subs) {
      if (showSub) sec.appendChild(h(`<div class="sub">${esc(s.label)}</div>`));
      for (const entry of s.entries) sec.appendChild(entryRow(ev, entry, body));
    }
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
  const mode = totalView();
  // Show the dimensions NOT used as the current grouping, so the row stays informative.
  const subBits = [];
  if (entry.storage) subBits.push(`📍 ${esc(entry.storage)}`);
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
    const templates = lists.filter((l) => l.role !== 'loose');
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
  ed.innerHTML = `
    <label class="field"><span>Item</span><input name="name" value="${esc(entry.name)}"></label>
    <div class="row2">
      <label class="field"><span>Qty</span><input name="qty" value="${esc(entry.qty)}" placeholder="e.g. 2"></label>
      <label class="field"><span>Category</span>${selectHtml('category', CATEGORIES, entry.category)}</label>
    </div>
    <div class="row2">
      <label class="field"><span>Container</span>${selectHtml('container', CONTAINERS, entry.container)}</label>
      <label class="field"><span>When</span>${selectHtml('phase', PHASES.map((p) => ({ value: p.id, label: p.label })), entry.phase)}</label>
    </div>
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
        <div class="pack-phase-t">${esc(step.phase.label)}</div>
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
      if (cg.container) listEl.appendChild(h(`<div class="sub">${esc(cg.container)}</div>`));
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
  const wrap = h('<section class="screen"></section>');
  wrap.appendChild(h(`<div class="topbar">
    <a class="iconbtn" href="#/lists" aria-label="Back">${IC.back}</a>
    <h1 class="grow">${esc(list.name)}</h1>
    ${isLoose ? '' : `<button class="iconbtn" data-rename aria-label="Rename">${IC.edit}</button>
    <button class="iconbtn" data-del aria-label="Delete template">${IC.trash}</button>`}
  </div>`));
  if (isLoose) {
    wrap.appendChild(h(`<p class="muted pad">A holding place for things not in any template yet — add anything here, even if you don’t know where or when you’ll pack it. Open an item and tick a template under <b>In these templates</b> to file it; once it’s in a template it leaves this list.</p>`));
  }
  const groupOpts = [{ value: '', label: '— no group —' }, ...GROUPS.map((g) => ({ value: g.id, label: `${g.id} · ${g.label}` }))];
  wrap.appendChild(h(`<div class="toolbar">
    ${isLoose ? '' : `<label class="inline-field"><span>Group</span>${selectHtml('group', groupOpts, list.group)}</label>`}
    <div class="spacer"></div>
    ${isLoose ? `<button class="btn ghost" data-batch>${IC.list}<span>Add several</span></button>` : ''}
    <button class="btn ghost" data-add>${IC.plus}<span>Add item</span></button>
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

  if (!isLoose) wrap.querySelector('select[name=group]').addEventListener('change', async (e) => {
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
    for (const it of shown) body.appendChild(listItemRow(list, it, () => openItem, (v) => { openItem = v; }, draw));
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

function listItemRow(list, it, getOpen, setOpen, draw) {
  const tags = [it.storage ? `📍 ${it.storage}` : '', it.container, ...(it.seasons || []), ...(it.contexts || []), ...(it.transports || [])].filter(Boolean);
  const chShort = it.charging ? chargeTypeShort(it.chargeType) : '';
  const care = maintenanceStatus(it);
  const badges = `${isUnfiled(it.name) ? '<span class="badge unfiled" title="Not in any template yet — still a loose item">⚠️ No template</span>' : ''}`
    + `${it.charging ? `<span class="badge charge" title="${esc('Needs charging' + (chShort ? ` — ${chargeTypeLabel(it.chargeType)}` : ''))}">⚡${chShort ? ` ${esc(chShort)}` : ''}</span>` : ''}`
    + `${it.liquid ? '<span class="badge liquid" title="Liquid / 100 ml rule">💧</span>' : ''}`
    + `${it.restricted ? '<span class="badge restricted" title="Restricted — think before packing (battery / carry-on rules)">⚠️</span>' : ''}`
    + `${(it.photos || []).length ? `<span class="badge photo" title="${esc((it.photos.length === 1 ? 'Has a photo' : `${it.photos.length} photos`))}">📷${it.photos.length > 1 ? ` ${it.photos.length}` : ''}</span>` : ''}`
    + `${care ? `<span class="badge maint ${care.state}" title="${esc(`Maintenance: ${dueLabel(care)}`)}">${CARE_EMOJI[care.state]}</span>` : ''}`;
  const thumb = (it.photos || []).length ? `<img class="row-thumb" src="${esc(it.photos[0])}" alt="">` : '';
  const row = h(`<div class="entry">
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

function itemEditor(list, it, setOpen, draw) {
  const ed = h('<div class="editor item-editor"></div>');
  STORAGES = collectStorages(ALL_LISTS); // freshest saved + in-use places for the dropdown
  // Care state that can't be read straight back from the DOM on save:
  //  - the photos are held here and only committed to the item on Save (so Cancel discards them),
  //  - the maintenance history log is edited via "Log done" and committed on Save.
  let photos = (it.photos || []).slice();
  const m = it.maintenance || { notes: '', link: '', intervalDays: 0, lastDone: '', log: [] };
  let careLog = (m.log || []).slice();
  const curInterval = m.intervalDays || 0;
  const intervalIsPreset = MAINTENANCE_INTERVALS.some((p) => p.days === curInterval);
  const intervalSel = intervalIsPreset ? String(curInterval) : (curInterval ? 'custom' : '0');
  const intervalOpts = [...MAINTENANCE_INTERVALS.map((p) => ({ value: String(p.days), label: p.label })), { value: 'custom', label: 'Custom…' }];
  const careOpen = hasCare(it) || !!it.storage || photos.length > 0 || careForceOpenItemId === it.id;
  if (careForceOpenItemId === it.id) careForceOpenItemId = null;

  // A tick-box matrix of every template: ticked = this item (matched by name) is
  // in that template. Tick to add it there, untick to remove — applied on Save.
  // The item's own template is always ticked and locked (remove it with the
  // Remove button). The list is built from ALL_LISTS, so it grows on its own as
  // templates are added.
  const memberIds = new Set(listsWithItemNamed(it.name).map((r) => r.id));
  const inListsHTML = (() => {
    // Real templates only — the Loose items bin is where things start, not a
    // place you "file into", so it never appears as a tickable row.
    const rows = ALL_LISTS.filter((l) => l.role !== 'loose').map((l) => {
      const here = l.id === list.id;
      const on = here || memberIds.has(l.id);
      return `<label class="check tmpl-check${on ? ' on' : ''}${here ? ' cur' : ''}">
        <input type="checkbox" name="tmpl" value="${esc(l.id)}"${on ? ' checked' : ''}${here ? ' disabled' : ''}>
        <span>${esc(l.name)}${here ? ' <em>· here</em>' : ''}</span></label>`;
    }).join('');
    return rows || '<p class="inlists-empty">No templates yet.</p>';
  })();

  ed.innerHTML = `
    <div class="item-head">
      <div class="item-photos" data-photos></div>
      <label class="field item-name"><span>Item name</span><input name="name" value="${esc(it.name)}"></label>
    </div>
    <input type="file" accept="image/*" hidden data-care-file multiple>
    <div class="row2">
      <label class="field"><span>Qty</span><input name="qty" value="${esc(it.qty)}" placeholder="optional"></label>
      <label class="field"><span>Container</span>${selectHtml('container', ['', ...CONTAINERS].map((c) => ({ value: c, label: c || '— none (task) —' })), it.container)}</label>
    </div>
    <div class="row2">
      <label class="field"><span>When (phase)</span>${selectHtml('phase', PHASES.map((p) => ({ value: p.id, label: p.label })), it.phase)}</label>
      <label class="field"><span>Weight (g) <em>per unit</em></span><input type="number" name="weight" min="0" inputmode="numeric" value="${it.weight || ''}" placeholder="0"></label>
    </div>
    <div class="checks">
      <label class="check${it.perNight ? ' on' : ''}"><input type="checkbox" name="perNight" ${it.perNight ? 'checked' : ''}>Per night (scales qty)</label>
      <label class="check${it.charging ? ' on' : ''}"><input type="checkbox" name="charging" ${it.charging ? 'checked' : ''}>⚡ Charging</label>
      <label class="check${it.liquid ? ' on' : ''}"><input type="checkbox" name="liquid" ${it.liquid ? 'checked' : ''}>💧 Liquid</label>
      <label class="check${it.restricted ? ' on' : ''}"><input type="checkbox" name="restricted" ${it.restricted ? 'checked' : ''}>⚠️ Restricted</label>
    </div>
    <label class="field charge-type-field${it.charging ? '' : ' hidden'}"><span>Charge type</span>${selectHtml('chargeType', CHARGE_TYPES.map((c) => ({ value: c.id, label: c.label })), it.chargeType)}</label>
    <div class="cond-group">
      <div class="cond-head">Only include this item when…<em>Leave a row untouched and it always applies. Tick options to narrow when this item is added.</em></div>
      <fieldset class="mini"><legend>Season</legend>${checkRow('seasons', SEASONS, it.seasons)}</fieldset>
      <fieldset class="mini"><legend>Context</legend>${checkRow('contexts', CONTEXTS, it.contexts)}</fieldset>
      <fieldset class="mini"><legend>Transport</legend>${checkRow('transports', TRANSPORTS, it.transports)}</fieldset>
      <fieldset class="mini"><legend>Catering</legend>${checkRow('catering', CATERING.map((c) => ({ value: c.id, label: c.label })), it.catering)}</fieldset>
      <fieldset class="mini"><legend>Weather</legend>${checkRow('weather', WEATHER_CONDITIONS.map((w) => ({ value: w.id, label: w.label })), it.weather)}
        <p class="cond-note">Tick a condition and this item is <b>held back until the trip’s forecast calls for it</b> — e.g. tick <b>Rain</b> and it’s only added when rain is forecast. Leave them all unticked and the item is <b>always included</b>, like the rest of the list.</p>
      </fieldset>
    </div>
    <label class="field"><span>Note</span><input name="note" value="${esc(it.note)}"></label>

    <div class="inlists">
      <div class="inlists-h">${IC.list}<span>In these templates</span></div>
      <p class="inlists-hint">Tick a template to add this item to it, untick to remove it. Changes apply when you <b>Save</b>.</p>
      <div class="inlists-matrix">${inListsHTML}</div>
    </div>

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

    <div class="editor-actions">
      <button type="button" class="btn danger ghost" data-x="del">${IC.trash}<span>Remove</span></button>
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

  ed.addEventListener('change', async (e) => {
    if (e.target.type === 'checkbox') e.target.closest('label')?.classList.toggle('on', e.target.checked);
    if (e.target.name === 'charging') $('.charge-type-field', ed)?.classList.toggle('hidden', !e.target.checked);
    if (e.target.name === 'interval') $('.care-custom', ed)?.classList.toggle('hidden', e.target.value !== 'custom');
    if (e.target.name === 'storage-sel') {
      const isNew = e.target.value === '__new__';
      $('.care-newstorage', ed)?.classList.toggle('hidden', !isNew);
      if (isNew) $('input[name=storage-new]', ed)?.focus();
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

  ed.addEventListener('click', async (e) => {
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
      if (!confirm(`Remove “${it.name || 'this item'}” from the ${list.name} template?`)) return;
      list.items = list.items.filter((z) => z.id !== it.id);
      setOpen(null);
      if (await saveGuard(db.saveList(list))) draw();
      return;
    }
    if (x === 'save') {
      const prevName = it.name || ''; // the name before this edit — used to find linked copies to rename
      it.name = ($('input[name=name]', ed).value || '').trim();
      it.qty = ($('input[name=qty]', ed).value || '').trim();
      it.container = $('select[name=container]', ed).value;
      it.phase = $('select[name=phase]', ed).value;
      it.weight = Math.max(0, parseInt($('input[name=weight]', ed).value, 10) || 0);
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
      // Read the "In these templates" matrix now, before the editor is torn down.
      const nameKey = it.name.trim().toLowerCase();
      const prevKey = prevName.trim().toLowerCase();
      const renamed = !!prevKey && prevKey !== nameKey; // the name actually changed
      const wanted = nameKey ? $$('input[name=tmpl]:not([disabled])', ed).map((b) => ({ id: b.value, checked: b.checked })) : [];
      setOpen(null);
      const ok = await saveGuard((async () => {
        await db.saveList(list); // this template, with the edited item
        if (!nameKey) return;
        const all = await db.getLists();
        for (const l of all) {
          if (l.id === list.id) continue;
          const w = wanted.find((x) => x.id === l.id);
          if (!w) continue;
          // A linked copy may live here under the new name or, after a rename, the old one.
          const idxNew = l.items.findIndex((z) => (z.name || '').trim().toLowerCase() === nameKey);
          const idxOld = renamed ? l.items.findIndex((z) => (z.name || '').trim().toLowerCase() === prevKey) : -1;
          let changed = false;
          if (w.checked) {
            if (idxNew >= 0) {
              // Already here under the new name — drop any leftover old-name copy so it isn't duplicated.
              if (idxOld >= 0 && idxOld !== idxNew) { l.items.splice(idxOld, 1); changed = true; }
            } else if (idxOld >= 0) {
              l.items[idxOld].name = it.name; changed = true; // rename the linked copy in place
            } else {
              l.items.unshift(copyItemForTemplate(it, it.name)); changed = true; // add a fresh copy
            }
          } else {
            // Not wanted — remove the linked copy under whichever name it holds.
            const before = l.items.length;
            l.items = l.items.filter((z) => {
              const k = (z.name || '').trim().toLowerCase();
              return k !== nameKey && (!renamed || k !== prevKey);
            });
            changed = l.items.length !== before;
          }
          if (changed) await db.saveList(l);
        }
        // Auto-file: once an item is in at least one real template, it shouldn't
        // linger in the Loose items bin — pull it out.
        const fresh = await db.getLists();
        const filed = fresh.some((l) => l.role !== 'loose' && l.items.some((z) => (z.name || '').trim().toLowerCase() === nameKey));
        if (filed) {
          const loose = fresh.find((l) => l.role === 'loose');
          if (loose && loose.items.some((z) => (z.name || '').trim().toLowerCase() === nameKey)) {
            loose.items = loose.items.filter((z) => (z.name || '').trim().toLowerCase() !== nameKey);
            await db.saveList(loose);
            if (list.role === 'loose') list.items = list.items.filter((z) => (z.name || '').trim().toLowerCase() !== nameKey);
          }
        }
      })());
      if (ok) { ALL_LISTS = await db.getLists(); draw(); }
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
          ...lists.filter((l) => l.role !== 'loose').map((l) => ({ value: l.id, label: l.name })),
          { value: LOOSE_OPT, label: '— No template · keep as a loose item —' },
        ], (lists.find((l) => l.role !== 'loose') || {}).id || LOOSE_OPT)}</label>
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

        <h3>Anatomy of an item</h3>
        <p>Every item has three organising dimensions and a set of flags &amp; conditions:</p>
        <ul>
          <li><b>Category</b> (what it is), <b>Container</b> (which bag it goes in), <b>Phase</b> (when to pack it — see the timeline below).</li>
          <li><b>Reminder</b> vs item: a reminder is a to-do prompt (e.g. “charge the Garmin”), not a physical thing to tick off.</li>
          <li><b>Flags:</b> ⚡ needs charging (with an optional <b>charge type</b> — USB-C, USB-A, Lightning, special charger… shown on the badge, e.g. ⚡ USB-C, so you know which cables to bring), short-home-list, 💧 liquid/gel (100 ml rule), ⚠️ restricted — think before packing (battery / carry-on rules), <b>per-night</b> (quantity scales with trip length), and a <b>weight</b> in grams.</li>
          <li><b>Conditions</b> — “only include when…”: Season, Context (Indoor/Outdoor/Race/Training), Transport (Car/Plane/RV), Catering, and <b>Weather</b> (see below). A blank condition means “always applies”.</li>
          <li><b>Sub-items:</b> optional nested things bundled under one line.</li>
          <li><b>In these templates</b> — a tick-box list of <b>every template</b>. Ticking one <b>adds this item to it</b> and unticking <b>removes it</b> (applied when you Save), so a new hat can join Travel, Golf and Hiking in a few taps. The template you’re editing in stays ticked and locked. The added copies carry the packing details but not the photos or maintenance schedule, so the thing still appears just once in <b>Care</b>. Because linked copies share a <b>name</b>, <b>renaming</b> an item updates it in every template it belongs to. Items that are in <b>no</b> template show a <b>⚠️ No template</b> flag.</li>
        </ul>

        <h3>Loose items — things not in a template yet</h3>
        <p>You don’t have to file an item into a template just to keep it. At the top of the <b>Templates</b> tab there’s a <b>Loose items</b> card — a holding place for anything you want to jot down before you’ve decided where or when to pack it. Open it and use <b>Add several</b> to type or paste a whole batch (<b>one item per line</b>), or <b>Add item</b> for a single one. Loose items are <b>never</b> added to a trip and never appear in the activity picker; they simply wait. When you’re ready, open a loose item and tick a template under <b>In these templates</b> — it’s filed there and <b>automatically drops out</b> of the Loose items list. Anything still loose (here or in the Care tab’s <b>All items</b>) carries a <b>⚠️ No template</b> flag so it’s never quietly forgotten.</p>

        <h3>The timeline (phases)</h3>
        <p>Items are packed in stages, in this order: <b>Preparations</b> (book/cancel/charge, done ahead) → <b>≥1 week ahead</b> (things you don't use at home) → <b>Day before</b> (stage / move to the RV) → <b>Morning of</b> → <b>At the front door</b> (last check as you leave) → <b>Wear / carry</b> on the day → <b>After / recovery</b> (shower, change, recovery).</p>

        <h3>Getting around</h3>
        <p>Five tabs along the bottom:</p>
        <ul>
          <li><b>Home</b> — the builder for starting a new trip, plus a compact preview of your few most recent events.</li>
          <li><b>Events</b> — every event you've made, grouped <b>Upcoming</b> → <b>No date set</b> → <b>Past trips</b>, with the nearest trip on top. Home's “See all” link lands here.</li>
          <li><b>Templates</b> — your reusable templates (the building blocks).</li>
          <li><b>Care</b> — everything that needs looking after, as an urgency-ordered list or a month calendar (see <b>Care, storage &amp; maintenance</b> below).</li>
          <li><b>Settings</b> — backup/restore, trip import, this guide and the version history.</li>
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
          <li><b>Group by</b> When / Where / Category — same list, three lenses.</li>
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
        </ul>
        <p>The <b>Care</b> tab then gathers everything with care info across all your lists, two ways:</p>
        <ul>
          <li><b>List</b> — grouped by urgency: <b>🔴 Overdue</b>, <b>🟡 Due soon</b> (within three weeks), <b>🟢 Upcoming</b>, and <b>🧰 Reference only</b> (care notes but no schedule). Each row shows the photo, where it's stored and when it's next due; tap it to read the how-to notes, open the how-to link, and see its maintenance history. Hit <b>✓ Done</b> to log a service in one tap.</li>
          <li><b>Calendar</b> — a month view with each scheduled service on its due date, colour-coded by urgency and dotted with a count; tap a day to see (and tick off) what's due. Overdue items are flagged above the grid.</li>
        </ul>
        <p>Only items you give care info to appear in those two views — your everyday clothes and toiletries stay out of it. When something's overdue or due soon, a <b>🧰 reminder</b> also shows on the <b>Home</b> screen.</p>
        <p>Below that sits <b>All items</b> — a searchable index of <b>every item in every template</b>. Type a name (or a storage place) to filter, then tap a result to jump <b>straight into that item's editor</b> with its <b>Storage &amp; maintenance</b> panel already open — the quickest way to add or update care info without hunting through the Templates tab. Under the search box, <b>quick-filter chips</b> let you isolate a whole category at once — <b>⚠️ No template</b> (loose items), <b>💧 Liquids</b>, <b>⚡ Charging</b>, <b>⚠️ Restricted</b>, <b>🧰 Has care</b> and <b>📷 Photo</b>; tap several to combine them, and keep typing to narrow further. The <b>＋ New item</b> button creates an item in any template you pick — or choose <b>“No template · keep as a loose item”</b> to drop it straight into the Loose items bin — and takes you into editing it right away.</p>

        <h3>Countdown &amp; “pack now” nudges</h3>
        <p>With a start date set, each event shows a countdown, and a ⏰ banner surfaces the earliest phase that's due (based on how many days each phase is normally packed before departure). These are on-open reminders — the app can't push background notifications.</p>

        <h3>Packing Mode</h3>
        <p>A focused, full-screen flow that walks you through one phase at a time with big tap-to-pack rows, live counters, and an “All packed 🎒” finish. It opens at the first phase that still has unpacked items and shares tick state with the Packing List.</p>

        <h3>Weather (optional, per trip)</h3>
        <p>Add a <b>destination</b> to a trip, then tap <b>Get forecast</b>. The forecast comes from Open-Meteo (free, no account), is cached on the trip so it still shows offline, and only fetches when you ask and you're online.</p>
        <ul>
          <li>A <b>temperature chip</b> in the trip header and a <b>7-day strip</b> with icons and highs/lows; rainy days are highlighted.</li>
          <li><b>Weather-conditional gear:</b> tag an item (in its editor) with Rain / Cold / Heat / Wind / Snow to make it “conditional”. Conditional items are kept <i>out</i> of the normal list and only offered when the forecast calls for them — so your rain suit stops cluttering every trip.</li>
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
        <p>Everything lives <b>on this device</b> (IndexedDB) and the app works fully offline as an installed PWA. Back it up or restore it as JSON from Settings. The only thing that ever leaves your device is the weather lookup: when you tap Get forecast, the destination and its coordinates go to Open-Meteo to fetch the forecast — nothing else, and only then.</p>

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
// Settings
// ============================================================
async function renderSettings() {
  const wrap = h('<section class="screen"></section>');
  wrap.appendChild(h('<div class="topbar"><h1>Settings</h1></div>'));

  const card = h(`<div class="card block">
    <h2>Your data</h2>
    <p class="muted">Everything is stored on this device. Back it up as JSON, or export a spreadsheet.</p>
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
      const json = await db.exportJSON();
      downloadBlob(new Blob([json], { type: 'application/json' }), `ams-packing-list-backup-${todayISO()}.json`);
    } else if (x === 'import') { file.click(); }
    else if (x === 'xlsxall') { await exportAllEventsXlsx(); }
  });
  file.addEventListener('change', async () => {
    const f = file.files[0]; if (!f) return;
    const text = await f.text();
    const merge = confirm('Import as a MERGE (keep existing data)? Cancel = replace everything.');
    try {
      const res = await db.importJSON(text, { merge });
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
  if (hash === '#/lists') return renderLists();
  if (hash === '#/maintenance') return renderMaintenance();
  if (hash === '#/refine') return renderRefine();
  if (hash === '#/settings') return renderSettings();
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
  const base = hash.startsWith('#/events') || hash.startsWith('#/event/') ? '#/events'
    : hash.startsWith('#/list') || hash === '#/refine' ? '#/lists'
    : hash.startsWith('#/maintenance') ? '#/maintenance'
    : hash.startsWith('#/settings') ? '#/settings' : '#/';
  $$('.tabbar a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === base));
}

// Which section we're in — drives the UI accent colour for the whole page.
// Matches the active-tab mapping so the colour and the lit tab always agree.
function currentSection() {
  const hash = location.hash || '#/';
  if (hash.startsWith('#/events') || hash.startsWith('#/event/')) return 'events';
  if (hash.startsWith('#/list') || hash === '#/refine') return 'templates';
  if (hash.startsWith('#/maintenance')) return 'care';
  if (hash.startsWith('#/settings')) return 'settings';
  return 'home';
}
function applyMode() {
  const s = currentSection();
  if (document.documentElement.dataset.section !== s) document.documentElement.dataset.section = s;
}

window.addEventListener('hashchange', render);

(async function init() {
  // apply saved theme (also handled inline in index.html to avoid a flash)
  const t = currentTheme();
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  await db.ensureSeeded();
  await render();
  // Item editors open via partial re-renders (not the router), so watch the
  // app subtree and re-evaluate the accent mode whenever the DOM changes.
  new MutationObserver(applyMode).observe(app, { childList: true, subtree: true });
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('./service-worker.js'); } catch { /* offline still works via cache on next load */ }
  }
})();
