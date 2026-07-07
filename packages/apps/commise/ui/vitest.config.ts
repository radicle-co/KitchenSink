import { baseConfig } from '@kitchensink/vitest';

export default {
    ...baseConfig,
    test: {
        ...baseConfig.test,
        passWithNoTests: true,
    },
};
