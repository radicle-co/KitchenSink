import { defineConfig, mergeConfig } from 'vitest/config';
import { baseConfig } from '@commise/tools-vitest';

export default mergeConfig(
    baseConfig,
    defineConfig({
        test: {
            passWithNoTests: true,
        },
    }),
);
