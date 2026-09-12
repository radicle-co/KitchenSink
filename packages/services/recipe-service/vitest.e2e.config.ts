import { defineConfig } from 'vitest/config';

/**
 * T085 — e2e test config for `@kitchensink/recipe-service`.
 *
 * The e2e suite boots the REAL Nest app (`NestFactory.create(AppModule)`) against the Docker Postgres +
 * LocalStack S3 harness (`compose.test.yml`, prepared by `tests/globalSetup.ts`) and drives its
 * HTTP API — the reusable bootstrap lives in `tests/e2e/harness.ts`. Mirrors the identity/food services'
 * e2e configs: each spec migrates a real DB and starts an HTTP listener, so runs are serial with
 * generous timeouts.
 *
 * ⛔ `passWithNoTests: false`: this is a LOCAL-target tier (docs/CODING_STANDARDS.md §7.1a), and a run that
 * collects no test file must fail rather than report green. It is not enough on its own, since every suite
 * skips without `DATABASE_ADMIN_URL`; CI's `.github/scripts/assertLocalTierRan.sh` refuses that case.
 */
export default defineConfig({
    test: {
        include: ['tests/e2e/**/*.e2e.test.ts'],
        exclude: ['node_modules', 'dist'],
        globalSetup: ['./tests/e2e/globalSetup.ts'],
        typecheck: { enabled: false },
        passWithNoTests: false,
        // Real DB + Nest bootstrap per file; keep them isolated and unhurried.
        fileParallelism: false,
        testTimeout: 60_000,
        hookTimeout: 120_000,
    },
});
