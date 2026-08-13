import path from 'path';

/**
 * Base Vitest configuration for KitchenSink packages.
 *
 * Provides a shared test configuration that:
 * - globals: true -- Makes describe, it, expect, and other test globals available without imports.
 * - include pattern -- Discovers test files in __tests__ directories with .test.ts or .test.tsx suffix.
 * - exclude -- Skips scanning node_modules and dist directories.
 * - resolve.alias -- Maps the `@` path alias to `./src` relative to the consuming workspace root.
 *
 * Consumers should merge this config with their own using mergeConfig() from vitest/config
 * to extend or override specific test options.
 *
 * Tests should be located in __tests__ folders following the KitchenSink file organization pattern.
 */
/**
 * Test timeout for a suite whose assertions run a CDK synth (ms).
 *
 * Vitest's 5s default is a framework default, not a budget derived from anything, and a synth-backed
 * assertion blows past it on a CI runner even when it takes well under a second locally — measured at 339ms
 * (`infra-alb`'s priority-disjointness proof) and 852ms (`recipe-workers`' artifact guard), both of which
 * timed out at 5s under the parallel turbo test load. Shrinking such a proof to fit would trade the proof for
 * the appearance of one, so the headroom is the fix.
 *
 * Defined here rather than repeated per package so the number and the reason have ONE home; the configs
 * themselves stay separate, because they legitimately differ (aliases, includes, whether they merge
 * `baseConfig` at all).
 */
export const CDK_SYNTH_TEST_TIMEOUT_MS = 30_000;

export const baseConfig = {
    test: {
        globals: true,
        include: ['**/__tests__/**/*.test.{ts,tsx}'],
        exclude: ['node_modules', 'dist'],
        pool: {
            forks: {
                execArgv: ['--enable-source-maps'],
            },
        },
    },
    resolve: {
        alias: {
            '@': path.resolve(process.cwd(), 'src'),
        },
    },
};

export default baseConfig;
