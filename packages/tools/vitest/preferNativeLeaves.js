import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Metro-style `.native.*` resolution for Vitest. Metro prefers a `Foo.native.tsx` leaf over `Foo.tsx`; Vite/Vitest
 * does not, and `resolve.extensionAlias` is unreliable for the compound `.native.tsx` extension. This `pre`
 * resolver redirects any RELATIVE import to its `.native.tsx`/`.native.ts` sibling when one exists, so a native
 * test composes the real native leaves a device would. An explicit `.native.js` specifier (used by native tests
 * so `tsc` resolves the native props too) maps back to its own `.tsx`/`.ts`. Non-native imports fall through to
 * default resolution.
 *
 * One definition for every package that runs a native vitest config: it had been copied into four of them.
 *
 * @returns {import('vitest/config').Plugin}
 */
export function preferNativeLeaves() {
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
