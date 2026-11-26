// The product's side of the scene contract (STORY-QUEST-SPEC §4.4, docs/story-quest/quest-demo-qa.md
// «Контракт сцени»). The scene's side is src/embed/protocol.js; products never import src/**
// (guard BOUNDARY-5), so the channel name and the message shapes are spoken here from the outside,
// the way probe-story-embed's test host speaks them. DOM-free: sceneHost.js binds it to an iframe.
//
// host → scene  { channel, type: 'hello' } · { channel, type: 'call', id, cmd, args }
// scene → host  { channel, type: 'ready', version, commands } · { type: 'result', id, ok, value | reason, message }
//               { type: 'event', name, detail }

export const CHANNEL = 'ultra-water/scene';

/**
 * @typedef {{ ok: true, value: any } | { ok: false, reason: string, message: string }} CallResult
 * A call never throws: a refusal of the scene and the host's own timeout are both a result.
 */

/**
 * @param {{ post: (message: any) => void, helloEvery?: number, callTimeout?: number,
 *   timers?: { setInterval: typeof setInterval, clearInterval: typeof clearInterval, setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout } }} options
 */
export function createSceneClient({ post, helloEvery = 150, callTimeout = 120000, timers = globalThis }) {
  const pending = new Map();
  const listeners = new Map();
  let seq = 0, hello = null, closed = false;
  /** @type {{ version: number, commands: string[] } | null} */
  let info = null;
  let markReady, markGone;
  /** @type {Promise<{ version: number, commands: string[] }>} */
  const ready = new Promise((resolve) => { markReady = resolve; });
  const gone = new Promise((resolve) => { markGone = resolve; });

  const emit = (name, detail) => {
    for (const fn of [...(listeners.get(name) ?? []), ...(listeners.get('*') ?? [])]) fn(detail, name);
  };

  return {
    ready,
    get info() { return info; },
    /** hello until the scene answers ready (it may not be listening yet while it loads) */
    connect() {
      if (hello || info || closed) return ready;
      const say = () => post({ channel: CHANNEL, type: 'hello' });
      say();
      hello = timers.setInterval(say, helloEvery);
      return ready;
    },
    /** One message from the scene's window. Not ours → false. */
    receive(data) {
      if (closed || !data || typeof data !== 'object' || data.channel !== CHANNEL) return false;
      if (data.type === 'ready') {
        if (hello) { timers.clearInterval(hello); hello = null; }
        if (!info) { info = { version: data.version, commands: data.commands ?? [] }; markReady(info); }
        return true;
      }
      if (data.type === 'result') {
        const p = pending.get(data.id);
        if (!p) return true;
        pending.delete(data.id);
        timers.clearTimeout(p.timer);
        p.resolve(data.ok ? { ok: true, value: data.value } : { ok: false, reason: data.reason ?? 'failed', message: data.message ?? '' });
        return true;
      }
      if (data.type === 'event') { emit(data.name, data.detail ?? null); return true; }
      return false;
    },
    /**
     * @param {string} cmd @param {any} [args] @param {{ timeout?: number }} [options]
     * @returns {Promise<CallResult>}
     */
    async call(cmd, args = {}, { timeout = callTimeout } = {}) {
      // a call before the scene answered hello waits for it: a message sent earlier would be lost
      if (!info && !closed) await Promise.race([ready, gone]);
      if (closed) return { ok: false, reason: 'closed', message: 'the scene was reloaded' };
      const id = ++seq;
      return new Promise((resolve) => {
        const timer = timers.setTimeout(() => {
          pending.delete(id);
          resolve({ ok: false, reason: 'timeout', message: `no answer to ${cmd} in ${timeout} ms` });
        }, timeout);
        pending.set(id, { resolve, timer });
        post({ channel: CHANNEL, type: 'call', id, cmd, args });
      });
    },
    /** @param {string} name an event name, or '*' for all @param {(detail: any, name: string) => void} fn */
    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
      return () => listeners.get(name).delete(fn);
    },
    /** The scene is gone (reloaded): calls in flight end as 'closed', nothing more is heard. */
    close() {
      closed = true;
      markGone();
      if (hello) { timers.clearInterval(hello); hello = null; }
      for (const [, p] of pending) { timers.clearTimeout(p.timer); p.resolve({ ok: false, reason: 'closed', message: 'the scene was reloaded' }); }
      pending.clear();
    },
  };
}

/**
 * The scene page's address for a product's iframe: the story and the flags are static (spec §4.4),
 * `embed` always. Bare flags (`&walk`), the story's `/` kept readable; `lang` — the words of the
 * scene's own buttons (Q7: the product's language).
 * @param {string} base the scene page, e.g. new URL('../../', location.href).href
 * @param {{ story?: string | null, flags?: string[], lang?: string | null }} [options]
 */
export function sceneUrl(base, { story = null, flags = [], lang = null } = {}) {
  const parts = [];
  if (story) parts.push(`story=${encodeURIComponent(story).replace(/%2F/gi, '/')}`);
  if (lang) {
    if (!/^[a-z]{2}$/.test(lang)) throw new Error(`bad scene lang: ${lang}`);
    parts.push(`lang=${lang}`);
  }
  for (const f of [...new Set([...flags, 'embed'])]) {
    if (!/^[a-z][a-z0-9-]*$/.test(f)) throw new Error(`bad scene flag: ${f}`);
    parts.push(f);
  }
  const url = new URL(base);
  url.search = `?${parts.join('&')}`;
  return url.href;
}
