// A state card of the QA stand (docs/story-quest/quest-demo-qa.md «Картка стану»): a clean start
// (the iframe reloaded with the card's story and flags), the weather, the steps — the contract's
// commands, a teleport, no walk played out — and the expectation, read back through state.read.
// DOM-free: the page gives `load` and `call`, the plan's marks are what the card shows.
import { weatherOf } from '../shared/storyZones.js';

export const CARD_WAIT = Object.freeze({
  story: 120000,   // ms: the story fetched, compiled and the scene up
  expect: 10000,   // ms: the state settles into the expectation (the raft's «sea» comes on its own frame)
  poll: 250,
});

/** 'walker.swim.depth', 'frames.1.fate.kind' → the value in state.read, or undefined. */
export function readPath(state, path) {
  let v = state;
  for (const key of path.split('.')) {
    if (v === null || v === undefined) return undefined;
    v = v[key];
  }
  return v;
}

/**
 * What of `expect` the state does not hold. true / false — truthy / falsy; { min } / { max } — a
 * number's bounds; anything else — equal.
 * @returns {{ path: string, want: any, got: any }[]}
 */
export function mismatches(state, expect = {}) {
  const out = [];
  for (const [path, want] of Object.entries(expect)) {
    const got = readPath(state, path);
    let ok;
    if (want === true) ok = !!got;
    else if (want === false) ok = !got;
    else if (want && typeof want === 'object') {
      ok = typeof got === 'number' && (want.min === undefined || got >= want.min) && (want.max === undefined || got <= want.max);
    } else ok = got === want;
    if (!ok) out.push({ path, want, got });
  }
  return out;
}

/**
 * The cards file is data written by hand: what would break a run is refused when it is read.
 * @param {{ groups: { id: string }[], cards: any[] }} data @param {readonly string[]} [commands]
 * @returns {string[]} the problems, empty when fine
 */
export function checkCards(data, commands = null) {
  const problems = [];
  const groups = new Set((data.groups ?? []).map((g) => g.id));
  const ids = new Set();
  for (const c of data.cards ?? []) {
    const at = `card ${c.id ?? '?'}`;
    if (!c.id || ids.has(c.id)) problems.push(`${at}: id missing or twice`);
    ids.add(c.id);
    if (!groups.has(c.group)) problems.push(`${at}: unknown group ${c.group}`);
    if (!c.title?.uk || !c.title?.en) problems.push(`${at}: title needs uk and en`);
    if (typeof c.story !== 'string' || !c.story.includes('/')) problems.push(`${at}: story is <folder>/<story>`);
    if (!Array.isArray(c.steps) || !c.steps.length) problems.push(`${at}: no steps`);
    for (const s of c.steps ?? []) {
      if (typeof s.cmd !== 'string') problems.push(`${at}: a step without cmd`);
      else if (commands && !commands.includes(s.cmd)) problems.push(`${at}: ${s.cmd} is not a scene command`);
    }
    if (c.weather && !weatherOf(c.weather.preset)) problems.push(`${at}: unknown weather ${c.weather.preset}`);
    if (!c.expect || !Object.keys(c.expect).length) problems.push(`${at}: no expect`);
  }
  return problems;
}

/**
 * The card's marks: the load, the weather, each step, the expectation; each 'wait' → 'run' →
 * 'done' | 'failed' (with the reason).
 * @param {any} card
 * @returns {{ kind: string, cmd?: string, args?: any, status: string, reason?: string, message?: string, ms?: number }[]}
 */
export function planOf(card) {
  const w = card.weather ? weatherOf(card.weather.preset) : null;
  return [
    { kind: 'load', status: 'wait' },
    ...(w ? [{ kind: 'step', cmd: 'mood.set', args: { v: w.v, a: w.a, ...(card.weather.t === undefined ? {} : { t: card.weather.t }) }, status: 'wait' }] : []),
    ...card.steps.map((s) => ({ kind: 'step', cmd: s.cmd, args: s.args ?? {}, status: 'wait' })),
    { kind: 'expect', status: 'wait' },
  ];
}

/**
 * @param {any} card
 * @param {{ load: (params: { story: string, flags: string[] }) => Promise<any>,
 *   call: (cmd: string, args?: any, options?: any) => Promise<{ ok: boolean, value?: any, reason?: string, message?: string }> }} io
 * @param {{ story?: string | null, onChange?: (plan: any[]) => void, wait?: Partial<typeof CARD_WAIT>,
 *   now?: () => number, sleep?: (ms: number) => Promise<void> }} [options]
 * @returns {Promise<{ ok: boolean, plan: any[], state: any }>}
 */
export async function runCard(card, io, { story = null, onChange = () => {}, wait = {}, now = () => Date.now(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const W = { ...CARD_WAIT, ...wait };
  const plan = planOf(card);
  let state = null;
  const mark = (item, status, extra = {}) => { Object.assign(item, { status }, extra); onChange(plan); };
  const fail = (item, reason, message = '') => { mark(item, 'failed', { reason, message }); return { ok: false, plan, state }; };
  onChange(plan);

  // a clean start: the iframe anew, then the story up (or its failure) before any step
  const load = plan[0];
  let t0 = now();
  mark(load, 'run');
  await io.load({ story: story ?? card.story, flags: card.flags ?? [] });
  for (;;) {
    // oxlint-disable-next-line eslint/no-await-in-loop
    const r = await io.call('state.read');
    if (r.ok && r.value.ready) { state = r.value; break; }
    // oxlint-disable-next-line eslint/no-await-in-loop
    const c = await io.call('catalog.read');
    if (c.ok && c.value.state === 'failed') return fail(load, 'story-failed', c.value.error?.code ?? '');
    if (!r.ok && r.reason === 'closed') return fail(load, 'closed', r.message);
    if (now() - t0 > W.story) return fail(load, 'timeout', `the story was not up in ${W.story} ms`);
    // oxlint-disable-next-line eslint/no-await-in-loop
    await sleep(W.poll);
  }
  mark(load, 'done', { ms: now() - t0 });

  for (const item of plan.filter((p) => p.kind === 'step')) {
    t0 = now();
    mark(item, 'run');
    // oxlint-disable-next-line eslint/no-await-in-loop
    const r = await io.call(item.cmd, item.args);
    if (!r.ok) return fail(item, r.reason ?? 'failed', r.message);
    if (r.value && typeof r.value === 'object' && 'mode' in r.value) state = r.value;
    mark(item, 'done', { ms: now() - t0 });
  }

  const expect = plan.at(-1);
  t0 = now();
  mark(expect, 'run');
  for (;;) {
    // oxlint-disable-next-line eslint/no-await-in-loop
    const r = await io.call('state.read');
    if (!r.ok) return fail(expect, r.reason ?? 'failed', r.message);
    state = r.value;
    const miss = mismatches(state, card.expect);
    if (!miss.length) { mark(expect, 'done', { ms: now() - t0 }); return { ok: true, plan, state }; }
    if (now() - t0 > W.expect) {
      return fail(expect, 'expect', miss.map((m) => `${m.path}: ${JSON.stringify(m.got)} ≠ ${JSON.stringify(m.want)}`).join('; '));
    }
    // oxlint-disable-next-line eslint/no-await-in-loop
    await sleep(W.poll);
  }
}
