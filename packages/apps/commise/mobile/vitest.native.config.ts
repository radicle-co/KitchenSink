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
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./tests/setup.native.ts'],
        include: ['tests/**/*.native.test.tsx'],
        exclude: ['node_modules', 'dist'],
    },
    resolve: {
        alias: {
            'react-native': 'react-native-web',
        },
    },
});
