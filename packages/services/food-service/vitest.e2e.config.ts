import { defineConfig } from 'vitest/config';

/**
 * E2E config for the food service. Mirrors the identity service's `vitest.e2e.config.ts`:
 * the suite boots the real Nest app against a Docker Postgres (named by `DATABASE_ADMIN_URL`)
 * and exercises its HTTP API. Runs serially with generous timeouts because each spec starts an
 * HTTP listener; `passWithNoTests` keeps CI green on paths that add no E2E specs.
 *
 * The tier has its OWN throwaway database (`food_e2e_test`), provisioned once per run under the
 * production role model (ADR-0039) — so the booted app connects as `food_app`, holding exactly the
 * privileges a deployed task holds, and never as a superuser.
 */
export default defineConfig({
    test: {
        include: ['tests/e2e/**/*.test.ts'],
        globalSetup: ['./tests/e2e/globalSetup.ts'],
        typecheck: { enabled: false },
        passWithNoTests: true,
        // Real DB migration + Nest bootstrap per file; keep them isolated and unhurried.
        fileParallelism: false,
        testTimeout: 60_000,
        hookTimeout: 120_000,
    },
});
