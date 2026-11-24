# QA: story-quest

Локально з каталогу `D:/work/_tools/water-3d/Ultra-Water`: `npm install`, потім
`npm run dev`. Стенд — `http://localhost:5199/`; якщо вже працює, другий процес
не запускати. Для каталогу R2 потрібен інтернет. За правилом `AGENTS.md` стенд
лишається запущеним після рев'ю.

Тестовий набір історій (рішення власника 2026-11-24):

- `my-day-3-moments` — `https://cdn.storytilecraft.cc/test-2025/my-day-3-moments.json`;
- `frog-fairy-full` — `https://cdn.storytilecraft.cc/public-test/frog-fairy-full.json`;
- білка гібридом — фікстура `?tiles=story-8-frames-hibrid`.

Список історій папки — `…/<папка>/index.json`.

## Q1. Каталог і оболонка продукту

**Прийнято власником через `handoff:next` 2026-11-24** (після рев'ю — рамка виділення за `frame.points`). Рівні:

- **guard** зелений 0.25 с: BOUNDARY-3 — `tiles/tilecraftLoader.js 7, catalog/tilecraftCatalog.js 1 import(ів)`,
  новий BOUNDARY-4 — `1 файл(ів) products/, 1 import(ів) з src/`, OWNER-3 0, TYPES-1 0.
  Мутації: `src/main.js` + `import '../products/story-quest/main.js'` → ✗ BOUNDARY-4;
  `@tilecraft/lib/story-catalog.js` у `src/catalog/catalog.js` і в
  `products/story-quest/main.js` → ✗ BOUNDARY-3; без `products/` → ✗ BOUNDARY-4
  «правило дивиться не туди».
- **focused:** `tests/catalog.test.js` 14 + `tests/storyFrames.test.js` 5 +
  `tests/frameQuad.test.js` 3 — 22 passed. `npm test` — 13 файлів, 183 passed.
  `npm run lint` — лише 2 давні попередження проб.
- **рамка виділення** (рев'ю власника): `probe-frame-land` PASS 25 с,
  `probe-frame-drag` PASS 86 с, `probe-story-q1` PASS 55.5 с після зміни.
- **probe:** `scripts/probe-story-q1.mjs` PASS 56.7 с (dev); з
  `PREVIEW_URL=http://127.0.0.1:4173/` — PASS 62.6 с (dev + preview).
  `npm run test:build` і `npm run test:portability` — зелені.
  `?tiles=none` + `runBenchmark(60, { shot: 'Golden hour' })` — 8.7 мс, без помилок.

Що виміряно (`?story=` проти тієї ж моделі, кинутої файлом, — поля однакові):

| історія | тайли | кадри | групи | поле, м | зсув вмісту, м (Q0) |
|---|---|---|---|---|---|
| `test-2025/my-day-3-moments` | 13 046 | 3 | 593 | 41.46 × 9.30 | 0.03 (0) |
| `public-test/frog-fairy-full` | 39 092 | 10 | 1 729 | 78.01 × 22.93 | 0.01 (**2199**) |
| `?tiles=story-8-frames-hibrid` = `?story=local/story-8-frames-hibrid` | 46 861 | 8 | 2 213 | 84.88 × 30.65 | 0.17 / 0.18 |

- **Адреса історії** — `?story=<папка>/<історія>`; голий slug — папка
  `public-test`. Папки — `public-test`, `test-2025`; у dev ще `local` (фікстури
  Tilecraft `viewer/engines/three/fixtures/catalog/`, віддає лише dev-сервер,
  у `dist` їх немає). Посилання переписується з `/` як `%2F` — читається так само.
- **Приведення до кадрів** працює для всіх джерел (фікстура, файл, каталог):
  жаба втрачає 5 тайлів без кадру, у консолі `[tiles] …: 5 tile(s) outside
  visible frames`. Фікстури не змінились (тайлів без кадру в них немає).
- **Форму тайлів не змінювали:** історії каталогу лишаються суцільною
  полілінією, як в R2 (статус `Warning: polyline tile 1.9 / 7.6 m > 1 m`).
- **Рамка виділення — авторський кадр** (`frame.points` моделі), а не прямокутник
  тайлів. До цього рамка бралася з меж тайлів (з FD4): у `my-day-3-moments` тайли
  кадру 2 займають 145 з 196 одиниць по y, і рамка кінчалася на ~2 м раніше за
  кадр — низ ноутбука виходив за неї. Кадр без `points` (модель без кадрів) — як
  раніше, за тайлами.
- **Оболонка** `products/story-quest/` — та сама сцена плюс рядок стану історії
  (uk / en за мовою браузера). CSS сторінки сцени винесено з `index.html` у
  `src/ui/scene.css`, його читають обидві сторінки.

### QA-Q1-1. Жаба з каталогу лягає на своє поле

Проба це перевіряє (кількості, зсув < 1 м); власник дивиться очима.

**qa:mode:** browser
**qa:open:** `http://localhost:5199/?story=public-test/frog-fairy-full`
**qa:action:** нічого; дочекатися, поки камера перелетить до поля.
**qa:inspect:** центр кадру; Controls → Tiles → `status` і `story`.
**qa:expected:** у кадрі 10 кадрів жаби двома рядами по п'ять на воді. Статус
`… 39092 tiles · 1729 groups · polyline` з попередженням про 7.6 м, рядок
`story` — `public-test/frog-fairy-full · ready`. Заміщує QA-Q0-2: тепер це
очікувана поведінка, а не дефект.

### QA-Q1-2. Оболонка продукту піднімає історію

**qa:mode:** browser
**qa:open:** `http://localhost:5199/products/story-quest/?story=test-2025/my-day-3-moments`
**qa:action:** нічого.
**qa:inspect:** заголовок вкладки, верх екрана, поле історії.
**qa:expected:** вкладка `Story Quest`. Поки модель вантажиться, вгорі видно рядок
`Завантажуємо історію «test-2025/my-day-3-moments»…` (en: `Loading the story …`);
щойно історія лягла, рядок зникає. На воді 3 кадри в ряд. Рейка, кнопка погоди й
Controls ті самі, що на `/`.

### QA-Q1-3. Оболонка без історії пропонує список

**qa:mode:** browser
**qa:open:** `http://localhost:5199/products/story-quest/`
**qa:action:** нічого; потім клікнути перше посилання списку.
**qa:inspect:** рядок стану вгорі.
**qa:expected:** текст `Історію не вибрано. Додайте до адреси ?story=<папка>/<історія>, наприклад:`
(en: `No story chosen. …`) і 8 посилань виду `Fairy Frog story (public-test/frog-fairy-full)`.
Клік відкриває ту саму оболонку з `?story=…`; рядок зникає, щойно історія лягла.

### QA-Q1-4. Хибна адреса історії

**qa:mode:** browser
**qa:open:** `http://localhost:5199/products/story-quest/?story=public-test/no-such-story`
**qa:action:** нічого.
**qa:inspect:** рядок стану вгорі (червона рамка); Controls → Tiles → `status`.
**qa:expected:** `Такої історії в каталозі немає.`, під ним `Інші історії:` і список
посилань. Статус `error: HTTP 404`. Сцена працює далі. З
`?story=nonsuch/x` текст — `Адреса історії має вигляд ?story=<папка>/<історія>.`,
статус `error: Unknown story «nonsuch/x»`.

### QA-Q1-5. Немає мережі до R2 — повідомлення й локальні історії

Проба це перевіряє (`route.abort` для `storytilecraft.cc` і `r2.dev`).

**qa:mode:** browser
**qa:open:** `http://localhost:5199/products/story-quest/?story=public-test/frog-fairy-full`
**qa:action:** F12 → Network → ⋮ → More tools → Network request blocking →
Enable, додати `*storytilecraft.cc*` і `*r2.dev*`; оновити сторінку (F5).
**qa:inspect:** рядок стану вгорі.
**qa:expected:** `Немає зв’язку з каталогом історій. Перевірте інтернет і оновіть сторінку.`,
далі `Каталог недоступний — ось локальні історії для розробки:` і три посилання
`local/story-8-frames-polygon`, `-polyline`, `-hibrid`. Клік на `hibrid` кладе
білку (8 кадрів, 46 861 тайл). Після перевірки — вимкнути blocking.

### QA-Q1-6. Оболонка в зібраному `dist`

Проба це перевіряє з `PREVIEW_URL`.

**qa:mode:** browser
**qa:open:** термінал у `D:/work/_tools/water-3d/Ultra-Water`: `npm run build`, потім
`npm run preview`; у браузері `http://127.0.0.1:4173/products/story-quest/?story=test-2025/my-day-3-moments`
**qa:action:** нічого; після перевірки зупинити preview (Ctrl+C).
**qa:inspect:** поле історії; консоль (F12).
**qa:expected:** 3 кадри на воді, як у QA-Q1-2; у консолі немає помилок CORS.
З `?story=local/story-8-frames-hibrid` — `Адреса історії має вигляд …`: локального
каталогу в зібраному продукті немає.

### QA-Q1-7. Стала адреса драфту продукту

**qa:mode:** cli
**qa:open:** термінал у `D:/work/_tools/water-3d/Ultra-Water`.
**qa:action:** `npm run deploy:check -- --alias story-quest`
**qa:inspect:** останні рядки виводу.
**qa:expected:** `Netlify draft target: edge-of-elements · alias story-quest → https://story-quest--edge-of-elements.netlify.app`
і `Prepared (no upload): netlify "deploy" … "--alias" "story-quest"`. З
`--prod --alias story-quest` — `Error: --alias is for drafts; production has no alias`.

### QA-Q1-8. Guard тримає межу «products → src»

**qa:mode:** cli
**qa:open:** термінал Git Bash у `D:/work/_tools/water-3d/Ultra-Water`.
**qa:action:** `npm run guard`
**qa:inspect:** рядки BOUNDARY-3 і BOUNDARY-4.
**qa:expected:** `✓ BOUNDARY-3 tilecraft-entry — tiles/tilecraftLoader.js 7, catalog/tilecraftCatalog.js 1 import(ів)`
і `✓ BOUNDARY-4 products-on-src — 1 файл(ів) products/, 1 import(ів) з src/`;
останній рядок `guard … с`, код виходу 0.

### QA-Q1-9. Рамка виділення йде по межах кадру

**qa:mode:** browser
**qa:open:** `http://localhost:5199/?story=test-2025/my-day-3-moments`
**qa:action:** дочекатися поля (камера `Tiles`); клікнути по ноутбуку в середньому кадрі.
**qa:inspect:** жовта рамка навколо кадру.
**qa:expected:** рамка — прямокутник кадру (13 × 9.8 м), трохи повернутий, як у
моделі; ноутбук, ваза й килимок під мишу цілком усередині, знизу під ноутбуком
лишається смуга води (~1–2 м). Те саме для кадру з вікном: вікно під самим верхнім
краєм, але всередині. Рамка нерухома, поки вода гойдає малюнок.

### Свідомо не зроблено в Q1

- **Форма тайлів каталогу** — як в R2 (полілінія); модифікатор Tilecraft не
  застосовується. Контакт мініатюр з рельєфом перевіряє Q3 саме на цих історіях.
- **Fingerprint історії** з каталогу — `null` у payload: клієнт Tilecraft віддає
  розібраний об'єкт, байтів немає. Ключ сховища (slug + fingerprint) — Q6.
- **Вибір історії в Controls** — лише `?story=`; вибір зі списку — UI продукту (Q7).
- **Телефон і LAN-IP у CORS** — як у Q0, не зроблено; Netlify-драфт з alias не
  викладався (лише `deploy:check`).

## Q0. Розвідка: каталог без sidecar, CORS, імпорт з Tilecraft

**Прийнято власником через `handoff:next` 2026-11-24.** Guard зелений 0.33 с (BOUNDARY-3 7 import-ів, OWNER-3 0,
TYPES-1 0). `src/` не змінювався; `npm test` не запускався. Проба
`scripts/probe-story-q0.mjs` пройшла за 37.1 с; її асерти — кадри в полі = `frameCount` каталогу, без
помилок сторінки.

Що виміряно:

| історія | тайли | кадри | розмір поля, м | зсув вмісту від центру поля, м | компіляція + rest, мс (desktop) |
|---|---|---|---|---|---|
| фікстура `story-8-frames-polygon` | 46 861 | 8 | 84.9 × 30.7 | 0 | 55 + 154 |
| `squirrel-ginger-8fr` | 46 861 | 8 | 84.9 × 30.7 | 0.1 | 617 + 1270 |
| `frog-fairy-2fr` | 4 691 | 2 | 55.9 × 18.2 | **3960** | 46 + 107 |
| `frog-fairy-full` | 39 092 | 10 | 78.0 × 22.9 | **2199** | 561 + 758 |
| `my-day-3-moments` (`test-2025/`) | 13 046 | 3 | — | 0 | 222 + 333 |
| фікстура `story-8-frames-hibrid` | 46 861 | 8 | — | 0.2 | 542 + 1016 |

Остання проба (40.6 с) іде вже за тестовим набором: `my-day-3-moments`,
`frog-fairy-full`, фікстура `story-8-frames-hibrid`. Браузер на `localhost:5199`
читає `index.json` обох папок з обох адрес — `ok 200`. Перші чотири рядки
таблиці — з попереднього прогону за `public-test/index.json`.

- **§7 п.1 закрито:** sidecar лише нахиляє площину кадру в 3D. Ultra-Water його
  не читає, а sidecar фікстури порожній. Білка з каталогу лягає точно як фікстура.
- **Жаба невидима.** У кожній моделі жаби 5 тайлів полілінії без кадру
  (`f` не задано) з координатами до 187 808 одиниць (≈ 9.4 км). Tilecraft
  центрує простір з урахуванням цих тайлів, а наше поле вважає вміст розташованим навколо нуля. Тому
  історія лягає за 2–4 км від свого місця, за межею рельєфу (1200 м).
  Рішення власника — приведення історії до кадрів, як у Tilecraft
  (`story-preview-renderer.js`: межі — видимі кадри, тайли без кадру не
  належать аркушу); реалізує Q1. Перевірено на копії моделі без цих 5 тайлів:
  зсув 0 м для обох жаб, усі 10 кадрів `frog-fairy-full` на воді.
- **Усі три історії каталогу — суцільна полілінія.** Фікстура за
  замовчуванням (`story-8-frames-hibrid`) і `-polygon` проходять через
  модифікатор Tilecraft. Статус поля для каталогу: `polyline tile 7.0–14.2 m > 1 m; terrain
  contact accuracy not guaranteed`. Яку форму брати — рішення Q1.
- **CORS:** власник додав origin зі спеки §5.1 у правило `stories` 2026-11-24.
  `curl` з `Origin` повертає `Access-Control-Allow-Origin` для всіх п'яти origin
  (`localhost:5199`, `127.0.0.1:5199`, `127.0.0.1:4173`, обидва Netlify) і від
  `cdn.`, і від `r2.dev`: `index.json` і модель — 15/15. Браузер на
  `http://localhost:5199` читає `index.json` з обох адрес: `ok 200` (проба,
  44.2 с). До правила відповідь була без заголовка й `Failed to fetch`.
  LAN-IP для телефона в правилі ще немає.
- **Імпорт з Tilecraft:** `sheet-motion.js` (`moveOnSheet`), `avatar.js`
  (`createGamifierAvatar` → `THREE.Group` нашого three), `characters.js`,
  `camera-pose.js`, `pointer-channels.js`, `gamifier-input/-pad/-stick.js`
  імпортуються з dev-стенда без помилок. Ввід (`-input/-pad/-stick`) пише в DOM і
  працює через `control()` гейміфаєра — 22 члени (`command`, `aim`, `power`,
  `strike`, `view.mode`…). Без перехідника під наш персонаж його не взяти.

### QA-Q0-1. Білка з каталогу лягає як фікстура

**qa:mode:** browser
**qa:open:** `http://localhost:5199/?tiles=story-8-frames-polygon&controls`
**qa:action:** дочекатися поля; Controls → camera → `Tiles`; потім перетягнути
у вікно файл `squirrel-ginger-8fr.json` (завантажити з
`https://cdn.storytilecraft.cc/public-test/squirrel-ginger-8fr.json`) і знову
camera → `Tiles`.
**qa:inspect:** поле історії в центрі кадру; Controls → Tiles → `status`.
**qa:expected:** обидва рази 8 кадрів у два ряди по чотири на тому самому місці;
у білки статус `46861 tiles · 2213 groups · polyline` з попередженням про 7.0 м,
у фікстури — `46861 tiles · 2213 groups · polygon`. Мазки білки тонші,
кадри ті самі.

### QA-Q0-2. Жаба з каталогу зникає з кадру

**qa:mode:** browser
**qa:open:** `http://localhost:5199/?controls`
**qa:action:** перетягнути у вікно `frog-fairy-2fr.json` (з
`https://cdn.storytilecraft.cc/public-test/frog-fairy-2fr.json`); Controls →
camera → `Tiles`.
**qa:inspect:** центр кадру; Controls → Tiles → `status`; консоль (F12):
`app.tiles.group.children[0].geometry.boundingSphere.center`.
**qa:expected:** статус `4691 tiles · 154 groups · polyline` (попередження про
14.2 м), рейка показує `Moment 1/2`, а на воді в кадрі нічого немає. У консолі
центр геометрії має x ≈ 3780 (локально). Це дефект, який виправить Q1, а не регресія.
**З Q1 заміщено QA-Q1-1:** жаба лягає на поле, 10 кадрів видно.

### QA-Q0-3. CORS для origin стенда

**qa:mode:** cli
**qa:open:** термінал Git Bash, будь-який каталог.
**qa:action:**
`for o in http://localhost:5199 http://localhost:8080; do curl -s -o /dev/null -D - -H "Origin: $o" https://cdn.storytilecraft.cc/public-test/index.json | grep -i '^access-control-allow-origin' || echo "$o: немає"; done`
**qa:inspect:** вивід команди.
**qa:expected:** два рядки:
`Access-Control-Allow-Origin: http://localhost:5199` і
`Access-Control-Allow-Origin: http://localhost:8080`. Порожній перший рядок
означає, що origin випав із правила або записаний зі `/` у кінці.

### Свідомо не зроблено в Q0

- **Заміри на телефоні** (базовий fps з історією ≤ 10 кадрів) — лише власник.
  Desktop-час компіляції в таблиці вище — орієнтир, не бюджет телефона.
- **CORS з браузера** перевірено лише з `localhost:5199`; для `127.0.0.1:4173`
  і Netlify — тільки `curl` з `Origin` (сторінок на них ще немає, Q1).
  LAN-IP телефона — не в правилі.
- **Жаба й форма тайлів** не виправлялися: це рішення Q1, Q0 лише виміряла.
