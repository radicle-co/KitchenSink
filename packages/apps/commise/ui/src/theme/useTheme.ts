/**
 * @module @commise/ui/theme — `useTheme` (web): there is none. On web a colour is a role utility whose custom property
 * the `prefers-color-scheme: dark` block swaps (`tokens/themeCss.ts`), so a web component needs no hook. This leaf
 * exists so the package export can name `./useTheme.js` and let each bundler pick its platform's file: an index that
 * named `useTheme.native.js` by path put `react-native` in front of every web import of `themeFor`, and the web app
 * does not depend on `react-native`.
 */
import type { Theme } from './themeFor.js';

/**
 * Native-only. Throws, so a shared component that reaches for it on web fails at its first render instead of quietly
 * painting the light theme in dark mode.
 *
 * @returns Never.
 * @throws {Error} Always.
 */
export function useTheme(): Theme {
    throw new Error(
        'useTheme is native-only. On web, colour comes from the role utilities (`bg-paper`, `text-ink`, …), whose ' +
            'custom properties the dark block swaps in CSS.',
    );
}
