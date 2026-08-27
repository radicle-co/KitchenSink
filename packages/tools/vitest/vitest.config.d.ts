import type { UserConfig } from 'vitest/config';

/**
 * Type declaration for the base Vitest configuration.
 *
 * Provides type safety for consumers who extend the baseConfig using mergeConfig().
 * The test property is typed as UserConfig['test'] to ensure compatibility with
 * Vitest's configuration schema and enable IDE autocomplete for test options.
 */
/** Test timeout for a suite whose assertions run a CDK synth (ms). See the implementation's note. */
export declare const CDK_SYNTH_TEST_TIMEOUT_MS: number;

export declare const baseConfig: {
    test: UserConfig['test'];
    resolve: {
        alias: {
            '@': string;
        };
    };
};
export default baseConfig;
/** Absolute path to the temp-root `globalSetup`. */
export declare const testTempRootSetup: string;
