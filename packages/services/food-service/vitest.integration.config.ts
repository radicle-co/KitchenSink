import { configDefaults, defineConfig } from 'vitest/config';

/**
 * Integration test config (real Postgres via `DATABASE_URL`). Kept separate from the default
 * `test` task so DB-backed specs never bleed into the unit run (constitution Principle IV).
 */
export default defineConfig({
    test: {
        include: ['tests/**/*.integration.test.ts'],
        // T-130 (Phase 3): foods-api.integration.test.ts targets the SUPERSEDED fdcId read API —
        // it imports the old foods/* layer (FoodsRepository/FoodsService/FetchQueueService) that the
        // source-agnostic re-baseline replaces. Parked until Phase 3 rewires foods/* onto the new DAOs
        // (T-130–T-134), which re-adds the new read-API integration coverage. See FU-PHASE0-OUTDATED.
        exclude: [...configDefaults.exclude, 'tests/foods-api.integration.test.ts'],
        // Integration specs share a database; run serially to avoid cross-file interference.
        fileParallelism: false,
        hookTimeout: 60_000,
        testTimeout: 30_000,
        typecheck: {
            enabled: false,
        },
    },
});
