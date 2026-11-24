// The story catalog of R2 (STORY-QUEST-SPEC §4.1 «Каталог»): list(), load(id, { signal }),
// a state pending / ready / failed and a `change` event. Headless: no DOM, no messages
// in a language — an error is a { code, message } pair the product words itself (§4).
// The R2 client is Tilecraft's (lib/story-catalog.js, through tilecraftCatalog.js),
// injected as `runtime` so the states are testable without the network.
//
// A story's address is its folder and slug — `public-test/frog-fairy-full`, as
// Tilecraft's forCatalog({ folder, scope }): every folder has its own index.json.
// The payload load() gives is the shape TileField.load takes from a fixture or a file.

export const CATALOG_FOLDERS = Object.freeze(['public-test', 'test-2025']);
export const DEFAULT_FOLDER = 'public-test';
/** the dev fallback: Tilecraft's fixtures/catalog/, served by the dev server only (spec §5) */
export const LOCAL_FOLDER = 'local';
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * `folder/slug` or a bare `slug` (→ DEFAULT_FOLDER) → { id, folder, slug }, or null when
 * the folder is not one of `folders` or the slug is not canonical.
 * @param {unknown} value @param {readonly string[]} [folders]
 */
export function parseStoryId(value, folders = CATALOG_FOLDERS) {
  if (typeof value !== 'string') return null;
  const parts = value.trim().split('/');
  const [folder, slug] = parts.length === 1 ? [DEFAULT_FOLDER, parts[0]] : parts.length === 2 ? parts : [null, null];
  if (!folders.includes(folder) || slug.length > 80 || !SLUG.test(slug)) return null;
  return { id: `${folder}/${slug}`, folder, slug };
}

/** Tilecraft's client throws plain messages; the product needs a kind to word. */
export function errorCode(error) {
  const text = String(error?.message ?? error);
  if (text === 'Network error') return 'network';
  if (text === 'HTTP 404' || text === 'HTTP 403') return 'not-found';
  if (/^HTTP \d+/.test(text)) return 'http';
  if (/^(?:Invalid|Expected JSON|Response is too large|Story catalog is too large|Story has no visible frames)/.test(text)) return 'invalid';
  return 'unknown';
}

const abortError = (signal) => signal.reason ?? new DOMException('Aborted', 'AbortError');

/**
 * @param {{ runtime: () => Promise<any>, fetcher?: typeof fetch, folders?: readonly string[], localBase?: string | null }} options
 *   localBase — absolute URL of the dev fallback catalog, or null (production)
 */
export function createCatalog({ runtime, fetcher = (...a) => fetch(...a), folders = CATALOG_FOLDERS, localBase = null }) {
  const known = localBase ? [...folders, LOCAL_FOLDER] : [...folders];
  const events = new EventTarget();
  let current = null;   // AbortController of the load in flight
  const catalog = {
    state: /** @type {'idle' | 'pending' | 'ready' | 'failed'} */ ('idle'),
    story: null,          // { id, folder, slug } of the last load()
    error: null,          // { code, message } when state is 'failed'
    fallback: false,      // the last list() came from the local fixtures
    folders: known,
    parse: (value) => parseStoryId(value, known),
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    list, load,
  };

  function set(state, story, error = null) {
    Object.assign(catalog, { state, story, error });
    events.dispatchEvent(Object.assign(new Event('change'), { detail: { state, story, error } }));
  }

  async function clientOf(folder) {
    const tc = await runtime();
    return folder === LOCAL_FOLDER ? tc.forBase(localBase) : tc.forCatalog({ folder, scope: '' });
  }
  const bound = (signal) => (url, init) => fetcher(url, { ...init, signal });

  // every folder's index; a folder that fails is reported, not fatal. All of R2 down
  // (and a dev fallback configured) → the local fixtures, marked `fallback`.
  /** @param {{ signal?: AbortSignal }} [options] */
  async function list({ signal } = {}) {
    const read = async (folder) => {
      const index = await (await clientOf(folder)).fetchIndex(bound(signal));
      return index.stories.map(({ slug, title, credit, frameCount, sizeBytes, publishedAt }) =>
        ({ id: `${folder}/${slug}`, folder, slug, title, credit, frameCount, sizeBytes, publishedAt }));
    };
    const results = await Promise.allSettled(folders.map(read));
    if (signal?.aborted) throw abortError(signal);
    const errors = [];
    const stories = [];
    results.forEach((r, i) => r.status === 'fulfilled' ? stories.push(...r.value)
      : errors.push({ folder: folders[i], code: errorCode(r.reason), message: String(r.reason?.message ?? r.reason) }));
    catalog.fallback = false;
    if (!stories.length && errors.length === folders.length && localBase) {
      stories.push(...await read(LOCAL_FOLDER));
      catalog.fallback = true;
    }
    if (!stories.length && errors.length) throw Object.assign(new Error(errors[0].message), { code: errors[0].code, errors });
    return { stories, errors, fallback: catalog.fallback };
  }

  // one story; a newer load() supersedes (aborts) the one in flight. Abort is not a
  // failure: the state goes back to idle and the promise rejects with the AbortError.
  /** @param {unknown} value @param {{ signal?: AbortSignal }} [options] */
  async function load(value, { signal } = {}) {
    current?.abort();
    const own = new AbortController();
    current = own;
    const onAbort = () => own.abort(signal.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) own.abort(signal.reason);
    const story = parseStoryId(value, known);
    try {
      if (!story) {
        const error = { code: 'unknown-story', message: `Unknown story «${String(value)}»` };
        set('failed', null, error);
        throw Object.assign(new Error(error.message), { code: error.code });
      }
      set('pending', story);
      let model;
      try {
        const client = await clientOf(story.folder);
        // superseded or aborted while the client loaded: never start the fetch
        if (own.signal.aborted) throw abortError(own.signal);
        model = await client.fetchStory(story.slug, bound(own.signal));
        if (own.signal.aborted) throw abortError(own.signal);
      } catch (e) {
        if (own.signal.aborted) {
          if (current === own) set('idle', story);
          throw abortError(own.signal);
        }
        if (current === own) set('failed', story, { code: errorCode(e), message: String(e?.message ?? e) });
        throw Object.assign(new Error(String(e?.message ?? e)), { code: errorCode(e), cause: e });
      }
      if (current === own) set('ready', story);
      return { id: story.id, model, world: null, sidecar: null, fingerprint: null, story };
    } finally {
      signal?.removeEventListener('abort', onAbort);
      if (current === own) current = null;
    }
  }

  return catalog;
}
