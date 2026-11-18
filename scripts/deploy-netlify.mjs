import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'vite';
import { projectRoot } from '../build/tilecraft-config.js';
import { verifyDist } from './verify-dist.mjs';

const input = process.argv.slice(2);
const allowed = new Set(['--prod', '--dry-run', '--site']);
let site = process.env.NETLIFY_SITE_ID;
for (let index = 0; index < input.length; index++) {
  if (!allowed.has(input[index])) throw new Error(`Unknown argument: ${input[index]}`);
  if (input[index] === '--site') {
    site = input[++index];
    if (!site || site.startsWith('--')) throw new Error('--site requires a project ID or name');
  }
}
if (!site) {
  try { site = JSON.parse(readFileSync(resolve(projectRoot, '.netlify/state.json'), 'utf8')).siteId; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
site ||= 'edge-of-elements';
await build({ configFile: resolve(projectRoot, 'vite.config.js') });
verifyDist();
const args = ['deploy', '--no-build', '--dir', 'dist', '--site', site];
if (input.includes('--prod')) args.push('--prod');
console.log(`Netlify ${input.includes('--prod') ? 'production' : 'draft'} target: ${site}`);
if (input.includes('--dry-run')) {
  console.log(`Prepared (no upload): netlify ${args.map(arg => JSON.stringify(arg)).join(' ')}`);
} else {
  // Token, if set, is inherited via environment, never printed or passed as an argument.
  const result = spawnSync(process.execPath, [resolve(projectRoot, 'node_modules/netlify-cli/bin/run.js'), ...args],
    { cwd: projectRoot, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
