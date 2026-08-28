import { testTempRootSetup, jsdomPolyfillsSetup } from '@kitchensink/vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { defineConfig, type Plugin } from 'vitest/config';

/**
 * Metro-style `.native.*` resolution for Vitest. Metro prefers a `Foo.native.tsx` leaf over `Foo.tsx`;
 * Vite/Vitest does not, and `resolve.extensionAlias` is unreliable for the compound `.native.tsx`
 * extension. This `pre` resolver redirects any RELATIVE import to its `.native.tsx`/`.native.ts` sibling
 * when one exists, so the shared `@commise/features-recipes` barrel composes its real NATIVE leaves (the
 * ones the mobile app actually ships) under test. Non-native imports fall through to default resolution.
 *
 * Mirrors `packages/apps/commise/features/recipes/vitest.native.config.ts` so the app screens are tested
 * against the same native building blocks the feature package tests.
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
 * Native component-test config for the mobile app's screens. There is no React Native runtime under Vitest,
 * so `react-native` is aliased to `react-native-web` (the RN API rendered to DOM) and the tests run in jsdom
 * via `@testing-library/react`. Screen component tests are named `*.native.test.tsx` and owned by this
 * config; the default `vitest.config.ts` (node env) owns the plain `*.test.ts` logic tests. `npm test` runs
 * both.
 */
export default defineConfig({
    plugins: [preferNativeLeaves()],
    // `__DEV__` is a React Native global (injected by the RN runtime) that jsdom lacks; `expo-modules-core`
    // reads it at import time. Define it so any expo module that slips into the graph does not abort on a
    // `ReferenceError: __DEV__ is not defined` (setup.native.ts also sets it on globalThis as a belt-and-braces
    // for modules evaluated before the define applies).
    define: {
        __DEV__: 'true',
    },
    test: {
        // ⛔ Confines this run's temp directories to one removable root — CDK's own `cdk.out*`
        // synth dirs and every `mkdtempSync(tmpdir())` fixture. Asserted by `vitestTempRoot.test.ts`.
        globalSetup: [testTempRootSetup],
        globals: true,
        environment: 'jsdom',
        setupFiles: [jsdomPolyfillsSetup, './tests/setup.native.ts'],
        include: ['tests/**/*.native.test.tsx'],
        exclude: ['node_modules', 'dist'],

        // `src/config/env.ts` validates the app's endpoints at MODULE LOAD and has no defaults, so any
        // screen test that reaches a service client would otherwise die with a configuration error.
        // Expo's own `.env.development` loader is not running under vitest, so state them explicitly —
        // the same reason and the same two values the web app's vitest config uses.
        //
        // Values are irrelevant to assertions (these suites never hit the network); only PRESENCE matters,
        // so a red test means the code is wrong rather than the environment being unset.
        // `tests/config/env.test.ts` overrides them per-case to prove absence still fails loudly.
        env: {
            EXPO_PUBLIC_RECIPE_API_URL: 'http://localhost:3000',
            EXPO_PUBLIC_IDENTITY_API_URL: 'http://localhost:4000',
        },
    },
    resolve: {
        alias: {
            'react-native': 'react-native-web',
            // `@expo/vector-icons` ships extensionless internal ESM imports that Vitest's strict Node ESM
            // cannot resolve, and pulls `expo-modules-core` (which touches `__DEV__`). Icons are decorative in
            // these tests, so stub the whole module — this unblocks the mobile `.native` screen suite locally.
            '@expo/vector-icons': path.resolve(import.meta.dirname, 'tests/stubs/expoVectorIcons.tsx'),
            // `expo-image` (used by the B11 native card/detail leaves) imports `expo-modules-core`'s native
            // module, absent under jsdom — stub it to react-native-web's Image (same approach as
            // features-recipes' own native config).
            'expo-image': path.resolve(import.meta.dirname, 'tests/stubs/expoImage.tsx'),
            // `@shopify/flash-list` is a native (Fabric) recycler with no jsdom runtime — the mobile screens
            // that compose the virtualized recipe/collection/discovery lists render through this stub (same
            // approach as `expo-image`; virtualization is a device/Maestro concern).
            '@shopify/flash-list': path.resolve(import.meta.dirname, 'tests/stubs/flashList.tsx'),
            // `expo-linear-gradient` / `expo-blur` (U8 brand surfaces + the Button primary CTA gradient)
            // bridge to native views with no jsdom runtime — stub them; real gradient/blur is emulator-only.
            'expo-linear-gradient': path.resolve(import.meta.dirname, 'tests/stubs/expoLinearGradient.tsx'),
            'expo-blur': path.resolve(import.meta.dirname, 'tests/stubs/expoBlur.tsx'),
            // `react-native-safe-area-context` ships Flow-typed source that Vitest cannot parse at all
            // (`Unexpected token 'typeof'`), and bridges to a native module for the device's window insets.
            // The shared `FullScreenSheet` recipe primitive reads `useSafeAreaInsets`, so every screen that
            // composes a recipe feature leaf pulls it into the graph — stub it here rather than requiring
            // each such test to remember a `vi.mock` (tests that DO mock it still win over this alias).
            'react-native-safe-area-context': path.resolve(import.meta.dirname, 'tests/stubs/safeAreaContext.tsx'),
        },
    },
});
