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
