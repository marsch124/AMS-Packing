# `docs/` — The Project Knowledge Folder

This file explains what the `docs/` folder is, why it exists, what belongs in it,
what does **not** belong in it, and exactly how Martin and Claude use it together.
Read this first whenever you (or a future helper) open the project and wonder
"where do I write things down?"

---

## 1. What this folder is, in one sentence

**`docs/` is where we keep everything written *about* the app — the human-facing
knowledge — kept deliberately separate from the app's own code.**

Think of the whole project folder as a workshop:

- The **app files** (`index.html`, `styles.css`, `js/`, `icons/`, …) are the
  *machine we are building*.
- The **`docs/` folder** is the *logbook, the plans on the wall, and the manual*
  that sit beside the machine and explain it.

You could throw the machine's parts and the logbook into one big pile, and it
would still technically run — but nobody would ever understand it again. Keeping
them apart is what makes a project survivable over months and years.

---

## 2. Why we bother having it

Three concrete reasons, all of which matter for a project that is meant to grow:

1. **Memory that outlives any single conversation.**
   Claude does not automatically remember every past chat. When a decision or a
   plan is written down here, it becomes permanent and can be re-read at the start
   of any future session. This folder is our shared long-term memory.

2. **A clean separation between "the app" and "notes about the app."**
   The app files have technical rules about where they must live (for example,
   `index.html` must sit at the top level or the website breaks). Notes have no
   such rules — so we give them their own room where we can organise them however
   we like, without any risk of breaking the running app.

3. **Understanding *why*, not just *what*.**
   The code shows *what* the app does today. It never explains *why* we chose to
   do it that way, what we tried and rejected, or what we plan next. Those "why"
   and "what next" answers live here. Six months from now, this is the difference
   between "I remember exactly why we did that" and "I have no idea, I'm afraid to
   touch it."

---

## 3. What belongs in `docs/`

Anything that is *written knowledge about the project* rather than *the app
itself*. In practice, that means:

- **Plans and roadmaps** — what we intend to build next and in what order.
- **Decisions** — important choices and the reasoning behind them
  (e.g. "we decided to give AMS Packing its own GitHub repo because…").
- **A changelog** — a running, plain-language list of what changed and when.
- **How-to guides** — step-by-step instructions written for Martin, in
  click-by-click language (e.g. "How to publish a new version from Antigravity").
- **Glossaries** — plain-English definitions of any technical word we use, so the
  vocabulary is never a barrier.
- **Design notes and sketches** — how a feature should look or behave.
- **Screenshots and diagrams** — visual references (put image files in
  `docs/images/`).
- **Research and ideas** — half-formed thoughts we don't want to lose.

A good rule of thumb: *if you'd write it on a sticky note, in a notebook, or on a
whiteboard about this project — it belongs in `docs/`.*

---

## 4. What does **NOT** belong in `docs/`

- **App code or app assets.** Anything the running website actually needs
  (`index.html`, `styles.css`, the `js/` code, `icons/`, the manifest, the
  service worker) stays *outside* `docs/`, at its proper place in the project.
  `docs/` is only for writing *about* the app.

- **Secrets and private information.** ⚠️ **Important:** this project is published
  to GitHub as a **public** repository. That means **everything in `docs/` becomes
  publicly visible on the internet**, just like the app itself. So never put
  passwords, API keys, private addresses, personal data, or anything you would not
  be comfortable showing a stranger. When in doubt, leave it out — or ask Claude
  first.

- **Throwaway temporary files.** Scratch files, exports, downloads, or
  experiments that aren't meant to be kept. Those should live somewhere outside
  the project (or be deleted). `docs/` is for things worth keeping.

---

## 5. How we organise it (suggested subfolders)

We keep `docs/` tidy with a small set of subfolders. This is a *suggested*
starting structure — it can grow as the project does:

```
docs/
├── README.md            ← this file: explains the docs folder itself
├── plans/               ← roadmaps and plans for what's coming next
├── decisions/           ← records of important choices and their reasons
├── guides/              ← click-by-click how-to guides written for Martin
├── images/              ← screenshots, diagrams, visual references
└── CHANGELOG.md         ← a running, dated list of what changed (lives at the top)
```

Not every folder needs to exist on day one. We create each one the first time we
actually have something to put in it — an empty folder with a clear purpose beats
a pile of unsorted notes.

---

## 6. Naming conventions (so files stay easy to find)

A few gentle habits keep this folder navigable a year from now:

- **Use plain, descriptive names.** `how-to-publish-from-antigravity.md` tells you
  what it is at a glance; `notes2.md` does not.

- **Prefer lowercase words joined by hyphens** — e.g. `packing-list-data-model.md`.
  This is called *kebab-case*. It avoids spaces (which can be awkward on the web)
  and is easy to read.

- **For anything dated or time-ordered, start with the date** in
  `YYYY-MM-DD` form — e.g. `2026-08-03-first-github-publish.md`. Because the year
  comes first, files naturally sort into chronological order by themselves.

- **Use the `.md` extension** for text notes. `.md` means *Markdown* — a simple way
  to write formatted text (headings, lists, bold) using plain characters. It shows
  up beautifully both in the editor and on GitHub, with no special software needed.

---

## 7. How this folder relates to Git and publishing

`docs/` is part of the project's Git repository, exactly like the app files. That
means:

- When you **commit and push** from Antigravity, your notes here get saved and
  backed up to GitHub right alongside the app. Your knowledge is versioned and
  protected, not sitting loose on one computer.
- Because the repo is public, GitHub displays these Markdown files nicely on the
  repository's web page — so `docs/` doubles as a readable, online project handbook.
- The `docs/` folder does **not** appear in the live app itself. Visitors to the
  packing-list web app never see it. It is for the *project*, not for the app's
  users. (The one exception would be if we ever deliberately linked to it.)

---

## 8. How Martin and Claude use `docs/` together

This is the everyday working rhythm:

- **Claude writes things down here** at natural moments — after we make a decision,
  finish a chunk of work, or agree on a plan — so the knowledge survives beyond the
  chat. Claude will usually say "I've noted that in `docs/…`" so Martin knows where
  it went.

- **Martin can read any of it, any time**, directly in Antigravity or on GitHub.
  It's all plain language on purpose. If a note is ever unclear, that's a bug in
  the note — tell Claude and we'll rewrite it plainly.

- **Martin can ask Claude to add or update notes** at any point: "write this down,"
  "update the changelog," "make a guide for how to do X." Claude keeps the folder
  organised and the naming consistent.

- **At the start of a session**, Claude can re-read the relevant files here to get
  back up to speed on where we are and why — turning this folder into the project's
  reliable memory.

---

## 9. Starter files we'll likely create soon

As the project moves forward, expect these to appear (Claude will create them as
they become useful):

- `CHANGELOG.md` — the running history of changes, newest at the top.
- `plans/roadmap.md` — the big picture of what's planned for AMS Packing.
- `decisions/2026-08-03-own-repo-and-new-home.md` — recording *this* endeavour:
  why AMS Packing got its own folder and its own GitHub repo.
- `guides/how-to-publish-from-antigravity.md` — the click-by-click publishing guide.
- `decisions/packing-list-data-model.md` — where we'll capture the "professional
  item-list / packing-list structure" work (the second big endeavour).
- `decisions/icloud-sync-plan.md` — the scoped plan for syncing trips across devices via
  iCloud (currently paused, waiting for Martin to resume from his computer).

---

*In short: the app is the machine; `docs/` is everything written about the machine.
Keep the two apart, keep this folder tidy, keep secrets out — and this project will
stay understandable for as long as we work on it.*
