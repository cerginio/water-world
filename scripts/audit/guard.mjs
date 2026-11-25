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
const PRODUCTS = join(ROOT, 'products');

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

/* ── BOUNDARY-2: модуль оточення переносний ──────────────────────────────── */

/**
 * Модуль оточення (SCENE-ENVIRONMENT-SPEC §5): `src/environment/**` не знає ні
 * води, ні острова, ні тайлів. Дозволено three, `three/addons/*` і відносні
 * шляхи всередині папки (рішення власника 2026-11-23: це правило замість
 * окремого `check:environment`). Прив'язки до Ultra-Water — у
 * `src/environment-bindings/`, вони під правило не підпадають.
 */
const ENV_DIR = 'src/environment/';
const ENV_ENTRY = `${ENV_DIR}index.js`;
const ENV_MIN_FILES = 9;   // index, atmosphere, skyBake, skyBackground, sun, state, measure, fullscreen, mood

function ruleEnvironmentPortable(files) {
  const failures = [];
  const present = files.filter(f => f.rel.startsWith(ENV_DIR));
  for (const { rel, text } of present) {
    for (const spec of importsOf(text)) {
      if (isThree(spec) || (spec.startsWith('.') && resolveFrom(rel, spec).startsWith(ENV_DIR))) continue;
      failures.push(`${rel}: import «${spec}» — модуль оточення імпортує лише three і свою папку`);
    }
  }
  if (!present.some(f => f.rel === ENV_ENTRY)) failures.push(`${ENV_ENTRY} не знайдено — правило дивиться не туди`);
  if (present.length < ENV_MIN_FILES) failures.push(`${ENV_DIR}: ${present.length} файл(ів), очікувалось ≥ ${ENV_MIN_FILES} — правило дивиться не туди`);
  return { id: 'BOUNDARY-2 environment-portable', failures, note: `${present.length} файл(ів) ${ENV_DIR}` };
}

/* ── BOUNDARY-3: Tilecraft лише через завантажувач ────────────────────────── */

/**
 * Tilecraft з цього репозиторію лише читається (spec.md §1), і решта коду не знає,
 * звідки прийшла модель: `@tilecraft` імпортують тільки вхідні файли платформи —
 * завантажувач моделей і клієнт каталогу (STORY-QUEST-SPEC §4: список входів, а не
 * дозвіл усім). Інакше збірка без Tilecraft (`source=none`) і переносимість
 * (BUILD-DEPLOY-SPEC) залежали б від кожного файлу. Продукти (`products/**`) теж
 * під правилом: вони беруть Tilecraft лише через платформу.
 */
const TILECRAFT_ENTRIES = ['src/tiles/tilecraftLoader.js', 'src/catalog/tilecraftCatalog.js', 'src/walker/tilecraftWalker.js'];

function ruleTilecraftEntry(files) {
  const failures = [];
  const perEntry = new Map(TILECRAFT_ENTRIES.map(rel => [rel, 0]));
  for (const { rel, text } of files) {
    const hits = importsOf(text).filter(spec => spec.startsWith('@tilecraft'));
    if (!hits.length) continue;
    if (perEntry.has(rel)) perEntry.set(rel, perEntry.get(rel) + hits.length);
    else failures.push(`${rel}: import «${hits[0]}» — Tilecraft лише через входи ${TILECRAFT_ENTRIES.join(', ')}`);
  }
  // Вхід без жодного @tilecraft — зайвий рядок списку або правило дивиться не туди (P10).
  for (const [rel, n] of perEntry) if (!n) failures.push(`${rel}: жодного @tilecraft — вхід зі списку не імпортує Tilecraft`);
  return { id: 'BOUNDARY-3 tilecraft-entry', failures,
    note: [...perEntry].map(([rel, n]) => `${rel.replace(/^src\//, '')} ${n}`).join(', ') + ' import(ів)' };
}

/* ── BOUNDARY-4: продукти залежать від платформи, не навпаки ──────────────── */

/**
 * Платформа (`src/**`) дає можливості без DOM-рішень і події, продукт
 * (`products/**`) — увесь UI й рішення (STORY-QUEST-SPEC §4). Імпорт продукту з
 * платформи зробив би сцену частиною одного продукту: другий продукт тягнув би
 * квести першого. Поруч із BOUNDARY-2, тим самим розбором імпортів.
 */
const PRODUCTS_DIR = 'products/';

function ruleProductsOnSrc(files) {
  const failures = [];
  let checked = 0;
  for (const { rel, text } of files) {
    if (!rel.startsWith('src/')) continue;
    checked++;
    for (const spec of importsOf(text)) {
      if (resolveFrom(rel, spec).startsWith(PRODUCTS_DIR) || /(?:^|\/)products\//.test(spec)) {
        failures.push(`${rel}: import «${spec}» — платформа не імпортує products/**`);
      }
    }
  }
  if (!checked) failures.push('src/: жодного файлу — правило дивиться не туди');
  return { id: 'BOUNDARY-4 src-off-products', failures, note: `${checked} файл(ів) src/` };
}

/* ── BOUNDARY-5: продукт говорить зі сценою лише через контракт ──────────────── */

/**
 * З QDb продукт — сторінка-хост: сцена в <iframe ?…&embed>, розмова — лише командами й подіями
 * контракту (STORY-QUEST-SPEC §4.4). `products/**` не імпортує `src/**` (ні відносним шляхом, ні
 * `/src/…`) і не читає `window.app` сцени через `contentWindow`. Без винятків: інакше продукт знову
 * залежить від нутрощів сцени, а не від контракту, і стенд перестає доводити, що контракту досить.
 */
const SCENE_APP = /\bcontentWindow\s*\??\.\s*app\b/g;
const SHARED_DIR = 'products/shared/';

function ruleProductsOffSrc(files) {
  const failures = [];
  let checked = 0, shared = 0;
  for (const { rel, text } of files) {
    if (!rel.startsWith(PRODUCTS_DIR)) continue;
    checked++;
    if (rel.startsWith(SHARED_DIR)) shared++;
    for (const spec of importsOf(text)) {
      const target = resolveFrom(rel, spec);
      if (target.startsWith('src/') || /^\/?src\//.test(spec) || target.startsWith('../src/')) {
        failures.push(`${rel}: import «${spec}» — продукт говорить зі сценою лише через контракт (src/embed), не імпортом`);
      }
    }
    if (SCENE_APP.test(text)) failures.push(`${rel}: contentWindow.app — продукт не читає window.app сцени`);
    SCENE_APP.lastIndex = 0;
  }
  // правило дивиться туди, куди треба: спільна оболонка є і перевірена
  if (!shared) failures.push(`${SHARED_DIR}: жодного файлу — правило дивиться не туди`);
  return { id: 'BOUNDARY-5 products-off-src', failures, note: `${checked} файл(ів) products/, з них ${shared} у shared/` };
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
 * Камеру й OrbitControls пише лише їхній власник — `src/scene/cameraRig.js`
 * (SCENE-UI-SPEC U1, ARCHITECTURE.md TD2): шоти, WASD, межа над рельєфом,
 * переліт станцій і перенесення кадру йдуть через нього, а `controls.enabled`
 * виводиться з lock-ів із причиною. До U1 писарів було 27 у двох файлах, і
 * TileInteraction, що сам зберігав і відновлював `controls.enabled`, лишив би
 * керування «залиплим» після перельоту.
 *
 * Межа рахується за іменами `camera` / `controls` (з `this.` чи без): це
 * публічні імена в main.js і TileField/TileInteraction. Перейменування
 * отримувача виведе запис з-під правила (P9). Власник має щонайменше один
 * запис — інакше правило дивиться не туди (P10).
 */
const CAMERA_OWNER = 'src/scene/cameraRig.js';
const CAMERA_BASELINE = {};
const CAMERA_WRITE = new RegExp([
  String.raw`\b(?:this\.)?(?:camera|controls)\.(?:position|quaternion|rotation|up|target)\.`
    + String.raw`(?:set|copy|add|addScaledVector|sub|applyQuaternion|lerp|setX|setY|setZ|setFromAxisAngle|setFromEuler)\(`,
  String.raw`\b(?:this\.)?(?:camera|controls)\.(?:position|quaternion|rotation|target)\.[xyz]\s*[-+*/]?=(?!=)`,
  String.raw`\b(?:this\.)?controls\.enabled\s*=(?!=)`,
].join('|'), 'g');

/* ── OWNER-4: писарі сонця — baseline, що лише падає ──────────────────────── */

/**
 * `env.params` (висота, азимут, хмари; до E1 — `sky.params`) пишуть GUI і кожен
 * камерний шот через `setSun` (ARCHITECTURE.md TD3). Віджет часу доби й погоди
 * (MOOD-WEATHER M1) стає єдиним писарем. Власник — `src/environment/index.js` —
 * не рахується.
 */
const SUN_OWNER = 'src/environment/index.js';
// MOOD-WEATHER M1a: 0 — shots, the Controls sliders and app.mood write through env.set()
const SUN_BASELINE = {};
const SUN_WRITE = /\b(?:sky|env)\.params\.\w+\s*=(?!=)|Object\.assign\(\s*(?:sky|env)\.params\b|\.add\(\s*(?:sky|env)\.params\b/g;

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

/* ── TEX-1: float-текстури без лінійної фільтрації ────────────────────────── */

/**
 * `FloatType` + `LinearFilter` фільтрується лише з `OES_texture_float_linear`.
 * На телефоні власника (Chrome Android, 2026-11-23) розширення немає: текстура
 * неповна й читається як 0 — карта берега давала глибину 0 у квадраті 1800 м
 * (scene-ui U4). Лінійно фільтровані дані — `HalfFloatType`
 * (`engine/halfTexture.js`); `FloatType` — лише з `NearestFilter`.
 * Виняток: `DepthTexture` з `compareFunction` (shadow-семплер, ядро WebGL2).
 *
 * Розбір по інструкціях: інструкція з `FloatType` (між `;`) — її опції
 * `minFilter:`/`magFilter:`, далі присвоєння `<ім'я>.minFilter|magFilter = …` у
 * наступних інструкціях. `WebGL*RenderTarget` без явного `NearestFilter` — лінійний
 * за замовчуванням three.
 */
const FLOAT_TYPE = /(?<![\w$])(?:THREE\.)?FloatType\b/g;
const LINEAR = /\b\w*Linear\w*Filter\b/;

function statementAt(text, index) {
  const start = text.lastIndexOf(';', index) + 1;
  const endAt = text.indexOf(';', index);
  return { start, end: endAt < 0 ? text.length : endAt + 1 };
}

// Найглибший незакритий `new THREE.X(` перед index у межах інструкції.
function enclosingCtor(text, from, index) {
  const re = /\bnew\s+(?:THREE\.)?(\w+)\s*\(/g;
  re.lastIndex = from;
  let found = null;
  for (let m; (m = re.exec(text)) && m.index < index;) {
    let depth = 0;
    for (let i = m.index + m[0].length - 1; i < index; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') depth--;
    }
    if (depth > 0) found = m[1];
  }
  return found;
}

function ruleFloatFilter(files) {
  const failures = [];
  let checked = 0;
  for (const { rel, text } of files) {
    for (const m of text.matchAll(FLOAT_TYPE)) {
      checked++;
      const { start, end } = statementAt(text, m.index);
      const stmt = text.slice(start, end);
      const ctor = enclosingCtor(text, start, m.index);
      const line = text.slice(0, m.index).split('\n').length;
      // ім'я, якому присвоєно конструктор: останнє `x =` перед FloatType (`=>` пропускається)
      const name = text.slice(start, m.index).match(/([\w$.]+)\s*=(?![=>])(?:[^=;]|=>)*$/)?.[1];
      // наступні інструкції, що налаштовують ту саму текстуру
      const after = [];
      let pos = end;
      for (let k = 0; k < (name ? 8 : 0) && pos < text.length; k++) {
        const next = statementAt(text, pos);
        const s = text.slice(next.start, next.end);
        if (!s.trim().startsWith(`${name}.`)) break;
        after.push(s);
        pos = next.end;
      }
      const assigned = after.filter(s => /\.(?:minFilter|magFilter)\s*=/.test(s));
      const inline = [...stmt.matchAll(/\b(?:minFilter|magFilter)\s*:\s*([\w.]+)/g)].map(x => x[1]);
      const compare = after.some(s => /\.compareFunction\s*=/.test(s));
      let linear = assigned.some(s => LINEAR.test(s));
      if (ctor === 'DepthTexture') linear = linear && !compare;
      else {
        if (inline.some(f => LINEAR.test(f))) linear = true;
        if (/^WebGL\w*RenderTarget$/.test(ctor ?? '') && inline.filter(f => /NearestFilter/.test(f)).length < 2) linear = true;
      }
      if (linear) failures.push(`${rel}:${line}: FloatType + лінійна фільтрація — без OES_texture_float_linear читається як 0 → halfTexture() / HalfFloatType або NearestFilter`);
    }
  }
  if (checked < 10) failures.push(`перевірено ${checked} FloatType, очікувалось ≥ 10 — правило дивиться не туди`);
  return { id: 'TEX-1 float-filter', failures, note: `${checked} FloatType` };
}

/* ── main ─────────────────────────────────────────────────────────────────── */

async function main() {
  const t0 = performance.now();
  const reportOnly = process.argv.includes('--report');
  const files = collect(SRC);
  const products = collect(PRODUCTS);   // лише межові правила: BOUNDARY-3 і BOUNDARY-5
  const camera = baselineRule('OWNER-3 camera-writers', files, CAMERA_WRITE, CAMERA_BASELINE, CAMERA_OWNER,
    `камеру пише лише ${CAMERA_OWNER} (lock / place / flyTo)`);
  const ownerWrites = count(files.find(f => f.rel === CAMERA_OWNER)?.text ?? '', CAMERA_WRITE);
  if (!ownerWrites) camera.failures.push(`${CAMERA_OWNER}: жодного запису камери — правило дивиться не туди`);
  camera.note = `${camera.note}; власник ${CAMERA_OWNER} — ${ownerWrites}`;
  const sun = baselineRule('OWNER-4 sun-writers', files, SUN_WRITE, SUN_BASELINE, SUN_OWNER,
    'сонце пишуть лише через env.set() (MOOD-WEATHER M1a)');
  const results = [ruleEngineLeaf(files), ruleEnvironmentPortable(files), ruleTilecraftEntry([...files, ...products]),
    ruleProductsOnSrc(files), ruleProductsOffSrc(products),
    ruleOneLoop(files), ruleOneRendererGui(files), camera, sun, ruleGlobals(files),
    ruleFloatFilter(files), await ruleWaterSamplers()];

  if (process.argv.includes('--baseline')) {
    const print = (name, found) => console.log(`Підставте у ${name}:\n{\n${[...found]
      .sort(([a], [b]) => a.localeCompare(b)).map(([rel, n]) => `  '${rel}': ${n},`).join('\n')}\n}`);
    print('CAMERA_BASELINE', camera.found);
    print('SUN_BASELINE', sun.found);
    return 0;
  }

  console.log(`guard — ${files.length} файлів у src/, ${products.length} у products/\n`);
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
