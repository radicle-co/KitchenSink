import { baseConfig } from '@kitchensink/vitest';

/**
 * Default (unit) Vitest config for `@kitchensink/recipe-service-client`. The shared `baseConfig` includes
 * only `**\/__tests__/**\/*.test.{ts,tsx}`, so the mocked-`fetch` unit suite runs here while the
 * real-server integration specs (`src/__integration__/**\/*.integration.spec.ts`) are deliberately
 * excluded — they run under `vitest.integration.config.ts` (`npm run test:integration`) in CI.
 */
export default {
    ...baseConfig,
    test: {
        ...baseConfig.test,
    },
};
