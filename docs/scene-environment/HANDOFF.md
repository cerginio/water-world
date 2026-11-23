# Handoff: scene-environment — заміри неба й переносний модуль оточення

Стан на 2026-11-23. Гілка `master`. Фази з
[SCENE-ENVIRONMENT-SPEC.md](../../SCENE-ENVIRONMENT-SPEC.md) (далі — «спека»).
E0, E1 закрито; код теми — `src/environment/` (модуль) і
`src/environment-bindings/hostBinding.js`, `applySun` у `main.js`.

> **Далі:** mood-weather M1a, потім M1b ([docs/mood-weather/HANDOFF.md](../mood-weather/HANDOFF.md)); E2 цієї теми — лише після закриття M1b.

Локальний стенд: `http://localhost:5199/`; правило стенду — `AGENTS.md` →
«Локальний стенд».

## НЕЗАКРИТЕ — почни звідси

Порядок тем, визначений власником 2026-11-23: **E0 → E1 → mood-weather M1a →
M1b → E2 → …** Після E1 наступні фази — у темі `mood-weather`
([docs/mood-weather/HANDOFF.md](../mood-weather/HANDOFF.md)), E2 починається
лише після закриття M1b. `main.js` у цей час не правлять паралельно інші теми.

Guard для всіх фаз: `npm run guard` зелений (OWNER-1…5, BOUNDARY-1…3,
BUDGET-1, TEX-1, TYPES-1); `npm test` зелений; `?tiles=none` і
`runBenchmark({ shot })` поводяться як до фази. Порядок перевірок —
guard → focused → probe ([TESTING.md](../../TESTING.md#рівні-прогону)).

~~1. **E0 — заміри** (спека §4, §6): мітка `sky` у `GpuTimer`,
   `app.measureEnvironment()`, кнопка Measure sky, проба
   `scripts/probe-scene-env-measure.mjs`.~~ — ЗАКРИТО 2026-11-23: [QA.md](QA.md) → E0;
   рішення §4 — [DECISIONS.md](../../DECISIONS.md) «Оточення: оновлення неба в часі».

~~2. **E1 — виділення модуля** (спека §5.1–§5.3). `src/environment/`
   (`index.js`, `atmosphere.js`, `skyBake.js`, `skyBackground.js`, `sun.js`,
   `fullscreen.js`) + `src/environment-bindings/hostBinding.js` (сонце →
   DirectionalLight і тінь). `main.js` створює оточення через
   `createEnvironment`; `env.cube`, `env.sun.direction`, `env.sun.color` —
   ті самі об'єкти за ідентичністю, що отримують `terrain.js` і
   `OceanSurface.js`. `measureEnvironment.js` переходить у модуль разом із
   небом (проба E0 має лишитися зеленою). `state.js`, `mood.js`, `ldr.js`, `ui/moodPad.js` і
   `seaBinding.js` — не тут (E2, mood-weather M1a/M1b, E3).
   - guard: **BOUNDARY-2 розширюється** на `src/environment/**` (рішення
     власника 2026-11-23, замість окремого `check:environment` зі спеки
     §5.2); `SUN_OWNER` OWNER-4 переїжджає в модуль, baseline лишається 6
     (опускає mood-weather M1a); мутація «файл модуля імпортує `../water/…`» валить guard.
   - проба (рішення власника 2026-11-23): readback 6 граней куба, `sunDir`,
     `sunColor` при тих самих параметрах до й після — різниця ≤ 1/255 на
     канал; плюс знімки шотів `Golden hour`, `Lagoon`, `Aerial`, `Tiles` зі
     зупиненим `elapsed` (новий дебаг-хук) — ≤ 1/255 поза дитером.
     Еталон знімається **до** перенесення коду.
   - QA очима: шоти, підводний вигляд, відновлення після
     `webglcontextrestored`.~~ — ЗАКРИТО 2026-11-23: [QA.md](QA.md) → E1; з API §5.3
     поки лише `createEnvironment`, `params`, `sun`, `cube`, `background`, `update()`,
     `dispose()` — решта в E2.

3. **E2 — плавне небо** (спека §4, §5.3 `setState`/`update`, `on`,
   `restoreContext`). `state.js` з τ-згладжуванням; за рішенням E0 (DECISIONS.md): у русі куб 1024² — грань за
   кадр, PMREM не оновлюється; у спокої — `scene.environment` = PMREM копії
   куба 256²; тінь раз на 0.5 с під час руху. Після mood-weather M1b.
   - проба: перехід станів дає монотонну зміну `sunDir`, без кадрів із
     повним перепіканням під час руху; `update()` повертає
     `{ sunChanged, cubeChanged }`.
   - критерій спеки §7 п.3 (≤ 33 мс через `sky`) — телефон власника
     (Xclipse 540, кнопка Measure sky / запис), спека називає Nord 4.

4. **E2b — анімовані хмари** (спека §3.3). Хмари в `BG_FRAG` з `uTime` і
   вітром хмар; той самий `uTime` у кубі при перепіканні; `cloudSpeed` у
   стані.
   - проба: два знімки тла з різницею 1 с відрізняються в зоні хмар, а без
     хмар (`cloudCoverage = 0`) — ні.
   - критерій §7 п.4 (немає стрибка на відбитті) — запис екрана, власник.

5. **E3 — LDR** (спека §5.4). `output: 'ldr'`, `lowerHemisphere: 'ground'`,
   `env.ldrLights()`; `ldr.js`; сторінка `env-demo.html` без води:
   MeshStandard + MeshBasic-«кадр» під дев'ятьма якорями.
   - проба: критерії §7 п.5–6 — білий ≥ 0.55, чорний ≤ 0.25 sRGB під усіма
     якорями; ΔE ≤ 2 до three у ясний полудень; `renderer.toneMapping` після
     `createEnvironment` незмінний.
   - потребує даних якорів з mood-weather M1a (`MOOD_MAP_V1`).

6. **E4 — пакет для three** (спека §5.5, §5.6). Печатка версії
   `scene-environment@x.y`, README модуля, чернетка спеки для Tilecraft.
   - перевірка: тест копіює `src/environment/` у тимчасову теку й імпортує
     `index.js`, маючи лише `three`.
   - залежить від відкритих питань §8 (нижче).

### Відкриті питання

- **Спека відстає від рішень 2026-11-23:** §5.2 і §7 п.2 ще описують
  `npm run check:environment` (діє BOUNDARY-2 по `src/environment/**`); §5.3
  показує `lowerHemisphere`/`output` — у коді лише `cubeSize` і `params`. Шот
  `Underwater` з §7 п.1 у коді є (E1 його перевірив). Спеку поправити через
  `handoff:spec scene-environment`.
- **Спека §8** — питання власнику: п.1 (небо як фон у three), п.3 (тіні
  сонця в three), п.4 (настрій від products) — блокують E3/E4 і спеку
  Tilecraft, не E0–E2; п.2 (копія з печаткою → інверсія) — блокує E4.
- **Телефон власника — Samsung Xclipse 540, не OnePlus Nord 4**, якого
  вимагає спека (§6, §7 п.3): E0 міряно на ньому. Для E2 — уточнити, чи досить
  цього телефона.
- **`probe-scene-ui` на `?tiles=story-8-frames-hibrid: strip after tap`**: у E0
  падав і без змін E0, у E1 пройшов — нестабільна, тема scene-ui.
- **`main.js` правлять кілька тем** (scene-ui, frame-drag, tile-floaters,
  mood-weather): не брати фази паралельно.

## Що зроблено і працює

Baseline (E1, 2026-11-23): guard зелений (BOUNDARY-2 7 файлів, OWNER-4 6, TEX-1 16,
TYPES-1 21); `npm test` 66/66; проби `probe-scene-env-identity` (Δ 0), `-env-measure`,
`-mobile`, `-rail`, `-ui` PASS.

| підсистема | де | контракт | перевірка |
|---|---|---|---|
| модуль оточення | [src/environment/index.js](../../src/environment/index.js) (`createEnvironment` → `env`: `params`, `sun.{direction,color}`, `cube`, `cubeTarget`, `background`, `update` = `updateSun` → `bakeLuts` → `bakeCube`, `bakeCubeInto`, `dispose`); `skyBake.js`, `skyBackground.js`, `sun.js`, `atmosphere.js`, копія `fullscreen.js` | спека §5; лише `three` і своя папка; `env.cube`/`env.sun.*` — сталі об'єкти, їх тримають [terrain.js:340](../../src/scene/terrain.js#L340), [OceanSurface.js:750](../../src/water/OceanSurface.js#L750), `scene.environment` | guard BOUNDARY-2, `probe-scene-env-identity` |
| сонячне світло | `bindSunLight` у [hostBinding.js](../../src/environment-bindings/hostBinding.js); `applySun`, `setSun`, `sunDirty` у [main.js:169](../../src/main.js#L169) | зміна неба = `env.update()` + світло + тінь 4096²; 6 писарів `env.params` (OWNER-4); відновлення контексту — `sunDirty` у `main.js` | guard OWNER-4 |
| кадр без часу | `?still` + `app.still({ shot, frames, dt })` у [main.js](../../src/main.js) | цикл не стартує; N кадрів із фіксованим dt, після кожного — GPU-fence і зчитування висот; повертає RGBA останнього кадру | [probe-scene-env-identity.mjs](../../scripts/probe-scene-env-identity.mjs) |
| GPU-таймер | [src/engine/gpuTimer.js](../../src/engine/gpuTimer.js) (`GpuTimer`: `begin(label)`, `ms`, `drain`); мітки — `renderFrame` у [main.js](../../src/main.js) | мітки не вкладаються; зміна неба — мітка `sky` всередині кадру таймера | `runBenchmark`, `probe-scene-env-measure` |
| заміри неба | [src/environment/measure.js](../../src/environment/measure.js) (`measureEnvironment`, кроки хоста — `steps: { spectrum }`); `app.measureEnvironment`, кнопка `#pSky` у `#perf`; копіювання панелі — [src/ui/perfCopy.js](../../src/ui/perfCopy.js) (`DoubleTap`, `bindPanelCopy`) | час між GPU-fence, цикл на паузі (`benchmarking`); кроки lut, cube, pmrem, pmrem256, shadow, spectrum; параметри неба не змінює | `probe-scene-env-measure`, `tests/perfCopy.test.js` |

## Головні виміряні факти

### Небо й `main.js`

- [PMREM неба] розмір PMREM у three = розмір вихідного куба (`_setSize`, `lodMax` 10 для 1024²) → дешевший PMREM — лише з меншої копії куба. (E0)
- [кілька розмірів PMREM] спільний `PMREMGenerator` three (`WebGLEnvironments`) перевикористовує кешований target без перебудови сіток і шейдерів під новий розмір: після PMREM 256² PMREM 1024² рахувався за ~1 мс і неправильно → кожен розмір — власний `PMREMGenerator`, або в `scene.environment` лише один розмір. (E0)
- [телефон власника, Xclipse 540, 460×834] зміна неба ~280 мс: PMREM 1024² 268–280, PMREM 256² 20.4, 6 граней 9.1, lut 1.3, тінь 0.7–1.8, спектр 1.0 мс; кадр ~21 мс. (E0)
- [desktop AMD 890M, 1280×720] PMREM 1024² 26–39, PMREM 256² 2.1–3.7, 6 граней 1.7–5.0, тінь ≤ 0.6 мс (нижче шуму — доказ перемальовування `shadowCalls` = 2). (E0)
- [GPU-таймер у headless Chromium] запити не повертаються (8 у черзі, `opaque` > 1000 мс) → заміри — за GPU-fence, не за `timer.ms`. (E0)
- [телефон без DevTools] числа з HUD — кнопка Measure sky і подвійний дотик по панелі FPS (копіює текст); кожен драфт — нова адреса, старе посилання дає стару збірку. (E0)
- [новий файл у `src/environment/`] BOUNDARY-2 (`ruleEnvironmentPortable`) пускає лише `three` і відносні шляхи всередині папки; < 7 файлів (`ENV_MIN_FILES`) або без `index.js` — FAIL → файл модуля нічого не імпортує з `engine/`, `water/`, `scene/`. (E1)
- [знімки до/після зміни неба чи модуля] `probe-scene-env-identity` (`?still`, 45 кадрів, dt 1/60) дає Δ 0/255 між прогонами одного коду на 890M → еталон знімати `PROBE_MODE=capture` на коді **до** зміни (git stash + лише хук `?still`), потім порівнювати. (E1)
- [`Math.random` у пробі] three бере UUID кожного об'єкта з `Math.random`; копія `fullscreen.js` додала геометрію й камеру й зсунула послідовність, засіяну на старті сторінки → `Underwater` (поплавці з випадковим yaw) 10 000 каналів із Δ до 46 → засівати безпосередньо перед `app.still()`. (E1)
- [чутливість проби] світло сонця ×1.02 дає лише 9 каналів > 1/255 у `Lagoon` (автоекспозиція гасить), висота хмар +0.8 % — куб Δ 4.9e-3 → освітлення кадр ловить слабко; для E2/E3 перевіряти ще `sunLight.intensity`/колір. (E1)
