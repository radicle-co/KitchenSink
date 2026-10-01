import { baseConfig } from '@kitchensink/vitest';

export default {
    ...baseConfig,
    test: {
        ...baseConfig.test,
        // The integration tier lives in `src/__integration__` and runs under
        // `vitest.integration.config.ts` (`npm run test:integration`); `baseConfig`'s glob is
        // `**/__tests__/**`, so it is excluded from this unit run by construction.
    },
};
