# Handoff: frame-drag — перенесення фреймів по воді й рельєфу

Стан на 2026-11-04. Гілка `master`. FD1 — `6f54eab`, FD2 — `18ae7cc`.
FD3 прийнято власником через `handoff:next` 2026-11-04; реалізація, перевірки
та документи входять у коміт закриття FD3. Бюджети picking / CPU лишаються
відкритими для FD5. Tile-floaters T0–T5 закриті (базовий HANDOFF).

Спека: [FRAME-DRAG-SPEC.md](../../FRAME-DRAG-SPEC.md) (далі — «спека»). Базова тема:
tile-floaters ([HANDOFF.md](../../HANDOFF.md), [spec.md](../../spec.md)) — її код
(`src/tiles/`) ця тема розширює. Tilecraft лише читається (spec.md §1).

> **Далі:** FD4 — polyline на суші, порядок перекриття та заборона схилів >55° (спека §8). Розширити нижній footprint/contact у `tileRest.js`, `tileContact.js`, `TileSim.js` на polyline, зберігши спільну горизонталь run і шви на плоскому піску. У `TileInteraction.js` перевіряти крутизну по всій зайнятій контактній області, з останньою валідною ціллю й маркером; додати placement rank для opaque polygonOffset / transparent renderOrder. Наявні state1.zw вже зайняті контактом; не повертати туди angular velocity. Picking/CPU-бюджети FD2 лишаються для FD5.

Локальний стенд: `http://localhost:5199/?tiles=story-8-frames-hibrid`; правило
стенду — `AGENTS.md` → «Локальний стенд».

## Що зроблено і працює

FD1 і FD2 прийнято 2026-11-03, FD3 — 2026-11-04. Ручні сценарії:
[QA.md](QA.md), QA-FD3-1…5, QA-FD2-1…9 та QA-FD1-1…8.
Прийняття FD3 не закриває бюджети продуктивності FD5.

| файл FD3 | контракт |
|---|---|
| `src/scene/TerrainContact.js` | 385² Float32 висот без повторного islandHeight між вузлами; CPU + R32F NearestFilter; трикутна інтерполяція/нормаль по діагоналі PlaneGeometry; raycast крокуванням по комірках, включно з невидимим дном |
| `src/scene/terrain.js`, `src/main.js`, `TileField.js` | передається та сама terrain geometry; контакт створюється лише для непорожнього поля, dispose на clear/rebuild/source=none |
| `src/tiles/tileRest.js`, `tileContact.js` | convex hull нижньої грані polygon після instance scale/yaw; вершини у вертикальних блоках rest0 без додаткового sampler-а; точний максимум h−bottomPlane за кутами, перетинами ребер сітки та внутрішніми вузлами |
| `src/tiles/TileSim.js` | polygon: контакт inherited/placed/held, жорсткий floor після остаточних XZ/tilt; latch 2/5 см, blend 200 мс; приглушення orbit/drift/windage/вертикальної швидкості; вода не підтримує тайл над сухою землею |
| `src/tiles/tileTilt.js`, `TileMaterial.js`, `tilePromotionGeometry.js` | спільний rotation vector / Rodrigues замість Rz·Rx; вода ≤20°, контакт ≤55°; render/ID/контури/shadow proxy/CPU snapshot узгоджені; декоративний offset на опорі обмежується 1 мм |
| `src/tiles/TileInteraction.js` | SurfaceCursor вибирає ближчий перетин води/землі, terrain-ray враховує висоту захопленої поверхні; water query лишається асинхронною |
| `src/tiles/tileBounds.js` | render envelope ±256 м замість ±64 м; culling sphere враховує цей самий ліміт |
| `scripts/test-terrain-contact.mjs`, `scripts/probe-terrain-contact.mjs` | незалежний CPU oracle по реальних трикутниках; GPU висота/нормаль, внутрішній горб, схил, дно, відрив хвилею, pose fallback, реальний DOM drag, берег та unload |

**Новий layout стану:** `state1.xy` — горизонтальний rotation vector;
`state1.z` — blend опори, `state1.w` — latch. Angular velocity більше не
зберігається: нахил експоненційно прямує до нормалі. `state3` зберіг FD2 history,
mode і hold/release; `state3.y` тепер пам'ятає фактичний orbital gain із контактом.
Перший блок `rest0` лишив стару адресацію 512×sim.height; блок +1 — кількість
вершин footprint, блоки +2… — vec3 нижніх вершин. У polyline footprint поки немає:
FD3 свідомо лишає його на водному шляху, контакт polyline — FD4.

| файл FD2 | контракт |
|---|---|
| `src/tiles/TilePicker.js` | ID+world-height у float target 13×13, спільний `patchTileMaterial`; sync down, async hover; opacity/vertex alpha <0.1 не дає hit; opaque terrain/props пишуть depth; CSS/DPR/viewport і nearest pixel |
| `src/tiles/TileInteraction.js` | `TileInteraction` і початковий water-only `SurfaceCursor` (terrain додано у FD3); capture-арбітр перед OrbitControls, пороги 5/10 CSS px, tau=50 мс, settling ≤150 мс, другий touch передає обидва pointers камері; системне скасування, контури та T5 gate |
| `src/tiles/TileFrames.js`, `TileSim.js` | `held` / `holdAge`; `pose.w`=0 для вільного, 1…2 для hold із fade 125 мс; XZ і швидкості tile/run утримуються без snapshot; висота/нахил активні; negative `state3.w` — 125 мс повернення strip до run після release |
| `src/tiles/TileField.js`, `src/main.js` | interaction lifecycle на build/clear/reset/place; GUI `selectedFrame`, «Відпустити у дрейф»; release знімає hold; scale/filter/source/yaw/place скасовують жест |
| `src/water/WaterQuery.js` | owned query має `dispose`; late reads ігноруються, ресурси звільняються після завершення in-flight PBO |
| `scripts/probe-frame-drag.mjs` | реальні mouse/touch DOM/CDP-жести, 60 с drift, обидва конвеєри всіх 8 фреймів, hold/release/blur, камера, dblclick, unload, desktop/mobile profile і CPU timings |

| файл FD1 | контракт |
|---|---|
| `src/tiles/TileFrames.js` | типізована ідентичність id (`2` ≠ `"2"`), синтетичний `UNFRAMED`, щільний frameIndex; world pivot, derived offset, placed/inherited |
| `src/tiles/TileField.js` | `frameRegistry.get(frameId)`, `moveFrame(frameId,x,z)`, `releaseFrame(frameId)`; mesh/proxy position, повний reset, pose через filter/scale/yaw/place |
| `src/tiles/TileSim.js` | frameIndex у `rest1.w >> 2` (bit 0 — polyline, bit 1 — hidden T5); pose у water queries тайлів і run, per-frame mode через state3.z, driftRadius від pivot |
| `src/tiles/TilePromotion.js`, `tilePromotionGeometry.js` | picking-проксі й CPU snapshot враховують трансляцію фрейму; групи розрізняються за frameIndex |
| `scripts/test-frame-pose.mjs`, `scripts/probe-frame-pose.mjs` | offline-ідентичність/координати та WebGL/GUI, uniform boundary і texture fallback |

Жест FD2 вмикає hold при подоланні порога й після up лишає захоплену
конфігурацію `placed`; reset або «Відпустити у дрейф» знімають hold.
Сам програмний `moveFrame` без попереднього hold, як у FD1, лише вмикає
локальний anchored біля нової pose. Перебудова filter/scale зберігає pose за id,
але пересоздає TileSim і обнуляє локальні стани та hold. Зміна source обнуляє
реєстр. URL не зберігає pose; reload відновлює layout.
Після FD3 SurfaceCursor використовує точний terrain-ray та асинхронну water
query, зберігаючи grab offset. Обмеження цілі зараз консервативне — `ISLAND_SIZE` з відступом загального `field.radius`; точна зайнята
область і крутизна — FD4.

Основа з tile-floaters:

| файл | що вже є |
|---|---|
| `src/tiles/tileRest.js` | rest обох конвеєрів; частини (`polygon[]`, `polyline[]`) вже по одному фрейму (`record.frameId`); `flags` bit 0 — polyline |
| `src/tiles/TileSim.js` | MRT стану, run-прохід, anchored/drift з конвенцією швидкості в `state3.z`, нахил ≤20° |
| `src/tiles/TileMaterial.js` | позиції тайлів із state у vertex shader; меші в `group` поля |
| `src/tiles/TileField.js` | `load` / `rebuild` / `place` / `reset`; `frames` — список frameId моделі |
| `src/water/WaterQuery.js` | асинхронний readback через `readRenderTargetPixelsAsync` |
| `src/scene/terrainGeometry.js` | меш острова `PlaneGeometry(2400, 384×384)`, крок 6.25 м |

## Головні виміряні факти

FD3, AMD Radeon 890M / Chromium WebGL, 2026-11-04:

- Guard: build, `probe-tiles.mjs`, `probe-tiles-drift.mjs` — PASS;
  offline FD1/T4/T5 і terrain — PASS. Drift: 124.812 с / 4620 кадрів,
  nonfinite=0, 218196 стиків, maxSeam=0; recovery error=0.00000661 м.
- CPU oracle: 70 перетинів справжніх трикутників; height error≤6.40e-14 м,
  oblique ray error≤1.43e-14 м. GPU/CPU у 512 точках: height error≤0.000042208 м,
  normal error≤7.28e-8. Карта має 148225 вузлів.
- FD3 probe — PASS на desktop і mobile-профілі цього ж GPU: внутрішній пік
  5 м дає перший центр 5.105000019 м, мінімальний зазор ≥0.0049967 м;
  схил 30° → 29.99950° / 29.99875°; на опорі horizontal speed=0.
  Sinking fixture починається над дном −42 м із buoyancy=0.3 й зупиняється
  центром на −41.89500046 м; floor працює нижче render cutoff −34 м.
  Підйом води на 0.3 м відриває тайл, blend повертається до 0.
- Реальний polygon source: 46861 тайл; усі перевірені нижні кути
  ≥terrain+0.006023 м. Один фрейм на березі одночасно має 2395 wet і 1579 contact
  (4 у переході; числа залежать від хвилі). DOM drag на суші: 12.00119 м,
  grab error=0.875 CSS px, camera movement=0; terrain ray error=1.11e-14 м.
- **Linked tile samplers із контактом: 14 uniform / 15 texture fallback**;
  новий sampler лише для висот острова. Render/ID/контури без terrain sampler.
  Frame texture fallback перевірено в mobile-профілі на цьому GPU;
  реальний телефон і hardware-budget PASS не заявляються.
- Регресійна FD2 probe з `FD2_SKIP_SOAK=1` — PASS: polygon/polyline усіх 8
  фреймів, hold/release, camera, touch/pinch, blur, dblclick, unload; `errors=[]`.
  Це не новий 60-секундний soak. Grab error=1.970 CSS px;
  warm pick p50/p95=2.70/3.90 мс; CPU interaction=0.20/0.40 мс за 67 кадрами;
  release jump=0.00000261 м. Ці короткі виміри не закривають бюджети FD5.
- **Уточнення перевірок FD3:** T4 fixture тепер перевіряє render clamp за
  `TILE_VERTICAL_LIMIT`, а не старим літералом 64; T5 незалежний quaternion
  oracle перевіряє rotation vector замість попереднього Rx→Rz. Це зміна
  контракту фази, а не регресія; історичні факти FD1/FD2 нижче збережені.

FD2, AMD Radeon 890M / Chromium WebGL, 2026-11-03:

- Guard: build, `probe-tiles.mjs`, `probe-tiles-drift.mjs` — PASS;
  offline FD1/T4/T5 — PASS. Drift guard: 121.35 с / 4267 кадрів,
  nonfinite=0, 218196 стиків, maxSeam=0; recovery error=0.00000744 м.
- Probe FD2: PASS після 60.00 с drift, polygon і polyline всіх 8 фреймів;
  XZ hold тайлів=0, run-state change=0, camera movement=0;
  grab error=2.885 CSS px. Release при dt=1e-7: max jump=0.00000197 м.
  Right pan, empty-space orbit, другий палець/pinch, T5 dblclick, blur,
  source=none під час drag та reset — PASS, `errors=[]`.
- Desktop 1400×1000, 25 теплих pick-запитів: p50=6.50 / p95=14.40 мс.
  CPU interaction за 57 кадрами drag/settling: p50=0.20 / p95=0.70 мс.
  **Бюджети 8 мс pick і 0.5 мс/кадр CPU не виконані**, залишені для FD5;
  погодження FD2 не змінює пороги й не є hardware-budget PASS.
- Mobile-профіль на тому самому desktop GPU, CSS 480×850, DPR=2,
  drawing width=576: pick p50=3.60 / p95=15.10 мс. Реальний телефон і холодний
  перший pick не атестовані; mobile-бюджет 20 мс не підтверджений.
- **Спростовано в FD2:** `2213 groups` у статусі — групи моделі, а не draw calls:
  видимих tile-мешів 16. Спробу об'єднати ID до 8 мешів прибрано: вона додавала
  47 547 136 байтів копії геометрії. Остаточні ID та контури мають 16 частин,
  спільні geometry / instance attributes, додаткової копії геометрії немає.
- Freeze не додає sampler-ів: користується `pose.w` наявного uniform/texture
  шляху. Зберегти packed frameIndex і семантику `state3` під час FD3.

Перевірено в FD1 на desktop WebGL 2026-11-03 (це не mobile/hardware-budget PASS):

- Guard: `npm run build`, `node scripts/probe-tiles.mjs`,
  `node scripts/probe-tiles-drift.mjs` — PASS. Offline FD1/T4/T5 — PASS;
  `node scripts/probe-frame-pose.mjs` — PASS, `errors=[]`.
- Hybrid: 46 861 тайл; перенос третього фрейму (id `4`) рухає 2 його частини,
  зміна чужих мешів / GPU-станів у момент виклику — 0. Instance-буфери не переписані.
- World pivot після fieldYaw=45, filter, масштабу 0.06 і повторного place —
  без зміни; при place +40 м inherited pivot зміщується на 40 м, placed — на 0.
- WaterQuery після переносу й yaw: похибка тайлів ≤0.000000060 м,
  run ≤0.000000004 м. Placed XZ на flat water після 10 с — 0,
  inherited X — 4.68957 м; mode transitions: XZ <1e-8 м, швидкість <1.2e-7 м/с.
- Drift guard: 131.48 с / 6 510 кадрів, nonfinite=0; 218 196 стиків,
  maxSeam=0; після anchored recovery anchor error=0.00000696 м.
- **Уточнення sampler-бюджету спеки §9:** linked tile pass має **13**, а не 12
  sampler-ів; із frame texture — 14. Run pass — 9 / 10. TerrainContact додасть
  ще один: очікувано 14 / 15, повторно виміряти у FD3/FD5.
- MAX_FRAGMENT_UNIFORM_VECTORS=1024. `uFramePose` + `uFramePivot` займають по
  2 вектори на фрейм; резерв інших uniform-ів — 160, threshold=432.
  Перевірені 2 і 432 фрейми в uniform-шляху (на межі консервативно 917/1024
  активних векторів), 433 — у texture fallback (2 RGBA texels/frame).
  Формула threshold у TileSim залежить від реального GPU limit.
- Bounds лишаються локальними sphere з T4; `mesh.matrixWorld` додає pose.
  Shadow proxy отримує ту саму mesh.position; fieldShadowBody враховує її.
  Мобільний профіль як і раніше без field shadow. Візуальні контакти/тіні на суші — FD5.
- **Спростовано:** падіння старої `probe-tiles.mjs` на first vy — не регресія FD1.
  На коді до FD1: first=1.6372680664 проти очікування 0.04291875; oracle був від
  старого Archimedes, fixture успадковувала bathymetry і додавала 2 м у кожну
  з трьох FFT-каскад. Тепер незалежний flat/deep fixture з сумарним step 2 м і
  аналітичним damped-step oracle: 0.7509651184 проти 0.7509650353 м/с.

Команди browser-проб (стенд уже працює):

```powershell
$env:PLAYWRIGHT_MODULE = 'D:/work/js-games/ua-dream/tilecraft/node_modules/playwright/index.mjs'
node scripts/probe-tiles.mjs
node scripts/probe-tiles-drift.mjs
node scripts/probe-frame-pose.mjs
node scripts/probe-frame-drag.mjs
node scripts/probe-terrain-contact.mjs
node scripts/test-terrain-contact.mjs
```

## НЕЗАКРИТЕ — почни звідси

Фази по порядку. Guard для всіх фаз: `npm run build` зелений;
`node scripts/probe-tiles.mjs` і `node scripts/probe-tiles-drift.mjs` PASS
(dev-сервер має працювати); `?tiles=none` — без picking pass, контактних ресурсів
і слухачів (спека §9), бенчмарк шоту без змін. `INVARIANTS.md` у репозиторії немає.

~~1. **FD1 — реєстр фреймів і pose** (спека §3, §5, §6, §10; крок 1 §12).~~ — ЗАКРИТО власником через `handoff:next` 2026-11-03.
   Контракт: `frameId → frameIndex` з синтетичним фреймом для тайлів без id;
   pose `(x,z)` у світі, похідна трансляція в осях поля → `mesh.position` і
   `uniform vec4 uFramePose[N]`; frameIndex у бітах `rest1.w`; per-frame режим
   placed/inherited через `state3.z`; driftRadius від frame anchor; bounds з pose;
   повний reset; frame filter зберігає pose; зміна `fieldYaw` / розміщення поля
   лишає placed-фрейми у світі. Програмний API (без жестів):
   `app.tiles.moveFrame(frameId, x, z)`, `app.tiles.releaseFrame(frameId)`.
   Probe:
   - **qa:open:** `http://localhost:5199/?tiles=story-8-frames-hibrid`
   - **qa:action:** camera → `Tiles`; у консолі `app.tiles.moveFrame(<id 3-го фрейму>, x+20, z)`; потім `fieldYaw` → 45; потім `Tiles → reset`.
   - **qa:inspect:** третій фрейм і сусідні фрейми; позиція фрейму у світі після повороту поля.
   - **qa:expected:** переїхав лише третій фрейм, polygon і polyline разом, інші не зсунулися ні на см; після `fieldYaw` 45 його pivot у тій самій світовій точці (малюнок повернутий навколо pivot); reset повертає початкову розкладку й inherited.
   Нова проба: `scripts/probe-frame-pose.mjs` — переміщення одного фрейму, незмінність станів інших, fieldYaw, frame filter, reset.

~~2. **FD2 — picking і drag на воді** (спека §2–§5; крок 2 §12).~~ — ЗАКРИТО власником через `handoff:next` 2026-11-03; бюджети продуктивності лишаються відкритими для FD5.
   Контракт: ID pass зі спільним чанком деформації; синхронний pick 13×13 на
   `pointerdown` у capture-фазі, hit → `stopImmediatePropagation`; async hover;
   SurfaceCursor на воді (площина висоти захоплення + `WaterQuery`); заморожування
   горизонтального стану, гасіння орбіти 100–150 мс; згладжування 40–60 мс,
   доведення ≤150 мс; другий палець фіксує перенос і передає камері обидві точки;
   системне скасування; підсвічування фрейму.
   Probe:
   - **qa:open:** `http://localhost:5199/?tiles=story-8-frames-hibrid&tilesMode=drift`
   - **qa:action:** почекати 1 хв; лівою кнопкою схопити деталь фрейму й протягти 30 м по воді; потім тягнути з порожнього місця; на телефоні — те саме пальцем, під час drag торкнутися другим пальцем.
   - **qa:inspect:** точка захоплення відносно курсора; старт камери; рознесення деталей фрейму.
   - **qa:expected:** фрейм їде, деталь лишається під курсором (≤5 CSS px усталено); рознесений фрейм не збирається; на порожньому місці камера обертається одразу; права кнопка над фреймом — pan; другий палець фіксує фрейм і переходить у камеру без ривка; pick на down p95 ≤8 мс desktop.

~~3. **FD3 — контакт із землею для polygon** (спека §7, §8 без polyline; крок 3 §12).~~ — ЗАКРИТО власником через `handoff:next` 2026-11-04.
   Контракт: `TerrainContact` з 385² висот вершин (CPU + R32F `NearestFilter`),
   трикутна інтерполяція з діагоналлю `PlaneGeometry`, footprint-максимум;
   SurfaceCursor на суші; нахил від нормалі опори (переробка `tileTilt` /
   `surfaceTilt`, вода ≤20°, суша ≤55°); дно зупиняє занурення, зокрема нижче −34 м;
   береговий blend 2/5 см, 150–250 мс, жорсткий floor; `eta` лише де `eta > h`;
   контакт для всіх тайлів; край `ISLAND_SIZE` — межа drag.
   Probe:
   - **qa:open:** `http://localhost:5199/?tiles=story-8-frames-polygon`
   - **qa:action:** протягти фрейм на пляж так, щоб берегова лінія пройшла навскіс; потім на схил 30°; потім `buoyancy` → 0.3 над глибокою водою.
   - **qa:inspect:** межа вода/суша під фреймом; нахил плиток на схилі; занурені тайли.
   - **qa:expected:** частина фрейму плаває, частина стоїть на піску, без загального стрибка висоти; плитки на схилі нахилені, жодна не врізається в рельєф (проба: низ ≥ terrain − 1 мм); затонулі тайли лежать на дні, не крізь нього.
   Нова проба: `scripts/probe-terrain-contact.mjs` — CPU vs GPU висота, порівняння з вершинами меша, footprint-максимум, низ ≥ terrain.

4. **FD4 — polyline на суші, перекриття, крутизна** (спека §8 Polyline, «Порядок перекриття», схили >55°; крок 4 §12).
   Контракт: polyline укладається по тайлах у симуляції; перевірка довжини
   polyline-тайла при load (>1 м → попередження в статусі); `aSurfaceOffset` не
   вдруге поверх контакту; перекриття фреймів — `polygonOffset` (непрозорі) і
   `renderOrder` (прозорі) за рангом розміщення; схил >55° по всій області контакту
   → остання валідна ціль і маркер.
   Probe:
   - **qa:open:** `http://localhost:5199/?tiles=story-8-frames-hibrid`
   - **qa:action:** покласти фрейм на пагорб 10–45°; покласти другий фрейм внахлест на перший на плоскому піску при `waveScale` 0; тягнути фрейм на скелю гори.
   - **qa:inspect:** стрічки polyline на пагорбі; зона перекриття; маркер біля курсора.
   - **qa:expected:** стрічки повторюють профіль пагорба; внахлест зверху другий фрейм, без мерехтіння; стики polyline на піску ≤0.1 мм; на скелі фрейм зупиняється на останньому допустимому місці, маркер заборони видно.

5. **FD5 — рендер, lifecycle, виміри** (спека §9, §11 продуктивність; крок 5 §12).
   Контракт: відбиття, depth, тіні T4 і підсвічування коректні після переносу на
   сушу; unload / context lost / зміна source знімають capture і listeners,
   скасовують pending reads, звільняють ресурси; linked sampler counts записані;
   звіт p50/p95 CPU interaction і GPU контакт/pose на desktop і mobile.
   Probe:
   - **qa:open:** `http://localhost:5199/?tiles=story-8-frames-hibrid`
   - **qa:action:** перенести фрейм на пляж; camera → `Golden hour`; змінити source на `none` посеред drag; `Run benchmark`.
   - **qa:inspect:** відбиття й тінь фрейму на піску; консоль; рядок бенчмарку.
   - **qa:expected:** фрейм у відбитті й тіні там, де він лежить, а не на старому місці; після source=`none` жодних помилок і слухачів; CPU interaction ≤0.5 мс/кадр, GPU контакт/pose ≤1 мс на desktop.

### Відкриті питання

- **Жест T5 (tile-floaters), вирішено власником.** Одиночний клік по тайлу
  лишається за вибором/перенесенням фрейму; промоція групи в CPU-тіло (T5) переходить
  на **подвійний клік**, який власник явно погодив;
  T5 не перехоплює click/pointerdown. FD2 вже віддає друге натискання подвійного
  кліку T5, а після справжнього drag споживає dblclick і блокує `canPromote`
  протягом 600 мс. Перевірено реальним DOM dblclick: одне CPU-тіло, drag не починається.
- **Перетин FD5 з T4.** T4 закрито. FD1 синхронізує pose мешів/тіньових проксі
  та bounds через matrixWorld; перевірка контактів і візуальної тіні на суші ще FD5.
- **Uniform і sampler-бюджет:** FD1 дав 13/14 tile samplers без контакту;
  FD3 виміряв 14/15 із TerrainContact. Повторна атестація hardware/таймінгів — FD5;
  вихідна оцінка 12 у спеці була занижена.
- **Відкриті бюджети FD2 → FD5:** desktop pick p95=14.40 мс проти ≤8;
  CPU interaction p95=0.70 мс проти ≤0.5. Mobile-профіль на desktop GPU
  не замінює телефон; cold pick і справжній mobile p95 ще виміряти.
