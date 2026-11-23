# Ultra-Water — архітектура й технічний борг

Знімок станом на 2026-11-22, коміт `c90f052`. Документ описує наявний код
перед спеками [SCENE-UI](SCENE-UI-SPEC.md), [MOOD-WEATHER](MOOD-WEATHER-SPEC.md) і
[SCENE-ENVIRONMENT](SCENE-ENVIRONMENT-SPEC.md). Він не задає правил: правила з
механізмом перевірки живуть в `INVARIANTS.md`, рішення без механізму — у
`DECISIONS.md`.

## 1. Стек і перевірки

| | |
|---|---|
| Мова | Vanilla JS (ES modules), без типів, без JSDoc-перевірки, без лінтера |
| Runtime | `three` 0.186.1, `lil-gui` 0.21 |
| Збірка | Vite 8, власний плагін `build/tilecraft-plugin.js`, Node 24 |
| Tilecraft | Читається через alias `@tilecraft` з `TILECRAFT_ROOT` (`.env.local`); з цього репозиторію лише читається |
| Деплой | Netlify CLI, `scripts/deploy-netlify.mjs` |

Наявні перевірки, виміряні 2026-11-22 (desktop, RTX 3060):

| Що | Команда | Час | Примітка |
|---|---|---|---|
| Конфіг | `npm run check:config` | 2.2 с | Шлях до Tilecraft, версія Node |
| Юніти | `node scripts/test-{frame-pose,terrain-contact,tiles-t4,tiles-t5}.mjs` | 0.33 + 1.35 + 0.34 + 0.32 = **2.3 с** | Чотири окремі скрипти на `node:assert`; спільної команди немає |
| Браузерні проби | `node scripts/probe-*.mjs` (13 файлів, ~2300 рядків) | `terrain-contact` **44 с**, `frame-lifecycle` **103 с** | Потрібен запущений стенд на `localhost:5199`; Playwright + ANGLE D3D11 |
| Дистрибутив | `npm run verify:dist` | — | Хеші, відсутність локальних шляхів, `@fs`, `localhost`, sourcemap |
| Збірка й переносимість | `npm run test:build`, `test:portability` | хвилини | Збірка в переміщених теках, шляхи з пробілами |

Рівнів прогону немає: guard відсутній, юніти не зібрані в одну команду,
бюджетів і чесних кодів виходу в пробах немає.

**Оновлення 2026-11-22:** рівні заведено — `npm run guard` (0.3–1 с, блокує),
`npm test` (vitest, 3–4 с), `npm run lint` (oxlint), `npm run typecheck`.
Деталі — [TESTING.md](TESTING.md), межі — [INVARIANTS.md](INVARIANTS.md).

## 2. Модулі

```
engine/   рендер-примітиви без залежностей: fullscreen-прохід, PostFX (AgX,
          автоекспозиція, bloom, краплі), PlanarReflection, GpuTimer
water/    океан: FFT-симуляція (OceanSim), поверхня й прибій (OceanSurface,
          shoreMap), WaterQuery (GPU→CPU висоти), Caustics, UnderwaterPass,
          Spray, MarineSnow, bakeTextures
scene/    світ: atmosphere + sky (небо й куб), terrain + islandHeight +
          TerrainContact (острів), floaters (+meshes, +shadow)
tiles/    кадри Tilecraft: tilecraftLoader → tileRest → TileSim (GPU) →
          TileField (фасад) з TileFrames, TileInteraction, TilePicker,
          TileFrameQuery, TilePromotion
main.js   корінь композиції, GUI, шоти камери, кадр рендеру, HUD, бенчмарк,
          автороздільність, window.app
```

Розміри: 7780 рядків у 41 файлі; найбільші — `OceanSurface.js` 799,
`main.js` 758, `TileSim.js` 433, `PostFX.js` 421.

### 2.1. Напрямок залежностей

```
main.js ──► tiles ──► water, scene, engine
        ──► scene ◄─► water          (взаємна залежність)
        ──► engine                   (листок, без залежностей)
```

- `engine/` — чистий листок. Його можна переносити без змін.
- `scene/` і `water/` залежать одне від одного: `terrain.js` імпортує
  `OceanSurface` і `Caustics` (спільний GLSL і uniforms води), а
  `OceanSurface`, `UnderwaterPass` імпортують `scene/floaterShadow.js`.
- Модуль оточення `src/environment/` (небо, атмосфера, сонце, куб;
  SCENE-ENVIRONMENT §5, з E1) залежить лише від `three` і своєї папки
  (власна копія `fullscreen.js`); сонце → світло й тінь —
  `src/environment-bindings/hostBinding.js`. Guard BOUNDARY-2.

### 2.2. Кадр рендеру

`renderFrame` ([main.js:506](src/main.js#L506)), по порядку:

1. сонце, якщо `sunDirty` (перепікання неба й тіні);
2. висоти води з минулих кадрів (WaterQuery, запізнення 1–3 кадри) →
   камера під водою?, плавунці;
3. OceanSim (FFT) → каустики → поверхня → тайли (GPU-симуляція) → тінь
   плавунців → бризки → новий запит висот;
4. планарне відбиття → непрозора сцена в HDR MSAA → вода в той самий буфер
   → підводний прохід → PostFX.

### 2.3. Спільний стан і його писарі

| Стан | Хто пише зараз | Коментар |
|---|---|---|
| Камера й `controls.target` | шоти `views`, `moveCamera` (WASD), `clampCamera`, OrbitControls у `main.js`; `TileInteraction` ([TileInteraction.js:156](src/tiles/TileInteraction.js#L156)) | Чотири писарі |
| `controls.enabled` | `TileInteraction` зберігає й відновлює своє значення ([:151](src/tiles/TileInteraction.js#L151), [:258](src/tiles/TileInteraction.js#L258), [:274](src/tiles/TileInteraction.js#L274)) | Без токена чи причини блокування |
| Сонце (`env.params`) | GUI-слайдери, `setSun` у кожному шоті | 6 записів поза модулем оточення (OWNER-4) |
| Куб неба, `env.sun.direction`, `env.sun.color` | `createEnvironment` ([src/environment/index.js](src/environment/index.js)) | Передаються **за посиланням** у воду, рельєф, підводний прохід, каустики й тінь; заміна об'єкта мовчки рве зв'язок |
| Параметри океану | GUI (`ocean.dirty`) | Один писар |
| `window.app` | `main.js` | Неявний публічний API: його читають проби |

## 3. Технічний борг

Пріоритет: **A** — блокує або ламає найближчі спеки; **B** — варто закрити
в межах відповідних фаз; **C** — відомо, не терміново.

| # | Борг | Доказ | Чим загрожує | Пріор. |
|---|---|---|---|---|
| TD1 | `main.js` — усе в одному файлі: композиція, GUI, 9 шотів, HUD, цикл, бенчмарк, пресети води | 758 рядків; найгарячіший файл історії (6 fix-комітів) | U0, U1, M1 і E1 правлять його одночасно; конфлікти й регресії | A |
| TD2 | Камерою й `controls.enabled` керують кілька писарів без власника | §2.3 | Переліт камери (U1) — п'ятий писар. Якщо почати перетягування кадру під час перельоту, `TileInteraction` збереже `enabled = false` і відновить його: керування «залипне» | A |
| TD3 | Сонце пишуть GUI і кожен шот | `setSun` у `views` | Віджет часу доби й погоди (M1) стає третім писарем; шот перезапише вибір людини | A |
| TD4 | Рівнів прогону немає | §1 | Нема дешевої перевірки під час роботи; єдиний доказ — проби по 44–103 с | A | Закрито 2026-11-22: [TESTING.md](TESTING.md). Бюджети й коди виходу проб — TD10.
| TD5 | Ідентичність спільних об'єктів неба — неявний контракт | §2.3 | Виділення модуля (E1) може замінити `cube`/`sunDir` новим об'єктом: вода й рельєф мовчки лишаться на старому | B |
| TD6 | Фрагментний шейдер води на межі 16 семплерів | [OceanSurface.js:61](src/water/OceanSurface.js#L61), [main.js:36](src/main.js#L36), коміт `9a34841` | Будь-яка нова текстура у воді (дощ, хмарні тіні) не скомпілюється на частині GPU | B |
| TD7 | Зміна неба = повне перепікання (6 × 1024² + mip + PMREM + тінь 4096²) без дроселя й замірів | [environment/index.js:44](src/environment/index.js#L44), [main.js:169](src/main.js#L169) | Плавні переходи й плин дня (M2) | B |
| TD8 | Поле історії ставиться за поточним азимутом сонця | [main.js:286](src/main.js#L286) | Час доби до завантаження тайлів зсуне кадри (MOOD §2.2) | B |
| TD9 | `window.app` — API для проб без перевірки ключів | [main.js:635](src/main.js#L635) | Перейменування ключа ламає проби лише на рівні probe, через хвилини | B |
| TD10 | Проби: зашитий `localhost:5199`, бюджетів немає, код виходу при таймауті не перевірено | `scripts/probe-*.mjs` | Убитий прогін може читатися як успіх; FD4: «перший запуск перевищив startup timeout 60 с» | B |
| TD11 | Відкриті бюджети FD5: picking ≤ 8/20 мс, CPU ≤ 0.5 мс на цільових телефонах | EDGE §2.6 | Сенсорні жести рейки й віджета | B |
| TD12 | Немає типів (JSDoc / `checkJs`) | — | Клас «виклик замість значення» ловиться лише в браузері | C |
| TD13 | Взаємна залежність `scene/` ↔ `water/` | §2.1 | Ускладнює перенесення частин, крім оточення | C |
| TD14 | Тайли без туману | [TileMaterial.js](src/tiles/TileMaterial.js) | Кадри «висять» у серпанку (якір A7) | C |
| TD15 | Назви: пакет `gelatin-game-engine`, README «Ultra Water», світ «Edge of the Elements» (з 2026-11-23 — і заголовок вкладки та GUI); `EDGE-OF-THE-ELEMENTS-SPEC.md` поза git | `package.json`, `git status` | Плутанина в документах і збірці | C |

### 3.1. Що закрити перед `spec-to-handoff`

- **TD4** — завести рівні прогону (guard, fast, probe), інакше в жодної фази
  нових спек немає дешевого доказу.
- **TD1, TD2, TD3** — не окремою фазою, а **першою фазою** нових спек:
  винести UI і шоти з `main.js`, завести одного власника камери (lock із
  причиною) і одного писаря сонця. Тоді U0/U1/M1 не правлять один файл
  одночасно.
- **TD5, TD8** — врахувати в E1 і M1 (у спеках уже є).
