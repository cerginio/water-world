// scene-environment E4 (SCENE-ENVIRONMENT-SPEC §5.6 a): the sealed copy of src/environment/ lives
// on its own. The copy goes to a temp folder outside the repository whose node_modules holds only
// three; a separate node process imports index.js and ui/moodPad.js from it. A module file that
// reached outside its folder (../engine/…) or for another package would fail to resolve there.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENV_SOURCE, SEAL_FILE, packEnvironment, readVersion, sealHeader, sealLine } from '../scripts/pack-environment.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SEAL = { commit: 'abc1234', date: '2026-11-24' };

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const files = (dir, base = dir) => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? files(join(dir, e.name), base) : [join(dir, e.name).slice(base.length + 1).replaceAll('\\', '/')]).sort();

/** imports the copied entries in a fresh node process (cwd = the temp host) and lists their exports */
function importCopy() {
  const urls = ['index.js', 'ui/moodPad.js'].map(f => pathToFileURL(join(dest, f)).href);
  const script = `const out = {};
for (const url of ${JSON.stringify(urls)}) { const m = await import(url); out[url.split('/environment/')[1]] = Object.keys(m).sort(); }
const index = await import(${JSON.stringify(urls[0])});
out.version = index.ENVIRONMENT_VERSION; out.create = typeof index.createEnvironment;
console.log(JSON.stringify(out));`;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: host, encoding: 'utf8' }));
}

let host, dest, seal;

describe('scene-environment package (E4)', () => {
  beforeAll(() => {
    host = mkdtempSync(join(tmpdir(), 'scene-env-'));
    writeFileSync(join(host, 'package.json'), JSON.stringify({ type: 'module', dependencies: { three: '*' } }));
    mkdirSync(join(host, 'node_modules'));
    symlinkSync(join(root, 'node_modules', 'three'), join(host, 'node_modules', 'three'), 'junction');
    dest = join(host, 'core', 'environment');
    seal = packEnvironment(dest, SEAL);
  });
  afterAll(() => rmSync(host, { recursive: true, force: true }));

  it('the copy imports with only three next to it', () => {
    const out = importCopy();
    expect(out.create).toBe('function');
    expect(out.version).toBe(readVersion());
    expect(out['index.js']).toEqual(expect.arrayContaining(['createEnvironment', 'ENVIRONMENT_VERSION', 'MOOD_MAP_V1', 'sampleMood', 'sunAt', 'ldrLighting', 'THREE_LIGHTS']));
    expect(out['ui/moodPad.js']).toContain('createMoodPad');
  });

  it('every source file is copied, sealed, and its hash is the source content', () => {
    const source = files(ENV_SOURCE).filter(f => /\.(js|css|md)$/.test(f));
    expect(source).toEqual(expect.arrayContaining(['README.md', 'ui/moodPad.css']));
    expect(files(dest)).toEqual([...source, SEAL_FILE].sort());
    const line = sealLine({ version: readVersion(), ...SEAL });
    for (const rel of source) {
      const text = readFileSync(join(ENV_SOURCE, rel), 'utf8');
      const copy = readFileSync(join(dest, rel), 'utf8');
      expect(copy).toBe(sealHeader(rel, line) + text);
      expect(seal.files[rel]).toBe(sha256(text));
    }
    expect(JSON.parse(readFileSync(join(dest, SEAL_FILE), 'utf8'))).toEqual(seal);
  });

  it('re-packing replaces a sealed copy, a foreign folder is refused', () => {
    writeFileSync(join(dest, 'stale.js'), 'export {};');
    packEnvironment(dest, SEAL);
    expect(files(dest)).not.toContain('stale.js');
    const foreign = join(host, 'foreign');
    mkdirSync(foreign);
    writeFileSync(join(foreign, 'keep.js'), 'export {};');
    expect(() => packEnvironment(foreign, SEAL)).toThrow(/no seal\.json/);
    expect(() => packEnvironment(join(ENV_SOURCE, 'x'), SEAL)).toThrow(/inside the source/);
  });
});
