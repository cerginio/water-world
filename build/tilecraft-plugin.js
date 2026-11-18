import { resolve } from 'node:path';
import { normalizePath } from 'vite';
import MagicString from 'magic-string';
import { publishedAssetPath, readTilecraftAsset, tilecraftAssets } from './tilecraft-config.js';

export function tilecraftPlugin(root) {
  const loader = normalizePath(resolve(root, 'viewer/engines/three/core/model-loader.js'));
  const original = "const STAND_ROOT = new URL('../', import.meta.url);";
  let base;
  return {
    name: 'tilecraft-production',
    enforce: 'pre',
    configResolved(config) {
      base = config.base;
      if (!base.startsWith('/') || base.startsWith('//') || /[?#]/.test(base)) {
        throw new Error('Tilecraft requires a Vite pathname base such as / or /water/.');
      }
    },
    transform(code, id) {
      if (normalizePath(id.split('?')[0]) !== loader) return null;
      const start = code.indexOf(original);
      if (start < 0 || code.indexOf(original, start + original.length) !== -1) {
        throw new Error('Tilecraft model-loader STAND_ROOT contract changed; update the Ultra-Water adapter.');
      }
      const transformed = new MagicString(code);
      transformed.overwrite(start, start + original.length,
        `const STAND_ROOT = new URL(${JSON.stringify(`${base}tilecraft/viewer/engines/three/`)}, globalThis.location.origin);`);
      const resolver = 'new URL(path, STAND_ROOT).href';
      const resolverStart = code.indexOf(resolver);
      if (resolverStart < 0 || code.indexOf(resolver, resolverStart + resolver.length) !== -1) {
        throw new Error('Tilecraft model-loader asset resolver contract changed; update the Ultra-Water adapter.');
      }
      transformed.overwrite(resolverStart, resolverStart + resolver.length,
        "new URL(path.replace('../../../.pw-probe/', '../../../models/'), STAND_ROOT).href");
      return { code: transformed.toString(), map: transformed.generateMap({ hires: true, source: id, includeContent: true }) };
    },
    configureServer(server) {
      const assets = new Map(tilecraftAssets.map(relative => [`${base}${publishedAssetPath(relative)}`, relative]));
      server.middlewares.use((request, response, next) => {
        const pathname = (request.url ?? '').split('?')[0];
        const relative = assets.get(pathname);
        if (!relative) return next();
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.writeHead(405, { Allow: 'GET, HEAD' });
          return response.end();
        }
        try {
          const source = readTilecraftAsset(root, relative);
          response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          response.end(request.method === 'HEAD' ? undefined : source);
        } catch (error) { next(error); }
      });
    },
    generateBundle() {
      for (const relative of tilecraftAssets) {
        this.emitFile({ type: 'asset', fileName: publishedAssetPath(relative), source: readTilecraftAsset(root, relative) });
      }
      this.emitFile({ type: 'asset', fileName: 'TILECRAFT_LICENSE.txt', source: readTilecraftAsset(root, 'LICENSE') });
      this.emitFile({ type: 'asset', fileName: 'TILECRAFT_THIRD_PARTY_NOTICES.md', source: readTilecraftAsset(root, 'THIRD_PARTY_NOTICES.md') });
    },
  };
}
