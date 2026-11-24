# Чернетка: оточення (небо, сонце, настрій) у three — для Tilecraft

Статус: **чернетка** з Ultra-Water, фаза scene-environment E4, 2026-11-24.
Перенести в Tilecraft `viewer/engines/three/` як `ENVIRONMENT-SPEC.md` і
пройти там звичайним циклом спеки; до того вона нічого не вимагає.
Звірено з кодом Tilecraft `36dc43ab` (2026-11-24) лише читанням.

Джерела: [SCENE-ENVIRONMENT-SPEC.md](../../SCENE-ENVIRONMENT-SPEC.md) §5.4–§5.6,
§8 (відповіді власника); [MOOD-WEATHER-SPEC.md](../../MOOD-WEATHER-SPEC.md)
(віджет і карта настрою); README модуля —
[src/environment/README.md](../../src/environment/README.md).

## 1. Мета

Сцена three отримує небо, сонце й настрій погоди з того самого модуля, що й
Ultra-Water: людина обирає настрій у вікні погоди, сцена плавно змінює тло й
світло; продукт (story-space, frame-flight) може запропонувати початковий
настрій. Кадри на `MeshBasicMaterial` лишаються читабельними під будь-яким
настроєм.

Поза межами: океан, рельєф, PostFX Ultra-Water, тіні хмар, туман, дощ.

## 2. Що вже є в three і що з цим робити

| що | де (на `36dc43ab`) | наслідок для цієї спеки |
|---|---|---|
| Тон-мапінг вимкнено | `engine/renderer.js:49` `toneMapping = NoToneMapping` | модуль у режимі `output: 'ldr'` робить експозицію й AgX сам у тлі; `toneMapping` не змінюється (критерій §6 п.4) |
| Світло сцени | `shell/viewer-session.js:724–727`: `HemisphereLight(0xffffff, 0x596778, 2)` + `DirectionalLight(0xffffff, 2.5)` at (-10, 20, -8) | це рівно `THREE_LIGHTS` модуля; `env.ldrLights()` у ясний полудень дає ті самі числа |
| Writer фону №1 | `shell/aura-control.js` `backgroundMode`: `model` / `white` / `black`; `scene.background = backgroundOf() ?? …` | `backgroundOf` — уже наявний гачок переваги; оточення стає його джерелом, а не другим writer-ом |
| Writer фону №2 | `shell/scene-presentation.js` `setEnvironment('light' \| 'calm', { ground })` — градієнт `DataTexture` 1×64 через той самий `backgroundOf`; продукт бачить його як `presentation.control()` | **конфлікт імені й ролі**: «environment» у three вже означає палітру презентації. Див. §7 п.1 |
| Тік | `bus.emit('render-frame', { now })` у `viewer-session.js` | `dt` рахує власник оточення з `now`; власного RAF немає |
| Втрата контексту | `engine/renderer.js` слухає `webglcontextrestored` | після відновлення — `env.restoreContext()` через `setTimeout` (у мікрозадачі обробника відповідь не приходить) |
| Делегат плагіна | SHELL-PLUGIN-CONFIG §5.1 `runtime: { enabled, setEnabled }`; приклад — `plugins/aura.js` | плагін оточення оголошує ту саму пару |

## 3. Розкладка

```
core/environment/*            копія src/environment/ з печаткою (не правити)
shell/environment-control.js  власник: env, світло, джерело фону, тік, context loss, capability
plugins/environment.js        панель: монтує ui/moodPad.js, runtime-делегат
```

Копію кладе й оновлює `node scripts/pack-environment.mjs <tilecraft>/viewer/engines/three/core/environment`
з Ultra-Water. Кожен файл має першим рядком
`scene-environment@<версія>, source: Ultra-Water <коміт> <дата>`; `seal.json`
— sha256 кожного файла без печатки. Перевірка в Tilecraft (пропозиція):
тест, що перераховує sha256 копії й порівнює з `seal.json`, — локальна правка
копії падає. Інверсія (модуль живе в Tilecraft, Ultra-Water імпортує через
`@tilecraft`) — після стабілізації API (SCENE-ENVIRONMENT §8 п.2).

## 4. Вимоги

1. **Один writer `scene.background`.** `aura-control` лишається єдиним, хто
   пише `scene.background`. Режим `sky` у `backgroundMode` (четвертий поряд із
   `model | white | black`) бере значення з `backgroundOf`, яке в цьому режимі
   віддає власник оточення. Тло неба — це `env.background` (Mesh у сцені), не
   текстура: у режимі `sky` власник додає його в сцену, а `backgroundOf`
   віддає `null` (прозорий фон під мешем). За замовчуванням — стриманий
   градієнт (`background: 'gradient'`), повне небо з хмарами — опція
   (`'sky'`; §8 п.1).
2. **Один writer світла.** Власник оточення отримує посилання на
   HemisphereLight і DirectionalLight з `viewer-session` (не створює другу
   пару) і пише їх на `env.on('sun-changed')` з `env.ldrLights()`. Позиція
   сонця — `env.sun.direction × R`, де R покриває сцену.
3. **Runtime-делегат** `enabled` / `setEnabled` (SHELL-PLUGIN-CONFIG §5.1).
   Вимкнення повертає попередній `backgroundMode` і значення світла, зняті
   при вмиканні; `env.update` більше не викликається; `env` не знищується
   до shutdown (повторне вмикання не створює другий).
4. **Тік** — з `render-frame`: `if (env.active) env.update(dt)`, `dt` з різниці
   `now`, обмежений зверху (пропозиція: 0.1 с) — після фонової вкладки τ не
   стрибає.
5. **Products** — capability `environment` (ім'я див. §7 п.1):
   `setMood(v, a)`, `setDay(t)`, `state()`, подія `environment-changed`.
   Продукт задає початковий настрій; після першого дотику людини до віджета
   її вибір має перевагу до кінця сесії: `setMood`/`setDay` продукту
   повертають `{ ok: false, code: 'person-chose' }`, `state()` показує
   `chosenBy: 'product' | 'person'` (§8 п.4).
6. **Вартість.** `cubeSize: 256`, тіней від сонця за замовчуванням немає.
   Перепікання — лише на зміну стану: власник ставить `cloudSpeed: 0` у
   кожен `setState` (у версії 1.0 модуля дрейф хмар перепікає куб і з
   тлом-градієнтом; див. §7 п.3). Тінь — рішення хоста: модуль дає напрямок,
   колір і `sun-changed`, тінь не створює й не перемальовує (§8 п.3).
7. **Context loss** — `env.restoreContext()` після `webglcontextrestored`
   (через `setTimeout`).
8. **Масштаб.** Небо спрямоване, від масштабу сцени не залежить; R для
   позиції сонця й `shadow.camera` (якщо хост увімкне тінь) — від меж сцени.
9. **IBL** (`scene.environment = env.envMap`) за замовчуванням **вимкнено**:
   у LDR його калібровано лише на ясний полудень, у тумані на заході білий з
   IBL 0.32 < 0.55. Без IBL підлога читабельності тримається під усіма
   дев'ятьма якорями. Вмикання — окреме рішення після калібрування (§7 п.2).
10. **Віджет.** `plugins/environment.js` монтує `createMoodPad` з
    `core/environment/ui/moodPad.js` і підключає `ui/moodPad.css`; позицію
    `#moodPad .mood-button` і `#moodPad .mood-panel` задає під свій layout
    (у CSS модуля — розміщення Ultra-Water під `--rail-top`).

## 5. Поведінка, яку бачить людина

- Увімкнули оточення: фон стає градієнтом неба поточного настрою, світло — як
  до вмикання (ясний полудень за замовчуванням), кадри не змінюють кольору.
- Обрали настрій у вікні погоди: тло й світло переходять за кілька секунд
  (τ з `MOOD_TAU`), без стрибка; кадри лишаються читабельними.
- Вимкнули: фон і світло — як до вмикання.

## 6. Критерії приймання (у Tilecraft)

1. Під усіма дев'ятьма якорями `MOOD_MAP_V1` і в точках дня 0.05 / 0.5 / 0.95
   кадр на `MeshBasicMaterial` має білий ≥ 0.55 і чорний ≤ 0.25 sRGB.
2. Ясний полудень з увімкненим оточенням — ΔE ≤ 2 до three без оточення на
   кадрі й на MeshStandard (Ultra-Water `probe-scene-env-ldr` дає 0.00–1.88).
3. Після ввімкнення й вимкнення `scene.background`, `scene.environment` і
   світло дорівнюють значенням до ввімкнення.
4. `renderer.toneMapping` після `createEnvironment` — `NoToneMapping`.
5. Інваріант «один writer»: статична перевірка — `scene.background =` лише в
   `aura-control.js`, `new THREE.HemisphereLight` / `DirectionalLight` для
   сцени — лише у `viewer-session.js`.
6. У спокої (стан не змінюється) `env.active === false` і `env.update` не
   викликається — нуль перепікань за 10 с.
7. Втрата й відновлення контексту (`WEBGL_lose_context`) — небо й світло
   відновлюються без перезавантаження сторінки.
8. Продукт після дотику людини: `setMood` повертає відмову, `state().chosenBy`
   = `'person'`.

## 7. Відкриті питання

1. **Ім'я capability.** `presentation.control().setEnvironment('light' | 'calm')`
   уже є і пише фон через той самий `backgroundOf`. Варіанти: (a) capability
   нового модуля зветься `sky` або `weather`, а `presentation` лишається
   палітрою без неба; (b) `presentation` стає режимом оточення (`light` /
   `calm` → стримані якорі настрою), одна capability. Вирішує власник Tilecraft.
2. **IBL у пакеті.** Чи потрібен IBL MeshStandard-сценам three взагалі; якщо
   так — калібрування по стану, а не лише полудню (зчитування неба з GPU в
   three 0.186 асинхронно лише для `UnsignedByte`).
3. **Дрейф хмар з тлом-градієнтом.** Зараз власник ставить `cloudSpeed: 0`.
   Чистіше — модуль сам не перепікає куб на дрейф, коли тло `'gradient'`
   (зміна в Ultra-Water, мінорна версія 1.1).
4. **Телефон.** Вартість `update` на Samsung Xclipse 540 для куба 256² не
   міряна (у Ultra-Water PMREM 256² там 20.4 мс, 6 граней 1024² — 9.1 мс);
   міряти `measureEnvironment` з модуля.
