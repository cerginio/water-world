# AGENTS

## Локальний стенд

На пряму вимогу власника: під час роботи з цим проєктом піднімати dev-стенд
на `http://localhost:5199/` і залишати його запущеним для перевірки власником
після завершення ходу, рев’ю та коміту. Якщо стенд уже працює, використовувати
його без запуску другого процесу. Зупиняти лише на пряму вимогу власника або
для необхідного перезапуску, після якого знову підняти стенд.

Ця вимога власника має пріоритет над правилом навички handoff про зупинку
сервера перед передачею фази на рев’ю.

## Реєстр тем

| тема | HANDOFF.md | код | інваріанти |
|---|---|---|---|
| tile-floaters | [HANDOFF.md](HANDOFF.md) | `src/tiles/`, `vite.config.js`, `src/main.js` | [INVARIANTS.md](INVARIANTS.md); guard — `npm run guard` з кореня, потім focused, потім проба |
| frame-drag | [docs/frame-drag/HANDOFF.md](docs/frame-drag/HANDOFF.md) | `src/tiles/`, `src/scene/`, `src/main.js` | [INVARIANTS.md](INVARIANTS.md); guard — `npm run guard` з кореня, потім focused, потім проба |
| scene-ui | [docs/scene-ui/HANDOFF.md](docs/scene-ui/HANDOFF.md) | `src/ui/`, `src/scene/cameraFlight.js`, `index.html`, `src/main.js`, `src/tiles/TileInteraction.js` | [INVARIANTS.md](INVARIANTS.md); guard — `npm run guard` з кореня, потім focused, потім проба |

## Перевірки фази

Порядок: **guard → focused → probe** ([TESTING.md](TESTING.md#рівні-прогону)).
`npm run guard` (< 2 с) — перед кожним комітом фази; лише він має право
блокувати. Повний прогін — не доказ і не місце, з якого починати. Звіт фази
дає числа **окремо по рівнях**: guard, `npm test`, назва й час кожної проби.

Baseline OWNER-3, OWNER-4 і TYPES-1 лише опускаються: фаза, що прибрала
писаря камери чи сонця або помилку типів, опускає планку в тому ж коміті
(`npm run guard -- --baseline` друкує нові числа, `npm run typecheck -- --baseline`).

Фаза, що виправила регресію **і має для неї механізм** (мутацію, яка валить
перевірку), додає рядок у [INVARIANTS.md](INVARIANTS.md) —
`invariant-guard:add`. Фаза, що прийняла рішення без механізму, додає його в
[DECISIONS.md](DECISIONS.md). Фаза без того й іншого не додає нічого.
