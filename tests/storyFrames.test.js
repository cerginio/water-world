// story-quest Q1: a story is its visible frames (HANDOFF Q1; Tilecraft story-preview-renderer).
import { describe, expect, it } from 'vitest';
import { toStoryFrames } from '../src/tiles/storyFrames.js';

const tile = (f, x = 0) => ({ x, y: 0, c: '#fff', f });

describe('toStoryFrames', () => {
  it('drops tiles without a visible frame — the frog-fairy case (5 stray tiles ~9 km away)', () => {
    const model = { frames: [{ id: 1 }, { id: 3 }], layers: [{ tiles: [] }, { tiles: [tile(1), tile(3), tile(undefined, 187808), tile(undefined, -9000)] }] };
    const { model: out, dropped } = toStoryFrames(model);
    expect(dropped).toEqual({ frames: 0, tiles: 2 });
    expect(out.layers[1].tiles.map((t) => t.f)).toEqual([1, 3]);
    expect(out.layers[0]).toBe(model.layers[0]);
    expect(model.layers[1].tiles).toHaveLength(4);   // the source is not mutated
  });

  it('drops hidden frames and their tiles', () => {
    const model = { frames: [{ id: 1 }, { id: 2, hid: true }], layers: [{ tiles: [tile(1), tile(2), tile(2)] }] };
    const { model: out, dropped } = toStoryFrames(model);
    expect(out.frames).toEqual([{ id: 1 }]);
    expect(dropped).toEqual({ frames: 1, tiles: 2 });
  });

  it('a story already made of visible frames comes back as the same object', () => {
    const model = { frames: [{ id: 1 }], layers: [{ tiles: [tile(1)] }] };
    expect(toStoryFrames(model).model).toBe(model);
  });

  it('a model without frames is a tile sheet and is left as is', () => {
    const model = { layers: [{ tiles: [tile(undefined)] }] };
    expect(toStoryFrames(model)).toEqual({ model, dropped: { frames: 0, tiles: 0 } });
    expect(toStoryFrames({ frames: [], layers: [] }).model.frames).toEqual([]);
  });

  it('every frame hidden is an error, not an empty field', () => {
    expect(() => toStoryFrames({ frames: [{ id: 1, hid: 1 }], layers: [{ tiles: [tile(1)] }] })).toThrow('no visible frames');
  });
});
