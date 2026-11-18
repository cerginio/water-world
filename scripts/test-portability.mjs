import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, symlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { projectRoot, resolveTilecraft } from '../build/tilecraft-config.js';

const qa = resolve(projectRoot, '.build-qa');
mkdirSync(qa, { recursive: true });
const workspace = mkdtempSync(resolve(qa, 'portability-'));
const tilecraftRoot = resolveTilecraft();
const checkoutLink = resolve(workspace, 'Tilecraft with spaces');
symlinkSync(tilecraftRoot, checkoutLink, process.platform === 'win32' ? 'junction' : 'dir');
for (const layout of ['_tools/Ultra-Water', 'Ultra-Water', 'folder with spaces/Ultra Water']) {
  const copy = resolve(workspace, layout);
  mkdirSync(copy, { recursive: true });
  for (const name of readdirSync(projectRoot)) {
    if (['node_modules', 'dist', '.git', '.build-qa', '.netlify'].includes(name)) continue;
    cpSync(resolve(projectRoot, name), resolve(copy, name), { recursive: true });
  }
  symlinkSync(resolve(projectRoot, 'node_modules'), resolve(copy, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  // Original absolute .env.local survives relocation. Process env also supports
  // selecting a different checkout, including a path containing spaces.
  const env = { ...process.env };
  if (layout.includes('spaces')) env.TILECRAFT_ROOT = checkoutLink;
  const result = spawnSync(process.execPath, [resolve(copy, 'scripts/build.mjs')],
    { cwd: workspace, env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(existsSync(resolve(copy, 'dist/tilecraft/models/story-rombs-gd.json')));
  console.log(`Relocated build passed: ${layout}`);
}
console.log('Portability checks passed; temporary copies remain in ignored .build-qa/.');
