import { defineConfig } from 'vitest/config';

/**
 * Integration test config for `@kitchensink/food-service-client`. These specs boot a REAL in-process HTTP
 * server (`node:http`) and drive the client's REAL transport (the platform `fetch`, no fetch double) against
 * it — proving the true wire behavior a mocked `fetch` cannot: the request as it arrives on the socket, real
 * status handling, real body streaming, and the drift-layer-3 skew probe as a genuinely separate,
 * unauthenticated `GET /health` (CODING_STANDARDS §15.2.5).
 *
 * Mirrors `@kitchensink/recipe-service-client`'s tier deliberately, rather than inventing a second shape.
 * Kept OUT of the default `test` task (whose glob is `**\/__tests__/**`) so it never bleeds into the unit run;
 * it runs in CI via `npm run test:integration`. Self-contained — no Docker or external service required.
 */
export default defineConfig({
    test: {
        include: ['src/__integration__/**/*.integration.test.ts'],
        // Each spec owns its own ephemeral server; serial keeps port/lifecycle reasoning simple.
        fileParallelism: false,
        testTimeout: 30_000,
        typecheck: {
            enabled: false,
        },
    },
});
