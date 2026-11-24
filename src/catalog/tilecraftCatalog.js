// The Tilecraft entry of the story catalog (BOUNDARY-3): its one R2 client,
// lib/story-catalog.js (validation, CDN + r2.dev mirror), is a classic IIFE that puts
// `StoryCatalog` on globalThis — the same file Tilecraft's editor and three shell use,
// not a copy. Nothing else in src/catalog/ knows where the client comes from.

let runtime = null;

/** @returns {Promise<any>} Tilecraft's StoryCatalog (forCatalog, forBase, validators) */
export function loadStoryCatalog() {
  runtime ??= import('@tilecraft/lib/story-catalog.js').then(() => {
    const catalog = /** @type {any} */ (globalThis).StoryCatalog;
    if (!catalog) throw new Error('StoryCatalog unavailable');
    return catalog;
  });
  runtime.catch(() => (runtime = null));
  return runtime;
}
