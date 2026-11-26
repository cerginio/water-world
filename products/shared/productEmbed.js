import { acceptsParent, parentOrigin } from '../../shared/embed-origin.js';
import { CHANNEL } from './contract.js';

const LIFECYCLE = ['activate', 'deactivate', 'dispose'];

// Оболонка не відкриває зовнішньому хосту записи карток чи довільний код.
export function mountProductEmbed({ host, iframe, quests, shell, target = window, devOrigin = null }) {
  const origin = parentOrigin(target.location, { devOrigin });
  const commands = [...LIFECYCLE, 'state.read', 'quest.start',
    'walker.place', 'walker.look', 'minis.take', 'minis.hydrate', 'raft.board', 'raft.moveTo', 'kite.set',
    'fly.takeOff', 'fly.to', 'swim.in', 'swim.dive', 'swim.rise', 'mood.set'];
  let disposed = false, busy = false;
  const send = (message) => {
    if (origin && target.parent !== target) target.parent.postMessage({ channel: CHANNEL, ...message }, origin);
  };
  const off = host.on((name, detail) => {
    if (!disposed && ['scene.ready', 'scene.failed'].includes(name)) send({ type: 'event', name, detail });
  });
  const receive = async (event) => {
    if (!acceptsParent(event, target, origin)) return;
    const m = event.data;
    if (!m || m.channel !== CHANNEL) return;
    if (m.type === 'hello') { send({ type: 'ready', version: 1, commands }); return; }
    if (m.type !== 'call') return;
    let result;
    if (disposed) result = { ok: false, reason: 'disposed' };
    else if (!commands.includes(m.cmd)) result = { ok: false, reason: 'unknown-command' };
    else if (m.cmd === 'quest.start') {
      if (busy) result = { ok: false, reason: 'busy' };
      else {
        busy = true;
        try {
          result = await quests.start(m.args?.id);
          if (result.ok) { shell.setOpen(true); shell.zones.querySelector('[data-task="' + m.args.id + '"]')?.scrollIntoView({ block: 'nearest' }); }
        } catch { result = { ok: false, reason: 'failed' }; }
        finally { busy = false; }
      }
    } else {
      result = await host.call(m.cmd, m.args, { timeout: 30000 });
      if (result.ok && m.cmd === 'dispose') {
        disposed = true;
        off();
        host.dispose();
        iframe.remove();
      }
    }
    send({ type: 'result', id: m.id, ...result });
    if (disposed) target.removeEventListener('message', receive);
  };
  target.addEventListener('message', receive);
  return () => { off(); target.removeEventListener('message', receive); };
}
