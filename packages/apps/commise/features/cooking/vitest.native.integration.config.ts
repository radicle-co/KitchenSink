import { jsdomPolyfillsSetup } from '@kitchensink/vitest';
import { preferNativeLeaves } from '@kitchensink/vitest/preferNativeLeaves';
import { fileURLToPath } from 'node:url';

import { lucideNativeStub } from '@commise/ui/testing/lucide-native';
import { defineConfig } from 'vitest/config';

/**
 * Integration test config for `@commise/features-cooking` (native lane). It is `vitest.native.config.ts` pointed at
 * `tests/__integration__/*.native.integration.test.tsx`: `react-native` is aliased to `react-native-web`, and
 * `expo-keep-awake` is its recording stand-in, so the native keep-awake adapter is the only thing stood in for.
 */
export default defineConfig({
    plugins: [preferNativeLeaves(), lucideNativeStub()],
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: [jsdomPolyfillsSetup, '@commise/ui/testing/screen-reader-shim', './vitest.setup.native.ts'],
        // Above `ASYNC_UTIL_TIMEOUT_MS` (`@commise/test-utils/async-util-budget`).
        testTimeout: 15_000,
        include: ['tests/__integration__/**/*.native.integration.test.tsx'],
        exclude: ['node_modules', 'dist'],
    },
    resolve: {
        alias: {
            'react-native': 'react-native-web',
            '@tamagui/animations-react-native': fileURLToPath(
                import.meta.resolve('@commise/ui/testing/animations-shim'),
            ),
            'expo-keep-awake': fileURLToPath(import.meta.resolve('@commise/ui/testing/expo-keep-awake')),
            'react-native-safe-area-context': fileURLToPath(
                import.meta.resolve('@commise/ui/testing/safe-area-context'),
            ),
        },
    },
});
