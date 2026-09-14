import { defineConfig } from 'vitest/config';

/**
 * Integration config for the harness's own fixtures — real PostgreSQL, named by `DATABASE_ADMIN_URL`.
 *
 * Separate from the default `test` task (which is unit-only) for the reason every package here keeps them
 * apart: a DB-backed spec must never bleed into the unit run. `fileParallelism: false` because these
 * provision cluster-global roles under one advisory lock, and `hookTimeout` is generous because a first run
 * creates roles, a database and a schema.
 */
export default defineConfig({
    test: {
        include: ['tests/**/*.integration.test.ts'],
        fileParallelism: false,
        hookTimeout: 120_000,
        testTimeout: 60_000,
    },
});
