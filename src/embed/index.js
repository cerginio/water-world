// The scene in a product's <iframe ?…&embed> (STORY-QUEST-SPEC §4.4): binds the contract to
// postMessage. Only the parent window of the same origin is heard and answered; the route's
// facts (raft, miniatures, fates) go to it as events once the story's scene is up.
import { createEmbedServer, until } from './protocol.js';
import { catalogState, createCommands, WAIT } from './commands.js';
import { worldFromApp } from './world.js';

const RAFT_EVENTS = ['board', 'leave', 'kite', 'sea', 'takeoff', 'land'];
const MINI_EVENTS = ['take', 'put', 'unfold', 'hydrate'];

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
  const parent = target.parent;
  const send = (message) => { if (parent && parent !== target) parent.postMessage(message, target.location.origin); };
  const commands = createCommands(world);
  const server = createEmbedServer({ commands, send });
  target.addEventListener('message', (e) => {
    if (e.source !== parent || e.origin !== target.location.origin) return;
    server.receive(e.data).catch((err) => console.error('[embed]', err));
  });
  // the catalog at once: a product words «loading» / «failed» and offers the list without a scene
  world.catalog.addEventListener('change', () => server.emit('catalog.change', catalogState(world.catalog)));
  // the facts of the route, once there is a scene to have them
  until(() => world.ready() || world.failed(), WAIT.ready, 'the story').then(() => {
    const failed = world.failed();
    if (failed) { server.emit('scene.failed', { reason: failed }); return; }
    for (const type of RAFT_EVENTS) world.raft.addEventListener(type, (e) => server.emit(`raft.${type}`, plain(e.detail)));
    for (const type of MINI_EVENTS) world.minis?.addEventListener(type, (e) => server.emit(`minis.${type}`, plain(e.detail)));
    world.fates.addEventListener('change', (e) => server.emit('fate.change', plain(e.detail)));
    server.emit('scene.ready', { story: world.story() });
  }).catch((err) => server.emit('scene.failed', { reason: err.reason ?? 'failed', message: String(err.message) }));
  return { server, commands };
}
