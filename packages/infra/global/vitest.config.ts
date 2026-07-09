import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['__tests__/**/*.test.ts'],
        exclude: ['node_modules', 'dist', 'cdk.out'],
        typecheck: {
            enabled: false,
        },
        // CDK stack synthesis is CPU-heavy and runs fast locally (~1s) but intermittently exceeds the
        // 5s default under the parallel turbo test load on CI runners. Give synth-backed assertions
        // realistic headroom so a slow-but-correct synth is never a false timeout failure.
        testTimeout: 30_000,
        hookTimeout: 30_000,
    },
});
