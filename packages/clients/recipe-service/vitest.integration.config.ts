import { defineConfig } from 'vitest/config';

/**
 * Integration test config for `@kitchensink/recipe-service-client`. These specs boot a REAL in-process
 * HTTP server (`node:http`) and drive the client's REAL transport (`ky` over the platform `fetch`, no
 * fetch double) against it — proving the true wire behavior a mocked `fetch` cannot: real URL/query
 * serialization on the socket, real status handling, real body streaming, and the identity-sync retry
 * end-to-end. Kept OUT of the default `test` task so it never bleeds into the unit run; it runs in CI via
 * `npm run test:integration`. Self-contained (no Docker / external service required).
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
