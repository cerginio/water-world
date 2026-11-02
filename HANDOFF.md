# Handoff: tile-floaters — плавучі тайли Tilecraft

Стан на 2026-11-02. Гілка `master`, T0 закомічена (завантажувач + статичне поле).

Спека: [spec.md](spec.md). Tilecraft (`D:/work/js-games/ua-dream/tilecraft`) у цій
темі **лише читається** — жодних змін у ньому (spec.md §1).

> **Далі:** фаза T1 — матеріал стану і кінематика.

## Що зроблено і працює

| файл | стан |
|---|---|
| `vite.config.js` | порт 5199, `dedupe: ['three']`, `fs.allow` на `TILECRAFT_ROOT`, плагін `tilecraft-asset-urls` (П3), `__TILECRAFT_ROOT__` ('' у build) |
| `src/tiles/tilecraftLoader.js` | динамічний імпорт Tilecraft через `/@fs/`, ланцюжок §3.4, `sameThree` (П4) |
| `src/tiles/tileRest.js` | `collectTileRest(compiled, { frame })` → `tiles` (x, z, yaw, radius, y0, thickness, runId, flags, g, f), `polygon[]` (матриці, кольори, прототип), `polyline[]` (геометрія + готові `aTile`/`aOffset` для T1), `runs[]` |
| `src/tiles/TileField.js` | `load` / `rebuild` / `place` / `clear`; поле статичне, матеріал пропів; `update()` — порожній |
| `src/main.js` | папка `Tiles` (source, frame, metersPerSourceUnit, fieldYaw, status), шот `Tiles`, `?tiles` відкриває стенд одразу на шоті `Tiles`, drag & drop JSON |
| `QA.md` | сценарії QA-T0-1…5 |

Опора в наявному коді:

| файл | на що спирається тема |
|---|---|
| `src/water/WaterQuery.js` | патерн GPU-проходу з `WATER_GLSL` + `surface.uniforms` |
| `src/scene/floaters.js` | модель сил (Архімед, опір, момент), яку тайли повторюють на GPU |
| `src/scene/floaterShadow.js` | тінь, у яку поле має потрапити (T4) |
| `src/scene/terrain.js` `patchProp` | матеріал пропів, від якого успадковують тайли |

## Головні виміряні факти

- Модель `story-rombs-gd` (`story-8-frames-*`): 46 861 тайл, 2 213 груп, 8 кадрів;
  група живе рівно в одному кадрі. Розмір групи: медіана 12, p90 48, max 938.
  Межі в source units: x 89..1787, y 147..760; медіана `tile.s` = 4.475, `gridSize` 3.
- Обидва проєкти на `three@0.186.1` (Tilecraft — точна версія і import map;
  Ultra Water — точна з T0).
- `WaterQuery`: ліміт 512 точок, `Floaters`: 28 тіл — для тайлів не годиться,
  звідси GPU-симуляція (spec.md §5).
- `waterAt` = 5× `waterDisplacement`; per-vertex оцінка на ~1M вершин відкинута як
  задорога — вибірка на тайл, не на вершину (spec.md §6.1).
- Базові цифри бенчмарку сцени — README.md, таблиця Performance (Flotsam 4.62 мс).

### Фаза T0 (2026-11-02), відповіді на spec.md §11

- **П1. Records.** `compiled.records[i].kind`: `'instances'` (polygon/square/circle,
  `mesh` — `InstancedMesh`, тайл ← `mesh.userData.instanceSources[i].tileIndex`, `elevation`
  явно) або `'road'` (LCR `Mesh`, `runRanges` = `identifyRuns(...)`: `firstVertex`,
  `vertexCount` у просторі сирих LCR-вершин + `sourceRef.{groupId, frameId, tileIndices}`).
  Обидва мають `layerIndex`, `frameId`, `hasGeometry`. Кожен кадр — окремий record: hibrid
  дає 8 instances (шар 6) + 8 road (шар 5). `mesh.position.y` road = elevation шару.
- **П2. `sourceOwners`** = індекс тайла в `layer.tiles` (LCR-писар кладе `p.tileIndex`;
  коментар у `polyline-lcr.js:198` про «індекс sample-точки» застарів). На hibrid:
  0 вершин з owner −1, 0 вершин з owner поза своїм run (з 266 350). Медіана
  |зміщення від owner| ≈ 0.9 радіуса тайла, максимум 1.6 м — хвости мазків, де ширина
  береться з наступної точки й радіус тайла ≈ 0. Fallback «найближчий тайл run» лишено,
  він не спрацював жодного разу.
- **П3.** `loadFixture` знаходить `.pw-probe/story-rombs-gd.json` лише з плагіном
  `tilecraft-asset-urls` у `vite.config.js`: Vite переписує `new URL('../', import.meta.url)`
  в абсолютний шлях **без** кінцевого `/`, і фікстура резолвилась на каталог вище
  (HTML-fallback замість JSON). Плагін у файлах Tilecraft лишає резолв браузеру.
- **П4.** Один three: `compiled.root instanceof THREE.Group` = true (`dedupe`), версія
  `0.186.1` в обох; попередження `Multiple instances of Three.js` немає.
- **П5.** Згори поле збігається з `shell/?src=story-8-frames-hibrid&camera=top`: ті самі
  8 сцен, порядок, орієнтація, кольори. У Tilecraft є ще фон-аура кадрів і синя смуга —
  кадрові ефекти, не records (сума тайлів records = 46 861 = 23 183 polyline + 23 678 polygon).
- Компіляція hibrid: ~1.1 с `compileScene` + ~0.15 с `collectTileRest` (AMD 890M).
  Rest: 1 105 runs, медіана радіуса тайла 0.19 м, товщина polyline-призми 0.32 м.
  Кадр 2: 3 978 тайлів, 153 групи (збігається з лічильником кадрів Tilecraft).
- **Імпорт Tilecraft — через `/@fs/<TILECRAFT_ROOT>/…` у рантаймі, не alias `@tilecraft`.**
  Літеральний імпорт через alias Rollup бандлить у `vite build` (і падає без
  `TILECRAFT_ROOT`). `define __TILECRAFT_ROOT__` = '' у build → список джерел неактивний,
  build зелений незалежно від Tilecraft.
- **Розміщення:** від цілі шоту Flotsam (берег + 45 м) назовні по тому ж азимуту кроком
  5 м, доки дно під центром і 8 точками на колі радіуса поля глибше 5 м. Для story при
  0.05 м/su центр ≈ (327, −342), поле 85×31 м. Азимут береться один раз — зміна сонця
  поле не рухає.
- **Бенчмарк `tiles=none` на цій машині (AMD 890M, headless Chromium)** — шум 19–26 мс
  на Flotsam, ±0.05 мс тут не перевіряється: без теми 18.9–20.5, з темою 19.7–26.3 (по 6
  прогонів). Структурно з `tiles=none` додано лише порожню `Group` у сцені й згорнуту
  папку GUI. Цифри README (RTX 3060) — перевірка власника.

## НЕЗАКРИТЕ — почни звідси

Фази по порядку. Guard для всіх фаз: `npm run build` зелений; бенчмарк наявних
шотів з `tiles=none` у межах ±0.05 мс від README. `INVARIANTS.md` у репозиторії
немає.

~~1. **T0 — завантажувач і статичне поле** (spec.md §3, §4, §11, §6.5 — шот `Tiles`).
   Контракт: `vite.config.js` (alias `@tilecraft`, `fs.allow`, `dedupe: ['three']`),
   точна `three@0.186.1`; динамічний імпорт `thickness-scale.js` → `polyline-lcr.js`
   → core-модулів; ланцюжок §3.4; `tileRest.js` знімає rest обох конвеєрів; поле
   малюється статично на y=0 матеріалом пропів; GUI-папка `Tiles` (source, frame,
   статус); шот камери `Tiles`; відповіді на П1–П5 записані в «Головні виміряні факти».
   Probe:
   - **qa:open:** `http://localhost:5199/?tiles=story-8-frames-hibrid`
   - **qa:action:** camera → `Tiles`.
   - **qa:inspect:** поле на воді, рядок статусу в папці `Tiles`, консоль.
   - **qa:expected:** статус `46861 тайлів · 2213 груп · polygon + polyline`; згори
     малюнок збігається зі скриншотом Tilecraft `shell/?src=story-8-frames-hibrid`
     (П5); у консолі немає `Multiple instances of Three.js`.
   Другий probe: `?tiles=none` — сцена і цифри бенчмарку як до теми.~~ — ЗАКРИТО 2026-11-02.
   Відхилення від контракту: alias `@tilecraft` не заведено (імпорт через `/@fs/`, див.
   факти); статус англійською, як увесь GUI (`46861 tiles · 2213 groups · polygon + polyline`).
   Бенчмарк ±0.05 мс від README на RTX 3060 не перевірено — лише шум AMD 890M.

2. **T1 — матеріал стану і кінематика** (spec.md §4.2, §5.1, §7.1).
   Контракт: rest-текстури, атрибути `aTile`/`aOffset` (мапа owner за П2 або
   fallback найближчого тайла); `TileMaterial` читає стан за `gl_InstanceID` / `aTile`;
   простий прохід пише висоту й нахил прямо з `waterAt` (без інерції). Обидва
   конвеєри лежать на хвилях; CPU не переписує жодної матриці чи нормалі.
   Probe:
   - **qa:open:** `http://localhost:5199/?tiles=story-8-frames-hibrid`
   - **qa:action:** camera → `Tiles`, `wind` у максимум.
   - **qa:inspect:** стрічки polyline і polygon-тайли на гребенях.
   - **qa:expected:** тайли піднімаються й нахиляються разом з хвилею; жодна
     polyline-стрічка не має розриву між сусідніми тайлами; Performance-панель
     показує, що CPU-час кадру не зріс більше ніж на 0.5 мс.

3. **T2 — динаміка вертикалі й режим anchored** (spec.md §6.1–§6.3 anchored, §8 без `mode`/`windage`).
   Контракт: `TileSim` — ping-pong MRT (4 attachments), 4 вибірки на тайл, сили й
   момент як у `floaters.integrate`, підкроки ≤8, клампи, NaN → rest; anchored-пружина
   + орбіта; GUI `density`, `buoyancy`, `drag`, `angularDrag`, `orbit`, `anchorPeriod`,
   `reset`.
   Probe (критерії 3 і 6 spec.md §12):
   - **qa:open:** `http://localhost:5199/?tiles=story-8-frames-polygon`
   - **qa:action:** camera → `Tiles`; `density` 900, потім 200; залишити на 5 хв.
   - **qa:inspect:** осадка тайлів крізь воду; малюнок після 5 хв.
   - **qa:expected:** при 900 тайли занурені помітно глибше, ніж при 200; через 5 хв
     малюнок читається, жоден тайл не відійшов від rest далі ніж на 2× орбіту.

4. **T3 — drift і перемикання** (spec.md §6.3 drift, §6.4, §8 `mode`/`windage`, URL-стан).
   Контракт: прохід run-ів (`uRun`), дрейф polygon-тайлів і run-ів, `windage`,
   м'яка стінка `driftRadius`, плавне `drift ↔ anchored`, стан GUI у URL `tiles*`.
   Probe (критерії 4 і 5):
   - **qa:open:** `http://localhost:5199/?tiles=story-8-frames-hibrid&tilesMode=drift`
   - **qa:action:** почекати 2 хв, потім `mode` → `anchored`.
   - **qa:inspect:** розподіл тайлів і стрічок; час повернення.
   - **qa:expected:** за 2 хв polygon-тайли розійшлись, стрічки цілі (розрив ≤ 1
     діаметр); після перемикання малюнок повертається за ≤ 12 с (3 × 4 с) без стрибка.

5. **T4 — тіні, відбиття, bounds, продуктивність** (spec.md §7.2, §7.3, §10).
   Контракт: поле у floater shadow (depth-матеріал з чанком стану), planar reflection,
   ручні bounds; бенчмарк шоту `Tiles`; телефонний профіль.
   Probe (критерії 7 і 8):
   - **qa:open:** `http://localhost:5199/?tiles=story-8-frames-hibrid`
   - **qa:action:** camera → `Tiles`, потім `Golden hour`; `Run benchmark`.
   - **qa:inspect:** тінь тайлів на воді, відбиття, рядок бенчмарку.
   - **qa:expected:** тайли відкидають тінь і видні у відбитті; кадр шоту `Tiles`
     ≤ 6.0 мс, прохід симуляції ≤ 0.4 мс; `?mobile` на Nord 4 — 60 fps.
   Нове правило для `INVARIANTS.md` (якщо тема його заведе): «`tiles=none` не змінює
   цифр бенчмарку».

6. **T5 — промоція групи в CPU-тіло** (spec.md §9).
   Контракт: клік по тайлу → група стає `Body` (≤8 семплів), ховається з поля,
   дає `impacts`; при переповненні 28 тіл найстаріша промоція повертається в поле.
   Probe:
   - **qa:open:** `http://localhost:5199/?tiles=story-8-frames-hibrid`
   - **qa:action:** camera → `Tiles`, клік по стрічці, потім `drop`.
   - **qa:inspect:** вибрана група, кола хвиль у точці падіння.
   - **qa:expected:** група відділяється від поля й плаває як ящик; при падінні
     з'являються кола й бризки; решта поля без змін.

### Відкриті питання

- ~~**П2 (spec.md §11):** що саме лежить у `sourceOwners`.~~ — вирішено в T0: індекс тайла
  в `layer.tiles`.
- ~~**Розміщення поля:** правило зсуву від острова не визначало напрямок і крок.~~ —
  вирішено в T0 (див. «Головні виміряні факти»).
- **Тінь:** чи вистачить 1024² карти на поле 85 м (~8 см/тексель) для тайлів 0.33 м —
  з'ясовується в T4.
- ~~**`npm run build` з динамічним імпортом `@tilecraft`.**~~ — вирішено в T0: імпорт через
  `/@fs/` у рантаймі, alias не заведено (див. «Головні виміряні факти»).
- **Файл спеки названо `spec.md`, а не `*-SPEC.md`** — конвенція handoff-скілів;
  перейменування на рішення власника.
