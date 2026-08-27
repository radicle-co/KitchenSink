import { testTempRootSetup } from '@kitchensink/vitest';
import { defineConfig } from 'vitest/config';

/**
 * T085 — e2e test config for `@kitchensink/recipe-service`.
 *
 * The e2e suite boots the REAL Nest app (`NestFactory.create(AppModule)`) against the Docker Postgres +
 * LocalStack S3 harness (`docker-compose.test.yml`, prepared by `tests/globalSetup.ts`) and drives its
 * HTTP API — the reusable bootstrap lives in `tests/e2e/harness.ts`. Mirrors the identity/food services'
 * e2e configs: each spec migrates a real DB and starts an HTTP listener, so runs are serial with
 * generous timeouts; `passWithNoTests` keeps CI green on paths that add no e2e specs.
 */
export default defineConfig({
    test: {
        include: ['tests/e2e/**/*.e2e.test.ts'],
        exclude: ['node_modules', 'dist'],
        // ⛔ testTempRootSetup FIRST, and MERGED into this array rather than declared as a second
        // `globalSetup` key — a duplicate key is not two hooks, it is one silently overwriting the other,
        // and the one that lost would have been this suite's own database provisioning.
        globalSetup: [testTempRootSetup, './tests/globalSetup.ts'],
        typecheck: { enabled: false },
        passWithNoTests: true,
        // Real DB + Nest bootstrap per file; keep them isolated and unhurried.
        fileParallelism: false,
        testTimeout: 60_000,
        hookTimeout: 120_000,
    },
});
