import { defineConfig } from 'vitest/config';

import { localE2eAwsPin } from '@kitchensink/service-test-harness/local-aws-pin';

/** The LOCAL e2e AWS pin (`@kitchensink/service-test-harness`'s `awsPin.ts`). */
const awsPin = localE2eAwsPin(process.env);

/**
 * E2E config for the food service. Mirrors the identity service's `vitest.e2e.config.ts`:
 * the suite boots the real Nest app against a Docker Postgres (named by `DATABASE_ADMIN_URL`)
 * and exercises its HTTP API. Runs serially with generous timeouts because each spec starts an
 * HTTP listener.
 *
 * ⛔ `passWithNoTests: false`: this is a LOCAL-target tier (docs/CODING_STANDARDS.md §7.1a), and a run that
 * collects no test file must fail rather than report green. With no `DATABASE_ADMIN_URL` the global setup throws,
 * so the tier never skips. It runs on a developer's machine, never in CI (owner ruling 2026-10-03).
 *
 * The tier has its OWN throwaway database (`food_e2e_test`), provisioned once per run under the
 * production role model (ADR-0039) — so the booted app connects as `food_app`, holding exactly the
 * privileges a deployed task holds, and never as a superuser.
 */
export default defineConfig({
    test: {
        env: { ...awsPin.env },
        setupFiles: [...awsPin.setupFiles],
        include: ['tests/e2e/**/*.test.ts'],
        globalSetup: ['./tests/e2e/globalSetup.ts'],
        typecheck: { enabled: false },
        passWithNoTests: false,
        // Real DB migration + Nest bootstrap per file; keep them isolated and unhurried.
        fileParallelism: false,
        testTimeout: 60_000,
        hookTimeout: 120_000,
    },
});
