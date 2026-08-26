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
//
// EDITABLE AND SYNCED (v118). The seven below are only the factory setting: the
// live list is whatever is in the `phases` store, which the user edits in
// Settings → When. Unlike the Packers, Owners, Conditions and the storage places —
// all of which live on their own device — this list SYNCS, because a phase is
// stamped on every item, every membership, every trip entry and every to-do, so a
// phase missing on one device would make the same item read as a different "When"
// there.
//
// Each phase carries:
//   id        stable string — what items actually store. NEVER changes on a rename.
//   label     what you read
//   hint      the small line under it in the picker
//   emoji     his pick, like a template cover or a kit (see setPhases)
//   color     one of TEMPLATE_COLORS, or any hex
//   task      true = holds to-dos rather than physical items (Preparations)
//   leadDays  how many days before departure this phase becomes due — drives the
//             "pack this now" nudge. -1 means "after the trip".
//   order     position in the timeline; the list is always sorted by it
//
// The built-in ids are DELIBERATELY STABLE ('prep', 'week', …) so that two devices
// seeding this table independently produce the same seven primary keys and merge
// into one list instead of doubling it — the lesson from the 880-item duplication.
export const DEFAULT_PHASES = Object.freeze([
  Object.freeze({ id: 'prep',      label: 'Preparations',                    task: true,  leadDays: 30, emoji: '📋', color: '#7c5cd6', hint: 'Book, cancel, charge, arrange — done ahead of time.' }),
  Object.freeze({ id: 'week',      label: '≥1 week ahead',                   task: false, leadDays: 7,  emoji: '📦', color: '#3b82f6', hint: 'Things you don’t use at home — pack early.' }),
  Object.freeze({ id: 'daybefore', label: 'Day before (stage / move to RV)', task: false, leadDays: 1,  emoji: '🌙', color: '#06b6d4', hint: 'Pack and stage the day before departure.' }),
  Object.freeze({ id: 'morning',   label: 'Morning list',                    task: false, leadDays: 0,  emoji: '☀️', color: '#f59e0b', hint: 'Packed the morning of — used the night before / that morning.' }),
  Object.freeze({ id: 'door',      label: 'At the front door',               task: false, leadDays: 0,  emoji: '🚪', color: '#22c55e', hint: 'Last check as you leave (Vid ytterdörren).' }),
  Object.freeze({ id: 'wear',      label: 'Wear / carry on the day',         task: false, leadDays: 0,  emoji: '👕', color: '#ec4899', hint: 'Worn or carried, not packed away.' }),
  Object.freeze({ id: 'after',     label: 'After / recovery',                task: false, leadDays: -1, emoji: '🛁', color: '#14b8a6', hint: 'For after the activity — shower, change, recovery (Efter).' }),
]);
export const PHASE_DEFAULT_EMOJI = '📦';

// The live list and its ids. BOTH are mutated IN PLACE by setPhases — never
// reassigned — because every other module imported these bindings and holds the
// same array. Replacing them would leave those importers reading a stale copy.
export const PHASES = DEFAULT_PHASES.map((p) => ({ ...p }));
export const PHASE_IDS = PHASES.map((p) => p.id);

export function coercePhase(p, i = 0) {
  const o = (p && typeof p === 'object') ? p : {};
  const lead = Number(o.leadDays);
  return {
    id: String(o.id || '').trim().slice(0, 40),
    label: String(o.label || '').trim().slice(0, 60),
    hint: String(o.hint || '').trim().slice(0, 200),
    emoji: (typeof o.emoji === 'string' && o.emoji.trim()) ? o.emoji.trim().slice(0, 8) : PHASE_DEFAULT_EMOJI,
    color: (typeof o.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(o.color)) ? o.color : TEMPLATE_COLORS[i % TEMPLATE_COLORS.length],
    task: !!o.task,
    leadDays: Number.isFinite(lead) ? Math.max(-1, Math.min(365, Math.round(lead))) : 0,
    order: Number.isFinite(Number(o.order)) ? Number(o.order) : i,
  };
}
// A new phase earns its id from its name (so it reads sensibly in a backup),
// falling back to a timestamp when the name is all punctuation. `taken` are ids
// already in use, which the new one must not collide with.
export function newPhase(label, taken = [], partial = {}) {
  const base = String(label || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
  let candidate = base || `phase-${Date.now().toString(36)}`;
  let n = 2;
  while (taken.includes(candidate)) candidate = `${base || 'phase'}-${n++}`;
  return coercePhase({ id: candidate, label, ...partial }, taken.length);
}
// Install a phase list. Anything unusable (no id, no label, a duplicate id) is
// dropped; an empty result falls back to the factory seven rather than leaving the
// app with no phases at all — every item would then have nowhere to be.
// The result is always sorted by `order`, and the orders renumbered 0..n-1 so two
// devices that edited the list independently still agree on the timeline.
export function setPhases(list) {
  const seen = new Set();
  const clean = asArray(list).map((p, i) => coercePhase(p, i)).filter((p) => {
    if (!p.id || !p.label || seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
  // Sort by order, then by ID as a tiebreak. The tiebreak is load-bearing, not
  // tidiness: two phases can genuinely end up sharing an order (an added one is
  // appended at the end, and the other device may append too), and without a
  // deterministic second key each device would renumber them in whatever order it
  // happened to read them — then write that back and fight the other device.
  const next = (clean.length ? clean : DEFAULT_PHASES.map((p, i) => coercePhase(p, i)))
    .sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id))
    .map((p, i) => ({ ...p, order: i }));
  PHASES.length = 0;
  PHASES.push(...next);
  PHASE_IDS.length = 0;
  PHASE_IDS.push(...next.map((p) => p.id));
  return PHASES;
}
// Have the phases been changed from the factory seven? (Drives the Settings
// summary line, and whether a backup bothers to carry them.)
export function phasesCustomised(list = PHASES) {
  if (list.length !== DEFAULT_PHASES.length) return true;
  return list.some((p, i) => {
    const d = DEFAULT_PHASES[i];
    return p.id !== d.id || p.label !== d.label || p.emoji !== d.emoji
      || p.color !== d.color || p.task !== !!d.task || p.leadDays !== d.leadDays;
  });
}
// The phase record for an id. Unlike before v118 this does NOT fall back to a real
// phase for an unknown id — callers that need something to draw use `phaseOrFallback`
// — because silently answering "≥1 week ahead" is what used to retag items.
export function phase(id) { return PHASES.find((p) => p.id === id) || null; }
// Something drawable for any id at all, including one this device doesn't know
// (set on the other device, or on a phase since removed). It keeps the raw id as
// its label so nothing ever disappears from a packing list.
export function phaseOrFallback(id) {
  return phase(id) || {
    id: String(id || ''), label: String(id || '') || 'Unsorted', hint: '',
    emoji: '❓', color: '#64748b', task: false, leadDays: 0, order: PHASES.length,
  };
}
export function phaseLabel(id) { return phaseOrFallback(id).label; }
export function phaseEmoji(id) { return phaseOrFallback(id).emoji; }
export function phaseColor(id) { return phaseOrFallback(id).color; }
// How many days before departure this phase is due. Was the fixed PHASE_LEAD_DAYS
// table until phases became editable.
export function phaseLeadDays(id) { return phaseOrFallback(id).leadDays; }
// Where a phase sits in the timeline. An id this device doesn't know sorts to the
// END rather than into the middle of the list, so it is visible, not buried.
export function phaseOrder(id) { const i = PHASE_IDS.indexOf(id); return i < 0 ? PHASE_IDS.length : i; }
// The id a brand-new item should get: the first non-task phase, so a new thing
// lands somewhere you actually pack. Falls back to the first phase of any kind.
export function defaultPhaseId() {
  const p = PHASES.find((x) => !x.task) || PHASES[0];
  return p ? p.id : '';
}

// Activity GROUPS — the top level Martin organises his life activities under.
// Every building-block list belongs to one of these (or '' = ungrouped / utility list).
export const GROUPS = [
  { id: 'GA',  label: 'Goal Activity',                  hint: 'Life activities that matter — Travel, Golf, Hiking, Diving…' },
  { id: 'WET', label: 'Workout, Exercise & Training',   hint: 'Swim, Bike, Run, Strength, Mobility, Breath work.' },
  { id: 'OE',  label: 'Other Events',                   hint: 'Small nice things — a coffee, a winter bath, a walk, the movies.' },
];
export const GROUP_IDS = GROUPS.map((g) => g.id);

// The order activities are offered in inside a group. Alphabetical is the wrong
// order for training: Swim/Bike/Run is race order, and the gentler things belong
// at the end. Only names listed here are placed; anything else — a list you added
// or renamed — falls in after them, alphabetically, so nothing can go missing.
export const ACTIVITY_ORDER = {
  WET: ['Swim', 'Bike', 'Run', 'Strength', 'Mobility', 'Breath work'],
};
export function orderActivities(groupId, lists) {
  const wanted = ACTIVITY_ORDER[groupId];
  const arr = asArray(lists).slice();
  if (!wanted) return arr;
  const rank = new Map(wanted.map((n, i) => [normName(n), i]));
  const at = (l) => (rank.has(normName(l && l.name)) ? rank.get(normName(l.name)) : Number.MAX_SAFE_INTEGER);
  return arr.sort((a, b) => (at(a) - at(b)) || String(a.name || '').localeCompare(String(b.name || '')));
}

export function group(id) { return GROUPS.find((g) => g.id === id) || null; }
export function groupLabel(id) { const g = group(id); return g ? g.label : ''; }

// --- Template covers --------------------------------------------------------
// A template can carry an emoji + colour that give it a face on the Templates
// grid. Both are optional: a template with no cover set still gets a default
// glyph and a stable, name-derived colour, so the grid looks varied out of the
// box and only needs a tap to personalise.
export const TEMPLATE_DEFAULT_EMOJI = '📋';
export const TEMPLATE_COLORS = ['#7c5cd6', '#3b82f6', '#06b6d4', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#8b5cf6', '#64748b'];

export function listEmoji(list) {
  return (list && typeof list.emoji === 'string' && list.emoji.trim()) ? list.emoji.trim() : TEMPLATE_DEFAULT_EMOJI;
}

// The cover colour for a template: its own colour if set, else a stable hashed
// pick from the palette keyed on the template id (falls back to the name), so
// every template reads as a distinct colour before anyone customises it.
export function listColor(list) {
  if (list && typeof list.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(list.color)) return list.color;
  const key = (list && (list.id || list.name)) ? String(list.id || list.name) : '';
  let hsh = 0;
  for (let i = 0; i < key.length; i++) hsh = (hsh * 31 + key.charCodeAt(i)) >>> 0;
  return TEMPLATE_COLORS[hsh % TEMPLATE_COLORS.length];
}

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
//
// The four below are what the app ships with, but the list is EDITABLE: you can
// rename, reorder, add and remove conditions in Settings. Two behaviours that used
// to be hardwired to the id 'retire' are now properties of whichever condition you
// point them at, so a condition you invent can do the same job:
//
//   tone     '' | 'warn' | 'danger'  — whether (and how loudly) the item row badges it
//   replace  true                    — this means "needs replacing": it raises the
//                                      badge as a replace prompt and feeds the
//                                      shopping list's suggestions
//
// `DEFAULT_ITEM_CONDITIONS` is the factory setting, kept so Settings can offer a
// reset and so a device with nothing stored still behaves exactly as before.
export const DEFAULT_ITEM_CONDITIONS = Object.freeze([
  Object.freeze({ id: 'new',    label: 'New',             tone: '',       replace: false }),
  Object.freeze({ id: 'good',   label: 'Good',            tone: '',       replace: false }),
  Object.freeze({ id: 'worn',   label: 'Worn',            tone: 'warn',   replace: false }),
  Object.freeze({ id: 'retire', label: 'Needs replacing', tone: 'danger', replace: true }),
]);
export const CONDITION_TONES = [
  { id: '',       label: 'No badge' },
  { id: 'warn',   label: 'Amber badge' },
  { id: 'danger', label: 'Red badge' },
];
const CONDITION_TONE_IDS = CONDITION_TONES.map((t) => t.id);

// The live list, and its ids. BOTH are mutated IN PLACE by setItemConditions —
// never reassigned — because every other module imported these bindings and holds
// the same array. Replacing them would leave those importers reading a stale copy.
export const ITEM_CONDITIONS = DEFAULT_ITEM_CONDITIONS.map((c) => ({ ...c }));
export const ITEM_CONDITION_IDS = ITEM_CONDITIONS.map((c) => c.id);

export function coerceCondition(c) {
  const o = (c && typeof c === 'object') ? c : {};
  return {
    id: String(o.id || '').trim().slice(0, 40),
    label: String(o.label || '').trim().slice(0, 60),
    tone: CONDITION_TONE_IDS.includes(o.tone) ? o.tone : '',
    replace: !!o.replace,
  };
}
// A new condition earns its id from its name (so it reads sensibly in a backup),
// falling back to a timestamp when the name is all punctuation. `taken` are ids
// already in use, which the new one must not collide with.
export function newCondition(label, taken = []) {
  const base = String(label || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
  let candidate = base || `cond-${Date.now().toString(36)}`;
  let n = 2;
  while (taken.includes(candidate)) candidate = `${base || 'cond'}-${n++}`;
  return { id: candidate, label: String(label || '').trim().slice(0, 60), tone: '', replace: false };
}
// Install a condition list. Anything unusable (no id, no label, a duplicate id) is
// dropped; an empty result falls back to the factory four rather than leaving the
// app with no conditions at all.
export function setItemConditions(list) {
  const seen = new Set();
  const clean = asArray(list).map(coerceCondition).filter((c) => {
    if (!c.id || !c.label || seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
  const next = clean.length ? clean : DEFAULT_ITEM_CONDITIONS.map((c) => ({ ...c }));
  ITEM_CONDITIONS.length = 0;
  ITEM_CONDITIONS.push(...next);
  ITEM_CONDITION_IDS.length = 0;
  ITEM_CONDITION_IDS.push(...next.map((c) => c.id));
  return ITEM_CONDITIONS;
}
export function itemCondition(idv) { return ITEM_CONDITIONS.find((x) => x.id === idv) || null; }
// The display label for a condition id ('' → '' — an unrated item says nothing).
// An id this device doesn't know (set on another device, or on a condition since
// removed) is shown as itself rather than vanishing.
export function itemConditionLabel(idv) {
  const c = itemCondition(idv);
  if (c) return c.label;
  return idv ? String(idv) : '';
}
export function conditionTone(idv) { const c = itemCondition(idv); return c ? c.tone : ''; }
// Does this condition mean "needs replacing"? Drives the replace badge and the
// shopping list. Was hardwired to the id 'retire' until conditions became editable.
export function conditionReplaces(idv) { const c = itemCondition(idv); return !!(c && c.replace); }
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

// --- Photo references ------------------------------------------------------
// Photos used to be stored inline on the item as `data:image/jpeg;base64,…`
// strings. They are now held once in their own store and referenced by id, so
// an item stays small: reading, writing, backing up or syncing the catalogue no
// longer drags tens of megabytes of JPEG along with it.
//
// `isPhotoRef` is the discriminator both shapes are read through, so a database
// part-way through the migration (or an old backup file) still renders.
export function isPhotoRef(s) {
  return typeof s === 'string' && !!s && !s.startsWith('data:');
}
// The ids on an item, ignoring anything still inline.
export function photoRefs(item) {
  return asArray(item && item.photos).filter(isPhotoRef);
}
// The inline `data:` images still on an item — what the migration has to move.
export function inlinePhotos(item) {
  return asArray(item && item.photos).filter((p) => typeof p === 'string' && p.startsWith('data:'));
}
// Does anything in this collection still carry an inline image?
export function hasInlinePhotos(items) {
  return asArray(items).some((it) => inlinePhotos(it).length > 0);
}

// How many photos a single item may hold — keeps the editor tidy and bounds
// how large an exported/shared trip bundle can grow.
export const MAX_PHOTOS = 5;

// --- "Whose it is" ---------------------------------------------------------
// The field is `ownedBy`, NOT `owner`, and that is load-bearing.
//
// `owner` is a RESERVED property on every synced row: the sync addon stamps the
// signed-in account's address onto it (`K.owner || (K.owner = userId)`) on every
// single write, and uses it for access control. The app used `owner` for its own
// "whose thing is this" answer, so the two collided and every item in the
// catalogue silently came back owned by an e-mail address — which is then what
// showed on every item row, in the Care list and in the All-items table.
//
// Moving the app's answer to `ownedBy` ends the collision for good: the sync
// addon keeps `owner` to itself, the app never reads it again, and nothing the
// app writes can be overwritten. See migrateOwnerField() in db.js, which carries
// the old values across.
export const looksLikeEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v ?? '').trim());

// Turn a sign-in address into the name a person would actually use:
// "martin.schabbauer@icloud.com" → "Martin". Takes the part before the @, then
// its first word (splitting on . _ + -), and capitalises it. Falls back to the
// whole local part when that first word is too short to be a name ("m.s@…").
export function ownerNameFromEmail(addr) {
  const local = String(addr ?? '').trim().split('@')[0] || '';
  if (!local) return '';
  const first = local.split(/[._+-]+/).filter(Boolean)[0] || local;
  const word = first.length >= 2 ? first : local;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function coerceItem(it) {
  if (!it || typeof it !== 'object') return it;
  it.seasons = asArray(it.seasons);
  it.contexts = asArray(it.contexts);
  it.transports = asArray(it.transports);
  it.catering = asArray(it.catering);
  it.weather = asArray(it.weather).filter((w) => WEATHER_CONDITION_IDS.includes(w)); // conditional-gear tags
  it.sub = asArray(it.sub);
  // Any non-empty phase id is KEPT, even one this device doesn't recognise. Phases
  // are editable and they SYNC, so a whitelist here would silently retag an item
  // the moment one device read a phase the other had just added — and unlike a
  // condition, a phase decides where the thing appears on the packing list. Only a
  // missing or non-string phase falls back to the default.
  it.phase = typeof it.phase === 'string' && it.phase.trim()
    ? it.phase.trim().slice(0, 40)
    : defaultPhaseId();
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
  it.consumable = !!it.consumable; // used up & restocked — surfaces on the pre-trip shopping list
  // Per-template grouping. On a resolved item this holds a SECTION ID (pointing at
  // its template's `sections`); on a trip line it holds the section's DISPLAY NAME
  // (resolved from the source template, so same-named sections merge across lists).
  // '' = no section. It is contextual (per membership), never intrinsic to the item.
  it.section = typeof it.section === 'string' ? it.section : '';
  // Kit membership — the NAME of the kit this item is packed as part of on a trip
  // (e.g. "Charging kit"). Contextual, never a catalog default: it flows onto the
  // trip line so the packing list can cluster kit-mates together. '' = not in a kit.
  it.kit = typeof it.kit === 'string' ? it.kit : '';
  // Who packs this — the assigned person's NAME ('' = anyone / nobody in particular).
  // INTRINSIC since v133: on a catalog item it is the standing answer to "whose job
  // is this to pack", set beside Owner in the item editor; `entryFromItem` carries it
  // onto every trip line built from that item, where it can still be changed for that
  // one trip. It rides on the entry, travels in the share bundle, and drives the
  // "whose stuff" filter. (Before v133 it was trip-line only and always blank in the
  // catalog, so an old backup simply arrives with no defaults set — nothing breaks.)
  it.packer = typeof it.packer === 'string' ? it.packer : '';
  it.storage = typeof it.storage === 'string' ? it.storage : '';   // where it lives at home (free text)
  // Pictures of the item. `photos` holds REFERENCES (ids into the `photos` store),
  // not the images themselves — the full JPEGs are far too big to ride along in
  // every item read, write and (soon) sync. A legacy single `photo` string is
  // folded in and then dropped.
  //
  // During the one-time migration this array may still hold inline `data:` URLs
  // from before the split, so both shapes are tolerated here and `isPhotoRef()`
  // tells them apart. Anything left inline is converted on next load.
  it.photos = asArray(it.photos).filter((p) => typeof p === 'string' && p);
  if (!it.photos.length && typeof it.photo === 'string' && it.photo) it.photos = [it.photo];
  if (it.photos.length > MAX_PHOTOS) it.photos = it.photos.slice(0, MAX_PHOTOS);
  delete it.photo;
  // A small (≈140px) thumbnail of the first photo, kept ON the item so list rows
  // — which are built synchronously in the hundreds — can show a picture without
  // loading anything. A few KB each; the full images stay in the photos store.
  it.thumb = typeof it.thumb === 'string' ? it.thumb : '';
  it.maintenance = normalizeMaintenance(it.maintenance);           // care record, or null when unused
  // Optional descriptive / ownership metadata (all intrinsic to the item itself).
  it.color = typeof it.color === 'string' ? it.color : '';
  it.size = typeof it.size === 'string' ? it.size : '';
  it.manufacturer = typeof it.manufacturer === 'string' ? it.manufacturer : '';
  it.model = typeof it.model === 'string' ? it.model : '';         // product / model name
  // Whose item it is. Deliberately NOT called `owner` — see the note above
  // looksLikeEmail(). A legacy `owner` written before v117 is adopted here so an
  // old backup file still carries its owners across, but an address the sync
  // stamped there is ignored: it was never a name anyone typed.
  it.ownedBy = typeof it.ownedBy === 'string'
    ? it.ownedBy
    : (typeof it.owner === 'string' && !looksLikeEmail(it.owner) ? it.owner : '');
  it.acquired = isYMD(it.acquired) ? it.acquired : '';             // date acquired (YYYY-MM-DD)
  it.price = Number.isFinite(it.price) && it.price >= 0 ? it.price : 0; // 0 = unset
  it.currency = typeof it.currency === 'string' ? it.currency : '';
  it.purchaseLink = typeof it.purchaseLink === 'string' ? it.purchaseLink : '';
  it.expiry = isYMD(it.expiry) ? it.expiry : '';                   // expiry / replace-by date
  // Any non-empty condition id is KEPT, even one this device doesn't recognise.
  // Conditions are editable and live per-device, so a whitelist here would silently
  // erase a condition set on the other device the first time this one saved the item.
  it.condition = typeof it.condition === 'string' ? it.condition.trim().slice(0, 40) : '';
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
  // Cover: an optional emoji + colour that give the template a face on the
  // Templates grid. Both '' = fall back to the default glyph / a stable hashed
  // colour, so an un-customised template still looks distinct.
  l.emoji = (typeof l.emoji === 'string' && l.emoji.trim()) ? l.emoji.trim().slice(0, 4) : '';
  l.color = (typeof l.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(l.color)) ? l.color : '';
  // One container for everything in this template ('' = none, items decide for
  // themselves). Most templates are near-uniform in practice — on a run everything
  // goes in the duffel — so this saves setting the same bag on dozens of items. It
  // sits BETWEEN the item's own default and the per-list exception.
  l.defaultContainer = typeof l.defaultContainer === 'string' ? l.defaultContainer : '';
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
  e.laundry = !!e.laundry;   // laundry available on this trip -> cap per-night quantities (see qtyNights)
  if (typeof e.endDate !== 'string') e.endDate = '';   // return date; `nights` derives from start->end
  if (typeof e.destination !== 'string') e.destination = '';  // free text -> geocoded for weather
  e.weather = coerceWeather(e.weather);  // cached Open-Meteo snapshot, or null
  e.weatherOn = asArray(e.weatherOn).filter((w) => WEATHER_CONDITION_IDS.includes(w)); // conditions "forced on" for this trip: pack that tagged gear regardless of forecast/season
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
  a.kind = a.kind === 'shopping' ? 'shopping' : 'todo';           // 'todo' (Actions tab) | 'shopping' (buy-list on the Care tab)
  a.itemId = typeof a.itemId === 'string' ? a.itemId : '';        // '' = loose (not tied to an item)
  a.itemName = typeof a.itemName === 'string' ? a.itemName : '';  // cached item name, for display + orphan fallback
  a.priority = ACTION_PRIORITY_IDS.includes(a.priority) ? a.priority : 'normal';
  // Optional trip phase. Kept as-is even when unrecognised — see coerceItem.
  a.whenPhase = typeof a.whenPhase === 'string' ? a.whenPhase.trim().slice(0, 40) : '';
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
    text: '', kind: 'todo', itemId: '', itemName: '',
    priority: 'normal', whenPhase: '', whenDate: '',
    done: false, doneAt: '',
    createdAt: nowISO(), updatedAt: nowISO(),
    ...partial,
  });
}

// --- Kits (reusable bundles of items always packed together) ---
// A kit groups small catalog items you never want to pack separately — a charging
// kit, a wash bag, a first-aid pouch. It references its members by their stable
// catalog id, so a kit stays in sync as items are renamed. Adding a kit (to a
// template or a trip) drops in all its members at once, tagged with the kit's NAME
// so the packing list can cluster them under one "pack the whole kit" header.
export const KIT_DEFAULT_EMOJI = '🧰';

export function coerceKit(k) {
  if (!k || typeof k !== 'object') return k;
  k.name = typeof k.name === 'string' ? k.name : '';
  k.emoji = (typeof k.emoji === 'string' && k.emoji.trim()) ? k.emoji.trim() : '';
  k.note = typeof k.note === 'string' ? k.note : '';
  // Member catalog-item ids, de-duplicated, order preserved.
  const seen = new Set();
  k.itemIds = asArray(k.itemIds).filter((iid) => typeof iid === 'string' && iid && !seen.has(iid) && seen.add(iid));
  if (typeof k.createdAt !== 'string') k.createdAt = '';
  if (typeof k.updatedAt !== 'string') k.updatedAt = '';
  return k;
}

export function newKit(partial = {}) {
  return coerceKit({
    id: id(),
    name: '', emoji: '', note: '', itemIds: [],
    createdAt: nowISO(), updatedAt: nowISO(),
    ...partial,
  });
}

// The glyph shown for a kit on the packing list — its own emoji, or a default.
export function kitEmoji(kit) {
  return (kit && typeof kit.emoji === 'string' && kit.emoji.trim()) ? kit.emoji.trim() : KIT_DEFAULT_EMOJI;
}

// Split a flat list of entries into kit clusters + loose entries, preserving the
// original order: a loose entry stays where it is; the first time a kit is seen,
// its whole run (every entry in THIS list carrying that kit name) is emitted as one
// cluster at that position. Used to render "🧰 Charging kit" groups on the packing
// list. Returns [{ kit: name|'', entries: [...] }] — kit === '' means a loose entry.
export function clusterByKit(entries) {
  const out = [];
  const done = new Set();
  for (const e of asArray(entries)) {
    const k = (e && typeof e.kit === 'string' ? e.kit : '').trim();
    if (!k) { out.push({ kit: '', entries: [e] }); continue; }
    if (done.has(k)) continue;
    done.add(k);
    out.push({ kit: k, entries: asArray(entries).filter((x) => (x && typeof x.kit === 'string' ? x.kit : '').trim() === k) });
  }
  return out;
}

// --- Shopping list (pre-trip restock & replace) ---
// A buy-list is built on the actions store (kind 'shopping'); these pure helpers
// decide which items should be OFFERED for it and why.

// How soon before an item's replace-by / expiry date it starts wanting attention.
export const EXPIRY_SOON_DAYS = 30;

// Why an item wants buying, or '' if it doesn't. Most urgent reason wins: an
// explicit "Needs replacing" beats an already-expired date, which beats an expiring
// -soon date, which beats a plain consumable that just needs restocking.
export function shoppingReason(item, todayISO) {
  if (!item || typeof item !== 'object') return '';
  // Any condition flagged "needs replacing" qualifies — not just the built-in one.
  // The reason string stays fixed so its rank, its chip colour and the buy-list
  // wording don't change with whatever you named the condition.
  if (conditionReplaces(item.condition)) return 'Needs replacing';
  if (item.expiry) {
    const d = daysUntil(item.expiry, todayISO);
    if (d != null && d < 0) return 'Expired';
    if (d != null && d <= EXPIRY_SOON_DAYS) return 'Replace soon';
  }
  if (item.consumable) return 'Restock';
  return '';
}
// Sort rank so the buy-list shows the most urgent reasons first.
const SHOP_REASON_RANK = { 'Needs replacing': 0, Expired: 1, 'Replace soon': 2, Restock: 3 };

// Items worth buying before a trip: consumables, things marked "Needs replacing",
// and anything past (or near) its replace-by date. Retired ("not in use") items are
// skipped, as is anything already on the open buy-list (matched by item id). Pass
// the de-duplicated catalog as `items` and the current actions as `actions`.
export function shoppingSuggestions(items, actions, todayISO) {
  const onList = new Set(asArray(actions).filter((a) => a.kind === 'shopping' && !a.done && a.itemId).map((a) => a.itemId));
  const out = [];
  for (const it of asArray(items)) {
    if (!it || it.retired) continue;
    if (onList.has(it.id)) continue;
    const reason = shoppingReason(it, todayISO);
    if (!reason) continue;
    out.push({ item: it, reason });
  }
  out.sort((a, b) => (SHOP_REASON_RANK[a.reason] - SHOP_REASON_RANK[b.reason]) || (a.item.name || '').localeCompare(b.item.name || ''));
  return out;
}

// Open (still-to-buy) items on the shopping list — for the Home nudge + Care card.
export function openShoppingCount(actions) {
  return asArray(actions).filter((a) => a.kind === 'shopping' && !a.done).length;
}

// --- Packers (who packs what) ---
// Called "People" in the UI until v133; the internal key stays `people`, because
// rows have synced under that name since v120 and renaming it would strand them.
// A small managed roster of people (name + colour). An assignment stores the
// person's NAME on the trip line, so it's self-describing and survives a shared
// trip even on a device without the roster; the colour is only for display.
export const PERSON_COLORS = ['#3b82f6', '#a855f7', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#84cc16'];

export function coercePerson(p) {
  if (!p || typeof p !== 'object') return p;
  p.name = typeof p.name === 'string' ? p.name.trim() : '';
  p.color = (typeof p.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(p.color)) ? p.color : PERSON_COLORS[0];
  if (typeof p.id !== 'string' || !p.id) p.id = id();
  return p;
}
export function newPerson(partial = {}) {
  return coercePerson({ id: id(), name: '', color: PERSON_COLORS[0], ...partial });
}

// A stable colour for a person NAME: the roster's colour if known, else a hashed
// palette pick, so even a name from an imported trip (no roster entry) reads
// consistently. Returns '' for a blank name.
export function personColor(name, people = []) {
  const n = normName(name);
  if (!n) return '';
  const hit = asArray(people).find((p) => normName(p.name) === n);
  if (hit && hit.color) return hit.color;
  let hsh = 0;
  for (let i = 0; i < n.length; i++) hsh = (hsh * 31 + n.charCodeAt(i)) >>> 0;
  return PERSON_COLORS[hsh % PERSON_COLORS.length];
}

// Distinct packer names actually used across entries, in first-seen order.
export function assignedPeople(entries) {
  const seen = new Set();
  const out = [];
  for (const e of asArray(entries)) {
    const n = (e && typeof e.packer === 'string' ? e.packer.trim() : '');
    if (!n || seen.has(normName(n))) continue;
    seen.add(normName(n));
    out.push(n);
  }
  return out;
}

// Split entries by who packs them — the sub-grouping Packing Mode puts INSIDE each
// bag, so two people packing the same suitcase each get their own short block.
//
// `order` is the roster (Settings → Packers) so the blocks come out in the order
// you arranged your people in, not the alphabet — the person you are is then always
// in the same place on every screen. A name in use but not on the roster (from a
// shared trip) follows, A–Z, and the unassigned remainder is ALWAYS last: it is the
// pile still to be divided, so it should never head the list.
//
// The entries' own order is preserved within each block, so whatever the caller had
// already sorted by still holds.
export function groupByPacker(entries, order = []) {
  const rank = new Map();
  asArray(order).forEach((n, i) => { const k = normName(n); if (k && !rank.has(k)) rank.set(k, i); });
  const map = new Map();   // normalised name -> { packer (as written), entries }
  const none = [];
  for (const e of asArray(entries)) {
    const raw = (e && typeof e.packer === 'string' ? e.packer.trim() : '');
    if (!raw) { none.push(e); continue; }
    const k = normName(raw);
    if (!map.has(k)) map.set(k, { packer: raw, entries: [] });
    map.get(k).entries.push(e);
  }
  const known = [];
  const strays = [];
  for (const [k, g] of map) (rank.has(k) ? known : strays).push([k, g]);
  known.sort((a, b) => rank.get(a[0]) - rank.get(b[0]));
  strays.sort((a, b) => a[1].packer.localeCompare(b[1].packer, undefined, { sensitivity: 'base' }));
  const out = [...known, ...strays].map(([, g]) => g);
  if (none.length) out.push({ packer: '', entries: none });
  return out;
}

// --- The five author-made Settings lists, in ONE shared store ---------------
//
// Conditions · Trip presets · Packers · Owners · Storage places.
//
// Until v120 each of these lived in the browser's localStorage, which meant a list
// you AUTHORED on the Mac simply did not exist on the iPhone. That showed up
// differently in each one, and all five were real:
//   • a condition invented on one device reached the other as raw text — the ITEM
//     carries the condition's id, and only the list holds its readable name;
//   • a trip preset saved on one was absent on the other with nothing to hint at
//     it, and nothing else in the data refers to a preset, so it could not heal;
//   • a person could be blue here and green there, because only the NAME travels
//     on a trip line and the colour lives in the roster;
//   • owners and storage places self-heal (both are plain text on the item), but
//     “Bedroom wardrobe” describes one house, not one device.
//
// The line drawn, deliberately: LISTS YOU AUTHOR SYNC; HOW A DEVICE LOOKS AND
// BEHAVES DOES NOT. The theme, the view mode, which Settings folds are open and
// this device's own backup dates all stay exactly where they were.
//
// All five share ONE store, and — the part that matters — ONE ROW PER ENTRY
// rather than one row per list. A row is the unit the sync merges, so a person
// added here and a place added there both survive. Holding a whole list in a
// single record would make the last device to save win outright and drop the
// other's additions without a trace.
//
// The row is deliberately plain:
//   id     `${kind}:${key}` — STABLE, so two devices that add “Garage shelf”
//          independently land on the SAME key and merge instead of doubling it
//          (the 880-item lesson). Never a random id.
//   kind   which of the five lists the row belongs to
//   key    its identity within that list: the normalised NAME for the name-keyed
//          lists; for a condition, its own slug id
//   name   the display spelling
//   order  position, for the lists where order is something you set
//   data   everything else, NESTED — so no field of ours can ever collide with the
//          `owner` and `realmId` properties the sync addon reserves for itself.
//          See what that collision cost in v117: 422 items stamped with an e-mail.
//
// 🚨 NOTHING IS EVER SEEDED INTO THIS STORE. The factory conditions, the factory
// people and the standard storage places live in the CODE; a kind with no rows
// means “use the defaults”, and your first real edit is what writes rows. v118
// seeded factory phases into shared data using stable ids and they landed exactly
// on top of Martin's customised rows and replaced them — stable ids prevent
// duplication precisely BY overwriting. Same mechanism, so: never seed.
export const SHARED_KINDS = Object.freeze(['conditions', 'presets', 'people', 'owners', 'places']);

// The starter roster. In the CODE only — an account that has never edited its Packers
// stores no rows at all, and both devices show these two straight from here.
export const DEFAULT_PEOPLE = Object.freeze([
  Object.freeze({ name: 'Martin', color: PERSON_COLORS[0] }),
  Object.freeze({ name: 'Anna', color: PERSON_COLORS[1] }),
]);

export function sharedRowId(kind, key) { return `${kind}:${normName(key)}`; }

export function coerceSharedRow(r, i = 0) {
  const o = (r && typeof r === 'object') ? r : {};
  const kind = SHARED_KINDS.includes(o.kind) ? o.kind : '';
  const key = normName(o.key).slice(0, 60);
  const data = (o.data && typeof o.data === 'object' && !Array.isArray(o.data)) ? o.data : {};
  return {
    id: (typeof o.id === 'string' && o.id) ? o.id : sharedRowId(kind, key),
    kind,
    key,
    name: String(o.name ?? '').trim().slice(0, 80),
    order: Number.isFinite(Number(o.order)) ? Number(o.order) : i,
    data,
  };
}

// The rows of one list, in a settled order. The id tiebreak is load-bearing, not
// tidiness: two devices both append, so two rows genuinely can share an `order`,
// and without a deterministic second key each device would sort them differently
// and then write that disagreement back at the other.
export function sharedRowsOfKind(rows, kind) {
  return asArray(rows)
    .map((r, i) => coerceSharedRow(r, i))
    .filter((r) => r.kind === kind && r.key && r.name)
    .sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id));
}

// --- conditions ---
// The key is the condition's slug id, but `data.cid` holds it VERBATIM as well:
// that id is stamped on every item, so it has to survive the round trip exactly,
// whatever normalising the key needed.
export function conditionsToRows(list) {
  const seen = new Set();
  const out = [];
  for (const raw of asArray(list)) {
    const c = coerceCondition(raw);
    if (!c.id || !c.label || seen.has(normName(c.id))) continue;
    seen.add(normName(c.id));
    out.push(coerceSharedRow({
      kind: 'conditions', key: c.id, name: c.label, order: out.length,
      data: { tone: c.tone, replace: c.replace, cid: c.id },
    }, out.length));
  }
  return out;
}
export function conditionsFromRows(rows) {
  return sharedRowsOfKind(rows, 'conditions')
    .map((r) => coerceCondition({ id: r.data.cid || r.key, label: r.name, tone: r.data.tone, replace: r.data.replace }));
}

// --- people ---
export function peopleToRows(list) {
  const seen = new Set();
  const out = [];
  for (const raw of asArray(list)) {
    const p = coercePerson({ ...(raw && typeof raw === 'object' ? raw : {}) });
    if (!p.name || seen.has(normName(p.name))) continue;
    seen.add(normName(p.name));
    out.push(coerceSharedRow({
      kind: 'people', key: p.name, name: p.name, order: out.length, data: { color: p.color },
    }, out.length));
  }
  return out;
}
export function peopleFromRows(rows) {
  // The person's `id` is the ROW's id, so it is the same on both devices — the
  // Settings list addresses its rows by it.
  return sharedRowsOfKind(rows, 'people')
    .map((r) => coercePerson({ id: r.id, name: r.name, color: r.data.color }));
}

// --- owners & storage places (name-only lists) ---
export function namesToRows(kind, names) {
  const seen = new Set();
  const out = [];
  for (const v of asArray(names)) {
    const name = String(typeof v === 'string' ? v : (v && v.name) || '').trim();
    const key = normName(name);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(coerceSharedRow({ kind, key, name, order: out.length }, out.length));
  }
  return out;
}
// A–Z. The order the Owners list has always been offered in, and the order every
// Owner dropdown still uses.
export function namesFromRows(rows, kind) {
  return sharedRowsOfKind(rows, kind).map((r) => r.name).sort((a, b) => a.localeCompare(b));
}
// The stored order instead — for Storage places, where since v125 the order is
// something you arrange yourself. `sharedRowsOfKind` has already sorted by `order`
// with the id as a tiebreak, so this is simply "don't re-sort it".
export function orderedNamesFromRows(rows, kind) {
  return sharedRowsOfKind(rows, kind).map((r) => r.name);
}
// Owners, most-owned first — the Settings list answers "whose is most of this?"
// before it answers "where is X in the alphabet". Ties settle A–Z so the order is
// stable and both devices, counting the same items, agree on it.
// `counts` is a Map of normalised name → number, as `ownerUsage()` builds.
export function ownersByUsage(names, counts) {
  const at = (v) => {
    const k = normName(v);
    const n = counts && typeof counts.get === 'function' ? counts.get(k) : (counts || {})[k];
    return Number(n) || 0;
  };
  return asArray(names).slice()
    .sort((a, b) => (at(b) - at(a)) || String(a).localeCompare(String(b)));
}

// --- trip presets ---
// Keyed by the normalised NAME, which quietly gives “Save as preset” the same
// replace-the-same-name behaviour it always had: the second save lands on the
// first one's key.
export function presetsToRows(list) {
  const seen = new Set();
  const out = [];
  for (const p of asArray(list)) {
    const name = String((p && p.name) || '').trim();
    if (!name || !p.config || seen.has(normName(name))) continue;
    seen.add(normName(name));
    out.push(coerceSharedRow({
      kind: 'presets', key: name, name, order: out.length,
      data: { config: p.config, createdAt: String((p && p.createdAt) || '') },
    }, out.length));
  }
  return out;
}
export function presetsFromRows(rows) {
  return sharedRowsOfKind(rows, 'presets')
    .filter((r) => r.data && r.data.config)
    .map((r) => ({ id: r.id, name: r.name, createdAt: r.data.createdAt || '', config: r.data.config }));
}

// One list → its rows, whichever of the five it is.
export function sharedRowsFrom(kind, list) {
  if (kind === 'conditions') return conditionsToRows(list);
  if (kind === 'people') return peopleToRows(list);
  if (kind === 'presets') return presetsToRows(list);
  if (kind === 'owners' || kind === 'places') return namesToRows(kind, list);
  return [];
}
// The factory list for a kind, or [] where there isn't one (nobody ships you a
// trip preset, and the owners list is derived from your own data).
export function defaultListFor(kind) {
  if (kind === 'conditions') return DEFAULT_ITEM_CONDITIONS.map((c) => ({ ...c }));
  if (kind === 'people') return DEFAULT_PEOPLE.map((p) => ({ ...p }));
  if (kind === 'places') return DEFAULT_STORAGE_LOCATIONS.slice();
  return [];
}
// Is this list still exactly what the app ships? The one question that decides
// whether a list is worth writing into shared data at all — see the seeding note
// at the top of this section.
export function isFactoryList(kind, list) {
  const def = defaultListFor(kind);
  if (!def.length) return false;
  const a = sharedRowsFrom(kind, list);
  const b = sharedRowsFrom(kind, def);
  if (a.length !== b.length) return false;
  return a.every((r, i) => r.id === b[i].id && r.name === b[i].name
    && JSON.stringify(r.data) === JSON.stringify(b[i].data));
}

// --- Is this device holding the account's WHOLE copy? -----------------------
//
// 🚨 THE FAULT THIS EXISTS TO CATCH, AND WHY IT HAS TO BE FOUND LOCALLY.
//
// When a release adds a synced table, the sync addon gives it one first, full
// download and then records it as done. A device that reaches the new table
// BEFORE the other device has written anything into it downloads nothing,
// records the table as done anyway, and from then on receives only rows that are
// newly CREATED — never an update to a row it has no copy of. So it sits on a
// fraction of the list for ever, and nothing about it looks broken: no error, no
// warning, and the app carries on because it deliberately tolerates a value it
// doesn't recognise (see `collectStorages`). That is how an iPhone held two
// storage places out of seventeen for a fortnight without saying a word.
//
// Two pushes from the healthy device were shipped to cure it (v121, v124). Both
// failed, and the second was PROVEN to reach the server — the rows arrived and
// were ignored, because they were updates to rows that device never had. The only
// thing that worked was pulling: Replace this device with the account copy, and
// then sign in again.
//
// So this does not try to fix it. It tries to NOTICE it, which is the part that
// was missing. The trick is that no server call is needed, because the evidence
// is already on the device: your items travel with the catalogue and they carry
// the answers — this rucksack is kept in the "Loft", that jacket is "Anna's",
// this one is "Worn out". Those arrived. If your gear points at fifteen storage
// places and the storage-place list has heard of two, the list did not arrive,
// and the device can work that out entirely on its own.
//
// Everything below is pure: no database, no network, no addon internals. That is
// deliberate — the sync path cannot be exercised in the preview (`databaseUrl` is
// blank there), so anything that mattered was built where it CAN be tested.

// The lists whose entries the rest of your data points at. `presets` is
// deliberately absent: nothing refers to a trip preset, so one going missing
// leaves no trace to find, and claiming otherwise would be a guess.
export const AUDITABLE_KINDS = Object.freeze(['places', 'owners', 'conditions', 'people', 'phases']);

export const AUDIT_LABELS = Object.freeze({
  places: 'Storage places',
  owners: 'Owners',
  conditions: 'Item conditions',
  people: 'Packers',
  phases: 'When',
});

// How an entry of each list is addressed by the data that points at it. Items
// store a condition's and a phase's ID, not its label — which is exactly why a
// missing one shows up as a slug rather than a name.
const AUDIT_KEY_OF = {
  places: (v) => (typeof v === 'string' ? v : (v && v.name) || ''),
  owners: (v) => (typeof v === 'string' ? v : (v && v.name) || ''),
  people: (v) => (v && typeof v === 'object' ? v.name : v) || '',
  conditions: (v) => (v && typeof v === 'object' ? v.id : v) || '',
  phases: (v) => (v && typeof v === 'object' ? v.id : v) || '',
};

// Every value this device's own data refers to, per list, normalised — plus, in
// `display`, the spelling it was actually written in. Comparing has to normalise
// ("Loft" and "loft" are one place), but SHOWING him a normalised key would put
// "basement / cellar" on screen where his items say "Basement / cellar". A list of
// what is missing is only useful if he recognises the entries in it.
export function referencedListValues({ lists = [], events = [], actions = [] } = {}) {
  const out = { display: {} };
  for (const k of AUDITABLE_KINDS) { out[k] = new Set(); out.display[k] = new Map(); }
  const add = (kind, v) => {
    const raw = typeof v === 'string' ? v.trim() : '';
    const t = normName(raw);
    if (!t) return;
    out[kind].add(t);
    if (!out.display[kind].has(t)) out.display[kind].set(t, raw);
  };
  for (const l of asArray(lists)) for (const it of asArray(l && l.items)) {
    if (!it) continue;
    add('places', it.storage);
    add('owners', it.ownedBy);
    add('people', it.packer);   // since v133 an item carries a standing packer of its own
    add('conditions', it.condition);
    add('phases', it.phase);
  }
  // Trip entries are self-contained copies, so they carry the same answers even
  // for gear that has since left the catalogue.
  for (const ev of asArray(events)) for (const e of asArray(ev && ev.entries)) {
    if (!e) continue;
    add('places', e.storage);
    add('people', e.packer);
    add('phases', e.phase);
  }
  for (const a of asArray(actions)) if (a) add('phases', a.phase);
  return out;
}

// One list, compared against what points at it. `inForce` is the list the app is
// actually showing — stored rows, or the code's defaults where there are none —
// because an entry supplied by the defaults is not missing, it is just not stored.
export function auditList(kind, referenced, inForce) {
  const keyOf = AUDIT_KEY_OF[kind];
  const used = [...((referenced && referenced[kind]) || [])];
  if (!keyOf) return { kind, used: used.length, listed: 0, missing: [], missingLabels: [] };
  const have = new Set();
  for (const v of asArray(inForce)) {
    const k = normName(keyOf(v));
    if (k) have.add(k);
  }
  const missing = used.filter((k) => !have.has(k)).sort();
  // A condition and a phase are referred to by their id, so what shows here is a
  // slug — which is the honest answer: that IS what the item is pointing at.
  const shown = (referenced && referenced.display && referenced.display[kind]) || new Map();
  return { kind, used: used.length, listed: have.size, missing, missingLabels: missing.map((k) => shown.get(k) || k) };
}

// A stray or two is ORDINARY and must never raise an alarm: remove a storage
// place you have stopped using and the items still standing in it keep the old
// name on purpose, so the place goes on being offered. What is not ordinary is a
// list that has heard of less than it has forgotten.
export const AUDIT_STRAY_TOLERANCE = 2;

// The verdict.
//
//  off     — nothing to compare against (not syncing, or nothing on the device).
//  ok      — every list accounts for what your gear points at, give or take strays.
//  suspect — one list has more gaps than strays explain. Worth a look.
//  broken  — a list has forgotten at least as much as it remembers. This is the
//            shape of a list that never downloaded, and the shape his iPhone had:
//            2 places listed, 15 unaccounted for.
export function auditDeviceLists({ referenced, inForce, signedIn = false, hasCatalogue = false } = {}) {
  const lists = AUDITABLE_KINDS.map((k) => auditList(k, referenced || {}, (inForce || {})[k]));
  const gappy = lists.filter((r) => r.missing.length > AUDIT_STRAY_TOLERANCE);
  const broken = gappy.filter((r) => r.missing.length >= r.listed);
  let level = 'ok';
  if (!signedIn || !hasCatalogue) level = 'off';
  else if (broken.length) level = 'broken';
  else if (gappy.length) level = 'suspect';
  return {
    level,
    lists,
    gappy: level === 'off' ? [] : gappy,
    broken: level === 'off' ? [] : broken,
    missingTotal: level === 'off' ? 0 : gappy.reduce((n, r) => n + r.missing.length, 0),
  };
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
    consumable: false, // used up & restocked (feeds the pre-trip shopping list)
    section: '',     // per-template section (a section id, resolved from the membership)
    kit: '',         // kit name this item is packed as part of ('' = none; contextual, like section)
    packer: '',      // whose job it is to pack this (person name; '' = anyone) — an item default that flows onto trip lines
    storage: '',     // where the physical item is kept at home (free text)
    photos: [],      // ids into the photos store (max MAX_PHOTOS)
    thumb: '',       // small inline thumbnail of the first photo, for list rows
    maintenance: null, // care record (notes/link/schedule/log) — see normalizeMaintenance
    // Optional descriptive / ownership metadata (all intrinsic to the item):
    color: '', size: '', manufacturer: '', model: '', ownedBy: '',
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
    emoji: '',          // cover glyph ('' = default 📋)
    color: '',          // cover colour ('' = stable hashed pick from TEMPLATE_COLORS)
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
    weatherOn: [],        // weather conditions "forced on" for this trip (Rain/Cold/…) — pulls in that tagged gear as a precaution, regardless of forecast
    catering: 'mixed',
    startDate: '',
    endDate: '',          // return date; trip length in nights derives from start->end
    nights: 0,            // trip length in nights (drives per-night quantity scaling)
    laundry: false,       // laundry available -> cap per-night quantities to a cycle's worth
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
    kit: item.kit || '',         // kit name carried onto the trip so the packing list can cluster kit-mates
    packer: item.packer || '',   // the item's standing packer becomes this trip's, still changeable per trip
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
      // Weather-conditional gear is normally held back (offered via the forecast).
      // But a trip can "force on" conditions (event.weatherOn) to pack that gear as a
      // precaution regardless of the forecast — e.g. cold-weather kit on a summer trip.
      const wtags = asArray(item.weather);
      if (wtags.length && !wtags.some((w) => asArray(event.weatherOn).includes(w))) continue;
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

// Group a trip's entries by phase, in timeline order.
//
// An entry whose phase this device doesn't recognise — set on the other device, or
// on a phase since removed — gets its OWN group at the end rather than being
// dropped into "≥1 week ahead". Before phases were editable that fallback was
// harmless; now it would quietly move things you had filed somewhere else.
export function entriesByPhase(entries) {
  const map = new Map(PHASES.map((p) => [p.id, []]));
  const strays = new Map();                       // unknown phase id → entries
  for (const e of asArray(entries)) {
    if (map.has(e.phase)) { map.get(e.phase).push(e); continue; }
    const key = e.phase || '';
    if (!strays.has(key)) strays.set(key, []);
    strays.get(key).push(e);
  }
  const known = PHASES.map((p) => ({ phase: p, entries: map.get(p.id) })).filter((g) => g.entries.length);
  const unknown = [...strays].map(([id, list]) => ({ phase: phaseOrFallback(id), entries: list }));
  return [...known, ...unknown];
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

// ---- Generic sort & group helpers for browsable catalogues ------------------
// Used by the Care tab's "All items" index (and available to any other list that
// grows big enough to need ordering). Both are pure: they take rows plus a
// function that pulls the value out of a row, and never touch the DOM.

// Sort rows by one field. `valOf(row)` returns the comparable value.
//   dir  'asc' | 'desc'
//   num  compare arithmetically (0 counts as "not recorded")
//   tie  optional comparator for equal values — never flipped, so ties always
//        settle the same friendly way (A–Z by name) in both directions.
// BLANKS ALWAYS SINK. A sort is for finding the things you HAVE recorded; if
// "Manufacturer, Z–A" led with 300 items that have no maker, the sort would be
// useless in one of its two directions.
export function sortRowsBy(rows, valOf, opts = {}) {
  const { dir = 'asc', num = false, tie = null } = opts;
  const isBlank = (v) => (num ? !(Number(v) > 0) : !String(v == null ? '' : v).trim());
  const flip = dir === 'desc' ? -1 : 1;
  return asArray(rows).slice().sort((a, b) => {
    const av = valOf(a); const bv = valOf(b);
    const ab = isBlank(av); const bb = isBlank(bv);
    if (ab !== bb) return ab ? 1 : -1;
    if (ab && bb) return tie ? tie(a, b) : 0;
    const c = num
      ? (Number(av) - Number(bv))
      : String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' });
    if (c === 0) return tie ? tie(a, b) : 0;
    return c * flip;
  });
}

// Bucket rows for readability. `keyOf(row)` returns the bucket's name ('' = not
// set). Buckets named in `order` come first in that order, the rest follow
// alphabetically, and the "not set" bucket is ALWAYS last — it teaches nothing,
// so it should never head the page. Row order within a bucket is preserved, so
// the chosen sort still applies inside each group.
export function groupRowsBy(rows, keyOf, opts = {}) {
  const { order = [], emptyLabel = 'Not set' } = opts;
  const map = new Map();
  for (const r of asArray(rows)) {
    const k = String(keyOf(r) == null ? '' : keyOf(r)).trim();
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  const rank = new Map(asArray(order).map((o, i) => [String(o).toLowerCase(), i]));
  const rankOf = (k) => (rank.has(k.toLowerCase()) ? rank.get(k.toLowerCase()) : Number.MAX_SAFE_INTEGER);
  const keys = [...map.keys()].sort((a, b) => {
    if (!a !== !b) return a ? -1 : 1;                    // the empty bucket last
    const d = rankOf(a) - rankOf(b);
    if (d) return d;
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  });
  return keys.map((k) => ({ key: k, label: k || emptyLabel, rows: map.get(k) }));
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

// When laundry is available you wash and re-wear, so per-night items (socks,
// underwear, tees) don't need one per night. This caps the "nights" used for
// quantity scaling to a sensible cycle's worth. Short trips are unaffected
// (min never raises the count); only display quantities change, not the real
// trip length. Feed the result to effectiveQty / bagLoads / packingFlags.
export const LAUNDRY_CAP_NIGHTS = 4;
export function qtyNights(event) {
  const n = Number(event && event.nights) || 0;
  return (event && event.laundry && n > LAUNDRY_CAP_NIGHTS) ? LAUNDRY_CAP_NIGHTS : n;
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

// --- The calendar behind the trip date picker (v125) ---
//
// Everything here is UTC, deliberately, because that is the footing the rest of
// the app's dates already stand on (`nightsBetween`, `endFromNights`, `daysUntil`
// all parse `YYYY-MM-DDT00:00:00Z`). Build a grid from a LOCAL `new Date(y, m, d)`
// instead and the picker in one time zone hands back the day before the one that
// was tapped — the classic off-by-one that only shows up east or west of the
// machine it was written on.

// 'YYYY-MM' for a date, '' if it isn't one.
export function monthKey(iso) {
  const s = String(iso || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) ? s.slice(0, 7) : '';
}
// Step a 'YYYY-MM' by whole months, rolling the year over in both directions.
export function shiftMonth(key, delta = 0) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key || ''));
  if (!m) return '';
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + Math.trunc(Number(delta) || 0);
  const year = Math.floor(total / 12);
  const month = total - year * 12;
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}`;
}
// One month as a fixed 6×7 grid of ISO days, so every month draws the same height
// and the panel never jumps as you page through it. `weekStart` is 1 for Monday
// (Europe) / 0 for Sunday. Cells outside the month are still real dates — they are
// simply marked, so a tap on one can still pick that day.
export function monthGrid(key, weekStart = 1) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key || ''));
  if (!m) return { key: '', year: 0, month: 0, days: [] };
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const first = Date.UTC(year, month, 1);
  const ws = Number(weekStart) === 0 ? 0 : 1;
  // How many days of the previous month to show before the 1st.
  const lead = (new Date(first).getUTCDay() - ws + 7) % 7;
  const days = [];
  for (let i = 0; i < 42; i += 1) {
    const t = first + (i - lead) * 86400000;
    const d = new Date(t);
    days.push({ iso: d.toISOString().slice(0, 10), inMonth: d.getUTCMonth() === month });
  }
  return { key: `${m[1]}-${m[2]}`, year, month, days };
}
// Where one day sits in the chosen range — what the cell is painted from.
// 'only' is a start with no end yet (and a same-day start+end), which is why it is
// its own state rather than a start that happens to look unfinished.
export function rangeCellState(iso, start, end) {
  const d = String(iso || '').slice(0, 10);
  const a = String(start || '').slice(0, 10);
  const b = String(end || '').slice(0, 10);
  if (!d || !a) return '';
  if (!b) return d === a ? 'only' : '';
  if (a === b) return d === a ? 'only' : '';
  if (d === a) return 'start';
  if (d === b) return 'end';
  return d > a && d < b ? 'between' : '';
}
// Two picked days in the order a trip happens. Tapping an earlier day second is a
// correction, not an error, so it becomes the new start rather than a red warning.
export function orderRange(a, b) {
  const x = String(a || '').slice(0, 10);
  const y = String(b || '').slice(0, 10);
  if (!x) return [y, ''];
  if (!y) return [x, ''];
  return x <= y ? [x, y] : [y, x];
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
    const lead = phaseLeadDays(s.phase.id);
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
export const MAINTENANCE_SOON_DAYS = 14;
// Everything scheduled further out than this is real, but not worth scrolling past
// every time you open the Care tab — the list folds it away under "Later".
export const MAINTENANCE_UPCOMING_DAYS = 60;

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

// Split an ordered maintenance list into the sections the Care tab draws.
//
// The point is scrolling: "Overdue" and "Due soon" are what you act on, so they
// stay open; a service eight months out is real but is not today's business, so it
// folds. `fold: true` marks a section the screen collapses by default.
//
// `upcomingDays` is where the fold starts, measured from today — anything due
// further out than that drops from "Upcoming" into "Later". Rows keep the order
// they arrived in, so maintenanceList's urgency sort still governs inside a section.
export function careSections(rows, upcomingDays = MAINTENANCE_UPCOMING_DAYS) {
  const all = asArray(rows);
  const byState = (s) => all.filter((r) => r && r.status && r.status.state === s);
  const scheduledOk = byState('ok');
  const near = scheduledOk.filter((r) => r.status.days != null && r.status.days <= upcomingDays);
  const later = scheduledOk.filter((r) => !(r.status.days != null && r.status.days <= upcomingDays));
  return [
    { key: 'overdue',   state: 'overdue',   label: 'Overdue',                     fold: false, rows: byState('overdue') },
    { key: 'soon',      state: 'soon',      label: 'Due soon',                    fold: false, rows: byState('soon') },
    { key: 'upcoming',  state: 'ok',        label: 'Upcoming',                    fold: false, rows: near },
    { key: 'later',     state: 'ok',        label: 'Later',                       fold: true,  rows: later },
    { key: 'reference', state: 'reference', label: 'Reference only (no schedule)', fold: true, rows: byState('reference') },
  ];
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

// The trips that have BOTH coordinates and a start date, ordered oldest→newest,
// as a simple list of stops for the map's "journey" line. A place visited twice
// appears twice (the line can return to it); undated trips are pinned but left
// off the line, since we can't place them in time.
export function tripPath(events) {
  return (events || [])
    .map((e) => ({ e, c: eventCoords(e) }))
    .filter((x) => x.c && x.e.startDate)
    .sort((a, b) => (a.e.startDate < b.e.startDate ? -1 : a.e.startDate > b.e.startDate ? 1 : 0))
    .map((x) => ({ lat: x.c.lat, lon: x.c.lon, name: x.e.name || '', date: x.e.startDate, place: x.c.place || '' }));
}

// The place with the most visits, for the little "most visited" summary. Only
// meaningful once somewhere has been visited more than once; ties resolve to the
// most-recently-visited (placesVisited is already newest-first), so null means
// "nowhere stands out yet".
export function mostVisited(places) {
  let best = null;
  for (const p of places || []) {
    if (!best || p.events.length > best.events.length) best = p;
  }
  return best && best.events.length >= 2 ? best : null;
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
  m.kit = typeof m.kit === 'string' ? m.kit : '';                        // kit NAME this item is packed as part of ('' = none); contextual per template
  m.phase = typeof m.phase === 'string' ? m.phase.trim().slice(0, 40) : ''; // '' = use item default; unknown ids kept (see coerceItem)
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
    container: '', section: '', kit: '', phase: '', itemType: '', qty: '', note: '', order: 0,
    ...partial,
  });
}

// --- Write path: decompose an edited (resolved) item back into the catalog ---
// These mirror the migration engine but for a SINGLE resolved item, so db.saveList
// can persist edits: intrinsic fields flow to the shared catalog item (edit once,
// everywhere updates), everything contextual flows to the membership.

// Every field that belongs to the PHYSICAL OBJECT rather than to one template.
// This list is the single source of truth, used both to push edits onto the shared
// item (`applyIntrinsic`) and to carry an item between templates (`linkFields`).
// Keeping one list is deliberate: the two used to be written out by hand
// separately, they drifted, and a partial copy silently erased photos, the care
// record and every purchase detail off the shared item. Add new item-level fields
// HERE and both sides stay correct for free.
export const INTRINSIC_FIELDS = [
  'name', 'swedish', 'category', 'charging', 'chargeType', 'liquid', 'restricted',
  'perNight', 'consumable', 'shortList', 'weight', 'storage', 'packer', 'sub',
  'photos', 'thumb', 'maintenance', 'stats',
  'color', 'size', 'manufacturer', 'model', 'ownedBy', 'acquired', 'price', 'currency',
  'purchaseLink', 'expiry', 'condition', 'retired', 'retiredReason', 'serial',
  'qtyOwned', 'warranty', 'capacityL', 'maxKg',
];

// Container and phase are intrinsic too, but they reach the catalog through their
// OWN channel (`_defContainer` / `_defPhase`) rather than through the resolved
// value, because the resolved value may be a per-list exception or a template
// default. Writing `it.container` onto the item would let "in Hiking, use the
// hiking backpack" leak out and become the answer everywhere.
export const DEFAULT_FIELDS = { container: '_defContainer', phase: '_defPhase' };

// Push a resolved item's intrinsic edits onto its shared catalog item.
//
// A field that is `undefined` on the incoming object is LEFT ALONE. That single
// rule is what makes a partial copy harmless: something that only carries the
// contextual fields can no longer blank out the item's photos or care record.
// Clearing a field on purpose still works — the editor sends '' , not undefined.
export function applyIntrinsic(cat, it) {
  for (const f of INTRINSIC_FIELDS) {
    if (it[f] === undefined) continue;
    cat[f] = Array.isArray(it[f]) ? it[f].slice() : it[f];
  }
  // The item's own DEFAULT container / phase, only when the caller supplied one.
  for (const [field, channel] of Object.entries(DEFAULT_FIELDS)) {
    if (it[channel] !== undefined) cat[field] = it[channel];
  }
  return coerceItem(cat);
}

// The contextual (per-template) half of an item — everything that is allowed to
// differ between two lists that share the same physical object.
// NOTE `section` is deliberately NOT here. A section is `{id, name}` belonging to
// ONE template, so copying the id into another template stores an id that means
// nothing there — the item lands in Ungrouped and carries junk. It travels by NAME
// instead, via `mapSectionAcrossTemplates`.
export const CONTEXTUAL_FIELDS = [
  'seasons', 'contexts', 'transports', 'catering', 'weather',
  'kit', 'qty', 'note', 'itemType',
];

// Carry an item's section from one template to another BY NAME: if the destination
// has a section called the same thing, use its id; otherwise leave the item
// unsectioned so it shows under Ungrouped, where it is visible and easy to file.
// Deliberately does not invent a section in the destination — that would quietly
// reorganise a list you had arranged by hand.
export function mapSectionAcrossTemplates(sectionId, fromList, toList) {
  if (!sectionId) return '';
  const from = asArray(fromList && fromList.sections).find((s) => s.id === sectionId);
  if (!from) return '';
  const hit = asArray(toList && toList.sections).find((s) => normName(s.name) === normName(from.name));
  return hit ? hit.id : '';
}

// Put an EXISTING catalog item into another template.
//
// The result is a link, not a copy: it names the item by id and carries only the
// per-list choices, leaving every intrinsic field `undefined` so `applyIntrinsic`
// passes over them. This is the fix for the bug where joining a second template
// wrote a half-filled copy over the shared item and erased its photos, care
// record, purchase details and serial number everywhere at once.
// `opts.section` is the section id IN THE DESTINATION template (work it out with
// `mapSectionAcrossTemplates`); omit it and the item arrives unsectioned.
export function linkFromResolved(src, itemId, opts = {}) {
  const link = { _itemId: itemId, _link: true, name: src && src.name ? src.name : '' };
  for (const f of CONTEXTUAL_FIELDS) {
    if (src && src[f] !== undefined) link[f] = Array.isArray(src[f]) ? src[f].slice() : src[f];
  }
  link.section = typeof opts.section === 'string' ? opts.section : '';
  // A new home starts with no exception — it follows the template's default, and
  // failing that the item's own. That is the whole point of a shared default.
  link._ovContainer = '';
  link._ovPhase = '';
  return link;
}

// Work out the whole container repair as a PLAN, without touching anything.
//
// This lives here rather than in db.js on purpose: the ordering is subtle and a
// plain function can be tested. The trap is that a membership with no override
// falls back to its item's default, so every effective value must be read BEFORE
// any default is rewritten — read it afterwards and those rows quietly follow the
// new default, which is the one thing this repair promises never to do.
export function planContainerMigration(items, mems, templates = []) {
  const itemsById = new Map(asArray(items).map((i) => [i.id, i]));
  // A template's own default bag is part of how a row resolves, so it must be in
  // hand both when reading the current value and when deciding what to store.
  const tplById = new Map(asArray(templates).map((t) => [t.id, templateDefaults(t).container]));
  const tplOf = (m) => tplById.get(m.templateId) || '';
  // 1. Snapshot what every row shows RIGHT NOW.
  const effective = new Map();
  for (const m of asArray(mems)) {
    const item = itemsById.get(m.itemId);
    if (!item) continue;
    effective.set(m.id, m.container || tplOf(m) || item.container || '');
  }
  // 2. Only then decide the new defaults.
  const rows = asArray(mems).filter((m) => effective.has(m.id))
    .map((m) => ({ itemId: m.itemId, container: effective.get(m.id) }));
  const defaults = containerDefaultsFrom(rows);
  // 3. And express the change as edits, still touching nothing.
  const itemChanges = [];
  for (const [itemId, def] of defaults) {
    const item = itemsById.get(itemId);
    if (item && item.container !== def) itemChanges.push({ id: itemId, container: def });
  }
  const memChanges = [];
  for (const m of asArray(mems)) {
    if (!effective.has(m.id)) continue;
    const want = containerOverrideFor(effective.get(m.id), tplOf(m), defaults.get(m.itemId) || '');
    if (m.container !== want) memChanges.push({ id: m.id, container: want });
  }
  return { defaults, effective, itemChanges, memChanges };
}

// Promote a one-off trip entry into a real catalog item. Unlike a link this DOES
// create a new item, so it must carry everything the entry has — including any
// photo taken on the trip, which the old hand-written copier quietly dropped.
export function itemFromEntry(entry) {
  const it = catalogItemFromResolved(entry);
  for (const f of CONTEXTUAL_FIELDS) {
    if (entry && entry[f] !== undefined) it[f] = Array.isArray(entry[f]) ? entry[f].slice() : entry[f];
  }
  return coerceItem(it);
}

// --- Migrating the old "frozen default" container data ---
//
// Before v108 an item's default container was fixed at the moment it was created
// and no screen could change it, so every real choice ended up as a per-list
// override. This picks the container each item uses MOST across its lists and
// makes that its default; the lists that genuinely differ keep an explicit
// exception. Effective containers are unchanged — nothing moves on any list.
//
// Deterministic and idempotent: re-running it on already-migrated data produces
// exactly the same answer, which matters because two synced devices may both run it.
export function containerDefaultsFrom(rows) {
  const tally = new Map();   // itemId -> Map(container -> count), insertion order breaks ties
  for (const r of asArray(rows)) {
    if (!r || !r.itemId) continue;
    if (!tally.has(r.itemId)) tally.set(r.itemId, new Map());
    const t = tally.get(r.itemId);
    const c = typeof r.container === 'string' ? r.container : '';
    t.set(c, (t.get(c) || 0) + 1);
  }
  const out = new Map();
  for (const [itemId, t] of tally) {
    let best = '', bestN = -1;
    for (const [c, n] of t) if (n > bestN) { best = c; bestN = n; }   // first-seen wins a tie
    out.set(itemId, best);
  }
  return out;
}

// A brand-new catalog item from a resolved item (one the app just added). Its own
// container / phase become the item's DEFAULTS.
export function catalogItemFromResolved(it) {
  const seed = { container: it.container, phase: it.phase, itemType: it.itemType };
  for (const f of INTRINSIC_FIELDS) if (it[f] !== undefined) seed[f] = it[f];
  // A brand-new item has no exception yet, so its own resolved value IS its default.
  for (const [field, channel] of Object.entries(DEFAULT_FIELDS)) {
    if (it[channel] !== undefined) seed[field] = it[channel];
  }
  return newItem(seed);
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
  // The per-list EXCEPTION ('' = follow the template default, then the item's own).
  // When the caller states it outright (`_ovContainer`, set by every resolve) we
  // store it verbatim. Only a freshly-built item that has never been resolved falls
  // back to inferring one — and inference is exactly what used to freeze the item's
  // default forever, so it is now the rare path, not the normal one.
  m.container = it._ovContainer !== undefined ? String(it._ovContainer || '')
    : containerOverrideFor(it.container, it._tplContainer || '', cat.container);
  m.section = it.section || '';   // purely per-template — always stored, no catalog default
  m.kit = it.kit || '';           // kit name — contextual per template, always stored, no catalog default
  m.phase = it._ovPhase !== undefined ? String(it._ovPhase || '')
    : (it.phase !== cat.phase ? it.phase : '');
  m.itemType = it.itemType !== cat.itemType ? it.itemType : '';
  m.qty = it.qty || '';
  m.note = it.note || '';
  return coerceMembership(m);
}

// Rebuild a today-shaped item (as a template would hold it) from a catalog item
// plus one membership: the membership's conditions replace the item's, and any
// override wins over the item's default. The result is byte-compatible with what
// the rest of the app already consumes (buildTotalEntries, editors, review…).
// `tplDefaults` carries the owning template's own defaults (currently just a
// default container), so a template can say "everything in here goes in the hiking
// backpack" once instead of on all 84 items.
//
// Container resolves in three steps, most specific first:
//   1. the per-list EXCEPTION on this membership,
//   2. the TEMPLATE's default container,
//   3. the ITEM's own default — the thing that is true everywhere else.
// The parts are handed back alongside the answer (`_ovContainer` / `_tplContainer`
// / `_defContainer`) so the editor can show which one is actually in force, and so
// a later save can put each part back where it came from.
export function resolveMembership(item, m, tplDefaults = null) {
  const base = coerceItem({ ...item });
  const mm = coerceMembership({ ...m });
  const tplContainer = (tplDefaults && typeof tplDefaults.container === 'string') ? tplDefaults.container : '';
  return coerceItem({
    ...base,
    id: base.id,
    seasons: mm.seasons.slice(),
    contexts: mm.contexts.slice(),
    transports: mm.transports.slice(),
    catering: mm.catering.slice(),
    weather: mm.weather.slice(),
    container: mm.container || tplContainer || base.container,
    _ovContainer: mm.container,      // this list's exception ('' = none)
    _tplContainer: tplContainer,     // the template's default ('' = none)
    _defContainer: base.container,   // the item's own default — true everywhere
    section: mm.section || '',   // per-template section id ('' = none); not an item default
    kit: mm.kit || '',           // per-template kit name ('' = none); not an item default
    phase: mm.phase || base.phase,
    _ovPhase: mm.phase,
    _defPhase: base.phase,
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
  const tplDefaults = templateDefaults(template);
  for (const m of mine) {
    const item = itemsById.get(m.itemId);
    if (!item) continue;
    out.push(resolveMembership(item, m, tplDefaults));
  }
  return out;
}

// A template's own defaults, in the shape resolveMembership wants.
export function templateDefaults(list) {
  return { container: (list && typeof list.defaultContainer === 'string') ? list.defaultContainer : '' };
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
    phase: _mostCommon(copies.map((c) => c.phase).filter(Boolean), defaultPhaseId()), // the DEFAULT (any id, known here or not)
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
    // Photos and the care record are INTRINSIC — they describe the physical object,
    // so they must survive being rebuilt from a backup. They were missing here,
    // which meant a replace-import (and every snapshot restore, which uses the same
    // path) silently dropped every picture and every maintenance schedule. Same
    // "first copy that has one wins" rule as the metadata above.
    photos: (copies.map((c) => asArray(c.photos)).find((a) => a.length) || []).slice(),
    thumb: _firstNonEmpty(copies.map((c) => c.thumb)),
    maintenance: copies.map((c) => c.maintenance).find((m) => m && typeof m === 'object') || null,
    // Descriptive / ownership metadata: first known value wins (intrinsic to the item).
    color: _firstNonEmpty(copies.map((c) => c.color)),
    size: _firstNonEmpty(copies.map((c) => c.size)),
    manufacturer: _firstNonEmpty(copies.map((c) => c.manufacturer)),
    model: _firstNonEmpty(copies.map((c) => c.model)),
    ownedBy: _firstNonEmpty(copies.map((c) => c.ownedBy)),
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
// Is a per-list exception needed to make this row show `effective`?
//
// The one place that answers this, so every producer agrees. Container resolves
// exception → template default → item default, so an exception is only redundant
// when the fallback chain ALREADY lands on the value we want. Comparing against
// the item default alone (as this used to) drops the exception on any row whose
// template carries its own default bag — and the row then silently moves to it.
export function containerOverrideFor(effective, tplDefault, itemDefault) {
  const fallback = tplDefault || itemDefault || '';
  return (effective || '') === fallback ? '' : (effective || '');
}

function membershipFromCopy(catItem, templateId, copy, tplDefault = '') {
  return newMembership({
    itemId: catItem.id,
    templateId,
    seasons: asArray(copy.seasons).slice(),
    contexts: asArray(copy.contexts).slice(),
    transports: asArray(copy.transports).slice(),
    catering: asArray(copy.catering).slice(),
    weather: asArray(copy.weather).slice(),
    container: containerOverrideFor(copy.container, tplDefault, catItem.container),
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
      // The template's own default bag is part of how this row will resolve, so it
      // has to be taken into account when deciding whether an exception is needed.
      const m = membershipFromCopy(cat, l.id, it, templateDefaults(l).container);
      m.order = order++;   // preserve the item's position within its template
      memberships.push(m);
    }
  }
  return { items, memberships, templates };
}

// Count the meaningful contents of a backup / snapshot payload ({ lists, events,
// actions }). Powers the restore preview ("383 items · 14 templates · 5 trips")
// and the "would this shrink my data?" guard. `items` is the count of UNIQUE
// catalog items (merged by name), i.e. real things, not per-template copies.
export function backupCounts(payload = {}) {
  const lists = asArray(payload.lists);
  const events = asArray(payload.events);
  const actions = asArray(payload.actions);
  let items = 0;
  try { items = buildCatalog(lists).items.length; } catch { items = 0; }
  return { items, templates: lists.length, events: events.length, actions: actions.length };
}

// Is `next` meaningfully smaller than `prev`? Used to warn before a REPLACE that
// would wipe most of the data, and to protect the richest snapshot from eviction.
// True when next drops to under half of prev's items, or empties a non-empty set.
export function backupShrinks(prev = {}, next = {}) {
  const p = prev.items || 0, n = next.items || 0;
  if (p === 0) return false;                 // nothing to lose
  if (n === 0) return true;                   // going to empty
  return n < p * 0.5;                         // lost more than half the catalog
}

// --- Trip presets: a saved event "recipe" (which activities + which conditions),
// reusable to spin up a similar trip in one tap. Dates, destination and the packed
// entries are trip-specific and deliberately NOT part of a preset. ---
export function presetConfigFromEvent(ev = {}) {
  return {
    mode: ev.mode === 'quick' ? 'quick' : 'trip',
    activities: asArray(ev.activities).slice(),
    transport: ev.transport || 'Car',
    season: ev.season || 'Summer',
    contexts: asArray(ev.contexts).slice(),
    catering: ev.catering || 'mixed',
    weatherOn: asArray(ev.weatherOn).slice(),
    laundry: !!ev.laundry,
  };
}
// Copy a preset's config onto an event object (mutates and returns it). Leaves the
// event's own name/dates/destination/entries untouched.
export function applyPresetConfig(ev, config = {}) {
  if (!ev || !config || typeof config !== 'object') return ev;
  if (config.mode) ev.mode = config.mode === 'quick' ? 'quick' : 'trip';
  if (Array.isArray(config.activities)) ev.activities = config.activities.slice();
  if (config.transport) ev.transport = config.transport;
  if (config.season) ev.season = config.season;
  if (Array.isArray(config.contexts)) ev.contexts = config.contexts.slice();
  if (config.catering) ev.catering = config.catering;
  if (Array.isArray(config.weatherOn)) ev.weatherOn = config.weatherOn.slice();
  ev.laundry = !!config.laundry;
  return ev;
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

// --- Backup reminders (#13) --------------------------------------------------
// Safari has no File System Access API, so the app CANNOT silently write a backup
// file into a folder on the Mac — that trick is Chrome/Edge only. The Safari-honest
// answer is to make the reminder do the work instead: it escalates until you save,
// and saving is one tap from wherever you happen to see it.
//
// The signal is deliberately "have you changed anything since your last backup?",
// not the calendar alone. A quiet month with nothing edited is not a risk and
// should stay silent; a busy fortnight with no saved file is, and should not.

export const BACKUP_DUE_DAYS = 14;     // amber: worth saving a fresh file
export const BACKUP_URGENT_DAYS = 45;  // red: this is now a real risk

// How long the dismiss (x) buys, in days — deliberately shorter the more overdue
// you are, so a badly-out-of-date backup can't be waved away week after week.
export function backupSnoozeDays(level) {
  return level === 'urgent' ? 1 : 7;
}

// The oldest `createdAt` across the same groups — how long this device has been
// in real use. Matters for someone who has NEVER saved a backup: without it, the
// reminder would start counting from the day this version was installed and give
// a years-old unprotected catalogue a clean bill of health for a fortnight.
export function oldestCreatedAt(...groups) {
  let oldest = '';
  for (const group of groups || []) {
    for (const row of group || []) {
      const v = row && typeof row.createdAt === 'string' ? row.createdAt : '';
      if (v && (!oldest || v < oldest)) oldest = v;
    }
  }
  return oldest;
}

// The newest timestamp across everything the user can change, from any number of
// row groups (events, templates, to-dos, kits). Lets the reminder tell "nothing
// has happened since the backup" from "a fortnight of work is unsaved".
export function newestChangeAt(...groups) {
  let newest = '';
  for (const group of groups || []) {
    for (const row of group || []) {
      if (!row) continue;
      for (const key of ['updatedAt', 'createdAt']) {
        const v = typeof row[key] === 'string' ? row[key] : '';
        if (v > newest) newest = v;
      }
    }
  }
  return newest;
}

// Where the user stands on backups.
//   level   'ok'      nothing to nag about (no data, or nothing changed since)
//           'due'     unsaved changes and no fresh file for a while
//           'urgent'  unsaved changes and badly overdue
//   days    whole days since the last backup — or since first use, when there
//           has never been one, so "never backed up" escalates too
//   never   true when no backup file has ever been saved
//   unsaved true when something changed after the last backup was taken
export function backupState({
  lastBackupAt = '', changedAt = '', firstUseAt = '', hasData = false, now = '',
} = {}) {
  const today = (now || new Date().toISOString()).slice(0, 10);
  const never = !lastBackupAt;
  if (!hasData) return { level: 'ok', days: null, never, unsaved: false };
  // A backup timestamp may be a legacy date-only string; comparing ISO text still
  // orders correctly, and same-day edits read as unsaved — the safe direction.
  const unsaved = never || !changedAt || changedAt > lastBackupAt;
  const since = lastBackupAt || firstUseAt || changedAt || today;
  const raw = daysBetween(String(since).slice(0, 10), today);
  const days = raw == null ? 0 : Math.max(0, raw);
  if (!unsaved) return { level: 'ok', days, never, unsaved: false };
  const level = days >= BACKUP_URGENT_DAYS ? 'urgent' : days >= BACKUP_DUE_DAYS ? 'due' : 'ok';
  return { level, days, never, unsaved: true };
}

