import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname) } },
  // Components (.tsx) are rendered in a few tests; tsconfig keeps JSX for Next, so Vite compiles it here.
  oxc: { jsx: { runtime: 'automatic' } },
  test: { include: ['tests/**/*.test.ts'] },
});
