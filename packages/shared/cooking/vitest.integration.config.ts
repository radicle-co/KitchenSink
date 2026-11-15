import { defineConfig } from 'vitest/config';

/**
 * Integration test config for `@kitchensink/cooking-core`.
 *
 * These specs import the package by its own name, so they run through the `exports` map and the barrel, with recipe
 * steps parsed by recipe-core's real schema and split by the real splitter, walked through the session reducer and
 * the line ticks. Nothing is mocked. Kept OUT of the default
 * `test` task (whose glob is the shared `baseConfig`'s `**\/__tests__/**\/*.test.ts`) so they never bleed into the
 * unit run; they run in CI via `npm run test:integration`. Self-contained: no Docker, no external service.
 */
export default defineConfig({
    test: {
        include: ['tests/**/*.integration.test.ts'],
        typecheck: {
            enabled: false,
        },
    },
});
