import { cleanup, screen } from '@testing-library/react';
import { formatRgb } from 'culori';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeCover } from '../RecipeCover.native.js';
import { coverTintOf } from '../coverTint.js';
import { letterLiftOf, letterLineHeightOf } from '../../text/letterMetrics.js';
import { coverTint, coverTintDark } from '../../tokens/covers.js';
import { nativeTokens } from '../../tokens/native.js';
import { stubBoundingRects } from '../../testing/boundingRects.js';
import { renderWithTamagui, renderedRoot, resolvedColour, resolvedStyle } from '../../testing/tamaguiTesting.native.js';

/**
 * RecipeCover (native) — the native half of spec §1.8: the photo through `expo-image`, else the monogram on the
 * recipe's tint, the letter at 40% of the measured height, the cuisine as a caption only from 96 pt tall.
 *
 * ⚠️ REWRITTEN for the card-fields ruling (designer, 2026-11-02): no card draws a cover time chip, so the cover's
 * `footer` prop is deleted and the letter is centred in the WHOLE cover. The footer-specific tests (the letter above a
 * band, the band readable by assistive tech, the band over a photo) went with the prop; the no-footer centring test is
 * kept. jsdom lays nothing out, so the tests assert the layout RULE (a growing region that holds the letter and centres
 * it) and the letter's fixed size; the pixels are for a device.
 */

/** Restores `getBoundingClientRect` after a test that measured the cover. */
let restoreRects: (() => void) | undefined;

afterEach(() => {
    cleanup();
    restoreRects?.();
    restoreRects = undefined;
});

/**
 * Render in one scheme at one text scale and return the cover's root box. Tamagui's web build reports `onLayout` once,
 * at mount, from `getBoundingClientRect`, which jsdom answers with an empty rect, so a test that needs the cover's
 * measured size states it BEFORE rendering.
 */
function renderCover(
    ui: ReactElement,
    options: { scheme?: 'light' | 'dark'; textScale?: number; size?: readonly [number, number] } = {},
): HTMLElement {
    const { scheme = 'light', textScale = 1, size } = options;

    if (size !== undefined) {
        restoreRects = stubBoundingRects(() => ({ width: size[0], height: size[1] }));
    }

    const { container } = renderWithTamagui(ui, scheme, textScale);

    return renderedRoot(container) as HTMLElement;
}

describe('RecipeCover (native) — a photo', () => {
    it('draws the photo through expo-image, covering the box, hidden from assistive tech', () => {
        const { container } = renderWithTamagui(
            <RecipeCover recipeId="rec_1" title="Lemon tart" photoUrl="https://img.example/tart.jpg" aspect="4:3" />,
            'light',
        );
        const image = container.querySelector('img');

        expect(image?.getAttribute('src')).toBe('https://img.example/tart.jpg');
        expect(image?.closest('[aria-hidden="true"]')).not.toBeNull();
        expect(screen.queryByText('L')).toBeNull();
    });
});

describe('RecipeCover (native) — a monogram', () => {
    it('grounds the cover in the recipe’s tint and shows the first letter', () => {
        const cover = renderCover(<RecipeCover recipeId="rec_42" title="lemon tart" aspect="4:3" />);

        expect(resolvedColour(cover, 'backgroundColor')).toBe(formatRgb(coverTint[coverTintOf('rec_42')]));
        expect(screen.getByText('L').closest('[aria-hidden="true"]')).not.toBeNull();
    });

    it('sets the letter in the display face at 40% of the measured height', () => {
        renderCover(<RecipeCover recipeId="rec_42" title="Lemon tart" aspect="4:3" />, { size: [160, 120] });

        const letter = screen.getByText('L');

        expect(resolvedStyle(letter, 'fontFamily')).toContain(nativeTokens.fontFace.display.bold);
        expect(resolvedStyle(letter, 'fontSize')).toBe('48px');
    });

    // Designer ruling c10ecadbf (2026-11-03): the cover letter is decoration like avatar initials, so it does not scale with
    // the system text size; it stays at its fixed share of the cover's height, the same as at 1x.
    it('keeps the letter at 40% of the cover at the largest text size', () => {
        renderCover(<RecipeCover recipeId="rec_42" title="Lemon tart" aspect="4:3" />, {
            textScale: 2,
            size: [160, 120],
        });

        expect(resolvedStyle(screen.getByText('L'), 'fontSize')).toBe('48px');
    });

    it('leaves the cuisine caption to scale with the text, as before', () => {
        renderCover(<RecipeCover recipeId="rec_42" title="Lemon tart" cuisine="French" aspect="1:1" />, {
            textScale: 2,
            size: [120, 120],
        });

        expect(Number.parseFloat(resolvedStyle(screen.getByText('French'), 'fontSize'))).toBeGreaterThan(
            nativeTokens.type.caption.fontSize,
        );
    });

    it('shows the cuisine from 96pt tall, and not below', () => {
        renderCover(<RecipeCover recipeId="rec_42" title="Lemon tart" cuisine="French" aspect="1:1" />, {
            size: [72, 72],
        });
        expect(screen.queryByText('French')).toBeNull();

        cleanup();
        restoreRects?.();
        renderCover(<RecipeCover recipeId="rec_42" title="Lemon tart" cuisine="French" aspect="1:1" />, {
            size: [96, 96],
        });
        expect(screen.getByText('French')).toBeTruthy();
    });

    it('shows no cuisine when told the cover carries a chip over it, however tall (W-08)', () => {
        renderCover(
            <RecipeCover recipeId="rec_42" title="Lemon tart" cuisine="French" aspect="4:3" showCuisine={false} />,
            { size: [360, 270] },
        );

        expect(screen.queryByText('French')).toBeNull();
        expect(screen.getByText('L')).toBeTruthy();
    });

    it('shows no cuisine without a cuisine, however tall', () => {
        const cover = renderCover(<RecipeCover recipeId="rec_42" title="Lemon tart" aspect="band" />, {
            size: [360, 96],
        });

        expect(cover.textContent).toBe('L');
    });

    it.each([
        ['4:3', 4 / 3],
        ['1:1', 1],
    ] as const)('reserves the %s box by its aspect ratio', (aspect, ratio) => {
        const cover = renderCover(<RecipeCover recipeId="rec_1" title="Tart" aspect={aspect} />);

        expect(Number.parseFloat(resolvedStyle(cover, 'aspectRatio'))).toBeCloseTo(ratio);
    });

    it('draws the band 96pt tall across its width', () => {
        const cover = renderCover(<RecipeCover recipeId="rec_1" title="Tart" aspect="band" />);

        expect(resolvedStyle(cover, 'height')).toBe('96px');
    });
});

describe('RecipeCover (native) — the letter is centred in the whole cover', () => {
    /** The element that holds the letter, and the flow children beside it. */
    function regionOf(cover: HTMLElement): HTMLElement {
        const region = screen.getByText('L').closest<HTMLElement>('[aria-hidden="true"]');

        if (region === null || region.parentElement !== cover) {
            throw new Error('the letter is not held by a direct child of the cover');
        }

        return region;
    }

    it('centres the letter in the whole cover', () => {
        const cover = renderCover(<RecipeCover recipeId="rec_42" title="Lemon tart" aspect="4:3" />);
        const region = regionOf(cover);

        expect(cover.children).toHaveLength(1);
        expect(resolvedStyle(region, 'flexGrow')).toBe('1');
        expect(resolvedStyle(region, 'justifyContent')).toBe('center');
    });
});

// Designer ruling (2026-11-03): the cover letter centres by its CAP BAND within 2 pt on both axes, at every scale, and the
// status chips sit over the cover and never push it. jsdom lays nothing out, so these assert the layout RULE; the pixels
// are for a device.
describe('RecipeCover (native) — the letter is centred by its cap band', () => {
    it('gives the letter a line exactly the font’s height (no leading) and lifts it by the cap band’s drop', () => {
        renderCover(<RecipeCover recipeId="rec_42" title="Lemon tart" aspect="4:3" />, { size: [160, 120] });
        const letter = screen.getByText('L');

        expect(Number.parseFloat(resolvedStyle(letter, 'lineHeight'))).toBe(letterLineHeightOf(48));
        expect(resolvedStyle(letter, 'transform')).toContain(`translateY(${-letterLiftOf(48)}px)`);
    });

    it('keeps the same rule at the largest text size, because the letter does not scale', () => {
        renderCover(<RecipeCover recipeId="rec_42" title="Lemon tart" aspect="4:3" />, {
            textScale: 2,
            size: [160, 120],
        });

        expect(Number.parseFloat(resolvedStyle(screen.getByText('L'), 'lineHeight'))).toBe(letterLineHeightOf(48));
    });
});

describe('RecipeCover (native) — the dark scheme', () => {
    it('grounds the monogram in the tint’s DARK value when the system is dark', () => {
        const cover = renderCover(<RecipeCover recipeId="rec_42" title="lemon tart" aspect="4:3" />, {
            scheme: 'dark',
        });

        expect(resolvedColour(cover, 'backgroundColor')).toBe(formatRgb(coverTintDark[coverTintOf('rec_42')]));
    });
});
