// URL values have the same bounds as the visible controls. Invalid/nonfinite
// values keep their defaults; unrelated query parameters and the hash survive.
export const TILE_RANGES = {
  metersPerSourceUnit: [0.01, 0.5], fieldYaw: [-180, 180], density: [100, 1000],
  buoyancy: [0, 3], drag: [0, 10], angularDrag: [0, 5], orbit: [0, 1],
  anchorPeriod: [0.5, 20], windage: [0, 0.1], driftRadius: [50, 1000],
};
const key = (name) => `tiles${name[0].toUpperCase()}${name.slice(1)}`;

export function readTileUrl(args, params) {
  for (const [name, [min, max]] of Object.entries(TILE_RANGES)) {
    const raw = args.get(key(name));
    if (raw === null || !raw.trim()) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) params[name] = Math.min(max, Math.max(min, value));
  }
  const mode = args.get('tilesMode');
  if (mode === 'anchored' || mode === 'drift') params.mode = mode;
  params.frame = args.get('tilesFrame') || 'all';
}

// source: a fixture id, a File, or a catalog payload { id: '<folder>/<slug>', story }
export function writeTileUrl(source, params) {
  const url = new URL(location.href);
  if (source?.story) {
    // a catalog story is its own link (?story=<folder>/<slug>), not a fixture
    url.searchParams.delete('tiles');
    url.searchParams.set('story', source.id);
  } else {
    url.searchParams.delete('story');
    // Local files cannot be reconstructed from a link.
    url.searchParams.set('tiles', source instanceof File ? 'none' : source);
  }
  for (const name of [...Object.keys(TILE_RANGES), 'mode', 'frame']) {
    url.searchParams.set(key(name), String(params[name]));
  }
  history.replaceState(null, '', url);
}
