# Handoff: scene-ui — прихований технічний UI і рейка опорних точок

Стан на 2026-11-22. Гілка `master`. Фази з
[SCENE-UI-SPEC.md](../../SCENE-UI-SPEC.md) (далі — «спека»). U0 закрито
2026-11-22 (коміт закриття U0); U1–U3 відкриті.

> **Далі:** U1 — власник камери з lock і причиною, `src/scene/cameraFlight.js`, рейка зі станціями `island` / `shore` / `story` без `setSun` (спека §4.1, §4.2, §4.4, §4.5).

Локальний стенд: `http://localhost:5199/`; правило стенду — `AGENTS.md` →
«Локальний стенд».

## НЕЗАКРИТЕ — почни звідси

Фази по порядку. Guard для всіх фаз: `npm run guard` зелений (OWNER-1…5,
BOUNDARY-1…3, BUDGET-1, TYPES-1); `npm test` зелений; `?tiles=none` і
`runBenchmark({ shot })` поводяться як до фази. Порядок перевірок —
guard → focused → probe ([TESTING.md](../../TESTING.md#рівні-прогону)).

~~1. **U0 — технічний UI схований** (спека §3): lil-gui і `#perf` сховані,
   F2/F3, `?controls`/`?fps`/`?debug`, смужка F2/F3 на три дотики; код у
   `src/ui/techPanels.js`.~~ — ЗАКРИТО 2026-11-22: [QA.md](QA.md) → U0,
   проба `scripts/probe-scene-ui.mjs`.

2. **U1 — власник камери, переліт і рейка `island` / `shore` / `story`**
   (спека §4.1, §4.2, §4.4, §4.5; рішення власника 2026-11-22 — одна фаза,
   без окремої фази під власника камери).
   - Контракт, власник камери (ARCHITECTURE TD2): один модуль володіє
     `camera` / `controls` і видає lock із причиною. Шоти, WASD,
     `clampCamera` і `TileInteraction` пишуть камеру лише через нього.
     `TileInteraction` більше не зберігає й не відновлює `controls.enabled`
     сам ([TileInteraction.js:151](../../src/tiles/TileInteraction.js#L151),
     [:258](../../src/tiles/TileInteraction.js#L258),
     [:274](../../src/tiles/TileInteraction.js#L274)): перетягування кадру під
     час перельоту не лишає керування «залиплим».
   - Контракт, переліт: `src/scene/cameraFlight.js` без DOM — тривалість
     `clamp(1.2 + 0.9·log2(1 + d/50), 1.2, 5)` с, Безьє з підйомом
     `min(0.25·d, 300)` при `d > 100`, smootherstep, межі
     `islandHeight + 0.8` і `camWater + 1`, перехоплення pointerdown / колесом
     / WASD, перебудова кривої від поточної пози, reduced motion — згасання
     250 мс.
   - Контракт, рейка: чотири вузли (●/◎, намистинка, підписи uk/en); активні
     `island`, `shore`, `story`; `story` і `frame` неактивні без тайлів;
     клавіші `1`–`3`; `window.app.stations = { go, nextFrame, prevFrame, current }`.
     Станції **не** викликають `setSun`; дев-шоти в Controls лишаються.
   - `shore`: камера сидячої людини (1.6 м над піском) на пляжі, найближчому
     до поля історії, погляд на поле історії й море (рішення власника вище).
   - Закриття: guard — OWNER-3 опускає baseline 27 у тому ж коміті
     (`npm run guard -- --baseline`); правило має рахувати модуль-власника як
     єдиного дозволеного писаря, а не додавати його новим файлом у baseline.
     OWNER-4 не росте (станції сонця не пишуть). Нове правило з мутацією —
     `invariant-guard:add`, рішення без механізму — у DECISIONS.md.
     Focused — юніт-тести `cameraFlight` (тривалість, підйом, межі, нульова
     швидкість на кінцях). Проба — §4.7 п.1–3, 6, 7: семпли пози кожен кадр
     (жоден не під рельєфом / водою), `sky.params` незмінні за переліт,
     pointerdown під час перельоту → `controls.enabled` одразу true, без тайлів
     `story` неактивна, `prefers-reduced-motion` через емуляцію. Регресія:
     `probe-frame-drag.mjs` PASS (FD2-жест через lock).
   - Чернетка QA: `qa:open` `http://localhost:5199/?tiles=story-8-frames-hibrid`
     → `qa:action` Острів → Історія, під час перельоту потягнути кадр →
     `qa:inspect` камеру після відпускання → `qa:expected` переліт зупинився,
     кадр перенесено, орбіта камери працює одразу.

3. **U2 — станція «Мить»** (спека §4.3).
   - Контракт: порядок `tiles.frames`; «Мить» з іншої станції — останній
     кадр у фокусі (спочатку перший), повторно — наступний, після останнього
     — перший; `←`/`→` на станції `frame`, клавіша `4`, свайп по вузлу; поза
     з `entry.world` / `entry.bounds` через матрицю поля, відстань як у шоті
     `Tiles` ×1.3, нахил 35°, азимут `fieldYaw`; стеження за дрейфом ≤ 2 м/с
     до першого дотику; `TileInteraction` фокус не чіпає; «Мить 1/1».
   - Закриття: проба §4.7 п.4–5 — `→` по всіх 8 кадрах hybrid із правильним
     N/M і переходом 8 → 1; кадр у drift 30 с лишається в кадрі екрана (bounds
     у NDC усередині [-1, 1]). Регресія — `probe-frame-drag.mjs` PASS.
   - Чернетка QA: `qa:open` `…/?tiles=story-8-frames-hibrid&tilesMode=drift`
     → `qa:action` «Мить», потім `→` 8 разів → `qa:inspect` лічильник і кадр
     → `qa:expected` 1/8 … 8/8 → 1/8, кадр заповнює ~75 % екрана й не
     випливає з нього.

4. **U3 — мобільний профіль, a11y, i18n, телефон** (спека §4.6, §4.7 п.8).
   - Контракт: рейка на всю ширину з відступами 16 px над
     `safe-area-inset-bottom`; смужка F2/F3 і ввімкнена `#perf` — над рейкою;
     вузли `<button>` з `aria-label` і `aria-current="location"`, видимий
     фокус; місце під круглу кнопку погоди праворуч від рейки (саму кнопку
     робить MOOD-WEATHER).
   - Закриття: проба в mobile-профілі (перекриття прямокутників рейки,
     смужки й `#perf` = 0, зони дотику ≥ 44×44 px, aria-атрибути). П.8 —
     замір FPS на OnePlus Nord 4 під час перельоту проти статичної камери в
     тій самій точці; це робить власник, desktop mobile-профіль його не
     замінює.

### Відкриті питання

- **`shore` — вирішено власником 2026-11-22:** дивиться на поле історії (й
  море за ним), не на горизонт. Спека §7 ще перелічує це питання як
  відкрите; таблиця §4.2 вже описує саме цей варіант.
- **Три пальці на iOS Safari** (спека §3.2): системні жести редагування
  тексту можуть перехопити дотик. Справжній iPhone ще не перевірено
  (QA-U0-10); якщо перехоплюються — питання власнику, не тихий інший жест.
- **Три дотики й `TileInteraction` — перевірено в U0:** drag не починається,
  кадри й камера не рухаються; кадр під першим пальцем лишається виділеним
  (поведінка FD2, як після pinch). Змінювати — рішення власника, у frame-drag.
- **Смужка F2/F3 і рейка.** Смужка стоїть на 8 px над нижнім краєм — туди ж,
  де стане рейка U1. U1 піднімає смужку над рейкою (спека §4.6) або явно
  лишає це U3; перекриття не залишати мовчки.
- **`main.js` правлять кілька тем.** SCENE-ENVIRONMENT E1 теж виносить код із
  `main.js`; її краще брати після U0, не паралельно.
- **Сонце.** U1 лише не додає писарів; baseline OWNER-4 (6) опускає
  MOOD-WEATHER M1, коли віджет погоди стане єдиним писарем.

## Що зроблено і працює

Baseline (U0, 2026-11-22): guard зелений (OWNER-3 27, OWNER-4 6, TYPES-1 21);
`npm test` 18/18; проба `probe-scene-ui` PASS.

| підсистема | де | контракт | перевірка |
|---|---|---|---|
| технічні панелі | [src/ui/techPanels.js](../../src/ui/techPanels.js) (`createTechPanels`, `panelsFromUrl`, `TripleTap`, `isEditing`); `app.techPanels` | спека §3: сховані від старту, F2/F3 без модифікаторів і не в полі вводу, `?controls`/`?fps`/`?debug`, смужка `#techStrip` на три дотики; стан не зберігається | `tests/techPanels.test.js`, `scripts/probe-scene-ui.mjs` |
| HUD `#perf` | [index.html](../../index.html), `updateHud` у [main.js](../../src/main.js) | схований `#perf` → жодних DOM-записів; лічильник FPS, `GpuTimer`, `autoResolution`, `runBenchmark` від видимості не залежать | `probe-scene-ui` |
| lil-gui «Gelatin Water» | `new GUI` у [main.js](../../src/main.js) (OWNER-2) | видимістю керує `techPanels`; на телефоні відкривається згорнутою; список `camera` — дев-шоти зі `setSun` | `probe-scene-ui` |

Основа для U1–U2, темою ще не змінена:

| підсистема | де | що є зараз |
|---|---|---|
| камерні шоти `views` | [main.js:207](../../src/main.js#L207) | миттєвий стрибок; кожен шот викликає `setSun` ([main.js:202](../../src/main.js#L202)) |
| вільна камера | OrbitControls + WASD, [main.js:50-86](../../src/main.js#L50-L86) | WASD ігнорує модифікатори й `isEditing` |
| межа камери | `clampCamera`, [main.js:578](../../src/main.js#L578) | не нижче рельєфу +0.8 м, щокадру |
| якір поля історії | `coast()` [main.js:195](../../src/main.js#L195), `tilesAnchor` [main.js:282](../../src/main.js#L282) | точка на березі + напрям у море |
| кадри історії | `tiles.frames`, `TileFrames.entries` (`world`, `bounds`, `mode`) | фокусу на кадрі немає |
| бенчмарк / API | `runBenchmark` [main.js:604](../../src/main.js#L604), `window.app` [main.js:638](../../src/main.js#L638) | `runBenchmark({ shot })` ставить шот |
| guard | [INVARIANTS.md](../../INVARIANTS.md) | OWNER-3 baseline 27 (`main.js` 21, `TileInteraction.js` 6), OWNER-4 baseline 6 |

## Головні виміряні факти

### Стенд і інструменти

- [`npm test` з Git Bash] шлях `/d/…` дає два екземпляри vitest: «failed to find the current suite» у кожному файлі → запускати з PowerShell (18/18). (U0)
- [проби, що клікають lil-gui] панель схована з U0 → URL проби має містити `&controls`; `probe-tiles`, `probe-tiles-drift`, `probe-frame-pose`, `probe-frame-drag` уже мають. (U0)
- [CDP `Input.dispatchTouchEvent`, 3 точки, `hasTouch`] Chromium генерує pointer-події, `TripleTap` спрацьовує → жест перевіряється без телефона. (U0)
- [mobile-профіль, CPU throttle ×20, FPS схований] `autoResolution` знизила 0.6 → 0.55 → так перевіряти адаптацію без HUD. (U0)

### Камера й `main.js`

- `src/main.js` — ~770 рядків, найгарячіший файл історії (ARCHITECTURE TD1).
- `TileInteraction` при виборі кадру зберігає `controls.enabled` і вимикає
  його, при відпусканні відновлює збережене значення
  ([TileInteraction.js:151](../../src/tiles/TileInteraction.js#L151)): переліт,
  що вимикає controls, без спільного lock зробить керування «залиплим»
  (ARCHITECTURE TD2) → U1 заводить lock до того, як переліт вимикає controls.
- Браузерні проби потребують запущеного стенду й
  `$env:PLAYWRIGHT_MODULE` (див. [docs/frame-drag/HANDOFF.md](../frame-drag/HANDOFF.md));
  startup timeout 60 с уже двічі не вистачало (ARCHITECTURE TD10) → нову пробу
  запускати з 120 с.
