import { baseConfig } from '@commise/tools-vitest';

export default {
    ...baseConfig,
    test: {
        ...baseConfig.test,
        passWithNoTests: true,
    },
};
