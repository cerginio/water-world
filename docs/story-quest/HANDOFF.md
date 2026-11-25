# Handoff: story-quest — перший продукт на платформі Ultra-Water

Стан на 2026-11-26. Фази з [STORY-QUEST-SPEC.md](../../STORY-QUEST-SPEC.md)
(далі — «спека»). Q0–Q5b, QDa, QDb і Q6 закрито й закомічено: каталог R2, `?story=`,
оболонка `products/story-quest/`, персонаж ходить островом «очима», старт «огляд →
очі», «поза тілом», стік, мініатюри на суші (`&minis`) і гідратація у воді, пліт і
кайт до відкритого моря, політ на дошці з кайтом і посадка на ноги / на палубу; Q5 —
долі кадру (відпустити / втопити / розпастися, зворотні, «Залишити так»); Q5a — C-кайт
на чотирьох стропах із планкою; Q5b — плавання й пірнання до втопленого кадру; QDa —
контракт сцени для продуктів (`&embed`, команди через `postMessage`); QDb — спільна оболонка
`products/shared/`, стенд станів `products/quest-demo-qa/` (14 карток), `story-quest` на оболонці; Q6 — квести й картки (зони «Квести» й «Картки», IndexedDB, експорт).
QA — [QA.md](QA.md).

> **Далі:** Q7 — продукт (п.16).

Локальний стенд: `http://localhost:5199/`; правило стенду — `AGENTS.md` →
«Локальний стенд». Телефон — лише драфт Netlify
`https://story-quest--edge-of-elements.netlify.app/`; кожна фаза деплоїть його перед
рев'ю рядком «Деплой» з QA.md. Tilecraft (`TILECRAFT_ROOT`) лише читається.

## НЕЗАКРИТЕ — почни звідси

Розбиття погоджено з власником 2026-11-24: Q2 спеки розділено на Q2a і Q2b;
оболонка `products/story-quest/` і guard «products → src» — у Q1, а не в Q7.
2026-11-25 (спека §2 п.6, §4.2 v1.5): політ із Q5 спеки винесено в окрему
фазу Q4b перед Q5; плавання й пірнання — Q5b.
2026-11-25 (спека §4.4, §8, [quest-demo-qa.md](quest-demo-qa.md)): стенд станів QD
перед Q6, розбитий на QDa (контракт `src/embed/`) і QDb (стенд і спільна оболонка;
`story-quest` переходить на неї там само).

| фаза | чекає на |
|---|---|
| ~~Q0~~ | закрито 2026-11-24 |
| ~~Q1~~ | закрито 2026-11-24 |
| ~~Q2a~~ | закрито 2026-11-24 |
| ~~Q2b~~ | закрито 2026-11-25 (fps на телефоні — за власником, QA-Q2b-7) |
| ~~Q3~~ | закрито 2026-11-25 (розмір 1/8 на телефоні — за власником, QA-Q3-7) |
| ~~Q4~~ | закрито 2026-11-25 (телефон — QA-Q4-7, тінь — QA-Q4-8; чистий прогін проби — п.7) |
| ~~Q4b~~ | закрито 2026-11-25 (телефон — QA-Q4b-8, QA-Q4b-9) |
| ~~Q5~~ | закрито 2026-11-25 (телефон — QA-Q5-8, QA-Q5-9) |
| ~~Q5a~~ | закрито 2026-11-25 (телефон — QA-Q5a-6) |
| ~~Q5b~~ | закрито 2026-11-25 (телефон — QA-Q5b-7) |
| ~~QDa~~ | закрито 2026-11-25 (телефон — у QDb) |
| ~~QDb~~ | закрито 2026-11-25 (телефон — QA-QDb-12, за власником) |
| ~~Q6~~ | закрито 2026-11-26 (телефон — QA-Q6-13, за власником) |
| Q7 | — |

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

~~6. **Q4 — пліт і кайт** (спека §2 п.5, §4.2, §4.3). Персонаж стоїть на
   кадрі (`TileFrameQuery`); кайт v1 тягне за курсом зі сталою силою;
   відпущений кайт — дрейф; пліт не обмежений `uTileMotionLimit` поля; межа
   відкритого моря — край карти берега (|x| або |z| > 900 м).~~ — ЗАКРИТО
   2026-11-25; числа — QA.md Q4, рішення — DECISIONS «Пліт і кайт». На рев'ю
   виправлено: кадр у прибої двоївся (інваріант SIM-1 — `TileSim` бере воду в
   точці якоря), строп кайта гуляла (дві стропи, кайт ставиться після кроку).
   Телефон (QA-Q4-7) і тінь у морі (QA-Q4-8) — за власником.

~~7. **Перед Q5 — чистий прогін проб Q4.** Після правок рев'ю Q4 `probe-story-q4`
   і `probe-story-q3` ганялись поруч із чужими сесіями Playwright (30 fps, читання з
   GPU 1.4–2 с замість 5–16 мс) і падали на кроках, що залежать від частоти читання
   (QA.md Q4 «Правки рев'ю»). Без навантаження: обидві мають пройти; якщо
   `probe-story-q4` падає на «ноги на палубі» — це п.8, не шум.
   - перевірити, що інших headless Chrome немає (`Get-CimInstance Win32_Process`,
     `headless` у командному рядку), потім проби по одній.~~ — ЗАКРИТО 2026-11-25:
     обидві PASS без навантаження (QA.md Q4b); падіння Q4 були навантаженням.

8. **Висота палуби без читання з GPU — рішення в Q4b, Q5 або Q7.** Зараз висота палуби —
   `TileFrameQuery` режим 3 (async readback); при читанні 1–2 с ноги осідають
   сходинками 0.2–0.3 м. Кандидат: висота води під ногами на CPU (та сама формула
   `waterAt`, що в `TileSim`) + сталий зсув верхівки тайлів. Міряти на телефоні.

~~9. **Q4b — політ на дошці з кайтом** (спека §2 п.6 «Вихід з плоту», «Інший
   кадр»; §4.2 v1.5; §4.1 «Персонаж»). Кнопка й клавіша «Злетіти» на плоті з
   піднятим кайтом: персонаж на дошці (дошка завжди з собою, свій меш) летить
   2–4 м над середнім рівнем води, 24 м/с, курсом із вводу ходьби; камера —
   через `cameraRig` (OWNER-3). Посадка: над ґрунтом ≥ −0.5 м — на ноги
   («очі», ходьба), над кадром на воді — на палубу (він стає плотом). Над
   глибиною кайт не відпускається (до Q5b). Пліт, що лишився, дрейфує, як
   відпущений (`stepRaft` без `pull`). Інший кадр: мініатюра в руках на плоті
   → «Покласти» на воду поруч → розгортання → стрибок `DECK_JUMP` (перевірити,
   чи працює вже з Q3/Q4; доробити, якщо ні).
   - guard: OWNER-3 не росте (камера польоту — через `cameraRig`).
   - focused: юніти кроку польоту (швидкість, висота в смузі 2–4 м, посадка
     на ґрунт / на палубу, без відпускання над глибиною).
   - проба (`probe-story-q4b`): пліт у морі → «Злетіти» → курс до острова →
     приземлення на ноги, режим `eyes`; другий зліт → курс на кадр на воді →
     посадка на палубу; покладена з рук мініатюра поруч з плотом → стрибок на
     неї.
   - QA (чернетка): `qa:open` `http://localhost:5199/?story=test-2025/my-day-3-moments&walk&minis`,
     `qa:action` пліт у море → K → «Злетіти» → курс на острів, `qa:inspect`
     персонаж і висота над хвилями, `qa:expected` дошка над водою 2–4 м,
     над мілиною персонаж стоїть і йде пішки.~~ — ЗАКРИТО 2026-11-25; числа — QA.md
     Q4b. Зліт — Пробіл / «Злетіти»; над мілиною посадка сама, над кадром — Пробіл / K /
     «Сісти», над глибиною не сідає. Стрибок з плоту на інший кадр — і на найближчу
     точку в межах 4 м і 45°. Телефон (QA-Q4b-8, -9) — за власником, на драфті.

~~10. **Q5 — долі кадру** (спека §2 п.6, §4.1 «Долі кадру»; Edge §4.4, W1).
   Відпустити за обрій / покликати; втопити / підняти (густина); розпастися на
   тайли, що тонуть по одному / зібрати; «Залишити так». Вибір долі на плоті
   запускає зліт Q4b; доля доступна й з повітря кадру внизу; зворотні дії — з
   польоту, з іншого кадру й з берега, доки не «Залишити так».
   - focused: юніти станів долі (кожна дія має зворотну; «Залишити так»
     фіксує).
   - проба: кожна пара «дія → зворотна» повертає кадр у вихідну позу й
     кількість тайлів; втоплення за 1200 м (немає дна, спека §4.3) не ламає
     поле; вибір долі на плоті → персонаж у польоті, кадр іде своєю долею.~~ — ЗАКРИТО
     2026-11-25; числа — QA.md Q5, рішення — DECISIONS «Долі кадру». Клавіші Z/X/C, H
     (назад), L («Залишити так»); на телефоні — стовпчик кнопок. Правка рев'ю: «Мить»
     летить до мініатюри. Телефон (QA-Q5-8, -9) — за власником, на драфті.

~~11. **Q5a — редизайн C-Kite** ([спека для агента](c-kite-redesign.md)).
   Замінити ромб у `src/tiles/TileRaft.js` на процедурний C-Kite з чотирма
   стропами, видимим центральним вузлом і планкою перед персонажем на плоті
   й у польоті. Орієнтацію та деформацію полотна оновлювати в `pose()` після
   кроку персонажа. Зберегти чинну логіку тяги, польоту, керування й погоди.
   - guard: `npm run guard`, зокрема OWNER-3.
   - focused: `npm test -- tests/raft.test.js tests/walker.test.js`.
   - проби по одній: `node scripts/probe-story-q4.mjs` (хід і дрейф плоту,
     стабільність планки), `node scripts/probe-story-q4b.mjs` (зліт і посадка).
   - QA (чернетка, вигляд з плоту): `qa:open`
     `http://localhost:5199/?story=test-2025/my-day-3-moments&walk`.
     `qa:action` сісти на пліт за QA-Q4-3, підняти кайт (`K`), пройти прямим
     курсом і повернути. `qa:inspect` крило, кінці строп і планку під час
     маневру. `qa:expected` C-подібний силует, передня кромка й три ребра,
     дві силові стропи до центрального вузла й дві керуючі до кінців планки.
     У повороті всі чотири залишаються на своїх кріпленнях.
   - Для рев’ю окремо перевірити вигляд із берега й збоку, легку деформацію
     за зміни вітру та планку під час зльоту і посадки. Актуалізувати опис
     ромба й двох строп у QA-Q4-3.
   - Підібрати в сцені масштаб, базовий нахил і амплітуди руху за критеріями спеки.~~ —
     ЗАКРИТО 2026-11-25; числа — QA.md Q5a. Модуль `src/tiles/cKite.js`; QA-Q4-3
     оновлено. Телефон (QA-Q5a-6) — за власником, на драфті.

~~12. **Q5b — плавання й пірнання** (спека §2 п.6 «Плавання й пірнання»).
   Персонаж пливе поверхнею й пірнає; камера під водою (через `cameraRig`);
   огляд втопленого кадру (Edge «пірнути й подивитися»); кайт, відпущений над
   глибиною, — персонаж у воді.~~ — ЗАКРИТО 2026-11-25; числа — QA.md Q5b, рішення —
   DECISIONS «Плавання й пірнання». Пробіл / блакитна кнопка: «У воду» (з дошки над
   глибиною, з палуби без кайта), «Пірнути» / «Випливти». Підводний вигляд на телефоні
   (QA-Q5b-7) — за власником, на драфті.

~~13. **QDa — контракт сцени для продуктів** (спека §4.4;
   [quest-demo-qa.md](quest-demo-qa.md) «Контракт сцени»). `src/embed/`: `&embed`
   ховає технічні панелі; `postMessage` лише від `parent` того самого origin;
   hello/ready з повтором і RPC `call(cmd, args) → { ok, state } | { ok: false, reason }`
   за зразком Tilecraft `lib/message-api.js` (зразок, не імпорт). Закритий перелік
   команд Q2a–Q5b (персонаж, мініатюри, пліт, кайт, зліт і посадка, доля й зворотна,
   вода й пірнання, погода) викликає ті самі функції, що кнопки й клавіші; кожна
   чекає своєї події з тайм-аутом. Якорі (`beach`, `frame:<n>`, `shallow`,
   `open-sea`, `deep`, `deep-over-sunk`, `island`) розв'язує сцена для поточної
   історії. `state.read` і події-факти (узяв, гідратувалось, у морі, доля).
   - guard: OWNER-3 не росте (камера — через `cameraRig`); BOUNDARY-4 тримає.
   - focused: юніти `src/embed/` — невідома команда → `unknown-command`, не
     виняток; якорі на фікстурі; тайм-аут кроку дає відмову з причиною.
   - проба (`probe-story-embed`): тестовий хост у Playwright вантажить сцену в
     iframe з `&embed` і лише командами доводить її до плоту під кайтом у
     відкритому морі, польоту над глибиною й персонажа під водою біля втопленого
     кадру; `state.read` підтверджує кожен стан; для всіх трьох історій тестового
     набору якорі розв'язуються.
   - QA (чернетка): `qa:open` `http://localhost:5199/?story=test-2025/my-day-3-moments&walk&minis&embed`,
     `qa:action` нічого, `qa:inspect` екран сцени, `qa:expected` технічних панелей
     (lil-gui, fps) немає, персонаж і огляд — як без `&embed`.~~ — ЗАКРИТО 2026-11-25;
     числа — QA.md QDa. 19 команд, якорі `beach`/`shallow`/`open-sea`/`frame:n`/`over:n`/
     `beside:n` (таблиця — [quest-demo-qa.md](quest-demo-qa.md)); `app.embed` — ті самі
     команди з консолі для QA; `walker.swimAt`. `&embed` нічого не ховає — рішення QDb.

~~14. **QDb — стенд `quest-demo-qa` і спільна оболонка** (спека §4, §4.4;
   [quest-demo-qa.md](quest-demo-qa.md)). `products/shared/`: хост iframe, клієнт
   контракту, рендер зон з `ui-map`, компонування як `story-demo` Tilecraft
   (ковзна / накладна панель, ☰ на телефоні). `products/quest-demo-qa/`: зони
   Історія (R2 за папками, фікстури dev), Стани (`states.json`, ~14 карток за
   групами з `covers`, `steps`, `expect`; прогрес по кроках; чистий старт —
   перезавантаження iframe), Погода, Квести (порожня під Q6), Тех; `?card=<id>`;
   третій вхід збірки (`build.rollupOptions.input`, `verify-dist`).
   **`products/story-quest/` переходить на ту саму оболонку** (рішення власника
   2026-11-25): зони Історія й Погода, повідомлення каталогу Q1 — у панелі, без
   `import '../../src/main.js'`.
   - guard: нове правило «`products/**` не імпортує `src/**`», baseline 0, без
     винятків; мутація `import '../../src/main.js'` у `products/` його валить.
     Куди записати (INVARIANTS чи guard + DECISIONS) — за гейтом `AGENTS.md`.
   - focused: юніти рендеру зон і клієнта контракту (відмова кроку → стан картки
     «відмова» з причиною).
   - проба (`probe-story-states`): кожна картка `states.json` на стенді досягає
     свого `expect` через `state.read`; перезавантаження з `&card=` дає той самий
     стан; `story-quest` з `?story=` піднімає історію, як у QA-Q1-2, а без історії
     пропонує список, як QA-Q1-3.
   - телефон: драфт `--alias story-quest`, шлях `/products/quest-demo-qa/`; картка
     дотиком, далі дотики в сцені.
   - QA (чернетка): `qa:open` `http://localhost:5199/products/quest-demo-qa/?story=test-2025/my-day-3-moments`,
     `qa:action` зона «Стани» → картка «Пліт під кайтом у відкритому морі»,
     `qa:inspect` сцена й кроки картки, `qa:expected` усі кроки позначено
     виконаними, персонаж на плоті з піднятим кайтом за краєм карти берега.~~ — ЗАКРИТО
   2026-11-25; числа — QA.md QDb, рішення — DECISIONS «Стенд станів і спільна оболонка»,
   межа — INVARIANTS BOUNDARY-5. Контракт доповнено `catalog.list`/`catalog.read`/`scene.tech`,
   подією `catalog.change`; `&embed` ховає віджет настрою й рейку. Кожна картка — чисте
   перезавантаження iframe (рішення власника); прискорити можна `minis.hydrate` (факт нижче).

~~15. **Q6 — квести й картки** (спека §3). Шар квестів — зона «Квести» спільної
   оболонки; факти — події контракту QDa. У `products/story-quest/`: перелік
   задач §3.1 з автоматичними й ручними галочками, картки з прив'язкою,
   IndexedDB (ключ — slug + fingerprint), експорт JSON і Markdown; підказки —
   дані uk + en.
   - guard: «products ↛ src» тримає.
   - focused: юніти шару квестів (подія → факт, ручна галочка рівноцінна,
     відкласти / прибрати не дає «пропущено»).
   - проба: картки й прогрес переживають перезавантаження; експорт дає обидва
     файли; у мережу нічого не йде (перехоплення запитів).~~ — ЗАКРИТО 2026-11-26; числа —
     QA.md Q6, рішення — DECISIONS «Квести й картки». Шар — у `products/shared/` (і на стенді);
     ключ — історія + `fingerprintOf` моделі від сцени (`scene.ready`, `state.read`). Телефон
     (QA-Q6-13) — за власником, на драфті.

16. **Q7 — продукт** (спека §2, §8 Q7). `story-quest` уже на спільній оболонці (QDb);
   тут — продуктова `ui-map` (без зон «Стани» й «Тех»), мобільний layout, uk + en;
   рюкзак на кілька мініатюр (спека §4.1 «Персонаж»).
   - проба: весь маршрут §2 на телефоні власника — вибір → пошук → вода →
     пліт → фінал → картка; `prefers-reduced-motion`, «Затихнути» / «На берег»
     (Edge §7).

## Що зроблено і працює

Baseline (Q6, 2026-11-26): guard зелений 0.34 с (BOUNDARY-1…5, OWNER-1…5, TEX-1, BUDGET-1, TYPES-1 0; SIM-1 — проба); `npm test` 339 passed; `probe-story-quests` PASS 38.2 с; `probe-story-states` PASS 177.9 с (14 карток); `test:build` pass; `probe-tiles` падає й на HEAD (`worldQuery.maxError`); `npm run lint` падає на HEAD (`probe-story-q5.mjs:118`).

| підсистема | де (файли, символи) | контракт | перевірка |
| --- | --- | --- | --- |
| Каталог історій | `src/catalog/index.js` (`createStoryCatalog`), `catalog.js` (`createCatalog`, `parseStoryId`, `errorCode`, `fingerprintOf` — FNV-1a над JSON моделі, `catalog.fingerprint`), Tilecraft-вхід `tilecraftCatalog.js` (`lib/story-catalog.js`); `app.catalog`, `app.loadStory` у `main.js` | спека §4.1; стани `idle/pending/ready/failed`, подія `change`, помилка `{ code, message }`; папки `public-test`, `test-2025`, у dev `local` | `tests/catalog.test.js`, `scripts/probe-story-q1.mjs` |
| Історія = видимі кадри | `src/tiles/storyFrames.js` (`toStoryFrames`), виклик у `tilecraftLoader.js` → `fetchTileSource` для фікстури, файлу й payload каталогу | HANDOFF Q1; тайли без видимого кадру й `hid`-кадри відкидаються до компіляції | `tests/storyFrames.test.js`, `probe-story-q1` (`contentOffset` < 1 м) |
| Рамка виділення кадру | `TileFrames.setQuads` (`entry.quad` з `frame.points`), `TileInteraction.updateHighlight`; без `points` — `entry.bounds` | FRAME-DRAG FD4 + рев'ю Q1: рамка = авторський кадр, нерухома | `tests/frameQuad.test.js`, `probe-frame-land.mjs` |
| Контракт сцени для продуктів | `src/embed/`: `protocol.js` (`CHANNEL`, `createEmbedServer`, `EmbedError`, `until`), `commands.js` (`createCommands`, `WAIT`, `catalogState`; 22 команди з `catalog.list/read`, `scene.tech`), `anchors.js` (`resolveAnchor`, `ANCHOR`), `state.js` (`readState`, з `fingerprint`), `world.js` (`worldFromApp` — фасад над `app`), `index.js` (`startEmbed`, подія `catalog.change`, `scene.ready` з `story` і `fingerprint`); у `main.js` — гілка `&embed` (`body.embed`), `app.embed`, `app.fps` | спека §4.4, [quest-demo-qa.md](quest-demo-qa.md) «Контракт сцени»; лише `parent` того самого origin; команди викликають ті самі функції, що клавіші | `tests/embed.test.js`, `scripts/probe-story-embed.mjs` |
| Спільна оболонка продуктів | `products/shared/`: `contract.js` (`createSceneClient`, `sceneUrl`), `sceneHost.js` (`createSceneHost`: один iframe, hello після `load`), `shell.js` (`mountShell`, `yieldToScene`), `zones.js` (`zonesOf`, `renderZones`, `pickLocale`), `storyZones.js` (`storyZone`, `weatherZone`, `WEATHER`), `shell.css` | спека §4.4; INVARIANTS BOUNDARY-5: `products/**` ↛ `src/**`, без `contentWindow.app` | `tests/products.test.js`, `probe-story-states` |
| Стенд станів | `products/quest-demo-qa/`: `states.json` (14 карток, 6 груп), `cards.js` (`runCard`, `planOf`, `mismatches`, `checkCards`), `main.js` (зони, `?card=`, `window.questDemo` для проби), `ui-map.json` | [quest-demo-qa.md](quest-demo-qa.md) «Картка стану»; чистий старт — перезавантаження iframe; історія стенду перекриває історію картки | `tests/products.test.js`, `scripts/probe-story-states.mjs` |
| Шар квестів і картки | `products/shared/`: `quests.js` (`applyEvent`, `tick`, `setStatus`, `saveCard`, `tasksView`, `exportJson`/`exportMarkdown`, `logKey`), `quests.json` (задачі, факти, підказки uk + en), `questStore.js` (`openQuestStore` — IndexedDB, `memoryStore`), `questZones.js` (`createQuestLayer`: зони `quests`, `cards`) | спека §3; DECISIONS «Квести й картки»; факти — події `minis.take/hydrate`, `raft.sea`, `fate.change`; ключ — історія + fingerprint | `tests/quests.test.js`, `scripts/probe-story-quests.mjs` |
| Оболонка продукту | `products/story-quest/main.js` (рядок над сценою, uk/en, `PASS` прапорців з адреси, `window.storyQuest` для проби), `ui-map.json` (Історія, Квести, Картки, Погода); `src/ui/scene.css` — CSS сцени | спека §4; «готово» — `scene.ready`, не готовність каталогу | `probe-story-states` (крок 6), `probe-story-q1`, `probe-story-quests` |
| Персонаж | `src/walker/`: `groundWalk.js` (`walkOnGround`, `clearOfWater`, `WALK`), `walker.js` (`createWalker`, `PACE` 4.2 / 12 м/с; палуби: `ride`, `board`, `direction`, `DECK_JUMP` 4 м, `JUMP_CONE` 45°; дошка: `takeOff`, `fly`, `land`, `landing`, `state.flight`), `flight.js` (`FLIGHT` 24 м/с, 3 ± 0.4 м; `stepFlight`, `landing` → `ground/deck/water`), вода `swim.js` (`SWIM`, `stepSwim`, `eyeLevel`; у `walker.js` — `state.swim`, `jumpIn`, `dive`, `rise`, `under`), `deck.js` (`deckClear`, `nearestOnDeck`), `keyboard.js`, вхід Tilecraft `tilecraftWalker.js`, хост `index.js` (`createWalkerHost`, режими `off/boarding/eyes/standing`, `setStick`, `decks`, `pull`, меш `board`); у `main.js` — `walk()` (V), `startWalk()` (`?walk`), `flyAction`/`flyHint` (Пробіл: зліт, посадка, у воду, пірнути / випливти), `walkerWater` (слот 1 `WaterQuery`), `app.walker`, `app.ground` | спека §4.1, §4.2 v1.5; DECISIONS «Плавання й пірнання»; ноги на `TerrainContact`; тіло ≥ 0.255 м від лінії броду −0.5 м; на палубі — у її (u, v) | `tests/walker.test.js`, `raft.test.js`, `flight.test.js`, `swim.test.js`, `probe-story-q2a`, `-q4b`, `-q5b` |
| Камера «очима» й «поза тілом» | `CameraRig.ride(eye, { approach, onArrive, onEnd })`, `boarding`, `dismount()`, lock `eyes`; `steer(forward, strafe)` — стік поза тілом; старт `startWalk`: `flyTo(island)` → 1.2 с → спуск 4 с | OWNER-3; DECISIONS «Персонаж: камери й телефон»; спуск — smootherstep + slerp, підлога до останніх 30 % | `tests/walker.test.js`, `probe-story-q2b.mjs` |
| Стік і кнопки телефона | `src/walker/stick.js` (`createWalkerStick`, `stickVector`, `STICK`, `LABELS`; опція `action { hint, run }` — «Взяти»/«Покласти»/«Кайт»/«Відпустити кайт»; `flight` — «Злетіти»/«Сісти»/«У воду»/«Пірнути»/«Випливти»), CSS `#walkerControls` у `src/ui/scene.css`; монтує `walkerReady()` у `main.js` на `mobile` / `?stick` | UI-вхід, як `moodPad`; хост DOM не знає | `tests/walker.test.js` («stickVector»), `probe-story-q2b` (крок 3), `probe-story-q3` (кнопка), `probe-story-q4b` (крок 7) |
| Мініатюри й гідратація | `src/tiles/miniatureLayout.js` (`layoutMiniatures`, `LAYOUT`, seed = id історії), `TileMiniatures.js` (`MINI`, `layout`, `take`, `put`, `unfoldCenter` + `freeAt`, `syncFrames`, події `take/put/unfold/hydrate`); у `main.js` — `layoutMinis()` (`?minis`), `miniAction()` (G), `app.minis` | DECISIONS «Мініатюри й гідратація»: копія мешів, кадр поля прихований до `water`, тоді `moveFrame` | `tests/miniatures.test.js`, `probe-story-q3.mjs` |
| Пліт і кайт | `src/tiles/TileRaft.js` (`TileRaft`: `decks`, `update` до кроку, `pose` після, `setKite`, `course`, `moveTo`, `drift`, `velocity`, `flying`, події `board/leave/kite/sea/takeoff/land`; `KITE`, `bar` для проб), вигляд кайта `cKite.js` (`createCKite`, `C_KITE`, `wingPoint`; `raft.model.anchors()`), `raftMotion.js` (`RAFT`, `stepRaft`, `openWater`, `inOpenSea`), `TileFrameQuery` режим 3, `TileField.lockedFrames`, `syncShadow` (кадри в конверті дрейфу); у `main.js` — `raftUpdate()`, `kiteAction()` (K), `app.raft`, `SHORE_EXTENT` | DECISIONS «Пліт і кайт»; пліт = `placed`-кадр через `moveFrame`; у польоті кайт угорі, покинутий пліт — без `pull`; INVARIANTS SIM-1 | `tests/raft.test.js`, `cKite.test.js`, `probe-story-q4.mjs` |
| Долі кадру | `src/tiles/frameFate.js` (`FATE`, `begin`/`undo`/`keep`/`stepFate`, `fateLook`, `TILE_FATE_GLSL`, `fatePiece`), `TileFates.js` (`give`, `undo`, `keep`, `open`, `facts`, `rate`, подія `change`), `TileSim.setFate` (`uFates`); `deckAtHand` у `walker/deck.js`; у `main.js` — `fateAction`, `fateHints`, Z/X/C/H/L, `app.fates` | DECISIONS «Долі кадру»; кадр під долею — `TileField.busyFrames`, не палуба | `tests/fates.test.js`, `probe-story-q5.mjs` |
| «Мить» до мініатюри | `createFrameFocus({ locate })` у `src/scene/frameFocus.js`, `locate` у `main.js` (`Box3` мініатюри, доки стан ≠ `water`) | DECISIONS «Долі кадру» (останній пункт) | `tests/frameFocusLocate.test.js`, `probe-scene-frame` |
| Збірка й деплой продукту | `vite.config.js` (`rollupOptions.input`: сцена, `story-quest`, `quest-demo-qa`), `verify-dist.mjs`, `deploy-netlify.mjs --alias` (CLI через `npx` поза деревом проєкту), `static-server.mjs` (index папки, `.css`), dev-фолбек `build/tilecraft-plugin.js` (`LOCAL_CATALOG_PATH`) | спека §5, §5.1; телефон — лише драфт (`AGENTS.md`) | `node scripts/deploy-netlify.mjs --alias story-quest --dry-run`, `test:build` |

## Головні виміряні факти

### Стенд і інструменти

- [CORS R2 `stories`] з 2026-11-24 у правилі `localhost:5199`, `127.0.0.1:5199`, `127.0.0.1:4173`, `edge-of-elements.netlify.app`, `story-quest--edge-of-elements.netlify.app` → `curl` з `Origin` на `cdn.` і `r2.dev` дає заголовок 15/15; новий origin — у правило до деплою, перевірка — `curl -D - -H "Origin: …"`, не вкладка. (Q0)
- [`npx vitest` з Git Bash (`/d/…`)] усі 16 файлів падають «failed to find the current suite»: регістр диска дає дві копії vitest → юніти з PowerShell (`D:\…`). (Q4)
- [проби поруч із чужими headless Chrome] 16 чужих процесів: сторінка 30 fps замість 60, `readRenderTargetPixelsAsync` 1.4–2.0 с замість 5–16 мс → проби, що чекають читань з GPU (палуба, footprint), падають; перед пробами перевірити процеси. (Q4)
- [`netlify-cli` у дереві проєкту] `deploy` падає `Cannot read properties of undefined (reading 'Intrinsic')`: `ts-api-utils` бере наш typescript 7.0.2; `overrides` npm не діє (peer) → CLI лише через `npx` з `cwd` поза проєктом, як у `deploy-netlify.mjs`. (Q4b)
- [`npm run deploy -- --alias …` у PowerShell] `--` з'їдається, npm бере `--alias` собі → у рядку «Деплой» — `node scripts/deploy-netlify.mjs --alias story-quest`. (Q4b)
- [старі headless Chrome без навантаження] 2 процеси від 23.11 без росту CPU пробам не заважають (`probe-story-q4` PASS 110.8 с) → перевіряти CPU процесів, не лише їх наявність. (Q4b)
- [`probe-story-q0.mjs`] модель тягне Node (без CORS), у сторінку кладе синтетичним `drop` з `DataTransfer` — шлях, як у власника з файлом; `contentOffset` = відстань центру геометрії поля від `tiles.center` → «поле зібралось, але невидиме» без нього не видно. (Q0)

- [`import.meta.env` у `src/`] Vite підставляє лише дослівний текст `import.meta.env.X`; `(import.meta).env` (JSDoc-каст) лишається `undefined`, а `import.meta.env ?? {}` не дає збірці вирізати dev-гілку → писати `import.meta.env.DEV` прямо, тип — `src/types/globals.d.ts`. (Q1)
- [нова сторінка в `products/`] друга сторінка збірки — `rollupOptions.input` у `vite.config.js` + рядок у `verify-dist.mjs`; `npm run preview` віддає `…/` як `index.html` лише після Q1 (`static-server.mjs`). (Q1)

- [`probe-story-embed`, тестовий хост] сторінка того самого origin: `goto` будь-якого файлу стенду (`src/embed/protocol.js`), потім `page.setContent` з iframe → origin лишається `localhost:5199`, `postMessage` проходить перевірку `e.origin`. (QDa)
- [`&embed` у звичайній вкладці] `parent === window`: відповіді нікуди не йдуть → руками — `app.embed['<команда>'](args)` з консолі. (QDa)
- [`sceneHost.load`, hello одразу після `iframe.src`] доки новий документ не підвантажився, «ready» відповідає стара сцена, а виклики губляться при вивантаженні → hello лише після `load` iframe. (QDb)
- [зона панелі, що питає сцену] `renderZones` до `host.load` → `catalog.list` отримував `no-scene`, зона показувала «каталог недоступний» → спершу `host.load`, потім `draw()`. (QDb)
- [таймер у рендерері зони] на момент виклику рендерера `<details>` ще не в документі (`isConnected` false) → цикл, що перевіряє `isConnected`, стартувати `setTimeout(…, 0)`. (QDb)
- [зона панелі, перевірка зон у юніті] список id зон ламався на кожній легальній зміні `ui-map` → інваріант «зони продукту = зони стенду без `states`/`tech`», не перелік. (Q6)
- [`probe-story-quests`, мережа] від першої картки до експорту 0 запитів сторінки й сцени (`page.on('request')` бачить і iframe) → нові дії продукту перевіряти тим самим записом. (Q6)
- [картка стану, час] чисте перезавантаження з історією 3.0–3.4 с, `minis.hydrate` 5.8–6.1 с (розгортання в реальному часі) з 7–15 с картки → прискорювати `hydrate` (як `fate.give` на годиннику ×10), а не відмовлятися від перезавантаження. (QDb)

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
- [`floaters.collectPoints`, точки до тіл] слот 0 — камера (`camWater`), слот 1 — персонаж (`walkerWater` = `query.result[4]`), `ingest(query, 2)` → нова точка — після них і зсунути offset `ingest`. (Q5b)
- [пляж `my-day`, заплив до берега] шельф ~1 м тягнеться десятками метрів: від −4 м до мілини > 90 м (> 30 с на 3 м/с) → старт проби — від суші назовні до −2 м. (Q5b)
- [погляд униз −1.3 рад + Shift+W до втопленого кадру] за 6.5 с гліб зносить ~10 м убік, кадр позаду камери → огляд: після спуску R і поворот, у пробі — ціль на 8 м перед кадром і 4 м над ним. (Q5b)
- [кадр біля пляжу між персонажем у воді й берегом] гліб до берега бере кадр (стрибок ≤ 4 м на поверхні) → до мілини в обхід кадру. (Q5b)
- [збірка аватара] `avatar.js` Tilecraft іде окремим лінивим чанком 40 KB і бере three з `main` (один three); `test:build` перевіряє наявну `dist`, не будує → перед перевіркою `dist` — `npm run build`. (Q2a)

### Мініатюри

- [`frameFootprint` кадру, що стоїть] той самий кадр `my-day` на тому самому місці дає 10.6–12.4 м по z за кілька секунд (тайли полілінії на хвилях) → розмір кадру порівнювати з допуском ~15 %, не сантиметрами. (Q3)
- [`TileMiniatures.lay`] основа піднята над 4 кутами, тож `contactGap` кутів завжди 0 → «лежить на рельєфі» міряти як висоту основи над рельєфом під центром (0–0.048 м на наборі). (Q3)
- [гідратація біля пляжу] від лінії броду −0.48 м пошук дає центр кадру над глибиною рівно ~1.0 м (`MINI.depth`) → пліт Q4 стартує впритул до мілини; кадр на якорі за 8 с зсувається на 0.27 м. (Q3)

### Пліт і кайт

- [`catalog.change` = `ready`] файл історії прийшов, поле ще компілюється (`app.tiles.loaded` false) → продукт ховає «Завантажуємо…» лише на `scene.ready`. (QDb)
- [`raft.moveTo` з персонажем на палубі] палуба переїжджає одразу, персонаж — у `ride()` наступного кадру → `state.read` одразу після `moveTo` показував старе місце; команда embed чекає й на персонажа. (QDa)
- [якорі `beach` / `shallow` на тестовому наборі] у всіх трьох історіях (198.5, −207.3) і (219.6, −229.4): поле стоїть біля того самого берега → картки однакові для всіх історій, різниться лише кількість кадрів (3 / 10 / 8). (QDa)
- [`uTileMotionLimit`] обмежує лише пружні зсуви тайлів (`state0.zw`), а `offset` кадру — позиція меша → `placed`-кадр уже не обмежений полем; ліміт плоту свій (`RAFT.limit` 1500 м). (Q4)
- [`TileField.syncShadow`, пліт у морі] з усіма кадрами камера тіні розтягувалась би на ~1 км; кадри поза конвертом дрейфу відкинуто → у морі `syncShadow()` = null, пліт тіні не кидає. (Q4)
- [пляж `my-day`, кадр 3] від лінії броду на 10–25 м — мілина 1.0–1.14 м, далі знову 0.7 м → поріг плоту «центр глибше 1 м» садив його одразу; `RAFT.depth` 0.6, `rimDepth` 0.1. (Q4)
- [розгорнутий кадр біля пляжу] обід палуби — за 2.6 м від лінії броду −0.5 м → крок на палубу не дістає; стрибок `DECK_JUMP` 4 м. (Q4)
- [`TileFrameQuery` режим 3, радіус] при 0.4 м біля ніг часто немає тайла (проміжки смуг полілінії `my-day`) → висота не читалась 0.6–0.8 с; радіус 1.2 м + радіус тайла. (Q4)
- [висота палуби, хвиля] верхівки тайлів під ногами −0.04…+0.38 м за 3 с, до 0.7 м/с вертикально → `SETTLE` 0.06 с; ноги від палуби ≤ 0.05 м при читанні щокадру. (Q4)
- [кайт, порядок у кадрі] `pose` до `walkerHost.update` бере ноги минулого кадру → кріплення гуляє 0.354 м у просторі камери на 8 м/с; ставити після кроку. (Q4, рев'ю)
- [`TileSim`, прибій] вода в зміщеній орбітою точці → ітерація x = x₀ + D(x) розгойдується, де dD/dx < −1: 54 % кроків тайлів розвертаються; у точці якоря — 10 на ~230 тис. (INVARIANTS SIM-1, Q4 рев'ю)
- [карта берега] `bakeShoreMap(islandHeight, 1800, …)`: за |x| або |z| > 900 м `shoreSample` дає глибину 60 м і відстань 1e4 → це і є межа відкритого моря (спека §4.3). (код)
- [посадка на ґрунт, порядок у кадрі] `TileRaft.update` іде до кроку персонажа → кайт відпускається лише наступним кадром; `pose` ховає його, коли персонаж ні на палубі, ні в повітрі. (Q4b)
- [стрибок з кута плоту на центр сусіднього кадру] при зазорі 3.6 м пряма перетинала 4.65 м води > `DECK_JUMP` → пошук і найближчої точки кадру в межах 4 м і 45° (`JUMP_CONE`). (Q4b)
- [мініатюра, покладена з плоту, `my-day`] з `freeAt` (кадр радіуса r не ближче r до палуби) зазор до плоту 2.69 м — у межах стрибка. (Q4b)
- [погляд униз у польоті] дошка прямо під ногами, при pitch −0.7 її не видно → для огляду дошки F до упору (−1.3). (Q4b)
- [C-кайт, форма з ескізу `P(u, v)`] стрілоподібність 0.16 хорди й нахил +0.12 рад: з плоту й з берега задня кромка опукла донизу — купол парашута → кінці назад на 1.5 м і нахил −0.3 рад (кінці вниз по стропах), перевіряти знімком з плоту й з берега. (Q5a)
- [планка кайта, «очі» на плоті] планка на −53° від очей, поле зору ±25°: при pitch −0.35 її не видно → огляд планки — F до pitch ≈ −0.85. (Q5a)
- [`ISLAND_SIZE`] 2400 → рельєф і контактна поверхня закінчуються на 1200 м; далі втоплений кадр тоне без дна (Q5). (код)
### Долі кадру

- [смуга полілінії, розпад по тайлах] трикутники стрічки з'єднують сусідні тайли → розірвана тягнеться на 20 м униз «нитками»; розпад смуги — цілою (`fatePiece`). (Q5)
- [висота тайлів за 1300 м від центру] верх тайлів −1.1…+2.6 м між двома читаннями (відкрите море) → «на плаву» в пробі — верх > −3 м, не порівняння з попереднім. (Q5)
- [пліт після `raft.moveTo` у пробі] має запис руху й дрейфує з вітром, доки не почнеться доля → точку повернення брати з `fates.of(id).origin`, не з заміру до долі. (Q5)
- [`&walk` без `&minis`, `my-day`] три кадри ближче 10 м один від одного → доля з палуби йде сусідові (`deckAtHand`), а не кадру під ногами; на маршруті з `&minis` пліт у морі сам. (Q5)
- [кайт після `walker.board()` з польоту] лишається піднятим → K його опускає, а не піднімає; у пробах — `app.raft.setKite(true)`. (Q5)
- [`probe-tiles`] `worldQuery.maxError < 0.002` падає і на HEAD без змін Q5 (`git stash`) → не регресія Q5, причина не з'ясована. (Q5)

- [телефон власника] немає `OES_texture_float_linear` → float-текстура з лінійним фільтром читається як 0 (TEX-1); нові карти лише `HalfFloatType` через `src/engine/halfTexture.js`. (INVARIANTS TEX-1)
