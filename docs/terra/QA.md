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

## T2. Рельєф бухти

`?map=lagoon` будує другу карту: острів ширший, у його березі вздовж того самого напрямку
історії (−46,25°) вирізано круглу бухту з підковою пляжу й двома мисами, гирло відкрите
в море (`src/scene/lagoonHeight.js`, профіль `lagoon` у `src/scene/maps.js`). Декорацій
(пальми, хатина) ще немає — T3. Автоматично покрито `tests/terraRelief.test.js` (пороги §3,
канал від поля до межі 900 м для палуби радіусом 50 м, скеля прибою, каміння поза бухтою)
і `probe-terra-t2` (три історії: старт на піску, мініатюри на суші, пліт під кайтом до
відкритого моря без зупинок, «На берег»). Очима — силует з висоти, хвилі вздовж нового
берега, вигляд гирла з рівня очей.

### QA-T2-1. Огляд бухти з висоти

**qa:mode:** browser
**qa:open:** `http://localhost:5199/products/story-quest/?story=test-2025/my-day-3-moments&map=lagoon`
**qa:action:** дочекатися, поки камера підніметься на огляд (перша секунда після завантаження).
**qa:inspect:** сцена під час огляду, перед спуском до персонажа.
**qa:expected:** острів у формі підкови: зелена суша з сірою вершиною, широкий пісок; з одного
боку кругла бухта, обрамлена двома мисами, між мисами широкий вихід у темно-синє море.
Потім камера спускається на пляж усередині бухти.

### QA-T2-2. Старт: пляж бухти й гирло попереду

**qa:mode:** browser
**qa:open:** `http://localhost:5199/products/story-quest/?story=test-2025/my-day-3-moments&map=lagoon`
**qa:action:** дочекатися спуску до персонажа; мишею повернути погляд ліворуч і праворуч.
**qa:inspect:** сцена з рівня очей.
**qa:expected:** персонаж на сухому піску; попереду бірюзова вода бухти, лінія прибою вздовж
берега й відкрите море по центру; ліворуч і праворуч уздовж води тягнеться той самий пісок
до кінців мисів. Повідомлень про помилку немає.

### QA-T2-3. Пліт виходить із бухти без зупинки

**qa:mode:** browser
**qa:open:** `http://localhost:5199/products/story-quest/?story=test-2025/my-day-3-moments&map=lagoon`
**qa:action:** підійти до мініатюри, G — взяти; W до води, G — розгорнути; W — на кадр; K — кайт;
тримати W, курс на середину гирла (між мисами), ~2,5 хв до відкритого моря.
**qa:inspect:** рух плоту, миси обабіч, межа відкритого моря.
**qa:expected:** пліт іде рівно (~8 м/с), ніде не зупиняється на мілині; миси лишаються
позаду обабіч; після ~140 с пліт перетинає межу відкритого моря (як на острові).

### QA-T2-4. Хвилі й піна вздовж нового берега

**qa:mode:** browser
**qa:open:** `http://localhost:5199/?map=lagoon`
**qa:action:** Controls → camera → «Aerial».
**qa:inspect:** берег бухти й мисів з висоти.
**qa:expected:** лінії прибою й піна повторюють контур підкови й мисів, усередині бухти хвилі
дугами заходять із гирла; немає прямих країв піни чи хвиль на межі карти берега (900 м).

### QA-T2-5. Телефон: бухта на драфті

**qa:mode:** browser
**qa:open:** `https://story-quest--edge-of-elements.netlify.app/products/story-quest/?story=test-2025/my-day-3-moments&map=lagoon`
**qa:action:** дочекатися огляду й спуску; провести пальцем по сцені, роззирнутися; стіком
пройти до води.
**qa:inspect:** огляд з висоти, сцена з рівня очей.
**qa:expected:** з висоти видно два миси й вихід; персонаж на піску бухти, стік і огляд
пальцем працюють, як на острові.

### Свідомо не зроблено в T2

- Пальм, хатини й закритих для мініатюр зон немає — T3. Сіра вершина — той самий матеріал
  скель, що на горі острова.
- Вибору «Місце» в продукті немає — T4; карту задає лише `map=lagoon` в адресі.
- Dev-кадри сцени («Golden hour», «Breakers», «Lagoon», «Underwater») шукають берег променем
  із центру й на бухті можуть дивитися в сушу — це інструменти налаштування, не маршрут.

### Журнал T2

- 2026-11-27, після змін: guard зелений (0,27 с, typecheck 0), focused 16/16
  (`terraRelief`, `maps`), `npm test` 390/390; `probe-terra-t2` PASS — `my-day` 190 с,
  `frog-fairy` 178 с, `hibrid-8` 178 с (пліт 139 с до межі, 0 зупинок, мін. швидкість 6,9 м/с). Острів без змін:
  `test-terrain-contact` pass, `probe-scene-shore` PASS 18 с, `probe-terra-t1` PASS 64 с,
  `probe-story-embed` PASS 54 с. Драфт Netlify — `probe-terra-t2` (`my-day`) PASS 185 с.

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

