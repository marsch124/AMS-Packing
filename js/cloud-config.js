// cloud-config.js — where this app's sync database lives.
//
// While `databaseUrl` is empty, sync is COMPLETELY OFF: db.js opens the database
// exactly as it did before, the cloud addon is never attached, no network call is
// made and nothing leaves the device. Filling in the URL is the single switch that
// turns syncing on.
//
// The URL is not a secret — it has to ship inside the app for the browser to reach
// it, and it grants nothing on its own (every request is authenticated as a signed-in
// user). The secret is `dexie-cloud.key`, which stays out of this repo via .gitignore
// and must never be committed.
export const CLOUD = {
  // Created with `npx dexie-cloud create` (owner: martin.schabbauer@icloud.com).
  databaseUrl: 'https://z36oh3jht.dexie.cloud',
};

// Tables that deliberately stay ON THIS DEVICE and are never uploaded:
//
//  • snapshots — the automatic on-device safety backups. These are a per-device
//    net by design; syncing them would mean every device carrying every other
//    device's backups, which would swallow the storage quota for no benefit.
//  • photos    — the full-size images. They dwarf everything else, and each item
//    already carries its own small `thumb`, which DOES sync — so lists and cards
//    look right on both devices. Whether full photos should sync too is the next
//    decision, deliberately left until the catalogue itself syncs reliably.
//  • lists     — the dead legacy v1 store, kept only so Dexie doesn't drop it.
export const UNSYNCED_TABLES = ['snapshots', 'photos', 'lists'];

export const syncEnabled = () => !!CLOUD.databaseUrl;
