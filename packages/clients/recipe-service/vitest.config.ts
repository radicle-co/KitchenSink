import { baseConfig, testTempRootSetup } from '@kitchensink/vitest';

/**
 * Default (unit) Vitest config for `@kitchensink/recipe-service-client`. The shared `baseConfig` includes
 * only `**\/__tests__/**\/*.test.{ts,tsx}`, so the mocked-`fetch` unit suite runs here while the
 * real-server integration specs (`src/__integration__/**\/*.integration.test.ts`) are deliberately
 * excluded — they run under `vitest.integration.config.ts` (`npm run test:integration`) in CI.
 */
export default {
    ...baseConfig,
    test: {
        // ⛔ Confines this run's temp directories to one removable root — CDK's own `cdk.out*`
        // synth dirs and every `mkdtempSync(tmpdir())` fixture. Asserted by `vitestTempRoot.test.ts`.
        globalSetup: [testTempRootSetup],
        ...baseConfig.test,
    },
};
