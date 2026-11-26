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

## T1. Профіль карти й `map` у контракті

Фаза не змінює вигляду: острів той самий, змінився лише шлях, яким сцена його будує
(`src/scene/maps.js`, `pickMap`). Автоматично покрито `probe-terra-t1` (адреси, `scene.ready`,
`state.read().map`, старт на тому самому березі (198.48, −207.3)) і
`tests/maps.test.js`. Очима — що острів і берег старту не зрушили.

### QA-T1-1. Невідома карта відкриває нинішній острів

**qa:mode:** browser
**qa:open:** `http://localhost:5199/products/story-quest/?story=test-2025/my-day-3-moments&map=foo`
**qa:action:** дочекатися огляду й спуску до персонажа; стіком (або W) пройти до першої мініатюри.
**qa:inspect:** адресний рядок; сцена з висоти й з рівня очей.
**qa:expected:** знайомий острів з горою й скелею прибою; персонаж стоїть на тому самому
березі, що й без `map` (QA-T1-2), поле кадрів на воді попереду; в адресі лишається
`map=foo`; повідомлень про помилку немає.

### QA-T1-2. Посилання без карти — як до фази

**qa:mode:** browser
**qa:open:** `http://localhost:5199/products/story-quest/?story=test-2025/my-day-3-moments`
**qa:action:** дочекатися спуску до персонажа.
**qa:inspect:** сцена з рівня очей, адресний рядок.
**qa:expected:** той самий берег і той самий кут на поле, що в QA-T1-1; у адресі немає `map`.

### QA-T1-3. Вибір історії зберігає карту в адресі

**qa:mode:** browser
**qa:open:** `http://localhost:5199/products/story-quest/?map=foo`
**qa:action:** у списку історій натиснути «My Day in 3 Moments» (`test-2025/my-day-3-moments`).
**qa:inspect:** адресний рядок після натискання; сцена.
**qa:expected:** адреса `?map=foo&story=test-2025/my-day-3-moments`; острів той самий, спуск
до персонажа на березі історії.

### QA-T1-4. Телефон: невідома карта на драфті

**qa:mode:** browser
**qa:open:** `https://story-quest--edge-of-elements.netlify.app/products/story-quest/?story=test-2025/my-day-3-moments&map=foo`
**qa:action:** дочекатися спуску; провести пальцем по сцені, роззирнутися; стіком пройти кілька кроків.
**qa:inspect:** сцена, кнопки «На берег» і «Затихнути».
**qa:expected:** той самий острів і берег, що й без `map=foo` на тому ж драфті; стік і
огляд пальцем працюють, як до фази.

### Свідомо не зроблено в T1

- Карти `lagoon` ще немає: продукт уже передає `map=lagoon` в iframe як відомий ідентифікатор,
  але сцена будує острів і повідомляє `map: 'island'`. Бухта — T2.
- Вибору «Місце» в продукті немає — T4.

### Журнал T1

- 2026-11-27, до змін: guard зелений, focused 102/102 (`cameraFlight`, `shoreTextures`,
  `products`, `walker`), `test-terrain-contact` pass, `probe-story-embed` PASS 52 с,
  `probe-story-states` PASS 180 с.
- 2026-11-27, після змін: guard зелений (0,30 с), focused 133/133 (+ `maps`, `embed`),
  `npm test` 382/382, `test-terrain-contact` pass (ті самі похибки), `probe-terra-t1` PASS 62 с,
  `probe-story-embed` PASS 87 с (якорі ті самі), `probe-story-states` PASS 224 с,
  `probe-story-product` PASS 38 с, `probe-scene-shore` PASS 19 с.
- 2026-11-27: прийнято власником (`handoff:next`); драфт Netlify — `probe-terra-t1` PASS 77 с.

