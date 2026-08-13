import { defineConfig } from 'vitest/config';
import { CDK_SYNTH_TEST_TIMEOUT_MS } from '@kitchensink/vitest';

export default defineConfig({
    test: {
        include: ['src/**/__tests__/**/*.test.ts'],
        exclude: ['node_modules', 'dist'],
        typecheck: {
            enabled: false,
        },
        // The exhaustive disjointness proof enumerates every priority all 8 reserved slots could ever be
        // handed; it runs in 339ms locally but timed out at vitest's 5s default under CI's parallel load.
        testTimeout: CDK_SYNTH_TEST_TIMEOUT_MS,
    },
});
