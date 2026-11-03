# QA: frame-drag

Локально з каталогу `D:/work/_tools/water-3d/Ultra-Water`: `npm install`, потім
`npm run dev`. Стенд — `http://localhost:5199/`; якщо вже працює, другий процес
не запускати. Tilecraft читається з `TILECRAFT_ROOT` або стандартного
`D:/work/js-games/ua-dream/tilecraft`. Потрібен цей checkout із його залежностями;
інтернет під час перевірки не потрібен. За правилом `AGENTS.md` стенд залишається
запущеним після рев’ю.

Pose живе лише в поточній сесії. URL зберігає параметри `tiles*`, але не переноси;
reload або зміна source починає нову розкладку. Reset повертає всі фрейми до
початкових позицій відносно поточного поля, в `inherited`, і обнуляє симуляцію.

## FD2. Picking і drag на воді — ЗАКРИТО

Прийнято власником через `handoff:next` 2026-11-03. Відкриті бюджети
продуктивності нижче збережені для FD5; їх приймання не заявляється.

Автопокриття: `scripts/probe-frame-drag.mjs` — реальні DOM-жести, WebGL ID pass,
60 с інтегрованого drift, XZ тайлів/run-ів, похибка точки захоплення, blur,
панорамування, два пальці через CDP, dblclick T5, source=none під час drag,
mobile-профіль і DPR=2. Запуск: у PowerShell з каталогу проєкту задати
`$env:PLAYWRIGHT_MODULE = 'D:/work/js-games/ua-dream/tilecraft/node_modules/playwright/index.mjs'`,
потім `node scripts/probe-frame-drag.mjs`. Mobile-профіль на desktop GPU не
підтверджує бюджет справжнього телефона. Візуально перевірити контури, плавність
і передачу керування камері. Сценарії нижче перевірені автоматично.

Виміряно 2026-11-03 на AMD Radeon 890M / Chromium WebGL (це не телефон):

| перевірка | результат |
|---|---|
| Guard | `npm run build`, `probe-tiles.mjs`, `probe-tiles-drift.mjs` — PASS; offline FD1/T4/T5 — PASS |
| Drift guard | 121.35 с / 4267 кадрів, nonfinite=0; 218196 стиків, maxSeam=0; anchored recovery error=0.00000744 м |
| FD2 probe | PASS після 60.00 с drift; picking polygon і polyline всіх 8 фреймів; errors=[] |
| Утримання | зміна XZ тайлів=0, зміна стану run-ів=0 після пригашення орбіти; рух камери=0 |
| Захоплення / release | усталена похибка 2.885 CSS px; стрибок на release при dt=1e-7 — 0.00000197 м |
| Desktop picking, 1400×1000 | 25 теплих запитів: p50=6.50 мс, p95=14.40 мс |
| CPU interaction | 57 кадрів drag/settling: p50=0.20 мс, p95=0.70 мс |
| Mobile-профіль, CSS 480×850, DPR=2 | на тому самому desktop GPU: p50=3.60 мс, p95=15.10 мс; drawing width=576 |
| Ресурси ID / контурів | 16 частин, спільні geometry/instance attributes; додаткової копії геометрії немає |

**Відкрите обмеження продуктивності:** desktop pick p95 перевищує попередній
орієнтир 8 мс. CPU interaction p95 перевищує орієнтир 0.5 мс/кадр із FD5.
Функціональний PASS не означає PASS цих бюджетів. Холодний перший pick і
справжній mobile GPU окремо не атестовані; бюджет телефона 20 мс ще не підтверджений.

### QA-FD2-1. Захоплення рознесеного фрейму

**qa:mode:** browser
**qa:open:** `http://localhost:5199/?tiles=story-8-frames-hibrid&tilesMode=drift`
**qa:action:** зачекати щонайменше хвилину; лівою кнопкою схопити видиму деталь,
протягти приблизно на 140 CSS px і відпустити.
**qa:inspect:** весь вибраний фрейм, деталь біля курсора, поле `selectedFrame`.
**qa:expected:** усі його частини рухаються разом; рознесений малюнок не
збирається; камера нерухома. Після 125 мс пригашення орбіти взаємні XZ
зберігаються. Після відпускання за ≤150 мс рух завершується, режим — `placed`;
усталена похибка захопленої деталі ≤5 CSS px, підсвічування видно по всьому фрейму.

### QA-FD2-2. Обертання з порожнього місця

**qa:mode:** browser
**qa:open:** `http://localhost:5199/?tiles=story-8-frames-hibrid`
**qa:action:** лівою кнопкою протягти на 40 px по воді під малюнком.
**qa:inspect:** ракурс камери й малюнок.
**qa:expected:** камера починає обертатися одразу; drag фрейму не починається.

### QA-FD2-3. Права кнопка над деталлю

**qa:mode:** browser
**qa:open:** `http://localhost:5199/?tiles=story-8-frames-hibrid`
**qa:action:** правою кнопкою протягти по видимій деталі на 35 px.
**qa:inspect:** камера і позиція фрейму.
**qa:expected:** камера панорамується; фрейм лишається на своїй pose.

### QA-FD2-4. Системне скасування

**qa:mode:** browser
**qa:open:** `http://localhost:5199/?tiles=story-8-frames-hibrid`
**qa:action:** почати drag і змістити фрейм; під час утримання виконати в консолі
`window.dispatchEvent(new Event('blur'))`; відпустити кнопку.
**qa:inspect:** позиція фрейму, потім обертання камери з порожньої води.
**qa:expected:** початкова pose і режим фрейму відновлені; камера доступна,
фрейм більше не слідує за вказівником.

### QA-FD2-5. Другий палець передає керування камері

**qa:mode:** browser
**qa:open:** `http://localhost:5199/?tiles=story-8-frames-hibrid`
**qa:action:** у touch-режимі схопити деталь одним пальцем і посунути на 60 px;
додати другий палець, розвести пальці й відпустити обидва.
**qa:inspect:** фрейм і ракурс камери.
**qa:expected:** у момент другого дотику перенос фіксується, фрейм — `placed`;
два пальці змінюють масштаб камери без стрибка бази. Після відпускання камера
й новий одиночний drag знову доступні.

### QA-FD2-6. Повернення в загальний drift

**qa:mode:** browser
**qa:open:** `http://localhost:5199/?tiles=story-8-frames-hibrid&tilesMode=drift`
**qa:action:** перенести фрейм; у Tiles натиснути «Відпустити у дрейф».
**qa:inspect:** `selectedFrame` і вибраний фрейм.
**qa:expected:** режим — `inherited`, дрейф відновлюється без миттєвого стрибка.

### QA-FD2-7. Подвійний клік T5

**qa:mode:** browser
**qa:open:** `http://localhost:5199/?tiles=story-8-frames-hibrid`
**qa:action:** після завершення попереднього drag зачекати понад 600 мс;
двічі клікнути видиму деталь без руху.
**qa:inspect:** відповідна група деталей і камера.
**qa:expected:** створюється одне CPU-тіло T5; друге натискання не починає
перенос фрейму. Звичайне перетягування саме собою не створює T5-тіл.

### QA-FD2-8. Source=none під час drag

**qa:mode:** browser
**qa:open:** `http://localhost:5199/?tiles=story-8-frames-hibrid`
**qa:action:** під час активного drag виконати в консолі `app.tiles.load('none')`;
відпустити кнопку й повести мишею по canvas.
**qa:inspect:** сцена, консоль, камера.
**qa:expected:** малюнок і його контури прибрані, помилок немає; камера працює,
немає продовження drag чи залишкового hover-підсвічування.

### QA-FD2-9. Повний reset

**qa:mode:** browser
**qa:open:** `http://localhost:5199/?tiles=story-8-frames-hibrid&tilesMode=drift`
**qa:action:** перенести фрейм, потім у Tiles натиснути `reset`.
**qa:inspect:** розкладка всіх фреймів і `selectedFrame`.
**qa:expected:** початкова розкладка, без вибору; усі фрейми `inherited`, локальні
стани обнулені, жоден фрейм не лишився замороженим.

### Свідомо не зроблено в FD2

Контакт із землею та точний SurfaceCursor на рельєфі — FD3; перевірка крутих
схилів і порядок перекриття — FD4. На суші цей прохід ще не є приймальним.
Перебудова scale/filter зберігає world pose, але пересоздає симуляцію й локальні
drift-стани, як у FD1. Справжній телефон і його GPU-бюджет потребують окремої перевірки.

## FD1. Реєстр фреймів і програмне перенесення — ЗАКРИТО

Автопокриття: `scripts/test-frame-pose.mjs` (ідентичність і перетворення координат)
та `scripts/probe-frame-pose.mjs` (справжній WebGL і GUI). Ручна перевірка нижче
потрібна також для читабельності малюнка, узгодженості polygon/polyline і видимих
стрибків. Команди консолі виконуються після появи малюнка та статусу `46861 tiles`.
Третій фрейм обирається через `app.tiles.frames[2]`, його id у цій фікстурі — `4`.

### QA-FD1-1. Переноситься один цілий фрейм

**qa:mode:** browser
**qa:open:** `http://localhost:5199/?tiles=story-8-frames-hibrid`
**qa:action:** у DevTools Console виконати:
```js
(() => {
  const t = app.tiles, f = t.frameRegistry.get(t.frames[2]);
  t.moveFrame(f.id, f.world.x + 20, f.world.z);
  return f.mode;
})()
```
**qa:inspect:** третій малюнок і два сусідні; результат у Console.
**qa:expected:** результат `placed`; третій малюнок перенесений на 20 м по world X,
polygon і polyline разом; сусіди залишилися на своїх місцях. Хвильова висота/нахил
продовжують змінюватися. Проба перевіряє нуль змін GPU-станів у момент API-виклику,
нуль переміщення чужих мешів і незмінність instance-буферів.

### QA-FD1-2. Поворот поля зберігає світовий pivot

**qa:mode:** browser
**qa:open:** `http://localhost:5199/?tiles=story-8-frames-hibrid`
**qa:action:** виконати команду QA-FD1-1, потім `Tiles → fieldYaw` встановити `45`.
**qa:inspect:** центр перенесеного фрейму відносно острова й сусідніх малюнків.
**qa:expected:** pivot перенесеного фрейму залишається в тій самій світовій точці;
сам малюнок повертається на 45° навколо нього. Inherited-фрейми повертаються з полем.
Проба окремо перевіряє також повторне розміщення поля на 40 м: placed pivot
не зміщується, inherited pivot зміщується на 40 м.

### QA-FD1-3. Filter не губить pose прихованого фрейму

**qa:mode:** browser
**qa:open:** `http://localhost:5199/?tiles=story-8-frames-hibrid`
**qa:action:** виконати команду QA-FD1-1; `Tiles → frame` вибрати `2`, дочекатися
статусу `3978 tiles`, потім вибрати `all`.
**qa:inspect:** третій малюнок після повернення `all`; статус Tiles.
**qa:expected:** знову `46861 tiles`; третій малюнок повертається на перенесену,
а не початкову позицію. Його режим залишається `placed`.

### QA-FD1-4. Масштаб не пересуває placed pivot

**qa:mode:** browser
**qa:open:** `http://localhost:5199/?tiles=story-8-frames-hibrid`
**qa:action:** виконати команду QA-FD1-1; `Tiles → metersPerSourceUnit` встановити
`0.06`, підтвердити Enter і дочекатися перебудови.
**qa:inspect:** центр перенесеного фрейму та розмір деталей.
**qa:expected:** деталі збільшені в 1.2 раза; світовий pivot перенесеного фрейму
збережений, режим `placed` не скинутий. Автопроба порівнює координати pivot до/після.

### QA-FD1-5. Відпустити окремий фрейм у загальний режим

**qa:mode:** browser
**qa:open:** `http://localhost:5199/?tiles=story-8-frames-hibrid`
**qa:action:** виконати команду QA-FD1-1, потім у Console:
```js
app.tiles.releaseFrame(app.tiles.frames[2]).mode
```
**qa:inspect:** результат Console; положення малюнка в момент виклику.
**qa:expected:** `inherited`; сам виклик не пересуває pivot і не скидає локальні
GPU-стани. Фрейм відтепер підкоряється загальному `Tiles → mode`. Проба на
контрольованій воді перевіряє placed/inherited в обох напрямках із ненульовою
орбітою: похибка XZ і швидкості менша за `0.00001`.

### QA-FD1-6. Reset повертає початкову розкладку

**qa:mode:** browser
**qa:open:** `http://localhost:5199/?tiles=story-8-frames-hibrid`
**qa:action:** виконати команду QA-FD1-1, потім натиснути `Tiles → reset`.
**qa:inspect:** третій малюнок серед інших фреймів.
**qa:expected:** відновлена початкова розкладка відносно поточного поля; усі
фрейми `inherited`, переноси обнулені. Симуляція знову рухається від хвиль.

### QA-FD1-7. Вимкнення source звільняє поле

**qa:mode:** browser
**qa:open:** `http://localhost:5199/?tiles=story-8-frames-hibrid`
**qa:action:** виконати команду QA-FD1-1, потім `Tiles → source` вибрати `none`.
**qa:inspect:** сцена і Console.
**qa:expected:** усі малюнки зникли, вода й камера працюють, помилок немає;
проба підтверджує нуль мешів/записів реєстру, відсутність TileSim, picker-target
і прив’язки слухачів промоції.

### QA-FD1-8. Програмні перевірки

**qa:mode:** cli
**qa:open:** PowerShell, каталог `D:/work/_tools/water-3d/Ultra-Water`, dev-стенд
`http://localhost:5199/` працює. Для наявного Playwright у Tilecraft:
`$env:PLAYWRIGHT_MODULE = 'D:/work/js-games/ua-dream/tilecraft/node_modules/playwright/index.mjs'`.
**qa:action:** `node scripts/test-frame-pose.mjs`, потім `node scripts/probe-frame-pose.mjs`.
**qa:inspect:** stdout і коди завершення обох команд.
**qa:expected:** обидва exit code `0`; перша друкує `PASS FD1 identity/world`,
друга — JSON із `pass: true`, `errors: []`. Перевіряються uniform і texture fallback,
спільний frameIndex у polygon/run, водні запити після переносу, frame anchor замість
центра поля для driftRadius та world pivot після yaw/filter/scale.

### Свідомо не зроблено в FD1

- Перетягування мишею/touch, вибір і підсвічування — FD2. Зараз перенос лише через API;
  подвійний клік T5 продовжує промоцію групи в CPU Body.
- Фіксація вже рознесеної drift-конфігурації й пригашення орбіти під час захвату — FD2.
  Програмний `moveFrame` вмикає локальний anchored; це ще не жест drag.
- Контакт із рельєфом/дном, береговий перехід і обмеження схилів — FD3–FD4.
- Мобільні hardware-бюджети та остаточний lifecycle/interaction звіт — FD5.
- Експорт pose між перезавантаженнями не входить у v0.2.

### Журнал перевірок FD1

2026-11-03: власник прийняв FD1 командою `handoff:next`; фазу закрито.
QA-FD1-1…8 прийнято як фазу загалом, без приписування нового окремого ручного
прогону кожному сценарію. Build і три offline-набори (FD1/T4/T5) PASS.
Guard-проби `probe-tiles.mjs` і `probe-tiles-drift.mjs` PASS: 46 861 тайл,
131.48 с drift / 6 510 кадрів, `nonfinite=0`; 218 196 перевірених стиків,
`maxSeam=0`. Після повернення в anchored залишкова похибка anchor — 0.00000696 м.
WebGL FD1-проба PASS: перенесені 2 частини одного фрейму, зміна чужих мешів і
GPU-станів у момент move — `0`; yaw/filter/scale/reposition зберігають world pivot.
Незалежний WaterQuery збігається із запитами перенесених polygon/polyline та run:
похибка тайлів 0.000000060 м, run ≤ 0.000000004 м. У контрольованій воді після 10 с
placed XZ=0, inherited X=4.68957 м; driftRadius рахується від frame anchor,
навіть коли rest-координати фрейму зміщені на 500 м від центра поля.
На цьому WebGL-контексті `MAX_FRAGMENT_UNIFORM_VECTORS=1024`, ліміт uniform-шляху
432 фрейми; при 433 використовується текстура. Linked tile pass: 13 sampler-ів
без текстури фреймів, 14 із нею (оцінка 12 у спеці була занижена).
Linked run pass: відповідно 9 і 10 sampler-ів. Граничний uniform-шлях із
432 фреймами теж PASS: консервативний підрахунок активних uniform-векторів —
917 із 1024 (матриця рахується по стовпцях, scalar/vec2 — як повний вектор).
Це функціональні виміри desktop; hardware-продуктивність ними не підтверджена.

Виправлено стару fixture-перевірку `probe-tiles.mjs`: на коді до FD1 вона теж
падала (`first=1.6372680664`, старе очікування `0.04291875`). Oracle лишився від
Archimedes, хоча інтегратор T3 уже critically damped follower; fixture також
успадковувала справжню bathymetry й подавала 2 м у кожну з трьох FFT-каскад.
Тепер для аналітичної перевірки задані глибока вода, сумарний step 2 м і
відповідна аналітична швидкість: `0.7509651184` проти `0.7509650353` м/с.
Інваріант-реєстру в темі немає.
