import { describe, expect, it } from 'vitest';
import { DoubleTap } from '../src/ui/perfCopy.js';

describe('DoubleTap', () => {
  it('fires on the second tap close in time and place', () => {
    const d = new DoubleTap();
    expect(d.up({ t: 0, x: 10, y: 10 })).toBe(false);
    expect(d.up({ t: 200, x: 20, y: 15 })).toBe(true);
  });
  it('does not fire when the taps are too slow or too far apart', () => {
    const d = new DoubleTap();
    d.up({ t: 0, x: 0, y: 0 });
    expect(d.up({ t: 400, x: 0, y: 0 })).toBe(false);
    expect(d.up({ t: 500, x: 100, y: 0 })).toBe(false);
  });
  it('a third tap starts a new pair instead of firing again', () => {
    const d = new DoubleTap();
    d.up({ t: 0, x: 0, y: 0 });
    expect(d.up({ t: 100, x: 0, y: 0 })).toBe(true);
    expect(d.up({ t: 200, x: 0, y: 0 })).toBe(false);
  });
});
