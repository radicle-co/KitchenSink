import { defineConfig } from 'vitest/config';

import { localE2eAwsPin } from '@kitchensink/service-test-harness/local-aws-pin';

/** The LOCAL e2e AWS pin (`@kitchensink/service-test-harness`'s `awsPin.ts`). */
const awsPin = localE2eAwsPin(process.env);

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
 * collects no test file must fail rather than report green. With no `DATABASE_ADMIN_URL` the global setup throws,
 * so the tier never skips. It runs on a developer's machine, never in CI (owner ruling 2026-10-03).
 */
export default defineConfig({
    test: {
        env: { ...awsPin.env },
        setupFiles: [...awsPin.setupFiles],
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
