// Статичні інваріанти Ultra-Water — INVARIANTS.md.
// Перенесено за зразком tilecraft/scripts/audit/guard.mjs.
//
// Рівень `guard`: менше 2 с, запускається перед КОЖНИМ комітом фази й має право
// блокувати. Це єдина перевірка з таким правом: юніти (`npm test`) і проби його не
// мають (TESTING.md «Рівні»).
//
//   node scripts/audit/guard.mjs            перевірити, код 1 при порушенні
//   node scripts/audit/guard.mjs --report   лише звіт, завжди код 0
//   node scripts/audit/guard.mjs --baseline надрукувати новий baseline (не пише файл)
//   node scripts/audit/guard.mjs --no-types пропустити тайпчек (лише статика)
//
// Правила тут — статичні: те, що видно в тексті файлів без запуску сцени.
// Поведінкові контракти живуть у юнітах (tests/, scripts/test-*.mjs).

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { declaredSamplers } from './glsl-samplers.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SRC = join(ROOT, 'src');

function collect(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === '_archive') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (entry.name.endsWith('.js')) {
      out.push({ rel: relative(ROOT, full).split(sep).join('/'), text: readFileSync(full, 'utf8') });
    }
  }
  return out;
}

// Статичний `from '…'`, side-effect `import '…'` і динамічний `import('…')`.
const IMPORT = /(?<![\w$.])from\s*['"]([^'"]+)['"]|(?<![\w$.])import\s*\(?\s*['"]([^'"]+)['"]/g;
const importsOf = text => [...text.matchAll(IMPORT)].map(m => m[1] ?? m[2]);
const isThree = spec => spec === 'three' || spec.startsWith('three/');
const resolveFrom = (rel, spec) => spec.startsWith('.') ? posix.normalize(posix.join(posix.dirname(rel), spec)) : spec;
const count = (text, re) => [...text.matchAll(re)].length;

/* ── BOUNDARY-1: engine/ — листок ─────────────────────────────────────────── */

/**
 * `src/engine/` — рендер-примітиви (fullscreen, PostFX, відбиття, таймер), які
 * переносяться без змін. Імпорт води, сцени чи тайлів зробив би їх частиною
 * світу Ultra-Water. ARCHITECTURE.md §2.1, рев'ю 2026-11-22.
 */
function ruleEngineLeaf(files) {
  const failures = [];
  let checked = 0;
  for (const { rel, text } of files) {
    if (!rel.startsWith('src/engine/')) continue;
    checked++;
    for (const spec of importsOf(text)) {
      const target = resolveFrom(rel, spec);
      if (isThree(spec) || target.startsWith('src/engine/')) continue;
      failures.push(`${rel}: import «${spec}» — engine/ імпортує лише three і engine/`);
    }
  }
  if (checked < 4) failures.push(`src/engine/: перевірено ${checked} файл(ів), очікувалось ≥ 4 — правило дивиться не туди`);
  return { id: 'BOUNDARY-1 engine-leaf', failures, note: `${checked} файл(ів) engine/` };
}

/* ── BOUNDARY-2: небо й атмосфера переносні ───────────────────────────────── */

/**
 * Основа майбутнього модуля оточення (SCENE-ENVIRONMENT-SPEC §5): небо й
 * атмосфера не знають ні води, ні острова, ні тайлів. Дозволено three,
 * engine/fullscreen.js і одне одного.
 */
const SKY_FILES = ['src/scene/atmosphere.js', 'src/scene/sky.js'];
const SKY_ALLOWED = new Set(['src/engine/fullscreen.js', ...SKY_FILES]);

function ruleSkyPortable(files) {
  const failures = [];
  const present = files.filter(f => SKY_FILES.includes(f.rel));
  for (const { rel, text } of present) {
    for (const spec of importsOf(text)) {
      if (isThree(spec) || SKY_ALLOWED.has(resolveFrom(rel, spec))) continue;
      failures.push(`${rel}: import «${spec}» — небо імпортує лише three, engine/fullscreen.js і своє`);
    }
  }
  if (present.length !== SKY_FILES.length) failures.push(`знайдено ${present.length} з ${SKY_FILES.length} файлів неба — оновіть SKY_FILES`);
  return { id: 'BOUNDARY-2 sky-portable', failures, note: `${present.length} файл(и) неба` };
}

/* ── BOUNDARY-3: Tilecraft лише через завантажувач ────────────────────────── */

/**
 * Tilecraft з цього репозиторію лише читається (spec.md §1), і решта коду не знає,
 * звідки прийшла модель: `@tilecraft` імпортує тільки `tiles/tilecraftLoader.js`.
 * Інакше збірка без Tilecraft (`source=none`) і переносимість (BUILD-DEPLOY-SPEC)
 * залежали б від кожного файлу.
 */
const TILECRAFT_ENTRY = 'src/tiles/tilecraftLoader.js';

function ruleTilecraftEntry(files) {
  const failures = [];
  let entryImports = 0;
  for (const { rel, text } of files) {
    const hits = importsOf(text).filter(spec => spec.startsWith('@tilecraft'));
    if (!hits.length) continue;
    if (rel === TILECRAFT_ENTRY) entryImports += hits.length;
    else failures.push(`${rel}: import «${hits[0]}» — Tilecraft лише через ${TILECRAFT_ENTRY}`);
  }
  if (!entryImports) failures.push(`${TILECRAFT_ENTRY}: жодного @tilecraft — правило дивиться не туди`);
  return { id: 'BOUNDARY-3 tilecraft-entry', failures, note: `${entryImports} import(ів) у ${TILECRAFT_ENTRY}` };
}

/* ── OWNER-1, OWNER-2: один цикл, один renderer, один GUI ─────────────────── */

/**
 * Кадр рендеру, контекст WebGL і панель налаштувань мають одного власника —
 * `src/main.js`. Другий RAF подвоює кадр і ламає бенчмарк (`benchmarking`
 * спиняє лише свій цикл); другий renderer — другий контекст; другий GUI —
 * друга панель, яку U0 (SCENE-UI-SPEC §3) не сховає.
 */
const LOOP_OWNER = 'src/main.js';
const RAF = /\brequestAnimationFrame\s*\(/g;
const RENDERER = /\bnew\s+(?:THREE\.)?WebGLRenderer\s*\(/g;
const GUI_NEW = /\bnew\s+GUI\s*\(/g;

function ruleOneLoop(files) {
  const failures = [];
  let owner = 0;
  for (const { rel, text } of files) {
    const n = count(text, RAF);
    if (!n) continue;
    if (rel === LOOP_OWNER) owner += n;
    else failures.push(`${rel}: requestAnimationFrame (${n}) — цикл кадру лише в ${LOOP_OWNER}`);
  }
  if (!owner) failures.push(`${LOOP_OWNER}: жодного requestAnimationFrame — правило дивиться не туди`);
  return { id: 'OWNER-1 one-loop', failures, note: `${owner} виклик(и) у власника` };
}

function ruleOneRendererGui(files) {
  const failures = [];
  const totals = { renderer: 0, gui: 0 };
  for (const { rel, text } of files) {
    for (const [kind, re] of [['renderer', RENDERER], ['gui', GUI_NEW]]) {
      const n = count(text, re);
      if (!n) continue;
      totals[kind] += n;
      if (rel !== LOOP_OWNER) failures.push(`${rel}: new ${kind === 'gui' ? 'GUI' : 'WebGLRenderer'} — лише в ${LOOP_OWNER}`);
    }
  }
  for (const [kind, n] of Object.entries(totals)) {
    if (n !== 1) failures.push(`${kind}: очікувався рівно 1, знайдено ${n}`);
  }
  return { id: 'OWNER-2 one-renderer-gui', failures, note: `renderer ${totals.renderer}, GUI ${totals.gui}` };
}

/* ── OWNER-3: писарі камери — baseline, що лише падає ─────────────────────── */

/**
 * Камеру й OrbitControls зараз пишуть шоти, WASD і clampCamera у main.js та
 * перенесення кадру в TileInteraction (ARCHITECTURE.md TD2). Переліт камери
 * (SCENE-UI-SPEC U1) мав би стати ще одним писарем, і TileInteraction, що сам
 * зберігає й відновлює `controls.enabled`, лишив би керування «залиплим».
 * Ціль U1 — один власник камери; доти число записів по файлу не росте.
 *
 * Межа рахується за іменами `camera` / `controls` (з `this.` чи без): це
 * публічні імена в main.js і TileField/TileInteraction. Перейменування
 * отримувача виведе запис з-під правила (P9) — тому baseline містить і
 * число, і файл: зникнення запису з файлу теж видно (`--baseline`).
 */
const CAMERA_BASELINE = {
  'src/main.js': 21,
  'src/tiles/TileInteraction.js': 6,
};
const CAMERA_WRITE = new RegExp([
  String.raw`\b(?:this\.)?(?:camera|controls)\.(?:position|quaternion|rotation|up|target)\.`
    + String.raw`(?:set|copy|add|addScaledVector|sub|applyQuaternion|lerp|setX|setY|setZ|setFromAxisAngle|setFromEuler)\(`,
  String.raw`\b(?:this\.)?(?:camera|controls)\.(?:position|quaternion|rotation|target)\.[xyz]\s*[-+*/]?=(?!=)`,
  String.raw`\b(?:this\.)?controls\.enabled\s*=(?!=)`,
].join('|'), 'g');

/* ── OWNER-4: писарі сонця — baseline, що лише падає ──────────────────────── */

/**
 * `sky.params` (висота, азимут, хмари) пишуть GUI і кожен камерний шот через
 * `setSun` (ARCHITECTURE.md TD3). Віджет часу доби й погоди (MOOD-WEATHER M1)
 * стає єдиним писарем. Власник сам — `src/scene/sky.js` — не рахується.
 */
const SUN_OWNER = 'src/scene/sky.js';
const SUN_BASELINE = {
  'src/main.js': 6,
};
const SUN_WRITE = /\bsky\.params\.\w+\s*=(?!=)|Object\.assign\(\s*sky\.params\b|\.add\(\s*sky\.params\b/g;

function baselineRule(id, files, re, baseline, skip, hint) {
  const found = new Map();
  for (const { rel, text } of files) {
    if (rel === skip) continue;
    const n = count(text, re);
    if (n) found.set(rel, n);
  }
  const failures = [];
  for (const [rel, n] of found) {
    const allowed = baseline[rel] ?? 0;
    if (n > allowed) failures.push(allowed === 0
      ? `${rel}: ${n} запис(ів) — файл не в baseline; ${hint}`
      : `${rel}: ${n} запис(ів), baseline ${allowed} — baseline тільки скорочується`);
  }
  // Baseline, що вказує на зниклий запис, — брехня в контракті, не успіх.
  for (const [rel, allowed] of Object.entries(baseline)) {
    const n = found.get(rel) ?? 0;
    if (n < allowed) failures.push(`${rel}: ${n} запис(ів), baseline ${allowed} — опустіть планку (--baseline)`);
  }
  const total = [...found.values()].reduce((a, b) => a + b, 0);
  const budget = Object.values(baseline).reduce((a, b) => a + b, 0);
  return { id, failures, note: `${total} запис(ів) у ${found.size} файл(ах), baseline ${budget}`, found };
}

/* ── OWNER-5: глобали пише лише корінь композиції ─────────────────────────── */

/**
 * `window.app` і `window.runBenchmark` — неявний API, який читають проби
 * (ARCHITECTURE.md TD9). Другий модуль, що дописує в window/globalThis,
 * розмиває цей API і створює прихований канал між модулями.
 */
const GLOBAL_WRITE = /\b(?:window|globalThis|self)\.[A-Za-z_$][\w$]*\s*=(?!=)/g;

function ruleGlobals(files) {
  const failures = [];
  let owner = 0;
  for (const { rel, text } of files) {
    const n = count(text, GLOBAL_WRITE);
    if (!n) continue;
    if (rel === LOOP_OWNER) owner += n;
    else failures.push(`${rel}: ${n} запис(ів) у window/globalThis — лише ${LOOP_OWNER}`);
  }
  return { id: 'OWNER-5 globals-owner', failures, note: `${owner} запис(и) у ${LOOP_OWNER}` };
}

/* ── BUDGET-1: семплери програми води ─────────────────────────────────────── */

/**
 * Фрагментний шейдер води стоїть рівно на гарантованому мінімумі WebGL2 —
 * 16 текстурних юнітів (OceanSurface.js: «at the 16 sampler limit»; коміт
 * `9a34841`, 2026-11-02: three попереджав щокадру, бо рахує юніти по стадії).
 * 17-й семплер не скомпілюється на частині GPU. Рахуємо оголошене після
 * препроцесора (`#define SURF_VARYING` знімає uSurf із фрагментної стадії).
 */
async function ruleWaterSamplers() {
  const failures = [];
  const { WATER_SHADERS } = await import(pathToFileURL(join(SRC, 'water', 'OceanSurface.js')).href);
  const fragment = declaredSamplers(WATER_SHADERS.fragment);
  const vertex = declaredSamplers(WATER_SHADERS.vertex);
  const combined = new Set([...fragment, ...vertex]).size;
  // Порожній набір — не перевірка (P10): у воді щонайменше 10 семплерів.
  if (fragment.length < 10) failures.push(`fragment: ${fragment.length} семплер(ів) — розбір шейдера зламався`);
  if (fragment.length > 16) failures.push(`fragment: ${fragment.length} > 16 (${fragment.join(', ')})`);
  if (vertex.length > 16) failures.push(`vertex: ${vertex.length} > 16`);
  if (combined > 32) failures.push(`combined: ${combined} > 32`);
  return { id: 'BUDGET-1 water-samplers', failures, note: `fragment ${fragment.length}/16, vertex ${vertex.length}/16, combined ${combined}/32` };
}

/* ── main ─────────────────────────────────────────────────────────────────── */

async function main() {
  const t0 = performance.now();
  const reportOnly = process.argv.includes('--report');
  const files = collect(SRC);
  const camera = baselineRule('OWNER-3 camera-writers', files, CAMERA_WRITE, CAMERA_BASELINE, null,
    'камеру пише її власник (SCENE-UI-SPEC U1)');
  const sun = baselineRule('OWNER-4 sun-writers', files, SUN_WRITE, SUN_BASELINE, SUN_OWNER,
    'сонце пише віджет часу доби (MOOD-WEATHER M1)');
  const results = [ruleEngineLeaf(files), ruleSkyPortable(files), ruleTilecraftEntry(files),
    ruleOneLoop(files), ruleOneRendererGui(files), camera, sun, ruleGlobals(files),
    await ruleWaterSamplers()];

  if (process.argv.includes('--baseline')) {
    const print = (name, found) => console.log(`Підставте у ${name}:\n{\n${[...found]
      .sort(([a], [b]) => a.localeCompare(b)).map(([rel, n]) => `  '${rel}': ${n},`).join('\n')}\n}`);
    print('CAMERA_BASELINE', camera.found);
    print('SUN_BASELINE', sun.found);
    return 0;
  }

  console.log(`guard — ${files.length} файлів у src/\n`);
  let failed = 0;
  for (const { id, failures, note } of results) {
    console.log(failures.length ? `✗ ${id} — ${note}` : `✓ ${id} — ${note}`);
    for (const line of failures) console.log(`    ${line}`);
    failed += failures.length;
  }
  console.log(failed ? `\n${failed} порушень. Інваріанти — INVARIANTS.md` : '\nІнваріанти цілі.');

  // Тайпчек окремим процесом: у нього власний baseline і код виходу, а сюди
  // потрібен лише вердикт. `--report` не блокує й тут.
  let types = 0;
  if (!process.argv.includes('--no-types')) {
    const check = spawnSync(process.execPath, [join(ROOT, 'scripts', 'audit', 'typecheck.mjs')],
      { cwd: ROOT, encoding: 'utf8' });
    console.log(`\n${`${check.stdout ?? ''}${check.stderr ?? ''}`.trim() || 'typecheck: немає виводу'}`);
    types = check.status ?? 1;
  }
  console.log(`\nguard ${((performance.now() - t0) / 1000).toFixed(2)} с`);
  return reportOnly ? 0 : (failed || types ? 1 : 0);
}

process.exit(await main());
