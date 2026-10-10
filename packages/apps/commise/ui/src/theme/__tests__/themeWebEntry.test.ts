/**
 * The web half of `@commise/ui/theme`. The package export is one `index.ts` for both platforms, so it must reach
 * `react-native` only through a native leaf the bundler picks: the web app does not depend on `react-native` at all,
 * and an index that named `useTheme.native.js` by path made any web import of `themeFor` fail to build.
 *
 * `react-native` is replaced by a module that throws when it is loaded, so this fails if the web entry reaches it by
 * ANY path, not just the one that was wrong.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => {
    throw new Error('the web entry of @commise/ui/theme loaded react-native');
});

describe('@commise/ui/theme on web', () => {
    it('loads without react-native and gives the theme for a scheme', async () => {
        const { themeFor } = await import('../index.js');

        expect(themeFor('dark').scheme).toBe('dark');
        expect(themeFor('light').scheme).toBe('light');
    });

    it('refuses useTheme, which is native-only, with a message that says where web colours come from', async () => {
        const { useTheme } = await import('../index.js');

        expect(() => useTheme()).toThrow(/native-only/u);
    });
});
