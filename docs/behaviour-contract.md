# What this app promises

**Generated — do not edit by hand.** Run `node tools/behaviour-contract.mjs`.

Every line below is a test that runs on every push and must pass before a version
can be published. Together they are the specification of the app: 307 rules about
the logic, 3 about links and codes, and 24 about the app as you actually use it.

**If this app is ever rebuilt — in Swift or anything else — this is the list the new
one has to satisfy.** Most of these are decisions nobody would arrive at twice by
looking at the screen; they were argued out once, and a rewrite that does not know
them will differ in ways that only show up months later, on a trip.

## The logic — `js/model.js` (307)

Pure functions, no screen, no database. **This is the part to port first**, and these
names are its acceptance list.

- itemMatchesEvent: empty constraints always apply
- itemMatchesEvent: season constraint filters
- itemMatchesEvent: transport + catering constraints
- itemMatchesEvent: context applies to WET lists only
- buildTotalEntries: combines chosen lists and filters by event
- buildTotalEntries: de-duplicates by name+container across lists
- buildTotalEntries: only includes chosen activities
- coerceList: keeps the loose role
- listsForEvent / buildTotalEntries: the loose bin is never fed to a trip
- regenerateEntries: keeps checked state and custom additions
- regenerateEntries: adds newly matching items after a list grows
- entriesByPhase: only returns non-empty phases, in timeline order
- groupByContainer: orders known containers first
- packSteps: one step per non-empty phase, with packed/remaining counts
- applyReview: folds used/unused flags into source-item stats
- applyReview: accumulates across trips
- pruneSuggestions: flags packed-but-never-used items, respects keep
- effectiveQty: per-night scales with nights, else explicit qty or 1
- bagLoads: sums weight×qty per bag with limit warnings
- bagLoads & packingFlags: ignore reminders; count flags and known weight
- daysUntil / countdownLabel
- nightsBetween / endFromNights
- tripNudge: focuses the earliest due phase with unpacked items
- tripNudge: null without a date; zero due when all packed
- progress: counts checked entries
- totalListRows: flat rows carry phase, container, item
- groupByCategory: groups by category in CATEGORIES order
- groupBy dispatcher: category / container / when all return labelled groups
- newItem: carries the new flags with safe defaults
- seedLists: Martin\
- newList / coerceList: group is a valid GROUP id or empty
- seedLists: every list has a valid group; activities cover GA and WET
- seedLists: scaffolded empty activities exist under the right groups
- seedLists: the built-in Diving template ships pre-filled with sections
- seedLists: EVERY template ships with a well-formed section list
- seedLists: Travel and RV bases are populated with valid items
- seedLists: has exactly one always-on base and a transport list per transport
- listsForEvent: always includes the base, adds only the matching transport list
- buildTotalEntries: an RV trip with zero ticked activities still gets base + RV kit
- buildTotalEntries: switching transport away from RV drops the RV-only kit
- quick mode: only the ticked activities feed the list — no base, no transport kit
- quick vs trip: the same ticked activity yields far fewer items in quick mode
- seedLists: Car and Plane transport lists are populated; Plane flags carry-on rules
- seedLists: Run has an after phase, a reminder, a charging item and a short-list flag
- buildTripBundle: self-contained, event-only envelope
- parseTripBundle: round-trips entries but resets id, status and packed state
- parseTripBundle: accepts a parsed object as well as a JSON string
- parseTripBundle: rejects non-trip payloads
- base64url: round-trips unicode and stays URL-safe
- encodeTripLink / decodeTripLink: full round-trip through a deep link
- encodeTripLink: returns null when the payload is too large for a link
- encodeGrabShare / decodeGrabShare: round-trip of name, look and items
- decodeGrabShare: accepts a whole link, or text with the link pasted inside it
- encodeGrabShare: tidies the items — trims, drops blanks and duplicates, caps lengths
- encodeGrabShare / decodeGrabShare: refuse an empty list and anything that is not a grab list
- decodeGrabShare: survives names with accents and emoji through the base64 layer
- weatherCode: maps WMO codes to icon key + wet flag
- deriveWeather: builds per-day rows and a temperature range
- deriveWeather: derives rain + cold conditions from the forecast
- deriveWeather: flags a summer trip that is cooler than expected
- deriveWeather: hot + windy conditions
- deriveWeather: returns null when there is no forecast
- weatherSuggestions: suggests condition-matched items, skipping ones already packed
- weatherSuggestions: no forecast -> nothing suggested
- coerceEvent: normalises destination + weather, drops a malformed snapshot
- coerceItem: keeps only known weather conditions
- buildTotalEntries: weather-tagged items stay OUT of the base list
- weatherSuggestions: pulls your own tagged gear from the chosen lists
- weatherSuggestions: your own item is preferred and de-duped against the curated add-on
- pendingWeatherItems: counts conditional gear waiting on a forecast, ignoring packed ones
- weatherGear: returns all applicable weather items regardless of forecast, with source links
- sortEventsForList orders nearest-upcoming first, then undated, then past
- addDays / daysBetween: UTC date arithmetic
- normalizeMaintenance: empty record collapses to null
- normalizeMaintenance: keeps real content and cleans bad values
- coerceItem: backfills care fields on legacy items and normalizes maintenance
- coerceItem: photos array is filtered and capped at MAX_PHOTOS
- hasCare: only true when the record holds something
- maintenanceStatus: overdue / soon / ok by next-due date
- maintenanceStatus: reference-only (no interval) and never-done
- maintenanceList: orders overdue → soon → ok → reference
- maintenanceSummary: counts due (overdue + soon)
- maintenanceByDate: buckets scheduled items on their next-due date
- logMaintenance: records a service, resets the schedule, appends history
- buildTotalEntries: carries the item storage location onto trip entries
- coerceMembership: normalizes conditions and keeps override sentinels
- resolveMembership: overrides win, blanks fall back to the item default
- buildCatalog: counts match the analysis (unique items, one membership per copy)
- buildCatalog: resolving a template reproduces each copy\
- buildCatalog: a trip built from resolved templates matches one built from the originals
- buildCatalog: per-template container override (Socks default vs Travel/RV)
- buildCatalog: itemType override preserves the Bike "after" reminders
- membershipFromResolved: stores the per-list exception the editor states
- membershipFromResolved: clearing the exception falls back to the item default
- a freshly built item (no exception channel) still infers its override
- applyIntrinsic: shared-item edits propagate; container/phase defaults are left alone
- catalogItemFromResolved: a new item takes its own container/phase as defaults
- resolveTemplateItems: respects membership order
- coerceItem: defaults and validates the new metadata fields
- buildTotalEntries: excludes items marked "Not in use" (retired)
- applyIntrinsic: metadata edits propagate to the shared catalog item
- buildCatalog: item metadata survives the migration round-trip
- normalizeSections: drops blank names, keeps ids, dedups
- coerceList / newList: sections normalize and default to empty
- membership round-trip: section id survives resolve -> save
- same item, different section per template
- groupItemsBySection: template order, empty sections omitted, ungrouped last
- groupBySection: trip entries by name, first-appearance order, Everything else last
- sectionName + buildTotalEntries: trip line carries the section DISPLAY NAME
- buildCatalog: section survives the migration round-trip
- capacityL + maxKg round-trip through the catalog
- containerNames: merges built-in names with the user container records
- containerLimits + bagLoads: a real bag maxKg drives the over-limit warning
- seedLists: ships a Containers catalogue (role container) with capacities
- seedLists: every packable item has a weight; reminders have none
- groupByStorage: groups by storage place, alphabetical, "No place set" last
- seedLists: every packable item has a storage place; none in "Garage"
- catalogRows: one line per catalog item, gathering all its templates
- dupeKey: collapses spacing and plurals for probable duplicates
- duplicateGroups / duplicateIds: surface look-alike items
- coerceGeo: keeps valid coordinates, rejects junk
- eventCoords: reads weather snapshot, then the geo fix, else null
- eventsNeedingCoords: only trips with a destination and no coordinates
- placesVisited: merges repeat visits to the same place into one pin
- placesVisited: same spot with no label still merges by coordinates
- tripPath: dated trips with coordinates, oldest first; undated left off
- mostVisited: the top place, but only when somewhere beats a single visit
- backupCounts: empty payload is all zeros
- backupCounts: counts unique catalog items, templates, events, actions
- backupShrinks: flags a replace that loses more than half the catalog
- qtyNights: no laundry -> full trip length
- qtyNights: laundry caps long trips but never raises short ones
- laundry feeds effectiveQty: a per-night item packs the cap, not one per night
- coerceEvent + newEvent carry the laundry flag
- presetConfigFromEvent: captures the recipe, not the trip specifics
- applyPresetConfig: fills conditions but leaves name/dates/entries alone
- preset round-trip: config from an event re-applies to an identical config
- coerceKit: de-dups member ids (order preserved) and normalises fields
- newKit: sane defaults + timestamps
- kitEmoji: own emoji wins, else the default bundle glyph
- clusterByKit: loose entries stay in place; a kit emits its whole run once
- kit name flows catalog item -> membership -> resolved item
- kit is a membership override, not a catalog default
- a kit-tagged item carries its kit onto a built trip entry
- action kind: defaults to todo, keeps a valid shopping kind
- consumable flag survives coerceItem/newItem
- shoppingReason: most-urgent reason wins
- shoppingSuggestions: skips retired + already-listed, sorts by urgency
- openShoppingCount counts only open shopping-kind actions
- coercePerson: trims name, validates colour, ensures id
- personColor: roster colour when known, stable hash otherwise, blank for empty
- assignedPeople: distinct packer names, first-seen order, case-folded
- packer flows onto a trip entry and survives the share bundle
- packer is intrinsic: an item default reaches the catalog and every trip built from it
- an item default packer lands on the trip line buildTotalEntries makes
- a per-list link carries no packer of its own — the shared item stays the answer
- referencedListValues sees a packer set on a catalog item, not only on a trip
- groupByPacker: roster order first, strays A–Z, unassigned always last
- groupByPacker: entry order is preserved inside a block
- groupByPacker: nobody assigned is one unassigned block, and nothing is dropped
- coerceList: cleans cover emoji and colour, drops junk
- listEmoji: custom emoji else the default glyph
- listColor: custom colour wins, else a stable palette pick from the id
- isPhotoRef: ids are refs, data URLs are not
- photoRefs / inlinePhotos split a mixed (mid-migration) item
- coerceItem keeps both photo shapes and defaults thumb to a string
- thumb + photo ids survive the catalog round-trip (edit propagates everywhere)
- buildCatalog keeps photos, thumb and the care record through a restore
- buildCatalog merges same-named copies without losing the one that has a photo
- newestChangeAt: picks the latest stamp across every group
- backupState: an empty install is never nagged
- backupState: stays silent when nothing changed since the backup, however long ago
- backupState: escalates amber then red once there are unsaved changes
- backupState: a same-day edit after a same-day backup still counts as unsaved
- backupState: a legacy date-only backup stamp errs towards nagging
- backupState: never backed up escalates from first use
- backupSnoozeDays: dismissing buys less time the more overdue you are
- oldestCreatedAt: dates a device from its earliest trip, not the newest
- linkFromResolved: joining another template cannot touch the shared item
- linkFromResolved: carries the per-list choices and links by id
- applyIntrinsic: an absent field is left alone, an empty one still clears
- editing an item in one template propagates to every other template
- a per-list exception survives an edit to the shared default
- container resolves exception → template default → item default
- containerDefaultsFrom: the most-used container wins, ties go to first seen
- the container migration never moves an item on any list
- itemFromEntry: promoting a trip one-off keeps its photo and care record
- coerceList: a template can carry its own default container
- planContainerMigration: reads every row BEFORE rewriting any default
- planContainerMigration: is idempotent and leaves settled data alone
- planContainerMigration: an item with no memberships is left untouched
- containerOverrideFor: an exception is only kept when the fallback misses
- buildCatalog: a template default cannot swallow a row that differs from it
- planContainerMigration: respects a template default when re-run after a restore
- a link never carries a foreign section id
- mapSectionAcrossTemplates: the section travels by name, not by id
- a mapped section is the one the link actually stores
- groupItemsBySection ignores a section id from another template
- orderActivities: WET follows the deliberate order, not the alphabet
- orderActivities: an activity of your own lands after the known ones, A–Z
- orderActivities: a group with no set order keeps what it was given
- orderActivities: matches names case- and spacing-insensitively
- the seed ships Mobility, not Yoga / Mobility
- sortRowsBy: text sorts A–Z, case-insensitively
- sortRowsBy: blanks sink to the bottom in BOTH directions
- sortRowsBy: numbers compare arithmetically and 0 counts as unrecorded
- sortRowsBy: ties settle by the tie-breaker, and never flip with direction
- sortRowsBy: does not mutate the rows it is given
- groupRowsBy: known buckets first in order, the rest A–Z, "not set" last
- groupRowsBy: keeps the incoming order inside each bucket (so the sort still applies)
- groupRowsBy: every row lands in exactly one bucket
- itemConditionLabel: every condition has a label, unrated has none
- coerceCondition: trims, bounds and rejects an unknown tone
- newCondition: makes a readable id and never collides
- setItemConditions: mutates the shared arrays in place, so importers stay live
- setItemConditions: drops unusable rows and never leaves the app with none
- conditionReplaces / conditionTone: behaviour follows the flag, not the id
- shoppingReason: any "needs replacing" condition feeds the buy list
- careSections: overdue and due-soon stay open, far-off and reference fold
- careSections: the fold boundary, and a missing day count sinks to Later
- careSections: rows keep the order they arrived in (the urgency sort still rules)
- looksLikeEmail: tells a sign-in address from a person’s name
- ownerNameFromEmail: an address becomes the name a person would use
- coerceItem: adopts a legacy owner name, but never the address sync stamped there
- INTRINSIC_FIELDS carries ownedBy and no longer the reserved owner
- buildCatalog: the owner survives being rebuilt from a backup
- setPhases: sorts by order, renumbers, and drops the unusable
- setPhases: an empty list falls back to the factory seven, never to nothing
- coercePhase: fills in an emoji, a colour and a sane lead time
- newPhase: earns a readable id and never collides
- the built-in phase ids are stable — two devices seeding must not double up
- phaseOrFallback: an unknown id is shown, never swapped for a real phase
- phaseOrder: an unknown phase sorts to the END, not into the middle
- defaultPhaseId: a new item lands on the first phase you actually pack in
- coerceItem: keeps a phase this device does not know (it syncs, so it is real)
- entriesByPhase: an unknown phase gets its own group at the end, not merged away
- phasesCustomised: true only once the list really differs from the standard seven
- setPhases: a tie on order is broken deterministically, so two devices agree
- sharedRowId: two devices adding the same name land on the same key
- conditions: a round trip keeps the id items are stamped with, verbatim
- conditions: order survives, and a tie on order is broken deterministically
- people: a round trip keeps the colour, and the id is the same on both devices
- people: the same name twice collapses to one row rather than doubling
- owners & places: names round-trip, de-duplicate case-insensitively, sort A–Z
- presets: re-saving under a name you already used replaces it, never doubles it
- sharedRowsOfKind: rows of other lists are never mixed in
- coerceSharedRow: a row from an unknown list, or with junk in it, is dropped
- isFactoryList: the defaults are recognised so they are never written as data
- sharedRowsFrom: every kind builds rows, and an unknown kind builds none
- monthKey: a real date gives its month, anything else gives nothing
- shiftMonth: steps months and rolls the year over both ways
- monthGrid: always 42 cells, starting on the chosen weekday, in UTC
- monthGrid: a month starting exactly on the week start needs no lead-in
- rangeCellState: paints the two ends, the days between, and nothing else
- orderRange: two taps become a trip, whichever order they came in
- the picker and nightsBetween agree on what a range means
- orderedNamesFromRows: storage places keep the order they are stored in
- orderedNamesFromRows: two devices appending at the same order still agree
- ownersByUsage: the biggest owner comes first, ties settle A–Z
- referencedListValues: gathers what the device data points at, normalised
- referencedListValues: survives junk without throwing
- auditList: names what the list has never heard of
- auditList: conditions and phases are matched by ID, people and places by name
- auditDeviceLists: the real iPhone — 2 places of 17, 1 condition of 6 — reads as broken
- auditDeviceLists: the healthy Mac holding all seventeen says ok
- auditDeviceLists: a stray or two never raises an alarm
- auditDeviceLists: nothing to compare against is "off", never a warning
- AUDIT_LABELS: every audited kind has a name to show
- encodeListShare/decodeListShare: a template survives the round trip
- decodeListShare: accepts a whole link, a bare code, or a link inside a message
- decodeListShare: rejects anything that is not a shared template
- encodeListShare: an empty template has nothing to share
- listFromShare: rebuilds a real template with fresh ids and its sections joined up
- listFromShare: the two system bins can never arrive as themselves
- listFromShare: a partial overrides identity, for replacing a template in place
- lzwCompress/lzwDecompress: bytes survive the round trip
- lzwCompress: survives inputs that cross the code-width boundaries
- packShare/unpackShare: repetitive JSON gets much shorter, and comes back whole
- packShare: a tiny payload is left as plain base64
- unpackShare: still reads a plain code sent before squeezing existed
- unpackShare: a full stop at the end of a sentence is not part of the code
- packShare/unpackShare: unicode survives
- base64UrlToBytes/bytesToBase64Url: raw bytes survive, URL-safe and unpadded
- encodeTripLink: a big trip now fits a link, and decodes back to the same trip
- encodeListShare: a big template travels far smaller than it used to
- tripEndDate: the return date, or the start when there is no return
- tripsAwaitingReview: a finished, unreviewed trip is offered
- tripsAwaitingReview: not while it is still running, and not on the day it ends
- tripsAwaitingReview: the offer expires, rather than nagging about last year
- tripsAwaitingReview: skips trips already reviewed, undated, or with no gear
- tripsAwaitingReview: most recently finished first
- tripNudge: a finished trip reports a NEGATIVE days-to-go
- applyReview: an unticked item on a ticked trip is skipped, not packed
- applyReview: a trip with no ticks at all still counts, as it always did
- pruneSuggestions: one quiet trip is not evidence — the default is two
- pruneSuggestions: never-packed is its own signal, and says so
- pruneSuggestions: "Keep" still settles it for good
- grabToRows/grabFromRows: a list survives the round trip, hyphen and all
- grabToRows: the row id is stable, so two devices merge instead of doubling
- grabToRows: the code id survives normalising, verbatim, in data.gid
- grabToRows: nothing is invented — junk and duplicates build no rows
- grab is a kind of the EXISTING shared table, not a new table
- expiringOnTrip: judged against the TRIP’s end, not today plus a month
- expiringOnTrip: nothing without an end date, and nothing that outlasts the trip
- expiringOnTrip: one line per thing, and reminders are not gear
- maintenanceList: one row per item across templates, naming all of them
- maintenanceList: different items are still separate rows

## Links, codes and sharing — `js/qr.js` (3)

- QR.encode: a short link fits a small symbol with correct finder patterns
- QR.encode: longer text steps up through the versions, and beyond the table it refuses
- QR.toSvg: an inline SVG with a quiet zone, ready to drop into the page

## The app as you use it (24)

Driven through a real browser, every control found by its identifier rather than its
wording. In a native app these become XCUITests against `accessibilityIdentifier`.

**boot.spec.js**

- the app boots and shows its version

**care.spec.js**

- an item in several templates is listed once on Care, naming all of them

**create-trip.spec.js**

- a trip created on Home shows up on the Events tab

**density.spec.js**

- the Density switch loosens the app, remembers it, and tightens again

**export-photos.spec.js**

- the Excel export writes a real file
- a photo added to a thing is really kept

**finding.spec.js**

- search finds a thing, a template and a trip, and its hits lead somewhere
- a to-do can be added and ticked, and a suggestion joins the shopping list

**grab.spec.js**

- a grab list counts what is in hand, holds things back, and remembers
- editing a grab list sticks, and reaches the account

**kits-sharing.spec.js**

- a kit lands on a trip as one cluster, and packs as one
- a template shared as a link can be taken in by pasting it back

**loose-retired.spec.js**

- a Loose items bin is dissolved on start-up and its things survive
- Several adds a batch of things, all on no list

**memberships.spec.js**

- a thing can be put on a list and taken off it, from the thing itself

**pack-mode.spec.js**

- ticking a thing in Packing Mode moves the count, and the tick sticks

**review.spec.js**

- the review files a wished-for thing into one of the trip’s templates

**routes.spec.js**

- every screen opens without an error

**storage.spec.js**

- an on-device backup restores what was there, including settings
- one thing in three templates: renaming reaches all, removing frees only one
- the safety copy taken before a restore carries the settings too

**things.spec.js**

- a thing created with no list exists, is findable, and keeps its own fields

**weather-conditions.spec.js**

- a forecast is fetched, read and turned into suggestions
- a trip only packs what its season, transport and context call for

