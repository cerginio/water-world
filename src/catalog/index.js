// The story catalog (STORY-QUEST-SPEC §4.1): the platform entry. createStoryCatalog()
// binds the state machine of catalog.js to Tilecraft's R2 client.
import { createCatalog } from './catalog.js';
import { loadStoryCatalog } from './tilecraftCatalog.js';

export { CATALOG_FOLDERS, DEFAULT_FOLDER, LOCAL_FOLDER, errorCode, parseStoryId } from './catalog.js';

/** @param {{ localBase?: string | null, fetcher?: typeof fetch }} [options] */
export function createStoryCatalog(options = {}) {
  return createCatalog({ runtime: loadStoryCatalog, ...options });
}
