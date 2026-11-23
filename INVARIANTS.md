# Інваріанти Ultra-Water

Архітектурні межі, кожну з яких тримає перевірка: названа мутація реального
коду її валить. Як писати перевірки й рівні прогону — [TESTING.md](TESTING.md);
рішення без механізму — [DECISIONS.md](DECISIONS.md).

## Як це працює

| рівень | коли | команда | вартість | блокує |
|---|---|---|---|---|
| guard | перед **кожним** комітом фази | `npm run guard` | 0.3–1.0 с | **так** |
| fast | після зміни поведінки | `npm test` | 3–4 с | ні |
| probe | приймання фази, браузер | `node scripts/probe-*.mjs` | 44–103 с | ні |

Деталі, бюджети й «як перевірити шов під час роботи» — у
[TESTING.md](TESTING.md#рівні-прогону). Зелений прогін усіх рівнів не доводить
коректності: 4 юніти й 13 проб не покривають нічого, крім названого в них.

## Реєстр

| id | інваріант | механізм | стан |
|---|---|---|---|
| [BOUNDARY-1](#boundary-1--engine--листок) | `src/engine/` імпортує лише `three` і `engine/` | guard-static, baseline 0 | ✓ |
| [BOUNDARY-2](#boundary-2--небо-й-атмосфера-переносні) | `sky.js`, `atmosphere.js` імпортують лише `three`, `engine/fullscreen.js` і одне одного | guard-static, baseline 0 | ✓ |
| [BOUNDARY-3](#boundary-3--tilecraft-лише-через-завантажувач) | `@tilecraft` імпортує лише `src/tiles/tilecraftLoader.js` | guard-static, baseline 0 | ✓ |
| [OWNER-1](#owner-1--один-цикл-кадру) | `requestAnimationFrame` — лише в `src/main.js` | guard-static, baseline 0 | ✓ |
| [OWNER-2](#owner-2--один-renderer-і-один-gui) | рівно 1 `new WebGLRenderer` і 1 `new GUI`, обидва в `src/main.js` | guard-static | ✓ |
| [OWNER-3](#owner-3--камеру-пише-лише-її-власник) | камеру/`controls` пише лише `src/scene/cameraRig.js` | guard-static, baseline 0 | ✓ |
| [OWNER-4](#owner-4--писарі-сонця-не-множаться) | записи `sky.params` поза `sky.js` не ростуть: `main.js` 6 | guard-static, baseline 6 ↓ | борг |
| [OWNER-5](#owner-5--глобали-пише-лише-корінь-композиції) | `window.*` / `globalThis.*` / `self.*` пише лише `src/main.js` | guard-static, baseline 0 | ✓ |
| [BUDGET-1](#budget-1--семплери-води-в-мінімумах-webgl2) | вода: фрагмент ≤ 16, вершина ≤ 16, разом ≤ 32 семплерів | guard-static | 16/16 |
| [TEX-1](#tex-1--float-текстури-без-лінійної-фільтрації) | `FloatType` — лише з `NearestFilter`; лінійно фільтровані дані — half float (`engine/halfTexture.js`) | guard-static + проба `probe-scene-shore` | ✓ |
| [TYPES-1](#types-1--помилки-типів-не-ростуть) | помилок `tsc --checkJs` не більше baseline, по кожному файлу | guard (окремий процес), baseline 21 ↓ | борг |

«↓» — baseline лише опускається: guard падає і на зростанні, і на зникненні
запису без опущення планки (P12).

---

## BOUNDARY-1 — engine/ — листок

**Формулювання.** Файли `src/engine/` імпортують лише `three` і інші файли
`src/engine/`.

**Походження.** Межа без інциденту: код її вже тримає (ARCHITECTURE.md §2.1,
огляд 2026-11-22). `engine/` — рендер-примітиви (fullscreen, PostFX,
відбиття, таймер), які переносяться в модуль оточення (SCENE-ENVIRONMENT §5);
імпорт води чи сцени зробив би їх частиною світу Ultra-Water.

**Механізм.** guard-static, `BOUNDARY-1 engine-leaf`. Розмір набору: ≥ 4 файли,
інакше правило «дивиться не туди» (P10).

**Перевірюване твердження.** `✓ BOUNDARY-1 engine-leaf — 4 файл(ів) engine/`, 0 порушень.

| мутація | guard до правила | guard після |
|---|---|---|
| `src/engine/gpuTimer.js` + `import { OceanSurface } from '../water/OceanSurface.js'` | ✓ проходить — дефект | ✗ `gpuTimer.js: import «../water/OceanSurface.js»` |

**Де живе.** [scripts/audit/guard.mjs](scripts/audit/guard.mjs) → `ruleEngineLeaf`.

## BOUNDARY-2 — небо й атмосфера переносні

**Формулювання.** `src/scene/sky.js` і `src/scene/atmosphere.js` імпортують лише
`three`, `src/engine/fullscreen.js` і одне одного.

**Походження.** Межа без інциденту (ARCHITECTURE.md §2.1): це природна межа
майбутнього модуля оточення (SCENE-ENVIRONMENT-SPEC §5). Сусіди `scene/` ↔
`water/` уже злиплися (TD13) — небо не повинне.

**Механізм.** guard-static, `BOUNDARY-2 sky-portable`. Розмір набору: рівно 2
файли (`SKY_FILES`); перейменування файлу валить правило.

**Перевірюване твердження.** `✓ BOUNDARY-2 sky-portable — 2 файл(и) неба`.

| мутація | guard до правила | guard після |
|---|---|---|
| `src/scene/sky.js` + `import { WATER_SHADERS } from '../water/OceanSurface.js'` | ✓ проходить — дефект | ✗ `sky.js: import «../water/OceanSurface.js»` |

**Де живе.** [scripts/audit/guard.mjs](scripts/audit/guard.mjs) → `ruleSkyPortable`.

## BOUNDARY-3 — Tilecraft лише через завантажувач

**Формулювання.** Специфікатор `@tilecraft…` (статичний, side-effect чи
динамічний `import()`) трапляється лише в `src/tiles/tilecraftLoader.js`.

**Походження.** Коміт `c90f052`, 2026-11-18 (переносима інтеграція Tilecraft):
збірка без Tilecraft (`source=none`) і переносимість (BUILD-DEPLOY-SPEC)
тримаються лише доти, доки решта коду не знає, звідки прийшла модель.

**Механізм.** guard-static, `BOUNDARY-3 tilecraft-entry`. Розмір набору: у
завантажувачі ≥ 1 import (зараз 7).

**Перевірюване твердження.** `✓ BOUNDARY-3 tilecraft-entry — 7 import(ів) у src/tiles/tilecraftLoader.js`.

| мутація | guard до правила | guard після |
|---|---|---|
| `src/tiles/TileField.js` + `import { thicknessScale } from '@tilecraft/lib/thickness-scale.js'` | ✓ проходить — дефект | ✗ `TileField.js: import «@tilecraft/lib/thickness-scale.js»` |

**Де живе.** [scripts/audit/guard.mjs](scripts/audit/guard.mjs) → `ruleTilecraftEntry`.

## OWNER-1 — один цикл кадру

**Формулювання.** `requestAnimationFrame` викликається лише в `src/main.js`.

**Походження.** Коміт `40bb600`, 2026-10-28 («Fix benchmark sync»): бенчмарк
синхронізується через fence і **призупиняє цикл рендеру** прапорцем
`benchmarking`. Прапорець бачить лише цикл у `main.js`; другий RAF рендерив би
під час заміру й подвоював кадр, а бенчмарк знову брехав би про GPU-час.

**Механізм.** guard-static, `OWNER-1 one-loop`. Розмір набору: у власника ≥ 1
виклик (зараз 4).

**Перевірюване твердження.** `✓ OWNER-1 one-loop — 4 виклик(и) у власника`.

| мутація | guard до правила | guard після |
|---|---|---|
| `src/scene/floaters.js` + `function tick() { requestAnimationFrame(tick); }` | ✓ проходить — дефект | ✗ `floaters.js: requestAnimationFrame (1)` |

**Де живе.** [scripts/audit/guard.mjs](scripts/audit/guard.mjs) → `ruleOneLoop`.

## OWNER-2 — один renderer і один GUI

**Формулювання.** У `src/` рівно один `new WebGLRenderer(` і рівно один
`new GUI(`, обидва в `src/main.js`.

**Походження.** Межа без інциденту (ARCHITECTURE.md TD1, огляд 2026-11-22).
Другий renderer — другий WebGL-контекст (втрата контексту, FD5, відновлюється
лише для першого); другий GUI — друга панель, яку U0 (SCENE-UI-SPEC §3) не сховає.

**Механізм.** guard-static, `OWNER-2 one-renderer-gui`. Рівно 1 — і нуль теж
порушення (перейменований імпорт виводив би правило з-під перевірки).

**Перевірюване твердження.** `✓ OWNER-2 one-renderer-gui — renderer 1, GUI 1`.

| мутація | guard до правила | guard після |
|---|---|---|
| `src/scene/sky.js` + `export const previewRenderer = new THREE.WebGLRenderer()` | ✓ проходить — дефект | ✗ `sky.js: new WebGLRenderer` + `renderer: очікувався рівно 1, знайдено 2` |

**Де живе.** [scripts/audit/guard.mjs](scripts/audit/guard.mjs) → `ruleOneRendererGui`.

## OWNER-3 — камеру пише лише її власник

**Формулювання.** Записи в `camera`/`controls` (`position`, `quaternion`,
`rotation`, `up`, `target`, `controls.enabled`) є лише в
`src/scene/cameraRig.js`. Будь-який інший файл — 0. `controls.enabled`
виводиться з lock-ів із причиною (`rig.lock(reason)` / `rig.release(token)`):
керування ввімкнене рівно тоді, коли жодного lock-а немає.

**Походження.** ARCHITECTURE.md TD2 і §2.3, огляд 2026-11-22: камерою керували
шоти, WASD (`de8e2a8`, 2026-11-07 — четвертий писар), `clampCamera` і
`TileInteraction`, який зберігав і відновлював `controls.enabled` без токена
(27 записів у 2 файлах). Переліт камери (SCENE-UI-SPEC U1) став би п'ятим, і
перетягування кадру під час перельоту відновило б збережене `false` —
керування «залипло» б. U1 звела всіх писарів до `CameraRig`; baseline 27 → 0.

**Механізм.** guard-static, `OWNER-3 camera-writers`: власник
`CAMERA_OWNER` не рахується, `CAMERA_BASELINE` порожній. Межа рахується за
іменами `camera`/`controls`: перейменування отримувача виводить запис з-під
правила (P9). Власник без жодного запису — правило дивиться не туди (P10).
Поведінку lock-ів тримають юніти `tests/cameraFlight.test.js` (`CameraRig`).

**Перевірюване твердження.** `✓ OWNER-3 camera-writers — 0 запис(ів) у 0 файл(ах), baseline 0; власник src/scene/cameraRig.js — 7`.

| мутація | guard до правила | guard після |
|---|---|---|
| `TileInteraction.js` `down()` + `this.camera.position.y += 1` | ✓ проходить — дефект | ✗ `TileInteraction.js: 1 запис(ів) — файл не в baseline` |
| `src/main.js` + `controls.enabled = false;` після `rig.bind(…)` | ✓ проходить — дефект | ✗ `main.js: 1 запис(ів) — файл не в baseline` |
| `src/scene/floaters.js` + `export function flyTo(camera, p) { camera.position.copy(p); }` | ✓ проходить — дефект | ✗ `floaters.js: … — файл не в baseline` |

**Де живе.** [scripts/audit/guard.mjs](scripts/audit/guard.mjs) → `CAMERA_WRITE`, `CAMERA_OWNER`, `CAMERA_BASELINE`, `baselineRule`;
власник — [src/scene/cameraRig.js](src/scene/cameraRig.js).

## OWNER-4 — писарі сонця не множаться

**Формулювання.** Записи в `sky.params` поза `src/scene/sky.js`
(присвоєння, `Object.assign(sky.params…)`, прив'язка GUI `.add(sky.params…)`)
не перевищують baseline: `src/main.js` 6. Baseline лише опускається.

**Походження.** ARCHITECTURE.md TD3, огляд 2026-11-22: сонце пишуть 5
GUI-слайдерів і `setSun` у кожному шоті. Віджет часу доби й погоди
(MOOD-WEATHER M1) стане третім писарем, і шот перезапише вибір людини.
Ціль M1 — один писар.

**Механізм.** guard-static, `OWNER-4 sun-writers`, baseline у `SUN_BASELINE`;
власник `sky.js` не рахується.

**Перевірюване твердження.** `✓ OWNER-4 sun-writers — 6 запис(ів) у 1 файл(ах), baseline 6`.

| мутація | guard до правила | guard після |
|---|---|---|
| `src/tiles/TileField.js` + `export function dusk(sky) { sky.params.elevation = 3; }` | ✓ проходить — дефект | ✗ `TileField.js: 1 запис(ів) — файл не в baseline` |

**Де живе.** [scripts/audit/guard.mjs](scripts/audit/guard.mjs) → `SUN_WRITE`, `SUN_BASELINE`.

## OWNER-5 — глобали пише лише корінь композиції

**Формулювання.** Присвоєння `window.X =`, `globalThis.X =`, `self.X =` є лише
в `src/main.js` (зараз 2: `runBenchmark`, `app`).

**Походження.** ARCHITECTURE.md TD9, огляд 2026-11-22: `window.app` — неявний
API, який читають проби; перейменування ключа видно лише через хвилини
probe-рівня. Другий модуль, що дописує в глобали, розмиває цей API й відкриває
прихований канал між модулями.

**Механізм.** guard-static, `OWNER-5 globals-owner`.

**Перевірюване твердження.** `✓ OWNER-5 globals-owner — 2 запис(и) у src/main.js`.

| мутація | guard до правила | guard після |
|---|---|---|
| `src/tiles/tilecraftLoader.js` + `globalThis.tilecraftDebug = true` | ✓ проходить — дефект | ✗ `tilecraftLoader.js: 1 запис(ів) у window/globalThis` |

**Де живе.** [scripts/audit/guard.mjs](scripts/audit/guard.mjs) → `ruleGlobals`.

## BUDGET-1 — семплери води в мінімумах WebGL2

**Формулювання.** Програма води оголошує після препроцесора: фрагментна
стадія ≤ 16 семплерів, вершинна ≤ 16, разом ≤ 32 (гарантовані мінімуми
WebGL2). Зараз фрагмент 16/16.

**Походження.** Коміт `9a34841`, 2026-11-02: 17-й текстурний юніт у
фрагментному шейдері — three попереджав щокадру, на частині GPU шейдер не
компілюється. Виправлено тим, що `uSurf` іде у фрагмент вершинним varying
(`#define SURF_VARYING`). ARCHITECTURE.md TD6: будь-яка нова текстура води
(дощ, хмарні тіні) повторить інцидент.

**Механізм.** guard-static, `BUDGET-1 water-samplers`: guard імпортує
`WATER_SHADERS` з `OceanSurface.js` (ті самі рядки, що бере матеріал) і рахує
оголошення після `#define`/`#ifdef`/`#else`. `#if <вираз>` свідомо валить
розбір. Розмір набору: фрагмент ≥ 10, інакше розбір зламався (P10).

**Перевірюване твердження.** `✓ BUDGET-1 water-samplers — fragment 16/16, vertex 10/16, combined 17/32`.

| мутація | guard до правила | guard після |
|---|---|---|
| `OceanSurface.js`: прибрати `'#define SURF_VARYING\n'` з `FRAG` (відкат фіксу `9a34841`) | ✓ проходить — дефект | ✗ `fragment: 17 > 16 (… uSurf …)` |

**Де живе.** [scripts/audit/guard.mjs](scripts/audit/guard.mjs) → `ruleWaterSamplers`;
розбір — [scripts/audit/glsl-samplers.mjs](scripts/audit/glsl-samplers.mjs);
експорт — `WATER_SHADERS` у [src/water/OceanSurface.js](src/water/OceanSurface.js).

## TEX-1 — float-текстури без лінійної фільтрації

**Формулювання.** Текстура чи render target з `FloatType` має `NearestFilter`
(min і mag). Дані, які шейдер читає з лінійною фільтрацією, — `HalfFloatType`
через [src/engine/halfTexture.js](src/engine/halfTexture.js). Виняток —
`DepthTexture` з `compareFunction` (shadow-семплер, повний у ядрі WebGL2).

**Походження.** scene-ui U4, 2026-11-23: на телефоні власника (Chrome Android,
`OES_texture_float_linear` немає) навколо острова — квадрат 1800 × 1800 м світлої
гладкої «мілини» без прибою з різкою межею. `FloatType` + `LinearFilter` без
розширення — неповна текстура, читається як 0 → глибина 0 у всій карті берега.
Desktop має розширення — жоден рівень перевірок цього не бачив.

**Механізм.** guard-static, `TEX-1 float-filter`: кожен `FloatType` у `src/` —
його інструкція (опції `minFilter:`/`magFilter:`, `WebGL*RenderTarget` без двох
`NearestFilter` — лінійний за замовчуванням three) і наступні інструкції
`<ім'я>.minFilter|magFilter = …`. Розмір: ≥ 10 `FloatType`, інакше правило дивиться
не туди. Поведінково — [scripts/probe-scene-shore.mjs](scripts/probe-scene-shore.mjs):
трекер WebGL перелічує `R/RG/RGB/RGBA32F`, прив'язані до draw з лінійним фільтром
(до фіксу — `RGBA32F` ×2 і `R32F`, після — 0; працює й на деплої).

**Перевірюване твердження.** `✓ TEX-1 float-filter — 16 FloatType`.

| мутація | guard до правила | guard після |
|---|---|---|
| `shoreMap.js`: `floatTex` знову `new THREE.DataTexture(…, THREE.FloatType)` + `tex.minFilter = tex.magFilter = THREE.LinearFilter` (відкат U4) | ✓ проходить — дефект | ✗ `shoreMap.js:69: FloatType + лінійна фільтрація` |
| `terrainGeometry.js`: heightMap знову `FloatType` + `LinearFilter` | ✓ проходить — дефект | ✗ `terrainGeometry.js:30: …` |
| `TileSim.js:320`: `minFilter: THREE.LinearFilter` у float render target | ✓ проходить — дефект | ✗ `TileSim.js:320: …` |
| `WaterQuery.js:27`: прибрати `minFilter`/`magFilter` з float render target | ✓ проходить — дефект | ✗ `WaterQuery.js:27: …` |
| `floaterShadow.js`: прибрати `depth.compareFunction = …` | ✓ проходить — дефект | ✗ `floaterShadow.js:23: …` |

**Де живе.** [scripts/audit/guard.mjs](scripts/audit/guard.mjs) → `ruleFloatFilter`;
хелпер — `halfTexture` у [src/engine/halfTexture.js](src/engine/halfTexture.js);
юніт — [tests/shoreTextures.test.js](tests/shoreTextures.test.js).

## TYPES-1 — помилки типів не ростуть

**Формулювання.** `tsc --checkJs` над `src/` (tsconfig.json, `strict: false`)
дає не більше помилок, ніж baseline, і в жодному файлі не більше, ніж там
записано. Зараз 21 у 6 файлах. Baseline лише опускається.

**Походження.** ARCHITECTURE.md TD12, огляд 2026-11-22: клас «виклик замість
значення» ловиться лише в браузері. Запуск через прямий `tsc.js`, не `npx`:
у `three` (інцидент Д5) `npx.cmd` через `execFileSync` на Windows віддавав
порожній stdout, і перевірка мовчки зеленіла; тому порожній вивід при
ненульовому коді — помилка, а не «чисто» (P4).

**Механізм.** guard викликає [scripts/audit/typecheck.mjs](scripts/audit/typecheck.mjs)
окремим процесом і бере лише вердикт; baseline —
[scripts/audit/typecheck-baseline.json](scripts/audit/typecheck-baseline.json).

**Перевірюване твердження.** `typecheck: 21 помилок, baseline тримається.`

| мутація | guard до правила | guard після |
|---|---|---|
| `src/water/shoreMap.js` + `let mutationCount = 0; mutationCount = 'many';` | ✓ проходить — дефект | ✗ `typecheck: 22 помилок проти baseline 21`, `shoreMap.js(351,24): TS2322` |

**Де живе.** `npm run typecheck`, `npm run typecheck:report`.

---

## Як додати інваріант

Лише з інциденту і лише з механізмом (`invariant-guard:add`). Спершу
питання: яка мутація реального коду валить яку перевірку? Немає відповіді —
це рішення, воно йде в [DECISIONS.md](DECISIONS.md).

1. Факти інциденту: що зламалось, коміт і дата, **чому мовчали перевірки**.
2. Механізм: видно в тексті → guard-static; потрібне обчислення без браузера →
   юніт у `tests/`; лише у взаємодії → probe; дефект у тесті → test-review.
3. П'ять полів: формулювання, походження, механізм, перевірюване твердження
   (число), де живе. Рядок у реєстр. Id — вільний (`grep`), за класом межі
   (`BOUNDARY-`, `OWNER-`, `BUDGET-`, `TYPES-`), не за назвою фази.
4. Мутація: показати в diff, показати падіння з іменем файлу, прибрати.
   Таблиця мутації — у секцію.
5. Статичне правило — у `scripts/audit/guard.mjs` з `id`, що збігається з
   реєстром; прогнати guard.

## Чого ці практики НЕ роблять

- **Не замінюють рев'ю.** Guard ловить класи помилок, що вже траплялися.
  Новий клас першою бачить людина.
- **Не дають покриття.** 10 інваріантів — не тести фіч; 4 юніт-скрипти й 13
  проб покривають лише назване в них.
- **Не працюють без циклу фаз.** Реєстр росте лише тоді, коли фаза виправила
  регресію і має для неї механізм. Без цього через пів року тут будуть ті самі
  11 правил.
- **Не безкоштовні.** Кожне правило — код, що може впасти на легальному
  рефакторингу (P15). Правило, що тричі впало хибно, переписують як похідне
  твердження або видаляють — це нормальний хід, не поразка. Регулярні вирази
  OWNER-3/4/5 особливо чутливі до перейменувань.
