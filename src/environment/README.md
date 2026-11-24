# scene-environment

Небо, сонце, хмари й запечений куб оточення для будь-якого хоста на `three`
(0.186). Джерело — Ultra-Water `src/environment/`; спека —
`SCENE-ENVIRONMENT-SPEC.md` (§5). Версія — `ENVIRONMENT_VERSION` в `index.js`.

## Межа

- Імпортує лише `three` і файли цієї папки. Без DOM (крім `ui/`), без RAF,
  без камери. Тік дає хост.
- `renderer.toneMapping` модуль не чіпає.
- Світло й тіні — хоста: модуль дає напрямок і колір сонця та подію
  `sun-changed`.

| файл | що |
|---|---|
| `index.js` | єдиний вхід: `createEnvironment`, реекспорт `mood.js`, `ldr.js`, `measure.js` |
| `atmosphere.js`, `sun.js`, `clouds.js` | LUT атмосфери, сонце, шар хмар (GLSL) |
| `skyBake.js`, `skyBackground.js`, `fullscreen.js` | куб неба, тло, повноекранний прохід |
| `state.js` | τ-згладжування параметрів неба |
| `ldr.js` | світло й експозиція для хоста без HDR (`output: 'ldr'`) |
| `mood.js` | карта настрою `MOOD_MAP_V1` + `sampleMood`, крива сонця `SUN_PATH_V1` + `sunAt` |
| `measure.js` | заміри вартості кроків неба (`measureEnvironment`) |
| `ui/moodPad.js` + `ui/moodPad.css` | віджет «вікно погоди» — окремий вхід, чистий DOM |

## Створення

```js
import { createEnvironment, sampleMood, sunAt, MOOD_MAP_V1, SUN_PATH_V1 } from './environment/index.js';

const env = createEnvironment(renderer, {
  output: 'ldr',          // 'hdr' (за замовчуванням, Ultra-Water) | 'ldr' (sRGB, NoToneMapping)
  cubeSize: 256,          // куб неба; Ultra-Water 1024
  envSize: 64,            // куб, з якого PMREM для IBL; менше 64 не дешевше
  background: 'gradient', // 'gradient' (за замовчуванням для ldr) | 'sky' — хмари й диск сонця
  // lowerHemisphere: 'ground' для ldr, 'sea' для hdr
});
```

## Контракт

- **Ідентичність стала.** `env.cube`, `env.envMap`, `env.sun.direction`,
  `env.sun.color`, `env.background` створюються раз і пишуться на місці —
  матеріали можуть тримати їх у uniform-ах.
- **Один writer параметрів.** Хост міняє небо лише через
  `env.setState(next, { tau })` (плавно, τ у секундах, 95 % за 3τ) або
  `env.set(next)` (одразу). `env.params` — лише читати. Ключі:
  `elevation`, `azimuth`, `turbidity`, `rayleigh`, `cloudCoverage`,
  `sunIntensity`, `cloudSpeed`.
- **Тік.** Хост кличе `env.update(dt)` у своєму кадрі, поки `env.active`;
  повертає `{ sunChanged, cubeChanged, moving, faces, pmrem, drift }`. У русі
  куб перепікається по грані за кадр, IBL — після кожних шести граней; після
  `set()` усе в одному `update`.
- **Подія** `env.on('sun-changed', fn)` → функція відписки.
- **Втрата контексту:** на `webglcontextrestored` — `env.restoreContext()`
  (наступний `update` перепікає все). Кликати не з мікрозадачі обробника
  `webglcontextlost`, а через `setTimeout`.
- `env.dispose()` звільняє цілі, PMREM, тло.

## Хост LDR (three)

```js
scene.add(env.background);                 // тло робить свою експозицію й AgX
scene.environment = null;                  // або env.envMap — див. «Обмеження»
env.set({ ...sampleMood(MOOD_MAP_V1, v, a).sky, ...sunAt(SUN_PATH_V1, t), cloudSpeed: 0 });

env.on('sun-changed', () => {
  const l = env.ldrLights();               // пишеться на місці; дорівнює світлу three у ясний полудень
  hemi.color.copy(l.hemisphere.sky); hemi.groundColor.copy(l.hemisphere.ground);
  hemi.intensity = scene.environment ? 0 : l.hemisphere.intensity;   // IBL замінює півсферу
  sun.color.copy(l.sun.color); sun.intensity = l.sun.intensity;
  sun.position.copy(env.sun.direction).multiplyScalar(20);
});

// у кадрі хоста
if (env.active) env.update(dt);
```

Під усіма дев'ятьма якорями `MOOD_MAP_V1` білий папір на `MeshBasicMaterial`
≥ 0.55 sRGB, чорний ≤ 0.25; у ясний полудень світло = `THREE_LIGHTS`
(півсфера 2, сонце 2.5). Демо — Ultra-Water `env-demo.html`.

## Віджет погоди

```js
import { createMoodPad } from './environment/ui/moodPad.js';
// + <link rel="stylesheet" href=".../environment/ui/moodPad.css">
const pad = createMoodPad({ get: () => ({ t, v, a, custom: false }), input: (s, final) => { … }, parent });
```

Розміщення кнопки й панелі в `moodPad.css` — під рейку Ultra-Water
(`--rail-top`); хост задає власне через `#moodPad .mood-button` і
`#moodPad .mood-panel`.

## Обмеження версії 1.0

- **Дрейф хмар перепікає куб** (6 граней кожні ~1/3 с при `cloudSpeed` 1)
  навіть з тлом `'gradient'`, де хмар не видно. Хост без потреби в
  русі хмар ставить `cloudSpeed: 0` — тоді куб перепікається лише на зміну стану.
- **IBL у LDR калібровано лише на полудні** (`LDR_IBL_K`): у тумані на заході
  білий з IBL 0.32 — нижче підлоги 0.55. Хост без IBL (`scene.environment =
  null`) підлоги дотримується під усіма якорями.
- Напрямок вітру хмар сталий (`CLOUD_WIND_DIR`); тіней хмар немає.

## Копія з печаткою

У іншому репозиторії ця папка — копія (спека §5.6 a). Кожен файл починається
рядком `scene-environment@<версія>, source: Ultra-Water <коміт> <дата>`, поруч
`seal.json` з sha256 кожного файла без печатки. Правити копію не можна: зміна —
в Ultra-Water, потім

```
node scripts/pack-environment.mjs <тека копії>
```

Мінорна версія — нова опція чи експорт; мажорна — змінений контракт (значення
за замовчуванням, прибраний експорт, ідентичність `env.cube` / `env.sun.*`).
