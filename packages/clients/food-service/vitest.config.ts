import { baseConfig, testTempRootSetup } from '@kitchensink/vitest';

export default {
    ...baseConfig,
    test: {
        // ⛔ Confines this run's temp directories to one removable root — CDK's own `cdk.out*`
        // synth dirs and every `mkdtempSync(tmpdir())` fixture. Asserted by `vitestTempRoot.test.ts`.
        globalSetup: [testTempRootSetup],
        ...baseConfig.test,
        // The integration tier lives in `src/__integration__` and runs under
        // `vitest.integration.config.ts` (`npm run test:integration`); `baseConfig`'s glob is
        // `**/__tests__/**`, so it is excluded from this unit run by construction.
    },
};
