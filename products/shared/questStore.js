// Where the quest log lives (STORY-QUEST-SPEC §3.3, §5 «Приватність»): the product's IndexedDB on
// the device, one record per story (logKey: slug + the model's fingerprint). Nothing goes to the
// network. memoryStore is the same interface for the unit tests and for a browser without IndexedDB
// (private mode): the log then lives as long as the page.

/** @typedef {{ get: (key: string) => Promise<any>, put: (key: string, value: any) => Promise<void>, kind: string }} QuestStore */

/** @returns {QuestStore} */
export function memoryStore() {
  const map = new Map();
  return {
    kind: 'memory',
    get: async (key) => (map.has(key) ? structuredClone(map.get(key)) : null),
    put: async (key, value) => { map.set(key, structuredClone(value)); },
  };
}

const STORE = 'logs';
const done = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

/**
 * @param {string} name the database, one per product page ('story-quest', 'quest-demo-qa')
 * @param {{ indexedDB?: IDBFactory }} [options]
 * @returns {Promise<QuestStore>} IndexedDB, or memory when it cannot be opened
 */
export async function openQuestStore(name, { indexedDB = globalThis.indexedDB } = {}) {
  if (!indexedDB) return memoryStore();
  let db;
  try {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    db = await done(req);
  } catch (err) {
    console.warn('[quests] IndexedDB unavailable, the log lives with the page:', err);
    return memoryStore();
  }
  const tx = (mode) => db.transaction(STORE, mode).objectStore(STORE);
  return {
    kind: 'indexeddb',
    get: async (key) => (await done(tx('readonly').get(key))) ?? null,
    // resolved once the transaction committed: a reload right after sees the record
    put: (key, value) => new Promise((resolve, reject) => {
      const t = db.transaction(STORE, 'readwrite');
      t.objectStore(STORE).put(value, key);
      t.oncomplete = () => resolve();
      t.onerror = t.onabort = () => reject(t.error);
    }),
  };
}
