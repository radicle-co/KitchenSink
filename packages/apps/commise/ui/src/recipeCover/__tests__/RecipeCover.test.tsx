import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { RecipeCover } from '../RecipeCover.js';
import { coverTintOf } from '../coverTint.js';

/**
 * RecipeCover (web) — spec §1.8: the photo when there is one; otherwise a monogram cover — one of six tints chosen by
 * the recipe's id, the title's first letter in Manrope 700 `ink` at 40% of the cover's height, and the cuisine as an
 * `caption` under it, but never on a cover under 96 px tall. Either way the cover is decorative: the title is the
 * name of the link it sits in. Every cover states its aspect ratio, so nothing shifts as an image loads.
 */

afterEach(cleanup);

const tokensOf = (element: Element | null): readonly string[] => element?.className.split(/\s+/u) ?? [];

describe('RecipeCover (web) — a photo', () => {
    it('draws the photo, lazily, decoded off the main thread, framed at the centre 40% down, as decoration', () => {
        const { container } = render(
            <RecipeCover recipeId="rec_1" title="Lemon tart" photoUrl="https://img.example/tart.jpg" aspect="4:3" />,
        );
        const image = container.querySelector('img');

        expect(image?.getAttribute('src')).toBe('https://img.example/tart.jpg');
        expect(image?.getAttribute('loading')).toBe('lazy');
        expect(image?.getAttribute('decoding')).toBe('async');
        expect(image?.getAttribute('alt')).toBe('');
        expect(tokensOf(image)).toEqual(expect.arrayContaining(['object-cover', 'object-[center_40%]']));
        expect(container.textContent).toBe('');
    });
});

describe('RecipeCover (web) — a monogram', () => {
    it('grounds the cover in the recipe’s own tint and shows the title’s first letter, hidden from assistive tech', () => {
        const { container, getByText } = render(<RecipeCover recipeId="rec_42" title="lemon tart" aspect="4:3" />);

        // The tint's CLASS, whose custom property the dark block overrides (D15) — not an inline light hex.
        expect(tokensOf(container.firstElementChild)).toContain(`bg-cover-${coverTintOf('rec_42')}`);
        expect((container.firstElementChild as HTMLElement).style.backgroundColor).toBe('');
        expect(getByText('L').closest('[aria-hidden="true"]')?.textContent).toBe('L');
        expect(container.querySelector('img')).toBeNull();
    });

    it('sets the letter in the display face, bold, in ink, at 40% of the cover’s height', () => {
        const { getByText } = render(<RecipeCover recipeId="rec_42" title="Lemon tart" aspect="4:3" />);

        expect(tokensOf(getByText('L'))).toEqual(
            expect.arrayContaining(['font-display', 'font-bold', 'text-ink', 'text-[40cqh]']),
        );
    });

    it('sets the cuisine as a caption in ink, shown only on a cover 96px tall or taller', () => {
        const { getByText } = render(
            <RecipeCover recipeId="rec_42" title="Lemon tart" cuisine="French" aspect="4:3" />,
        );

        expect(tokensOf(getByText('French'))).toEqual(
            expect.arrayContaining(['text-caption', 'text-ink', 'hidden', '[@container_cover_(height>=6rem)]:block']),
        );
    });

    it('shows no cuisine without a cuisine', () => {
        const { getByText, container } = render(<RecipeCover recipeId="rec_42" title="Lemon tart" aspect="4:3" />);

        expect(getByText('L').parentElement?.children).toHaveLength(1);
        expect(container.textContent).toBe('L');
    });

    it('draws no cuisine when told the cover carries a chip over it (W-08), and still shows the letter', () => {
        const { queryByText, getByText } = render(
            <RecipeCover recipeId="rec_42" title="Lemon tart" cuisine="French" aspect="4:3" showCuisine={false} />,
        );

        expect(queryByText('French')).toBeNull();
        expect(getByText('L')).toBeTruthy();
    });

    it('keeps the cuisine by default, so a caller that says nothing sees no change', () => {
        const { getByText } = render(
            <RecipeCover recipeId="rec_42" title="Lemon tart" cuisine="French" aspect="4:3" />,
        );

        expect(getByText('French')).toBeTruthy();
    });

    it('is a size container, so the letter and the cuisine read the cover’s own height', () => {
        const { container } = render(<RecipeCover recipeId="rec_42" title="Lemon tart" aspect="1:1" />);

        expect(tokensOf(container.firstElementChild)).toEqual(
            expect.arrayContaining(['[container-type:size]', '[container-name:cover]']),
        );
    });
});

describe('RecipeCover (web) — the letter is centred in the whole cover', () => {
    it('centres the letter in the whole cover', () => {
        const { container, getByText } = render(<RecipeCover recipeId="rec_42" title="Lemon tart" aspect="4:3" />);
        const region = getByText('L').closest('[aria-hidden="true"]');

        expect(Array.from(container.firstElementChild?.children ?? [])).toEqual([region]);
        expect(tokensOf(region)).toEqual(expect.arrayContaining(['flex-1', 'items-center', 'justify-center']));
    });
});

describe('RecipeCover (web) — the aspect', () => {
    it.each([
        ['4:3', 'aspect-[4/3]'],
        ['1:1', 'aspect-square'],
        ['band', 'h-24'],
    ] as const)('reserves the %s box before anything loads', (aspect, token) => {
        const { container } = render(<RecipeCover recipeId="rec_1" title="Tart" aspect={aspect} />);

        expect(tokensOf(container.firstElementChild)).toContain(token);
    });
});
