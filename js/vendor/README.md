# Vendored libraries

`dexie-cloud.mjs` — Dexie 4.4.5 plus dexie-cloud-addon 4.4.14, bundled into one
self-contained ES module and minified.

It is committed here rather than installed, because this app deliberately has **no
build step**: the files in the repo are the files the browser runs, and everything
must work offline from the service-worker cache.

Dexie and the addon are bundled *together* on purpose. The addon patches the Dexie
instance it is given, so two separate copies of Dexie would silently fail to sync.

## Rebuilding

    npm i dexie@4.4.5 dexie-cloud-addon@4.4.14
    # entry.mjs:
    #   export { default as Dexie } from 'dexie';
    #   export { default as dexieCloud } from 'dexie-cloud-addon';
    npx esbuild entry.mjs --bundle --format=esm --minify --target=es2020 \
      --outfile=js/vendor/dexie-cloud.mjs
