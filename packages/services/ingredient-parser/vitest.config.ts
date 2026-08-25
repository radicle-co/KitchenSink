import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/**/__tests__/**/*.test.ts', 'infra/__tests__/**/*.test.ts'],
        exclude: ['**/*.integration.test.ts', 'node_modules', 'dist', 'build'],
        typecheck: {
            enabled: false,
        },
        // `infra/__tests__` SYNTHESIZES CDK stacks, which is CPU-heavy: fast locally but intermittently past
        // the 5s default under the parallel turbo test load on a CI runner, and the first synth-backed test
        // in a file also absorbs `aws-cdk-lib`'s one-time initialization. Same figure and same reason as
        // food-service and packages/infra/global. No assertion here measures a duration.
        testTimeout: 30_000,
        hookTimeout: 30_000,
    },
});
