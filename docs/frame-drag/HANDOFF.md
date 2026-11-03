# Handoff: frame-drag — перенесення фреймів по воді й рельєфу

Стан на 2026-11-02. Гілка `master`. Спека v0.2 закомічена (`684b502`);
реалізацію не почато.

Спека: [FRAME-DRAG-SPEC.md](../../FRAME-DRAG-SPEC.md) (далі — «спека»). Базова тема:
tile-floaters ([HANDOFF.md](../../HANDOFF.md), [spec.md](../../spec.md)) — її код
(`src/tiles/`) ця тема розширює. Tilecraft лише читається (spec.md §1).

> **Далі:** T4 вже прийнято власником; за новою прямою вказівкою зараз реалізовано T5 tile-floaters (подвійний клік), передано на рев’ю без закриття фази. FD1 ще не реалізовано; одиночний клік/drag лишаються за цією темою.

Локальний стенд: `http://localhost:5199/?tiles=story-8-frames-hibrid`; правило
стенду — `AGENTS.md` → «Локальний стенд».

## Що зроблено і працює

Нічого в цій темі. Основа з tile-floaters, на яку спирається FD1:

| файл | що вже є |
|---|---|
| `src/tiles/tileRest.js` | rest обох конвеєрів; частини (`polygon[]`, `polyline[]`) вже по одному фрейму (`record.frameId`); `flags` bit 0 — polyline |
| `src/tiles/TileSim.js` | MRT стану, run-прохід, anchored/drift з конвенцією швидкості в `state3.z`, нахил ≤20° |
| `src/tiles/TileMaterial.js` | позиції тайлів із state у vertex shader; меші в `group` поля |
| `src/tiles/TileField.js` | `load` / `rebuild` / `place` / `reset`; `frames` — список frameId моделі |
| `src/water/WaterQuery.js` | асинхронний readback через `readRenderTargetPixelsAsync` |
| `src/scene/terrainGeometry.js` | меш острова `PlaneGeometry(2400, 384×384)`, крок 6.25 м |

## Головні виміряні факти

Поки немає. Відомо з коду на 2026-11-02 (не виміряно, перевірити в FD1/FD3):

- TileSim за оцінкою використовує 12 fragment samplers (спека §9).
- Hybrid: 46 861 тайл, 8 фреймів, max довжина polyline-тайла 0.332 м (HANDOFF tile-floaters).

## НЕЗАКРИТЕ — почни звідси

Фази по порядку. Guard для всіх фаз: `npm run build` зелений;
`node scripts/probe-tiles.mjs` і `node scripts/probe-tiles-drift.mjs` PASS
(dev-сервер має працювати); `?tiles=none` — без picking pass, контактних ресурсів
і слухачів (спека §9), бенчмарк шоту без змін. `INVARIANTS.md` у репозиторії немає.

1. **FD1 — реєстр фреймів і pose** (спека §3, §5, §6, §10; крок 1 §12).
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
- **Перетин FD5 з T4.** Що з тіней/відбиття/bounds T4 уже враховує pose фрейму, а що
  доведеться змінити, — видно лише після закриття T4.
- **Бюджет uniform-векторів для `uFramePose[N]`** у фрагментному шейдері TileSim поруч
  з uniform-ами води: виміряти в FD1; при нестачі — fallback-текстура (спека §6).
- **Вимірювані пороги picking** (p95 ≤8 / ≤20 мс) — попередні, уточнити в FD2.
