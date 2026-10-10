import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/**/__tests__/**/*.test.ts'],
        exclude: ['infra/**', '**/*.integration.test.ts', 'node_modules', 'dist', 'build'],
        typecheck: {
            enabled: false,
        },
        // The CDK suites that justified this headroom now run in the sibling `infra` package, which owns
        // the `aws-cdk-lib` they import. The headroom is KEPT rather than retuned here: shrinking it
        // back to the 5s default is a separate change that needs timing evidence, and getting it wrong
        // turns a slow-but-correct test into a flaky failure.
        // Originally: CDK stack synthesis was CPU-heavy: fast locally but intermittently past
        // the 5s default under the parallel turbo test load on a CI runner, and the first synth-backed test
        // in a file also absorbs `aws-cdk-lib`'s one-time initialization. Same figure and same reason as
        // food-service and packages/infra/global. No assertion here measures a duration.
        testTimeout: 30_000,
        hookTimeout: 30_000,
    },
});
