// Тайпчек JSDoc через tsc --checkJs (tsconfig.json, периметр — src/).
// Перенесено з tilecraft/scripts/audit/typecheck.mjs (TYPES-1, INVARIANTS.md).
//
// Навіщо baseline: на старті 21 помилка, більшість — неоголошені поля класів і
// модулі @tilecraft без типів, а не дефекти. Зупиняти роботу на них не можна,
// але й лишати перевірку декоративною не хочеться. Тому фіксуємо поточне
// число по файлах: нові помилки падають, старі чекають на розбір.
//
//   node scripts/audit/typecheck.mjs             перевірити, код 1 при зростанні
//   node scripts/audit/typecheck.mjs --report    лише звіт, завжди код 0
//   node scripts/audit/typecheck.mjs --baseline  перезаписати baseline
//
// Baseline лише опускається: коли помилок стало менше, скрипт просить
// перезаписати його, щоб виправлене не можна було мовчки повернути назад.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// Прямий tsc.js, а не npx: на Windows `npx.cmd` через execFileSync віддає
// порожній stdout, і перевірка мовчки зеленіє (інцидент three, Д5).
const TSC = join(ROOT, 'node_modules', 'typescript', 'lib', 'tsc.js');
const BASELINE_FILE = join(ROOT, 'scripts', 'audit', 'typecheck-baseline.json');

function run() {
  try {
    execFileSync(process.execPath, [TSC, '-p', 'tsconfig.json', '--pretty', 'false'],
      { cwd: ROOT, encoding: 'utf8' });
    return [];
  } catch (error) {
    const out = String(error.stdout ?? '');
    // Порожній stdout при ненульовому коді — tsc не запустився, а не «чисто».
    if (!out.trim()) throw new Error(`tsc не запустився (код ${error.status}): ${error.message}`, { cause: error });
    return out.split('\n').filter(line => /error TS/.test(line));
  }
}

function byFile(lines) {
  const counts = {};
  for (const line of lines) {
    const file = line.match(/^(src\/[^(]+)/)?.[1];
    if (file) counts[file] = (counts[file] ?? 0) + 1;
  }
  return counts;
}

const lines = run();
const counts = byFile(lines);
const total = lines.length;
const mode = process.argv[2];

if (mode === '--baseline') {
  writeFileSync(BASELINE_FILE, JSON.stringify({ total, files: counts }, null, 2) + '\n');
  console.log(`typecheck baseline: ${total} помилок у ${Object.keys(counts).length} файлах`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));

if (mode === '--report') {
  console.log(`typecheck — ${total} помилок, baseline ${baseline.total}\n`);
  for (const [file, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    const was = baseline.files[file] ?? 0;
    const mark = n > was ? '✗' : n < was ? '↓' : ' ';
    console.log(`${mark} ${String(n).padStart(3)}  (було ${was})  ${file}`);
  }
  process.exit(0);
}

const grown = Object.entries(counts).filter(([file, n]) => n > (baseline.files[file] ?? 0));

if (total > baseline.total || grown.length) {
  console.error(`typecheck: ${total} помилок проти baseline ${baseline.total}`);
  for (const [file, n] of grown) {
    console.error(`  ✗ ${file}: ${n}, було ${baseline.files[file] ?? 0}`);
    for (const line of lines.filter(l => l.startsWith(file))) console.error(`      ${line.trim()}`);
  }
  process.exit(1);
}

if (total < baseline.total) {
  console.log(`typecheck: ${total} помилок — менше за baseline ${baseline.total}.`);
  console.log('Опустіть планку: node scripts/audit/typecheck.mjs --baseline');
  process.exit(0);
}

console.log(`typecheck: ${total} помилок, baseline тримається.`);
