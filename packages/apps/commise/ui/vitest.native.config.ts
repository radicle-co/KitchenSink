import { existsSync } from 'node:fs';
import path from 'node:path';

import { defineConfig, type Plugin } from 'vitest/config';

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
    plugins: [preferNativeLeaves()],
    test: {
        globals: true,
        environment: 'jsdom',
        passWithNoTests: true,
        include: ['**/__tests__/**/*.native.test.tsx'],
        exclude: ['node_modules', 'dist'],
    },
    resolve: {
        alias: {
            'react-native': 'react-native-web',
        },
    },
});
