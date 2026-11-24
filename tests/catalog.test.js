// story-quest Q1: the catalog's states, cancellation and failures (STORY-QUEST-SPEC §4.1).
// The R2 client is a stand-in with Tilecraft's lib/story-catalog.js contract: forCatalog /
// forBase → { fetchIndex(fetcher), fetchStory(slug, fetcher) }, errors 'Network error' /
// 'HTTP <n>' / 'Invalid …'. The stand-in calls the fetcher it is given, as the real one
// does, so the signal reaching the network is what is under test.
import { describe, expect, it } from 'vitest';
import { createCatalog, errorCode, parseStoryId } from '../src/catalog/catalog.js';

const INDEX = (folder) => ({ stories: [{ slug: `${folder}-a`, title: `A ${folder}`, credit: '', frameCount: 3, sizeBytes: 10, publishedAt: '2026-11-07T15:01:09.000Z' }] });
const MODEL = { frames: [{ id: 1 }], layers: [{ tiles: [{ x: 0, y: 0, f: 1 }] }] };

// a fetcher that answers by URL, or hangs until its signal aborts
function network({ down = new Set(), status = {}, hang = false } = {}) {
  const calls = [];
  const fetcher = (url, init = {}) => {
    calls.push({ url, signal: init.signal });
    if (hang) return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(init.signal.reason)));
    if (init.signal?.aborted) return Promise.reject(init.signal.reason);
    const folder = url.split('/')[0];
    if (down.has(folder)) return Promise.reject(new TypeError('Failed to fetch'));
    return Promise.resolve({ url, status: status[url] ?? 200 });
  };
  return { fetcher, calls };
}
const runtime = () => Promise.resolve({
  forCatalog: ({ folder }) => client(folder),
  forBase: () => client('local'),
});
function client(folder) {
  const read = async (path, fetcher, body) => {
    let response;
    try { response = await fetcher(`${folder}/${path}`, {}); } catch { throw new Error('Network error'); }
    if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
    return body;
  };
  return {
    fetchIndex: (fetcher) => read('index.json', fetcher, INDEX(folder)),
    fetchStory: (slug, fetcher) => read(`${slug}.json`, fetcher, MODEL),
  };
}
const states = (catalog) => {
  const seen = [];
  catalog.addEventListener('change', (e) => seen.push(e.detail.state));
  return seen;
};

describe('parseStoryId', () => {
  it('takes folder/slug and a bare slug in the default folder', () => {
    expect(parseStoryId('test-2025/my-day-3-moments')).toEqual({ id: 'test-2025/my-day-3-moments', folder: 'test-2025', slug: 'my-day-3-moments' });
    expect(parseStoryId('frog-fairy-full')?.id).toBe('public-test/frog-fairy-full');
  });
  it('refuses unknown folders, paths and non-canonical slugs', () => {
    for (const bad of ['elsewhere/x', 'a/b/c', 'public-test/../x', 'public-test/Frog', '', 'public-test/', null]) {
      expect(parseStoryId(bad)).toBeNull();
    }
  });
});

describe('errorCode', () => {
  it('maps the Tilecraft client messages to kinds the product can word', () => {
    expect(errorCode(new Error('Network error'))).toBe('network');
    expect(errorCode(new Error('HTTP 404'))).toBe('not-found');
    expect(errorCode(new Error('HTTP 500'))).toBe('http');
    expect(errorCode(new Error('Invalid story model'))).toBe('invalid');
    expect(errorCode(new Error('Invalid JSON'))).toBe('invalid');
    expect(errorCode(new Error('boom'))).toBe('unknown');
  });
});

describe('load', () => {
  it('pending → ready, and the payload is the shape TileField.load takes', async () => {
    const { fetcher } = network();
    const catalog = createCatalog({ runtime, fetcher });
    const seen = states(catalog);
    const payload = await catalog.load('test-2025/my-day-3-moments');
    expect(seen).toEqual(['pending', 'ready']);
    expect(catalog.state).toBe('ready');
    expect(payload).toMatchObject({ id: 'test-2025/my-day-3-moments', model: MODEL, world: null, sidecar: null,
      story: { folder: 'test-2025', slug: 'my-day-3-moments' } });
  });

  it('a network failure → failed with code network, and the promise rejects', async () => {
    const { fetcher } = network({ down: new Set(['public-test']) });
    const catalog = createCatalog({ runtime, fetcher });
    const seen = states(catalog);
    await expect(catalog.load('public-test/frog-fairy-full')).rejects.toMatchObject({ code: 'network' });
    expect(seen).toEqual(['pending', 'failed']);
    expect(catalog.error).toEqual({ code: 'network', message: 'Network error' });
  });

  it('a missing story → failed with code not-found', async () => {
    const { fetcher } = network({ status: { 'public-test/nope.json': 404 } });
    const catalog = createCatalog({ runtime, fetcher });
    await expect(catalog.load('nope')).rejects.toMatchObject({ code: 'not-found' });
    expect(catalog.state).toBe('failed');
  });

  it('an unknown address fails without touching the network', async () => {
    const { fetcher, calls } = network();
    const catalog = createCatalog({ runtime, fetcher });
    await expect(catalog.load('../etc/passwd')).rejects.toMatchObject({ code: 'unknown-story' });
    expect(catalog.state).toBe('failed');
    expect(calls).toEqual([]);
  });

  it('the caller signal reaches the fetch and aborts it: idle, not failed', async () => {
    const { fetcher, calls } = network({ hang: true });
    const catalog = createCatalog({ runtime, fetcher });
    const seen = states(catalog);
    const abort = new AbortController();
    const pending = catalog.load('public-test/frog-fairy-full', { signal: abort.signal });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toHaveLength(1);
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls[0].signal.aborted).toBe(true);
    expect(seen).toEqual(['pending', 'idle']);
    expect(catalog.error).toBeNull();
  });

  it('an already aborted signal never reaches the network', async () => {
    const { fetcher, calls } = network();
    const catalog = createCatalog({ runtime, fetcher });
    const abort = new AbortController();
    abort.abort();
    await expect(catalog.load('frog-fairy-full', { signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toEqual([]);
    expect(catalog.state).toBe('idle');
  });

  it('a newer load supersedes the one in flight: only the newer one sets the state', async () => {
    let release;
    const gate = new Promise((r) => (release = r));
    const fetcher = async (url, init) => {
      if (url.includes('slow')) {
        await new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
      }
      await gate;
      return { status: 200 };
    };
    const catalog = createCatalog({ runtime, fetcher });
    const first = catalog.load('public-test/slow');
    const second = catalog.load('public-test/fast');
    release();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await expect(second).resolves.toMatchObject({ id: 'public-test/fast' });
    expect(catalog.state).toBe('ready');
    expect(catalog.story.id).toBe('public-test/fast');
  });
});

describe('list', () => {
  it('every folder, each story addressed by folder/slug', async () => {
    const { fetcher } = network();
    const { stories, errors, fallback } = await createCatalog({ runtime, fetcher }).list();
    expect(stories.map((s) => s.id)).toEqual(['public-test/public-test-a', 'test-2025/test-2025-a']);
    expect(errors).toEqual([]);
    expect(fallback).toBe(false);
  });

  it('one folder down is reported, the rest is listed', async () => {
    const { fetcher } = network({ down: new Set(['test-2025']) });
    const { stories, errors } = await createCatalog({ runtime, fetcher }).list();
    expect(stories.map((s) => s.folder)).toEqual(['public-test']);
    expect(errors).toEqual([{ folder: 'test-2025', code: 'network', message: 'Network error' }]);
  });

  it('R2 down with a dev fallback → the local stories, marked fallback, loadable', async () => {
    const { fetcher } = network({ down: new Set(['public-test', 'test-2025']) });
    const catalog = createCatalog({ runtime, fetcher, localBase: 'http://localhost:5199/tilecraft/catalog/' });
    const { stories, fallback } = await catalog.list();
    expect(fallback).toBe(true);
    expect(stories.map((s) => s.id)).toEqual(['local/local-a']);
    await expect(catalog.load('local/local-a')).resolves.toMatchObject({ id: 'local/local-a' });
  });

  it('R2 down without a fallback (production) rejects with the kind', async () => {
    const { fetcher } = network({ down: new Set(['public-test', 'test-2025']) });
    const catalog = createCatalog({ runtime, fetcher });
    await expect(catalog.list()).rejects.toMatchObject({ code: 'network' });
    expect(catalog.parse('local/x')).toBeNull();
  });
});
