import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { projectRoot, publishedAssetPath, resolveTilecraft, tilecraftAssets } from '../build/tilecraft-config.js';

export function verifyDist(directory = resolve(projectRoot, 'dist'), sourceRoot = resolveTilecraft()) {
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  for (const relative of tilecraftAssets) {
    assert.equal(hash(readFileSync(resolve(directory, publishedAssetPath(relative)))),
      hash(readFileSync(resolve(sourceRoot, relative))), `Asset bytes changed: ${relative}`);
  }
  for (const filename of ['index.html', 'products/story-quest/index.html', 'products/quest-demo-qa/index.html', 'licenses.md', 'THIRD_PARTY_NOTICES.md', 'TILECRAFT_LICENSE.txt', 'TILECRAFT_THIRD_PARTY_NOTICES.md']) {
    assert.ok(readFileSync(resolve(directory, filename)).length, `Missing ${filename}`);
  }
  function scan(folder) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const filename = resolve(folder, entry.name);
      assert.ok(!entry.name.startsWith('.'), `Netlify CLI would skip ${filename}`);
      if (entry.isDirectory()) scan(filename);
      else if (/\.(?:html|js)$/.test(entry.name)) {
        const content = readFileSync(filename, 'utf8');
        assert.doesNotMatch(content, /\/@fs\/|@tilecraft|__TILECRAFT_ROOT__|[A-Za-z]:[\\/](?:work|Users)[\\/]|https?:\/\/(?:localhost|127\.0\.0\.1)/,
          `Local dependency in ${filename}`);
      }
      assert.ok(!entry.name.endsWith('.map'), `Public sourcemap: ${filename}`);
    }
  }
  scan(directory);
  console.log('dist verified: original JSON bytes, licenses, no local runtime paths.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) verifyDist();
