import { defineConfig } from 'vitest/config';

/**
 * Integration test config for `@kitchensink/cooking-core`.
 *
 * These specs drive the session-persistence module through a REAL {@link CookingSessionStore}
 * implementation over a device-shaped key/value substrate, across a simulated process restart — the
 * journey a spy-based unit test cannot prove. Kept OUT of the default `test` task (whose glob is the
 * shared `baseConfig`'s `**\/__tests__/**\/*.test.ts`) so they never bleed into the unit run; they run
 * in CI via `npm run test:integration`. Self-contained: no Docker, no external service.
 */
export default defineConfig({
    test: {
        include: ['tests/**/*.integration.test.ts'],
        typecheck: {
            enabled: false,
        },
    },
});
