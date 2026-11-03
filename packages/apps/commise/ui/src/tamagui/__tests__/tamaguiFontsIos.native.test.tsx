/**
 * The Tamagui fonts' leadings carry the iOS workaround for react/react-native#58970, like the other two leading
 * producers (`nativeTokens`, `scaledTypeSize`). The platform and pixel scale are fixed before the module loads, so it is
 * imported fresh per platform. The scale's own values (`lineHeightPx`) stay exact at the source.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { lineHeightPx } from '../../tokens/scale.js';

type Os = 'ios' | 'android';

/** Loads the fonts as a device of platform `os` and pixel ratio 3 would. */
async function loadFonts(os: Os): Promise<(typeof import('../tamaguiFonts.js'))['tamaguiFonts']> {
    vi.resetModules();
    const rn = await import('react-native');
    Object.defineProperty(rn.Platform, 'OS', { value: os, configurable: true });
    vi.spyOn(rn.PixelRatio, 'get').mockReturnValue(3);

    return (await import('../tamaguiFonts.js')).tamaguiFonts;
}

afterEach(() => {
    vi.restoreAllMocks();
});

const SIZES = [14, 16, 18, 28] as const;

describe('tamaguiFonts leadings (native)', () => {
    it.each(['body', 'heading'] as const)('puts every %s leading a hair above the grid on iOS', async (family) => {
        const fonts = await loadFonts('ios');

        for (const size of SIZES) {
            expect(Number.parseFloat(fonts[family].lineHeight[size])).toBeCloseTo(lineHeightPx[size] + 0.001, 9);
            expect(fonts[family].lineHeight[size]).toMatch(/px$/);
        }
    });

    it.each(['body', 'heading'] as const)('leaves every %s leading exact on Android', async (family) => {
        const fonts = await loadFonts('android');

        for (const size of SIZES) {
            expect(fonts[family].lineHeight[size]).toBe(`${lineHeightPx[size]}px`);
        }
    });

    it('leaves the scale itself at 14, 16, 18 and 28 → 20, 24, 24 and 32', () => {
        expect(lineHeightPx).toEqual({ 14: 20, 16: 24, 18: 24, 28: 32 });
    });
});
