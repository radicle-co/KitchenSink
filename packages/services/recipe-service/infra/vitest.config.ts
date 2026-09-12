import { defineConfig } from 'vitest/config';

/**
 * Unit tests for this CDK package, run by `cdk-checks` — NOT by the service beside it.
 *
 * ⛔ The service's own vitest used to collect `infra/__tests__/**`, which was right while infra was part of
 * the npm workspace and wrong the moment it left: the suites import `aws-cdk-lib`, and that now installs
 * HERE rather than at the repo root. In CI the service's unit run failed with
 * `Cannot find package 'aws-cdk-lib'`; locally it passed, because a developer's `infra/node_modules`
 * already exists. Moving the run to this package puts the tests where their dependency lives.
 */
export default defineConfig({
    test: {
        include: ['__tests__/**/*.test.ts'],
        exclude: ['tests/**', '**/*.integration.test.ts', 'node_modules', 'dist', 'build', 'cdk.out'],
        typecheck: {
            enabled: false,
        },
        // CDK synthesis is CPU-heavy: fast locally, but intermittently past vitest's 5s default under the
        // parallel turbo load on a CI runner. Same figure and same reason as `packages/infra/global`.
        testTimeout: 30_000,
        hookTimeout: 30_000,
    },
});
