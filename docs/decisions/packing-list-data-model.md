# Decision & Design: The Professional Data Model ("Endeavour 2")

**Status:** Agreed — ready to build in stages
**Date:** 2026-08-03
**In one sentence:** We are re-plumbing the app so that every item exists **once**, in a single Item catalog, and everything else *refers* to items instead of holding its own copies — so the app can grow far beyond what it does today.

> This document is the **spec** for the work. It records *what* we're building, *why*,
> and the decisions we've settled, in plain language. Nothing here changes how the app
> looks or feels — it is all underneath the floor.

---

## 1. Why we're doing this (the problem)

Today, an item that appears in three templates exists as **three separate copies**,
linked only by having the same name. That's the ceiling we've hit.

The consequences of the copy-based approach:

- **Adding any new property is painful.** Want to add an expiry date, a purchase link,
  or a "how many times packed" count? You'd have to add it to every copy of every item,
  and the copies immediately start to drift apart.
- **Editing is fragile.** Renaming propagates today, but everything else has to be
  hand-synced across copies.
- **The name is the glue.** Because copies are matched by *name*, the whole system is
  brittle: it leans on text matching instead of a stable identity.

That is not a foundation you can build far on. Endeavour 2 replaces it with a proper one.

---

## 2. The core principle: Items as the base

**One canonical Item, referenced by everything else.**

- Each item exists **once**, in a single Item catalog.
- Every item has a **stable ID** (a permanent internal identity, *not* its name).
- Templates and trips **point at** items by that ID — they never contain copies.

Result:
- A **rename or edit is instant and universal** — change the item once, everywhere updates.
- **Adding a new property is a one-place change** — add it to the Item, done.
- The **name is free to change** without breaking any link, because links use the ID.

This is exactly the instinct Martin brought to the endeavour: *separate lists with only
relations between them*, so it's easy to add properties and include one item in many lists.

---

## 3. The one concept that makes it professional: three layers

Every property of an item belongs on **exactly one** of three layers. Deciding which
layer each property sits on is ~80% of the design, and we've done that below.

```
        ┌─────────────────────────────────────────────────────────────┐
        │  THE ITEM  (the thing itself — true wherever it's used)      │
        └─────────────────────────────────────────────────────────────┘
                 ▲                                   ▲
                 │ referenced by                     │ snapshot taken by
                 │                                   │
   ┌─────────────────────────┐            ┌──────────────────────────────┐
   │  MEMBERSHIP             │            │  TRIP LINE (Entry)           │
   │  item ↔ template        │            │  item ↔ event                │
   │  "this item is in this  │            │  the actual tickable line    │
   │   list, under these     │            │  for one specific trip       │
   │   conditions"           │            │                              │
   └─────────────────────────┘            └──────────────────────────────┘
                 │                                   ▲
                 ▼                                   │ produces
   ┌─────────────────────────┐            ┌──────────────────────────────┐
   │  TEMPLATE               │──combined──▶│  EVENT (one trip)           │
   │  reusable list          │   into      │                              │
   │  (Swim, Golf, Travel…)  │            └──────────────────────────────┘
   └─────────────────────────┘
```

**The flow in words:**
Item → (is part of, via a **Membership**) → Template → (combined into) → Event →
(produces) → **Packing List** of tickable lines. And each packing-list line is a
**snapshot** of an Item, so past trips stay a true record even after the item is edited.

### 3a. Where each property lives

| Layer | What it is | Properties that live here |
|---|---|---|
| **Item** | The thing itself. True no matter where it's used. | name · Swedish alias · category · weight · flags (💧 liquid, 🔋 charging, restricted) · photos · home storage location · care & maintenance · weather-conditionality · **default** container · **default** "when" (phase) |
| **Membership** (item ↔ template) | The *relation* — how one item belongs to many lists cleanly, plus the list-specific context. | is the item in this list? · conditions to include it (season, transport, indoor/outdoor…) · **list-specific overrides** of container / when / quantity (only when they differ from the item's default) |
| **Trip line / Entry** (item ↔ event) | The actual line you tick for one specific trip. A frozen snapshot. | packed / not packed · used / didn't use (for Trip Review) · any last-minute per-trip override |

**The pattern to remember: "default + override."**
Container, "when", and quantity have a sensible **default on the Item**, and can be
**overridden on the Membership** (per template) or nudged on the **Trip line** (per trip)
when context genuinely differs. Most items never need the override — but it's there when
they do. This is what a grown-up data model does.

---

## 4. The entities in detail

These are the "tables" (kinds of record) the app will have. Field lists are the starting
point — we'll refine exact names as we build, but the shape is settled.

### Item — the catalog (the base)
The single source of truth for one physical thing.
- **id** (stable, permanent)
- name, swedish (alias)
- category
- weight, flags (liquid, charging/battery, restricted)
- photos, home storage location
- care & maintenance (cadence, last-done, history, how-to link)
- weather-conditionality (the conditions that make it relevant)
- **default** container, **default** "when" (phase)

### Template — a reusable list (Swim, Golf, Travel…)
- id, name
- group (GA / WET / OE)
- role (base / transport / loose / …)
- constraints (season, transport, catering, context) that gate the whole list

### Membership — item ↔ template (the relation)
The record that says "this item belongs to this template," and carries the context.
- item id, template id
- conditions to include (season, transport, indoor/outdoor, race…)
- **optional overrides**: container, when, quantity (blank = use the item's default)

### Event — one trip
- id, name
- chosen templates + the trip's conditions (season, transport, catering, nights, destination…)
- countdown/date, weather snapshot (opt-in)

### Trip line / Entry — item ↔ event (the snapshot)
The tickable line, frozen at build time.
- id, event id, item id (the item it was a snapshot of)
- the resolved values at build time (name, container, when, qty…) — frozen
- packed / not packed, used / didn't use
- any per-trip override

---

## 5. The decisions we settled

All three were resolved by taking the recommended defaults (Martin: *"your
recommendations are perfect"*).

1. **Container & "when" (phase):** live as a **default on the Item**, **overridable on the
   Membership** per template.
   *Why:* a towel's bag can differ between a swim and a city trip, but most items don't
   need that — a default keeps it simple, an override keeps it flexible.

2. **Quantity / per-night scaling:** lives on the **Membership** (list-specific), with the
   **trip** able to nudge it.
   *Why:* how many of something you take is usually a property of the list-in-context, not
   of the thing itself.

3. **Past trips stay frozen snapshots.** Yes.
   *Why:* it's what makes Trip Review trustworthy — editing an item later must never
   silently rewrite what a past trip recorded.

---

## 6. What stays exactly the same

- **The UI vocabulary is unchanged:** Template, Event, Packing List. This is re-plumbing
  beneath the floor.
- **The look and feel is unchanged.** The colour-coded modes, the tabs, Packing Mode,
  Weather, Trip Review, Sharing, Excel export — all stay.
- **The core value is unchanged:** surface the exact right packing list for whatever
  Martin is about to do. This work makes that engine sturdier, not different.

---

## 7. Migration (moving the existing data over)

**Big relief:** the live app starts fresh from seed data and there are **no real trips to
preserve**. So we have a lot of freedom:

- We restructure the **seed data** into the new shape cleanly (items become a single
  catalog; templates get memberships instead of copies).
- Low risk, because there's no irreplaceable user data on the line.
- We keep the app working and the tests green at **every** step.

---

## 8. How we'll build it (staged)

The plan is to do this in safe, verifiable stages rather than one big rewrite:

1. Introduce the **Item catalog** and **Membership** records alongside the current model.
2. Rebuild the **seed data** into the new shape.
3. Point **templates** at items via memberships (stop copying).
4. Make **event building** read from the new structure and produce frozen snapshots.
5. Update the **editors** (item / membership / trip line) to match the three layers.
6. Remove the old copy-based plumbing once nothing depends on it.

Tests stay green throughout; the app stays usable throughout. As always, we keep the
**"How it works" guide** and the **Version history** in Settings updated as features land.

---

## 8a. Build progress

**Stage 1 — DONE (2026-08-03).** The relational core now exists as pure, tested
logic in `js/model.js` (not yet wired into the live app, so nothing changed for
users). Added: `newMembership` / `coerceMembership`, `resolveMembership`,
`resolveTemplate(Items)` (the bridge that rebuilds today's list shape), and
`buildCatalog(lists)` (the one-time migration engine). Test suite: **78 → 85**, all
green, including a guarantee that *a trip built from the new structure matches one
built the old way*.

**What the real seed data showed (measured, not guessed):**
- 484 item entries today → **383 unique**; merging removes **101 duplicate copies (~21%)**.
- Only **25** names had an intrinsic disagreement — 16 just Swedish wording, 7 category,
  4 item-vs-reminder. All auto-resolved (Martin chose "merge by name, auto-resolve").
- **52** duplicated names differ in container by list, 8 in "when" — exactly what
  membership overrides are for. The design is vindicated by the data.

**Stage 3 — DONE (2026-08-03).** The relational storage is now LIVE in the app. `js/db.js`
was rewritten so IndexedDB holds three stores — `items` (catalog), `memberships`,
`templates` — while its public API is byte-for-byte the same, so `app.js` needed **zero
changes**. Reads RESOLVE the catalog into today's list shape; writes DECOMPOSE an edited
list back (intrinsic edits flow to the shared item, contextual choices to the membership),
with orphan cleanup. First load MIGRATES any old `lists` data automatically (DB v1→v2,
SEED_VERSION→9). App version → v52, service-worker cache → v52, a plain-language version-
history entry added. **Verified end-to-end in the browser (localhost):** fresh seed created
383 items / 484 memberships / 14 templates; a 239-item trip built correctly; editing an item
in Golf renamed the *shared* item (Hiking & Travel followed) while its container override
stayed isolated to Golf; item count stayed 383 (no dup, no orphan); zero console errors.

> **Preview note (dev environment):** the app lives under `~/Documents`, which macOS TCC
> protects, and the preview server (a Claude helper process) can't read it → 404s. Workaround
> used for local verification: serve a synced copy from `/tmp/ams-serve` (symlinked at
> `~/ams-packing-app`), re-`rsync` from the real repo after edits. The **source of truth stays
> the Documents repo**; `/tmp` is only a disposable preview mirror.

**Two refinements discovered while building (agreed by the shape, noted here):**
1. **Weather-conditionality lives with the other conditions on the Membership**, not on
   the Item. Reason: it varies by list — e.g. a Windbreaker is *conditional gear* in the
   Run list but a normally-packed item in Travel. So conditions = seasons · contexts ·
   transports · catering · **weather**, all membership-level.
2. **`itemType` (item vs reminder) can be a membership override.** Reason: the Bike
   "after" list shows Towel / Shower gel as *reminders*, while the same catalog item is a
   packable *item* elsewhere. The override preserves that exactly.

**Auto-resolve rules used by `buildCatalog`:** text/category → majority value (first wins
ties); booleans (charging/liquid/restricted/…) → true if any copy has it (safe superset);
weight → first known value; container/phase default → majority; anything that differs per
list becomes a sparse membership override.

## 9. Glossary

- **Item** — one physical thing, stored once in the catalog. The base of everything.
- **ID** — a permanent internal identity for a record, separate from its name. Links use
  the ID so names can change freely.
- **Template** — a reusable building-block list (Swim, Golf, Travel…).
- **Membership** — the record linking an item to a template; also holds the conditions and
  any list-specific overrides. This is the "relation" Martin asked for.
- **Event** — one specific trip that combines templates under chosen conditions.
- **Packing List** — the single merged, tickable output an Event produces.
- **Trip line / Entry** — one tickable line in a packing list; a frozen snapshot of an item.
- **Default + override** — a value set once on the item, changeable per-template or per-trip
  only when it genuinely differs.
- **Snapshot** — a frozen copy taken at trip-build time, so past trips stay a true record.

---

*This spec captures the agreed shape of Endeavour 2. When we start building, we build
against this document — and update it if we discover anything that changes the plan.*
