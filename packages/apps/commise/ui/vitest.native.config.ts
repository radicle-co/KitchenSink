import { jsdomPolyfillsSetup } from '@kitchensink/vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, type Plugin } from 'vitest/config';

import { lucideNativeStub } from './src/testing/lucideNativeStub.js';

const stubDir = fileURLToPath(new URL('./test/stubs', import.meta.url));

/**
 * Metro-style `.native.*` resolution for Vitest. Metro prefers a `Foo.native.tsx` leaf over `Foo.tsx`;
 * Vite/Vitest does not, and `resolve.extensionAlias` is unreliable for the compound `.native.tsx`
 * extension. This `pre` resolver redirects any RELATIVE import to its `.native.tsx`/`.native.ts` sibling
 * when one exists, so the component barrel composes the real native leaves. Non-native imports fall
 * through to default resolution.
 */
function preferNativeLeaves(): Plugin {
    return {
        name: 'prefer-native-leaves',
        enforce: 'pre',
        resolveId(source, importer) {
            if (importer === undefined || !(source.startsWith('./') || source.startsWith('../'))) {
                return null;
            }
            const noExt = source.replace(/\.(js|jsx|ts|tsx)$/, '');
            const base = path.resolve(path.dirname(importer), noExt);
            // An explicit `.native.js` specifier (used by tests so `tsc` resolves the native props too)
            // maps to its own `.tsx`/`.ts`; any other relative import prefers a `.native` sibling.
            const candidates = noExt.endsWith('.native')
                ? [`${base}.tsx`, `${base}.ts`]
                : [`${base}.native.tsx`, `${base}.native.ts`];
            for (const candidate of candidates) {
                if (existsSync(candidate)) {
                    return candidate;
                }
            }
            return null;
        },
    };
}

/**
 * Native component-test config for the shared design-system components. No RN runtime under Vitest, so
 * `react-native` is aliased to `react-native-web` (the RN API rendered to DOM) and tests run in jsdom via
 * `@testing-library/react`. Native specs are named `*.native.test.tsx` and owned by this config; the
 * default (web) run excludes them. `npm test` runs both.
 */
export default defineConfig({
    // `lucide-react-native/icons/*` draws through `react-native-svg`, which has no jsdom runtime.
    plugins: [preferNativeLeaves(), lucideNativeStub()],
    test: {
        globals: true,
        environment: 'jsdom',
        // jsdom implements neither AnimationEvent nor TransitionEvent — see jsdomPolyfills.js.
        setupFiles: [jsdomPolyfillsSetup, './src/testing/screenReaderShim.native.ts'],
        passWithNoTests: true,
        include: ['**/__tests__/**/*.native.test.tsx'],
        exclude: ['node_modules', 'dist'],
        // `expo-glass-effect` ships plain JS whose non-iOS leaves are a `View` and two `false`s; inlined so its
        // `react-native` import takes the alias above instead of Node loading React Native's Flow source.
        server: { deps: { inline: ['expo-glass-effect'] } },
    },
    resolve: {
        alias: {
            'react-native': 'react-native-web',
            // The Expo native modules have no jsdom/react-native-web implementation; alias them to
            // lightweight stubs so the `.native` surface leaves render (and assert) under Vitest. The real
            // gradient rendering is emulator-only (Maestro).
            'expo-linear-gradient': path.join(stubDir, 'expoLinearGradientStub.tsx'),
            // `RecipeCover` draws photos through `expo-image`, a native module with no jsdom runtime.
            'expo-image': path.join(stubDir, 'expoImageStub.tsx'),
            // The sheet pads by the device's window insets, which a native module reports; the stub serves fixed
            // non-zero insets so those assertions stay falsifiable.
            'react-native-safe-area-context': fileURLToPath(
                new URL('./src/testing/safeAreaContext.native.tsx', import.meta.url),
            ),
        },
    },
});
