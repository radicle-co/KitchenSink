import { testTempRootSetup } from '@kitchensink/vitest';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // ⛔ Confines this run's temp directories to one removable root — CDK's own `cdk.out*`
        // synth dirs and every `mkdtempSync(tmpdir())` fixture. Asserted by `vitestTempRoot.test.ts`.
        globalSetup: [testTempRootSetup],
        include: ['src/**/__tests__/**/*.test.ts'],
        exclude: ['node_modules', 'dist', 'cdk.out'],
        typecheck: {
            enabled: false,
        },
        // Every suite here synthesizes real CDK apps twice (with and without the Aspect) and cdk-nag
        // walks ~200 rules per resource. That runs in ~1s locally but can exceed the 5s default under
        // parallel turbo load, so give synth-backed assertions realistic headroom.
        testTimeout: 30_000,
        hookTimeout: 30_000,
    },
});
