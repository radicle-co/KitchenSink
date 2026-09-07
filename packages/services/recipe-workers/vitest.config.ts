import { defineConfig, mergeConfig } from 'vitest/config';
import { baseConfig, CDK_SYNTH_TEST_TIMEOUT_MS, testTempRootSetup } from '@kitchensink/vitest';

/**
 * Default (unit) test config for `@kitchensink/recipe-workers`. Inherits the shared `__tests__/**​/*.test.ts`
 * glob and MUST explicitly exclude `__tests__/integration/**` — those specs need the LocalStack S3 harness
 * and run via `vitest.integration.config.ts` (`npm run test:integration`).
 *
 * The exclude is load-bearing. The integration tier previously used a `.spec` suffix, so the
 * shared `.test.ts` glob missed it by accident; now that the suffix is `.integration.test.ts` (one vitest
 * suffix repo-wide, `.spec.ts` reserved for Playwright — see docs/CODING_STANDARDS.md §7), the glob WOULD
 * collect it into the unit run. That is the bleed Constitution Principle IV forbids.
 */
export default mergeConfig(
    baseConfig,
    defineConfig({
        test: {
            // ⛔ Confines this run's temp directories to one removable root — CDK's own `cdk.out*`
            // synth dirs and every `mkdtempSync(tmpdir())` fixture. Asserted by `vitestTempRoot.test.ts`.
            globalSetup: [testTempRootSetup],
            passWithNoTests: true,
            // `infra/__tests__` synthesizes the workers stack; see the constant's note.
            testTimeout: CDK_SYNTH_TEST_TIMEOUT_MS,
            exclude: ['**/node_modules/**', '**/dist/**', '**/__tests__/integration/**'],
        },
    }),
);
