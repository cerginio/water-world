import { test } from 'vitest';

// Наявні офлайн-перевірки фаз T4/T5/FD1/FD3 — скрипти на node:assert, на які
// посилаються HANDOFF і QA. Вони лишаються самостійними (`node scripts/test-*.mjs`),
// а тут кожен виконується як один тест: assert, що впав, валить імпорт.
const scripts = {
  'test-frame-pose.mjs': () => import('../scripts/test-frame-pose.mjs'),
  'test-terrain-contact.mjs': () => import('../scripts/test-terrain-contact.mjs'),
  'test-tiles-t4.mjs': () => import('../scripts/test-tiles-t4.mjs'),
  'test-tiles-t5.mjs': () => import('../scripts/test-tiles-t5.mjs'),
};

for (const [name, run] of Object.entries(scripts)) test(name, run, 30_000);
