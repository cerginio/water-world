import { readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, normalizePath } from 'vite';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export const tilecraftAssets = [
  '.pw-probe/story-rombs-gd.json',
  '.pw-probe/story-rombs-gd.frames.json',
  'viewer/engines/three/fixtures/world-demo.json',
  'viewer/engines/three/fixtures/world-demo.world.json',
];
// the dev fallback story catalog (src/catalog/, STORY-QUEST-SPEC §5): served by the dev
// server under <base>tilecraft/catalog/, never copied into dist
export const LOCAL_CATALOG_PATH = 'tilecraft/catalog/';
export const LOCAL_CATALOG_SOURCE = 'viewer/engines/three/fixtures/catalog/';
// Netlify CLI excludes dot-directories from uploads.
export const publishedAssetPath = relative => `tilecraft/${relative.replace(/^\.pw-probe\//, 'models/')}`;
const modules = [
  'lib/thickness-scale.js', 'lib/story-catalog.js', 'viewer/engines/pixi/polyline-lcr.js',
  ...['model-loader', 'coordinates', 'world-config', 'scene-compiler'].map(name => `viewer/engines/three/core/${name}.js`),
  'viewer/engines/three/engine/resource-scope.js',
  // the walker (src/walker/tilecraftWalker.js, story-quest Q2a)
  ...['sheet-motion', 'avatar'].map(name => `viewer/engines/three/core/gamifier/${name}.js`),
];

export function resolveTilecraft(mode = 'production') {
  const env = loadEnv(mode, projectRoot, 'TILECRAFT_');
  const configured = (process.env.TILECRAFT_ROOT ?? env.TILECRAFT_ROOT)?.trim();
  if (!configured) throw new Error('Set TILECRAFT_ROOT in .env.local (see .env.example) or the process environment.');
  const directory = resolve(projectRoot, configured);
  for (const relative of [...modules, ...tilecraftAssets, 'LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    const filename = resolve(directory, relative);
    try {
      if (!statSync(filename).isFile()) throw new Error('not a file');
    } catch {
      throw new Error(`Tilecraft file missing: ${filename}. Check TILECRAFT_ROOT in .env.local.`);
    }
  }
  return normalizePath(realpathSync(directory));
}

export function readTilecraftAsset(root, relative) {
  return readFileSync(resolve(root, relative));
}
