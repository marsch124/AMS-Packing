# Moving this app to Xcode — what to do first, and what not to lose

Written 2026-09-17, the day before the move starts, while the web app is on v181
with 334 tests gating every release. It exists so that Monday begins with the
right first step rather than the obvious one.

---

## 1. The safest order of work

**Port the thinking first, the screens last.** `js/model.js` is 3,689 lines of
pure logic — no screen, no database, no network — and 307 tests describe exactly
what it must do. That is the part of this app that is genuinely hard to rebuild,
and it is also the part that ports most cleanly, because pure functions look
much the same in Swift.

So:

1. **A Swift package with the model in it**, and the 307 rules in
   [`behaviour-contract.md`](behaviour-contract.md) as its acceptance list.
2. **A parity checker** — run the Swift model and the JavaScript model over
   Martin's *real* data and compare the answers. This is not a new idea here:
   AMS Workout Sync iOS was built exactly this way and came out at **0
   differences on his real plans**. It is the only way to know a port is
   faithful rather than merely plausible.
3. **Then the data import** (§2), then the screens.

Doing it the other way round — screens first — means discovering months later
that a trip packs slightly differently, with no way to tell which version is
right.

---

## 2. The data bridge: one JSON file

The native app does **not** need to read IndexedDB, Dexie or anything of the
web app's storage. Everything crosses in a backup file, and that route is tested
on every push (`tests/ui/storage.spec.js`).

A backup is `db.exportJSON()` and looks like this:

```
{
  app: 'ams-packing-list',
  version: 2,
  exportedAt: '2026-09-17T…',
  lists:   [ … ],   // templates and their items, resolved
  events:  [ … ],   // trips
  actions: [ … ],   // to-dos and shopping
  kits:    [ … ],   // bundles always packed together
  phases:  [ … ],   // the editable "When" timeline
  things:  [ … ],   // items on NO template — these have no other home
  photos:  [ … ],   // { id, data } — items reference images by id
  prefs:   { … }    // see the warning below
}
```

Three things an importer gets wrong if nobody says them out loud:

- **`things` is not optional.** Items that belong to no template exist in their
  own right since v175. They were missing from backups until v178 and that was a
  real data loss. Anything that reads a backup must read this array.
- **`photos` travel separately**, and items point at them by id. Restore the
  array first, or every item comes back picture-less.
- **`prefs` carries the five Settings lists — but only the ones he has actually
  customised.** Storage places, trip presets, people, owners and conditions are
  each absent when they are still the factory defaults. That is deliberate (a
  backup must never plant defaults on another device as though they were data),
  so **the native app needs its own copy of those defaults** and must treat
  "absent" as "use the defaults", not as "he has none".

`phases` travels with the data rather than with the device preferences because
every item points into it. The on-device snapshot ring buffer does **not** go in
the file — snapshots are a local safety net, not part of a handover.

---

## 3. Before anything is built

**Take a backup off the phone and verify it.** The library lives in Safari's
storage, which the system is allowed to evict, and once the native app exists
there is a real chance the web app stops being opened for weeks. One dated file
in Files or iCloud removes that whole class of risk.

**Do not retire the web app early.** Keep it live and keep its tests gating
releases until the native app has been through a real trip. Two working apps for
a while is cheap; discovering a gap with no way back is not.

---

## 4. Traps on this particular Mac

- **`codesign` fails on anything under `~/Documents`** — "resource fork, Finder
  information, or similar detritus not allowed". The Swift compiles fine; only
  signing fails, so the error looks worse than it is. **Both** fixes are needed:
  `xattr -cr .` in the project folder, *and* a `-derivedDataPath` outside
  `~/Documents` (clearing alone is not enough — the build path re-acquires them).
  AMS Coffee already solves this, and it is worth copying **on day one** rather
  than meeting it at the first build. Note the `.git` exclusion — git's objects
  are read-only and the sweep fails on them:

  ```bash
  DD="${TMPDIR:-/tmp}/AMSPacking-build"
  find . -path ./.git -prune -o -print0 | xargs -0 xattr -c 2>/dev/null || true
  xcodebuild -project AMSPacking.xcodeproj -scheme AMSPacking \
    -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
    -derivedDataPath "$DD" build
  ```

  (AMS Coffee also generates its project with `xcodegen` from a `project.yml`,
  which keeps the `.xcodeproj` out of the repo and out of merge conflicts —
  worth copying too.) This repo currently carries ~1,700 such attributes.
- **`xcode-select`** is correctly set to `/Applications/Xcode.app/…` as of
  2026-09-17. If it ever comes up unset it blocks the Simulator entirely, and
  fixing it needs Martin's password.
- **XCUITest**: `descendants(matching: .any)` hangs the suite, and container
  identifiers need `.accessibilityElement(children: .contain)` (learned on AMS
  Coffee).

---

## 5. What to leave behind on day one

- **Dexie Cloud sync.** It cost six releases to get right and the iPhone is the
  only place grab lists are ever edited. A native app that simply holds the data
  on the phone, with a backup file, is closer to how the app is actually used.
  Add sync later, deliberately, or not at all.
- **The weather forecast** — a network feature, easy to add once the rest works.
- **Excel export** — useful, but nothing depends on it.

---

## 6. The rule that carries over

Martin's standing rule applies to the native app from its first commit:
**automated UI tests that run in CI on every push, every control found by its
accessibility identifier and never by its words, starting with two tests and
growing one at a time.** In Swift that is `accessibilityIdentifier` and
XCUITest. A red run must block the release there too.
