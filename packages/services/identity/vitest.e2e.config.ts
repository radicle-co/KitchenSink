import { testTempRootSetup } from '@kitchensink/vitest';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // ⛔ Confines this run's temp directories to one removable root — CDK's own `cdk.out*`
        // synth dirs and every `mkdtempSync(tmpdir())` fixture. Asserted by `vitestTempRoot.test.ts`.
        globalSetup: [testTempRootSetup],
        include: ['tests/e2e/**/*.test.ts'],
        typecheck: { enabled: false },
        passWithNoTests: true,
    },
});
