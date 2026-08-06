// model.js — pure domain logic for AMS Packing List.
// No DOM, no storage: just data in, data out. This is the unit-tested core.
//
// Every item carries THREE independent grouping dimensions, so the generated Total
// List can be viewed grouped by whichever the user prefers:
//   1. WHAT kind of thing -> `category`  (one of CATEGORIES)
//   2. WHERE it is packed  -> `container` (one of CONTAINERS)
//   3. WHEN it is packed   -> `phase`     (one of PHASES ids, the "process vector")
// Plus flags: itemType (item | reminder), charging (needs charging / a cable),
// shortList (part of the minimal quick list), and an optional Swedish original + sub-items.
// A Total Packing List for an Event is produced by combining the chosen building-block
// packing lists, filtering each item by the event's season / context / transport / catering.

// --- Fixed vocabularies (all user-extendable at the data level) ---

// WHAT kind of thing it is (primary grouping in Martin's own lists).
export const CATEGORIES = [
  'Clothing', 'Adventure clothing', 'Footwear', 'Sport gear', 'Food & drink',
  'Toiletries', 'Pharmacy / meds', 'Electronics', 'Documents & money',
  'Charging', 'Comfort & misc', 'Reminders',
];
export const CATEGORY_DEFAULT = 'Comfort & misc';

// WHERE things get packed.
export const CONTAINERS = [
  'Toiletry bag', 'Carry-on / hand luggage', 'Checked luggage', 'Hiking backpack',
  'Climbing backpack', 'Golf bag', 'Triathlon bag', 'Swim bag', 'Duffel bag',
  'Day pack', 'Bellroy backpack', 'Tech pouch', 'Electronics bag', 'Cool box',
  'Handbag', 'RV storage box', 'Other',
];

// The built-in "Containers" catalogue: a special list (role 'container') whose
// items ARE the bags/duffels/backpacks themselves, so each one reuses the full
// item machinery — photos, storage, maintenance/care, colour, brand — as a
// maintainable physical object. Kept out of trips and the activity picker.
export const CONTAINER_ROLE = 'container';
export const CONTAINER_LIST_NAME = 'Containers';

// The names offered in an item's "Container" (where it's packed) dropdown: the
// hardcoded defaults MERGED with any real container records the user has created
// (so a newly-added "Osprey 40" bag shows up as a packing destination too), in a
// stable order — defaults first, then extra container names, de-duplicated.
export function containerNames(lists = []) {
  const seen = new Set(CONTAINERS.map((c) => c.toLowerCase()));
  const extra = [];
  for (const l of lists) {
    if (l.role !== CONTAINER_ROLE) continue;
    for (const it of (l.items || [])) {
      const n = (it.name || '').trim();
      if (n && !seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); extra.push(n); }
    }
  }
  return [...CONTAINERS, ...extra];
}

// Typical airline weight ceilings per bag (kg). 0/absent = no limit tracked.
export const CONTAINER_LIMITS_KG = {
  'Carry-on / hand luggage': 8,
  'Checked luggage': 23,
  'Bellroy backpack': 8,
  'Day pack': 8,
};

// WHEN things get packed / done — the process vector, in timeline order.
// kind 'task' phases hold to-dos (Preparations); 'pack' phases hold physical items.
export const PHASES = [
  { id: 'prep',      label: 'Preparations',                 kind: 'task', hint: 'Book, cancel, charge, arrange — done ahead of time.' },
  { id: 'week',      label: '≥1 week ahead',                kind: 'pack', hint: 'Things you don’t use at home — pack early.' },
  { id: 'daybefore', label: 'Day before (stage / move to RV)', kind: 'pack', hint: 'Pack and stage the day before departure.' },
  { id: 'morning',   label: 'Morning list',                 kind: 'pack', hint: 'Packed the morning of — used the night before / that morning.' },
  { id: 'door',      label: 'At the front door',            kind: 'pack', hint: 'Last check as you leave (Vid ytterdörren).' },
  { id: 'wear',      label: 'Wear / carry on the day',      kind: 'pack', hint: 'Worn or carried, not packed away.' },
  { id: 'after',     label: 'After / recovery',             kind: 'pack', hint: 'For after the activity — shower, change, recovery (Efter).' },
];
export const PHASE_IDS = PHASES.map((p) => p.id);
// How many days before departure each phase should typically be packed. Drives the
// "pack this now" nudge: a phase is "due" once days-to-go drops to its lead time.
export const PHASE_LEAD_DAYS = { prep: 30, week: 7, daybefore: 1, morning: 0, door: 0, wear: 0, after: -1 };
export function phase(id) { return PHASES.find((p) => p.id === id) || PHASES[1]; }
export function phaseLabel(id) { return phase(id).label; }
export function phaseOrder(id) { const i = PHASE_IDS.indexOf(id); return i < 0 ? PHASE_IDS.indexOf('week') : i; }

// Activity GROUPS — the top level Martin organises his life activities under.
// Every building-block list belongs to one of these (or '' = ungrouped / utility list).
export const GROUPS = [
  { id: 'GA',  label: 'Goal Activity',                  hint: 'Life activities that matter — Travel, Golf, Hiking, Diving…' },
  { id: 'WET', label: 'Workout, Exercise & Training',   hint: 'Swim, Bike, Run, Strength, Yoga/Mobility, Breath work.' },
  { id: 'OE',  label: 'Other Events',                   hint: 'Small nice things — a coffee, a winter bath, a walk, the movies.' },
];
export const GROUP_IDS = GROUPS.map((g) => g.id);
export function group(id) { return GROUPS.find((g) => g.id === id) || null; }
export function groupLabel(id) { const g = group(id); return g ? g.label : ''; }

export const SEASONS = ['Summer', 'Winter'];
export const TRANSPORTS = ['Car', 'Plane', 'RV'];

// Standard set of "where it's stored" places, offered in every item's storage
// dropdown out of the box. The user can add, rename and remove them (their edited
// list is persisted); this is only the starting point / fallback.
export const DEFAULT_STORAGE_LOCATIONS = [
  'Bedroom wardrobe',
  'Chest of drawers',
  'Hall closet',
  'Bathroom cabinet',
  'Kitchen cupboard',
  'Garage',
  'Loft / attic',
  'Basement / cellar',
  'Utility room',
  'Storage box',
  'Car boot',
  'RV / camper',
];
// Weather conditions an item can be tagged for. A tagged item is "conditional
// gear": kept out of the base list and offered as a suggestion only when the
// trip's forecast calls for it. (Fuller weather logic lives further down.)
export const WEATHER_CONDITIONS = [
  { id: 'rain', label: 'Rain' }, { id: 'cold', label: 'Cold' },
  { id: 'hot', label: 'Heat' }, { id: 'wind', label: 'Wind' }, { id: 'snow', label: 'Snow' },
];
export const WEATHER_CONDITION_IDS = WEATHER_CONDITIONS.map((w) => w.id);
// Context applies ONLY to WET (Workout, Exercise & Training) activity lists — it
// describes how a workout is done (indoors, outdoors, or as a race). It never
// narrows GA / base / transport lists.
export const CONTEXTS = ['Indoor', 'Outdoor', 'Race'];
export const CATERING = [
  { id: 'self',   label: 'Self-sufficient (cooking our own)' },
  { id: 'eatout', label: 'Restaurants / eating out' },
  { id: 'mixed',  label: 'A mix of both' },
];
export function cateringLabel(id) { const c = CATERING.find((x) => x.id === id); return c ? c.label : ''; }

// How a charge item takes power — its connector / charger type. '' = unspecified.
// `short` is the compact label shown on the ⚡ badge in the list.
export const CHARGE_TYPES = [
  { id: '',          label: 'Unspecified',      short: '' },
  { id: 'usb-c',     label: 'USB-C',            short: 'USB-C' },
  { id: 'usb-a',     label: 'USB-A',            short: 'USB-A' },
  { id: 'micro-usb', label: 'Micro-USB',        short: 'Micro' },
  { id: 'lightning', label: 'Lightning (Apple)', short: 'Lightning' },
  { id: 'special',   label: 'Special charger',  short: 'Special' },
  { id: 'mains',     label: 'Wall / mains plug', short: 'Wall' },
];
export const CHARGE_TYPE_IDS = CHARGE_TYPES.map((c) => c.id);
export function chargeType(id) { return CHARGE_TYPES.find((c) => c.id === id) || CHARGE_TYPES[0]; }
export function chargeTypeLabel(id) { return chargeType(id).label; }
export function chargeTypeShort(id) { return chargeType(id).short; }

// Item "condition" — a simple wear/lifecycle rating (optional item metadata).
export const ITEM_CONDITIONS = [
  { id: 'new',    label: 'New' },
  { id: 'good',   label: 'Good' },
  { id: 'worn',   label: 'Worn' },
  { id: 'retire', label: 'Needs replacing' },
];
export const ITEM_CONDITION_IDS = ITEM_CONDITIONS.map((c) => c.id);
// Why an item is "Not in use" (retired from the kit). Distinct from `condition`,
// which grades a thing you still own & pack; a retired item is no longer packed
// at all, but its record is kept. Optional — a plain "not in use" needs no reason.
export const RETIRE_REASONS = [
  { id: 'sold',      label: 'Sold' },
  { id: 'broken',    label: 'Broken / not working' },
  { id: 'destroyed', label: 'Destroyed / worn out' },
  { id: 'replaced',  label: 'Replaced' },
  { id: 'lost',      label: 'Lost' },
  { id: 'other',     label: 'Other' },
];
export const RETIRE_REASON_IDS = RETIRE_REASONS.map((r) => r.id);
export function retireReasonLabel(id) {
  const r = RETIRE_REASONS.find((x) => x.id === id);
  return r ? r.label : '';
}
// Currencies offered for an item's price (the list Martin is likely to use first).
export const CURRENCIES = ['SEK', 'EUR', 'USD', 'GBP', 'CHF', 'NOK', 'DKK'];

// --- ids & small helpers ---

let _seq = 0;
export function id() {
  // Sortable-ish, collision-resistant enough for a personal on-device app.
  return `${Date.now().toString(36)}-${(_seq++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
const asArray = (v) => (Array.isArray(v) ? v : []);
const nowISO = () => new Date().toISOString();
export const normName = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
// A calendar date in YYYY-MM-DD form (the shape all care dates are stored in).
const isYMD = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const todayYMD = (todayISO) => (todayISO || new Date().toISOString()).slice(0, 10);

// --- Shape guards (applied when reading from storage) ---

// How many photos a single item may hold — keeps the editor tidy and bounds
// how large an exported/shared trip bundle can grow.
export const MAX_PHOTOS = 5;

export function coerceItem(it) {
  if (!it || typeof it !== 'object') return it;
  it.seasons = asArray(it.seasons);
  it.contexts = asArray(it.contexts);
  it.transports = asArray(it.transports);
  it.catering = asArray(it.catering);
  it.weather = asArray(it.weather).filter((w) => WEATHER_CONDITION_IDS.includes(w)); // conditional-gear tags
  it.sub = asArray(it.sub);
  if (!PHASE_IDS.includes(it.phase)) it.phase = 'week';
  if (typeof it.category !== 'string' || !it.category) it.category = CATEGORY_DEFAULT;
  it.itemType = it.itemType === 'reminder' ? 'reminder' : 'item';
  it.charging = !!it.charging;
  it.chargeType = CHARGE_TYPE_IDS.includes(it.chargeType) ? it.chargeType : ''; // connector type (USB-C…); only meaningful when charging
  it.shortList = !!it.shortList;
  if (typeof it.swedish !== 'string') it.swedish = '';
  it.stats = normalizeStats(it.stats);
  it.weight = Number.isFinite(it.weight) && it.weight >= 0 ? it.weight : 0;  // grams per unit, 0 = unknown
  it.liquid = !!it.liquid;        // liquid / gel — 100 ml hand-luggage rule
  it.restricted = !!it.restricted; // battery / restricted — carry-on rules
  it.perNight = !!it.perNight;    // quantity scales with trip length (nights)
  // Per-template grouping. On a resolved item this holds a SECTION ID (pointing at
  // its template's `sections`); on a trip line it holds the section's DISPLAY NAME
  // (resolved from the source template, so same-named sections merge across lists).
  // '' = no section. It is contextual (per membership), never intrinsic to the item.
  it.section = typeof it.section === 'string' ? it.section : '';
  it.storage = typeof it.storage === 'string' ? it.storage : '';   // where it lives at home (free text)
  // Pictures of the item, as resized data URLs. Canonical field is `photos`;
  // a legacy single `photo` string is folded in and then dropped.
  it.photos = asArray(it.photos).filter((p) => typeof p === 'string' && p);
  if (!it.photos.length && typeof it.photo === 'string' && it.photo) it.photos = [it.photo];
  if (it.photos.length > MAX_PHOTOS) it.photos = it.photos.slice(0, MAX_PHOTOS);
  delete it.photo;
  it.maintenance = normalizeMaintenance(it.maintenance);           // care record, or null when unused
  // Optional descriptive / ownership metadata (all intrinsic to the item itself).
  it.color = typeof it.color === 'string' ? it.color : '';
  it.size = typeof it.size === 'string' ? it.size : '';
  it.manufacturer = typeof it.manufacturer === 'string' ? it.manufacturer : '';
  it.model = typeof it.model === 'string' ? it.model : '';         // product / model name
  it.owner = typeof it.owner === 'string' ? it.owner : '';         // whose item it is
  it.acquired = isYMD(it.acquired) ? it.acquired : '';             // date acquired (YYYY-MM-DD)
  it.price = Number.isFinite(it.price) && it.price >= 0 ? it.price : 0; // 0 = unset
  it.currency = typeof it.currency === 'string' ? it.currency : '';
  it.purchaseLink = typeof it.purchaseLink === 'string' ? it.purchaseLink : '';
  it.expiry = isYMD(it.expiry) ? it.expiry : '';                   // expiry / replace-by date
  it.condition = ITEM_CONDITION_IDS.includes(it.condition) ? it.condition : '';
  it.retired = !!it.retired;                                        // "Not in use": kept on record but never packed
  it.retiredReason = RETIRE_REASON_IDS.includes(it.retiredReason) ? it.retiredReason : ''; // only meaningful when retired
  it.serial = typeof it.serial === 'string' ? it.serial : '';
  it.qtyOwned = Number.isFinite(it.qtyOwned) && it.qtyOwned >= 0 ? Math.floor(it.qtyOwned) : 0; // 0 = unset
  it.warranty = isYMD(it.warranty) ? it.warranty : '';            // warranty-until date
  it.capacityL = Number.isFinite(it.capacityL) && it.capacityL >= 0 ? it.capacityL : 0; // packing capacity in litres; 0 = unset (used by containers)
  it.maxKg = Number.isFinite(it.maxKg) && it.maxKg >= 0 ? it.maxKg : 0;                 // max load weight in kg; 0 = unset (used by containers → airline warnings)
  return it;
}
// A care record: how to look after the physical thing, plus an optional recurring
// schedule and a log of what was done when. Kept null unless it holds real content,
// so the 200+ everyday items (socks, toothpaste) carry no dead weight.
export function normalizeMaintenance(m) {
  if (!m || typeof m !== 'object') return null;
  const notes = typeof m.notes === 'string' ? m.notes : '';
  const link = typeof m.link === 'string' ? m.link : '';
  const intervalDays = Number.isFinite(m.intervalDays) && m.intervalDays > 0 ? Math.floor(m.intervalDays) : 0;
  const lastDone = isYMD(m.lastDone) ? m.lastDone : '';
  const log = asArray(m.log)
    .map((e) => ({ date: isYMD(e && e.date) ? e.date : '', note: typeof (e && e.note) === 'string' ? e.note : '' }))
    .filter((e) => e.date)
    .sort((a, b) => a.date.localeCompare(b.date)); // oldest first
  const empty = !notes && !link && !intervalDays && !lastDone && !log.length;
  return empty ? null : { notes, link, intervalDays, lastDone, log };
}
// Usage learning: how often a building-block item was packed vs actually used.
function normalizeStats(s) {
  const n = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  s = s && typeof s === 'object' ? s : {};
  return { packed: n(s.packed), used: n(s.used), unused: n(s.unused), lastReviewed: typeof s.lastReviewed === 'string' ? s.lastReviewed : '' };
}
// A template's named, ordered SECTIONS — logical groupings the user defines per
// template (e.g. a Diving list's "Lights", "Rig", "Regulators"). Each item's
// membership stores which section id it belongs to; unnamed entries are dropped.
export function normalizeSections(arr) {
  const seen = new Set();
  const out = [];
  for (const s of asArray(arr)) {
    const sid = (s && typeof s.id === 'string' && s.id) ? s.id : id();
    const name = typeof (s && s.name) === 'string' ? s.name.trim() : '';
    if (!name || seen.has(sid)) continue;
    seen.add(sid);
    out.push({ id: sid, name });
  }
  return out;
}
export function newSection(name = '') {
  return { id: id(), name: String(name || '').trim() };
}

export function coerceList(l) {
  if (!l || typeof l !== 'object') return l;
  l.items = asArray(l.items).map(coerceItem);
  l.sections = normalizeSections(l.sections);   // ordered per-template groupings ([] = none)
  l.group = GROUP_IDS.includes(l.group) ? l.group : '';  // '' = ungrouped / utility list
  // role decides how the list feeds a trip:
  //  'base'      → always included on every trip (the common core),
  //  'transport' → included only when the trip's transport matches l.transport,
  //  'loose'     → the "Loose items" bin: items not in any template yet; never fed
  //                to a trip and never shown as a tickable activity,
  //  'container' → the "Containers" catalogue: the bags/duffels/backpacks themselves,
  //                as maintainable objects; never fed to a trip or shown as an activity,
  //  ''          → a normal activity list the user ticks (GA / WET).
  l.role = ['base', 'transport', 'loose', 'container'].includes(l.role) ? l.role : '';
  l.transport = TRANSPORTS.includes(l.transport) ? l.transport : '';  // only meaningful when role === 'transport'
  return l;
}
export function coerceEvent(e) {
  if (!e || typeof e !== 'object') return e;
  e.mode = e.mode === 'quick' ? 'quick' : 'trip';   // 'quick' skips the common base + transport kit
  e.activities = asArray(e.activities);
  e.contexts = asArray(e.contexts);
  e.entries = asArray(e.entries).map(coerceItem);
  e.status = e.status === 'done' ? 'done' : 'active';   // 'active' | 'done' (reviewed)
  if (typeof e.reviewedAt !== 'string') e.reviewedAt = '';
  e.nights = Number.isFinite(e.nights) && e.nights >= 0 ? Math.floor(e.nights) : 0;  // trip length; drives per-night scaling
  if (typeof e.endDate !== 'string') e.endDate = '';   // return date; `nights` derives from start->end
  if (typeof e.destination !== 'string') e.destination = '';  // free text -> geocoded for weather
  e.weather = coerceWeather(e.weather);  // cached Open-Meteo snapshot, or null
  e.geo = coerceGeo(e.geo);              // cached place coordinates for the world map, or null
  return e;
}

// A tiny, standalone place fix — { lat, lon, place } — cached on an event so the
// world map can pin it offline. Set when we look a destination up (via the same
// geocoder the weather uses); kept even if no forecast is ever fetched.
export function coerceGeo(g) {
  if (!g || typeof g !== 'object') return null;
  const lat = Number(g.lat), lon = Number(g.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon, place: typeof g.place === 'string' ? g.place : '' };
}

// --- Actions (to-dos) -------------------------------------------------------
// A small to-do, optionally tied to a catalog item (`itemId`) or "loose" (itemId
// ''). Actions live in their OWN store (not on the item), so the central Actions
// list has ONE clean source and a loose action needs no item at all. Ticking
// `done` is permanent on the action — it does not reset per trip.
export const ACTION_PRIORITIES = [
  { id: 'high',   label: 'High' },
  { id: 'normal', label: 'Normal' },
];
export const ACTION_PRIORITY_IDS = ACTION_PRIORITIES.map((p) => p.id);
export function actionPriorityLabel(pid) {
  const p = ACTION_PRIORITIES.find((x) => x.id === pid);
  return p ? p.label : 'Normal';
}

export function coerceAction(a) {
  if (!a || typeof a !== 'object') return a;
  a.text = typeof a.text === 'string' ? a.text : '';
  a.itemId = typeof a.itemId === 'string' ? a.itemId : '';        // '' = loose (not tied to an item)
  a.itemName = typeof a.itemName === 'string' ? a.itemName : '';  // cached item name, for display + orphan fallback
  a.priority = ACTION_PRIORITY_IDS.includes(a.priority) ? a.priority : 'normal';
  a.whenPhase = PHASE_IDS.includes(a.whenPhase) ? a.whenPhase : ''; // optional trip phase (≥1 week ahead…)
  a.whenDate = isYMD(a.whenDate) ? a.whenDate : '';                 // optional calendar date (YYYY-MM-DD)
  a.done = !!a.done;
  a.doneAt = typeof a.doneAt === 'string' ? a.doneAt : '';         // ISO timestamp when ticked done
  if (typeof a.createdAt !== 'string') a.createdAt = nowISO();
  if (typeof a.updatedAt !== 'string') a.updatedAt = a.createdAt;
  return a;
}

// A timing rank used to order the central list: concrete dates first (soonest
// wins), then trip phases in their natural order, then anything untimed.
function actionWhenRank(a) {
  if (a.whenDate) return `0-${a.whenDate}`;
  if (a.whenPhase) return `1-${String(phaseOrder(a.whenPhase)).padStart(2, '0')}`;
  return '9';
}
// Sort for the central Actions list: open before done, high before normal,
// sooner before later, then newest-created first.
export function compareActions(a, b) {
  if (!!a.done !== !!b.done) return a.done ? 1 : -1;
  const pa = a.priority === 'high' ? 0 : 1, pb = b.priority === 'high' ? 0 : 1;
  if (pa !== pb) return pa - pb;
  const ta = actionWhenRank(a), tb = actionWhenRank(b);
  if (ta !== tb) return ta < tb ? -1 : 1;
  return (b.createdAt || '').localeCompare(a.createdAt || '');
}

// --- Constructors ---

export function newAction(partial = {}) {
  return coerceAction({
    id: id(),
    text: '', itemId: '', itemName: '',
    priority: 'normal', whenPhase: '', whenDate: '',
    done: false, doneAt: '',
    createdAt: nowISO(), updatedAt: nowISO(),
    ...partial,
  });
}

export function newItem(partial = {}) {
  return coerceItem({
    id: id(),
    name: '',
    swedish: '',            // original Swedish wording, kept as a subtitle
    qty: '',
    category: CATEGORY_DEFAULT,
    container: 'Carry-on / hand luggage',
    phase: 'week',
    itemType: 'item',       // 'item' (packable) | 'reminder' (a to-do prompt)
    charging: false,        // needs charging or a charging cable
    chargeType: '',         // how it charges: USB-C / USB-A / Lightning / special… ('' = unspecified)
    shortList: false,       // part of the minimal "short home list"
    seasons: [],     // empty = any season
    contexts: [],    // empty = any context
    transports: [],  // empty = any transport
    catering: [],    // empty = any catering choice
    weather: [],     // weather conditions this item is FOR (empty = not weather-conditional)
    sub: [],         // optional nested sub-items (names)
    note: '',
    weight: 0,       // grams per unit (0 = unknown)
    liquid: false,   // liquid/gel (100 ml rule)
    restricted: false, // battery / restricted (carry-on)
    perNight: false, // quantity scales with trip nights
    section: '',     // per-template section (a section id, resolved from the membership)
    storage: '',     // where the physical item is kept at home (free text)
    photos: [],      // pictures of the item, as resized data URLs (max MAX_PHOTOS)
    maintenance: null, // care record (notes/link/schedule/log) — see normalizeMaintenance
    // Optional descriptive / ownership metadata (all intrinsic to the item):
    color: '', size: '', manufacturer: '', model: '', owner: '',
    acquired: '', price: 0, currency: '', purchaseLink: '',
    expiry: '', condition: '', retired: false, retiredReason: '', serial: '', qtyOwned: 0, warranty: '',
    capacityL: 0,    // packing capacity in litres (used by containers; 0 = unset)
    maxKg: 0,        // max load weight in kg (used by containers; 0 = unset)
    ...partial,
  });
}

export function newList(partial = {}) {
  return coerceList({
    id: id(),
    name: '',
    sections: [],       // ordered per-template groupings ({id,name}); [] = ungrouped list
    group: '',          // 'GA' | 'WET' | 'OE' | '' (ungrouped)
    role: '',           // '' (ticked activity) | 'base' (always on) | 'transport' (auto by transport)
    transport: '',      // '' | 'Car' | 'Plane' | 'RV' — only used when role === 'transport'
    builtin: false,
    items: [],
    createdAt: nowISO(),
    updatedAt: nowISO(),
    ...partial,
  });
}

export function newEvent(partial = {}) {
  return coerceEvent({
    id: id(),
    name: '',
    mode: 'trip',         // 'trip' (common base + transport + activities) | 'quick' (ticked activities only)
    activities: [],       // packing-list ids chosen for this trip
    transport: 'Car',
    season: 'Summer',
    contexts: [],
    catering: 'mixed',
    startDate: '',
    endDate: '',          // return date; trip length in nights derives from start->end
    nights: 0,            // trip length in nights (drives per-night quantity scaling)
    destination: '',      // optional place name for the weather forecast
    weather: null,        // cached Open-Meteo snapshot (set when fetched online)
    entries: [],          // materialised, editable Total-List lines
    generatedAt: '',
    createdAt: nowISO(),
    updatedAt: nowISO(),
    ...partial,
  });
}

// --- Filtering: does a building-block item belong in this event? ---
// An empty constraint array means "applies to any value" for that dimension.

function dimOk(itemVals, eventVal) {
  const vals = asArray(itemVals);
  if (vals.length === 0) return true;            // no constraint -> always applies
  if (eventVal == null || eventVal === '') return true;
  return vals.includes(eventVal);
}
function contextsOk(itemContexts, eventContexts) {
  const vals = asArray(itemContexts);
  if (vals.length === 0) return true;
  const ev = asArray(eventContexts);
  if (ev.length === 0) return true;              // event didn't pin a context -> keep
  return vals.some((v) => ev.includes(v));
}

// The event's Context (Indoor / Outdoor / Race) only narrows items that belong to
// a WET list. `list` is the building-block list the item came from; when it isn't
// a WET list (or isn't given), context is ignored and the item always applies.
export function contextApplies(list) {
  return !!list && list.group === 'WET';
}

export function itemMatchesEvent(item, event, list) {
  return dimOk(item.seasons, event.season)
    && dimOk(item.transports, event.transport)
    && dimOk(item.catering, event.catering)
    && (contextApplies(list) ? contextsOk(item.contexts, event.contexts) : true);
}

// --- Total List generation ---
// The display name of a section id within a template's `sections` ('' if none/unknown).
export function sectionName(list, sectionId) {
  if (!sectionId || !list) return '';
  const s = asArray(list.sections).find((x) => x.id === sectionId);
  return s ? s.name : '';
}
// Turn a building-block item into an editable Total-List entry.
function entryFromItem(item, list) {
  return coerceItem({
    id: id(),
    name: item.name,
    swedish: item.swedish || '',
    qty: item.qty || '',
    category: item.category || CATEGORY_DEFAULT,
    container: item.container,
    phase: item.phase,
    itemType: item.itemType || 'item',
    charging: !!item.charging,
    chargeType: item.chargeType || '',
    shortList: !!item.shortList,
    weight: Number.isFinite(item.weight) ? item.weight : 0,
    liquid: !!item.liquid,
    restricted: !!item.restricted,
    perNight: !!item.perNight,
    section: sectionName(list, item.section), // resolved to the DISPLAY NAME so sections merge by name across templates
    storage: item.storage || '', // carried onto the trip so packing shows where to grab it
    sub: asArray(item.sub).slice(),
    note: item.note || '',
    sourceListId: list ? list.id : null,
    sourceItemId: item.id,
    custom: false,
    checked: false,
    // constraints are irrelevant once materialised, but keep shape stable
    seasons: [], contexts: [], transports: [], catering: [], weather: [],
  });
}

// The building-block lists that feed a trip's Total List, in dedup-priority order:
//  1. every always-on base list (role 'base') — the common core of any trip,
//  2. the one transport list matching the trip's transport (role 'transport'),
//  3. the GA/WET activity lists the user ticked, in the order they picked them.
// Earlier lists win on a name+container clash, so the common base takes priority.
export function listsForEvent(event, lists) {
  const all = asArray(lists).map(coerceList);
  const tickable = new Map(all.filter((l) => !l.role).map((l) => [l.id, l]));
  const ticked = asArray(event.activities).map((lid) => tickable.get(lid)).filter(Boolean);
  // Quick mode: just the ticked activity lists — no common base, no transport kit.
  // (Items are still narrowed by the trip's Indoor/Outdoor context, season, etc.)
  const chosen = event.mode === 'quick'
    ? ticked
    : [
      ...all.filter((l) => l.role === 'base'),
      ...all.filter((l) => l.role === 'transport' && l.transport === event.transport),
      ...ticked,
    ];
  const out = [];
  const seen = new Set();
  for (const l of chosen) {
    if (seen.has(l.id)) continue;
    seen.add(l.id);
    out.push(l);
  }
  return out;
}

// Build the raw combined list from the chosen building blocks, de-duplicated by
// name+container (quantities of a duplicate are merged into a "x N" hint).
export function buildTotalEntries(event, lists) {
  const seen = new Map(); // key -> entry
  const out = [];
  for (const list of listsForEvent(event, lists)) {
    for (const item of list.items) {
      if (!item || !String(item.name || '').trim()) continue;
      if (item.retired) continue; // "Not in use" — kept on record but never packed
      if (!itemMatchesEvent(item, event, list)) continue;
      if (asArray(item.weather).length) continue; // conditional gear — offered via the forecast, not the base list
      const key = `${normName(item.name)}|${item.container}`;
      if (seen.has(key)) continue; // first source wins; keep it simple & predictable
      const entry = entryFromItem(item, list);
      seen.set(key, entry);
      out.push(entry);
    }
  }
  return out;
}

// Regenerate while preserving the user's manual edits:
//  - custom (manually added) entries are always kept
//  - entries the user edited or checked are kept as-is (matched by source item id)
//  - brand-new matching items are appended
//  - source items that no longer match are dropped (unless edited/checked/custom)
export function regenerateEntries(event, lists) {
  const fresh = buildTotalEntries(event, lists);
  const prev = asArray(event.entries);
  const prevBySource = new Map();
  for (const e of prev) if (e.sourceItemId) prevBySource.set(e.sourceItemId, e);

  const out = [];
  const usedSources = new Set();
  for (const f of fresh) {
    const existing = f.sourceItemId ? prevBySource.get(f.sourceItemId) : null;
    if (existing) { out.push(existing); usedSources.add(f.sourceItemId); }
    else out.push(f);
  }
  // Keep anything the user added or touched that the fresh build didn't cover.
  for (const e of prev) {
    if (e.custom) { out.push(e); continue; }
    if (e.sourceItemId && !usedSources.has(e.sourceItemId) && (e.checked || e._edited)) out.push(e);
  }
  return out;
}

// --- Grouping for display / export ---

export function entriesByPhase(entries) {
  const map = new Map(PHASES.map((p) => [p.id, []]));
  for (const e of asArray(entries)) {
    const pid = PHASE_IDS.includes(e.phase) ? e.phase : 'week';
    map.get(pid).push(e);
  }
  return PHASES.map((p) => ({ phase: p, entries: map.get(p.id) })).filter((g) => g.entries.length);
}

function groupByKey(entries, keyFn, order, fallback) {
  const map = new Map();
  for (const e of asArray(entries)) {
    const k = keyFn(e) || fallback;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(e);
  }
  const ord = new Map(order.map((c, i) => [c, i]));
  return [...map.entries()]
    .sort((a, b) => (ord.has(a[0]) ? ord.get(a[0]) : 999) - (ord.has(b[0]) ? ord.get(b[0]) : 999) || a[0].localeCompare(b[0]))
    .map(([key, list]) => ({ key, entries: list }));
}
export function groupByContainer(entries) {
  return groupByKey(entries, (e) => e.container, CONTAINERS, 'Other').map((g) => ({ container: g.key, entries: g.entries }));
}
export function groupByCategory(entries) {
  return groupByKey(entries, (e) => e.category, CATEGORIES, CATEGORY_DEFAULT).map((g) => ({ category: g.key, entries: g.entries }));
}
// Group a template's RESOLVED items by their section id, in the template's own
// section order, with any unsectioned items in a trailing bucket (section: null).
// Empty defined sections are omitted so the list stays tidy. Used by the template
// overview screen.
export function groupItemsBySection(items, sections) {
  const defs = asArray(sections);
  const known = new Set(defs.map((s) => s.id));
  const buckets = new Map(defs.map((s) => [s.id, []]));
  const loose = [];
  for (const it of asArray(items)) {
    const sid = it && it.section && known.has(it.section) ? it.section : '';
    if (sid) buckets.get(sid).push(it); else loose.push(it);
  }
  const out = defs.filter((s) => buckets.get(s.id).length).map((s) => ({ section: s, items: buckets.get(s.id) }));
  if (loose.length) out.push({ section: null, items: loose });
  return out;
}

// Group trip ENTRIES by their section NAME (first-appearance order), with the
// unsectioned remainder in a trailing "Everything else" group. Entries carry a
// resolved section name, so same-named sections from different templates merge.
export function groupBySection(entries) {
  const map = new Map(); // name -> entries, in first-seen order
  const loose = [];
  for (const e of asArray(entries)) {
    const name = (e && e.section || '').trim();
    if (!name) { loose.push(e); continue; }
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(e);
  }
  const out = [...map.entries()].map(([label, list]) => ({ label, entries: list }));
  if (loose.length) out.push({ label: 'Everything else', entries: loose });
  return out;
}

// Group entries by WHERE the item is stored at home (its `storage` free-text),
// alphabetically, with anything without a place set gathered in a trailing group.
// Lets you round up "everything from the garage" when packing.
export function groupByStorage(entries) {
  const map = new Map();
  const none = [];
  for (const e of asArray(entries)) {
    const s = (e && e.storage || '').trim();
    if (!s) { none.push(e); continue; }
    if (!map.has(s)) map.set(s, []);
    map.get(s).push(e);
  }
  const out = [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, list]) => ({ label, entries: list }));
  if (none.length) out.push({ label: 'No place set', entries: none });
  return out;
}

// Generic dispatcher used by the UI's group-by toggle: 'category' | 'container' | 'section' | 'stored' | 'when'.
export function groupBy(mode, entries) {
  if (mode === 'category') return groupByCategory(entries).map((g) => ({ label: g.category, entries: g.entries }));
  if (mode === 'container') return groupByContainer(entries).map((g) => ({ label: g.container || 'Unpacked', entries: g.entries }));
  if (mode === 'section') return groupBySection(entries);
  if (mode === 'stored') return groupByStorage(entries);
  return entriesByPhase(entries).map((g) => ({ label: g.phase.label, hint: g.phase.hint, entries: g.entries }));
}

// --- Progress / stats ---

export function progress(entries) {
  const list = asArray(entries);
  const total = list.length;
  const done = list.filter((e) => e.checked).length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

// Post-trip review learning. Each reviewed entry carries a boolean `used`; fold that
// into the source building-block item's stats so lists can get tighter over time.
// Returns the lists that changed (so the caller can persist just those).
export function applyReview(event, lists, whenISO) {
  const now = whenISO || new Date().toISOString();
  const byId = new Map(asArray(lists).map((l) => [l.id, l]));
  const changed = new Set();
  for (const e of asArray(event && event.entries)) {
    if (typeof e.used !== 'boolean' || !e.sourceListId || !e.sourceItemId) continue;
    const list = byId.get(e.sourceListId);
    if (!list) continue;
    const item = asArray(list.items).find((x) => x.id === e.sourceItemId);
    if (!item) continue;
    item.stats = normalizeStats(item.stats);
    item.stats.packed += 1;
    if (e.used) item.stats.used += 1; else item.stats.unused += 1;
    item.stats.lastReviewed = now;
    changed.add(list.id);
  }
  return [...changed].map((lid) => byId.get(lid));
}

// Items worth pruning: packed on >= minTrips reviewed trips but never used.
export function pruneSuggestions(lists, { minTrips = 2 } = {}) {
  const out = [];
  for (const l of asArray(lists)) {
    for (const it of asArray(l.items)) {
      const s = normalizeStats(it.stats);
      if (s.packed >= minTrips && s.used === 0 && !it.keep) out.push({ listId: l.id, listName: l.name, item: it, stats: s });
    }
  }
  out.sort((a, b) => b.stats.packed - a.stats.packed);
  return out;
}

// --- Weight, bag loads, flags & quantity scaling (#3) ---

// How many of this item are actually needed for the trip. Per-night items scale
// with the trip length; otherwise honour an explicit numeric qty, defaulting to 1.
export function effectiveQty(entry, nights = 0) {
  if (entry && entry.perNight && nights > 0) return nights;
  const n = Number(entry && entry.qty);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

// A per-container-name weight-limit map (kg): the built-in airline defaults,
// overlaid with any real container record's own `maxKg` (a bag the user has
// specced). Later wins, so a user's own limit overrides the generic default.
export function containerLimits(lists = []) {
  const out = { ...CONTAINER_LIMITS_KG };
  for (const l of asArray(lists)) {
    if (l.role !== CONTAINER_ROLE) continue;
    for (const it of asArray(l.items)) {
      const name = (it.name || '').trim();
      if (name && Number(it.maxKg) > 0) out[name] = Number(it.maxKg);
    }
  }
  return out;
}

// Per-container weight totals (kg) with over-limit warnings. `limits` maps a
// container name to its max kg; defaults to the built-in airline ceilings, but the
// app passes containerLimits(lists) so each real bag's own limit is honoured.
export function bagLoads(entries, nights = 0, limits = CONTAINER_LIMITS_KG) {
  const map = new Map();
  for (const e of asArray(entries)) {
    if (e.itemType === 'reminder') continue;
    const c = e.container || 'Other';
    if (!map.has(c)) map.set(c, { container: c, grams: 0, items: 0 });
    const b = map.get(c);
    b.items += 1;
    b.grams += (Number(e.weight) || 0) * effectiveQty(e, nights);
  }
  const order = new Map(CONTAINERS.map((c, i) => [c, i]));
  return [...map.values()]
    .sort((a, b) => (order.has(a.container) ? order.get(a.container) : 999) - (order.has(b.container) ? order.get(b.container) : 999))
    .map((b) => {
      const limitKg = (limits && limits[b.container]) || 0;
      const kg = Math.round(b.grams / 100) / 10;
      return { ...b, kg, limitKg, over: limitKg > 0 && b.grams / 1000 > limitKg };
    });
}

// Trip-wide flag counts + total known weight.
export function packingFlags(entries, nights = 0) {
  let liquids = 0; let restricted = 0; let weighed = 0; let total = 0; let grams = 0;
  for (const e of asArray(entries)) {
    if (e.itemType === 'reminder') continue;
    total += 1;
    if (e.liquid) liquids += 1;
    if (e.restricted) restricted += 1;
    if (Number(e.weight) > 0) { weighed += 1; grams += Number(e.weight) * effectiveQty(e, nights); }
  }
  return { liquids, restricted, total, weighed, totalKg: Math.round(grams / 100) / 10 };
}

// --- Departure countdown & "pack now" nudges (#4) ---

// Whole days from `todayISO` to the trip's start date (negative = in the past).
export function daysUntil(startDate, todayISO) {
  if (!startDate) return null;
  const today = (todayISO || new Date().toISOString()).slice(0, 10);
  const a = Date.parse(`${startDate.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / 86400000);
}

export function countdownLabel(d) {
  if (d == null) return '';
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d === -1) return 'Yesterday';
  return d > 0 ? `in ${d} days` : `${-d} days ago`;
}

// Whole nights between a start and end date (end minus start, in days). Returns
// null when either date is missing/invalid or the end falls before the start.
// Same-day start and end = 0 nights (a day trip).
export function nightsBetween(startDate, endDate) {
  if (!startDate || !endDate) return null;
  const a = Date.parse(`${startDate.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${endDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  const nights = Math.round((b - a) / 86400000);
  return nights >= 0 ? nights : null;
}

// The end date implied by a start date plus a number of nights — used to show an
// end-date field for older events that only stored `nights`. '' with no start date.
export function endFromNights(startDate, nights) {
  if (!startDate) return '';
  const start = Date.parse(`${startDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(start)) return '';
  const n = Number.isFinite(nights) && nights > 0 ? Math.floor(nights) : 0;
  return new Date(start + n * 86400000).toISOString().slice(0, 10);
}

// Order events for the Home preview and the Events tab: nearest upcoming trip
// first, then undated drafts (most recently created first), then past trips
// (most recent first). This puts "what I'm packing for next" at the top.
export function sortEventsForList(events, todayISO) {
  const rank = (e) => {
    const d = daysUntil(e.startDate, todayISO); // null = no date
    if (d == null) return 1;      // undated drafts sit between upcoming and past
    return d >= 0 ? 0 : 2;        // 0 = today/upcoming, 2 = past
  };
  return events.slice().sort((a, b) => {
    const ra = rank(a); const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 0) return daysUntil(a.startDate, todayISO) - daysUntil(b.startDate, todayISO); // soonest first
    if (ra === 2) return daysUntil(b.startDate, todayISO) - daysUntil(a.startDate, todayISO); // most recent past first
    return (b.createdAt || '').localeCompare(a.createdAt || ''); // undated: newest draft first
  });
}

// What to pack right now: the earliest timeline phase that is "due" (its lead time has
// arrived) and still has unpacked items. Returns null when there's no date or nothing due.
export function tripNudge(event, todayISO) {
  if (!event || !event.startDate) return null;
  const daysToGo = daysUntil(event.startDate, todayISO);
  if (daysToGo == null) return null;
  const due = packSteps(event.entries).filter((s) => {
    const lead = PHASE_LEAD_DAYS[s.phase.id] ?? 0;
    return lead >= daysToGo && s.remaining > 0;
  });
  const dueCount = due.reduce((sum, s) => sum + s.remaining, 0);
  const focus = due[0] || null; // packSteps is timeline-ordered, so this is the earliest due phase
  return { daysToGo, label: countdownLabel(daysToGo), focusPhaseId: focus ? focus.phase.id : null, focusLabel: focus ? focus.phase.label : '', dueCount };
}

// Packing Mode steps: one per non-empty timeline phase, with packed/remaining counts.
// The UI walks these one at a time.
export function packSteps(entries) {
  return entriesByPhase(entries).map((g) => {
    const total = g.entries.length;
    const done = g.entries.filter((e) => e.checked).length;
    return { phase: g.phase, entries: g.entries, total, done, remaining: total - done };
  });
}

// --- Trip sharing (manual, backend-free) ---
// A trip bundle is a single, self-contained event. Its entries are already
// materialised, so nothing external (no building-block lists) is needed to
// rebuild the Total List on the receiving device.
export const TRIP_KIND = 'trip';

// Entry fields the receiver never needs: sender-only bookkeeping (ids, source
// links, usage stats, packed/used state). coerceItem restores every other
// default on import, so dropping defaulted fields is lossless.
const TRIP_DROP_KEYS = new Set(['id', 'sourceListId', 'sourceItemId', 'stats', 'checked', 'used', 'custom']);
const isDefaulty = (v) => v === '' || v === false || v === 0 || v == null || (Array.isArray(v) && v.length === 0);

// Shrink an entry to just its non-default, receiver-relevant fields. This keeps
// shared links small enough to travel as a URL (a full entry is ~4x larger).
function slimEntry(e) {
  const o = {};
  for (const [k, v] of Object.entries(e)) {
    if (TRIP_DROP_KEYS.has(k)) continue;
    if (k === 'sub') { if (Array.isArray(v) && v.length) o.sub = v.map(slimEntry); continue; }
    if (k === 'itemType' && v === 'item') continue;      // restored by coerceItem
    if (isDefaulty(v)) continue;                          // restored by coerceItem
    o[k] = v;
  }
  return o;
}

export function buildTripBundle(event, whenISO = nowISO()) {
  if (!event) throw new Error('No trip to share.');
  const slim = { ...event, entries: (event.entries || []).map(slimEntry) };
  return { app: 'ams-packing-list', kind: TRIP_KIND, version: 1, exportedAt: whenISO, event: slim };
}

// Give every entry (and nested sub-item) a fresh unique id — slimmed bundles
// carry none, and the UI keys expand/remove/review on entry.id.
function reidEntries(entries) {
  for (const e of asArray(entries)) {
    e.id = id();
    e.checked = false;
    delete e.used;
    if (Array.isArray(e.sub) && e.sub.length) reidEntries(e.sub);
  }
}

// Parse a trip bundle (from a file or a link) and return a fresh, importable
// event: new id + timestamps, review state reset, so importing never clobbers
// an existing event and the receiver starts from a clean, unpacked list.
export function parseTripBundle(data) {
  const obj = typeof data === 'string' ? JSON.parse(data) : data;
  if (!obj || typeof obj !== 'object' || obj.kind !== TRIP_KIND || !obj.event) {
    throw new Error('This does not look like a shared AMS trip.');
  }
  const ev = coerceEvent(obj.event);
  ev.id = id();
  ev.status = 'active';
  ev.reviewedAt = '';
  ev.createdAt = nowISO();
  ev.updatedAt = ev.createdAt;
  reidEntries(ev.entries);
  return ev;
}

// URL-safe base64 (RFC 4648 §5) of a UTF-8 string, no padding.
export function toBase64Url(str) {
  const b64 = btoa(unescape(encodeURIComponent(str)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromBase64Url(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  return decodeURIComponent(escape(atob(b64)));
}

// Encode a trip as a self-contained deep link fragment: #/t/<base64url-json>.
// Returns null when the payload is too large to travel reliably as a link
// (some apps/browsers truncate long URLs) — callers fall back to a file share.
export const TRIP_LINK_MAX = 8000;
export function encodeTripLink(event, whenISO = nowISO()) {
  const json = JSON.stringify(buildTripBundle(event, whenISO));
  const frag = `#/t/${toBase64Url(json)}`;
  return frag.length > TRIP_LINK_MAX ? null : frag;
}
export function decodeTripLink(data) {
  return parseTripBundle(fromBase64Url(data));
}

// --- Care & maintenance ---
// A physical item can carry a care record: how to look after it (notes + a
// manufacturer/how-to link), an optional recurring service interval, when it was
// last done, and a history log. The building-block item (in a List) is the
// canonical record of the real thing, so care lives there — not on trip entries.

// Friendly interval presets offered in the editor. 0 = no recurring schedule
// (reference-only care: notes/link but nothing to remind about).
export const MAINTENANCE_INTERVALS = [
  { days: 0, label: 'No schedule (reference only)' },
  { days: 30, label: 'Every month' },
  { days: 90, label: 'Every 3 months' },
  { days: 182, label: 'Every 6 months' },
  { days: 365, label: 'Every year' },
  { days: 730, label: 'Every 2 years' },
];
// A due date within this many days counts as "due soon" (amber, not yet overdue).
export const MAINTENANCE_SOON_DAYS = 21;

// YYYY-MM-DD arithmetic, done in UTC so it never drifts by a day across timezones.
export function addDays(ymd, days) {
  const t = Date.parse(`${ymd}T00:00:00Z`);
  if (Number.isNaN(t)) return '';
  return new Date(t + days * 86400000).toISOString().slice(0, 10);
}
export function daysBetween(fromYMD, toYMD) {
  const a = Date.parse(`${fromYMD}T00:00:00Z`);
  const b = Date.parse(`${toYMD}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

// Does this item hold any care info worth surfacing (schedule, notes, link, or history)?
export function hasCare(item) {
  const m = item && item.maintenance;
  return !!(m && (m.intervalDays || m.notes || m.link || m.lastDone || (m.log && m.log.length)));
}

// Where an item's maintenance stands today. Returns null for items with no care
// record. `state` is one of: 'overdue' | 'soon' | 'ok' (scheduled), or 'reference'
// (care notes/link but no recurring schedule). A scheduled item never logged as
// done is treated as due today, and flagged `neverDone` so the UI can say so.
export function maintenanceStatus(item, todayISO) {
  const m = item && item.maintenance;
  if (!m) return null;
  const today = todayYMD(todayISO);
  if (!m.intervalDays) {
    return { scheduled: false, state: 'reference', nextDue: '', days: null, lastDone: m.lastDone || '', neverDone: !m.lastDone, intervalDays: 0 };
  }
  const neverDone = !m.lastDone;
  const nextDue = neverDone ? today : addDays(m.lastDone, m.intervalDays);
  const days = daysBetween(today, nextDue); // negative = overdue by that many days
  const state = days < 0 ? 'overdue' : days <= MAINTENANCE_SOON_DAYS ? 'soon' : 'ok';
  return { scheduled: true, state, nextDue, days, lastDone: m.lastDone || '', neverDone, intervalDays: m.intervalDays };
}

const MAINT_RANK = { overdue: 0, soon: 1, ok: 2, reference: 3 };

// Every item across all lists that carries care info, each with its list context
// and current status, ordered by urgency (overdue → due soon → upcoming → reference).
export function maintenanceList(lists, todayISO) {
  const today = todayYMD(todayISO);
  const out = [];
  for (const l of asArray(lists)) {
    for (const it of asArray(l.items)) {
      if (!hasCare(it)) continue;
      out.push({ listId: l.id, listName: l.name || '', item: it, status: maintenanceStatus(it, today) });
    }
  }
  out.sort((a, b) => {
    const ra = MAINT_RANK[a.status.state] ?? 9;
    const rb = MAINT_RANK[b.status.state] ?? 9;
    if (ra !== rb) return ra - rb;
    if (a.status.nextDue && b.status.nextDue && a.status.nextDue !== b.status.nextDue) {
      return a.status.nextDue.localeCompare(b.status.nextDue); // soonest due first
    }
    return (a.item.name || '').localeCompare(b.item.name || '');
  });
  return out;
}

// Headline counts for the Care tab and the Home reminder.
export function maintenanceSummary(lists, todayISO) {
  const all = maintenanceList(lists, todayISO);
  const count = (s) => all.filter((x) => x.status.state === s).length;
  const overdue = count('overdue');
  const soon = count('soon');
  return { overdue, soon, ok: count('ok'), reference: count('reference'), scheduled: overdue + soon + count('ok'), total: all.length, due: overdue + soon };
}

// Scheduled items bucketed by their next-due date (YYYY-MM-DD) — powers the calendar.
export function maintenanceByDate(lists, todayISO) {
  const map = new Map();
  for (const row of maintenanceList(lists, todayISO)) {
    if (!row.status.scheduled || !row.status.nextDue) continue;
    if (!map.has(row.status.nextDue)) map.set(row.status.nextDue, []);
    map.get(row.status.nextDue).push(row);
  }
  return map;
}

// Record that an item was maintained on `dateYMD` (default today), appending to
// its history and resetting the schedule. Mutates and returns the item; creates
// the care record if the item didn't have one. Pure enough to unit-test.
export function logMaintenance(item, dateYMD, note = '', todayISO) {
  const date = isYMD(dateYMD) ? dateYMD : todayYMD(todayISO);
  const base = normalizeMaintenance(item.maintenance) || { notes: '', link: '', intervalDays: 0, lastDone: '', log: [] };
  const log = [...base.log, { date, note: typeof note === 'string' ? note : '' }].sort((a, b) => a.date.localeCompare(b.date));
  item.maintenance = normalizeMaintenance({ ...base, lastDone: date, log });
  return item;
}

// --- Weather (opt-in, Open-Meteo) ---
// The event optionally stores a `destination` and a cached `weather` snapshot
// (fetched when online, kept on-device so it still shows offline). All the
// interpretation below is pure and DOM-free: it maps a forecast to icon keys,
// derived conditions, and packing suggestions. The app maps icon keys to SVGs.

// WMO weather-code -> symbolic icon key + short label + whether it means "wet".
export function weatherCode(code) {
  const c = Number(code);
  if (c === 0) return { icon: 'sun', label: 'Clear', wet: false };
  if (c === 1 || c === 2) return { icon: 'sun-cloud', label: 'Partly cloudy', wet: false };
  if (c === 3) return { icon: 'cloud', label: 'Cloudy', wet: false };
  if (c === 45 || c === 48) return { icon: 'fog', label: 'Fog', wet: false };
  if (c >= 51 && c <= 57) return { icon: 'rain', label: 'Drizzle', wet: true };
  if (c >= 61 && c <= 67) return { icon: 'rain', label: 'Rain', wet: true };
  if (c >= 71 && c <= 77) return { icon: 'snow', label: 'Snow', wet: true };
  if (c >= 80 && c <= 82) return { icon: 'rain', label: 'Showers', wet: true };
  if (c >= 85 && c <= 86) return { icon: 'snow', label: 'Snow showers', wet: true };
  if (c >= 95) return { icon: 'storm', label: 'Thunderstorm', wet: true };
  return { icon: 'cloud', label: '—', wet: false };
}

// Thresholds that turn a forecast into packing-relevant conditions (metric).
export const WEATHER_THRESHOLDS = { coldMinC: 5, coolMaxSummerC: 14, hotMaxC: 27, windKmh: 35, wetProb: 50 };

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function dowLabel(dateISO) {
  const d = new Date(`${dateISO}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '' : DOW[d.getDay()];
}

function coerceWeather(w) {
  if (!w || typeof w !== 'object' || !Array.isArray(w.daily)) return null;
  const daily = w.daily.filter((d) => d && d.date).map((d) => ({
    date: String(d.date), code: Number(d.code) || 0,
    tmax: Number(d.tmax), tmin: Number(d.tmin),
    precipProb: Number(d.precipProb) || 0, wind: Number(d.wind) || 0,
  }));
  if (!daily.length) return null;
  return {
    place: typeof w.place === 'string' ? w.place : '',
    lat: Number(w.lat), lon: Number(w.lon),
    fetchedAt: typeof w.fetchedAt === 'string' ? w.fetchedAt : '', daily,
  };
}

// Turn the cached forecast into per-day display data + derived conditions.
export function deriveWeather(event) {
  const w = event && event.weather;
  if (!w || !Array.isArray(w.daily) || !w.daily.length) return null;
  const T = WEATHER_THRESHOLDS;
  const days = w.daily.map((d) => {
    const info = weatherCode(d.code);
    const rainy = info.wet || Number(d.precipProb) >= T.wetProb;
    return {
      date: d.date, dow: dowLabel(d.date), icon: info.icon, label: info.label,
      tmax: Math.round(d.tmax), tmin: Math.round(d.tmin),
      precipProb: Math.round(d.precipProb || 0), wind: Math.round(d.wind || 0),
      rainy, snowy: info.icon === 'snow',
    };
  });
  const tmax = days.map((d) => d.tmax);
  const tmin = days.map((d) => d.tmin);
  const tempMax = Math.max(...tmax);
  const tempMin = Math.min(...tmin);
  const summer = event.season === 'Summer';
  const conditions = [];
  if (days.some((d) => d.rainy && !d.snowy)) conditions.push('rain');
  if (days.some((d) => d.snowy)) conditions.push('snow');
  if (tempMin <= T.coldMinC || (summer && Math.min(...tmax) < T.coolMaxSummerC)) conditions.push('cold');
  if (tempMax >= T.hotMaxC) conditions.push('hot');
  if (days.some((d) => d.wind >= T.windKmh)) conditions.push('wind');
  return {
    place: w.place || '', fetchedAt: w.fetchedAt || '', days, tempMin, tempMax,
    rangeLabel: `${tempMin}–${tempMax}°C`, conditions, coolerThanSeason: summer && Math.min(...tmax) < T.coolMaxSummerC,
  };
}

// Curated, generic add-ons per condition — the kind of gear that isn't
// activity-specific. Suggested only when the forecast calls for it and the item
// isn't already on the list.
export const WEATHER_SUGGESTIONS = {
  rain: [
    { name: 'Rain jacket', category: 'Adventure clothing' },
    { name: 'Waterproof / pack cover', category: 'Adventure clothing' },
  ],
  cold: [
    { name: 'Warm mid-layer', category: 'Adventure clothing' },
    { name: 'Beanie + gloves', category: 'Adventure clothing' },
    { name: 'Long tights', category: 'Adventure clothing' },
  ],
  hot: [
    { name: 'Sun hat / cap', category: 'Adventure clothing' },
    { name: 'Sunscreen', category: 'Toiletries', liquid: true },
    { name: 'Extra water bottle', category: 'Comfort & misc' },
  ],
  wind: [{ name: 'Windbreaker', category: 'Adventure clothing' }],
  snow: [
    { name: 'Warm gloves', category: 'Adventure clothing' },
    { name: 'Traction spikes', category: 'Footwear' },
  ],
};

function weatherSummary(d) {
  const bits = [];
  const rainy = d.days.filter((x) => x.rainy).map((x) => x.dow).filter(Boolean);
  if (rainy.length) bits.push(rainy.length <= 2 ? `Rain ${rainy.join('–')}` : 'Rain likely');
  if (d.conditions.includes('snow')) bits.push('snow');
  if (d.coolerThanSeason) bits.push('cooler than Summer');
  else if (d.conditions.includes('cold')) bits.push('cold spells');
  if (d.conditions.includes('hot')) bits.push('hot');
  if (d.conditions.includes('wind')) bits.push('windy');
  return bits.join(' · ');
}

// All weather-conditional gear this trip's lists hold that isn't packed yet —
// applicable to the trip (season/transport) but independent of any forecast.
// Powers both the "waiting" hint and the "pack anyway" control, so the user can
// add e.g. a rain shell as a backup layer even when it isn't forecast to rain.
export function weatherGear(event, lists = []) {
  const have = new Set(asArray(event.entries).map((e) => normName(e.name)));
  const byId = new Map(asArray(lists).map((l) => [l.id, l]));
  const seen = new Set();
  const out = [];
  for (const listId of asArray(event.activities)) {
    const list = byId.get(listId);
    if (!list) continue;
    for (const it of asArray(list.items)) {
      const tags = asArray(it.weather);
      if (!tags.length || !it.name || !itemMatchesEvent(it, event, list)) continue;
      const key = normName(it.name);
      if (have.has(key) || seen.has(key)) continue;
      seen.add(key);
      out.push({
        name: it.name, swedish: it.swedish || '', category: it.category, container: it.container,
        phase: it.phase, itemType: it.itemType, liquid: !!it.liquid, weight: it.weight || 0,
        sourceListId: list.id, sourceItemId: it.id, conditions: tags.slice(), own: true,
      });
    }
  }
  return out;
}
export function pendingWeatherItems(event, lists = []) {
  return weatherGear(event, lists).length;
}

// Suggested additions for this trip's forecast, minus anything already packed.
// Prefers the user's OWN weather-tagged items from the chosen activity lists,
// then fills any remaining conditions with the curated generic add-ons.
export function weatherSuggestions(event, lists = []) {
  const d = deriveWeather(event);
  if (!d) return { conditions: [], items: [], summary: '' };
  const active = new Set(d.conditions);
  const have = new Set(asArray(event.entries).map((e) => normName(e.name)));
  const seen = new Set();
  const items = [];

  // 1) Your own tagged gear from the lists this trip draws on.
  const byId = new Map(asArray(lists).map((l) => [l.id, l]));
  for (const listId of asArray(event.activities)) {
    const list = byId.get(listId);
    if (!list) continue;
    for (const it of asArray(list.items)) {
      const tags = asArray(it.weather);
      const reason = tags.find((t) => active.has(t));
      if (!reason || !it.name || !itemMatchesEvent(it, event, list)) continue;
      const key = normName(it.name);
      if (have.has(key) || seen.has(key)) continue;
      seen.add(key);
      items.push({
        name: it.name, swedish: it.swedish || '', category: it.category, container: it.container,
        phase: it.phase, itemType: it.itemType, liquid: !!it.liquid, weight: it.weight || 0,
        sourceListId: list.id, sourceItemId: it.id, reason, own: true,
      });
    }
  }

  // 2) Curated generic add-ons cover any condition your lists didn't.
  for (const cond of d.conditions) {
    for (const spec of WEATHER_SUGGESTIONS[cond] || []) {
      const key = normName(spec.name);
      if (have.has(key) || seen.has(key)) continue;
      seen.add(key);
      items.push({ ...spec, reason: cond });
    }
  }
  return { conditions: d.conditions, items, summary: weatherSummary(d) };
}

// ============================================================================
// PLACES VISITED (world map)
// ============================================================================
// Every event may name a `destination`. Once that place is looked up (by the
// weather forecast, or on demand for the map) its coordinates are cached — on
// the weather snapshot and/or the lightweight `geo` fix. These helpers pull the
// coordinates back out and roll repeat visits to the same place into ONE pin.

// The best-known coordinates for an event, or null. A fetched forecast is the
// most authoritative source (it carries a tidy "City, CC" label); the cached
// `geo` fix is the fallback for events that never had a forecast.
export function eventCoords(event) {
  if (!event || typeof event !== 'object') return null;
  const w = event.weather;
  if (w && Number.isFinite(Number(w.lat)) && Number.isFinite(Number(w.lon))) {
    return { lat: Number(w.lat), lon: Number(w.lon), place: w.place || event.destination || '' };
  }
  const g = coerceGeo(event.geo);
  if (g) return { lat: g.lat, lon: g.lon, place: g.place || event.destination || '' };
  return null;
}

// Events that name a destination but have no coordinates yet — the map's
// "Find these places" button geocodes exactly these.
export function eventsNeedingCoords(events) {
  return (events || []).filter((e) => e && e.destination && e.destination.trim() && !eventCoords(e));
}

// The pin key that merges repeat visits: a normalised place label when we have
// one (so "Stockholm, SE" visited thrice is one pin), else coordinates rounded
// to ~0.1° (~11 km) so two forecasts of the same spot still coincide.
function placeKey(coords) {
  const label = normName(coords.place || '');
  if (label) return `n:${label}`;
  return `c:${coords.lat.toFixed(1)},${coords.lon.toFixed(1)}`;
}

// Roll a list of events into one pin per place: { key, place, lat, lon, events }.
// `events` within a pin are newest-first; the pin's coordinates/label come from
// its most recent visit. Pins are returned most-recently-visited first.
export function placesVisited(events) {
  const byKey = new Map();
  for (const e of sortEventsForList(events || [])) {   // newest-first overall
    const coords = eventCoords(e);
    if (!coords) continue;
    const key = placeKey(coords);
    if (!byKey.has(key)) {
      byKey.set(key, { key, place: coords.place || '', lat: coords.lat, lon: coords.lon, events: [] });
    }
    byKey.get(key).events.push(e);
  }
  return [...byKey.values()];
}

// ============================================================================
// RELATIONAL CORE ("Endeavour 2") — the Item catalog + Memberships.
// ============================================================================
// The professional data model. Instead of copying an item into every template it
// belongs to (which is how the app grew up, and where the data drifts), an item
// exists ONCE in a catalog and templates REFERENCE it through a Membership.
//
// Three layers, each owning its own properties (see docs/decisions/…-data-model.md):
//   1. ITEM        — the thing itself: name, swedish, category, flags, weight,
//                    photos, home storage, care, default container, default phase.
//   2. MEMBERSHIP  — item ↔ template: the relation. Holds the CONDITIONS that
//                    decide when the item is included (seasons / contexts /
//                    transports / catering / weather), plus OPTIONAL overrides of
//                    container / phase / itemType / qty / note (blank = use the
//                    item's default).
//   3. TRIP LINE   — item ↔ event: the frozen packing-list snapshot (unchanged;
//                    still the materialised `entries` on an event).
//
// The `resolve*` functions below rebuild today's item shape from an item + its
// membership, so the rest of the app keeps working unchanged while we migrate.
// `buildCatalog` is the one-time migration engine: it folds the current copy-based
// lists into { items, memberships, templates }, merging same-named items and
// turning per-list differences into membership overrides.

// A Membership links one catalog item to one template. Conditions describe WHEN
// the item applies on a trip; overrides are '' / [] when the item's own default
// should be used (so a membership stays tiny unless it genuinely differs).
export function coerceMembership(m) {
  if (!m || typeof m !== 'object') return m;
  m.seasons = asArray(m.seasons);
  m.contexts = asArray(m.contexts);
  m.transports = asArray(m.transports);
  m.catering = asArray(m.catering);
  m.weather = asArray(m.weather).filter((w) => WEATHER_CONDITION_IDS.includes(w)); // conditional-gear tags (contextual, per template)
  m.container = typeof m.container === 'string' ? m.container : '';      // '' = use item default
  m.section = typeof m.section === 'string' ? m.section : '';            // section id within THIS template ('' = none)
  m.phase = PHASE_IDS.includes(m.phase) ? m.phase : '';                  // '' = use item default
  m.itemType = (m.itemType === 'item' || m.itemType === 'reminder') ? m.itemType : ''; // '' = use item default
  m.qty = typeof m.qty === 'string' ? m.qty : (m.qty ? String(m.qty) : '');
  m.note = typeof m.note === 'string' ? m.note : '';
  m.order = Number.isFinite(m.order) ? m.order : 0;   // item position within its template
  return m;
}

export function newMembership(partial = {}) {
  return coerceMembership({
    id: id(),
    itemId: '',
    templateId: '',
    seasons: [], contexts: [], transports: [], catering: [], weather: [],
    container: '', section: '', phase: '', itemType: '', qty: '', note: '', order: 0,
    ...partial,
  });
}

// --- Write path: decompose an edited (resolved) item back into the catalog ---
// These mirror the migration engine but for a SINGLE resolved item, so db.saveList
// can persist edits: intrinsic fields flow to the shared catalog item (edit once,
// everywhere updates), everything contextual flows to the membership.

// Push a resolved item's intrinsic edits onto its shared catalog item. Container /
// phase DEFAULTS are intentionally left alone (they're set once, overridden per
// membership); only the thing-itself fields propagate.
export function applyIntrinsic(cat, it) {
  cat.name = it.name;
  cat.swedish = it.swedish || '';
  cat.category = it.category;
  cat.charging = !!it.charging;
  cat.chargeType = it.chargeType || '';
  cat.liquid = !!it.liquid;
  cat.restricted = !!it.restricted;
  cat.perNight = !!it.perNight;
  cat.shortList = !!it.shortList;
  cat.weight = Number.isFinite(it.weight) ? it.weight : 0;
  cat.storage = it.storage || '';
  cat.sub = asArray(it.sub).slice();
  cat.photos = asArray(it.photos).slice();
  cat.maintenance = it.maintenance || null;
  // Descriptive / ownership metadata — intrinsic, so it lives on the shared item.
  cat.color = it.color || '';
  cat.size = it.size || '';
  cat.manufacturer = it.manufacturer || '';
  cat.model = it.model || '';
  cat.owner = it.owner || '';
  cat.acquired = it.acquired || '';
  cat.price = Number.isFinite(it.price) ? it.price : 0;
  cat.currency = it.currency || '';
  cat.purchaseLink = it.purchaseLink || '';
  cat.expiry = it.expiry || '';
  cat.condition = it.condition || '';
  cat.retired = !!it.retired;
  cat.retiredReason = it.retiredReason || '';
  cat.serial = it.serial || '';
  cat.qtyOwned = Number.isFinite(it.qtyOwned) ? it.qtyOwned : 0;
  cat.warranty = it.warranty || '';
  cat.capacityL = Number.isFinite(it.capacityL) ? it.capacityL : 0;
  cat.maxKg = Number.isFinite(it.maxKg) ? it.maxKg : 0;
  if (it.stats) cat.stats = it.stats;
  return coerceItem(cat);
}

// A brand-new catalog item from a resolved item (one the app just added). Its own
// container / phase become the item's DEFAULTS.
export function catalogItemFromResolved(it) {
  return newItem({
    name: it.name, swedish: it.swedish || '', category: it.category,
    container: it.container, phase: it.phase, itemType: it.itemType,
    charging: !!it.charging, chargeType: it.chargeType || '',
    liquid: !!it.liquid, restricted: !!it.restricted, perNight: !!it.perNight, shortList: !!it.shortList,
    weight: it.weight || 0, storage: it.storage || '', sub: asArray(it.sub).slice(),
    photos: asArray(it.photos).slice(), maintenance: it.maintenance || null, stats: it.stats,
    color: it.color || '', size: it.size || '', manufacturer: it.manufacturer || '', model: it.model || '',
    owner: it.owner || '', acquired: it.acquired || '', price: it.price || 0, currency: it.currency || '',
    purchaseLink: it.purchaseLink || '', expiry: it.expiry || '', condition: it.condition || '',
    retired: !!it.retired, retiredReason: it.retiredReason || '',
    serial: it.serial || '', qtyOwned: it.qtyOwned || 0, warranty: it.warranty || '',
    capacityL: it.capacityL || 0, maxKg: it.maxKg || 0,
  });
}

// Build/refresh the membership for one resolved item in a template: conditions from
// the item, overrides only where it differs from the catalog default.
export function membershipFromResolved(cat, templateId, it, order = 0, existing = null) {
  const m = existing || newMembership({ templateId, itemId: cat.id });
  m.templateId = templateId;
  m.itemId = cat.id;
  m.order = order;
  m.seasons = asArray(it.seasons).slice();
  m.contexts = asArray(it.contexts).slice();
  m.transports = asArray(it.transports).slice();
  m.catering = asArray(it.catering).slice();
  m.weather = asArray(it.weather).filter((w) => WEATHER_CONDITION_IDS.includes(w));
  m.container = it.container !== cat.container ? it.container : '';
  m.section = it.section || '';   // purely per-template — always stored, no catalog default
  m.phase = it.phase !== cat.phase ? it.phase : '';
  m.itemType = it.itemType !== cat.itemType ? it.itemType : '';
  m.qty = it.qty || '';
  m.note = it.note || '';
  return coerceMembership(m);
}

// Rebuild a today-shaped item (as a template would hold it) from a catalog item
// plus one membership: the membership's conditions replace the item's, and any
// override wins over the item's default. The result is byte-compatible with what
// the rest of the app already consumes (buildTotalEntries, editors, review…).
export function resolveMembership(item, m) {
  const base = coerceItem({ ...item });
  const mm = coerceMembership({ ...m });
  return coerceItem({
    ...base,
    id: base.id,
    seasons: mm.seasons.slice(),
    contexts: mm.contexts.slice(),
    transports: mm.transports.slice(),
    catering: mm.catering.slice(),
    weather: mm.weather.slice(),
    container: mm.container || base.container,
    section: mm.section || '',   // per-template section id ('' = none); not an item default
    phase: mm.phase || base.phase,
    itemType: mm.itemType || base.itemType,
    qty: mm.qty || base.qty || '',
    note: mm.note || base.note || '',
  });
}

// Every resolved item for a template, in membership order.
export function resolveTemplateItems(template, catalog, memberships) {
  const itemsById = catalog instanceof Map ? catalog : new Map(asArray(catalog).map((i) => [i.id, i]));
  const mine = asArray(memberships)
    .filter((m) => m.templateId === template.id)
    .slice()
    .sort((a, b) => ((a.order || 0) - (b.order || 0))); // preserve item order within the template
  const out = [];
  for (const m of mine) {
    const item = itemsById.get(m.itemId);
    if (!item) continue;
    out.push(resolveMembership(item, m));
  }
  return out;
}

// A template rebuilt into today's list shape (id/name/group/role/… + resolved
// items) — the bridge that lets existing list-consuming code run unchanged.
export function resolveTemplate(template, catalog, memberships) {
  return coerceList({ ...template, items: resolveTemplateItems(template, catalog, memberships) });
}

// --- Migration engine: fold copy-based lists into the relational shape ---

// Count occurrences; a plain Map keeps INSERTION order so "first wins" on ties.
function _tally(values) {
  const m = new Map();
  for (const v of values) m.set(v, (m.get(v) || 0) + 1);
  return m;
}
// Most frequent value; ties resolve to the first-seen (stable to source order).
function _mostCommon(values, fallback) {
  const present = values.filter((v) => v !== '' && v != null);
  if (!present.length) return fallback;
  let best = null; let bestN = -1;
  for (const [v, n] of _tally(present)) if (n > bestN) { best = v; bestN = n; }
  return best;
}
const _firstNonEmpty = (values) => values.find((v) => v !== '' && v != null) ?? '';

// Merge the N copies of one name into a single canonical catalog item. Intrinsic
// fields are auto-resolved: text/category by majority (first wins ties), booleans
// by "true if any copy has it" (the safe superset), weight by first known value.
function buildCatalogItem(copies) {
  // Swedish alias: prefer the most common wording, breaking ties toward the longest.
  const swedishes = copies.map((c) => (c.swedish || '').trim()).filter(Boolean);
  let swedish = '';
  if (swedishes.length) {
    let bestN = -1;
    for (const [v, n] of _tally(swedishes)) if (n > bestN || (n === bestN && v.length > swedish.length)) { swedish = v; bestN = n; }
  }
  const anyTrue = (f) => copies.some((c) => !!c[f]);
  const longestSub = copies.map((c) => asArray(c.sub)).sort((a, b) => b.length - a.length)[0] || [];
  return newItem({
    name: _mostCommon(copies.map((c) => c.name), copies[0].name),
    swedish,
    category: _mostCommon(copies.map((c) => c.category), CATEGORY_DEFAULT),
    container: _mostCommon(copies.map((c) => c.container), 'Carry-on / hand luggage'),   // the DEFAULT
    phase: _mostCommon(copies.map((c) => c.phase).filter((p) => PHASE_IDS.includes(p)), 'week'), // the DEFAULT
    itemType: _mostCommon(copies.map((c) => c.itemType), 'item'),
    charging: anyTrue('charging'),
    chargeType: _firstNonEmpty(copies.map((c) => c.chargeType)),
    liquid: anyTrue('liquid'),
    restricted: anyTrue('restricted'),
    perNight: anyTrue('perNight'),
    shortList: anyTrue('shortList'),
    weight: (copies.map((c) => Number(c.weight)).find((w) => w > 0)) || 0,
    storage: _firstNonEmpty(copies.map((c) => c.storage)),
    sub: longestSub.slice(),
    // Descriptive / ownership metadata: first known value wins (intrinsic to the item).
    color: _firstNonEmpty(copies.map((c) => c.color)),
    size: _firstNonEmpty(copies.map((c) => c.size)),
    manufacturer: _firstNonEmpty(copies.map((c) => c.manufacturer)),
    model: _firstNonEmpty(copies.map((c) => c.model)),
    owner: _firstNonEmpty(copies.map((c) => c.owner)),
    acquired: _firstNonEmpty(copies.map((c) => c.acquired)),
    price: (copies.map((c) => Number(c.price)).find((p) => p > 0)) || 0,
    currency: _firstNonEmpty(copies.map((c) => c.currency)),
    purchaseLink: _firstNonEmpty(copies.map((c) => c.purchaseLink)),
    expiry: _firstNonEmpty(copies.map((c) => c.expiry)),
    condition: _firstNonEmpty(copies.map((c) => c.condition)),
    serial: _firstNonEmpty(copies.map((c) => c.serial)),
    qtyOwned: (copies.map((c) => Number(c.qtyOwned)).find((q) => q > 0)) || 0,
    warranty: _firstNonEmpty(copies.map((c) => c.warranty)),
    capacityL: (copies.map((c) => Number(c.capacityL)).find((v) => v > 0)) || 0,
    maxKg: (copies.map((c) => Number(c.maxKg)).find((v) => v > 0)) || 0,
    // Conditions (incl. weather), note and qty are contextual → they live on the
    // membership, so the catalog item keeps them empty.
    seasons: [], contexts: [], transports: [], catering: [], weather: [],
    note: '', qty: '',
  });
}

// The membership for one original copy: its conditions, plus overrides only where
// the copy differs from the canonical item's default (kept sparse on purpose).
function membershipFromCopy(catItem, templateId, copy) {
  return newMembership({
    itemId: catItem.id,
    templateId,
    seasons: asArray(copy.seasons).slice(),
    contexts: asArray(copy.contexts).slice(),
    transports: asArray(copy.transports).slice(),
    catering: asArray(copy.catering).slice(),
    weather: asArray(copy.weather).slice(),
    container: copy.container !== catItem.container ? copy.container : '',
    section: copy.section || '',
    phase: copy.phase !== catItem.phase ? copy.phase : '',
    itemType: copy.itemType !== catItem.itemType ? copy.itemType : '',
    qty: copy.qty || '',
    note: copy.note || '',
  });
}

// One-time migration: turn today's copy-based building-block lists into the
// relational shape. Returns { items, memberships, templates } where templates are
// the same lists minus their inline items (they now reference items via
// memberships). Same-named items (by normName) are merged into one catalog item.
export function buildCatalog(lists) {
  const groups = new Map(); // normName -> [copies], insertion-ordered
  for (const l of asArray(lists)) {
    for (const it of asArray(l.items)) {
      if (!String(it.name || '').trim()) continue;
      const k = normName(it.name);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(it);
    }
  }
  const items = [];
  const byName = new Map(); // normName -> catalog item
  for (const [k, copies] of groups) {
    const cat = buildCatalogItem(copies);
    items.push(cat);
    byName.set(k, cat);
  }
  const templates = [];
  const memberships = [];
  for (const l of asArray(lists)) {
    templates.push(coerceList({ ...l, items: [] }));
    let order = 0;
    for (const it of asArray(l.items)) {
      if (!String(it.name || '').trim()) continue;
      const cat = byName.get(normName(it.name));
      const m = membershipFromCopy(cat, l.id, it);
      m.order = order++;   // preserve the item's position within its template
      memberships.push(m);
    }
  }
  return { items, memberships, templates };
}

// ============================================================================
// DATABASE OVERVIEW ("maintenance mode") — one line per real item, across all
// templates, with duplicate surfacing. Pure so it can be unit-tested; the UI
// renders it as a scannable table for keeping the whole catalog current.
// ============================================================================

// One row per unique catalog item, gathered from the RESOLVED lists. Because a
// catalog item keeps the SAME id wherever it is resolved, deduping by id collapses
// the copies a single item shows as across its templates into one line, and gathers
// every template it belongs to (list id, name and role). Rows are name-sorted.
export function catalogRows(lists) {
  const byId = new Map();
  for (const l of asArray(lists)) {
    for (const it of asArray(l.items)) {
      if (!it || !String(it.name || '').trim()) continue;
      const key = it.id || `name:${normName(it.name)}`;
      if (!byId.has(key)) byId.set(key, { id: key, name: it.name, item: it, templates: [] });
      const row = byId.get(key);
      if (!row.templates.some((t) => t.id === l.id)) {
        row.templates.push({ id: l.id, name: l.name || '', role: l.role || '' });
      }
    }
  }
  const rows = [...byId.values()];
  rows.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));
  return rows;
}

// A loose, forgiving key for spotting probable duplicates: normalised name with
// punctuation dropped, words naively singularised (a trailing -s, but not -ss),
// and spaces removed — so "Sunglasses", "Sun glasses" and "sunglass" all collapse
// to one key. Deliberately generous: this only SURFACES pairs for a human to judge,
// it never merges anything on its own.
export function dupeKey(name) {
  const base = normName(name).replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!base) return '';
  return base.split(' ')
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .join('');
}

// Groups of overview rows that look like duplicates of each other (2+ distinct
// catalog items sharing a dupeKey). `exact` marks a group whose members share an
// identical normalised name (a true stored duplicate) as opposed to a near-match.
// Groups are name-sorted for a stable display order.
export function duplicateGroups(rows) {
  const map = new Map();
  for (const r of asArray(rows)) {
    const k = dupeKey(r.name);
    if (!k) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  const out = [];
  for (const [key, group] of map) {
    if (group.length < 2) continue;
    const names = new Set(group.map((r) => normName(r.name)));
    out.push({ key, exact: names.size === 1, rows: group });
  }
  out.sort((a, b) => (a.rows[0].name || '').localeCompare(b.rows[0].name || '', undefined, { sensitivity: 'base' }));
  return out;
}

// The set of row ids caught in any duplicate group — lets the table highlight them.
export function duplicateIds(rows) {
  const ids = new Set();
  for (const g of duplicateGroups(rows)) for (const r of g.rows) ids.add(r.id);
  return ids;
}

// Rows for a flat spreadsheet export: one row per Total-List entry, in
// timeline -> container order.
export function totalListRows(event, lists) {
  void lists;
  const rows = [];
  for (const g of entriesByPhase(event.entries)) {
    for (const cg of groupByContainer(g.entries)) {
      for (const e of cg.entries) {
        rows.push({
          Phase: g.phase.label,
          Container: e.container || '',
          Item: e.name || '',
          Qty: e.qty || '',
          Packed: e.checked ? 'yes' : '',
          Note: e.note || '',
        });
      }
    }
  }
  return rows;
}

