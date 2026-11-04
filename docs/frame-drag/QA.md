# QA: frame-drag

Функціональні фази FD1–FD5 закриті; історичні перевірки перенесено до
[архіву QA](_archive/QA-phases-FD1-FD5.md) (2026-11-04).
Перевірки відкритих питань залишені нижче; архівні сценарії лишаються чинними.

Локально з каталогу `D:/work/_tools/water-3d/Ultra-Water`: `npm install`, потім
`npm run dev`. Стенд — `http://localhost:5199/`; якщо вже працює, другий процес
не запускати. Tilecraft читається з `TILECRAFT_ROOT` або стандартного
`D:/work/js-games/ua-dream/tilecraft`. Потрібен цей checkout із його залежностями;
інтернет під час перевірки не потрібен. За правилом `AGENTS.md` стенд залишається
запущеним після рев’ю.

Pose живе лише в поточній сесії. URL зберігає параметри `tiles*`, але не переноси;
reload або зміна source починає нову розкладку. Reset повертає всі фрейми до
початкових позицій відносно поточного поля, в `inherited`, і обнуляє симуляцію.

## FD5. Рендер, lifecycle, виміри — ЗАКРИТО

Прийнято власником через `handoff:next` 2026-11-04. QA-FD5-1…5 прийнято
як фазу загалом, без приписування нового окремого ручного прогону кожному
сценарію. Функціональна частина й звіт вимірів закриті; невиконані бюджети
picking / CPU, достовірний GPU contact/pose і справжній телефон лишаються
відкритими. Прийняття не змінює порогів і не є hardware-budget PASS.

Автопокриття: `scripts/probe-frame-lifecycle.mjs`; додатково регресії FD2/FD4.
Нова проба працює на справжній hybrid-моделі з 46861 тайлом. GPU-силуети
перевіряються на перенесеному фреймі; pending readback, source=none, context
lost/restored та pagehide перевіряються на desktop і mobile-профілі.
Mobile-профіль на AMD Radeon 890M не є справжнім телефоном.

Перевірено 2026-11-04, Chromium / ANGLE D3D11, AMD Radeon 890M. Це виміри
цього робочого desktop, без атестації ізольованого hardware-стенду.

| рівень / перевірка | результат |
|---|---|
| Guard | build, `probe-tiles.mjs`, `probe-tiles-drift.mjs` — PASS, errors=[] |
| Drift guard | 126.964 с / 4416 кадрів; nonfinite=0; 218196 стиків, maxSeam=0; anchored recovery error=0.000007358 м |
| Offline | FD1, terrain, T4, T5 — PASS; terrain oracle: 70 перетинів, max height error=6.40e-14 м |
| FD2 regression | PASS без повторного 60-секундного soak: polygon/polyline всіх 8 фреймів, mouse/touch/pinch, blur, dblclick, unload; grab error=4.204 CSS px, camera delta=0, release jump=0.000002604 м, errors=[] |
| FD4 DOM regression | PASS: повторний drag=8.457 м; рамка незмінна під хвилями, promotions=0; порожній клік прибирає вибір, hover його не повертає; errors=[]; перший запуск перевищив startup timeout 60 с, окремий повторний запуск пройшов |
| FD5 probe | PASS на обох профілях, errors=[]; source=none, context lost/restored і pagehide під час drag; усі перевірені pending-ресурси звільнені |
| Рендер на суші | main/depth і shadow: 931 піксель до переносу, 937 після, центроїди збігаються; перенос 10 м дає +25.645 px; реальний reflection target і mirrored depth — по 332 пікселі; сонячна shadow-camera бачить фрейм |
| Відновлення | 46861 тайл після restore, world pose збігається з pose до жесту; спектр океану ненульовий; після pagehide 0 overlays, capture=false, controls=true |
| BFCache | Окрема DOM-проба `pagehide(persisted=true)` під час реального drag — PASS: поле живе, abort=false, gesture=false, початкова pose відновлена, controls=true; наступний звичайний pagehide звільняє поле, errors=[] |
| Uniform / texture fallback | tile/run samplers: 14/10 та 15/11; fallback перевірено на 433 фреймах; render/ID/shadow нових terrain samplers не мають |
| Source=none benchmark smoke | 8 кадрів, warmup=2, Golden hour; tiles.count=0, tile passes відсутні; 48.175 мс/кадр — окремий короткий запуск, не доказ незмінної швидкості |

| вимір | desktop | mobile-профіль на тому самому GPU |
|---|---|---|
| CSS / DPR / drawing buffer | 1400×1000 / 1 / 1400×1000 | 480×850 / 2 / 576×1020 |
| Quality | resolution=1, MSAA=4, reflectionScale=0.5 | resolution=0.6, MSAA=2, reflectionScale=0.35 |
| Cold first pick (1 зразок, не p95) | 114.8 мс | 51.9 мс |
| Warm pick p50/p95 (40 звичайних кадрів) | 77.9 / 92.5 мс | 51.8 / 68.8 мс |
| CPU interaction p50/p95 | 0.4 / 0.8 мс, 91 кадр | 0.3 / 0.6 мс, 117 кадрів |
| GPU simulation на воді й суші | Не атестовано: invalid timer series | Не атестовано: invalid timer series |

**Відкриті бюджети:** warm pick p95 перевищує ≤8/20 мс; CPU p95 перевищує
≤0.5 мс. Ці результати не оголошуються hardware-budget PASS. Picking тепер
вимірюється між звичайними GPU-кадрами, а не 25 sync-запитами підряд в одному
JS task; старі короткі серії FD2–FD4 не доводять бюджет end-to-end stall.
У GPU-серіях по 40 запитів є значення близько 184467 мс при незведеному
disjoint flag; їх не можна трактувати як час цього проходу. Вся така серія
позначена invalid, p50/p95 не приписані; ≤1 мс contact/pose не підтверджено.
Проба не підміняє недоступний додатковий GPU-час CPU submit-часом.

При context lost жест системно скасовується, початкова pose відновлюється,
interaction-слухачі знімаються, ресурси звільняються. Лишаються тільки
restore/pagehide hooks поля. Після restore поле перебудовується зі збереженими
world pose та режимами; локальна симуляція й hold починаються заново.
Одноразові GPU-дані океану, піни, неба й сонячних тіней відновлюються.
Source=none знімає також lifecycle hooks поля й усі його контактні ресурси.
`pagehide` з `persisted=true` (BFCache / browser Back) лише скасовує жест:
живе поле зберігається для повернення на сторінку.
Асинхронні результати після dispose ігноруються; targets звільняються після
завершення вже поданих PBO, без фонового polling-таймера.

### QA-FD5-1. Малюнок і тінь на суші при низькому сонці

**qa:mode:** browser
**qa:open:** `http://localhost:5199/?tiles=story-8-frames-hibrid`
**qa:action:** після завантаження виконати в Console:
```js
(() => {
  const t = app.tiles, f = t.frameRegistry.get(t.frames[2]);
  t.moveFrame(f.id, 260, 120);
  app.views['Golden hour']();
  const h = t.terrainContact.at(260, 120).height;
  app.camera.position.set(260, h + 90, 210);
  app.controls.target.set(260, h, 120);
  app.controls.update();
  t.interaction.selected = f;
})()
```
Потім `app.tiles.moveFrame(app.tiles.frames[2], 270, 120)`.
**qa:inspect:** третій фрейм, жовта рамка, пісок і тінь під ним.
**qa:expected:** фрейм і рамка пересуваються на 10 м по X; тінь біля нового
місця, окремої тіні на старому місці немає. Рамка має тільки контур.
Проба порівнює main/depth і shadow silhouettes до пікселя, перевіряє
видимість у сонячній shadow-camera й mirrored camera; людина перевіряє
мерехтіння, напрям тіні та контакт із піском.

### QA-FD5-2. Скасування drag і відновлення контексту

**qa:mode:** browser
**qa:open:** `http://localhost:5199/?tiles=story-8-frames-hibrid`
**qa:action:** спочатку в Console виконати:
```js
setTimeout(() => {
  const loss = app.renderer.getContext().getExtension('WEBGL_lose_context');
  loss.loseContext();
  setTimeout(() => loss.restoreContext(), 1500);
}, 5000)
```
До спливу 5 секунд почати drag лівою кнопкою й утримувати її; після
відновлення відпустити кнопку, потягнути по порожній воді.
**qa:inspect:** фрейм, рамка, вода, камера й Console.
**qa:expected:** перенос скасований; фрейм повернув початкову pose цього
жесту. Після restore малюнок і хвилі знову видимі, камера доступна,
Console без errors. Проба виконує справжній context loss під час drag
із pending readback та перевіряє ненульовий відновлений спектр океану.

### QA-FD5-3. Вимкнення source під час переносу

**qa:mode:** browser
**qa:open:** `http://localhost:5199/?tiles=story-8-frames-hibrid`
**qa:action:** виконати `setTimeout(() => app.tiles.load('none'), 5000)`;
до спливу 5 секунд почати drag і продовжувати утримувати кнопку. Після
зникнення малюнка відпустити кнопку й потягнути по воді.
**qa:inspect:** сцена, камера, Console.
**qa:expected:** 0 малюнків і рамок, камера працює, errors немає.
Проба додатково підтверджує зняття capture/listeners і звільнення picker,
water cursor, occupancy та placement після їх реальних pending-запитів.

### QA-FD5-4. Бенчмарк без поля

**qa:mode:** browser
**qa:open:** `http://localhost:5199/?tiles=none`
**qa:action:** у Console виконати `await runBenchmark(8, { shot: 'Golden hour', warmup: 2 })`.
**qa:inspect:** повернений об’єкт і рядок benchmark у HUD.
**qa:expected:** `tiles.count === 0`, `frames === 8`; у `passes` немає
`tiles` і `tileRuns`. Сцена продовжує працювати. Проба виконує цей самий
короткий бенчмарк; це smoke, а не порівняння швидкості різних запусків.

### QA-FD5-5. Автоматична перевірка FD5

**qa:mode:** cli
**qa:open:** PowerShell, каталог `D:/work/_tools/water-3d/Ultra-Water`, стенд
`http://localhost:5199/` працює;
`$env:PLAYWRIGHT_MODULE = 'D:/work/js-games/ua-dream/tilecraft/node_modules/playwright/index.mjs'`.
**qa:action:** `node scripts/probe-frame-lifecycle.mjs`.
**qa:inspect:** stdout, фінальний JSON, exit code.
**qa:expected:** exit `0`, `pass: true`, `errors: []`; обидва профілі мають
46861 тайл; linked samplers tile/run — 14/10 у uniform і 15/11 у fallback.
Для picking виводяться cold first sample та warm p50/p95 із 40 різних
звичайних кадрів; CPU — фактичні кадри drag/settling. GPU-серії на воді й суші
вимірюють всю tile+run simulation як верхню межу вартості contact/pose.
`budgets` відокремлені від функціонального PASS; invalid/disjoint GPU-серія
позначається `available: false`, без заяви про виконання GPU-бюджету.

### Свідомо не зроблено в FD5

Справжній телефон недоступний цьому локальному прогону; його hardware-budget
не атестований. Контактні footprint >1 м лишаються попередженням FD4,
subdivision не додається. CPU/GPU локальний стан після context restore
не відновлюється snapshot-ом. Експорт pose між reload не входить у v0.2.
Бюджет picking вимірюється разом з очікуванням попереднього GPU-кадру:
серія sync pick підряд без проміжних кадрів не є його підтвердженням.

## FD4. Перевірки для відкритих питань

Решта прийнятих перевірок FD4 — у [QA-архіві](_archive/QA-phases-FD1-FD5.md).
Ці два сценарії збережені для вимоги не змінити жести й відкритого обмеження footprint >1 м.

### QA-FD4-1. Рамка та зняття вибору

**qa:mode:** browser
**qa:open:** `http://localhost:5199/?tiles=story-8-frames-hibrid`
**qa:action:** навести курсор на фрейм; коротко клікнути його видиму деталь;
зачекати 1 с без руху камери; знову клікнути деталь і одразу наступним
натисканням перетягнути її; коротко клікнути воду між малюнками; знову навести
курсор на фрейм без натискання.
**qa:inspect:** рамка навколо малюнка та `Tiles → selectedFrame`.
**qa:expected:** hover не створює рамки. Після вибору видно один тонкий контур
за чотирма кутами фрейму, з перспективою сцени, без заливки та сітки на деталях.
Хвилі не змінюють його кути; під час drag він рухається разом із фреймом.
Швидке повторне натискання починає drag. Після порожнього кліку рамка зникає,
selectedFrame показує `—`; наведення її не повертає.
Натискання й drag із порожнього місця обертає камеру. Перевірено DOM-жестами
у FD4 probe; регресія жестів камери — у FD2 probe.

### QA-FD4-5. Попередження про довгий polyline-тайл

**qa:mode:** browser
**qa:open:** `http://localhost:5199/?tiles=story-8-frames-hibrid`
**qa:action:** розгорнути `Tiles`; подивитися початок `status`; для повного
тексту виконати в консолі `app.tiles.status`.
**qa:inspect:** `Tiles → status`.
**qa:expected:** текст починається `Warning: polyline tile`, далі число >1
і `m > 1 m`. Це діаметр контактного footprint, включно з прилеглими гранями
спільних стиків, а не відстань між центрами вихідних тайлів.
Спекова оцінка 0.332 м не описує цей footprint;
точність контакту для сегментів понад 1 м не гарантується.
