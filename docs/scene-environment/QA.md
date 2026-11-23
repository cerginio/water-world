# QA: scene-environment

Локально з каталогу `D:/work/_tools/water-3d/Ultra-Water`: `npm install`, потім
`npm run dev`. Стенд — `http://localhost:5199/`; якщо вже працює, другий процес
не запускати. Інтернет не потрібен. За правилом `AGENTS.md` стенд лишається
запущеним після рев'ю.

Телефон: dev-стенд слухає лише `localhost`. Для сценаріїв на телефоні стенд
треба підняти з `--host` (`npm run dev -- --host`) і відкрити
`http://<IP цього ПК в локальній мережі>:5199/` — телефон і ПК в одній мережі.

## E1. Виділення модуля оточення

**Прийнято власником через `handoff:next` 2026-11-23** (QA E1 — pass). Разом із
фазою на прохання власника: лінія рейки станцій проходить через центри кружечків
(`#stationRail .track` top 21 → 16 px; зміщення центрів 0 px на desktop 1280×720 і
mobile 412×860), назва `Gelatin Water` у заголовку вкладки й GUI замінена на
`Edge of the Elements`; `probe-scene-rail`, `probe-scene-mobile` PASS після правки.

Небо, атмосфера й сонце переїхали з `src/scene/` у
модуль `src/environment/` (`index.js` → `createEnvironment`, `atmosphere.js`,
`skyBake.js`, `skyBackground.js`, `sun.js`, `measure.js`, копія `fullscreen.js`);
сонце → `DirectionalLight` і тінь — `src/environment-bindings/hostBinding.js`.
`main.js` створює оточення через `createEnvironment` і передає `env` у воду й
рельєф; у консолі тепер `app.env` (було `app.sky`): `app.env.params`,
`app.env.sun.direction`, `app.env.sun.color`, `app.env.cube`. **На екрані не має
змінитися нічого.**

Guard зелений за 0.24 с (BOUNDARY-2 тепер `environment-portable — 7 файл(ів)`,
OWNER-4 6 — без змін, TYPES-1 21, TEX-1 16). `npm test` 66/66, lint без нових
попереджень, `npm run build` + `verify:dist` OK. Проби (AMD Radeon 890M, Chromium
ANGLE D3D11, `errors=[]`):

| проба | результат |
|---|---|
| нова `probe-scene-env-identity` (еталон знято на коді до перенесення) | PASS 25.1 с: 5 шотів — кадр Δ 0/255, куб Δ 0, `sunDir`/`sunColor` Δ 0 |
| `probe-scene-env-measure` (E0) | PASS 7.5 с; pmrem 30.85, pmrem256 3.07 мс |
| `probe-scene-mobile` | PASS 17 с |
| `probe-scene-rail` | PASS 87 с |
| `probe-scene-ui` | PASS 43 с (у E0 падав на `strip after tap` і без змін — тут не відтворилось) |
| втрата/відновлення контексту (`WEBGL_lose_context`, разовий скрипт) | куб і сонце після відновлення ті самі, `errors=[]` |

Як працює `probe-scene-env-identity`: кожен шот — свіжа сторінка з `?still&desktop`
(цикл кадрів не стартує), `Math.random` засіяний перед `app.still()`;
`app.still({ shot, frames: 45 })` рендерить 45 кадрів із dt = 1/60 і чекає GPU та
зчитування висот води після кожного. Порівнюються RGBA кадру 1280×720, кожен 8-й
тексель шести граней куба й `sunDir`/`sunColor`. Еталон —
`PROBE_MODE=capture`, за замовчуванням у `%TEMP%/scene-env-identity`.
Чутливість перевірено мутаціями: висота хмар `CLOUD_H` 2.5 → 2.52 км — куб Δ 4.9e-3 >
1/255, FAIL; сила сонячного світла ×1.02 у `hostBinding` — `Lagoon`: 9 каналів > 1/255,
FAIL (автоекспозиція гасить більшу частину різниці).

### QA-E1-1. Шоти виглядають так само, як до E1

**qa:mode:** browser
**qa:open:** `http://localhost:5199/?controls&tiles=story-8-frames-hibrid`
**qa:action:** Controls → `view` → по черзі `Golden hour`, `Lagoon`, `Aerial`, `Tiles`
(для `Tiles` дочекатися, поки поле тайлів з'явиться).
**qa:inspect:** небо, диск сонця, відбиття неба у воді, тіні острова й скель,
освітлення тайлів.
**qa:expected:** кожен шот такий самий, як на E0-драфті
`https://6b043360ba4b5c42bcbf5c10--edge-of-elements.netlify.app/?controls&tiles=story-8-frames-hibrid`:
у `Golden hour` низьке помаранчеве сонце з доріжкою на воді, у `Lagoon` бірюзове
мілководдя під високим сонцем, без чорного неба, без пласкої сірої води, без
темних схилів. Попіксельно покрито `probe-scene-env-identity` (Δ 0/255); очима — те,
що проба не бачить у русі (мерехтіння, стрибки).

### QA-E1-2. Підводний вигляд

**qa:mode:** browser
**qa:open:** `http://localhost:5199/?controls`
**qa:action:** Controls → `view` → `Underwater`.
**qa:inspect:** поверхня води знизу, промені світла, кольори дна.
**qa:expected:** знизу видно світле вікно неба на поверхні, промені світла від
сонця й синьо-зелене дно рифу, як до E1. Сцена не чорна, екран не мерехтить. Покрито
`probe-scene-env-identity` (шот `Underwater`, Δ 0/255).

### QA-E1-3. Сонце з GUI рухає небо, світло й тінь

**qa:mode:** browser
**qa:open:** `http://localhost:5199/?controls`
**qa:action:** Controls → Sun & sky → потягнути `elevation` з ~50 до 5 і
відпустити; потім `cloudCoverage` до 0.9.
**qa:inspect:** небо, острів, тіні, відбиття у воді.
**qa:expected:** при 5° небо біля горизонту жовтіє, острів освітлений теплим
низьким світлом, тіні довгі; при `cloudCoverage` 0.9 небо майже суцільно в хмарах,
і їхнє відбиття видно у воді. Небо, світло й вода змінюються разом, без кадру, де
одне відстає. Частково покрито `probe-scene-env-measure` (зміна сонця дає рядок `sky`).

### QA-E1-4. Відновлення після втрати контексту WebGL

**qa:mode:** browser
**qa:open:** `http://localhost:5199/`
**qa:action:** DevTools → Console:
`window.__lc = app.renderer.getContext().getExtension('WEBGL_lose_context'); __lc.loseContext();`
за 1 с — `__lc.restoreContext();`
**qa:inspect:** сцена; консоль.
**qa:expected:** після `loseContext` картинка застигає або гасне; після
`restoreContext` за 1–3 с повертається те саме небо, сонце, вода й тіні, як до втрати.
У консолі немає червоних помилок (попередження three про втрату контексту — нормально).
Автоматично перевірено разовим скриптом: сума текселів куба й `sunDir` до/після рівні.

### QA-E1-5. Measure sky працює після перенесення

**qa:mode:** browser
**qa:open:** `http://localhost:5199/?fps`
**qa:action:** натиснути **Measure sky** у панелі FPS.
**qa:inspect:** HUD під кнопками.
**qa:expected:** спершу `measuring sky…`, через 5–15 с — `sky change (ms, 10×): lut … cube …
pmrem … pmrem256 …` і `shadow … spectrum … (W×H)`, ті самі шість чисел, що в E0
(на 890M pmrem ~31 мс); після виміру хвилі рухаються знову. Покрито `probe-scene-env-measure`.

### QA-E1-6. Хук `?still` — кадр без часу

**qa:mode:** browser
**qa:open:** `http://localhost:5199/?still&desktop`
**qa:action:** DevTools → Console: `(await app.still({ shot: 'Lagoon', frames: 45 })).shot`
**qa:inspect:** сцена; результат у консолі.
**qa:expected:** до виклику сцена не рухається (цикл кадрів не запущено); виклик
повертає `'Lagoon'` за ~2–5 с (890M — 3.9 с), на екрані застиглий кадр `Lagoon`. Без `?still`
`app.still()` кидає `app.still needs ?still`. Використовує `probe-scene-env-identity`.

### Свідомо не зроблено в E1

- **API спеки §5.3 — не весь:** `setState`, `update(dt)` → `{ sunChanged, cubeChanged }`,
  `on('sun-changed')`, `ambient`, `restoreContext()` не з'явилися. `env.update()`
  поки що, як і раніше, перепікає все синхронно, а відновлення контексту робить
  `main.js` (`sunDirty = true`). Це E2 (стан і τ-згладжування) і E3.
- `state.js`, `mood.js`, `ldr.js`, `ui/moodPad.js`, `seaBinding.js` — не тут
  (E2, mood-weather M1a/M1b, E3).
- **`fullscreen.js` — копія** `engine/fullscreen.js` (спека §5.2): правку одного треба
  повторити в іншому руками. Через копію three на завантаженні створює на одну
  геометрію й камеру більше — вигляд не змінює.
- Писарів сонця досі 6 (OWNER-4); їх зменшує mood-weather M1a.

## E0. Заміри зміни неба

**Прийнято власником через `handoff:next` 2026-11-23.** Драфт: `https://6b043360ba4b5c42bcbf5c10--edge-of-elements.netlify.app/`
(`probe-scene-env-measure` з `PROBE_BASE` — PASS 11.1 с, pmrem 28.3 / pmrem256 2.6 мс на prod-збірці). Guard зелений за 0.29 с (OWNER-4 6 — без змін,
TYPES-1 21, TEX-1 16). `npm test` 66/66 (3 нові — подвійний дотик), lint без нових попереджень. Проби (AMD
Radeon 890M, Chromium ANGLE D3D11, `errors=[]`): нова `probe-scene-env-measure`
PASS 7.3 с; регресія `probe-scene-mobile` PASS 18.9 с. `probe-scene-ui` — FAIL
`?tiles=story-8-frames-hibrid: strip after tap` (три пальці на полі історії не
показують смужку), **так само й без змін E0** (код відкочено через `git stash`,
2 прогони з E0 і 1 без) — незалежна вада, до E0 не належить; решта кроків
проби до неї проходять.

Що змінилося: `sky.update()` розкладено на три кроки (`updateSun`, `bakeLuts`,
`bakeCube`) без зміни поведінки; зміна неба в кадрі тепер іде всередині кадру
GPU-таймера з міткою `sky`. Нове: `app.measureEnvironment({ repeats })` і кнопка
**Measure sky** у панелі FPS — вимірюють кожен крок зміни неба окремо (час між
двома GPU-fence, тож працює й без розширення таймера на телефоні). Під час
виміру сцена стоїть кілька секунд.

Заміри desktop (AMD Radeon 890M, 1280×720, куб 1024², тінь 4096²; три прогони
по 10 і 30 повторів):

| крок | мс |
|---|---|
| LUT атмосфери | 0.5–1.6 |
| 6 граней куба + mip | 3.4–5.0 |
| **PMREM куба** | **33.8–39.0** |
| тінь сонця 4096² | 0.05–0.6 (2 draw calls: рельєф і скелі) |
| `updateSpectrum` | 0.2–0.6 |
| разом на одну зміну неба | 39.5–43.5 |

Висновок для спеки §4 (desktop): ~85 % вартості — PMREM, який three будує з куба 1024²
для `scene.environment`; варіанти A–D зменшують лише куб (≤ 5 мс). PMREM
читають тільки `MeshStandardMaterial` (рельєф, скелі, поплавці, тайли — усі
шорсткі), вода бере куб напряму. Рішення §4 — нижче, за замірами телефона.

Автоматично: `node scripts/probe-scene-env-measure.mjs` — рядок `sky` у HUD
після зміни сонця (`?fps`), п'ять скінченних чисел > 0, тінь перемальовує
casters, сонце після виміру те саме, цикл рендеру відновлюється, кнопка
Measure sky друкує таблицю в HUD. `PROBE_REPEATS=30` — більше повторів.

### QA-E0-1. Зміна сонця дає рядок `sky` у GPU-таймерах

**qa:mode:** browser
**qa:open:** `http://localhost:5199/?debug`
**qa:action:** Controls → Sun → потягнути `elevation` на кілька градусів і відпустити.
**qa:inspect:** панель FPS, блок `GPU timers` під графіком.
**qa:expected:** серед міток (`sim.fft`, `opaque`, `water`, `post`…) з'являється
рядок `sky` з числом мс і лишається там. Покрито `probe-scene-env-measure`.

### QA-E0-2. Measure sky на desktop: таблиця в HUD, сцена жива після виміру

**qa:mode:** browser
**qa:open:** `http://localhost:5199/?fps`
**qa:action:** натиснути кнопку **Measure sky** у панелі FPS (під «Uncap FPS»).
**qa:inspect:** HUD під кнопками; сама сцена.
**qa:expected:** спершу `measuring sky…`, через 5–15 с — два рядки
`sky change (ms, 10×): lut … cube … pmrem …` і `shadow … spectrum … (W×H)`;
pmrem — найбільше число (на 890M ~35 мс). Сцена кілька секунд стоїть, потім
хвилі рухаються знову; небо, світло й тінь острова такі самі, як до виміру
(без спалаху чи темних схилів).

### QA-E0-3. Заміри на телефоні власника

**qa:mode:** browser
**qa:open:** на телефоні власника `https://6b043360ba4b5c42bcbf5c10--edge-of-elements.netlify.app/?fps`
(або `http://<IP ПК>:5199/?fps` зі стендом з `--host`)
**qa:action:** дочекатися, поки сцена оживе (~10 с); натиснути **Measure sky**;
коли з'явиться таблиця, натиснути ще двічі; потім двічі швидко торкнутися тексту
панелі (не кнопки) і вставити буфер обміну в повідомлення агенту.
**qa:inspect:** два рядки `sky change …` у HUD після кожного натискання.
**qa:expected:** три набори з п'яти чисел (lut, cube, pmrem, shadow, spectrum) і
розмір кадру; після подвійного дотику рамка панелі на мить блакитна, у буфері —
рядок GPU, профіль, FPS, рядки `sky change …` і User-Agent. Сторінка не
перезавантажується й не втрачає контекст WebGL. Desktop-проба цього не замінює.

Телефон власника — **Samsung Xclipse 540** (ANGLE on Vulkan 1.3.279, Chrome 157
Android), mobile profile, 2× MSAA; 2026-11-23, три прогони 10× (460×834, 422×764,
384×695), до появи `pmrem256`:

| крок | Xclipse 540, мс | 890M, мс |
|---|---|---|
| lut | 1.28–1.31 | 0.4–1.6 |
| cube | 8.73–9.06 | 1.7–5.0 |
| **pmrem** | **268.6–280.3** | 26.5–39.0 |
| pmrem256 | **20.39** (окремий прогін, 460×834, PMREM 1024² у ньому — 268.3) | 2.1–3.7 |
| shadow | 0.74–1.61 | 0–0.6 |
| spectrum | 0.95–1.01 | 0.2–0.6 |

Одна зміна неба на телефоні — ~280 мс, з них PMREM 96 %: кожен рух сонця зараз —
зупинка картинки на чверть секунди. PMREM із копії куба 256² — у 13 разів дешевше (20.4 мс):
зміна неба з ним ≈ 33 мс (lut 1.4 + cube 9.1 + pmrem256 20.4 + тінь 1.8).

### QA-E0-4. Подвійний дотик по панелі FPS копіює її текст

**qa:mode:** browser
**qa:open:** `https://6b043360ba4b5c42bcbf5c10--edge-of-elements.netlify.app/?fps` на телефоні
**qa:action:** натиснути **Measure sky**, дочекатися таблиці; двічі швидко торкнутися
числа FPS; вставити буфер обміну в будь-яке текстове поле.
**qa:inspect:** рамка панелі FPS; вставлений текст.
**qa:expected:** рамка панелі на ~1 с стає блакитною (червона — копіювання не
вдалося); сторінка не масштабується; вставлено кілька рядків: GPU, розмір кадру й
профіль, FPS, GPU timers (якщо є), `sky change (ms, 10×): …`, `shadow … spectrum …`,
User-Agent. Подвійний дотик по кнопці нічого не копіює. Покрито
`probe-scene-env-measure` (подвійний клік) і ручною перевіркою дотиком у
мобільному профілі Chromium.

### Свідомо не зроблено в E0

- **Пастка, знайдена в E0:** спільний `PMREMGenerator` three (`WebGLEnvironments`)
  перевикористовує кешований target, не перебудовуючи сітки й шейдери під інший
  розмір; після PMREM куба 256² через нього PMREM куба 1024² рахувався за ~1 мс і
  неправильно. `measureEnvironment` бере для 256² власний генератор; проба ловить
  регресію (друге вимірювання PMREM ≥ 0.5 першого).

- **Рішення §4 записане в [DECISIONS.md](../../DECISIONS.md)** («Оточення: оновлення
  неба в часі»): куб 1024² для води, PMREM із копії 256² лише в спокої, у русі —
  грань за кадр. Реалізація — E2; у E0 код не змінює вигляд.
- **GPU-таймер у headless Chromium** не віддає результатів (8 запитів у черзі,
  `opaque` > 1000 мс) — тому заміри йдуть за GPU-fence, а не за таймером.
- Вигляд сцени не змінювався, тож знімків до/після немає — це критерій E1.
