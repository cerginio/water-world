// Контракт сцени: лише безпосередній parent з дозволеним origin (EXU §6.1).
import { createEmbedServer, until } from './protocol.js';
import { catalogState, createCommands, WAIT } from './commands.js';
import { worldFromApp } from './world.js';
import { acceptsParent, parentOrigin } from '../../shared/embed-origin.js';

const RAFT_EVENTS = ['board', 'leave', 'kite', 'sea', 'takeoff', 'land'];
const MINI_EVENTS = ['take', 'put', 'unfold', 'hydrate', 'pack', 'unpack'];

/** Ids in event details as strings: a product keys its facts by them. */
const plain = (detail) => {
  if (!detail || typeof detail !== 'object') return detail ?? null;
  const out = {};
  for (const [k, v] of Object.entries(detail)) out[k] = typeof v === 'number' || typeof v === 'boolean' || v === null ? v : String(v);
  return out;
};

/**
 * @param {{ app: any, spawn: () => { x: number, z: number, yaw: number }, target?: Window }} options
 * @returns {{ server: ReturnType<typeof createEmbedServer>, commands: Record<string, (args?: any) => Promise<any>> }}
 */
export function startEmbed({ app, spawn, target = window }) {
  const world = worldFromApp({ app, spawn });
  const controller = new AbortController();
  const options = { signal: controller.signal };
  const parent = target.parent;
  const origin = parentOrigin(target.location, { devOrigin: import.meta.env.DEV ? 'http://127.0.0.1:8184' : null });
  const send = (message) => { if (origin && parent && parent !== target) parent.postMessage(message, origin); };
  const commands = Object.freeze({ ...createCommands(world),
    activate: () => app.lifecycle.activate(),
    deactivate: () => app.lifecycle.deactivate(),
    dispose: () => { controller.abort(); return app.lifecycle.dispose(); },
  });
  const server = createEmbedServer({ commands, send });
  target.addEventListener('message', (e) => {
    if (!acceptsParent(e, target, origin)) return;
    server.receive(e.data).catch((err) => console.error('[embed]', err));
  }, options);
  // the catalog at once: a product words «loading» / «failed» and offers the list without a scene
  world.catalog.addEventListener('change', () => server.emit('catalog.change', catalogState(world.catalog)), options);
  // the facts of the route, once there is a scene to have them
  until(() => world.ready() || world.failed(), WAIT.ready, 'the story').then(() => {
    if (controller.signal.aborted) return;
    const failed = world.failed();
    if (failed) { server.emit('scene.failed', { reason: failed }); return; }
    for (const type of RAFT_EVENTS) world.raft.addEventListener(type, (e) => server.emit(`raft.${type}`, plain(e.detail)), options);
    for (const type of MINI_EVENTS) world.minis?.addEventListener(type, (e) => server.emit(`minis.${type}`, plain(e.detail)), options);
    world.fates.addEventListener('change', (e) => server.emit('fate.change', plain(e.detail)), options);
    server.emit('scene.ready', { story: world.story(), fingerprint: world.fingerprint() });
  }).catch((err) => server.emit('scene.failed', { reason: err.reason ?? 'failed', message: String(err.message) }));
  return { server, commands };
}
