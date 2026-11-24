#!/usr/bin/env node
// Copies src/environment/ into another repository with a seal (SCENE-ENVIRONMENT-SPEC §5.6 a):
// every .js / .css gets the header `// scene-environment@<version>, source: Ultra-Water <commit> <date>`,
// README.md gets it as its first line, and seal.json lists each file's sha256 of the source
// content (without the header) — so the receiving side can tell a local edit from the upstream copy.
//
//   node scripts/pack-environment.mjs <dest>            e.g. ../tilecraft/viewer/engines/three/core/environment
//   node scripts/pack-environment.mjs <dest> --force    overwrite a non-empty dest that has no seal.json
//
// The copy is a whole replacement: files in dest that are no longer in the module are removed
// only when dest already holds a seal (it is a previous copy). The module imports only three and
// its own folder (guard BOUNDARY-2), so the copy needs nothing else.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ENV_SOURCE = join(root, 'src', 'environment');
export const SEAL_FILE = 'seal.json';
const COPIED = /\.(js|css|md)$/;
/** the seal as the first line, in each kind of file's own comment */
export const sealHeader = (/** @type {string} */ rel, /** @type {string} */ line) =>
  rel.endsWith('.md') ? `> ${line}\n\n` : rel.endsWith('.css') ? `/* ${line} */\n` : `// ${line}\n`;

/** @param {string} dir @returns {string[]} posix paths relative to dir */
function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (COPIED.test(name)) out.push(relative(dir, full).split(sep).join('/'));
    }
  };
  walk(dir);
  return out;
}

/** @param {string} source the module folder @returns {string} */
export function readVersion(source = ENV_SOURCE) {
  const match = /export const ENVIRONMENT_VERSION = '(\d+\.\d+)'/.exec(readFileSync(join(source, 'index.js'), 'utf8'));
  if (!match) throw new Error(`pack-environment: ENVIRONMENT_VERSION not found in ${source}/index.js`);
  return match[1];
}

/** the commit of the module's last state; `-dirty` when src/environment has uncommitted changes */
function sourceCommit() {
  try {
    const git = (/** @type {string[]} */ ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    const commit = git('rev-parse', '--short', 'HEAD');
    return git('status', '--porcelain', '--', 'src/environment') ? `${commit}-dirty` : commit;
  } catch {
    return 'unknown';
  }
}

export const sealLine = (/** @type {{ version: string, commit: string, date: string }} */ s) =>
  `scene-environment@${s.version}, source: Ultra-Water ${s.commit} ${s.date} — a copy: change it upstream (Ultra-Water src/environment/) and re-pack`;

const sha256 = (/** @type {string} */ text) => createHash('sha256').update(text).digest('hex');

/**
 * @param {string} dest
 * @param {{ source?: string, force?: boolean, commit?: string, date?: string }} [options]
 * @returns {{ version: string, commit: string, date: string, files: Record<string, string> }} the seal
 */
export function packEnvironment(dest, { source = ENV_SOURCE, force = false, commit = sourceCommit(),
  date = new Date().toISOString().slice(0, 10) } = {}) {
  const target = resolve(dest);
  if (target === source || target.startsWith(source + sep)) throw new Error(`pack-environment: ${target} is inside the source`);
  const sealed = existsSync(join(target, SEAL_FILE));
  if (existsSync(target) && readdirSync(target).length && !sealed && !force) {
    throw new Error(`pack-environment: ${target} is not empty and has no ${SEAL_FILE} — not a previous copy (--force to overwrite)`);
  }
  if (sealed) rmSync(target, { recursive: true, force: true });

  const version = readVersion(source);
  const seal = { name: 'scene-environment', version, source: 'Ultra-Water src/environment/', commit, date, files: {} };
  const line = sealLine(seal);
  for (const rel of listFiles(source)) {
    const text = readFileSync(join(source, rel), 'utf8');
    seal.files[rel] = sha256(text);
    mkdirSync(dirname(join(target, rel)), { recursive: true });
    writeFileSync(join(target, rel), sealHeader(rel, line) + text);
  }
  writeFileSync(join(target, SEAL_FILE), JSON.stringify(seal, null, 2) + '\n');
  return seal;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const dest = args.find(a => !a.startsWith('--'));
  if (!dest) {
    console.error('usage: node scripts/pack-environment.mjs <dest> [--force]');
    process.exit(2);
  }
  try {
    const seal = packEnvironment(dest, { force: args.includes('--force') });
    console.log(`${sealLine(seal)}\n${Object.keys(seal.files).length} files → ${resolve(dest)}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
