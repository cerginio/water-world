// The scene's contract for products (STORY-QUEST-SPEC §4.4, docs/story-quest/quest-demo-qa.md):
// a product page hosts the scene in an <iframe ?…&embed> and talks to it only by these messages,
// modelled on Tilecraft's lib/message-api.js (hello/ready, RPC), without importing it. DOM-free:
// index.js binds it to postMessage.
//
// host → scene  { channel, type: 'hello' }
//               { channel, type: 'call', id, cmd, args }
// scene → host  { channel, type: 'ready', version, commands }        (answer to every hello)
//               { channel, type: 'result', id, ok: true, value }
//               { channel, type: 'result', id, ok: false, reason, message }
//               { channel, type: 'event', name, detail }

export const CHANNEL = 'ultra-water/scene';
export const VERSION = 1;

/** A refusal with a reason the host can act on: 'unknown-command', 'bad-args', 'timeout'… */
export class EmbedError extends Error {
  /** @param {string} reason @param {string} [message] */
  constructor(reason, message = reason) {
    super(message);
    this.name = 'EmbedError';
    this.reason = reason;
  }
}

/**
 * @param {{ commands: Record<string, (args: any) => any>, send: (message: any) => void }} options
 */
export function createEmbedServer({ commands, send }) {
  const names = Object.freeze(Object.keys(commands));
  const reply = (message) => send({ channel: CHANNEL, ...message });
  return {
    commands: names,
    /**
     * One incoming message. Not ours (another channel, no type) → false and nothing is sent.
     * @returns {Promise<boolean>}
     */
    async receive(data) {
      if (!data || typeof data !== 'object' || data.channel !== CHANNEL) return false;
      if (data.type === 'hello') {
        reply({ type: 'ready', version: VERSION, commands: names });
        return true;
      }
      if (data.type !== 'call') return false;
      const { id, cmd, args = {} } = data;
      const run = Object.hasOwn(commands, cmd) ? commands[cmd] : null;
      if (!run) {
        reply({ type: 'result', id, ok: false, reason: 'unknown-command', message: `unknown command: ${String(cmd)}` });
        return true;
      }
      try {
        const value = await run(args ?? {});
        reply({ type: 'result', id, ok: true, value: value ?? null });
      } catch (e) {
        const reason = e instanceof EmbedError ? e.reason : 'failed';
        reply({ type: 'result', id, ok: false, reason, message: String(e?.message ?? e) });
      }
      return true;
    },
    /** A fact of the route to the host: 'raft.board', 'minis.hydrate', 'fate.change'… */
    emit(name, detail = null) {
      reply({ type: 'event', name, detail });
    },
  };
}

/**
 * Polls `test` until it is truthy (its value is returned) or `ms` pass → EmbedError 'timeout'.
 * @template T @param {() => T} test @param {number} ms @param {string} what
 * @returns {Promise<T>}
 */
export async function until(test, ms, what, step = 50) {
  const end = Date.now() + ms;
  for (;;) {
    const v = test();
    if (v) return v;
    if (Date.now() >= end) throw new EmbedError('timeout', `timeout after ${ms} ms: ${what}`);
    // oxlint-disable-next-line eslint/no-await-in-loop
    await new Promise((r) => setTimeout(r, step));
  }
}
