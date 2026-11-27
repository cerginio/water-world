// The bay's decorations against the miniatures (ISLAND-MAPS-SPEC §3, §5 п.3, п.4; terra T3): on
// 'lagoon' no miniature of the test set lies in a closed zone and every one is reached from the
// start on a straight line clear of the trunks; on 'island' (no zones) the layout of the same
// stories is the one the scene had before the phase. The start and the layout are worked out as
// main.js does (coast → walkerSpawn → layoutMiniatures) on the same mesh (TerrainContact).
import { describe, expect, it } from 'vitest';
import { buildTerrain } from '../src/scene/terrainGeometry.js';
import { TerrainContact } from '../src/scene/TerrainContact.js';
import { pickMap } from '../src/scene/maps.js';
import { bayPolar, DECOR } from '../src/scene/lagoonDecor.js';
import { layoutMiniatures } from '../src/tiles/miniatureLayout.js';
import { palmGeometry } from '../src/scene/decor.js';

const SET_BEARING = (90 - 205) * (Math.PI / 180);
const STORIES = [['test-2025/my-day-3-moments', 3], ['public-test/frog-fairy-full', 10], ['story-8-frames-hibrid', 8]];

// the scene's layouts before T3, read from the running scene (app.minis.items[].home) on 2026-11-27
const ISLAND_BEFORE = {
  'test-2025/my-day-3-moments': [[212.353, -149.715, 0.6737], [235.488, -170.203, 6.1636], [190.279, -194.574, 3.9264]],
  'public-test/frog-fairy-full': [[160.304, -205.357, 5.3702], [181.221, -154.398, 4.78], [227.99, -172.602, 5.7942],
    [184.767, -181.898, 4.8195], [235.326, -152.21, 1.7747], [162.924, -193.377, 5.8292], [174.392, -243.908, 5.9383],
    [211.883, -168.87, 0.8487], [130.026, -210.266, 4.1106], [150.497, -214.842, 0.3914]],
  'story-8-frames-hibrid': [[183.252, -219.217, 4.3548], [139.204, -176.552, 0.7344], [190.71, -152.308, 3.4812],
    [172.12, -189.58, 6.0205], [171.196, -213.874, 4.7608], [152.027, -204.12, 2.4038], [210.631, -192.185, 0.8379],
    [140.005, -223.198, 4.5835]],
};

/** main.js on `map`: the mesh, coast() along the story bearing, the walker's spawn, the ground. */
function sceneOf(id) {
  const map = pickMap(id);
  const { geometry } = buildTerrain(map.heightAt, 384);
  const contact = new TerrainContact(geometry, geometry.parameters.width);
  const ground = (x, z) => contact.at(x, z);
  // coast(): a whole-degree round trip as main.js does it (radToDeg → degToRad)
  const b = map.storyBearing(SET_BEARING), a = (b * 180 / Math.PI) * (Math.PI / 180);
  let r = 100;
  while (r < 800 && map.heightAt(Math.cos(a) * r, Math.sin(a) * r) > 0) r += 2;
  const c = { x: Math.cos(a) * r, z: Math.sin(a) * r }, l = Math.hypot(c.x, c.z);
  const p = { ...c };
  for (let i = 0; i < 400 && (ground(p.x, p.z)?.height ?? -1) < 1; i++) { p.x -= c.x / l * 0.5; p.z -= c.z / l * 0.5; }
  return { map, ground, spawn: p, coast: c };
}

const segDist = (px, pz, a, b) => {
  const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / l2));
  return Math.hypot(px - a.x - dx * t, pz - a.z - dz * t);
};

describe('island: no zones, the layout as before the phase', () => {
  const { map, ground, spawn } = sceneOf('island');
  it('has neither decorations nor closed zones', () => {
    expect(map.decor).toBeUndefined();
    expect(map.blocked).toBeUndefined();
  });
  for (const [story, count] of STORIES) {
    it(`${story}: the same ${count} points`, () => {
      const points = layoutMiniatures(story, count, { ground, center: spawn, blocked: map.blocked });
      expect(points.map((q) => [+q.x.toFixed(3), +q.z.toFixed(3), +q.yaw.toFixed(4)])).toEqual(ISLAND_BEFORE[story]);
    });
  }
});

describe('lagoon: closed zones, trunks off the way', () => {
  const { map, ground, spawn, coast } = sceneOf('lagoon');
  const decor = map.decor();
  // a trunk's foot: the base ring (radius × 1.35 × 1.4) at the instance's scale, plus the walker's half-width
  const foot = (palm) => 0.26 * 1.35 * 1.4 * palm.scale + 0.4;

  it('palms of every silhouette, groups with gaps, the hut', () => {
    expect(new Set(decor.palms.map((p) => p.variant))).toEqual(new Set([0, 1, 2]));
    expect(decor.palms.length).toBeGreaterThan(80);
    expect(decor.groups.length).toBeGreaterThan(8);
    // every trunk on land and no two closer than the spacing
    for (const p of decor.palms) expect(map.heightAt(p.x, p.z)).toBeGreaterThan(1);
    const gap = Math.min(...decor.palms.flatMap((p, i) => decor.palms.slice(i + 1).map((q) => Math.hypot(p.x - q.x, p.z - q.z))));
    expect(gap).toBeGreaterThanOrEqual(DECOR.spacing);
  });

  it('the zones leave 6 m round the start and the strip from the start to the water', () => {
    for (let a = 0; a < 360; a += 5) for (const d of [1, 3, 6]) {
      expect(map.blocked(spawn.x + Math.cos(a * Math.PI / 180) * d, spawn.z + Math.sin(a * Math.PI / 180) * d)).toBe(false);
    }
    for (let t = 0; t <= 1; t += 0.02) {
      const x = spawn.x + (coast.x - spawn.x) * t, z = spawn.z + (coast.z - spawn.z) * t;
      for (const w of [-2, 0, 2]) expect(map.blocked(x - coast.z / 140 * w, z + coast.x / 140 * w)).toBe(false);
    }
  });

  it('the hut and its boardwalk stand in the shallows, off the story\'s channel', () => {
    const h = map.heightAt(decor.hut.x, decor.hut.z);
    expect(h).toBeLessThan(-0.5);
    expect(h).toBeGreaterThan(-3);
    expect(map.heightAt(decor.hut.walk.to.x, decor.hut.walk.to.z)).toBeGreaterThan(0.3);
    // the channel runs along the bay's axis (the field's ray, terraRelief.test): the hut far across it
    for (const q of [decor.hut, decor.hut.walk.from, decor.hut.walk.to]) {
      const { bd, phi } = bayPolar(q.x, q.z);
      expect(Math.abs(Math.sin(phi) * bd)).toBeGreaterThan(100);
    }
  });

  for (const [story, count] of STORIES) {
    it(`${story}: ${count} miniatures, none in a closed zone, each reached clear of the trunks`, () => {
      const points = layoutMiniatures(story, count, { ground, center: spawn, blocked: map.blocked });
      expect(points).toHaveLength(count);
      expect(points.filter((q) => map.blocked(q.x, q.z))).toEqual([]);
      for (const q of points) {
        const hit = decor.palms.filter((p) => segDist(p.x, p.z, spawn, q) < foot(p));
        expect(hit).toEqual([]);
      }
    });
  }

  it('the zones close what they say: under the palms and on the hut', () => {
    for (const p of decor.palms) expect(map.blocked(p.x, p.z)).toBe(true);
    expect(map.blocked(decor.hut.x, decor.hut.z)).toBe(true);
    const w = decor.hut.walk;
    expect(map.blocked((w.from.x + w.to.x) / 2, (w.from.z + w.to.z) / 2)).toBe(true);
  });
});

describe('palm geometry', () => {
  it('solid, no index, a few hundred triangles a silhouette', () => {
    for (const v of [0, 1, 2]) {
      const g = palmGeometry(v);
      expect(g.index).toBeNull();
      expect(g.attributes.color).toBeDefined();
      expect(g.attributes.position.count / 3).toBeLessThan(500);
    }
  });
});
