import { defineConfig } from 'vitest/config';

// Окремо від vite.config.js: юніти не потребують Tilecraft-плагіна й .env.local.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
