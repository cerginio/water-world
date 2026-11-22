# Handoff: scene-ui — прихований технічний UI і рейка опорних точок

Стан на 2026-11-23. Гілка `master`. Фази з
[SCENE-UI-SPEC.md](../../SCENE-UI-SPEC.md) (далі — «спека»). U0 і U1 закрито
(коміти закриття фаз); U2–U4 відкриті.

> **Далі:** U2 — станція «Мить»: перебір кадрів історії, поза за `bounds`, стеження за дрейфом, `←`/`→`, клавіша `4`, свайп (спека §4.3).

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

3. **U2 — станція «Мить»** (спека §4.3).
   - Контракт: порядок `tiles.frames`; «Мить» з іншої станції — останній
     кадр у фокусі (спочатку перший), повторно — наступний, після останнього
     — перший; `←`/`→` на станції `frame`, клавіша `4`, свайп по вузлу; поза
     з `entry.world` / `entry.bounds` через матрицю поля, відстань як у шоті
     `Tiles` ×1.3, нахил 35°, азимут `fieldYaw`; стеження за дрейфом ≤ 2 м/с
     до першого дотику; `TileInteraction` фокус не чіпає; «Мить 1/1».
   - Куди вбудовувати: `stationPoses.frame` у [main.js:279](../../src/main.js#L279)
     зараз `() => null`, `isActive` вимикає `frame`; `nextFrame` / `prevFrame` у
     [stationRail.js](../../src/ui/stationRail.js) — заглушки, що повертають `false`;
     лічильник N/M — у підпис вузла `frame`. Клавіша `4` уже проходить через
     обробник рейки (`Digit1…4`). Стеження за дрейфом пише камеру — лише через
     `CameraRig` (OWNER-3 = 0, новий писар валить guard); «перший дотик» = та сама
     точка, що `rig.interrupt()` (pointerdown / колесо / WASD).
   - Закриття: проба §4.7 п.4–5 — `→` по всіх 8 кадрах hybrid із правильним
     N/M і переходом 8 → 1; кадр у drift 30 с лишається в кадрі екрана (bounds
     у NDC усередині [-1, 1]). Регресія — `probe-frame-drag.mjs`,
     `probe-scene-rail.mjs` PASS.
   - Чернетка QA: `qa:open` `…/?tiles=story-8-frames-hibrid&tilesMode=drift`
     → `qa:action` «Мить», потім `→` 8 разів → `qa:inspect` лічильник і кадр
     → `qa:expected` 1/8 … 8/8 → 1/8, кадр заповнює ~75 % екрана й не
     випливає з нього.

4. **U3 — мобільний профіль, a11y, i18n, телефон** (спека §4.6, §4.7 п.8).
   - Контракт: рейка на всю ширину з відступами 16 px над
     `safe-area-inset-bottom`; смужка F2/F3 і ввімкнена `#perf` — над рейкою
     (уже так з U1: `--rail-top` в [index.html](../../index.html), проба
     перекриття = 0); вузли `<button>` з `aria-label` і `aria-current="location"`
     (уже є), видимий фокус (`:focus-visible` є, перевірити очима); місце під
     круглу кнопку погоди праворуч від рейки (саму кнопку робить MOOD-WEATHER).
   - Закриття: проба в mobile-профілі (перекриття прямокутників рейки,
     смужки й `#perf` = 0, зони дотику ≥ 44×44 px, aria-атрибути). П.8 —
     замір FPS на OnePlus Nord 4 під час перельоту проти статичної камери в
     тій самій точці; це робить власник, desktop mobile-профіль його не
     замінює.

5. **U4 — квадрат мілини на телефоні: float-текстури без лінійної фільтрації**
   (виправлення регресії; рішення власника 2026-11-23 — окрема фаза в кінці).
   - Інцидент: на телефоні власника (Chrome Android, `OES_texture_float_linear`
     **немає** в списку розширень webglreport, 2026-11-23) навколо острова видно
     квадрат ~1800 × 1800 м зі світлою гладкою «мілиною» без смуг прибою і різкою
     межею з відкритим океаном. Видно зі станції «Острів» (U1), але рендер U1 не
     змінювала — дефект старший. На desktop (розширення є) квадрата немає.
   - Механізм: `FloatType` + `LinearFilter` без `OES_texture_float_linear` —
     неповна текстура, читається як 0 → `shoreSample().x` = 0 → глибина 0 у всій
     карті берега (`uShoreExtent` 1800), поза картою шейдер і так повертає −60.
   - Що змінити: текстури [shoreMap.js:67-69](../../src/water/shoreMap.js#L67-L69)
     (`floatTex`: shore, travel), [:308-309](../../src/water/shoreMap.js#L308-L309)
     (surf) і heightMap [terrainGeometry.js:29-30](../../src/scene/terrainGeometry.js#L29-L30)
     → `HalfFloatType` (фільтрація half-float — ядро WebGL2). Точність half: глибина
     ±60 м — крок ~3 см; SDF до 1e4 — крок ~8 м, у шейдері лише порівнюється з
     порогами 70–180 м. Перевірити, що `travel.tau` і `shoal` не виходять за
     65 504 і не втрачають потрібної точності. Альтернатива (ручна білінійна
     в шейдері) — гірша: фрагмент води на межі 16/16 семплерів (BUDGET-1).
   - Закриття: guard — нове правило через `invariant-guard:add` (інцидент є,
     механізм є): `DataTexture`/`RenderTarget` з `FloatType` і `LinearFilter` —
     порушення; мутація — повернути `FloatType` у `floatTex` → guard падає.
     Focused — юніт на форму текстур (тип half, фільтр linear). Проба — без
     розширення в браузері не відтворити (desktop його має) → до/після скріншоти
     станції «Острів» на desktop (вигляд не змінився) + драфт-деплой і очі власника
     на телефоні: квадрата немає, прибій біля острова є.
   - Чернетка QA: `qa:open` драфт-URL на телефоні → `qa:action` «Острів» →
     `qa:inspect` вода навколо острова → `qa:expected` бірюзова мілина тільки біля
     берега, смуги прибою, плавний перехід у синій океан без прямої межі й кута.

### Відкриті питання

- **`shore` — вирішено власником 2026-11-22:** дивиться на поле історії (й
  море за ним), не на горизонт. Спека §7 ще перелічує це питання як
  відкрите; таблиця §4.2 вже описує саме цей варіант.
- **Три пальці на iOS Safari** (спека §3.2): системні жести редагування
  тексту можуть перехопити дотик. Справжній iPhone ще не перевірено
  (QA-U0-10); якщо перехоплюються — питання власнику, не тихий інший жест.
- **Три дотики й `TileInteraction` — перевірено в U0:** drag не починається,
  кадри й камера не рухаються; кадр під першим пальцем лишається виділеним
  (поведінка FD2, як після pinch). Змінювати — рішення власника, у frame-drag.
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

Baseline (U1, 2026-11-23): guard зелений (OWNER-3 0 + власник 7, OWNER-4 6,
TYPES-1 21); `npm test` 49/49; проби `probe-scene-rail`, `probe-scene-ui` PASS.

| підсистема | де | контракт | перевірка |
|---|---|---|---|
| технічні панелі | [src/ui/techPanels.js](../../src/ui/techPanels.js) (`createTechPanels`, `panelsFromUrl`, `TripleTap`, `isEditing`); `app.techPanels` | спека §3: сховані від старту, F2/F3 без модифікаторів і не в полі вводу, `?controls`/`?fps`/`?debug`, смужка `#techStrip` на три дотики — над рейкою; стан не зберігається | `tests/techPanels.test.js`, `scripts/probe-scene-ui.mjs` |
| HUD `#perf` | [index.html](../../index.html), `updateHud` у [main.js](../../src/main.js) | схований `#perf` → жодних DOM-записів; лічильник FPS, `GpuTimer`, `autoResolution`, `runBenchmark` від видимості не залежать | `probe-scene-ui` |
| lil-gui «Gelatin Water» | `new GUI` у [main.js](../../src/main.js) (OWNER-2) | видимістю керує `techPanels`; список `camera` — дев-шоти (`views`, [main.js:190](../../src/main.js#L190)), кожен викликає `setSun` і ставить камеру через `rig.place` | `probe-scene-ui` |
| власник камери | [src/scene/cameraRig.js](../../src/scene/cameraRig.js) (`CameraRig`: `lock`/`release`, `place`, `flyTo`, `interrupt`, `holdStill`, `bind`, `update`); `app.rig`; створення — [main.js:60](../../src/main.js#L60) | INVARIANTS OWNER-3: єдиний писар `camera`/`controls`; `controls.enabled` ⟺ немає lock-ів; WASD, межа рельєф+0.8 і переліт — тут; pointerdown на canvas (window capture), колесо, WASD зупиняють переліт | guard OWNER-3, `tests/cameraFlight.test.js` |
| переліт | [src/scene/cameraFlight.js](../../src/scene/cameraFlight.js) (`createFlight`, `flightDuration`, `liftHeight`, `smootherstep`) | спека §4.4; без DOM; годинник — `dt` кадру; вода +1 м з рампою на першу/останню чверть (старт під водою не стрибає) | `tests/cameraFlight.test.js`, `probe-scene-rail` |
| станції й рейка | [src/scene/stationPoses.js](../../src/scene/stationPoses.js) (`islandPose`, `shorePose`, `storyPose`); [src/ui/stationRail.js](../../src/ui/stationRail.js) (`createStationRail`, `onStation`); пози — `stationPoses` у [main.js:279](../../src/main.js#L279); `app.stations` | спека §4.1–4.5: `go(id)` → `true` на прибутті; ● на станції, ◎ після відведення (> 5 % / > 8°); reduced motion — згасання до opacity 1, `rig.place`, проявлення; uk/en за `navigator.languages`; `frame` — U2 | `probe-scene-rail` |
| кадри історії | `tiles.frames`, `TileFrames.entries` (`world`, `bounds`, `mode`); центр поля — `tiles.center` | фокусу на кадрі ще немає (U2); `tiles.place()` скасовує drag — станції його не викликають | `probe-frame-drag` |
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
- [телефон власника, Chrome Android] `OES_texture_float_linear` немає, `EXT_color_buffer_float` є → float-текстури з `LinearFilter` читаються як 0; desktop-проба цього не бачить (у неї розширення є). (U1, → U4)

### Камера й `main.js`

- `src/main.js` — ~770 рядків, найгарячіший файл історії (ARCHITECTURE TD1).
- [новий код, що рухає камеру] будь-який запис `camera.*`/`controls.*` поза `cameraRig.js` валить OWNER-3 → `rig.place(p, t)` / `rig.flyTo(pose)` / `rig.lock(reason)`; проби можуть писати `app.camera` напряму (guard дивиться лише `src/`). (U1)
- [`TileInteraction`] бере `rig.lock('frame-drag')` у `down()` і відпускає свій токен у `finish`/`cancel` → переліт, перерваний pointerdown-ом на кадрі, віддає керування drag-у, після відпускання `controls.enabled` = true (проба: захоплення на 80 % перельоту). (U1)
- [`tiles.place()`] скасовує поточний drag і синхронізує кадри → пози станцій читають `tiles.center`, не `placeTiles()`. (U1)
- [reduced motion, `setTimeout(250)`] таймер спрацьовує при opacity 0.93 — 7 % стрибка видно → рейка чекає `transitionend` (запасний таймер 400 мс). (U1)
- Браузерні проби потребують запущеного стенду; `playwright` є в `node_modules` проєкту, `PLAYWRIGHT_MODULE` — лише якщо його немає (див. [docs/frame-drag/HANDOFF.md](../frame-drag/HANDOFF.md)); startup timeout — 120 с (ARCHITECTURE TD10).
