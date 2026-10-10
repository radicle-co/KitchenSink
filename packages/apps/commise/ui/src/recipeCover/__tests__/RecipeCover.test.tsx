import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { RecipeCover } from '../RecipeCover.js';
import { coverTintOf } from '../coverTint.js';

/**
 * RecipeCover (web) — spec §1.8: the photo when there is one; otherwise a monogram cover — one of six tints chosen by
 * the recipe's id, the title's first letter in Playfair 700 `ink` at 40% of the cover's height, and the cuisine as an
 * `overline` under it, but never on a cover under 96 px tall. Either way the cover is decorative: the title is the
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
        const { container } = render(<RecipeCover recipeId="rec_42" title="lemon tart" aspect="4:3" />);
        const ground = container.querySelector<HTMLElement>('[aria-hidden="true"]');

        // The tint's CLASS, whose custom property the dark block overrides (D15) — not an inline light hex.
        expect(ground?.className.split(/\s+/u)).toContain(`bg-cover-${coverTintOf('rec_42')}`);
        expect(ground?.style.backgroundColor).toBe('');
        expect(ground?.textContent).toBe('L');
        expect(container.querySelector('img')).toBeNull();
    });

    it('sets the letter in the display face, bold, in ink, at 40% of the cover’s height', () => {
        const { getByText } = render(<RecipeCover recipeId="rec_42" title="Lemon tart" aspect="4:3" />);

        expect(tokensOf(getByText('L'))).toEqual(
            expect.arrayContaining(['font-display', 'font-bold', 'text-ink', 'text-[40cqh]']),
        );
    });

    it('sets the cuisine as an overline in ink, shown only on a cover 96px tall or taller', () => {
        const { getByText } = render(
            <RecipeCover recipeId="rec_42" title="Lemon tart" cuisine="French" aspect="4:3" />,
        );

        expect(tokensOf(getByText('French'))).toEqual(
            expect.arrayContaining(['text-overline', 'text-ink', 'hidden', '[@container_cover_(height>=6rem)]:block']),
        );
    });

    it('shows no overline without a cuisine', () => {
        const { getByText, container } = render(<RecipeCover recipeId="rec_42" title="Lemon tart" aspect="4:3" />);

        expect(getByText('L').parentElement?.children).toHaveLength(1);
        expect(container.textContent).toBe('L');
    });

    it('is a size container, so the letter and the overline read the cover’s own height', () => {
        const { container } = render(<RecipeCover recipeId="rec_42" title="Lemon tart" aspect="1:1" />);

        expect(tokensOf(container.firstElementChild)).toEqual(
            expect.arrayContaining(['[container-type:size]', '[container-name:cover]']),
        );
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
