// The bay's relief against the island's (ISLAND-MAPS-SPEC §3 table, §4.1, §4.2; terra T2): the
// thresholds measured the same way on both maps, and the channel from the story field out to open
// sea along the path the raft takes under the kite, checked with the raft's own openWater.
import { describe, expect, it } from 'vitest';
import { pickMap, rayTo } from '../src/scene/maps.js';
import { inBay, LAGOON } from '../src/scene/lagoonHeight.js';
import { inOpenSea, openWater, RAFT } from '../src/tiles/raftMotion.js';
import { ANCHOR, resolveAnchor } from '../src/embed/anchors.js';

// sunset bearing as main.js has it: 90° − SUN_PATH_V1.setAzimuth (205°)
const SET_BEARING = (90 - 205) * (Math.PI / 180);

/** §3's measure: land area on a 5 m grid in the 1800 m square, the farthest land and shelf on rays every 0.5°, the shallowest bed on the square's edge. */
function measure(heightAt) {
  let cells = 0;
  for (let x = -900; x <= 900; x += 5) for (let z = -900; z <= 900; z += 5) if (heightAt(x, z) > 0) cells++;
  let land = 0, shelf = 0;
  for (let a = 0; a < 360; a += 0.5) {
    const c = Math.cos(a * Math.PI / 180), s = Math.sin(a * Math.PI / 180);
    for (let r = 0; r <= 1200; r += 1) {
      const h = heightAt(c * r, s * r);
      if (h > 0) land = Math.max(land, r);
      if (h > -14) shelf = Math.max(shelf, r);
    }
  }
  let edge = Infinity;
  for (let t = -900; t <= 900; t += 5) {
    for (const [x, z] of [[t, -900], [t, 900], [-900, t], [900, t]]) edge = Math.min(edge, -heightAt(x, z));
  }
  return { area: cells * 25 / 1e6, land, shelf, edge };
}

/** Where main.js puts the story: coast() along the story bearing, the field (TileField.place: 5 m steps, bed under the centre and the 45 m rim deeper than 5 m). */
function storyField(map) {
  const b = map.storyBearing(SET_BEARING), c = rayTo(map.heightAt, b);
  const ox = Math.cos(b), oz = Math.sin(b);
  for (let d = 45; d < 2045; d += 5) {
    const x = c.x + ox * d, z = c.z + oz * d;
    let ok = map.heightAt(x, z) < -5;
    for (let k = 0; ok && k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      ok = map.heightAt(x + Math.cos(a) * 45, z + Math.sin(a) * 45) < -5;
    }
    if (ok) return { coast: c, center: { x, z }, out: { x: ox, z: oz } };
  }
  throw new Error('no open water for the field');
}

const island = measure(pickMap('island').heightAt);
const lagoon = measure(pickMap('lagoon').heightAt);

describe('§3 thresholds, one measure for both maps', () => {

  it('the island is as the spec measured it', () => {
    expect(island.area).toBeGreaterThan(0.39);
    expect(island.area).toBeLessThan(0.41);
    expect(island.land).toBe(511);
    expect(island.shelf).toBe(756);
    expect(island.edge).toBeCloseTo(28, 0);
  });

  it('the bay: more land, within 600 m, shelf within 760 m, ≥ 25 m on the edge', () => {
    expect(lagoon.area).toBeGreaterThan(island.area);
    expect(lagoon.land).toBeLessThanOrEqual(600);
    expect(lagoon.shelf).toBeLessThanOrEqual(760);
    expect(lagoon.edge).toBeGreaterThanOrEqual(25);
  });
});

describe('the bay: story coast, channel, surf rock', () => {
  const map = pickMap('lagoon');
  const field = storyField(map);

  it('the story coast is the bay\'s beach and the field floats inside the bay', () => {
    expect(map.storyBearing(SET_BEARING)).toBe(LAGOON.bearing);
    expect(inBay(field.coast.x, field.coast.z, 10)).toBe(true);
    expect(inBay(field.center.x, field.center.z)).toBe(true);
    // dry sand (h ≥ 1) within 40 m in from the coast: the walker's spawn
    const l = Math.hypot(field.coast.x, field.coast.z);
    let d = 0;
    while (d < 40 && map.heightAt(field.coast.x * (1 - d / l), field.coast.z * (1 - d / l)) < 1) d += 0.5;
    expect(d).toBeLessThan(40);
  });

  it('a channel from the field out to open sea: openWater for a deck the field\'s size + 5 m, every metre', () => {
    const ground = (x, z) => ({ height: map.heightAt(x, z) });
    const radius = 45 + 5;
    let x = field.center.x, z = field.center.z, steps = 0;
    while (!inOpenSea(x, z)) {
      expect(openWater(ground, x, z, radius), `aground at (${x.toFixed(1)}, ${z.toFixed(1)})`).toBe(true);
      x += field.out.x; z += field.out.z; steps++;
    }
    expect(Math.hypot(x, z)).toBeLessThan(RAFT.limit);
    expect(steps).toBeGreaterThan(500);
  });

  it('the open-sea anchor (the field\'s ray, ANCHOR.openSea out) is past the edge, in deep water', () => {
    expect(map.openSea).toBeNull();
    const p = resolveAnchor('open-sea', { center: () => field.center, openSea: () => map.openSea });
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(ANCHOR.openSea, 6);
    expect(inOpenSea(p.x, p.z)).toBe(true);
    expect(map.heightAt(p.x, p.z)).toBeLessThan(-25);
  });

  it('the surf rock sits in ~2.5 m of water on the outer coast, not in the bay', () => {
    const rock = map.heroRock();
    expect(map.heightAt(rock.x, rock.z)).toBeLessThanOrEqual(-2.5);
    expect(map.heightAt(rock.x, rock.z)).toBeGreaterThan(-4);
    expect(inBay(rock.x, rock.z, 25)).toBe(false);
    expect(map.rocks(rock.x, rock.z)).toBe(true);
  });

  it('no rocks along the channel', () => {
    for (let d = 0; d < 450; d += 5) {
      expect(map.rocks(field.coast.x + field.out.x * d, field.coast.z + field.out.z * d)).toBe(false);
    }
  });

  it('the overview radius holds the farthest land', () => {
    expect(map.viewRadius).toBeGreaterThanOrEqual(lagoon.land);
  });
});
