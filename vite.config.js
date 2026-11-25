import { defineConfig, searchForWorkspaceRoot } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { projectRoot, resolveTilecraft } from './build/tilecraft-config.js';
import { tilecraftPlugin } from './build/tilecraft-plugin.js';

export default defineConfig(({ mode }) => {
  const tilecraftRoot = resolveTilecraft(mode);
  return {
    root: projectRoot,
    build: {
      sourcemap: false, license: { fileName: 'licenses.md' },
      // the scene, the Story Quest product and the QA stand of states (STORY-QUEST-SPEC §4, §4.4; products/**)
      rollupOptions: { input: { main: resolve(projectRoot, 'index.html'), storyQuest: resolve(projectRoot, 'products/story-quest/index.html'),
        questDemoQa: resolve(projectRoot, 'products/quest-demo-qa/index.html') } },
    },
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
