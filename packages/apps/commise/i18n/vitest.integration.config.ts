import { defineConfig } from 'vitest/config';

/**
 * Integration test config for `@commise/i18n`.
 *
 * These specs import the package by its own name, so they run through the `exports` map and `src/index.ts`: the real
 * locale matcher, the real `Intl` plural rules and the real pseudo-locale expansion, with nothing mocked. Kept OUT of the
 * default `test` task (whose glob is `**\/__tests__/**\/*.test.{ts,tsx}`) so they never bleed into the unit run; they
 * run in CI via `npm run test:integration`. Self-contained: no Docker, no external service.
 */
export default defineConfig({
    test: {
        include: ['tests/**/*.integration.test.ts'],
        environment: 'node',
        typecheck: {
            enabled: false,
        },
    },
});
