# Handoff: scene-ui — прихований технічний UI і рейка опорних точок

Стан на 2026-11-23. Гілка `master`. Фази з
[SCENE-UI-SPEC.md](../../SCENE-UI-SPEC.md) (далі — «спека»). U0 і U1 закрито
(коміти закриття фаз), U2, U3 і U4 — теж. Усі фази плану закрито.

> **Далі:** фаз у плані немає — наступну визначає власник (відкриті питання нижче).

Локальний стенд: `http://localhost:5199/`; правило стенду — `AGENTS.md` →
«Локальний стенд».

## НЕЗАКРИТЕ — почни звідси

Фази по порядку. Guard для всіх фаз: `npm run guard` зелений (OWNER-1…5,
BOUNDARY-1…3, BUDGET-1, TYPES-1); `npm test` зелений; `?tiles=none` і
`runBenchmark({ shot })` поводяться як до фази. Порядок перевірок —
guard → focused → probe ([TESTING.md](../../TESTING.md#рівні-прогону)).

~~1. **U0 — технічний UI схований** (спека §3): lil-gui і `#perf` сховані,
   F2/F3, `?controls`/`?fps`/`?debug`, смужка F2/F3 на три дотики; код у
   `src/ui/techPanels.js`.~~ — ЗАКРИТО 2026-11-22: [QA.md](QA.md) → U0,
   проба `scripts/probe-scene-ui.mjs`.

~~2. **U1 — власник камери, переліт і рейка `island` / `shore` / `story`**
   (спека §4.1, §4.2, §4.4, §4.5): `CameraRig` — єдиний писар камери з lock-ами,
   `cameraFlight.js`, рейка без `setSun`; OWNER-3 27 → 0.~~ — ЗАКРИТО 2026-11-23:
   [QA.md](QA.md) → U1, проба `scripts/probe-scene-rail.mjs`.

~~3. **U2 — станція «Мить»** (спека §4.3): перебір кадрів у порядку
   `tiles.frames`, `←`/`→`, клавіша `4`, свайп по вузлу, «Мить N/M», стеження
   за дрейфом ≤ 2 м/с через `rig.follow` до першого дотику.~~ — ЗАКРИТО
   2026-11-23: [QA.md](QA.md) → U2, проба `scripts/probe-scene-frame.mjs`.

~~4. **U3 — мобільний профіль, a11y, i18n, телефон** (спека §4.6, §4.7 п.8):
   рейка на телефоні на всю ширину з відступами 16 px і місцем під кнопку погоди,
   `viewport-fit=cover`, `lang` рейки.~~ — ЗАКРИТО 2026-11-23: [QA.md](QA.md) → U3,
   проба `scripts/probe-scene-mobile.mjs`; FPS на Nord 4 (QA-U3-4) власник пройшов 2026-11-23.

~~5. **U4 — квадрат мілини на телефоні: float-текстури без лінійної фільтрації**
   (виправлення регресії): карти берега й heightMap → half-float через
   `engine/halfTexture.js`, guard TEX-1.~~ — ЗАКРИТО 2026-11-23: [QA.md](QA.md) → U4,
   проба `scripts/probe-scene-shore.mjs`; квадрат на телефоні (QA-U4-1) власник пройшов 2026-11-23.

### Відкриті питання

- **`shore` — вирішено власником 2026-11-22:** дивиться на поле історії (й
  море за ним), не на горизонт. Спека §7 ще перелічує це питання як
  відкрите; таблиця §4.2 вже описує саме цей варіант.
- **Три дотики й `TileInteraction` — перевірено в U0:** drag не починається,
  кадри й камера не рухаються; кадр під першим пальцем лишається виділеним
  (поведінка FD2, як після pinch). Змінювати — рішення власника, у frame-drag.
- **`probe-scene-ui` падає на `?tiles=story-8-frames-hibrid: strip after tap`**
  (2026-11-23, помічено в scene-environment E0): три дотики на полі історії не
  показують смужку в headless-пробі; так само на коді U4 без змін E0
  (`git stash`). Не з'ясовано — стенд, Tilecraft-історія чи регресія.
- **Переліт на стіні довший за 5 с** на кадрах-ривках (дивись факти). Якщо
  власник хоче рівно ≤ 5 с за годинником — рішення, не баг: тоді переліт має
  рахувати реальний час, а не `dt` кадру (≤ 0.1 с), і на ривку стрибатиме вперед.
- **`main.js` правлять кілька тем.** SCENE-ENVIRONMENT E1 теж виносить код із
  `main.js`; її краще брати після U0, не паралельно.
- **Сонце.** Baseline OWNER-4 (6) опускає MOOD-WEATHER M1, коли віджет погоди
  стане єдиним писарем. Станції сонця не пишуть; дев-шоти — пишуть (спека §4.4).
- **`npm run deploy` зламаний** (дивись факти «Стенд і інструменти»): не
  блокує фази, драфт робиться через `npx` з окремої теки.

## Що зроблено і працює

Baseline (U4, 2026-11-23): guard зелений (OWNER-3 0 + власник 9, OWNER-4 6,
TEX-1 16 `FloatType`, TYPES-1 21); `npm test` 63/63; проби `probe-scene-shore`,
`probe-scene-rail`, `probe-scene-ui` PASS.

| підсистема | де | контракт | перевірка |
|---|---|---|---|
| технічні панелі | [src/ui/techPanels.js](../../src/ui/techPanels.js) (`createTechPanels`, `panelsFromUrl`, `TripleTap`, `isEditing`); `app.techPanels` | спека §3: сховані від старту, F2/F3 без модифікаторів і не в полі вводу, `?controls`/`?fps`/`?debug`, смужка `#techStrip` на три дотики — над рейкою; стан не зберігається | `tests/techPanels.test.js`, `scripts/probe-scene-ui.mjs` |
| HUD `#perf` | [index.html](../../index.html), `updateHud` у [main.js](../../src/main.js) | схований `#perf` → жодних DOM-записів; лічильник FPS, `GpuTimer`, `autoResolution`, `runBenchmark` від видимості не залежать; на телефоні над смужкою, при висоті ≤ 500 px — угорі ліворуч | `probe-scene-ui`, `probe-scene-mobile` |
| мобільний профіль рейки | `.mobile #stationRail`, `--rail-top`, `--weather-slot` в [index.html](../../index.html); клас `mobile` — [main.js:49](../../src/main.js#L49) | спека §4.6: рейка 16 px від лівого краю й низу (+ safe-area, `viewport-fit=cover`), праворуч слот 56 + 8 px під погоду (MOOD-WEATHER §4.1); зони дотику ≥ 44×44; рейка/смужка/`#perf` не перекриваються; `lang` рейки = мова підписів | `probe-scene-mobile` |
| lil-gui «Gelatin Water» | `new GUI` у [main.js](../../src/main.js) (OWNER-2) | видимістю керує `techPanels`; список `camera` — дев-шоти (`views`, [main.js:190](../../src/main.js#L190)), кожен викликає `setSun` і ставить камеру через `rig.place` | `probe-scene-ui` |
| власник камери | [src/scene/cameraRig.js](../../src/scene/cameraRig.js) (`CameraRig`: `lock`/`release`, `place`, `flyTo`, `follow`, `interrupt`, `holdStill`, `bind`, `update`); `app.rig`; створення — [main.js:60](../../src/main.js#L60) | INVARIANTS OWNER-3: єдиний писар `camera`/`controls`; `controls.enabled` ⟺ немає lock-ів; WASD, межа рельєф+0.8, переліт і `follow` (зсув камери й target разом, ≤ speed м/с, на lock-ах стоїть) — тут; pointerdown на canvas (window capture), колесо, WASD зупиняють переліт і `follow` | guard OWNER-3, `tests/cameraFlight.test.js` |
| переліт | [src/scene/cameraFlight.js](../../src/scene/cameraFlight.js) (`createFlight`, `flightDuration`, `liftHeight`, `smootherstep`) | спека §4.4; без DOM; годинник — `dt` кадру; вода +1 м з рампою на першу/останню чверть (старт під водою не стрибає) | `tests/cameraFlight.test.js`, `probe-scene-rail` |
| станції й рейка | [src/scene/stationPoses.js](../../src/scene/stationPoses.js) (`islandPose`, `shorePose`, `storyPose`); [src/ui/stationRail.js](../../src/ui/stationRail.js) (`createStationRail`, `onStation`); пози — `stationPoses` у [main.js:279](../../src/main.js#L279); `app.stations` | спека §4.1–4.5: `go(id)` → `true` на прибутті; ● на станції, ◎ після відведення (> 5 % / > 8°); reduced motion — згасання до opacity 1, `rig.place`, проявлення; uk/en за `navigator.languages`; `frame` активна ⟺ `frames.count() > 0`, `nextFrame`/`prevFrame`, свайп по вузлу, підпис «Мить N/M» | `probe-scene-rail`, `probe-scene-frame` |
| станція «Мить» | [src/scene/frameFocus.js](../../src/scene/frameFocus.js) (`createFrameFocus`, `stepFrame`, `frameRestCenter`, `frameCorners`); `fitPose` у `stationPoses.js`; `storyFrames` у [main.js](../../src/main.js); `app.stations.focus` | спека §4.3: порядок `tiles.frames`, з іншої станції — кадр у фокусі; поза — rest-коробка кадру, центр — GPU-середина (drift) раз на 250 мс; `follow` лише в drift | `tests/cameraFlight.test.js`, `probe-scene-frame` |
| кадри історії | `tiles.frames`, `TileFrames.entries` (`world`, `bounds`, `mode`); центр поля — `tiles.center`; `TileField.frameFootprint(frame)` — GPU-коробка кадру (1×1 readback, читання в черзі) | drift рухає тайли лише на GPU, `entry.world` не змінюється; `tiles.place()` скасовує drag — станції його не викликають | `probe-frame-drag`, `probe-scene-frame` |
| текстури берега | `halfTexture` у [src/engine/halfTexture.js](../../src/engine/halfTexture.js); `floatTex` і `surfShelter` у [src/water/shoreMap.js](../../src/water/shoreMap.js); `buildTerrain` у [terrainGeometry.js](../../src/scene/terrainGeometry.js) | INVARIANTS TEX-1: лінійно фільтровані дані — `HalfFloatType` (`Uint16Array`), `FloatType` — лише з `NearestFilter`; CPU-копії (`data`, `travelData`) лишаються Float32 | guard TEX-1, `tests/shoreTextures.test.js`, `probe-scene-shore` |
| бенчмарк / API | `runBenchmark` [main.js:607](../../src/main.js#L607), `window.app` [main.js:641](../../src/main.js#L641) | `runBenchmark({ shot })` ставить дев-шот через `rig.place` (переліт скасовується) | `probe-scene-ui` |

## Головні виміряні факти

### Стенд і інструменти

- [`npm test` з Git Bash] шлях `/d/…` дає два екземпляри vitest: «failed to find the current suite» у кожному файлі → запускати з PowerShell. (U0)
- [проби, що клікають lil-gui] панель схована з U0 → URL проби має містити `&controls`; `probe-tiles`, `probe-tiles-drift`, `probe-frame-pose`, `probe-frame-drag` уже мають. (U0)
- [CDP `Input.dispatchTouchEvent`, 3 точки, `hasTouch`] Chromium генерує pointer-події, `TripleTap` спрацьовує → жест перевіряється без телефона. (U0)
- [mobile-профіль, CPU throttle ×20, FPS схований] `autoResolution` знизила 0.6 → 0.55 → так перевіряти адаптацію без HUD. (U0)
- [headless-стенд, AMD 890M, статична камера] 4–8 кадрів > 100 мс за 5 с, найгірший 750 мс, з тайлами й без, як і під час перельоту → ривки — стенд, не переліт; переліт 5 с за `dt` триває 5.6–7.9 с на стіні. (U1)
- [`npm run deploy`] netlify-cli падає `Cannot read properties of undefined (reading 'Intrinsic')`: піднятий `ts-api-utils` бере typescript 7.0.2 проєкту замість 5.9.3 (Node 25 ні до чого) → драфт: `npx -y netlify-cli@27.20.0 deploy --no-build --dir <repo>/dist --site 2a006d8a-c00b-48e1-b2f1-241af4c0c95d` **з теки поза репо** (з репо `npx` бере локальний зламаний бінарник); стійкий фікс — `overrides` `ts-api-utils` → `typescript@5.9.3`, потребує згоди власника. (U1)
- [`deploy-netlify.mjs`, сайт за іменем] `edge-of-elements` за іменем — «Not Found», за ID працює; `npm run deploy -- --site …` на Windows губить `--site` → `NETLIFY_SITE_ID=2a006d8a-…`. (U1)
- [`env(safe-area-inset-*)` у Playwright] Chromium не емулює вирізи — завжди 0 → відступ над жестовою смугою перевіряє лише власник на телефоні. (U3)
- [проба, що чекає `stations.current`] DOM рейки оновлює цикл кадру (`update`) — `current` уже `shore`, а `aria-current` ще ні → чекати сам атрибут. (U3)
- [телефон власника, Chrome Android] `OES_texture_float_linear` немає, `EXT_color_buffer_float` є → float-текстури з `LinearFilter` читаються як 0; лінійно фільтровані дані — `halfTexture()`. (U1, U4)
- [desktop, розширення сховане через `getExtension`] GPU однаково фільтрує float32 — квадрат не відтворюється, three лише попереджає → проба `probe-scene-shore` ловить причину трекером WebGL (float32 + лінійний фільтр у draw), не вигляд. (U4)
- [попередження three «Unable to use linear filtering…»] не називає текстуру, у прод-збірці стек мініфіковано → розрізняти текстури лише на рівні викликів WebGL. (U4)
- [`DataUtils.toHalfFloat`] похибка до 1 ulp (2⁻¹⁰ відносно), не 0.5 → допуски юнітів на half — 2⁻¹⁰. (U4)
- [half-float, карта берега] `tau` у смузі прибою −21…52 с: похибка ≤ 0.031 с (фаза ≤ 2.6° при λ 30 м); на суші до −162 с — похибка 0.125 с, хвиль там немає. Конверсія RGBA 512² — 15 мс на desktop. (U4)

### Камера й `main.js`

- `src/main.js` — ~770 рядків, найгарячіший файл історії (ARCHITECTURE TD1).
- [новий код, що рухає камеру] будь-який запис `camera.*`/`controls.*` поза `cameraRig.js` валить OWNER-3 → `rig.place(p, t)` / `rig.flyTo(pose)` / `rig.lock(reason)`; проби можуть писати `app.camera` напряму (guard дивиться лише `src/`). (U1)
- [`TileInteraction`] бере `rig.lock('frame-drag')` у `down()` і відпускає свій токен у `finish`/`cancel` → переліт, перерваний pointerdown-ом на кадрі, віддає керування drag-у, після відпускання `controls.enabled` = true (проба: захоплення на 80 % перельоту). (U1)
- [`tiles.place()`] скасовує поточний drag і синхронізує кадри → пози станцій читають `tiles.center`, не `placeTiles()`. (U1)
- [кадр у drift, поза чи стеження] `entry.world` не рухається — тайли пливуть лише на GPU → центр брати з `tiles.frameFootprint(frame)`; за 30 с кадр зсувається на 6.3 м, `follow` іде за ним на 6.2 м зі швидкістю ≤ 2.03 м/с. (U2)
- [телефон горизонтально, 915×412, `?fps` + смужка] `#perf` заввишки 282 px над смужкою (верх 268) вилазить за екран → `@media (max-height: 500px)` ставить його вгору. (U3)
- [reduced motion, `setTimeout(250)`] таймер спрацьовує при opacity 0.93 — 7 % стрибка видно → рейка чекає `transitionend` (запасний таймер 400 мс). (U1)
- Браузерні проби потребують запущеного стенду; `playwright` є в `node_modules` проєкту, `PLAYWRIGHT_MODULE` — лише якщо його немає (див. [docs/frame-drag/HANDOFF.md](../frame-drag/HANDOFF.md)); startup timeout — 120 с (ARCHITECTURE TD10).
