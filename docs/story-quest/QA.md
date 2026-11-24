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
