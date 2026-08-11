# Decision & Design: Syncing your trips across devices (iCloud)

**Status:** Discussed and scoped — **paused**, waiting for Martin to resume from his computer
**Date:** 2026-08-11
**In one sentence:** Today each device (Mac, iPhone) keeps its own private copy of your
data with nothing shared between them; this document scopes what it would take to make
your trips and templates appear automatically on every device, using Apple's iCloud.

> This is a planning document, not a build log — nothing described here has been built
> yet. It exists so the discussion isn't lost, and so Martin can read it back later and
> pick the conversation up exactly where it left off.

---

## 1. The problem, in plain terms

The app stores everything **on the device you're using** — in the browser's own private
storage, not on any server. That's deliberate: it's the reason the app works offline and
nothing about your packing lists is ever "uploaded" anywhere.

The downside is exactly what Martin ran into: a trip created on the Mac simply isn't
visible on the iPhone, because the two devices have never talked to each other. There is
currently no link between them at all.

**Right now, without any new building**, the way to move a trip between devices is
manual: open the trip → **Share** → send the link/file to the other device (AirDrop,
Messages, email), or use **Settings → Export backup (JSON)** to move everything at once.
This works today and needs nothing new — worth using in the meantime.

---

## 2. What "real iCloud sync" means

**CloudKit** is Apple's private cloud database — the same technology behind Notes,
Reminders, and Photos syncing across your devices. **CloudKit JS** is the version of it
that a website (like this app) can talk to, using your Apple ID.

The idea: the app keeps working exactly as it does today (fast, works offline, stores a
copy on the device) — but it *also* quietly copies your data to your own private iCloud
account in the background. Every device signed in with the same Apple ID then sees the
same trips.

Nothing about how the app looks or feels changes. This is entirely "underneath the
floor," the same way the earlier data-model rebuild was.

---

## 3. Who does what

This isn't something Claude can fully build alone — a few steps require Martin's own
Apple account and a payment method, since they're tied to Apple's developer systems.

### Only Martin can do these (with exact click-by-click instructions provided at the time):
1. **Enrol in the Apple Developer Program** — **$99/year**. There's no free tier for
   this; it's a hard requirement.
2. **Create a CloudKit "container"** in Apple's CloudKit Console (Apple's web dashboard
   for iCloud data) — a few clicks once enrolled.

   > **Multiple apps?** If Martin builds other apps with Claude later, each should get
   > its **own container** (e.g. `iCloud.com.martinschabbauer.ams-packing`, then a
   > different name for the next app) — not share one. Apple explicitly allows sharing
   > one container across apps, but separate containers avoid any chance of two apps'
   > data types colliding, keep each app's data independent to reset or manage, and cost
   > nothing extra: the **$99/year Apple Developer membership is account-wide**, not
   > per-container — create as many as needed at no added cost. Only combine two apps
   > into one container if they genuinely need to read/write the *same* underlying data.

3. **Register the app's web address** for CloudKit + "Sign in with Apple," and generate
   a small web credential (a key/token pair). Claude gives exact steps; Martin copies a
   couple of values back.
4. Optionally review the data layout (the "schema") Claude proposes, before it goes live.

### Claude builds everything else:
- The sign-in flow, the sync engine, conflict handling, and all the code changes.

---

## 4. What would actually sync

The app's data lives in five internal stores today. Each maps to a CloudKit "record
type" one-for-one:

| What it is today | Becomes in iCloud | What's in it |
|---|---|---|
| The item catalog | `Item` | name, weight, flags, photos, care, storage |
| Item ↔ template links | `Membership` | which templates an item belongs to, its section |
| Templates | `Template` | your reusable lists (Golf, Diving, Travel…) |
| Trips | `Event` | your planned trips and their packing lists |
| To-dos | `Action` | the Actions tab |

Two details worth knowing about up front:

- **Photos** are currently stored as pictures embedded directly in each item. iCloud has
  a proper "attachment" type built for exactly this, so photos would be handled a little
  differently under the hood for the synced copy — same end result (a photo on the
  item), just stored more efficiently.
- Records already track **when they were last changed**, which is what lets two devices
  agree on which copy is newer if you edit the same thing on both at once.

---

## 5. What it would feel like, day to day

- Open the app on your phone → your Mac's trips are already there.
- Edit a trip on the Mac → next time you open the app on the phone, it's caught up.
- No internet connection? The app works exactly as it does today — it just catches up on
  syncing the next time you're online.
- Edited the *same* trip on both devices before they had a chance to sync? The most
  recent edit wins — simple and predictable, good enough for a personal app used by one
  or two people.

---

## 6. The one real rough edge

Signing in to iCloud from a **website** (rather than a native iPhone app) isn't always
silent — Apple shows a sign-in popup, and Safari's privacy protections have a known
habit of occasionally signing you back out, meaning you'd have to tap "sign in" again.
This is a genuine, documented quirk of this approach on Safari, not a hypothetical.
Claude can design around it (clear "please sign in again" messaging) but can't fully
eliminate it.

---

## 7. Cost & effort

- **Money:** $99/year (Apple Developer Program), paid by Martin directly to Apple.
- **Effort:** meaningfully bigger than any single feature shipped so far — a new part of
  the app, not a tweak. Roughly three phases:

| Phase | What happens | Feel |
|---|---|---|
| 1 | Martin's Apple setup + first sign-in works, one piece of data round-trips | Half a day of Martin's setup + a solid chunk of Claude's build time |
| 2 | All five data types sync, including photos, plus the first-time "seed the cloud" migration | The bulk of the build |
| 3 | Conflict/delete handling, offline-resume polish, real testing on both devices together | Needs Martin actively testing alongside Claude |

---

## 8. The alternative that was also discussed (for reference)

A simpler *technical* option exists — a small generic cloud database (not tied to
Apple), which is easier to build but means your data would live on a third party's
server rather than staying inside Apple's ecosystem. Given the app's whole premise is
"nothing leaves your device," Martin and Claude agreed **Option A (real iCloud)** is the
better fit if sync is going to happen at all — this document only scopes that path.

---

## 9. Open questions — decide before Claude starts building

1. Comfortable with the **$99/year** and doing the **Apple Developer Console** steps
   yourself (Claude will give exact instructions)?
2. Should this be **just Martin's account**, or should **Anna** see the same trips too?
   (Sharing between two people is possible in CloudKit but adds scope.)
3. OK with the **occasional re-sign-in** on Safari described in §6?

---

## 10. How to pick this back up

Martin: when you're back at your computer, just say *"let's continue the iCloud sync
plan"* (or paste this file back to me) and I'll pick up exactly here — no need to
re-explain anything. Once you answer the three questions in §9, I'll start on Phase 1.

## Decision log

- 2026-08-11 — Scoped and written up; no decisions finalised yet. Paused at Martin's
  request until he's at his computer.
- 2026-08-11 — Clarified: separate CloudKit containers per app (not shared), at no extra
  cost — the $99/year membership covers the whole Apple Developer account. See the note
  under §3, step 2.
