import { testTempRootSetup, jsdomPolyfillsSetup } from '@kitchensink/vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { defineConfig, type Plugin } from 'vitest/config';

/**
 * Metro-style `.native.*` resolution for Vitest. Metro prefers a `Foo.native.tsx` leaf over `Foo.tsx`;
 * Vite/Vitest does not, and `resolve.extensionAlias` is unreliable for the compound `.native.tsx`
 * extension. This `pre` resolver redirects any RELATIVE import to its `.native.tsx`/`.native.ts` sibling
 * when one exists, so the widget's barrel composes the real native leaves (and the web `use()`+Suspense
 * entry is never loaded). Non-native imports fall through to default resolution.
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
 * Native component-test config for the recipe feature. No RN runtime under Vitest, so `react-native` is
 * aliased to `react-native-web` (the RN API rendered to DOM) and tests run in jsdom via
 * `@testing-library/react`. Native specs are named `*.native.test.tsx` and owned by this config; the
 * default (web) run excludes them. `npm test` runs both.
 */
export default defineConfig({
    plugins: [preferNativeLeaves()],
    test: {
        // ⛔ Confines this run's temp directories to one removable root — CDK's own `cdk.out*`
        // synth dirs and every `mkdtempSync(tmpdir())` fixture. Asserted by `vitestTempRoot.test.ts`.
        globalSetup: [testTempRootSetup],
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
            // `expo-image` is a native module with no jsdom runtime; the native leaves that adopt it for
            // disk-cached remote images (B11) render through a react-native-web stub under these tests.
            'expo-image': path.resolve(import.meta.dirname, 'test-utils/expoImageStub.tsx'),
            // `@shopify/flash-list` is a native (Fabric) recycler with no jsdom runtime; the virtualized
            // recipe/collection/discovery lists (U4) render through a react-native-web stub under these tests
            // (same reasoning as `expo-image`). Virtualization itself is a device/Maestro concern.
            '@shopify/flash-list': path.resolve(import.meta.dirname, 'test-utils/flashListStub.tsx'),
            // `@expo/vector-icons` ships extensionless internal ESM imports (`./createIconSet`, required
            // from `AntDesign.js`) that a cold Vitest dependency scan cannot reliably resolve (w3: exposed by
            // the wizard's new `Feather` usage — mirrors `@commise/mobile`'s identical fix, same root cause).
            // Icons are decorative in these tests, so stub the whole module.
            '@expo/vector-icons': path.resolve(import.meta.dirname, 'test-utils/expoVectorIconsStub.tsx'),
            // `expo-linear-gradient` / `expo-blur` back the U8 brand surfaces (`@commise/ui/surface`) the
            // hero native leaves adopt; both bridge to native views absent under jsdom, so stub them. Real
            // gradient/blur rendering is a device/Maestro concern.
            'expo-linear-gradient': path.resolve(import.meta.dirname, 'test-utils/expoLinearGradientStub.tsx'),
            'expo-blur': path.resolve(import.meta.dirname, 'test-utils/expoBlurStub.tsx'),
            // `react-native-safe-area-context` reports the device's window insets from a native module with
            // no jsdom runtime; the full-screen modal sheets (`FullScreenSheet.native.tsx`) read them so their
            // content clears the status/navigation bars. The stub serves fixed NON-ZERO insets so those
            // assertions stay falsifiable (same reasoning as the expo stubs above).
            'react-native-safe-area-context': path.resolve(import.meta.dirname, 'test-utils/safeAreaContextStub.tsx'),
        },
    },
});
