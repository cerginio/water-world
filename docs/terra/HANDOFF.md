# Handoff: terra — карти острова й декорації в Story Quest

Стан на 2026-11-27. Фази з [ISLAND-MAPS-SPEC.md](../story-quest/ISLAND-MAPS-SPEC.md)
редакції 0.2 (далі — «спека»), доповнення до [STORY-QUEST-SPEC.md](../../STORY-QUEST-SPEC.md).
T1–T2 закриті й закомічені: профілі карт (`src/scene/maps.js`), `map` у контракті, рельєф бухти
(`src/scene/lagoonHeight.js`, профіль `lagoon`); декорацій ще немає.
QA — [QA.md](QA.md). Тема story-quest закрита (Q0–Q10), її факти в
[docs/story-quest/HANDOFF.md](../story-quest/HANDOFF.md) діють і тут.

> **Далі:** T3 — декорації бухти (п.3).

Локальний стенд: `http://localhost:5199/`; правило — `AGENTS.md` → «Локальний стенд».
Телефон — лише драфт Netlify `https://story-quest--edge-of-elements.netlify.app/`
(рядок «Деплой» у QA.md), сценарії для телефона — лише дотики.

## НЕЗАКРИТЕ — почни звідси

~~1. **T1. Профіль карти й `map` у контракті; `island` без змін.** Спека §2, §4.1,
   §4.3, §4.5, §5 п.1 (частина про сцену й URL).
   - Модуль профілів (`MAPS`, `pickMap(id)` → `island` для відсутнього/невідомого).
     Через профіль `island` іде все з §4.1: `islandHeight`, `storyAnchor`/`coast()`,
     `heroRock` (перешкода в bake, `uRock`, `Spray`, кадр «Скеля прибою»), `placeRocks`,
     `islandRadius`, кадри камер із променем від центру, `rig.ground`,
     `Floaters`/`TileField` `heightAt`, `ANCHOR.openSea`.
   - Сцена читає `?map=`; `scene.ready` → `{ story, fingerprint, map }`, `state.read` → `map`.
   - `sceneUrl`/`sceneHost.load` приймають `map`, `products/story-quest/main.js`
     зберігає `map` в URL поряд зі `story` і передає в iframe.
   - **Закриття.** Guard зелений (BOUNDARY-5, OWNER-3, TEX-1). Focused: `pickMap`,
     `sceneUrl({ map })`, `readState` з `map`. Чинні тести й проби на `island` — без
     зміни чисел: `cameraFlight.test`, `test-terrain-contact`, `shoreTextures.test`,
     `probe-story-embed`, `probe-story-states` (якорі `beach`/`shallow` (198.5, −207.3)
     і (219.6, −229.4)). Проба: `?map=foo` і без `map` → `state.read().map === 'island'`.
   - **Чернетка QA.** `qa:open:` `http://localhost:5199/products/story-quest/?story=test-2025/my-day-3-moments&map=foo` ·
     `qa:action:` дочекатися спуску до персонажа, пройти до першої мініатюри ·
     `qa:inspect:` URL сторінки, сцена · `qa:expected:` нинішній острів, той самий берег
     старту, що й без `map`; у URL лишається `map=foo`.~~ — ЗАКРИТО

~~2. **T2. Рельєф бухти.** Спека §2 (таблиця), §3 (пороги, прохід у море), §4.1, §4.2,
   §5 п.3 (без закритих зон).
   - Профіль `lagoon` у `MAPS` (`src/scene/maps.js`) з тими самими полями, що `island`
     (`heightAt`, `storyBearing`, `heroRock`, `openSea`); правило каміння зараз одне —
     `placeRocks(heightAt, …)` у `terrain.js`, зони без каменів для `lagoon` додати в профіль.
   - Профіль `lagoon`: `heightAt` з двома мисами й підковою пляжу, берег історії
     в бухті, скеля прибою, зони каміння (поза каналом), радіус огляду, явна
     точка `open-sea`, якщо промінь до поля перетинає мис.
   - **Закриття.** Focused: пороги таблиці §3 (площа суші > 0,40 км²; суша ≤ 600 м;
     дно вище −14 м ≤ 760 м; глибина на межі 900 м ≥ 25 м) тим самим виміром, що у
     фактах нижче; канал — `openWater` уздовж ламаної від поля до |x| або |z| > 900 м
     з радіусом палуби найбільшого кадру + 5 м. Проба `probe-terra-t2` на трьох історіях
     тестового набору з `map=lagoon`: старт на `h ≥ 1` м, гідратація однієї мініатюри,
     пліт під кайтом (`stepRaft`, не `raft.moveTo`) до `state.read().openSea === true`,
     «На берег» → персонаж на сухому піску.
   - **Чернетка QA.** `qa:open:` `https://story-quest--edge-of-elements.netlify.app/products/story-quest/?story=test-2025/my-day-3-moments&map=lagoon` ·
     `qa:action:` дочекатися огляду й спуску; стіком до води, «На пліт», кайт, курс у вихід із бухти ·
     `qa:inspect:` огляд з висоти, берег, пліт · `qa:expected:` з висоти видно два миси й вихід;
     пліт проходить вихід без зупинки на мілині, хвилі й піна йдуть уздовж нового берега.~~ — ЗАКРИТО

3. **T3. Декорації бухти.** Спека §3 (пальми, будиночок, закриті зони, моделі),
   §4.4, §5 п.3 (закриті зони), §5 п.4.
   - Процедурні пальми (кілька силуетів, `InstancedMesh` на варіант), хатина з
     похилим дахом, палями й настилом; матеріали через `terrain.patchProp`.
   - Закриті зони профілю → предикат `blocked(x, z)` у `layoutMiniatures` поряд з
     `isDryLand`; на `island` предиката немає й розкладка та сама.
   - **Закриття.** Focused: для трьох історій на `lagoon` 0 мініатюр у закритих зонах;
     на `island` розкладка трьох історій збігається з до-фазовою. Проба `probe-terra-t3`:
     з `?mobile` `renderer.info` дає для декорацій ≤ 120 тис. трикутників і ≤ 8 draw
     calls; знімки з огляду й з рівня очей на старті (пальми за пляжем, дах і палі);
     від старту до кожної мініатюри є відрізок, що не перетинає стовбурів.
   - **Чернетка QA.** `qa:open:` `https://story-quest--edge-of-elements.netlify.app/products/story-quest/?story=public-test/frog-fairy-full&map=lagoon` ·
     `qa:action:` після спуску подивитися вздовж пляжу; дійти до трьох мініатюр ·
     `qa:inspect:` смуга за пляжем, мілина біля мису · `qa:expected:` пальми групами з
     просвітами, хатина з дахом і палями у воді; жодна мініатюра не лежить під пальмою.

4. **T4. Вибір «Місце» і телефон.** Спека §2 (вибір, пояснення, перемикання),
   §5 п.1, п.2, п.5.
   - Вибір «Місце» в зоні історії `ui-map.json` (uk + en), коротке пояснення, що
     маршрут почнеться спочатку; перемикання → `host.load` з тією самою історією
     й мовою, URL продукту з `map`. Вибір показує карту з `scene.ready`.
   - **Закриття.** `probe-story-product` розширено: `island → lagoon → island`
     дотиком (`hasTouch`), URL продукту й iframe, `state.read().map`, перезавантаження
     сторінки відтворює вибір; картка квесту, збережена на одній карті, видна на
     другій. Телефон власника: ≥ 30 FPS на історії з 10 кадрами на обох картах
     (ходьба й пліт).
   - **Чернетка QA.** `qa:open:` `https://story-quest--edge-of-elements.netlify.app/products/story-quest/?story=test-2025/my-day-3-moments` ·
     `qa:action:` ☰ → «Місце» → «Бухта»; пройти до мініатюри; ☰ → «Острів» ·
     `qa:inspect:` пояснення біля вибору, адресний рядок, сцена · `qa:expected:` після
     кожного дотику огляд і спуск починаються наново; в адресі `map=lagoon`, потім
     `map=island`; картки в зоні «Картки» ті самі.

### Відкриті питання

5. **Числа, вибрані в ревʼю без власника** (спека 0.2): бюджет декорацій 120 тис.
   трикутників і 8 draw calls — підтвердити власником до закриття T3; зміна — правкою
   спеки. Суша `lagoon` ≤ 600 м і запас каналу прийняті разом із T2.
~~6. **Де живе модуль профілів** — `src/scene/` поряд з `islandHeight.js` чи власна тека.
   Вирішує T1; рядок реєстру `AGENTS.md` і мапа нижче оновлюються тим самим комітом.~~ — ЗАКРИТО:
   `src/scene/maps.js` (T1).
~~7. **`?map` на сторінці сцени без продукту** (GUI, стенд `quest-demo-qa`): спека §4.5
   лишає стенд на `island`, але сцена читає `?map` і сама. Чи потрібен вибір карти в
   GUI сцени для налаштування рельєфу в T2 — вирішує T2.~~ — ЗАКРИТО: вибору в GUI немає,
   налаштування — `/?map=lagoon` в адресі сцени (QA-T2-4) (T2).

## Що зроблено і працює

Baseline (T2, 2026-11-27): guard зелений; `npm test` 390/390; `test-terrain-contact` pass; `probe-terra-t2` (локально й драфт), `probe-terra-t1`, `probe-story-embed`, `probe-scene-shore` — PASS.

| Підсистема | Де (файли, символи) | Контракт | Перевірка |
| --- | --- | --- | --- |
| Профіль карти | `src/scene/maps.js` (`MAPS` = `island`, `lagoon`; `pickMap` → `island` для відсутнього/невідомого, `rayTo`, `rayIn`; необов'язкові `viewRadius`, `rocks`); `main.js` `map = pickMap(args.get('map'))` до побудови сцени, `radius = map.viewRadius ?? islandRadius`; `window.app.map`/`openSea` | спека §4.1 | `tests/maps.test.js`, `probe-terra-t1` |
| Рельєф і контакт | `src/scene/islandHeight.js` (`islandHeight`, `ISLAND_SIZE` 2400; лише `island`), `lagoonHeight.js` (`LAGOON`, `lagoonLand`, `lagoonHeight`, `inBay`; бухта на пеленгу −46,25°, миси, гирло), `terrainGeometry.js` (`buildTerrain(heightAt, …)`), `TerrainContact.js` | спека §3, §4.1 | `scripts/test-terrain-contact.mjs`, `tests/shoreTextures.test.js`, `tests/terraRelief.test.js` |
| Каміння й скеля прибою | `src/scene/terrain.js` (`createTerrain({ map })`, `placeRocks(heightAt, …, map.rocks)` від r=150, `rockMaps`; на `lagoon` без каміння в бухті й гирлі +25 м); скеля — `map.heroRock()` (пеленг −15°, дно −2,5 м; на `lagoon` — `rayIn` з моря) | спека §4.1 | `probe-scene-shore`, `tests/terraRelief.test.js` |
| Берег історії й старт | `src/main.js` (`coast`, `storyAnchor` = `map.storyBearing(SET_BEARING)`, на `island` +1,2; `walkerSpawn`, `stationPoses`), `src/scene/stationPoses.js` (`islandRadius`) | STORY-QUEST §2 п.2 | `tests/cameraFlight.test.js`, `probe-story-q2b` |
| Карта берега | `src/water/shoreMap.js` (`bakeShoreMap`), `main.js` `SHORE_EXTENT` 1800 | STORY-QUEST §4.3 | `tests/shoreTextures.test.js` |
| Якорі | `src/embed/anchors.js` (`resolveAnchor`: `open-sea` — `world.openSea()` профілю, інакше промінь `ANCHOR.openSea` 1300; `shallowPoint`) | STORY-QUEST §4.4, спека §4.2 | `probe-story-embed`, `probe-story-states` |
| Пліт і відкрите море | `src/tiles/raftMotion.js` (`RAFT.depth` 0,6, `rimDepth` 0,1, `seaEdge` 900, `openWater`, `stepRaft`), `TileRaft.js`; на `lagoon` `openSea: null` — промінь поля виходить через гирло | STORY-QUEST §4.3, спека §3 | `probe-story-q4`, `probe-story-q5`, `probe-terra-t2` |
| Розкладка мініатюр | `src/tiles/miniatureLayout.js` (`layoutMiniatures`, `isDryLand`, `LAYOUT.radius` 70) | спека §2, §3 | `probe-story-q3` |
| Контракт продукту | `products/shared/contract.js` (`SCENE_MAPS`, `knownMap`, `sceneUrl({ map })`: `island` без параметра, невідома — помилка), `sceneHost.js` (`load`), `products/story-quest/main.js` (`map()` з URL продукту), `src/embed/index.js` (`scene.ready` + `map`), `state.js` (`readState` + `map`), `world.js` (`map`, `openSea`) | STORY-QUEST §4.4, спека §4.3 | `tests/products.test.js`, `probe-story-product` |

## Головні виміряні факти

### Стенд і інструменти

- [vitest на Windows, `cd /d/...` у Git Bash] диск малою літерою → усі файли падають з `Cannot read properties of undefined (reading 'config')`, 0 тестів → запускати з `cd D:/work/...`. (T1)

### Рельєф і контакт

- [`islandHeight`, промені з кроком 0,5° і сітка 5 м у квадраті 1800 м] суша до 510 м від центру, дно вище −14 м до 756 м, найменша глибина на межі 900 м — 28 м, площа суші ≈ 0,40 км² → той самий вимір у focused-тесті T2 для обох карт. (ревʼю спеки)
- [`coast()`, `placeRocks`, `heroRock`, кадри камер] шукають берег променем від (0, 0) до першої точки h ≤ 0 → на `lagoon` така точка може лежати за мисом; брати точки з профілю, не з променя. (ревʼю спеки)
- [`heroRock` на `lagoon`] промінь від центру на пеленгу −15° закінчується на пляжі бухти → скелю шукає `rayIn` з 900 м у бік берега до дна −2,5 м. (T2)
- [`islandRadius` на `lagoon`] промені від центру впираються в пляж бухти, огляд не бачить мисів → профіль дає `viewRadius` 540 м (≥ суші). (T2)
- [dev-кадри «Golden hour», «Breakers», «Lagoon», «Underwater»] шукають берег променем із центру → на `lagoon` можуть дивитися в сушу; не маршрут, не правити без потреби. (T2)

### Пліт і відкрите море

- [`raft.moveTo`] переносить палубу одразу в точку без перевірки глибини → вихід із бухти доводить лише рух під кайтом через `stepRaft` + `openWater`. (ревʼю спеки)
- [`probe-terra-t2`, пліт під кайтом з бухти] 139 с до межі 900 м, 0 зупинок, мін. швидкість 6,9 м/с; уся проба на історію 178–190 с → таймаут проби не менше 4 хв. (T2)
- [карта берега] за |x| або |z| > 900 м `shoreSample` дає глибину 60 м і відстань 1e4 → шельф `lagoon` тримати в межах порогів §3, інакше хвилі ламаються на межі. (story-quest)

### Контракт продукту

- [iframe сцени, `writeTileUrl`] сцена переписує свою адресу (`?story=…%2F…&walk=&…&tilesMode=…`), але чужі параметри, зокрема `map`, зберігає → перевіряти `map` в iframe за наявністю параметра, не за точним рядком. (T1)

- [`scene.ready`] зараз несе `{ story, fingerprint }`, ключ квестів — історія + fingerprint → карта до ключа не входить, картки переходять між картами без змін у `quests.js`. (ревʼю спеки)
