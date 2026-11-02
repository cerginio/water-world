import { defineConfig, searchForWorkspaceRoot } from 'vite';
import { existsSync, readFileSync } from 'node:fs';

// Tilecraft is read live from its own checkout (spec.md §3.2), never copied in.
const TILECRAFT_ROOT = (process.env.TILECRAFT_ROOT ?? 'D:/work/js-games/ua-dream/tilecraft').replace(/\\/g, '/');

export default defineConfig(({ command }) => {
  const tilecraft = command === 'serve' && existsSync(TILECRAFT_ROOT);
  return {
    build: { license: { fileName: 'licenses.md' } },
    server: {
      port: 5199,
      strictPort: true,
      fs: { allow: [searchForWorkspaceRoot(process.cwd()), ...(tilecraft ? [TILECRAFT_ROOT] : [])] },
    },
    resolve: {
      // a bare `three` inside a Tilecraft file would otherwise resolve to tilecraft/node_modules/three:
      // a second module instance even at the same version (spec.md §3.2)
      dedupe: ['three'],
    },
    // The loader imports Tilecraft through /@fs/ at runtime instead of an `@tilecraft` alias: a
    // literal aliased import would be bundled by `vite build` and fail it without TILECRAFT_ROOT.
    // The field is a dev-server feature; a build gets '' and the Tiles source list stays empty.
    define: { __TILECRAFT_ROOT__: JSON.stringify(tilecraft ? TILECRAFT_ROOT : '') },
    plugins: [{
      name: 'third-party-notices',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'THIRD_PARTY_NOTICES.md', source: readFileSync('THIRD_PARTY_NOTICES.md', 'utf8') });
      },
    }, ...(tilecraft ? [tilecraftAssetUrls()] : [])],
  };
});

// Vite rewrites `new URL('../', import.meta.url)` into an absolute path without the trailing
// slash, so Tilecraft's model-loader resolved its fixtures one directory too high (П3). In
// Tilecraft files only, let the browser resolve such URLs against the module's own /@fs/ URL.
function tilecraftAssetUrls() {
  return {
    name: 'tilecraft-asset-urls',
    enforce: 'pre',
    transform(code, id) {
      if (!id.replace(/\\/g, '/').startsWith(TILECRAFT_ROOT) || !code.includes('import.meta.url')) return null;
      return code.replace(/new URL\(([^,()]+),\s*import\.meta\.url\s*\)/g, "new URL($1, '' + import.meta.url)");
    },
  };
}
