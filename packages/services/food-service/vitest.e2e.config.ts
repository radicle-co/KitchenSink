import { testTempRootSetup } from '@kitchensink/vitest';
import { defineConfig } from 'vitest/config';

/**
 * E2E config for the food service. Mirrors the identity service's `vitest.e2e.config.ts`:
 * the suite boots the real Nest app against a Docker Postgres (see
 * `infra/localstack/docker-compose.yml`) and exercises its HTTP API. Runs serially with
 * generous timeouts because each spec migrates a real database and starts an HTTP listener;
 * `passWithNoTests` keeps CI green on paths that add no E2E specs.
 */
export default defineConfig({
    test: {
        // ⛔ Confines this run's temp directories to one removable root — CDK's own `cdk.out*`
        // synth dirs and every `mkdtempSync(tmpdir())` fixture. Asserted by `vitestTempRoot.test.ts`.
        globalSetup: [testTempRootSetup],
        include: ['tests/e2e/**/*.test.ts'],
        typecheck: { enabled: false },
        passWithNoTests: true,
        // Real DB migration + Nest bootstrap per file; keep them isolated and unhurried.
        fileParallelism: false,
        testTimeout: 60_000,
        hookTimeout: 120_000,
    },
});
