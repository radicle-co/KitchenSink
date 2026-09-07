import { testTempRootSetup } from '@kitchensink/vitest';
import { defineConfig } from 'vitest/config';

/**
 * Integration test config (real Postgres via `DATABASE_URL`). Kept separate from the default
 * `test` task so DB-backed specs never bleed into the unit run (constitution Principle IV).
 */
export default defineConfig({
    test: {
        // ⛔ Confines this run's temp directories to one removable root — CDK's own `cdk.out*`
        // synth dirs and every `mkdtempSync(tmpdir())` fixture. Asserted by `vitestTempRoot.test.ts`.
        globalSetup: [testTempRootSetup],
        include: ['tests/**/*.integration.test.ts'],
        // Integration specs share a database; run serially to avoid cross-file interference.
        fileParallelism: false,
        hookTimeout: 60_000,
        testTimeout: 30_000,
        typecheck: {
            enabled: false,
        },
    },
});
