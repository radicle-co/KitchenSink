import { testTempRootSetup, jsdomPolyfillsSetup } from '@kitchensink/vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { defineConfig, type Plugin } from 'vitest/config';

/**
 * Metro-style `.native.*` resolution for Vitest (copied from `@commise/features-recipes`). Metro prefers a
 * `Foo.native.tsx` leaf over `Foo.tsx`; Vite/Vitest does not, and `resolve.extensionAlias` is unreliable for
 * the compound `.native.tsx` extension. This `pre` resolver redirects any RELATIVE import to its
 * `.native.tsx`/`.native.ts` sibling when one exists, so the danger-zone barrel composes the real native
 * leaves under the native run. An explicit `.native.js` specifier (used by the native tests so `tsc`
 * resolves the native props too) maps back to its own `.tsx`/`.ts`.
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
 * Native component-test config. No RN runtime under Vitest, so `react-native` is aliased to
 * `react-native-web` (the RN API rendered to DOM) and tests run in jsdom via `@testing-library/react`.
 * Native specs are named `*.native.test.tsx` and owned by this config; the default (web) run excludes them.
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
        },
    },
});
