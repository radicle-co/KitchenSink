/**
 * @module @commise/ui/theme — `useColorSchemeName` (web): there is none. On web the scheme is the
 * `prefers-color-scheme` media query the theme CSS answers (`tokens/themeCss.ts`). This leaf exists so the package
 * export can name `./useColorSchemeName.js` and let each bundler pick its platform's file.
 */
import type { ColorSchemeName } from './themeFor.js';

/**
 * Native-only. Throws, so a shared component that reaches for it on web fails at its first render.
 *
 * @returns Never.
 * @throws {Error} Always.
 */
export function useColorSchemeName(): ColorSchemeName {
    throw new Error(
        'useColorSchemeName is native-only. On web, the scheme is the prefers-color-scheme media query the theme CSS ' +
            'answers.',
    );
}
