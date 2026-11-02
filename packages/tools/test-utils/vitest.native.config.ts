import { fileURLToPath } from 'node:url';

import { jsdomPolyfillsSetup } from '@kitchensink/vitest';
import { preferNativeLeaves } from '@kitchensink/vitest/preferNativeLeaves';
import { defineConfig } from 'vitest/config';

/**
 * Native tests for `@commise/test-utils`: the helpers a native test lane resolves through `preferNativeLeaves`, so it
 * gets each `.native` leaf a consumer's native lane gets. `react-native` is `react-native-web` under jsdom, as in every
 * native lane. Native specs are `*.native.test.tsx` and owned by this config; the default run excludes them. `npm test`
 * runs both.
 */
export default defineConfig({
    plugins: [preferNativeLeaves()],
    test: {
        globals: true,
        environment: 'jsdom',
        // jsdom implements neither AnimationEvent nor TransitionEvent — see jsdomPolyfills.js.
        setupFiles: [jsdomPolyfillsSetup],
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
        },
    },
});
