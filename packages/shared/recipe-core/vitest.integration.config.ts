import { defineConfig } from 'vitest/config';

/**
 * Integration tier for `@kitchensink/recipe-core`: real cross-module paths, imported through the package's own export
 * map, with no mocks. Self-contained: no Docker, no network.
 *
 * Kept OUT of the default `test` task (whose glob is `**\/__tests__/**`); it runs via `npm run test:integration`
 * (CODING_STANDARDS §7).
 */
export default defineConfig({
    test: {
        include: ['tests/**/*.integration.test.ts'],
        typecheck: { enabled: false },
    },
});
