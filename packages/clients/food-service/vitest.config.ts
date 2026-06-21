import { baseConfig } from '@kitchensink/vitest';

export default {
    ...baseConfig,
    test: {
        ...baseConfig.test,
        // Placeholder package — the real @kitchensink/food-service-client implementation
        // and its tests land in T-057. Until then, allow the `test` task to pass with no specs.
        passWithNoTests: true,
    },
};
