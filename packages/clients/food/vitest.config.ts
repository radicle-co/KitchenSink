import { baseConfig } from '@commise/tools-vitest';

export default {
    ...baseConfig,
    test: {
        ...baseConfig.test,
        // Placeholder package — the real @commise/clients-food implementation
        // and its tests land in T-057. Until then, allow the `test` task to pass with no specs.
        passWithNoTests: true,
    },
};
