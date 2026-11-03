# Handoff: frame-drag — перенесення фреймів по воді й рельєфу

Стан на 2026-11-03. Гілка `master`. FD1 прийнято власником через
`handoff:next`; код, перевірки й QA закриваються комітом цієї фази.
Tile-floaters T0–T5 закриті (актуальний стан — у базовому HANDOFF).

Спека: [FRAME-DRAG-SPEC.md](../../FRAME-DRAG-SPEC.md) (далі — «спека»). Базова тема:
tile-floaters ([HANDOFF.md](../../HANDOFF.md), [spec.md](../../spec.md)) — її код
(`src/tiles/`) ця тема розширює. Tilecraft лише читається (spec.md §1).

> **Далі:** FD2 — picking і drag на воді. Спиратися на `TileFrames`, `moveFrame` / `releaseFrame` та спільну pose polygon/run з FD1. Заморожування drift-конфігурації, пригашення орбіти та арбітраж із dblclick T5 ще не реалізовані.

Локальний стенд: `http://localhost:5199/?tiles=story-8-frames-hibrid`; правило
стенду — `AGENTS.md` → «Локальний стенд».

## Що зроблено і працює

FD1 прийнято 2026-11-03. Ручні сценарії: [QA.md](QA.md), QA-FD1-1…8.

| файл FD1 | контракт |
|---|---|
| `src/tiles/TileFrames.js` | типізована ідентичність id (`2` ≠ `"2"`), синтетичний `UNFRAMED`, щільний frameIndex; world pivot, derived offset, placed/inherited |
| `src/tiles/TileField.js` | `frameRegistry.get(frameId)`, `moveFrame(frameId,x,z)`, `releaseFrame(frameId)`; mesh/proxy position, повний reset, pose через filter/scale/yaw/place |
| `src/tiles/TileSim.js` | frameIndex у `rest1.w >> 2` (bit 0 — polyline, bit 1 — hidden T5); pose у water queries тайлів і run, per-frame mode через state3.z, driftRadius від pivot |
| `src/tiles/TilePromotion.js`, `tilePromotionGeometry.js` | picking-проксі й CPU snapshot враховують трансляцію фрейму; групи розрізняються за frameIndex |
| `scripts/test-frame-pose.mjs`, `scripts/probe-frame-pose.mjs` | offline-ідентичність/координати та WebGL/GUI, uniform boundary і texture fallback |

Важливо для FD2: `moveFrame` зараз лише вмикає локальний anchored біля нової pose.
Він не фіксує рознесену drift-конфігурацію й не заморожує горизонтальні стани;
це робота FD2 за спекою §5. Перебудова filter/scale зберігає pose за id, але
пересоздає TileSim і обнуляє його локальні стани. Зміна source обнуляє реєстр.
URL не зберігає pose; reload відновлює layout.

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

2. **FD2 — picking і drag на воді** (спека §2–§5; крок 2 §12).
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

3. **FD3 — контакт із землею для polygon** (спека §7, §8 без polyline; крок 3 §12).
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
  T5 не перехоплює click/pointerdown. FD2 має не починати drag на другому натисканні подвійного кліку; після справжнього drag споживати dblclick через preventDefault() або canPromote gate. Наявний guard T5 відкидає dblclick протягом 600 мс після руху >5 CSS px; це не готовий FD2-арбітр.
- **Перетин FD5 з T4.** T4 закрито. FD1 синхронізує pose мешів/тіньових проксі
  та bounds через matrixWorld; перевірка контактів і візуальної тіні на суші ще FD5.
- **Uniform і sampler-бюджет виміряно в FD1:** див. факти вище. Після додавання
  TerrainContact повторно перевірити linked samplers; вихідна оцінка 12 була занижена.
- **Вимірювані пороги picking** (p95 ≤8 / ≤20 мс) — попередні, уточнити в FD2.
