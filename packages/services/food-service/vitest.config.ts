import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: [
            'src/**/__tests__/**/*.test.ts',
            'tests/**/*.test.ts',
            // The wire-contract drift gates (CODING_STANDARDS §15.2.5). Run in the DEFAULT tier on purpose:
            // they need no database and no network, and a gate that lives in its own tier is a gate someone
            // has to remember to add to CI.
            'contract/__tests__/**/*.test.ts',
        ],
        exclude: ['infra/**', 'tests/e2e/**', '**/*.integration.test.ts', 'node_modules', 'dist'],
        typecheck: {
            enabled: false,
        },
        // The CDK suites that justified this headroom now run in the sibling `infra` package, which owns
        // the `aws-cdk-lib` they import. The headroom is KEPT rather than retuned here: shrinking it
        // back to the 5s default is a separate change that needs timing evidence, and getting it wrong
        // turns a slow-but-correct test into a flaky failure.
        // Originally: CDK stack synthesis was CPU-heavy: fast locally (~1s) but intermittently
        // past the 5s default under the parallel turbo test load on a CI runner, and the first synth-backed
        // test in a file also absorbs `aws-cdk-lib`'s one-time initialization. Same figure and same reason as
        // `packages/services/identity` and `packages/infra/global`, which already carry this headroom, so a
        // slow-but-correct synth never reads as a failure. No assertion here measures a duration.
        testTimeout: 30_000,
        hookTimeout: 30_000,
    },
});
