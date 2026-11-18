import * as THREE from 'three';

// Live Tilecraft models (spec.md §3). Tilecraft's own modules do the loading and the
// compiling, so the field draws exactly what Tilecraft draws; every Tilecraft call
// lives here and in tileRest.js (spec.md §14, "Дрейф Tilecraft").

// Configuration validates the checkout before dev/build starts. Vite bundles
// these imports; local filesystem paths never reach the production browser.
export const tilecraftAvailable = true;

// the fixtures worth floating; Tilecraft applies the hibrid / polygon modifiers itself
export const TILE_SOURCES = ['story-8-frames-hibrid', 'story-8-frames-polygon', 'story-8-frames-polyline', 'demo'];

let modules = null;
function loadModules() {
  // the LCR builder is two classic IIFE scripts writing to globalThis, in this order (§3.3)
  modules ??= (async () => {
    await import('@tilecraft/lib/thickness-scale.js');
    await import('@tilecraft/viewer/engines/pixi/polyline-lcr.js');
    const [loader, coordinates, world, compiler, scope] = await Promise.all([
      import('@tilecraft/viewer/engines/three/core/model-loader.js'),
      import('@tilecraft/viewer/engines/three/core/coordinates.js'),
      import('@tilecraft/viewer/engines/three/core/world-config.js'),
      import('@tilecraft/viewer/engines/three/core/scene-compiler.js'),
      import('@tilecraft/viewer/engines/three/engine/resource-scope.js'),
    ]);
    return { ...loader, ...coordinates, ...world, ...compiler, ...scope };
  })();
  modules.catch(() => (modules = null));
  return modules;
}

// source → { id, model, world, sidecar } (a fixture id, or a dropped File)
export async function fetchTileSource(source, { signal } = {}) {
  const tc = await loadModules();
  return source instanceof File ? tc.loadFile(source) : tc.loadFixture(source, { signal });
}

// the same chain as Tilecraft's shell/viewer-session.js compileWorld (§3.4), with our
// metres per source unit. Returns the compiled records; the caller takes its rest data
// from them and then disposes `scope`.
export async function compileTileSource(payload, { metersPerSourceUnit = 0.05 } = {}) {
  const tc = await loadModules();
  const diagnostics = new tc.Diagnostics();
  const inspected = tc.validateModel(payload.model, diagnostics);
  const worldConfig = tc.resolveWorldConfig(inspected, { ...payload.world, unitsPerSourceUnit: metersPerSourceUnit }, diagnostics);
  if (diagnostics.hasErrors) throw new Error(diagnostics.errors[0].message);
  const bounds = tc.computeBounds(payload.model, tc.footprintPoints(worldConfig));
  const space = tc.createSpace(bounds, worldConfig.unit, worldConfig.origin);
  const scope = new tc.ResourceScope();
  const t0 = performance.now();
  let compiled;
  try {
    compiled = tc.compileScene(inspected, worldConfig, space, scope, diagnostics);
  } catch (e) {
    scope.dispose();
    throw e;
  }
  for (const item of diagnostics.items) if (item.level !== 'error') console.warn(`[tiles] ${item.message}${item.count > 1 ? ` ×${item.count}` : ''}`);
  return {
    id: payload.id, model: payload.model, inspected, worldConfig, space, scope, diagnostics,
    records: compiled.records, compileMs: performance.now() - t0,
    // П4: a second three would still compile, but instanceof across the two would fail silently
    sameThree: compiled.root instanceof THREE.Group,
  };
}
