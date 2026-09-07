import { testTempRootSetup } from '@kitchensink/vitest';
import { defineConfig } from 'vitest/config';

// Integration tests run against a real Postgres (CI provides one as a service; locally, set
// DATABASE_URL). They share one database, so run serially to avoid cross-test interference.
export default defineConfig({
    test: {
        // ⛔ Confines this run's temp directories to one removable root — CDK's own `cdk.out*`
        // synth dirs and every `mkdtempSync(tmpdir())` fixture. Asserted by `vitestTempRoot.test.ts`.
        globalSetup: [testTempRootSetup],
        include: ['tests/**/*.integration.test.ts'],
        exclude: ['node_modules', 'dist'],
        typecheck: { enabled: false },
        testTimeout: 30_000,
        hookTimeout: 60_000,
        fileParallelism: false,
        passWithNoTests: true,
    },
});
