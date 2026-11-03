import { cleanup, screen } from '@testing-library/react';
import { formatRgb } from 'culori';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeCover } from '../RecipeCover.native.js';
import { coverTintOf } from '../coverTint.js';
import { coverTint, coverTintDark } from '../../tokens/covers.js';
import { nativeTokens } from '../../tokens/native.js';
import { stubBoundingRects } from '../../testing/boundingRects.js';
import {
    renderWithTamagui,
    renderedRoot,
    resolvedColour,
    resolvedStyle,
} from '../../testing/tamaguiTesting.native.js';

/**
 * RecipeCover (native) — the native half of spec §1.8: the photo through `expo-image`, else the monogram on the
 * recipe's tint, the letter at 40% of the measured height, the cuisine as a caption only from 96 pt tall.
 *
 * ⚠️ REWRITTEN for the cover-letter ruling (designer, 2026-11-03): the cover is styled with Tamagui (ADR-0080) and takes
 * a `footer` (the meta-chip band) IN FLOW, as the last child of a column. The letter's region is the flexible space above
 * it, so the letter is centred above the band's top edge and never sits under it, however tall the band grows with the
 * text size. jsdom lays nothing out, so the tests assert the layout RULE that guarantees it (a column, a growing region
 * that holds the letter, a footer in flow after it) and the letter's fixed size; the pixels are for a device.
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

describe('RecipeCover (native) — the letter and the footer band (cover-letter ruling)', () => {
    /** The element that holds the letter, and the flow children beside it. */
    function regionOf(cover: HTMLElement): HTMLElement {
        const region = screen.getByText('L').closest<HTMLElement>('[aria-hidden="true"]');

        if (region === null || region.parentElement !== cover) {
            throw new Error('the letter is not held by a direct child of the cover');
        }

        return region;
    }

    it.each([
        ['one line of chip', 1],
        ['a band grown by the largest text size', 4],
    ] as const)('lays the letter out in the region ABOVE the footer, not over the whole cover: %s', (_name, lines) => {
        const cover = renderCover(
            <RecipeCover
                recipeId="rec_42"
                title="Lemon tart"
                aspect="4:3"
                showCuisine={false}
                footer={
                    <span data-band>
                        {Array.from({ length: lines }, (_line, index) => (
                            <span key={index}>35 min</span>
                        ))}
                    </span>
                }
            />,
        );
        const region = regionOf(cover);
        const band = screen.getAllByText('35 min')[0]?.closest('[data-band]')?.parentElement ?? null;

        // A column: the footer follows the letter's region in flow, so the region is only the space above the band.
        expect(resolvedStyle(cover, 'flexDirection')).toBe('column');
        expect(cover.children).toHaveLength(2);
        expect(cover.children[0]).toBe(region);
        expect(cover.children[1]).toBe(band);
        expect(resolvedStyle(band as HTMLElement, 'position')).not.toBe('absolute');
        // The region takes what the band leaves and centres the letter in it, so the band can grow and the letter moves up.
        expect(resolvedStyle(region, 'flexGrow')).toBe('1');
        expect(resolvedStyle(region, 'justifyContent')).toBe('center');
        expect(resolvedStyle(region, 'alignItems')).toBe('center');
    });

    it('keeps the footer readable by assistive tech: only the letter’s region is hidden', () => {
        const cover = renderCover(
            <RecipeCover recipeId="rec_42" title="Lemon tart" aspect="4:3" footer={<span>35 min</span>} />,
        );

        expect(cover.getAttribute('aria-hidden')).not.toBe('true');
        expect(screen.getByText('35 min').closest('[aria-hidden="true"]')).toBeNull();
    });

    it('centres the letter in the whole cover when there is no footer', () => {
        const cover = renderCover(<RecipeCover recipeId="rec_42" title="Lemon tart" aspect="4:3" />);
        const region = regionOf(cover);

        expect(cover.children).toHaveLength(1);
        expect(resolvedStyle(region, 'flexGrow')).toBe('1');
        expect(resolvedStyle(region, 'justifyContent')).toBe('center');
    });

    it('puts the footer over a photo too, at the cover’s bottom start', () => {
        const cover = renderCover(
            <RecipeCover
                recipeId="rec_1"
                title="Tart"
                photoUrl="https://img.example/tart.jpg"
                aspect="4:3"
                footer={<span>35 min</span>}
            />,
        );
        const band = screen.getByText('35 min').parentElement as HTMLElement;

        expect(band.parentElement).toBe(cover);
        expect(resolvedStyle(band, 'alignSelf')).toBe('flex-start');
        expect(resolvedStyle(cover.lastElementChild as HTMLElement, 'alignSelf')).toBe('flex-start');
    });
});

describe('RecipeCover (native) — the dark scheme', () => {
    it('grounds the monogram in the tint’s DARK value when the system is dark', () => {
        const cover = renderCover(<RecipeCover recipeId="rec_42" title="lemon tart" aspect="4:3" />, { scheme: 'dark' });

        expect(resolvedColour(cover, 'backgroundColor')).toBe(formatRgb(coverTintDark[coverTintOf('rec_42')]));
    });
});
