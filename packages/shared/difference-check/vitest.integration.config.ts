import { defineConfig } from 'vitest/config';

/**
 * Integration tier for `@kitchensink/difference-check`. These specs import the package by its name, so they run through
 * the `exports` map and cross the real stemmer and the generated confusables table, with nothing mocked. Kept OUT of the
 * default `test` task (whose glob is `**\/__tests__/**`); it runs via `npm run test:integration` and in CI. No Docker,
 * no network.
 */
export default defineConfig({
    test: {
        include: ['tests/**/*.integration.test.ts'],
        typecheck: { enabled: false },
    },
});
