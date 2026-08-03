# AMS Packing — Project memory for AI assistants

> This file is the persistent context for any AI assistant helping with this
> project. Read it at the start of every session and follow it. It captures who
> you're working with, what the app is, how it's built, and the standing rules —
> so you don't have to be re-briefed each time.

---

## Who you're working with

- The owner is **Martin**. He is **non-technical**.
- **Explain everything in plain, everyday language.** No jargon; when a technical
  word is unavoidable, say what it means.
- **Avoid the command line / terminal.** Give **click-based, GUI steps** (menus,
  buttons, panels). If a task genuinely needs a command, offer to run it yourself
  or clearly flag it — don't hand Martin terminal commands to type.
- Martin likes to **review changes and publish them himself**. Make changes, show
  him the result, and let him do the final commit + publish.

## What the app is

**AMS Packing** — an offline, phone-friendly **PWA** (an installable web app that
works without internet). Its whole job is to **surface the exact packing list for
whatever Martin is about to do** — a single activity (a run, a dive, golf, a swim)
or a combination (a city trip + a run + a hike) — under specific conditions
(season, transport, indoor/outdoor, catering, weather).

The **core value is the composition-and-filter engine**: chosen activities → their
exact combined list → filtered down by conditions, nothing missing and nothing
irrelevant. Everything else (categories, Swedish labels, flags) is secondary.
Judge every change against: *does it help surface the exact right list?*

## Where it lives & how it's built

- **This folder is the git repository.** Own GitHub repo: `marsch124/AMS-Packing`.
  Live online (GitHub Pages) at **https://marsch124.github.io/AMS-Packing/**.
- **No build step.** Plain vanilla-JavaScript PWA. The key files:
  - `index.html` — the shell and the bottom navigation bar (incl. the tab icons).
  - `js/app.js` — the entire user interface.
  - `js/model.js` — the pure, **tested** logic and data model.
  - `js/db.js` — on-device storage (IndexedDB).
  - `js/seed.js` — the built-in starter data.
  - `styles.css` — all styling.
  - `service-worker.js` — offline caching.
  - `docs/` — human-facing project knowledge, kept separate from the code. The
    data-model design spec is in `docs/decisions/`.
  - `_source-lists/` — Martin's **private** original lists; git-ignored, never published.
- **Tests:** the logic in `js/model.js` is covered by a test suite. **Keep it green**
  after every change.

## Vocabulary — use these exact words (in the UI and when talking to Martin)

- **Template** = a reusable building-block list (Swim, Golf, Travel…).
- **Event** = one specific trip that combines templates.
- **Packing List** = the single merged, tickable list an Event produces.

(The internal code still uses `list` / `getLists` / `#/lists` — that renaming is
UI-wording only. **Do not** rename functions, routes, or data stores.)

## The data model (the "Endeavour 2" rebuild — complete)

- Every item exists **once** in a catalog (an **Item**), referenced by a **stable
  id** — never copied. Edit an item once and it updates everywhere it's used.
- **Three layers:** (1) **the Item itself** — name, weight, flags, photos, care,
  default container/when; (2) **Membership** (item ↔ template) — the conditions for
  including the item in a list, plus per-template overrides; (3) **Trip line** — a
  frozen snapshot of the item on one specific trip.
- Per-list choices (e.g. which bag) stay per-list; the shared item is unchanged.

## Standing instructions — do these on EVERY change, without being asked

1. **Bump the version:** `APP_VERSION` in `js/app.js` **and** the `CACHE` constant in
   `service-worker.js` — keep the two matching (e.g. `v55` → `v56`).
2. **Add a Version-history entry** in Settings: the `versionHistoryCard()` function in
   `js/app.js`. Newest first, plain-language description **plus** a `Main benefit:`
   line, matching the format of the existing entries.
3. **Keep the "How it works" guide current:** the `howtoCard()` function in `js/app.js`
   should always be a complete description of what the app does. Update it whenever
   behaviour changes.

## How to see it running (preview)

It's a static site, so it must be **served over a local web server** and opened in a
browser — **don't** just double-click `index.html` (the app needs `http://` for its
storage and modules to work). Just ask to "run the app" / "show me a preview" and the
assistant should start a local server and open it. After a change, a **hard refresh**
(⌘⇧R) ensures the newest version loads (the footer shows the version, e.g. `v55`).

## How to publish (Martin does this himself — no terminal)

Publishing = **commit + push** (the editor calls the push step "sync"). In the
**Source Control** panel: review the changed files → type a short message → **Commit**
→ **Sync / Push**. That's the whole publish; no copying files between folders.

Note: each web address has its **own** storage, so the live site starts from seed
data — real trip data on one address does not carry to another. To move a trip
between them, use the app's built-in **Share / export-trip** feature.

## Current state (as of 2026-08-03)

- The "Endeavour 2" relational-data-model rebuild is **complete** (items live once
  in a catalog; the item editor shows the three layers). App version ~v55.
