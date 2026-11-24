// A story is its visible frames (STORY-QUEST HANDOFF Q1, the rule of Tilecraft's
// core/story-preview-renderer.js): frames with `hid` are dropped, and so is every tile
// whose `f` is not the id of a visible frame. Tilecraft's computeBounds centres the space
// on ALL source points while the scene compiler skips frameless tiles, so 5 stray tiles
// of frog-fairy-* (up to 187 808 source units away) put the field 2-4 km off (Q0).
// A model without frames (a plain tile sheet, e.g. the `demo` fixture) is left as is.

/** @param {any} model @returns {{ model: any, dropped: { frames: number, tiles: number } }} */
export function toStoryFrames(model) {
  const none = { model, dropped: { frames: 0, tiles: 0 } };
  if (!Array.isArray(model?.frames) || !model.frames.length || !Array.isArray(model.layers)) return none;
  const frames = model.frames.filter((frame) => !frame.hid);
  if (!frames.length) throw new Error('Story has no visible frames');
  const ids = new Set(frames.map((frame) => frame.id));
  let tiles = 0;
  const layers = model.layers.map((layer) => {
    if (!Array.isArray(layer?.tiles)) return layer;
    const kept = layer.tiles.filter((tile) => ids.has(tile?.f));
    tiles += layer.tiles.length - kept.length;
    return kept.length === layer.tiles.length ? layer : { ...layer, tiles: kept };
  });
  const droppedFrames = model.frames.length - frames.length;
  if (!tiles && !droppedFrames) return none;
  return { model: { ...model, frames, layers }, dropped: { frames: droppedFrames, tiles } };
}
