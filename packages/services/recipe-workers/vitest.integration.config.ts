import { defineConfig } from 'vitest/config';

/**
 * Integration test config for `@kitchensink/recipe-workers`. Runs the S3-backed specs against a real
 * S3 API (LocalStack from the repo test harness — CI provides it; locally set `S3_ENDPOINT`). Kept
 * separate from the default unit run so the Docker-dependent specs never bleed into it. The specs
 * self-provision their bucket and `describe.skipIf(!hasS3Endpoint)` so a machine without the harness
 * skips cleanly rather than failing.
 *
 * The DB-backed specs get their database from `__tests__/integration/globalSetup.ts`, which provisions it
 * once per run under the production role model (ADR-0039) and hands the specs `recipe_app` — the role the
 * deployed workers hold — rather than a superuser.
 */
export default defineConfig({
    test: {
        include: ['**/__tests__/integration/**/*.integration.test.ts'],
        exclude: ['node_modules', 'dist'],
        typecheck: { enabled: false },
        globalSetup: ['./__tests__/integration/globalSetup.ts'],
        // Specs share one S3 endpoint AND one database; run serially, or one file's `truncate()` empties
        // another's fixtures mid-test.
        fileParallelism: false,
        testTimeout: 30_000,
        hookTimeout: 60_000,
        passWithNoTests: true,
    },
});
