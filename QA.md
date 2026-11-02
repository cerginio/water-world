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

## T1. Матеріал GPU-стану і кінематика

Закрито 2026-11-02: власник прийняв фазу командою `handoff:next`.
Стенд залишається запущеним за правилом `AGENTS.md` → «Локальний стенд».

Кінематика без інерції: `y0 + waterAt(...).y`, нахил за центральними різницями
вздовж осей поля. Один MRT-прохід на тайли; вершини лише читають готовий стан.
`Tiles CPU submit` у Performance — CPU-час подання GPU-проходу, не час усього кадру.
Рядок GPU `tiles` — час цього проходу (на vsync частота GPU може бути знижена).

Eval T1, 2026-11-02, AMD 890M / headless Chromium, 1400×1000:
`npm run build` — PASS; WebGL-проба — PASS, помилок 0. 46 861 скінченний стан,
218 196 пар стиків, maxSeam = 0 м. Останній прогін: висота відрізняється від
WaterQuery максимум на `1.2e-7 м`, нормаль — на `0.00016`; GPU `tiles` ≈ `0.33 мс`,
CPU submit ≈ `0.12 мс`. У двох завершальних прогонах приріст CPU усього кадру
відносно статичного поля: `+0.1625 мс` і `−0.0465 мс` (шум; обидва ≤ `0.5 мс`).
Точність guard-бенчмарку README на RTX 3060 лишається неперевіреною.

Автоматична перевірка: при запущеному dev-сервері виконати
`node scripts/probe-tiles.mjs` з установленим Playwright. Якщо він установлений
поза репозиторієм, у PowerShell цієї машини:

```powershell
$env:PLAYWRIGHT_MODULE = 'C:/Users/cergi/AppData/Local/nvm/v25.7.0/node_modules/playwright/index.mjs'
node scripts/probe-tiles.mjs
```

Проба перевіряє реальні Float32 MRT-текстури, рух обох конвеєрів, стики,
незмінність версій instanceMatrix/normal, світові координати й нормалі через
незалежний WaterQuery при `fieldYaw=57`, перебудови кадру/масштабу та `tiles=none`.
CPU-час усього renderFrame порівнюється з матеріалами статичного T0 на тому самому
полі: 2 черговані раунди на режим, по 90 кадрів після 30 кадрів прогріву,
середнє центральних 80% вибірок. Окремо виводиться `cpu.withinBudget`.
Скриншот — `%TEMP%/tile-t1-field.png`; файли доказів не пишуться в репозиторій.
Очима перевіряються форма стрічок, мерехтіння та освітлення під час руху.

### QA-T1-1. Обидва конвеєри гойдаються на максимальному вітрі

**qa:mode:** browser
**qa:open:** `http://localhost:5199/?tiles=story-8-frames-hibrid`
**qa:action:** почекати завантаження; розгорнути `Waves`, задати `windSpeed` = `25`.
**qa:inspect:** polygon-плитки й polyline-стрічки у двох рядах історії; консоль.
**qa:expected:** статус `46861 tiles · 2213 groups · polygon + polyline`; обидва
типи геометрії змінюють висоту й нахил разом із хвилями; протягом 10 с немає
розходження спільних стиків стрічки або помилок шейдерів. Занурення частин
стрічки й коротке перекриття водою на сильній хвилі допустимі для кінематики T1.
Проба чисельно перевіряє збіг дублікатів стиків з допуском `0.00001 м`.

### QA-T1-2. Поворот поля зберігає прив'язку до світових хвиль

**qa:mode:** browser
**qa:open:** `http://localhost:5199/?tiles=story-8-frames-hibrid`
**qa:action:** у `Tiles` задати `fieldYaw` = `57`; вибрати `camera` → `Aerial` → `Tiles`.
**qa:inspect:** нахил плиток щодо схилів хвиль і освітлення їхніх граней.
**qa:expected:** камера знову кадрує всі 8 сцен; плитки піднімаються на тих самих
гребенях, що й вода, освітлення граней змінюється з нахилом. Проба порівнює
15 вибірок WaterQuery: похибка висоти < `0.002 м`, похибка одиничної нормалі < `0.005`.

### QA-T1-3. Перебудова кадру й масштабу відновлює GPU-стан

**qa:mode:** browser
**qa:open:** `http://localhost:5199/?tiles=story-8-frames-hibrid`
**qa:action:** `Tiles` → `frame` = `2`, потім `all`; `metersPerSourceUnit` = `0.1`,
потім `0.05` (після введення натиснути Enter); `camera` → `Aerial` → `Tiles`.
**qa:inspect:** статус, розміри поля й рух тайлів після кожної перебудови.
**qa:expected:** кадр `2` має `3978 tiles · 153 groups · polygon + polyline`,
`all` — `46861 tiles · 2213 groups · polygon + polyline`; при `0.1` ширина поля
приблизно 170 м, при `0.05` — 85 м. Після кожної перебудови обидва конвеєри
продовжують гойдатися. Проба перевіряє текстуру 512×8 для кадру 2.

### QA-T1-4. CPU-бюджет і цілісність GPU-даних

**qa:mode:** cli
**qa:open:** PowerShell у `Ultra-Water/`; dev-сервер `http://localhost:5199/` запущений;
`PLAYWRIGHT_MODULE` задано командою вище, якщо Playwright установлений глобально.
**qa:action:** `node scripts/probe-tiles.mjs`.
**qa:inspect:** JSON у stdout та код завершення процесу.
**qa:expected:** exit code `0`; `state.nonfinite=0`, `state.maxSeam=0`,
`motion.changed.polygon>0`, `motion.changed.polyline>0`, `cpu.withinBudget=true`
(приріст CPU ≤ `0.5 мс`), `errors=[]`. Незмінність instanceMatrix/normal
перевіряється assert усередині проби. За сильного шуму часу перевірити окремо
масиви `cpu.moving` і `cpu.staticMs`; від'ємна різниця означає шум, не прискорення.

### QA-T1-5. Вимкнене поле не створює GPU-ресурсів

**qa:mode:** browser
**qa:open:** `http://localhost:5199/?tiles=none`
**qa:action:** нічого — почекати завантаження сцени.
**qa:inspect:** сцена, консоль, Network; у консолі виконати
`({ loaded: app.tiles.loaded, sim: !!app.tiles.sim, children: app.tiles.group.children.length })`.
**qa:expected:** результат `{loaded: false, sim: false, children: 0}`;
немає запитів до `/@fs/…/tilecraft/` та помилок. Проба покриває цей сценарій.

### Свідомо не зроблено в T1

- Інерція, осадка від density, anchored/drift і швидкості — T2–T3. T1 пише лише
  `uState0/1` в одному target; ping-pong і решта attachments з'являться у T2.
- Для стиків LCR збіг координат у межах одного run означає спільний owner,
  навіть коли первинні sourceOwners різні. Без цього на вітрі 25 м/с у пробі
  стики розходились до 3.78 м; після узгодження — 0 м.
- Тіні поля, planar reflection та розширення bounds — T4.
- Guard-бенчмарк `tiles=none` з точністю ±0.05 мс від README потребує RTX 3060;
  на AMD 890M ця точність не підтверджена (обмеження, зафіксоване ще у T0).

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
