import { testTempRootSetup } from '@kitchensink/vitest';
import { defineConfig } from 'vitest/config';

/**
 * Integration test config for `@kitchensink/recipe-workers`. Runs the S3-backed specs against a real
 * S3 API (LocalStack from the repo test harness — CI provides it; locally set `S3_ENDPOINT`). Kept
 * separate from the default unit run so the Docker-dependent specs never bleed into it. The specs
 * self-provision their bucket and `describe.skipIf(!hasS3Endpoint)` so a machine without the harness
 * skips cleanly rather than failing.
 */
export default defineConfig({
    test: {
        // ⛔ Confines this run's temp directories to one removable root — CDK's own `cdk.out*`
        // synth dirs and every `mkdtempSync(tmpdir())` fixture. Asserted by `vitestTempRoot.test.ts`.
        globalSetup: [testTempRootSetup],
        include: ['**/__tests__/integration/**/*.integration.test.ts'],
        exclude: ['node_modules', 'dist'],
        typecheck: { enabled: false },
        // Specs share one S3 endpoint; run serially to avoid cross-file bucket interference.
        fileParallelism: false,
        testTimeout: 30_000,
        hookTimeout: 60_000,
        passWithNoTests: true,
    },
});
