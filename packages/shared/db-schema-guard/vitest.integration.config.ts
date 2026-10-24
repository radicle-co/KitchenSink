import { defineConfig } from 'vitest/config';

/**
 * Integration tier for `@kitchensink/db-schema-guard`: the seed manifest over a REAL temporary filesystem, where
 * symlinks, special files, modes and modification times exist. It touches no database and no service.
 *
 * Kept out of the default `test` task (whose glob is `**\/__tests__/**`); it runs via `npm run test:integration`
 * (CODING_STANDARDS §7).
 */
export default defineConfig({
    test: {
        include: ['tests/**/*.integration.test.ts'],
    },
});
