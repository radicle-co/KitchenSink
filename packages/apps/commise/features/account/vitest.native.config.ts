import { jsdomPolyfillsSetup } from '@kitchensink/vitest';
import { preferNativeLeaves } from '@kitchensink/vitest/preferNativeLeaves';
import { fileURLToPath } from 'node:url';

import { lucideNativeStub } from '@commise/ui/testing/lucide-native';
import { defineConfig } from 'vitest/config';

/**
 * Native component-test config. No RN runtime under Vitest, so `react-native` is aliased to
 * `react-native-web` (the RN API rendered to DOM) and tests run in jsdom via `@testing-library/react`.
 * Native specs are named `*.native.test.tsx` and owned by this config; the default (web) run excludes them.
 */
export default defineConfig({
    // `lucide-react-native/icons/*` draws through `react-native-svg`, which has no jsdom runtime.
    plugins: [preferNativeLeaves(), lucideNativeStub()],
    test: {
        globals: true,
        environment: 'jsdom',
        // jsdom implements neither AnimationEvent nor TransitionEvent — see jsdomPolyfills.js.
        setupFiles: [jsdomPolyfillsSetup, '@commise/ui/testing/screen-reader-shim'],
        include: ['**/__tests__/**/*.native.test.tsx'],
        exclude: ['node_modules', 'dist'],
    },
    resolve: {
        alias: {
            'react-native': 'react-native-web',
            // `react-native-safe-area-context` reports the device's window insets from a native module with no jsdom
            // runtime; the erase dialog reads them through `@commise/ui/dialog-frame`. The design system's stub serves
            // fixed NON-ZERO insets, so an inset assertion stays falsifiable.
            'react-native-safe-area-context': fileURLToPath(
                import.meta.resolve('@commise/ui/testing/safe-area-context'),
            ),
        },
    },
});
