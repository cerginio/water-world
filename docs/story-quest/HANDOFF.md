# Handoff: story-quest — перший продукт на платформі Ultra-Water

Стан на 2026-11-25. Фази з [STORY-QUEST-SPEC.md](../../STORY-QUEST-SPEC.md)
(далі — «спека»). Q0, Q1, Q2a, Q2b і Q3 закрито й закомічено: каталог R2, `?story=`,
оболонка `products/story-quest/`, персонаж ходить островом «очима», старт «огляд →
очі», «поза тілом», стік, мініатюри на суші (`&minis`) і гідратація у воді.
QA — [QA.md](QA.md).

> **Далі:** Q4 — пліт і кайт.

Локальний стенд: `http://localhost:5199/`; правило стенду — `AGENTS.md` →
«Локальний стенд». Tilecraft (`TILECRAFT_ROOT`) лише читається.

## НЕЗАКРИТЕ — почни звідси

Розбиття погоджено з власником 2026-11-24: Q2 спеки розділено на Q2a і Q2b;
оболонка `products/story-quest/` і guard «products → src» — у Q1, а не в Q7.

| фаза | чекає на |
|---|---|
| ~~Q0~~ | закрито 2026-11-24 |
| ~~Q1~~ | закрито 2026-11-24 |
| ~~Q2a~~ | закрито 2026-11-24 |
| ~~Q2b~~ | закрито 2026-11-25 (fps на телефоні — за власником, QA-Q2b-7) |
| ~~Q3~~ | закрито 2026-11-25 (розмір 1/8 на телефоні — за власником, QA-Q3-7) |
| Q4 | Q3 |
| Q5 | Q3 (долі кадру; пліт Q4 — для фіналу «в морі») |
| Q6 | події Q1–Q5; логіку можна почати раніше на фікстурі |
| Q7 | Q2b, Q4, Q5, Q6 |

Тестовий набір історій для всіх фаз (рішення власника 2026-11-24), він же
в `scripts/probe-story-q0.mjs`:

| історія | звідки | чим цікава |
|---|---|---|
| `my-day-3-moments` | R2 `test-2025/` | 3 кадри, 13 046 тайлів, полілінія ≤ 1.9 м |
| `frog-fairy-full` | R2 `public-test/` | 10 кадрів, 39 092 тайли; 5 тайлів без кадру за ~9 км |
| `story-8-frames-hibrid` | фікстура Tilecraft (модифікатор) | 8 кадрів, 46 861 тайл, polygon + polyline |

Guard для всіх фаз: `npm run guard` зелений (OWNER-1…5, BOUNDARY-1…3,
BUDGET-1, TEX-1, TYPES-1); `npm test` зелений; `?tiles=none` і
`runBenchmark({ shot })` поводяться як до фази. Порядок перевірок —
guard → focused → probe ([TESTING.md](../../TESTING.md#рівні-прогону)).
Камеру пише лише `src/scene/cameraRig.js` (OWNER-3): камери персонажа йдуть
через нього, не повз.

~~1. **Q0 — розвідка** (спека §7 п.1, §5.1, §8 Q0). Spike: модель з R2 без
   `.frames.json` на воді, CORS з `Origin`, імпорт модулів персонажа й вводу
   з Tilecraft, проба `scripts/probe-story-q0.mjs`.~~ — ЗАКРИТО 2026-11-24;
   §7 п.1 записано в спеку (sidecar не потрібен); числа — QA.md Q0, факти —
   нижче. Заміри на телефоні не зроблено — відкрите питання.

~~2. **Q1 — каталог і оболонка продукту** (спека §4.1 «Каталог», §4, §5.1).
   `src/catalog/`: `list()`, `load(slug, { signal })`, стани
   `pending/ready/failed`, події; модель тим самим шляхом, що фікстура;
   `?story=<slug>`. **Приведення історії до кадрів** (рішення власника
   2026-11-24, те саме правило, що в Tilecraft `core/story-preview-renderer.js`
   для admin-прев'ю й у three): історія — це видимі кадри (`!frame.hid`); тайли,
   чий `tile.f` не є id видимого кадру, відкидаються до компіляції. Інакше
   `computeBounds` Tilecraft центрує простір і на них — жаба з каталогу лягала
   за 2199 / 3960 м від поля (Q0). Каталог має папки (`test-2025/`,
   `public-test/`, у кожної свій `index.json`): адреса історії — папка + slug,
   як `forCatalog({ folder, scope })` у `lib/story-catalog.js`; форму
   `?story=` фаза вирішує сама. Порожня оболонка `products/story-quest/index.html`, що
   піднімає сцену з `?story=` (друга сторінка збірки: `build.rollupOptions.input`,
   `verify-dist`). `--alias story-quest` у `scripts/deploy-netlify.mjs` для
   драфтів.
   - guard: BOUNDARY-3 розширюється списком входів (вхід каталогу); **новий
     рядок** «products → src» (`src/**` не імпортує `products/**`) поруч із
     BOUNDARY-2, з мутацією, що його валить.
   - focused: юніти `src/catalog/` (стани, `signal` скасовує, відмова → `failed`).
   - проба: `?story=<slug>` дає те саме поле, що фікстура (кількість тайлів,
     кадрів, межі); для тестового набору (нижче) зсув вмісту від центру
     поля < 1 м (`probe-story-q0.mjs` міряє `contentOffset`); відмова мережі → зрозуміле повідомлення й фікстури dev
     (спека §5); `products/story-quest/` відкривається в `dev` і в `preview`;
     `deploy:check` показує alias.~~ — ЗАКРИТО 2026-11-24; числа — QA.md Q1.
     Адреса — `?story=<папка>/<історія>`; форму тайлів не змінювали (полілінія
     R2). На рев'ю знайдено й виправлено: рамка виділення — `frame.points`, не
     межі тайлів.

~~3. **Q2a — персонаж: ходьба й камера «очима»** (спека §2 п.2, §4.1
   «Персонаж»). `src/walker/`: фігура з Tilecraft, обгортка над `moveOnSheet`
   з висотою й нормаллю з `TerrainContact` після кожного кроку; межа — суша й
   мілина; камера «очима» через `cameraRig`; клавіші.~~ — ЗАКРИТО 2026-11-24;
   числа — QA.md Q2a. Межа — лінія броду −0.5 м, від неї тіло виштовхується
   (не перешкода `moveOnSheet`, див. факти «Персонаж»); ввід свій
   (DECISIONS «Персонаж»); старт — `?walk`, V або кнопка GUI.

~~4. **Q2b — «поза тілом», огляд і телефон** (спека §2 п.2, §5).
   Камера «поза тілом» (вільна, клавіші й мобільний контролер; персонаж
   стоїть); огляд острова на старті → плавно в «очі»; стік на телефоні.~~ —
   ЗАКРИТО 2026-11-25; числа — QA.md Q2b, рішення — DECISIONS «Персонаж: камери й
   телефон». Швидкість ×3 (4.2 / 12 м/с) — на прохання власника. Ходьба за
   замовчуванням в оболонці продукту (без `&walk`) — Q7. Заміри fps на телефоні
   власника — QA-Q2b-7, не зроблено.

~~5. **Q3 — мініатюри** (спека §2 п.3–4, §4.1 «Мініатюра й гідратація»).
   Мініатюра 1/8 rest (стартове значення, підбір на телефоні); розкладка на
   суші вище мілини з мінімальною відстанню, seed = slug; персонаж бере й
   несе; контакт із водою → розгортання до rest.~~ — ЗАКРИТО 2026-11-25; числа —
   QA.md Q3, рішення — DECISIONS «Мініатюри й гідратація». Вмикає `&minis`
   (за замовчуванням в оболонці — Q7); G / кнопка «Взяти»·«Покласти» лише в
   «очах». Розмір 1/8 на телефоні — QA-Q3-7, не зроблено.

6. **Q4 — пліт і кайт** (спека §2 п.5, §4.2, §4.3). Персонаж стоїть на
   кадрі (`TileFrameQuery`); кайт v1 тягне за курсом зі сталою силою;
   відпущений кайт — дрейф; пліт не обмежений `uTileMotionLimit` поля (свій
   ліміт або виняток — рішення фази); межа відкритого моря — край карти
   берега (|x| або |z| > 900 м).
   - проба: пліт з поля біля берега перетинає край карти берега; подія
     «у морі» рівно на межі; на телефоні власника — без квадрата «мілини»
     (TEX-1, `probe-scene-shore.mjs`) і ≥ 30 fps; тінь плоту в морі —
     огляд власника.

7. **Q5 — долі кадру** (спека §2 п.6, §4.1 «Долі кадру»; Edge §4.4, W1).
   Відпустити за обрій / покликати; втопити / підняти (густина); розпастися на
   тайли, що тонуть по одному / зібрати; «Залишити так».
   - focused: юніти станів долі (кожна дія має зворотну; «Залишити так»
     фіксує).
   - проба: кожна пара «дія → зворотна» повертає кадр у вихідну позу й
     кількість тайлів; втоплення за 1200 м (немає дна, спека §4.3) не ламає
     поле.

8. **Q6 — квести й картки** (спека §3). У `products/story-quest/`: перелік
   задач §3.1 з автоматичними й ручними галочками, картки з прив'язкою,
   IndexedDB (ключ — slug + fingerprint), експорт JSON і Markdown; підказки —
   дані uk + en.
   - guard: «products → src» тримає.
   - focused: юніти шару квестів (подія → факт, ручна галочка рівноцінна,
     відкласти / прибрати не дає «пропущено»).
   - проба: картки й прогрес переживають перезавантаження; експорт дає обидва
     файли; у мережу нічого не йде (перехоплення запитів).

9. **Q7 — продукт** (спека §2, §8 Q7). Вибір історії зі списку каталогу, UI
   квестів і карток, мобільний layout, uk + en.
   - проба: весь маршрут §2 на телефоні власника — вибір → пошук → вода →
     пліт → фінал → картка; `prefers-reduced-motion`, «Затихнути» / «На берег»
     (Edge §7).

### Відкриті питання

- ~~Форма тайлів історій каталогу~~ — вирішено в Q3: як є (DECISIONS «Мініатюри
  й гідратація»); переглянути, якщо Q4/Q5 поведуть кадр на мілину.
- Fingerprint історії з каталогу — `null` (клієнт Tilecraft віддає розібраний
  об'єкт без байтів); ключ сховища slug + fingerprint — рішення Q6.
- Перешкоди на суші (каміння, валуни, плаваючі предмети) — персонаж проходить
  крізь них; спека Q2a межею називає лише воду. Чи потрібні — рішення власника.
- Заміри на телефоні (базовий fps з історією — не зроблено в Q0; ходьба —
  QA-Q2b-7; розмір мініатюри — QA-Q3-7; Q4, Q7) — лише власник. IP ПК у локальній мережі в правилі CORS немає —
  телефон на dev-стенді з `--host` каталог не прочитає, поки власник не
  впише його.

## Що зроблено і працює

Baseline (Q3, 2026-11-25): guard зелений 1.18 с (BOUNDARY-1…4, OWNER-1…5, TEX-1, BUDGET-1, TYPES-1 0); `npm test` 221 passed; `probe-story-q3` PASS 179.6 с, `probe-story-q2b` PASS 64.1 с, `probe-story-q2a` PASS 52.8 с.

| підсистема | де (файли, символи) | контракт | перевірка |
| --- | --- | --- | --- |
| Каталог історій | `src/catalog/index.js` (`createStoryCatalog`), `catalog.js` (`createCatalog`, `parseStoryId`, `errorCode`), Tilecraft-вхід `tilecraftCatalog.js` (`lib/story-catalog.js`); `app.catalog`, `app.loadStory` у `main.js` | спека §4.1; стани `idle/pending/ready/failed`, подія `change`, помилка `{ code, message }`; папки `public-test`, `test-2025`, у dev `local` | `tests/catalog.test.js`, `scripts/probe-story-q1.mjs` |
| Історія = видимі кадри | `src/tiles/storyFrames.js` (`toStoryFrames`), виклик у `tilecraftLoader.js` → `fetchTileSource` для фікстури, файлу й payload каталогу | HANDOFF Q1; тайли без видимого кадру й `hid`-кадри відкидаються до компіляції | `tests/storyFrames.test.js`, `probe-story-q1` (`contentOffset` < 1 м) |
| Рамка виділення кадру | `TileFrames.setQuads` (`entry.quad` з `frame.points`), `TileInteraction.updateHighlight`; без `points` — `entry.bounds` | FRAME-DRAG FD4 + рев'ю Q1: рамка = авторський кадр, нерухома | `tests/frameQuad.test.js`, `probe-frame-land.mjs` |
| Оболонка продукту | `products/story-quest/index.html`, `main.js` (рядок `#storyStatus`, uk/en), `story-quest.css`; спільний CSS сцени `src/ui/scene.css` | спека §4; BOUNDARY-4: `src/**` не імпортує `products/**` | `probe-story-q1` (dev + `PREVIEW_URL`) |
| Персонаж | `src/walker/`: `groundWalk.js` (`walkOnGround`, `clearOfWater`, `WALK`), `walker.js` (`createWalker`, `PACE` 4.2 / 12 м/с), `keyboard.js`, вхід Tilecraft `tilecraftWalker.js`, хост `index.js` (`createWalkerHost`, режими `off/boarding/eyes/standing`, `setStick`); у `main.js` — `walk()` (V), `startWalk()` (`?walk`), `app.walker`, `app.ground` | спека §4.1; ноги на `TerrainContact`, не на `islandHeight`; тіло ≥ 0.255 м від лінії броду −0.5 м | `tests/walker.test.js`, `probe-story-q2a.mjs` |
| Камера «очима» й «поза тілом» | `CameraRig.ride(eye, { approach, onArrive, onEnd })`, `boarding`, `dismount()`, lock `eyes`; `steer(forward, strafe)` — стік поза тілом; старт `startWalk`: `flyTo(island)` → 1.2 с → спуск 4 с | OWNER-3; DECISIONS «Персонаж: камери й телефон»; спуск — smootherstep + slerp, підлога до останніх 30 % | `tests/walker.test.js`, `probe-story-q2b.mjs` |
| Стік і кнопки телефона | `src/walker/stick.js` (`createWalkerStick`, `stickVector`, `STICK`, `LABELS`; опція `action { hint, run }` — кнопка «Взяти»/«Покласти»), CSS `#walkerControls` у `src/ui/scene.css`; монтує `walkerReady()` у `main.js` на `mobile` / `?stick` | UI-вхід, як `moodPad`; хост DOM не знає | `tests/walker.test.js` («stickVector»), `probe-story-q2b` (крок 3), `probe-story-q3` (кнопка) |
| Мініатюри й гідратація | `src/tiles/miniatureLayout.js` (`layoutMiniatures`, `LAYOUT`, seed = id історії), `TileMiniatures.js` (`MINI`, `layout`, `take`, `put`, `unfoldCenter`, `syncFrames`, події `take/put/unfold/hydrate`); у `main.js` — `layoutMinis()` (`?minis`), `miniAction()` (G), `app.minis` | DECISIONS «Мініатюри й гідратація»: копія мешів, кадр поля прихований до `water`, тоді `moveFrame` | `tests/miniatures.test.js`, `probe-story-q3.mjs` |
| Збірка й деплой продукту | `vite.config.js` (`rollupOptions.input`), `verify-dist.mjs`, `deploy-netlify.mjs --alias`, `static-server.mjs` (index папки, `.css`), dev-фолбек `build/tilecraft-plugin.js` (`LOCAL_CATALOG_PATH`) | спека §5, §5.1 | `npm run deploy:check -- --alias story-quest`, `test:build` |

## Головні виміряні факти

### Стенд і інструменти

- [CORS R2 `stories`] з 2026-11-24 у правилі `localhost:5199`, `127.0.0.1:5199`, `127.0.0.1:4173`, `edge-of-elements.netlify.app`, `story-quest--edge-of-elements.netlify.app` → `curl` з `Origin` на `cdn.` і `r2.dev` дає заголовок 15/15; новий origin — у правило до деплою, перевірка — `curl -D - -H "Origin: …"`, не вкладка. (Q0)
- [`probe-story-q0.mjs`] модель тягне Node (без CORS), у сторінку кладе синтетичним `drop` з `DataTransfer` — шлях, як у власника з файлом; `contentOffset` = відстань центру геометрії поля від `tiles.center` → «поле зібралось, але невидиме» без нього не видно. (Q0)

- [`import.meta.env` у `src/`] Vite підставляє лише дослівний текст `import.meta.env.X`; `(import.meta).env` (JSDoc-каст) лишається `undefined`, а `import.meta.env ?? {}` не дає збірці вирізати dev-гілку → писати `import.meta.env.DEV` прямо, тип — `src/types/globals.d.ts`. (Q1)
- [нова сторінка в `products/`] друга сторінка збірки — `rollupOptions.input` у `vite.config.js` + рядок у `verify-dist.mjs`; `npm run preview` віддає `…/` як `index.html` лише після Q1 (`static-server.mjs`). (Q1)

### Каталог

- [sidecar `.frames.json`] несе лише 3D-нахил площини кадру (`core/frame-sidecar.js`); Ultra-Water його не читає, sidecar фікстури має `frames: {}` → для каталогу не потрібен. (Q0)
- [`computeBounds` Tilecraft] рахує ВСІ тайли моделі, а `scene-compiler` тайли без `f` пропускає → 5 тайлів без кадру `frog-fairy-*` (до 187 808 од.) зсувають поле на 2199 / 3960 м; фільтр «лише тайли видимих кадрів» дає 0 м — робити до `compileTileSource`. (Q0)
- [компіляція, desktop RTX] `my-day-3-moments` 222 + 333 мс, `frog-fairy-full` 594 + 860 мс, `story-8-frames-hibrid` 542 + 1016 мс (compile + rest); polygon-фікстура — 55 + 154 мс → полілінія в ~5–10 разів довша. (Q0)
- [статус поля для полілінії] `polyline tile N m > 1 m; terrain contact accuracy not guaranteed`: `my-day` 1.9 м, жаба 7.6 м, білка 7.0 м → для мініатюр на суші (Q3) перевіряти контакт саме на цих історіях. (Q0)

- [`?story=` в адресі] `writeTileUrl` пише `story=public-test%2Ffrog-fairy-full` (URLSearchParams кодує `/`) → `parseStoryId` читає обидві форми, у QA давати адресу зі `/`. (Q1)
- [`frame.points` моделі] 4 кути в одиницях джерела, ті самі, що `tile.x/y`; у полі — `(p − space.origin) × space.unit`, y → z; тайли кадру можуть займати лише частину (`my-day` кадр 2: 145 з 196 од.) → межі кадру — `entry.quad`, не `entry.bounds`. (Q1)
- [вода над тайлами] тайли лежать на −0.5…+0.2 м від рамки, а вода заломлює їх: з косої камери малюнок зсунутий на екрані відносно рамки до ~1 м, без `app.surface.mesh` збігається → перевіряти межі з вимкненою водою, не на око. (Q1)
- [фікстура з локального каталогу] `local/story-8-frames-hibrid` = `?tiles=story-8-frames-hibrid` за тайлами, групами, кадрами й полем; максимальна полілінія 7.017 проти 6.998 м (файл каталогу vs модифікатор). (Q1)

### Персонаж

- [імпорт з dev-стенда] `sheet-motion.js` (`moveOnSheet`), `gamifier/avatar.js` (`createGamifierAvatar` → `THREE.Group` нашого three), `characters.js`, `camera-pose.js`, `pointer-channels.js`, `gamifier-input/-pad/-stick.js` — `import('/@id/@tilecraft/…')` без помилок; DOM/rAF/глобалів у core-модулях 0, у shell-вводі DOM є. (Q0)
- [`gamifier-input.js`] `gamifier-control.js` імпортує лише як JSDoc-тип, але викликає `control()` — 22 члени (`command` ×12, `aim` ×6, `view?.mode` ×5, `state`, `power`…) → без перехідника цей ввід не взяти. (Q0)
- [`moveOnSheet(pose, offset, sheet, bodyScale, candidates)`] `sheet = { bounds: {min,max}, y }` — прямокутник і стала висота; радіус тіла `0.15 × bodyScale`, крок ≤ радіус/4; `candidates(center, radius)` — перешкоди з `center/footprint/top` → обгортка Q2a сама відсікає воду й підставляє висоту `TerrainContact`. (Q0)
- [перешкоди `moveOnSheet`] тіло, що стартує всередині перешкоди хоч на 1 мм, не рухається (бісекція дає 0); `landingObstruction` міряє footprint опорною функцією в напрямку центру — для квадрата це «ямка» навпроти грані → лінію води не подавати перешкодами (сітка клітинок: сходинки, 0–0.2 м/с при 15–30° до косого берега; дотичні диски з нормалей трикутників: розбіжність ~1°) — виштовхувати тіло від найближчої точки лінії (`clearOfWater`). (Q2a)
- [`islandHeight` проти сітки рельєфу] на хребтах аналітична висота до 2.49 м вища за намальовану сітку (34.05 проти 36.54 м у (127.5, −34.2)) → все, що стоїть на рельєфі, міряти `TerrainContact.at`; клемп `CameraRig._clamp` (`islandHeight + 0.8`) піднімав очі на 0.33 м — у `ride` вимкнений. (Q2a)
- [берег острова на лінії −0.5 м] нормаль лінії на ±3 м зазвичай повертає на 10–70°, прямих відрізків (≤ 5° щометра) мало → проба шукає їх (`probe-story-q2a` 3b), а курси рахує від локальної нормалі, не від усередненої. (Q2a)
- [вартість кроку] `walkOnGround` 0.022 мс на лінії броду, 0.007 мс углибині (desktop); `new TerrainContact` для персонажа — ~11 мс, тому лінивий у `main.js`. (Q2a)
- [старт `?walk`, перші секунди після перельоту над островом] кадри провисають до 0.85 с (headless desktop), через 5 с — рівні 16.7 мс → проби, що міряють ходьбу за часом, чекають 5 с після прибуття в очі. (Q2b)
- [трасування в пробі через rAF] перший запис іде лише на наступному кадрі, а `page.evaluate` повертається раніше → дія проби (V) потрапляє до першого рядка; писати перший рядок синхронно. (Q2b)
- [спуск у очі з огляду] 1163 м за 4 с: найбільший крок 9.13 м за кадр = 1.03 від межі кривої (1.875 × середня швидкість × dt) → допуск проби ≤ 1.05, тісний; довший спуск — довша `approach`, не ширший допуск. (Q2b)
- [збірка аватара] `avatar.js` Tilecraft іде окремим лінивим чанком 40 KB і бере three з `main` (один three); `test:build` перевіряє наявну `dist`, не будує → перед перевіркою `dist` — `npm run build`. (Q2a)

### Мініатюри

- [`frameFootprint` кадру, що стоїть] той самий кадр `my-day` на тому самому місці дає 10.6–12.4 м по z за кілька секунд (тайли полілінії на хвилях) → розмір кадру порівнювати з допуском ~15 %, не сантиметрами. (Q3)
- [`TileMiniatures.lay`] основа піднята над 4 кутами, тож `contactGap` кутів завжди 0 → «лежить на рельєфі» міряти як висоту основи над рельєфом під центром (0–0.048 м на наборі). (Q3)
- [гідратація біля пляжу] від лінії броду −0.48 м пошук дає центр кадру над глибиною рівно ~1.0 м (`MINI.depth`) → пліт Q4 стартує впритул до мілини; кадр на якорі за 8 с зсувається на 0.27 м. (Q3)

### Пліт і кайт

- [`driftRadius`] за замовчуванням 400 м від rest, відсічення — 400 + 64 м (`tileMotionLimit`); поле стоїть біля берега, `coast()` ≤ 800 м від центру → до межі моря 900 м пліт може не дістати, потрібен свій ліміт (Q4). (код)
- [`TILE_SHADOW_MARGIN`] тінь на воду — лише rest + 16 м → пліт у морі тіні не кидає. (код)
- [карта берега] `bakeShoreMap(islandHeight, 1800, …)`: за |x| або |z| > 900 м `shoreSample` дає глибину 60 м і відстань 1e4 → це і є межа відкритого моря (спека §4.3). (код)
- [`ISLAND_SIZE`] 2400 → рельєф і контактна поверхня закінчуються на 1200 м; далі втоплений кадр тоне без дна (Q5). (код)
- [телефон власника] немає `OES_texture_float_linear` → float-текстура з лінійним фільтром читається як 0 (TEX-1); нові карти лише `HalfFloatType` через `src/engine/halfTexture.js`. (INVARIANTS TEX-1)
