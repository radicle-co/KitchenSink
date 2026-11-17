import { defineConfig } from 'vitest/config';

/**
 * Integration tier for `@kitchensink/recipe-core`. These specs cross a real seam a mocked unit test cannot: the
 * injected `KeyedHash` is satisfied by a real `node:crypto` HMAC, so the fingerprint is proved against the hasher
 * the services use. Self-contained: no Docker, no network.
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
