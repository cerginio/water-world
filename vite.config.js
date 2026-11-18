import { defineConfig, searchForWorkspaceRoot } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { projectRoot, resolveTilecraft } from './build/tilecraft-config.js';
import { tilecraftPlugin } from './build/tilecraft-plugin.js';

export default defineConfig(({ mode }) => {
  const tilecraftRoot = resolveTilecraft(mode);
  return {
    root: projectRoot,
    build: { sourcemap: false, license: { fileName: 'licenses.md' } },
    server: {
      port: 5199,
      strictPort: true,
      fs: { allow: [searchForWorkspaceRoot(projectRoot), tilecraftRoot] },
    },
    resolve: {
      alias: { '@tilecraft': tilecraftRoot },
      dedupe: ['three'],
    },
    plugins: [tilecraftPlugin(tilecraftRoot), {
      name: 'third-party-notices',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'THIRD_PARTY_NOTICES.md', source: readFileSync(resolve(projectRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8') });
      },
    }],
  };
});
