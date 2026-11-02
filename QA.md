# QA: tile-floaters — плавучі тайли Tilecraft

Як запустити локально:

1. Tilecraft має лежати в `D:/work/js-games/ua-dream/tilecraft` (інакше задайте
   `TILECRAFT_ROOT=<шлях>` перед запуском). Сам Tilecraft сервер не потрібен: його модулі
   й фікстури віддає dev-сервер Ultra Water через `/@fs/`.
2. `cd Ultra-Water && npm install && npm run dev` — сервер на `http://localhost:5199/`
   (порт фіксований, `strictPort`). Інтернет не потрібен.
3. Поле працює лише в `npm run dev`; у `npm run build` список джерел у папці `Tiles`
   неактивний (spec.md §3.2).

Для П5 (порівняння з Tilecraft) потрібен ще статичний сервер Tilecraft:
`cd D:/work/js-games/ua-dream/tilecraft && npm start` → `http://localhost:8080/`.

## T0. Завантажувач Tilecraft і статичне поле

Покриття: QA-T0-1, QA-T0-3 і QA-T0-4 перевірено Playwright-пробою (статус, консоль,
перебудова за кадром); очима — збіг малюнка (QA-T0-2) і кадрування шоту.

### QA-T0-1. Hibrid-модель завантажується на воду

**qa:mode:** browser
**qa:open:** `http://localhost:5199/?tiles=story-8-frames-hibrid`
**qa:action:** нічого — почекати ~3 с (компіляція ~1.1 с).
**qa:inspect:** `camera` і рядок `status` у GUI; поле на воді; консоль браузера.
**qa:expected:** після завантаження `camera` сама перемикається на `Tiles` (до того —
`Golden hour`); `status` = `46861 tiles · 2213 groups · polygon + polyline`; камера
дивиться на поле згори під ~35° від вертикалі, два ряди по 4 кадри історії, малюнок
читається не дзеркально (зайці стоять головою вгору екрана); у консолі немає
`Multiple instances of Three.js` і немає помилок (попередження HLSL `X4122` є й без
тайлів — воно з наявних шейдерів).

### QA-T0-2. Згори малюнок збігається з Tilecraft (П5)

**qa:mode:** browser
**qa:open:** `http://localhost:5199/?tiles=story-8-frames-hibrid` і поруч
`http://localhost:8080/viewer/engines/three/shell/?src=story-8-frames-hibrid&camera=top`
**qa:action:** в Ultra Water: `camera` → `Tiles`, потім мишею повернути камеру прямо
згори (або в консолі `app.camera.position.set(app.tiles.center.x, 95, app.tiles.center.z + 0.01)`).
**qa:inspect:** обидва вікна поруч — форма, кольори, порядок шарів.
**qa:expected:** ті самі 8 сцен у тому самому порядку й орієнтації, ті самі кольори
мазків і polygon-тайлів. Розбіжності, що очікувані: у Tilecraft під кожним кадром
блідий фон-«аура» і синя діагональна смуга між кадрами — це кадрові ефекти, не тайли
(spec.md §1, не-мета); у полі їх немає.

### QA-T0-3. Фільтр кадру перебудовує поле

**qa:mode:** browser
**qa:open:** `http://localhost:5199/?tiles=story-8-frames-hibrid`
**qa:action:** `camera` → `Tiles`; у папці `Tiles` `frame` → `2`; потім `frame` → `all`.
**qa:inspect:** рядок `status` і поле.
**qa:expected:** при `2` — `3978 tiles · 153 groups · polygon + polyline` і на воді лише
одна сцена (та сама кількість тайлів, що в списку кадрів Tilecraft: `2. 3,978 tiles`);
при `all` — знову `46861 tiles · 2213 groups`.

### QA-T0-4. Без тайлів сцена як до теми

**qa:mode:** browser
**qa:open:** `http://localhost:5199/?tiles=none`
**qa:action:** нічого; потім `Run benchmark` на шоті `Flotsam`.
**qa:inspect:** сцена, папка `Tiles` (згорнута), рядок бенчмарку, вкладка Network.
**qa:expected:** сцена та сама, що до теми; `status` = `—`; жодного запиту до
`/@fs/…/tilecraft/`; ms/frame бенчмарку в межах шуму від README (на RTX 3060 — 4.62 мс
для Flotsam ± 0.05).

### QA-T0-5. Масштаб перебудовує поле

**qa:mode:** browser
**qa:open:** `http://localhost:5199/?tiles=story-8-frames-hibrid`
**qa:action:** `camera` → `Tiles`; `metersPerSourceUnit` → `0.1` (відпустити повзунок);
`camera` → `Tiles` ще раз.
**qa:inspect:** поле і рядок `status`.
**qa:expected:** поле вдвічі більше (≈170×61 м), статус той самий `46861 tiles ·
2213 groups`; поле посунулось далі від острова, щоб лишитись у глибокій воді.

### Свідомо не зроблено в T0

- Тайли не рухаються: поле статичне на y=0, хвилі його перекривають і розкривають (T1).
- Немає тіні поля у floater shadow, відбиття і ручних bounds (T4).
- Немає режимів `anchored`/`drift`, GUI фізики і стану в URL, крім `?tiles` (T2–T3).
- Прозорі шари не сортуються (як і в Tilecraft).
