// One scene in one <iframe> for the whole product page (quest-demo-qa.md «Сторінка»: every zone acts
// on the same iframe). load() navigates it — a clean start, the scene's state does not depend on what
// was before — and gives a fresh contract client; listeners added with on() outlive reloads.
// Only the iframe's own window of this origin is heard (the scene answers only its same-origin parent).
import { createSceneClient, sceneUrl } from './contract.js';

/**
 * @param {{ iframe: HTMLIFrameElement, base?: string }} options base — the scene page (the site root)
 */
export function createSceneHost({ iframe, base = new URL('../../', location.href).href }) {
  /** @type {ReturnType<typeof createSceneClient> | null} */
  let client = null;
  let address = null;
  const listeners = new Set();

  const receive = (e) => {
    if (e.source !== iframe.contentWindow || e.origin !== location.origin) return;
    client?.receive(e.data);
  };
  addEventListener('message', receive);

  return {
    get client() { return client; },
    get url() { return address; },
    /**
     * @param {{ story?: string | null, flags?: string[], lang?: string | null }} params
     * @returns {Promise<{ version: number, commands: string[] }>} once the scene's contract answers
     */
    load(params) {
      client?.close();
      address = sceneUrl(base, params);
      const c = createSceneClient({ post: (m) => iframe.contentWindow?.postMessage(m, location.origin) });
      client = c;
      c.on('*', (detail, name) => { for (const fn of listeners) fn(name, detail); });
      // hello only to the new document: until it commits, the old scene would answer «ready»
      iframe.addEventListener('load', () => { if (client === c) c.connect(); }, { once: true });
      iframe.src = address;
      return c.ready;
    },
    /** @param {string} cmd @param {any} [args] @param {{ timeout?: number }} [options] */
    call(cmd, args, options) {
      return client ? client.call(cmd, args, options) : Promise.resolve({ ok: false, reason: 'no-scene', message: 'no scene loaded' });
    },
    /** every event of every load: (name, detail) */
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    dispose() { client?.close(); client = null; listeners.clear(); removeEventListener('message', receive); },
  };
}
