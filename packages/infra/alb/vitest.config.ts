import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/**/__tests__/**/*.test.ts'],
        exclude: ['node_modules', 'dist'],
        typecheck: {
            enabled: false,
        },
        // The exhaustive disjointness proof enumerates every priority all 8 reserved slots could ever be
        // handed. It runs in 339ms locally but timed out at vitest's 5s default on a CI runner under the
        // parallel turbo test load — the same cause `packages/infra/global/vitest.config.ts` documents for
        // its synth-backed assertions. 339ms is not a slow test, and 5s is a framework default rather than
        // a budget derived from anything, so the headroom is the fix; shrinking the enumeration would trade
        // the proof for the appearance of one.
        testTimeout: 30_000,
    },
});
