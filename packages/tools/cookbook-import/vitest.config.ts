import { testTempRootSetup } from '@kitchensink/vitest';
import { defineConfig } from 'vitest/config';

/** Unit tier: the pure segmentation/extraction logic. No network, no filesystem beyond committed fixtures. */
export default defineConfig({
    test: {
        // ⛔ Confines this run's temp directories to one removable root — CDK's own `cdk.out*`
        // synth dirs and every `mkdtempSync(tmpdir())` fixture. Asserted by `vitestTempRoot.test.ts`.
        globalSetup: [testTempRootSetup],
        include: ['src/**/*.test.ts'],
        exclude: ['tests/**', 'node_modules/**'],
    },
});
