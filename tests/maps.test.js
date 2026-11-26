// The map profiles and `map` in the contract (ISLAND-MAPS-SPEC §2, §4.1–§4.3; terra T1).
import { describe, expect, it } from 'vitest';
import { DEFAULT_MAP, MAPS, pickMap, rayTo } from '../src/scene/maps.js';
import { islandHeight } from '../src/scene/islandHeight.js';
import { readState } from '../src/embed/state.js';
import { resolveAnchor } from '../src/embed/anchors.js';
import { knownMap, SCENE_MAPS, sceneUrl } from '../products/shared/contract.js';

describe('pickMap', () => {
  it('missing, empty, unknown or inherited ids open the island', () => {
    for (const id of [null, undefined, '', 'foo', 'ISLAND', 'toString', '__proto__']) {
      expect(pickMap(id).id).toBe('island');
    }
    expect(DEFAULT_MAP).toBe('island');
    expect(pickMap('island')).toBe(MAPS.island);
  });

  it('every profile id is one the product may pass (and only those)', () => {
    for (const id of Object.keys(MAPS)) expect(SCENE_MAPS).toContain(id);
  });

  it('island: the relief is islandHeight, the story coast and the surf rock as before T1', () => {
    const m = pickMap('island');
    expect(m.heightAt).toBe(islandHeight);
    expect(m.storyBearing(0.25)).toBeCloseTo(1.45, 12);
    // the surf rock: bearing -15°, the first metre out from 100 m with the bed at -2.5 m or deeper
    const rock = m.heroRock();
    const a = -15 * (Math.PI / 180);
    expect(Math.atan2(rock.z, rock.x)).toBeCloseTo(a, 12);
    expect(islandHeight(rock.x, rock.z)).toBeLessThanOrEqual(-2.5);
    const r = Math.hypot(rock.x, rock.z);
    expect(islandHeight(Math.cos(a) * (r - 1), Math.sin(a) * (r - 1))).toBeGreaterThan(-2.5);
    expect(m.heroRock()).toBe(rock);
    expect(m.openSea).toBeNull();
  });

  it('rayTo stops at the first point at or below the level, or at the end of the ray', () => {
    const flat = () => 1;
    expect(rayTo(flat, 0, { from: 10, to: 20, step: 5 })).toEqual({ x: 20, z: 0 });
    const step = (x) => (x < 42 ? 1 : -1);
    expect(rayTo(step, 0, { from: 0, to: 100, step: 2 }).x).toBe(42);
  });
});

describe('map in the scene URL', () => {
  const base = 'http://localhost:5199/';
  it('lagoon goes as map=lagoon after lang; island is the default and goes without it', () => {
    expect(sceneUrl(base, { story: 'a/b', flags: ['walk'], lang: 'uk', map: 'lagoon' }))
      .toBe('http://localhost:5199/?story=a/b&lang=uk&map=lagoon&walk&embed');
    expect(sceneUrl(base, { story: 'a/b', map: 'island' })).toBe('http://localhost:5199/?story=a/b&embed');
    expect(sceneUrl(base, { story: 'a/b', map: null })).toBe('http://localhost:5199/?story=a/b&embed');
  });

  it('an unknown map never reaches the iframe', () => {
    expect(() => sceneUrl(base, { map: 'foo' })).toThrow(/unknown scene map/);
    expect(() => sceneUrl(base, { map: 'lagoon&walk' })).toThrow();
    expect(knownMap('foo')).toBeNull();
    expect(knownMap(null)).toBeNull();
    expect(knownMap('lagoon')).toBe('lagoon');
  });
});

describe('map in state.read and the open-sea anchor', () => {
  const world = (over = {}) => ({ host: null, raft: null, fates: null, minis: null,
    ready: () => true, story: () => 'test/x', fingerprint: () => 'f1', hints: () => ({}), frames: () => [],
    center: () => ({ x: 300, z: 0 }), ...over });

  it('state.read says the map the scene was built on; a world without one is the island', () => {
    expect(readState(world({ map: () => 'island' })).map).toBe('island');
    expect(readState(world({ map: () => 'lagoon' })).map).toBe('lagoon');
    expect(readState(world()).map).toBe('island');
  });

  it('a profile\'s own open-sea point wins over the ray from the centre', () => {
    const own = { x: -1000, z: 950, yaw: 1 };
    expect(resolveAnchor('open-sea', world({ openSea: () => own }))).toEqual(own);
    expect(resolveAnchor('open-sea', world({ openSea: () => null })).x).toBe(1300);
  });
});
