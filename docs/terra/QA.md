# QA: terra

**Деплой:** `node scripts/deploy-netlify.mjs --alias story-quest`

Локально з каталогу `D:/work/_tools/water-3d/Ultra-Water`: `npm install`, потім
`npm run dev`. Стенд — `http://localhost:5199/`; якщо вже працює, другий процес
не запускати. За правилом `AGENTS.md` стенд лишається запущеним після рев'ю.

Тестовий набір історій — той самий, що в [QA story-quest](../story-quest/QA.md):
`test-2025/my-day-3-moments`, `public-test/frog-fairy-full`, фікстура
`?tiles=story-8-frames-hibrid`. Карти — `?map=island` (типово) і `?map=lagoon`
([спека](../story-quest/ISLAND-MAPS-SPEC.md)).

Телефон — лише драфт Netlify `https://story-quest--edge-of-elements.netlify.app/`
(рядок «Деплой» вище). Сценарії для телефона — лише дотики: стік, кнопки,
провести пальцем по сцені.
