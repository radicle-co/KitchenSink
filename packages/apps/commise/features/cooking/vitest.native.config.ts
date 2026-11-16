import { jsdomPolyfillsSetup } from '@kitchensink/vitest';
import { preferNativeLeaves } from '@kitchensink/vitest/preferNativeLeaves';
import { fileURLToPath } from 'node:url';

import { lucideNativeStub } from '@commise/ui/testing/lucide-native';
import { defineConfig } from 'vitest/config';

/**
 * Native test config for the cooking feature. There is no React Native runtime under Vitest, so `react-native` is
 * aliased to `react-native-web` and the specs run under jsdom through `@testing-library/react`. Native specs are named
 * `*.native.test.tsx` and owned by this config. `npm test` runs it after the web config.
 */
export default defineConfig({
    plugins: [preferNativeLeaves(), lucideNativeStub()],
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: [jsdomPolyfillsSetup, '@commise/ui/testing/screen-reader-shim', './vitest.setup.native.ts'],
        // Above `ASYNC_UTIL_TIMEOUT_MS` (`@commise/test-utils/async-util-budget`).
        testTimeout: 15_000,
        include: ['**/__tests__/**/*.native.test.tsx'],
        exclude: ['node_modules', 'dist'],
    },
    resolve: {
        alias: {
            'react-native': 'react-native-web',
            // The device driver throws on Tamagui's web build, which this lane runs.
            '@tamagui/animations-react-native': fileURLToPath(
                import.meta.resolve('@commise/ui/testing/animations-shim'),
            ),
            // `@commise/ui/keep-awake`'s native hold calls a native module with no jsdom runtime; the stub records holds.
            'expo-keep-awake': fileURLToPath(import.meta.resolve('@commise/ui/testing/expo-keep-awake')),
            // `react-native-safe-area-context` reports window insets from a native module with no jsdom runtime.
            'react-native-safe-area-context': fileURLToPath(
                import.meta.resolve('@commise/ui/testing/safe-area-context'),
            ),
        },
    },
});
