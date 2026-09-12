import { defineConfig } from 'vitest/config';

/**
 * Unit tests for this CDK package, run by `cdk-checks` beside every other CDK directory's, because `aws-cdk-lib`
 * installs here and not at the repo root.
 */
export default defineConfig({
    test: {
        include: ['__tests__/**/*.test.ts'],
        exclude: ['node_modules', 'dist', 'cdk.out'],
        typecheck: {
            enabled: false,
        },
        // CDK synthesis is CPU-heavy; same figure and reason as `packages/infra/global`.
        testTimeout: 30_000,
        hookTimeout: 30_000,
    },
});
