import { defineConfig } from 'vitest/config';

/**
 * T085 — integration test config for `@kitchensink/recipe-service`.
 *
 * Runs the DB-backed integration specs (real Docker Postgres + LocalStack S3 from
 * `docker-compose.test.yml`, provisioned by `tests/global-setup.ts`). Kept separate from the default
 * unit run so DB-backed specs never bleed into it. Mirrors the identity/food services' integration
 * configs: a single shared database means specs run serially to avoid cross-file interference.
 *
 * Integration specs live in `**​/__tests__/integration/**​/*.integration.test.ts` (co-located under the
 * feature domain they cover, per the folder-by-domain convention).
 */
export default defineConfig({
    test: {
        include: ['**/__tests__/integration/**/*.integration.test.ts'],
        exclude: ['node_modules', 'dist'],
        globalSetup: ['./tests/global-setup.ts'],
        typecheck: { enabled: false },
        // Integration specs share one database; run serially to avoid cross-file interference.
        fileParallelism: false,
        testTimeout: 30_000,
        hookTimeout: 60_000,
        passWithNoTests: true,
    },
});
